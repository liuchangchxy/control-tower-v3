import type { ProfileSummary } from '../types';

export type ProfilesView = 'cards' | 'list';

export const PROFILES_VIEW_STORAGE_KEY = 'control-tower:profiles-view:v1';

export function readProfilesView(storage: Pick<Storage, 'getItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage): ProfilesView {
  try {
    const value = storage?.getItem(PROFILES_VIEW_STORAGE_KEY);
    return value === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

export function writeProfilesView(view: ProfilesView, storage: Pick<Storage, 'setItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage): void {
  try {
    storage?.setItem(PROFILES_VIEW_STORAGE_KEY, view);
  } catch {
    // Preferences are optional; private browsing and blocked storage are valid.
  }
}

export interface ProfileGroup {
  key: string;
  profiles: ProfileSummary[];
}

function groupName(profile: ProfileSummary): string {
  return profile.fields.PROFILE_GROUP?.trim() || (profile.name.includes('/') ? profile.name.split('/')[0] : 'Ungrouped');
}

export function groupProfiles(profiles: ProfileSummary[]): ProfileGroup[] {
  const groups = new Map<string, ProfileSummary[]>();
  for (const profile of profiles) {
    const key = groupName(profile);
    const entries = groups.get(key) ?? [];
    entries.push(profile);
    groups.set(key, entries);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entries]) => ({
      key,
      profiles: entries.sort((left, right) => left.name.localeCompare(right.name)),
    }));
}
