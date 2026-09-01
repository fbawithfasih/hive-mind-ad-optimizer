/**
 * What a report Amazon refused to produce actually tells us.
 *
 * The daily sweep was failing across every connected org and recording the
 * string "Report FATAL" and nothing else — which cannot distinguish "this
 * seller is not brand registered" from "that date range is not a closed BA
 * period". Amazon does say which: a FATAL report still carries a
 * reportDocumentId whose payload holds the reason, and we were discarding it.
 *
 * The other half is that FATAL is *settled*. Resubmitting the identical request
 * gets the identical answer, so these must not consume five attempts of
 * half-hour polling apiece.
 */

jest.mock('../http.js', () => ({
  http:       { get: jest.fn(), post: jest.fn() },
  TIMEOUT_MS: { api: 30_000, token: 15_000, download: 120_000, llm: 120_000 },
}));

jest.mock('../auth-utils.js', () => ({
  getOrCreateTokenManager: jest.fn(() => ({ getToken: async () => 'tok' })),
}));

import { gzipSync } from 'zlib';

import {
  createBrandAnalyticsClient,
  summariseFatalDocument,
  terminalError,
} from '../amazon-brand-analytics-api.js';
import { http } from '../http.js';

const client = () => createBrandAnalyticsClient({ clientId: 'c', clientSecret: 's', refreshToken: 'r' });

/**
 * Wire the three GETs a fatal lookup makes: the report, its document handle,
 * and the payload itself.
 */
function mockFatalReport(payload, { compression = null, processingStatus = 'FATAL' } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const buf  = compression === 'GZIP' ? gzipSync(Buffer.from(body)) : Buffer.from(body);

  http.get.mockImplementation(async (url) => {
    if (url.includes('/documents/')) {
      return { data: { url: 'https://doc.example/payload', compressionAlgorithm: compression } };
    }
    if (url === 'https://doc.example/payload') return { data: buf };
    return { data: { processingStatus, reportDocumentId: 'doc-1' } };
  });
}

beforeEach(() => jest.clearAllMocks());

describe('summariseFatalDocument', () => {
  it('pulls the message out of errorDetails', () => {
    expect(summariseFatalDocument(JSON.stringify({
      errorDetails: [{ message: 'Seller is not enrolled in Brand Registry' }],
    }))).toBe('Seller is not enrolled in Brand Registry');
  });

  it('joins several reasons rather than reporting only the first', () => {
    expect(summariseFatalDocument(JSON.stringify({
      errorDetails: [{ message: 'first' }, { message: 'second' }],
    }))).toBe('first; second');
  });

  it.each([
    ['errors',   { errors:   ['dataEndTime must be the last day of the month'] }],
    ['messages', { messages: [{ detail: 'dataEndTime must be the last day of the month' }] }],
  ])('reads Amazon\'s other shape: %s', (_label, payload) => {
    expect(summariseFatalDocument(JSON.stringify(payload)))
      .toBe('dataEndTime must be the last day of the month');
  });

  it('falls back to the raw text when the payload is not JSON', () => {
    // An unparsed reason still beats no reason.
    expect(summariseFatalDocument('report generation failed: no data')).toBe('report generation failed: no data');
  });

  it('falls back to the raw JSON when no known key carries the reason', () => {
    expect(summariseFatalDocument('{"unexpected":"shape"}')).toBe('{"unexpected":"shape"}');
  });

  it('caps the reason so one document cannot flood a log line or a DB column', () => {
    expect(summariseFatalDocument('x'.repeat(5000))).toHaveLength(300);
  });

  it.each([[''], ['   '], [null], [undefined]])('returns null for %p', (input) => {
    expect(summariseFatalDocument(input)).toBeNull();
  });
});

describe('getReportStatus on a report Amazon refused', () => {
  it('reports the reason Amazon gave, not just the status', async () => {
    mockFatalReport({ errorDetails: [{ message: 'Seller is not enrolled in Brand Registry' }] });

    const status = await client().getReportStatus('r-1');

    expect(status.state).toBe('FAILED');
    expect(status.error).toBe('Report FATAL: Seller is not enrolled in Brand Registry');
  });

  it('reads a gzipped fatal document', async () => {
    mockFatalReport({ errorDetails: [{ message: 'gzipped reason' }] }, { compression: 'GZIP' });

    expect((await client().getReportStatus('r-1')).error).toBe('Report FATAL: gzipped reason');
  });

  it('marks it terminal so the caller stops retrying', async () => {
    mockFatalReport({ errorDetails: [{ message: 'whatever' }] });

    expect((await client().getReportStatus('r-1')).terminal).toBe(true);
  });

  it('treats CANCELLED the same way', async () => {
    mockFatalReport({ errorDetails: [{ message: 'superseded' }] }, { processingStatus: 'CANCELLED' });

    const status = await client().getReportStatus('r-1');
    expect(status.terminal).toBe(true);
    expect(status.error).toBe('Report CANCELLED: superseded');
  });

  it('says so plainly when Amazon attaches no document at all', async () => {
    http.get.mockResolvedValue({ data: { processingStatus: 'FATAL' } });

    const status = await client().getReportStatus('r-1');

    expect(status.error).toBe('Report FATAL (Amazon supplied no detail)');
    expect(status.terminal).toBe(true);
  });

  it('keeps Amazon\'s status when the detail cannot be downloaded', async () => {
    // Replacing the real reason with our own download error would be strictly
    // worse than having no detail — the failure is still FATAL, still terminal.
    http.get.mockImplementation(async (url) => {
      if (url.includes('/documents/')) throw new Error('403 from S3');
      return { data: { processingStatus: 'FATAL', reportDocumentId: 'doc-1' } };
    });

    const status = await client().getReportStatus('r-1');

    expect(status.error).toBe('Report FATAL (Amazon supplied no detail)');
    expect(status.terminal).toBe(true);
  });

  it.each([['IN_QUEUE'], ['IN_PROGRESS']])('leaves %s pending and fetches no document', async (ps) => {
    http.get.mockResolvedValue({ data: { processingStatus: ps } });

    expect(await client().getReportStatus('r-1')).toEqual({ state: 'PENDING' });
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('still returns the document id on success', async () => {
    http.get.mockResolvedValue({ data: { processingStatus: 'DONE', reportDocumentId: 'doc-9' } });

    expect(await client().getReportStatus('r-1')).toEqual({ state: 'DONE', reportDocumentId: 'doc-9' });
  });
});

describe('createReport — requests Amazon would reject identically every time', () => {
  it.each([
    ['an unknown report type', { logicalType: 'NOPE',             reportingPeriod: 'MONTHLY' }],
    ['a dashboard-only type',  { logicalType: 'DEMOGRAPHICS',     reportingPeriod: 'MONTHLY' }],
    ['an unknown period',      { logicalType: 'TOP_SEARCH_TERMS', reportingPeriod: 'FORTNIGHTLY' }],
    ['SQP with no ASINs',      { logicalType: 'SQP_BRAND',        reportingPeriod: 'MONTHLY' }],
  ])('marks %s terminal', async (_label, params) => {
    await expect(client().createReport({ periodStart: '2026-08-01', periodEnd: '2026-08-31', ...params }))
      .rejects.toMatchObject({ terminal: true });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('marks an over-long ASIN list terminal', async () => {
    const asins = Array.from({ length: 30 }, (_, i) => `B0${String(i).padStart(8, '0')}`);

    await expect(client().createReport({
      logicalType: 'SQP_BRAND', reportingPeriod: 'MONTHLY',
      periodStart: '2026-08-01', periodEnd: '2026-08-31', asins,
    })).rejects.toMatchObject({ terminal: true });
  });
});

describe('terminalError', () => {
  it('is an ordinary Error carrying the flag', () => {
    const err = terminalError('nope');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('nope');
    expect(err.terminal).toBe(true);
  });
});
