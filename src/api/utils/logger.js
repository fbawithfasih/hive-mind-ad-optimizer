/**
 * Structured logging utility with correlation IDs
 * Enables tracing requests through the system for debugging
 */

import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Correlation IDs are per-request, and the only way to get that right in Node is
 * AsyncLocalStorage.
 *
 * This was previously a module-level Map with one fixed key, i.e. a single global
 * slot. Every concurrent request overwrote it, so any log line emitted after an
 * `await` carried whichever request had most recently entered the middleware.
 * Under load the IDs were not merely missing — they were confidently wrong,
 * which is worse: tracing a bug leads you into another request's work.
 *
 * Same mechanism the tenant context already uses correctly (see db/tenant-context.js).
 */
const storage = new AsyncLocalStorage();

/**
 * Generate a correlation ID for request tracking
 */
export function generateCorrelationId() {
  return randomUUID();
}

/**
 * Run `fn` with a correlation ID bound to it and everything it awaits.
 *
 * fn is wrapped in an async awaiter for the same reason runWithTenant does it:
 * a lazily-executed promise returned from a synchronous `storage.run` would
 * otherwise resolve after the scope is gone.
 *
 * @param {string} correlationId
 * @param {Function} fn
 */
export function runWithCorrelationId(correlationId, fn) {
  return storage.run({ correlationId }, async () => await fn());
}

/**
 * Get current correlation ID, or 'NO-ID' outside any correlated scope.
 */
export function getCorrelationId() {
  return storage.getStore()?.correlationId ?? 'NO-ID';
}

/**
 * Express middleware to add correlation ID to all requests
 */
export function correlationIdMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || generateCorrelationId();
  res.setHeader('X-Correlation-ID', correlationId);
  // storage.run rather than a bare next(): everything downstream — including
  // work that resumes after an await — inherits this id, and nothing leaks into
  // a concurrent request.
  storage.run({ correlationId }, next);
}

/**
 * Structured logger with correlation ID support
 */
class StructuredLogger {
  constructor(namespace = 'APP') {
    this.namespace = namespace;
  }

  _format(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const correlationId = getCorrelationId();
    return {
      timestamp,
      level,
      namespace: this.namespace,
      correlationId,
      message,
      ...data,
    };
  }

  _output(level, message, data = {}) {
    const logEntry = this._format(level, message, data);
    const output = JSON.stringify(logEntry);

    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  info(message, data = {}) {
    this._output('info', message, data);
  }

  warn(message, data = {}) {
    this._output('warn', message, data);
  }

  error(message, error = null, data = {}) {
    const errorData = error ? {
      errorMessage: error.message,
      errorCode: error.code,
      errorStack: error.stack,
    } : {};
    this._output('error', message, { ...data, ...errorData });
  }

  debug(message, data = {}) {
    if (process.env.DEBUG) {
      this._output('debug', message, data);
    }
  }
}

/**
 * Create a logger instance for a specific namespace
 */
export function createLogger(namespace = 'APP') {
  return new StructuredLogger(namespace);
}

// Export default logger
export default createLogger('APP');
