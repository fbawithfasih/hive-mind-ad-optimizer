import {
  getTodayISO,
  getDaysAgoISO,
  getDefaultDateRange,
  getOldestAllowedDate,
  getDaysDifference,
  RETENTION_DAYS_MS,
  DEFAULT_LOOKBACK_DAYS_MS,
  MAX_RANGE_DAYS,
} from '../dates.js';

const FIXED_NOW = new Date('2024-06-15T12:00:00.000Z').getTime();

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('constants', () => {
  it('RETENTION_DAYS_MS is 60 days', () => {
    expect(RETENTION_DAYS_MS).toBe(60 * 86400000);
  });

  it('DEFAULT_LOOKBACK_DAYS_MS is 30 days', () => {
    expect(DEFAULT_LOOKBACK_DAYS_MS).toBe(30 * 86400000);
  });

  it('MAX_RANGE_DAYS is 31', () => {
    expect(MAX_RANGE_DAYS).toBe(31);
  });
});

describe('getTodayISO', () => {
  it('returns date in YYYY-MM-DD format', () => {
    expect(getTodayISO()).toBe('2024-06-15');
  });

  it('matches ISO date portion of fixed time', () => {
    expect(getTodayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getDaysAgoISO', () => {
  it('returns today when 0 days ago', () => {
    expect(getDaysAgoISO(0)).toBe('2024-06-15');
  });

  it('returns correct date 30 days ago', () => {
    expect(getDaysAgoISO(30)).toBe('2024-05-16');
  });

  it('returns correct date 60 days ago', () => {
    expect(getDaysAgoISO(60)).toBe('2024-04-16');
  });

  it('returns correct date 1 day ago', () => {
    expect(getDaysAgoISO(1)).toBe('2024-06-14');
  });
});

describe('getDefaultDateRange', () => {
  it('returns object with startDate and endDate', () => {
    const range = getDefaultDateRange();
    expect(range).toHaveProperty('startDate');
    expect(range).toHaveProperty('endDate');
  });

  it('endDate is today', () => {
    expect(getDefaultDateRange().endDate).toBe('2024-06-15');
  });

  it('startDate is 30 days before endDate', () => {
    const { startDate, endDate } = getDefaultDateRange();
    const diff = getDaysDifference(startDate, endDate);
    expect(diff).toBe(30);
  });
});

describe('getOldestAllowedDate', () => {
  it('returns date 60 days ago', () => {
    expect(getOldestAllowedDate()).toBe('2024-04-16');
  });
});

describe('getDaysDifference', () => {
  it('returns 0 for same dates', () => {
    expect(getDaysDifference('2024-01-01', '2024-01-01')).toBe(0);
  });

  it('returns 1 for consecutive days', () => {
    expect(getDaysDifference('2024-01-01', '2024-01-02')).toBe(1);
  });

  it('returns 30 for 30-day span', () => {
    expect(getDaysDifference('2024-01-01', '2024-01-31')).toBe(30);
  });

  it('returns negative value when start is after end', () => {
    expect(getDaysDifference('2024-01-31', '2024-01-01')).toBe(-30);
  });

  it('handles month and year boundaries', () => {
    expect(getDaysDifference('2023-12-01', '2024-01-01')).toBe(31);
  });
});
