/**
 * Structured logging utility with correlation IDs
 * Enables tracing requests through the system for debugging
 */

import { randomUUID } from 'crypto';

// Store correlation ID in context (using WeakMap for thread safety if needed)
const contextStack = new Map();

/**
 * Generate a correlation ID for request tracking
 */
export function generateCorrelationId() {
  return randomUUID();
}

/**
 * Set correlation ID for current context
 */
export function setCorrelationId(correlationId) {
  contextStack.set(Symbol.for('correlationId'), correlationId);
}

/**
 * Get current correlation ID
 */
export function getCorrelationId() {
  return contextStack.get(Symbol.for('correlationId')) || 'NO-ID';
}

/**
 * Express middleware to add correlation ID to all requests
 */
export function correlationIdMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || generateCorrelationId();
  setCorrelationId(correlationId);
  res.setHeader('X-Correlation-ID', correlationId);
  next();
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
