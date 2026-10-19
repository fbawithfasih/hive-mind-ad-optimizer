/**
 * Keep a lost stdout/stderr from taking the process down.
 *
 * Node reports a failed write to stdio as an 'error' event on the stream, and
 * an 'error' event with no listener is thrown. Nothing in the app listens, so
 * one log line written after the terminal or pipe went away (EIO, EPIPE)
 * became an uncaught exception — and posthog-node's exception autocapture
 * answers an uncaught exception with process.exit(1), taking any BullMQ job
 * in flight with it.
 *
 * Only those two codes are swallowed: they mean the reader is gone, and there
 * is nowhere left to log to. Anything else is rethrown, which is exactly what
 * Node would have done with no listener.
 */
const READER_GONE = new Set(['EIO', 'EPIPE']);

export function ignoreLostStdio(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) {
    stream.on('error', (err) => {
      if (!READER_GONE.has(err?.code)) throw err;
    });
  }
}
