/**
 * One HTTP server per test file, instead of one per request.
 *
 * ── The problem ──────────────────────────────────────────────────────────────
 *
 * supertest binds an ephemeral port for every `request(app)` where `app` is not
 * already listening, and closes it when the response arrives. This suite has 176
 * such call sites across 16 files, so a full run performs ~176 listen/close
 * cycles and leaves several hundred loopback sockets in TIME_WAIT — measured at
 * 331 after a single run, against an ephemeral range of 16,384 ports, with nine
 * Jest workers racing over the same range.
 *
 * Ports therefore get recycled while a connection is still in flight, and a
 * request occasionally lands on a server that is not the one it was addressed
 * to. That produced a flake in roughly one run in ten, always exactly one victim
 * and never the same test twice — ten different tests over ~150 runs, every one
 * of them an HTTP test, none of them ever failing under `--runInBand`:
 *
 *   Parse Error: Expected HTTP/, RTSP/ or ICE/     (the parser reading a socket
 *                                                   that carried no response)
 *   expected 400, received 401                     (a reply from another suite's
 *   expected 429, received 401                      router, whose auth this file
 *   expected 201, received 200                      had mocked out entirely)
 *   TypeError: Invalid URL                         (a `location` header that the
 *                                                   route always sets)
 *
 * None was a defect in the code under test. No route can answer 401 when its
 * requireAuth is stubbed to `next()`, and no application logic can produce a
 * malformed HTTP status line.
 *
 * ── The fix ──────────────────────────────────────────────────────────────────
 *
 * supertest only calls `listen(0)` when `app.address()` is null (see
 * supertest/lib/test.js `serverAddress`), and only closes a server it opened
 * itself. Hand it something already listening and it binds nothing, closes
 * nothing, and the churn disappears.
 *
 * One server per file is not enough on its own, because most factories here take
 * arguments — `makeApp(tenant)`, `app(middleware)`, `app(router, role)` — and
 * genuinely build a different app per test. So the server owns no app: its
 * handler delegates to whichever one the factory produced most recently. Call
 * sites stay exactly as they are.
 *
 * Safe because tests within a file run one at a time and each awaits its
 * response, so no two apps are ever current at once.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   const serve = sharedServer();
 *
 *   function makeApp(tenant) {
 *     const app = express();
 *     ...
 *     return serve(app);        // ← the only line that changes
 *   }
 */
import http from 'node:http';

/**
 * Register a per-file server and return the function that publishes an app on
 * it. Call at module scope: it registers beforeAll/afterAll hooks.
 *
 * @returns {(app: import('express').Express) => http.Server}
 */
export function sharedServer() {
  let server;
  let current;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (!current) {
        // A request with nothing published can only mean the file used the
        // server without going through the factory. Fail loudly rather than
        // hanging until the test times out.
        res.statusCode = 500;
        return res.end('sharedServer: no app published for this request');
      }
      return current(req, res);
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  });

  afterAll(async () => {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
  });

  return (app) => {
    current = app;
    return server;
  };
}

export default sharedServer;
