/**
 * Custom hook for managing Amazon Ads profile selection
 * Handles profile list loading and active profile selection
 */
import { useState, useEffect } from 'react';
import { getProfiles } from '../services/api.js';

export function useProfileState() {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  // Load profiles on mount
  useEffect(() => {
    getProfiles()
      .then(d => setProfiles(Array.isArray(d) ? d : []))
      .catch(() => setProfiles([]));
  }, []);

  // Find selected profile object
  const selectedProfile = profiles.find(p => String(p.profileId) === String(selectedProfileId));

  return {
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
  };
}
