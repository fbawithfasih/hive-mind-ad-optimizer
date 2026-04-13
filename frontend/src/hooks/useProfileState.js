/**
 * Custom hook for managing Amazon Ads profile selection
 * Handles loading profiles on mount and tracking selected profile
 */
import { useState, useEffect } from 'react';
import { getProfiles } from '../services/api.js';

/**
 * @typedef {Object} ProfileState
 * @property {Array} profiles - List of accessible Amazon Ads profiles
 * @property {string|number} selectedProfileId - Currently selected profile ID
 * @property {Function} setSelectedProfileId - Update selected profile ID
 * @property {Object|undefined} selectedProfile - Full profile object of selected ID
 */

/**
 * Manage Amazon Ads profile selection with loading
 * @returns {ProfileState} Profile state and setter functions
 */
export function useProfileState() {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  // Load profiles on mount
  useEffect(() => {
    getProfiles()
      .then(d => setProfiles(Array.isArray(d) ? d : []))
      .catch(() => setProfiles([]));
  }, []);

  // Find selected profile object by matching profileId
  const selectedProfile = profiles.find(p => String(p.profileId) === String(selectedProfileId));

  return {
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
  };
}
