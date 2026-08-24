import { Link } from 'react-router-dom';
import { Card } from './common/Card';
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

export function ProfileCard({ profile, onDelete, onClone, compareMode = false, selected = false, onToggleCompare }: Props) {
  const f = profile.fields;
  return (
    <Card className="relative hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between mb-2">
        {compareMode && profile.writable && (
          <button
            type="button"
            aria-label={`Select ${profile.name} for comparison`}
            aria-pressed={selected}
            onClick={onToggleCompare}
            className={`absolute top-2 right-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${selected ? 'bg-accent border-accent text-white' : 'bg-bg-tertiary border-border text-transparent hover:border-border-hover'}`}
          >
            {selected && <span className="text-xs">&#10003;</span>}
          </button>
        )}
        <div className="font-mono text-sm text-text-primary break-all flex-1 mr-2">{profile.name}</div>
        {profile.writable ? <Badge tone="success">writable</Badge> : <Badge tone="neutral">read-only</Badge>}
      </div>

      <div className="mb-3 text-xs text-text-muted">
        {profile.writable
          ? 'Local user profile: editable experiment/override. It is not automatically equivalent to a repository preset.'
          : 'Repository profile: read-only canonical preset/template supplied by the runtime.'}
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {f.SERVED_NAME && <Badge tone="info">{f.SERVED_NAME}</Badge>}
        {f.MODEL_VARIANT && <Badge tone="neutral">{f.MODEL_VARIANT}</Badge>}
        {f.MAX_MODEL_LEN != null && <Badge tone="neutral">{f.MAX_MODEL_LEN}</Badge>}
        {f.GPU_UTIL != null && <Badge tone="warning">GPU {(Number(f.GPU_UTIL) * 100).toFixed(0)}%</Badge>}
        {f.MTP_K !== undefined && Number(f.MTP_K) > 0 && <Badge tone="info">MTP×{f.MTP_K}</Badge>}
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onClone} className="text-xs text-accent hover:underline">Clone</button>
        {profile.writable && <Link to={`/profiles/${encodeURIComponent(profile.name)}/edit`} className="text-xs text-accent hover:underline">Edit</Link>}
        {profile.writable && <button type="button" onClick={onDelete} className="text-xs text-red-400 hover:underline">Delete</button>}
      </div>
    </Card>
  );
}
