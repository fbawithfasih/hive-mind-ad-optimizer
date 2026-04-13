/**
 * Date utility functions for frontend components
 * Eliminates duplicate date calculation code across components
 */

/**
 * Get today's date in YYYY-MM-DD format
 * @returns {string} Today's date in ISO format
 */
export function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get a date N days ago in YYYY-MM-DD format
 * @param {number} daysAgo - Number of days in the past
 * @returns {string} Date in ISO format
 */
export function getDaysAgoISO(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

/**
 * Get default date range (last 30 days)
 * @returns {Object} {startDate, endDate} both in YYYY-MM-DD format
 */
export function getDefaultDateRange() {
  return {
    endDate: getTodayISO(),
    startDate: getDaysAgoISO(30),
  };
}

/**
 * Get the oldest allowed date (60 days ago - Amazon retention limit)
 * @returns {string} Date in ISO format
 */
export function getOldestAllowedDate() {
  return getDaysAgoISO(60);
}

/**
 * Calculate difference in days between two dates
 * @param {string} startDateISO - Start date in YYYY-MM-DD format
 * @param {string} endDateISO - End date in YYYY-MM-DD format
 * @returns {number} Number of days difference
 */
export function getDaysDifference(startDateISO, endDateISO) {
  return (new Date(endDateISO) - new Date(startDateISO)) / 86400000;
}

/**
 * Format a date range for display
 * @param {string} startDateISO - Start date in YYYY-MM-DD format
 * @param {string} endDateISO - End date in YYYY-MM-DD format
 * @returns {string} Formatted range like "Jan 1 - Jan 31, 2024"
 */
export function formatDateRange(startDateISO, endDateISO) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const startDate = new Date(startDateISO);
  const endDate = new Date(endDateISO);

  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

/**
 * Validate that a date range is valid
 * @param {string} startDateISO - Start date in YYYY-MM-DD format
 * @param {string} endDateISO - End date in YYYY-MM-DD format
 * @returns {Object} {valid: boolean, error?: string}
 */
export function validateDateRange(startDateISO, endDateISO) {
  try {
    const startDate = new Date(startDateISO);
    const endDate = new Date(endDateISO);

    if (isNaN(startDate.getTime())) {
      return { valid: false, error: 'Invalid start date format' };
    }

    if (isNaN(endDate.getTime())) {
      return { valid: false, error: 'Invalid end date format' };
    }

    if (startDate > endDate) {
      return { valid: false, error: 'Start date must be before end date' };
    }

    const diffDays = getDaysDifference(startDateISO, endDateISO);
    if (diffDays > 31) {
      return {
        valid: false,
        error: `Date range too large (${Math.round(diffDays)} days). Maximum is 31 days.`,
      };
    }

    const sixtyDaysAgo = getOldestAllowedDate();
    if (startDateISO < sixtyDaysAgo) {
      return {
        valid: false,
        error: `Start date ${startDateISO} is too old. Amazon retains data for ~60 days.`,
      };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Parse date string in various formats
 * @param {string} dateStr - Date string to parse
 * @returns {string|null} Date in YYYY-MM-DD format, or null if invalid
 */
export function parseDate(dateStr) {
  if (!dateStr) return null;

  try {
    // Handle YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return dateStr;
      }
    }

    // Try parsing as date
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get date relative to today (e.g., "today", "yesterday", "5 days ago")
 * @param {string} dateISO - Date in YYYY-MM-DD format
 * @returns {string} Relative date description
 */
export function getRelativeDate(dateISO) {
  const today = getTodayISO();
  const diffDays = getDaysDifference(dateISO, today);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${Math.floor(diffDays)} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;

  return dateISO;
}
