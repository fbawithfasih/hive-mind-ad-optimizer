/**
 * The worker entrypoint must stay wired to the workers.
 *
 * src/worker.js exists so the API and the background jobs can be deployed as
 * two Railway services from one image. Nothing in the app imports it — the
 * platform does, by start command — so it is exactly the kind of file that
 * rots silently: a rename in workers/start.js, a refactor that drops the
 * call, and the worker service comes up healthy and runs nothing at all. It
 * would answer /ready, pass its healthcheck, and quietly process no jobs.
 *
 * Same failure shape as deploy-image-contents.test.js guards against, and
 * the same reason it is checked as text rather than by importing: importing
 * worker.js starts a server and connects to Redis.
 */
import fs from 'node:fs';

const source = fs.readFileSync('src/worker.js', 'utf8');
const pkg    = JSON.parse(fs.readFileSync('package.json', 'utf8'));

describe('src/worker.js', () => {
  it('imports and calls startWorkers', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bstartWorkers\b[^}]*\}\s*from\s*'\.\/workers\/start\.js'/);
    expect(source).toMatch(/startWorkers\s*\(/);
  });

  it('serves the readiness probe the platform healthchecks', () => {
    // A worker that cannot reach Postgres or Redis can do nothing, and must
    // not replace a working deployment either.
    expect(source).toMatch(/readinessHandler/);
    expect(source).toMatch(/['"]\/ready['"]/);
  });

  it('closes the workers before the queue on shutdown', () => {
    // Workers are what may still be mid-job, and they need the queue
    // connection to finish; closing the queue first strands them.
    const closeWorkers = source.indexOf('workers.close()');
    const closeQueue   = source.indexOf('closeQueue()');
    expect(closeWorkers).toBeGreaterThan(-1);
    expect(closeQueue).toBeGreaterThan(closeWorkers);
  });
});

describe('the start command that reaches it', () => {
  it('is a script, so the platform has one thing to point at', () => {
    expect(pkg.scripts['start:worker']).toMatch(/src\/worker\.js/);
  });

  it('preloads instrument.mjs, or the worker reports no errors to Sentry', () => {
    // The SDK patches http/express/pg at load time and sees nothing if the
    // app is imported first — the same reason the API start command does it.
    expect(pkg.scripts['start:worker']).toMatch(/--import \.\/instrument\.mjs/);
  });
});
