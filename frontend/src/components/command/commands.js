export const NAV_COMMANDS = [
  { id: 'nav-overview',         tab: 'overview',         label: 'Overview',              icon: '⬡', hint: 'KPIs, charts & performance summary' },
  { id: 'nav-campaigns',        tab: 'campaigns',        label: 'Campaigns',             icon: '📊', hint: 'Manage and analyse ad campaigns' },
  { id: 'nav-search-terms',     tab: 'search-terms',     label: 'Search Terms',          icon: '🔍', hint: 'Search term performance analysis' },
  { id: 'nav-listings',         tab: 'listings',         label: 'Listing Optimizer',     icon: '✏️', hint: 'AI-powered listing optimization' },
  { id: 'nav-image-optimizer',  tab: 'image-optimizer',  label: 'Main Image Optimizer',  icon: '🖼️', hint: 'Optimize product main images' },
  { id: 'nav-listing-history',  tab: 'listing-history',  label: 'Optimization History',  icon: '🕓', hint: 'Past listing optimization runs' },
  { id: 'nav-bulk',             tab: 'bulk',             label: 'Bulk Optimizer',        icon: '⚡', hint: 'Bulk campaign bid & budget changes' },
  { id: 'nav-health',           tab: 'health',           label: 'Listing Health',        icon: '🩺', hint: 'Listing health scores & issues' },
  { id: 'nav-keywords',         tab: 'keywords',         label: 'Keyword Intelligence',  icon: '🎯', hint: 'Keyword recommendations & analysis' },
  { id: 'nav-reports',          tab: 'reports',          label: 'Reporting Agent',       icon: '📈', hint: 'AI-generated reports' },
  { id: 'nav-brand-analytics',  tab: 'brand-analytics',  label: 'Brand Analytics',       icon: '📡', hint: 'Brand health & competitor analysis' },
  { id: 'nav-automation',       tab: 'automation',       label: 'Automation Rules',      icon: '🤖', hint: 'Campaign automation rules' },
  { id: 'nav-alerts',           tab: 'alerts',           label: 'Campaign Alerts',       icon: '🔔', hint: 'Alerts and notifications' },
  { id: 'nav-amazon',           tab: 'amazon',           label: 'Amazon Account',        icon: '🔗', hint: 'Amazon connection settings' },
  { id: 'nav-profiles',         tab: 'profiles',         label: 'Profiles',              icon: '👤', hint: 'Advertising profiles' },
  { id: 'nav-team',             tab: 'team',             label: 'Team & Roles',          icon: '👥', hint: 'Team management and permissions' },
];

export const DATE_COMMANDS = [
  { id: 'date-l7',  label: 'Load Last 7 Days',   preset: 'L7',  icon: '📅' },
  { id: 'date-l30', label: 'Load Last 30 Days',  preset: 'L30', icon: '📅' },
  { id: 'date-mtd', label: 'Load Month to Date', preset: 'MTD', icon: '📅' },
  { id: 'date-ytd', label: 'Load Year to Date',  preset: 'YTD', icon: '📅' },
];

export const ACTION_COMMANDS = [
  { id: 'action-enable', label: 'Enable Selected Campaigns', action: 'enable', icon: '▶' },
  { id: 'action-pause',  label: 'Pause Selected Campaigns',  action: 'pause',  icon: '⏸' },
];
