/**
 * Shared formatting utilities for components
 * Eliminates duplicate formatting logic across the app
 */

/**
 * Format number with K/M/B suffix for readability
 * @param {number} num - Number to format
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted number (e.g., "1.2K", "3M")
 */
export function fmtN(num, decimals = 1) {
  if (num === null || num === undefined) return '—';
  if (num >= 1000000000) {
    return (num / 1000000000).toFixed(decimals) + 'B';
  }
  if (num >= 1000000) {
    return (num / 1000000).toFixed(decimals) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(decimals) + 'K';
  }
  return num.toString();
}

/**
 * Format currency value (default USD)
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code (default: USD)
 * @returns {string} Formatted currency (e.g., "$1,234.56")
 */
export function fmtCurrency(amount, currency = 'USD') {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Format percentage value
 * @param {number} value - Decimal value (0-1)
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted percentage (e.g., "12.5%")
 */
export function fmtPercent(value, decimals = 1) {
  if (value === null || value === undefined) return '—';
  return (value * 100).toFixed(decimals) + '%';
}

/**
 * Get Tailwind text color class for campaign status
 * @param {string} status - Campaign status (enabled, paused, archived)
 * @returns {string} Tailwind color class (e.g., "text-green-600")
 */
export function getStatusColor(status) {
  switch (status?.toLowerCase()) {
    case 'enabled':
      return 'text-green-600';
    case 'paused':
      return 'text-yellow-600';
    case 'archived':
      return 'text-gray-500';
    default:
      return 'text-gray-600';
  }
}

/**
 * Get Tailwind background color class for campaign status
 * @param {string} status - Campaign status (enabled, paused, archived)
 * @returns {string} Tailwind bg class (e.g., "bg-green-100")
 */
export function getStatusBgColor(status) {
  switch (status?.toLowerCase()) {
    case 'enabled':
      return 'bg-green-100';
    case 'paused':
      return 'bg-yellow-100';
    case 'archived':
      return 'bg-gray-100';
    default:
      return 'bg-gray-100';
  }
}

/**
 * Format status for display
 * @param {string} status - Status value
 * @returns {string} Capitalized status (e.g., "Enabled")
 */
export function formatStatus(status) {
  if (!status) return '—';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

/**
 * Get Tailwind badge class for recommendation type
 * @param {string} recommendation - Recommendation type (SCALE_UP, ADD_NEGATIVE, ADD_EXACT, WATCH)
 * @returns {string} Tailwind class (e.g., "bg-blue-100 text-blue-800")
 */
export function getRecommendationBadgeClass(recommendation) {
  switch (recommendation) {
    case 'SCALE_UP':
      return 'bg-green-100 text-green-800';
    case 'ADD_NEGATIVE':
      return 'bg-red-100 text-red-800';
    case 'ADD_EXACT':
      return 'bg-blue-100 text-blue-800';
    case 'WATCH':
      return 'bg-amber-100 text-amber-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

/**
 * Get recommendation emoji
 * @param {string} recommendation - Recommendation type
 * @returns {string} Emoji representation
 */
export function getRecommendationEmoji(recommendation) {
  switch (recommendation) {
    case 'SCALE_UP':
      return '📈';
    case 'ADD_NEGATIVE':
      return '❌';
    case 'ADD_EXACT':
      return '✅';
    case 'WATCH':
      return '👁️';
    default:
      return '❓';
  }
}

/**
 * Get recommendation description
 * @param {string} recommendation - Recommendation type
 * @returns {string} Human-readable description
 */
export function getRecommendationDescription(recommendation) {
  switch (recommendation) {
    case 'SCALE_UP':
      return 'Increase bid to capture more volume';
    case 'ADD_NEGATIVE':
      return 'Add as negative keyword to reduce wasted spend';
    case 'ADD_EXACT':
      return 'Add exact match keyword for better control';
    case 'WATCH':
      return 'Monitor performance before taking action';
    default:
      return 'Needs review';
  }
}

/**
 * Truncate string to max length with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
export function truncate(str, maxLength = 50) {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Format time duration
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "2h 30m")
 */
export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Get color for CPC value (lower is better for PPC)
 * @param {number} cpc - Cost per click
 * @param {number} avgCpc - Average CPC for comparison
 * @returns {string} Tailwind color class
 */
export function getCpcColor(cpc, avgCpc) {
  if (!cpc || !avgCpc) return 'text-gray-600';

  if (cpc < avgCpc * 0.8) return 'text-green-600';
  if (cpc < avgCpc * 1.2) return 'text-blue-600';
  return 'text-red-600';
}
