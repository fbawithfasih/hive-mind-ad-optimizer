import { useState, useEffect, useMemo } from 'react';
import { getProfiles } from '../services/api.js';

// orgName: the current org's name (e.g. "Queenzaonline") used to match profiles
export function useProfileState(orgName) {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  useEffect(() => {
    getProfiles()
      .then(d => {
        const list = Array.isArray(d) ? d : [];
        setProfiles(list);
        if (list.length === 0) return;

        // Determine primary group: org-name match takes priority over isDefault
        const primary = getPrimaryGroup(list, orgName);
        const us = primary.find(p => p.countryCode === 'US');
        setSelectedProfileId(String((us ?? primary[0]).profileId));
      })
      .catch(() => setProfiles([]));
  }, [orgName]);

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

  // Profiles shown in the dropdown = only the matched org account.
  const primaryAccountProfiles = useMemo(
    () => getPrimaryGroup(profiles, orgName),
    [profiles, orgName]
  );

  // Grouped version of primaryAccountProfiles for <optgroup> rendering
  const primaryAccountGroups = useMemo(() => {
    const groups = {};
    primaryAccountProfiles.forEach(p => {
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
  }, [primaryAccountProfiles]);

  const selectedProfile = profiles.find(p => String(p.profileId) === String(selectedProfileId));

  // True when name matching successfully narrowed to a subset of profiles.
  // False means all profiles are shown (name mismatch) — admin should re-sync or set default.
  const nameMatchFailed = useMemo(
    () => profiles.length > 0 && primaryAccountProfiles.length === profiles.length && Object.keys(profilesByAccount).length > 1,
    [profiles, primaryAccountProfiles, profilesByAccount]
  );

  return {
    profiles,               // all profiles (used by ProfilesPanel for management)
    profilesByAccount,      // all profiles grouped (used by ProfilesPanel)
    primaryAccountProfiles, // only the org's own account profiles (used by campaign dropdown)
    primaryAccountGroups,   // grouped version for <optgroup>
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
    nameMatchFailed,        // true if name filter returned all profiles (fallback mode)
  };
}

/**
 * Determine which profiles to show for this org.
 *
 * Priority:
 *  1. Exact case-insensitive match of orgName to accountName/profileName
 *  2. Substring / word match (handles slight name differences)
 *  3. All profiles as last resort — admin can set default via Profiles panel
 *
 * NOTE: isDefault is no longer used for group selection because it can point
 * to the wrong seller account when agency-level credentials returned multiple
 * clients' profiles during the last sync.
 */
/**
 * After finding a name match, expand the result to include all profiles that
 * share the same accountId as any matched profile. This ensures that CA/MX
 * marketplace profiles (which may have a null/numeric accountName) are always
 * returned alongside the US profile that name-matched, since they all belong
 * to the same seller account.
 */
function expandToAccount(matched, all) {
  const accountIds = new Set(matched.map(p => p.accountId).filter(Boolean));
  if (!accountIds.size) return matched;
  return all.filter(p => p.accountId && accountIds.has(p.accountId));
}

function getPrimaryGroup(list, orgName) {
  if (!list.length) return [];

  const normalize = s => (s ?? '').toLowerCase().trim();
  const orgKey = normalize(orgName);

  if (orgKey) {
    // 1. Exact match
    const exact = list.filter(p => {
      const name = normalize(p.accountName ?? p.profileName);
      return name === orgKey;
    });
    if (exact.length) return expandToAccount(exact, list);

    // 2. Substring match (e.g. org "Queenza" ↔ profile "Queenzaonline" or vice-versa)
    const partial = list.filter(p => {
      const name = normalize(p.accountName ?? p.profileName);
      return name.includes(orgKey) || orgKey.includes(name);
    });
    if (partial.length) return expandToAccount(partial, list);

    // 3. Word-level match: any significant word in orgKey appears in the profile name
    const orgWords = orgKey.split(/[\s_\-]+/).filter(w => w.length > 3);
    if (orgWords.length) {
      const wordMatch = list.filter(p => {
        const name = normalize(p.accountName ?? p.profileName);
        return orgWords.some(word => name.includes(word));
      });
      if (wordMatch.length) return expandToAccount(wordMatch, list);
    }
  }

  // 4. Fall back to ALL profiles so the admin can at least see and select the right one.
  //    (Do NOT use isDefault to pick a sub-group — it may point to a different seller account.)
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[useProfileState] No name match for orgName:', orgName,
      '— available profile names:', list.map(p => p.accountName ?? p.profileName)
    );
  }
  return list;
}
