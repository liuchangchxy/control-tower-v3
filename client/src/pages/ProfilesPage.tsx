import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProfiles, useProfile, useDeleteProfile } from '../hooks/useProfiles';
import { ProfileCard } from '../components/ProfileCard';
import { ProfileDiff } from '../components/ProfileDiff';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import type { ProfileConfig } from '../types';

export function ProfilesPage() {
  const { data: profiles, isLoading } = useProfiles();
  const del = useDeleteProfile();

  // Diff state
  const [diffPair, setDiffPair] = useState<[string, string] | null>(null);
  const [leftPath, rightPath] = diffPair ?? [null, null];
  const { data: leftConfig, error: leftError } = useProfile(leftPath);
  const { data: rightConfig, error: rightError } = useProfile(rightPath);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);

  const toggleCompare = (path: string) => {
    setSelectedForCompare(prev => {
      if (prev.includes(path)) return prev.filter(p => p !== path);
      if (prev.length >= 2) return [prev[1], path];
      return [...prev, path];
    });
  };

  const handleCompare = () => {
    if (selectedForCompare.length === 2) {
      setDiffPair([selectedForCompare[0], selectedForCompare[1]]);
    }
  };

  const writableProfiles = profiles?.filter(p => p.writable) ?? [];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Profiles</h1>
        <div className="flex items-center gap-2">
          {writableProfiles.length >= 2 && (
            <Button
              variant={compareMode ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setCompareMode(!compareMode);
                setSelectedForCompare([]);
              }}
            >
              {compareMode ? 'Cancel Compare' : 'Compare'}
            </Button>
          )}
          <Link to="/profiles/new">
            <Button variant="primary">+ New Profile</Button>
          </Link>
        </div>
      </div>

      {compareMode && (
        <div className="bg-bg-secondary border border-accent/50 rounded-lg px-4 py-2 text-sm text-text-secondary">
          Select 2 writable profiles to compare
          {selectedForCompare.length > 0 && (
            <span className="ml-2 text-accent">{selectedForCompare.length}/2 selected</span>
          )}
          {selectedForCompare.length === 2 && (
            <Button variant="primary" size="sm" className="ml-3" onClick={handleCompare}>
              Show Diff
            </Button>
          )}
        </div>
      )}

      {isLoading && <div className="text-text-muted">Loading...</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {profiles?.map(p => (
          <div key={p.name} className="relative">
            {compareMode && p.writable && (
              <button
                onClick={() => toggleCompare(p.path)}
                className={`absolute top-2 right-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  selectedForCompare.includes(p.path)
                    ? 'bg-accent border-accent text-white'
                    : 'bg-bg-tertiary border-border text-transparent hover:border-border-hover'
                }`}
              >
                {selectedForCompare.includes(p.path) && <span className="text-xs">&#10003;</span>}
              </button>
            )}
            <ProfileCard
              profile={p}
              onDelete={() => {
                if (confirm(`Delete ${p.name}?`)) {
                  del.mutate(p.path);
                }
              }}
            />
          </div>
        ))}
      </div>

      {/* Diff modal */}
      <Modal
        open={diffPair !== null && leftConfig !== undefined && rightConfig !== undefined}
        onClose={() => setDiffPair(null)}
      >
        {leftConfig && rightConfig ? (
          <ProfileDiff
            oldConfig={leftConfig}
            newConfig={rightConfig}
            onClose={() => setDiffPair(null)}
          />
        ) : diffPair !== null && (leftError || rightError) ? (
          <div className="p-4 text-center">
            <div className="text-red-400 text-sm mb-2">
              Failed to load profile for comparison.
            </div>
            {leftError && (
              <div className="text-red-300 text-xs mb-1">
                Left: {(leftError as Error).message}
              </div>
            )}
            {rightError && (
              <div className="text-red-300 text-xs mb-1">
                Right: {(rightError as Error).message}
              </div>
            )}
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setDiffPair(null)}>
              Close
            </Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
