/**
 * Date utility functions to eliminate duplicate calculations
 */

// Common date offsets in milliseconds
export const RETENTION_DAYS_MS = 60 * 86400000; // 60 days
export const DEFAULT_LOOKBACK_DAYS_MS = 30 * 86400000; // 30 days
export const MAX_RANGE_DAYS = 31; // Amazon API limit

/**
 * Get today's date in YYYY-MM-DD format
 */
export function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get a date N days ago in YYYY-MM-DD format
 */
export function getDaysAgoISO(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

/**
 * Get default date range (last 30 days)
 */
export function getDefaultDateRange() {
  const endDate = getTodayISO();
  const startDate = getDaysAgoISO(30);
  return { startDate, endDate };
}

/**
 * Get the oldest allowed date (60 days ago - Amazon retention limit)
 */
export function getOldestAllowedDate() {
  return getDaysAgoISO(60);
}

/**
 * Calculate difference in days between two dates
 */
export function getDaysDifference(startDateISO, endDateISO) {
  return (new Date(endDateISO) - new Date(startDateISO)) / 86400000;
}
