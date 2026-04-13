/**
 * Custom hook for managing date range selection with constraints
 * Enforces maximum 31-day range per Amazon Ads API limits
 */
import { useState } from 'react';
import { getTodayISO, getDaysAgoISO } from '../utils/date-helpers.js';

/**
 * @typedef {Object} DateRangeState
 * @property {string} dateFrom - Start date (ISO 8601: YYYY-MM-DD)
 * @property {string} dateTo - End date (ISO 8601: YYYY-MM-DD)
 * @property {string} today - Today's date (ISO 8601)
 * @property {string} thirtyDaysAgo - 30 days ago (ISO 8601)
 * @property {Function} handleDateFromChange - Update start date with validation
 * @property {Function} handleDateToChange - Update end date with validation
 */

/**
 * Manage date range with 31-day maximum window enforcement
 * Automatically adjusts opposite date if range exceeds 31 days
 * Default range: last 30 days to today
 *
 * @returns {DateRangeState} Date range state and handlers
 */
export function useDateRangeState() {
  const today = getTodayISO();
  const thirtyDaysAgo = getDaysAgoISO(30);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);

  /**
   * Update start date and enforce 31-day max window
   * If dateTo becomes > 31 days after new dateFrom, dateTo is capped
   * @param {string} val - New start date (YYYY-MM-DD)
   */
  function handleDateFromChange(val) {
    setDateFrom(val);
    const maxTo = new Date(new Date(val).getTime() + 31 * 86400000).toISOString().slice(0, 10);
    if (dateTo > maxTo) setDateTo(maxTo);
  }

  /**
   * Update end date and enforce 31-day max window
   * If dateFrom becomes < 31 days before new dateTo, dateFrom is adjusted
   * @param {string} val - New end date (YYYY-MM-DD)
   */
  function handleDateToChange(val) {
    setDateTo(val);
    const minFrom = new Date(new Date(val).getTime() - 31 * 86400000).toISOString().slice(0, 10);
    if (dateFrom < minFrom) setDateFrom(minFrom);
  }

  return {
    dateFrom,
    dateTo,
    today,
    thirtyDaysAgo,
    handleDateFromChange,
    handleDateToChange,
  };
}
