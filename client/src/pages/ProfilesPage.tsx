import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useProfiles, useProfile, useDeleteProfile } from '../hooks/useProfiles';
import { ProfileCard } from '../components/ProfileCard';
import { ProfileList } from '../components/ProfileList';
import { ProfileDiff } from '../components/ProfileDiff';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import type { ProfileSummary } from '../types';
import type { ProfilesView } from '../utils/profileViews';
import { groupProfiles, readProfilesView, writeProfilesView } from '../utils/profileViews';

export function ProfilesPage() {
  const navigate = useNavigate();
  const { data: profiles, isLoading } = useProfiles();
  const del = useDeleteProfile();
  const [view, setView] = useState<ProfilesView>(() => readProfilesView());

  // Diff state
  const [diffPair, setDiffPair] = useState<[string, string] | null>(null);
  const [leftPath, rightPath] = diffPair ?? [null, null];
  const { data: leftConfig, error: leftError } = useProfile(leftPath);
  const { data: rightConfig, error: rightError } = useProfile(rightPath);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);

  useEffect(() => {
    writeProfilesView(view);
  }, [view]);

  const toggleCompare = (path: string) => {
    setSelectedForCompare(prev => {
      if (prev.includes(path)) return prev.filter(p => p !== path);
      if (prev.length >= 2) return [prev[1], path];
      return [...prev, path];
    });
  };

  const handleCompare = () => {
    if (selectedForCompare.length === 2) setDiffPair([selectedForCompare[0], selectedForCompare[1]]);
  };

  const writableProfiles = profiles?.filter(p => p.writable) ?? [];
  const groups = groupProfiles(profiles ?? []);

  const renderProfile = (profile: ProfileSummary) => {
    const onDelete = () => {
      if (confirm(`Delete ${profile.name}?`)) del.mutate(profile.path);
    };
    const onClone = () => navigate(`/profiles/new?source=${encodeURIComponent(profile.name)}`);
    const onToggleCompare = () => toggleCompare(profile.path);
    const props = {
      profile,
      onDelete,
      onClone,
      compareMode,
      selected: selectedForCompare.includes(profile.path),
      onToggleCompare,
    };
    return view === 'cards' ? <ProfileCard {...props} /> : <ProfileList {...props} />;
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Profiles</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-bg-secondary p-0.5" aria-label="Profile view">
            <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')} className={`px-3 py-1 text-xs rounded-md transition-colors ${view === 'cards' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}>Cards</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`px-3 py-1 text-xs rounded-md transition-colors ${view === 'list' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}>List</button>
          </div>
          {writableProfiles.length >= 2 && (
            <Button variant={compareMode ? 'secondary' : 'ghost'} size="sm" onClick={() => { setCompareMode(!compareMode); setSelectedForCompare([]); }}>
              {compareMode ? 'Cancel Compare' : 'Compare'}
            </Button>
          )}
          <Link to="/profiles/new"><Button variant="primary">+ New Profile</Button></Link>
        </div>
      </div>

      {compareMode && (
        <div className="bg-bg-secondary border border-accent/50 rounded-lg px-4 py-2 text-sm text-text-secondary">
          Select 2 writable profiles to compare
          {selectedForCompare.length > 0 && <span className="ml-2 text-accent">{selectedForCompare.length}/2 selected</span>}
          {selectedForCompare.length === 2 && <Button variant="primary" size="sm" className="ml-3" onClick={handleCompare}>Show Diff</Button>}
        </div>
      )}

      {isLoading && <div className="text-text-muted">Loading...</div>}

      <div className="space-y-6">
        {groups.map(group => (
          <section key={group.key} aria-labelledby={`profile-group-${group.key}`}>
            <div className="flex items-baseline gap-2 mb-2">
              <h2 id={`profile-group-${group.key}`} className="text-sm font-semibold text-text-primary">{group.key}</h2>
              <span className="text-xs text-text-muted">{group.profiles.length}</span>
            </div>
            <div className={view === 'cards' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3' : 'space-y-2'}>
              {group.profiles.map(profile => <div key={profile.name}>{renderProfile(profile)}</div>)}
            </div>
          </section>
        ))}
      </div>

      <Modal open={diffPair !== null && leftConfig !== undefined && rightConfig !== undefined} onClose={() => setDiffPair(null)}>
        {leftConfig && rightConfig ? (
          <ProfileDiff oldConfig={leftConfig} newConfig={rightConfig} onClose={() => setDiffPair(null)} />
        ) : diffPair !== null && (leftError || rightError) ? (
          <div className="p-4 text-center">
            <div className="text-red-400 text-sm mb-2">Failed to load profile for comparison.</div>
            {leftError && <div className="text-red-300 text-xs mb-1">Left: {(leftError as Error).message}</div>}
            {rightError && <div className="text-red-300 text-xs mb-1">Right: {(rightError as Error).message}</div>}
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setDiffPair(null)}>Close</Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
