/**
 * Custom hook for managing date range selection
 * Enforces max 31-day range and provides date utilities
 */
import { useState } from 'react';
import { getTodayISO, getDaysAgoISO } from '../utils/date-helpers.js';

export function useDateRangeState() {
  const today = getTodayISO();
  const thirtyDaysAgo = getDaysAgoISO(30);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);

  // Enforce max 31-day range when start date changes
  function handleDateFromChange(val) {
    setDateFrom(val);
    const maxTo = new Date(new Date(val).getTime() + 31 * 86400000).toISOString().slice(0, 10);
    if (dateTo > maxTo) setDateTo(maxTo);
  }

  // Enforce max 31-day range when end date changes
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
