/**
 * Custom hook for managing campaign search and filtering
 * Handles filtering by status and search term with computed stats
 */
import { useState, useMemo, useEffect } from 'react';
import { getCampaigns } from '../services/api.js';

export function useCampaignFiltering(selectedProfileId) {
  const [campaigns, setCampaigns] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load campaigns when profile changes
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

  // Calculate campaign stats
  const stats = useMemo(() => {
    const enabled = campaigns.filter(c => ['enabled', 'active'].includes(c.status)).length;
    const paused = campaigns.filter(c => c.status === 'paused').length;
    const archived = campaigns.filter(c => ['ended', 'archived'].includes(c.status)).length;
    const budget = campaigns.reduce((s, c) => s + (c.budget ?? 0), 0);
    return { total: campaigns.length, enabled, paused, archived, budget };
  }, [campaigns]);

  // Filter campaigns by search term and status
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
