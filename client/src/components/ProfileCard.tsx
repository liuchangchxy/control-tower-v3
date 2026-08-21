import { Link } from 'react-router-dom';
import { Card } from './common/Card';
import { Badge } from './common/Badge';
import type { ProfileSummary } from '../types';

interface Props {
  profile: ProfileSummary;
  onDelete: () => void;
}

export function ProfileCard({ profile, onDelete }: Props) {
  const f = profile.fields;
  return (
    <Card className="hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="font-mono text-sm text-text-primary break-all flex-1 mr-2">{profile.name}</div>
        {profile.writable ? (
          <Badge tone="success">writable</Badge>
        ) : (
          <Badge tone="neutral">read-only</Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {f.SERVED_NAME && <Badge tone="info">{f.SERVED_NAME}</Badge>}
        {f.MODEL_VARIANT && <Badge tone="neutral">{f.MODEL_VARIANT}</Badge>}
        {f.MAX_MODEL_LEN && <Badge tone="neutral">{f.MAX_MODEL_LEN}</Badge>}
        {f.GPU_UTIL && <Badge tone="warning">GPU {(Number(f.GPU_UTIL) * 100).toFixed(0)}%</Badge>}
        {f.MTP_K !== undefined && Number(f.MTP_K) > 0 && <Badge tone="info">MTP×{f.MTP_K}</Badge>}
      </div>

      <div className="flex gap-2">
        {profile.writable && (
          <Link
            to={`/profiles/${encodeURIComponent(profile.name)}/edit`}
            className="text-xs text-accent hover:underline"
          >
            Edit
          </Link>
        )}
        {profile.writable && (
          <button
            onClick={onDelete}
            className="text-xs text-red-400 hover:underline"
          >
            Delete
          </button>
        )}
      </div>
    </Card>
  );
}
