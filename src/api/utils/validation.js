/**
 * Input validation utilities for API requests
 */

/**
 * Validates that a date string is in valid ISO format (YYYY-MM-DD)
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidDateFormat(dateStr) {
  if (typeof dateStr !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Validates a date range
 * @param {string} startDate - ISO format (YYYY-MM-DD)
 * @param {string} endDate - ISO format (YYYY-MM-DD)
 * @returns {{valid: boolean, error?: string}}
 */
export function isValidDateRange(startDate, endDate) {
  if (!isValidDateFormat(startDate)) {
    return { valid: false, error: 'startDate must be in YYYY-MM-DD format' };
  }
  if (!isValidDateFormat(endDate)) {
    return { valid: false, error: 'endDate must be in YYYY-MM-DD format' };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start > end) {
    return { valid: false, error: 'startDate must be before endDate' };
  }

  return { valid: true };
}

/**
 * Validates that a string is a non-empty trimmed value
 * @param {string} value
 * @param {string} fieldName
 * @returns {{valid: boolean, error?: string}}
 */
export function isValidString(value, fieldName = 'field') {
  if (typeof value !== 'string' || value.trim() === '') {
    return { valid: false, error: `${fieldName} must be a non-empty string` };
  }
  return { valid: true };
}

/**
 * Validates that a value is a positive integer
 * @param {*} value
 * @param {string} fieldName
 * @returns {{valid: boolean, error?: string}}
 */
export function isValidPositiveInt(value, fieldName = 'field') {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    return { valid: false, error: `${fieldName} must be a positive integer` };
  }
  return { valid: true };
}

/**
 * Validates Amazon ASIN format (10 alphanumeric characters)
 * @param {string} asin
 * @returns {{valid: boolean, error?: string}}
 */
export function isValidASIN(asin) {
  if (typeof asin !== 'string' || !/^[A-Z0-9]{10}$/.test(asin)) {
    return { valid: false, error: 'ASIN must be 10 alphanumeric characters' };
  }
  return { valid: true };
}

/**
 * Validates that a value exists and is not null/undefined
 * @param {*} value
 * @param {string} fieldName
 * @returns {{valid: boolean, error?: string}}
 */
export function isRequired(value, fieldName = 'field') {
  if (value === null || value === undefined || value === '') {
    return { valid: false, error: `${fieldName} is required` };
  }
  return { valid: true };
}
