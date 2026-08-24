import { describe, expect, it } from 'vitest';
import { groupProfiles, readProfilesView, writeProfilesView } from '../client/src/utils/profileViews';
import type { ProfileSummary } from '../shared/types';

const profile = (name: string, group?: string): ProfileSummary => ({
  name,
  path: `/profiles/${name}`,
  writable: false,
  fields: {
    SERVED_NAME: name,
    MODEL_FAMILY: 'qwen',
    MODEL_VARIANT: 'fp8',
    PROFILE_GROUP: group,
  },
});

describe('profile view helpers', () => {
  it('groups by profile group and sorts groups and profiles', () => {
    const groups = groupProfiles([
      profile('z.env', 'beta'),
      profile('a.env', 'alpha'),
      profile('b.env', 'alpha'),
      profile('ungrouped.env'),
    ]);

    expect(groups.map(group => group.key)).toEqual(['alpha', 'beta', 'Ungrouped']);
    expect(groups[0].profiles.map(item => item.name)).toEqual(['a.env', 'b.env']);
  });

  it('falls back to the cards view for invalid or unavailable storage', () => {
    expect(readProfilesView({ getItem: () => 'invalid' })).toBe('cards');
    expect(readProfilesView({ getItem: () => { throw new Error('blocked'); } })).toBe('cards');
  });

  it('persists the selected view without making storage mandatory', () => {
    let saved = '';
    writeProfilesView('list', { setItem: (_key, value) => { saved = value; } });
    expect(saved).toBe('list');
    expect(() => writeProfilesView('cards', { setItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });
});
