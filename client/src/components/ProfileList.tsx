import { Link } from 'react-router-dom';
import { Badge } from './common/Badge';
import type { ProfileSummary } from '../types';

interface Props {
  profile: ProfileSummary;
  onDelete: () => void;
  onClone: () => void;
  compareMode?: boolean;
  selected?: boolean;
  onToggleCompare?: () => void;
}

function ProfileMeta({ profile }: { profile: ProfileSummary }) {
  const f = profile.fields;
  return (
    <div className="flex flex-wrap gap-1">
      {f.SERVED_NAME && <Badge tone="info">{f.SERVED_NAME}</Badge>}
      {f.MODEL_VARIANT && <Badge tone="neutral">{f.MODEL_VARIANT}</Badge>}
      {f.MAX_MODEL_LEN != null && <Badge tone="neutral">{f.MAX_MODEL_LEN}</Badge>}
      {f.GPU_UTIL != null && <Badge tone="warning">GPU {(Number(f.GPU_UTIL) * 100).toFixed(0)}%</Badge>}
      {f.MTP_K !== undefined && Number(f.MTP_K) > 0 && <Badge tone="info">MTP×{f.MTP_K}</Badge>}
    </div>
  );
}

export function ProfileList({ profile, onDelete, onClone, compareMode = false, selected = false, onToggleCompare }: Props) {
  return (
    <div className="relative flex items-center gap-3 rounded-lg border border-border bg-bg-secondary px-4 py-3 hover:border-border-hover transition-colors">
      {compareMode && profile.writable && (
        <button
          type="button"
          aria-label={`Select ${profile.name} for comparison`}
          aria-pressed={selected}
          onClick={onToggleCompare}
          className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${selected ? 'bg-accent border-accent text-white' : 'bg-bg-tertiary border-border text-transparent hover:border-border-hover'}`}
        >
          {selected && <span className="text-xs">&#10003;</span>}
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="font-mono text-sm text-text-primary break-all">{profile.name}</span>
          <Badge tone={profile.writable ? 'success' : 'neutral'}>{profile.writable ? 'writable' : 'read-only'}</Badge>
        </div>
        <ProfileMeta profile={profile} />
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs">
        <button type="button" onClick={onClone} className="text-accent hover:underline">Clone</button>
        {profile.writable && (
          <Link to={`/profiles/${encodeURIComponent(profile.name)}/edit`} className="text-accent hover:underline">Edit</Link>
        )}
        {profile.writable && (
          <button type="button" onClick={onDelete} className="text-red-400 hover:underline">Delete</button>
        )}
      </div>
    </div>
  );
}
