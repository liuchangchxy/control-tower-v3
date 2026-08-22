import { useParams, Link } from 'react-router-dom';
import { useProfile } from '../hooks/useProfiles';
import { ProfileForm } from '../components/ProfileForm';

export function ProfileEditorPage() {
  const { name } = useParams<{ name?: string }>();
  let editPath: string | undefined;
  try {
    editPath = name ? decodeURIComponent(name) : undefined;
  } catch {
    editPath = name;
  }
  const { data: existing, error: profileError } = useProfile(editPath ?? null);

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold">
        {editPath ? `Edit: ${editPath}` : 'New Profile'}
      </h1>
      {editPath ? (
        profileError && !existing ? (
          <div className="space-y-3">
            <div className="text-red-400 text-sm">
              Failed to load profile: {(profileError as Error).message}
            </div>
            <Link to="/profiles" className="text-accent text-sm hover:underline">
              Back to Profiles
            </Link>
          </div>
        ) : existing ? (
          <ProfileForm
            mode="edit"
            initialConfig={existing}
            editPath={editPath}
          />
        ) : (
          <div>Loading...</div>
        )
      ) : (
        <ProfileForm mode="create" />
      )}
    </div>
  );
}
