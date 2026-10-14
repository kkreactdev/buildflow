import { useRef, useState } from 'react';
import { useUnitMutations } from '../../api/units';
import { MasterSelect } from '../../components/data/MasterSelect';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../hooks/useToast';
import './units.css';

// Convenience only: the server decides by the file's real content and enforces the size limit.
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function UploadForm({ unit }) {
  const toast = useToast();
  const { addMedia } = useUnitMutations();
  const fileRef = useRef(null);
  const [typeId, setTypeId] = useState('');
  const [caption, setCaption] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    const next = {};
    if (!file) next.file = 'Choose a file';
    if (!typeId) next.typeId = 'Choose what this file shows';
    setErrors(next);
    setError(null);
    if (Object.keys(next).length) return;
    try {
      await addMedia.mutateAsync({ id: unit.id, file, typeId, caption: caption.trim() });
      toast.success('File uploaded');
      fileRef.current.value = '';
      setCaption('');
      setTypeId('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Upload media">
      <div className="media-upload">
        <FormField label="File" htmlFor="um-file" required error={errors.file} hint="JPEG, PNG, WebP or PDF">
          <input id="um-file" ref={fileRef} type="file" accept={ACCEPT} />
        </FormField>
        <FormField label="Type" htmlFor="um-type" required error={errors.typeId}>
          <MasterSelect id="um-type" type="MEDIA_TYPE" value={typeId} onChange={(v) => { setTypeId(v); setErrors((x) => ({ ...x, typeId: undefined })); }} placeholder="Select type…" />
        </FormField>
        <FormField label="Caption" htmlFor="um-caption">
          <Input id="um-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} />
        </FormField>
        <Button type="submit" disabled={addMedia.isPending}>{addMedia.isPending ? 'Uploading…' : 'Upload'}</Button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}

/** The unit's images and brochures. Controls appear only when the server says this user may manage media for this unit. */
export function UnitMedia({ unit }) {
  const toast = useToast();
  const { removeMedia } = useUnitMutations();
  const [removing, setRemoving] = useState(null);
  const media = unit.media ?? [];
  const canManage = unit.allowed.manageMedia;

  return (
    <Card className="detail-card detail-section-full">
      <h3>Media</h3>
      {media.length === 0 ? (
        <EmptyState title="No media yet" description={canManage ? 'Upload photos, floor plans or a brochure.' : undefined} />
      ) : (
        <ul className="media-grid" aria-label="Media">
          {media.map((m) => (
            <li key={m.id} className="media-item">
              {m.isImage ? (
                <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt={m.caption || m.type?.label || 'Unit image'} loading="lazy" /></a>
              ) : (
                <a className="media-file" href={m.url} target="_blank" rel="noreferrer">PDF</a>
              )}
              <div className="media-meta">
                <strong>{m.type ? (m.type.isActive === false ? `${m.type.label} (inactive)` : m.type.label) : 'File'}</strong>
                {m.caption && <span>{m.caption}</span>}
                <span className="muted">{kb(m.bytes)}</span>
                {canManage && <Button variant="ghost" onClick={() => setRemoving(m)}>Remove</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canManage && <UploadForm unit={unit} />}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Remove this file?"
        description="The file is deleted from the unit. The removal is recorded in its history."
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          await removeMedia.mutateAsync({ id: unit.id, mediaId: removing.id });
          toast.success('File removed');
        }}
      />
    </Card>
  );
}
