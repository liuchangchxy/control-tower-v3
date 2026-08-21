import { useParams } from 'react-router-dom';
import { useProfile } from '../hooks/useProfiles';
import { ProfileForm } from '../components/ProfileForm';

export function ProfileEditorPage() {
  const { name } = useParams<{ name?: string }>();
  const editPath = name ? decodeURIComponent(name) : undefined;
  const { data: existing } = useProfile(editPath ?? null);

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold">
        {editPath ? `Edit: ${editPath}` : 'New Profile'}
      </h1>
      {editPath ? (
        existing ? (
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
