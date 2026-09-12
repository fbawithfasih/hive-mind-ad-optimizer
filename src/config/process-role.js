/**
 * What this process is for.
 *
 * One image, three shapes: `all` serves HTTP and runs the workers, `api`
 * serves only HTTP, `worker` runs only the workers. The default is `all`,
 * which is what a single-service deployment has always been.
 *
 * Separate from workers/start.js so that asking the question costs nothing.
 * The readiness probe reports the role, and it runs in both processes —
 * importing start.js to find out would pull every worker processor, and with
 * them BullMQ and the whole queue layer, into a process that may have been
 * started precisely to avoid them.
 */

const ROLES = new Set(['all', 'api', 'worker']);

/** @returns {'all'|'api'|'worker'} */
export function processRole() {
  const role = process.env.PROCESS_ROLE;
  return ROLES.has(role) ? role : 'all';
}

/** Whether this process should run background workers. */
export function shouldRunWorkers() {
  return processRole() !== 'api';
}

/** Whether this process should serve HTTP traffic. */
export function shouldServeHttp() {
  return processRole() !== 'worker';
}
