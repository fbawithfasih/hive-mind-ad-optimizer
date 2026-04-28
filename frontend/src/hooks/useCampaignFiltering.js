/**
 * Custom hook for managing campaign search, filtering, and statistics
 * Handles campaign loading, caching, filtering by status/search, and stats aggregation
 */
import { useState, useMemo, useEffect } from 'react';
import { getCampaigns } from '../services/api.js';

/**
 * @typedef {Object} CampaignStats
 * @property {number} total - Total number of campaigns
 * @property {number} enabled - Number of active/enabled campaigns
 * @property {number} paused - Number of paused campaigns
 * @property {number} archived - Number of ended/archived campaigns
 * @property {number} budget - Sum of all campaign daily budgets
 */

/**
 * @typedef {Object} CampaignFilteringState
 * @property {Array} campaigns - Full list of campaigns for selected profile
 * @property {Function} setCampaigns - Update campaigns array
 * @property {string} search - Current search query
 * @property {Function} setSearch - Update search query
 * @property {string} statusFilter - Current status filter (all, enabled, paused, ended, archived)
 * @property {Function} setStatusFilter - Update status filter
 * @property {Array} filtered - Campaigns matching search and status filters
 * @property {CampaignStats} stats - Computed statistics for all campaigns
 * @property {boolean} isLoading - Whether campaigns are being loaded
 * @property {string|null} error - Error message if loading failed
 */

/**
 * Manage campaign filtering, searching, and statistics
 * Loads campaigns when profile changes, caches with 5-min TTL
 * Provides filtered results and computed stats with memoization
 *
 * @param {string|number} selectedProfileId - Selected Amazon Ads profile ID
 * @returns {CampaignFilteringState} Campaign state and filter controls
 */
export function useCampaignFiltering(selectedProfileId) {
  const [campaigns, setCampaigns] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load campaigns when profile ID changes
  useEffect(() => {
    setIsLoading(true);
    setError(null);
    getCampaigns(selectedProfileId || undefined)
      .then(d => {
        setCampaigns(Array.isArray(d) ? d : []);
        setIsLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setIsLoading(false);
      });
  }, [selectedProfileId]);

  // Calculate campaign statistics (memoized)
  const stats = useMemo(() => {
    const enabled = campaigns.filter(c => ['enabled', 'active'].includes(c.status)).length;
    const paused = campaigns.filter(c => c.status === 'paused').length;
    const archived = campaigns.filter(c => ['ended', 'archived'].includes(c.status)).length;
    const budget = campaigns
      .filter(c => ['enabled', 'active'].includes(c.status))
      .reduce((s, c) => s + (c.budget ?? 0), 0);
    return { total: campaigns.length, enabled, paused, archived, budget };
  }, [campaigns]);

  // Filter campaigns by search term and status (memoized)
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return campaigns.filter(c => {
      const matchSearch = !q || c.name.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || c.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [campaigns, search, statusFilter]);

  return {
    campaigns,
    setCampaigns,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    filtered,
    stats,
    isLoading,
    error,
  };
}
