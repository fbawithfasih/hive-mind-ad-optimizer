import { useState, useEffect, useMemo } from 'react';
import { getProfiles } from '../services/api.js';

// All profiles returned by GET /api/profiles are already scoped to the current
// org by tenancy — the seller's OAuth token can only return their own profiles
// across NA/EU/FE. No further name-based filtering is needed.
export function useProfileState() {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  useEffect(() => {
    getProfiles()
      .then(d => {
        const list = Array.isArray(d) ? d : [];
        setProfiles(list);
        if (list.length === 0) return;

        // Default preference: US > any explicitly marked default > first entry
        const us        = list.find(p => p.countryCode === 'US');
        const defaulted = list.find(p => p.isDefault);
        setSelectedProfileId(String((us ?? defaulted ?? list[0]).profileId));
      })
      .catch(() => setProfiles([]));
  }, []);

  // Group profiles by their seller account.
  // Priority: accountId (post-resync) → accountName → profileName
  const profilesByAccount = useMemo(() => {
    const groups = {};
    profiles.forEach(p => {
      const key   = p.accountId   ?? p.accountName ?? p.profileName ?? 'default';
      const label = p.accountName ?? p.profileName ?? 'My Account';
      if (!groups[key]) groups[key] = { label, profiles: [] };
      groups[key].profiles.push(p);
    });
    Object.values(groups).forEach(g => {
      g.profiles.sort((a, b) => {
        if (a.countryCode === 'US') return -1;
        if (b.countryCode === 'US') return 1;
        return (a.countryCode ?? '').localeCompare(b.countryCode ?? '');
      });
    });
    return groups;
  }, [profiles]);

  const selectedProfile = profiles.find(p => String(p.profileId) === String(selectedProfileId));

  return {
    profiles,                                  // flat list
    profilesByAccount,                         // grouped by seller account
    primaryAccountProfiles: profiles,          // back-compat alias
    primaryAccountGroups:   profilesByAccount, // back-compat alias
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
    nameMatchFailed: false,                    // back-compat: filter removed
  };
}
