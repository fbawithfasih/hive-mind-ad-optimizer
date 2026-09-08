/**
 * Trial lifecycle email processor.
 *
 * Runs daily (see workers/start.js) and sends whichever of the three trial
 * emails each org is due: the welcome the signup path may have failed to
 * send, the three-days-left nudge, and the it-has-ended note. Every send is
 * claimed on the Organization row before it goes out, so this is safe to
 * retry and safe to run on more than one replica — see
 * services/trial-lifecycle.js for the claim.
 */

import { sweepTrialEmails } from '../services/trial-lifecycle.js';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('WORKER');

export async function lifecycleEmailProcessor(_job) {
  const tally = await sweepTrialEmails();
  logger.info(
    `Trial emails: welcome ${tally.welcome}, ending ${tally.ending}, expired ${tally.expired}, failed ${tally.failed}`
  );
  return tally;
}

export default lifecycleEmailProcessor;
