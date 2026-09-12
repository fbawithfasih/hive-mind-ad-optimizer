/**
 * Lifecycle email worker — a thin wrapper, tested for the one thing it owns:
 * the tally reaches the log and the caller unchanged, and a sweep that throws
 * reaches BullMQ so it is retried and then dead-lettered.
 */
jest.mock('../../services/trial-lifecycle.js', () => ({ sweepTrialEmails: jest.fn() }));

import { sweepTrialEmails } from '../../services/trial-lifecycle.js';
import { lifecycleEmailProcessor } from '../lifecycle-email.worker.js';

beforeEach(() => jest.clearAllMocks());

it('returns the sweep tally', async () => {
  sweepTrialEmails.mockResolvedValue({ welcome: 1, ending: 2, expired: 0, failed: 0 });
  await expect(lifecycleEmailProcessor({})).resolves.toEqual({ welcome: 1, ending: 2, expired: 0, failed: 0 });
});

it('lets a sweep failure propagate for BullMQ to retry', async () => {
  sweepTrialEmails.mockRejectedValue(new Error('database gone'));
  await expect(lifecycleEmailProcessor({})).rejects.toThrow('database gone');
});
