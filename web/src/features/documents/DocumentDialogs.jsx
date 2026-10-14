import { useRef } from 'react';
import { useDocumentMutations } from '../../api/documents';
import { MasterSelect } from '../../components/data/MasterSelect';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { useToast } from '../../hooks/useToast';
import { AdminFormModal } from '../admin/AdminFormModal';
import { useForm } from '../../hooks/useForm';
import { rules } from '../../lib/validation';

// A convenience for the file picker only: the server decides by the file's real content and size.
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

/** Attach a document to a record. The record is fixed by the page that opens this; its branch and access come from the server. */
export function UploadDocumentDialog({ entityType, entityId, onClose }) {
  const toast = useToast();
  const { upload } = useDocumentMutations();
  const fileRef = useRef(null);
  const form = useForm({
    initialValues: { documentTypeId: '', name: '', notes: '', file: '' },
    schema: { documentTypeId: [rules.required('Choose the document type')], file: [() => (fileRef.current?.files?.[0] ? null : 'Choose a file')] },
    onSubmit: async (v) => {
      const file = fileRef.current.files[0];
      const d = await upload.mutateAsync({ entityType, entityId, file, documentTypeId: v.documentTypeId, name: v.name.trim(), notes: v.notes.trim() });
      toast.success(`Document ${d.documentNo} added`);
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title="Add document" form={form} submitLabel="Upload">
      <FormField label="File" htmlFor="ud-file" required error={form.errors.file} hint="PDF, JPEG, PNG or WebP">
        <input id="ud-file" ref={fileRef} type="file" accept={ACCEPT} onChange={(e) => form.handleChange('file')(e.target.value)} />
      </FormField>
      <FormField label="Document type" htmlFor="ud-type" required error={form.errors.documentTypeId}>
        <MasterSelect id="ud-type" type="DOCUMENT_TYPE" value={form.values.documentTypeId} onChange={form.handleChange('documentTypeId')} placeholder="Select type…" />
      </FormField>
      <FormField label="Title" htmlFor="ud-name" hint="Optional. Defaults to the file name.">
        <Input id="ud-name" value={form.values.name} onChange={form.handleChange('name')} maxLength={200} />
      </FormField>
      <FormField label="Notes" htmlFor="ud-notes">
        <Textarea id="ud-notes" rows={2} value={form.values.notes} onChange={form.handleChange('notes')} maxLength={1000} />
      </FormField>
    </AdminFormModal>
  );
}

/** Replace the file; the previous one is kept as an earlier version. */
export function ReplaceDocumentDialog({ document, onClose }) {
  const toast = useToast();
  const { replace } = useDocumentMutations();
  const fileRef = useRef(null);
  const form = useForm({
    initialValues: { file: '' },
    schema: { file: [() => (fileRef.current?.files?.[0] ? null : 'Choose a file')] },
    onSubmit: async () => {
      const file = fileRef.current.files[0];
      await replace.mutateAsync({ id: document.id, file });
      toast.success('File replaced');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Replace file of ${document.documentNo}`} form={form} submitLabel="Replace file">
      <p className="muted">The current file ({document.file.originalName}) stays available as version {document.file.version}.</p>
      <FormField label="New file" htmlFor="rd-file" required error={form.errors.file} hint="PDF, JPEG, PNG or WebP">
        <input id="rd-file" ref={fileRef} type="file" accept={ACCEPT} onChange={(e) => form.handleChange('file')(e.target.value)} />
      </FormField>
    </AdminFormModal>
  );
}

/** Edit the title, type and notes. The file and the record it belongs to are not editable here. */
export function EditDocumentDialog({ document, onClose }) {
  const toast = useToast();
  const { update } = useDocumentMutations();
  const form = useForm({
    initialValues: { documentTypeId: document.documentTypeId, name: document.name, notes: document.notes ?? '' },
    schema: { name: [rules.required('Enter a title')], documentTypeId: [rules.required('Choose the document type')] },
    onSubmit: async (v) => {
      const patch = {};
      if (v.name.trim() !== document.name) patch.name = v.name.trim();
      if (v.documentTypeId !== document.documentTypeId) patch.documentTypeId = v.documentTypeId;
      if (v.notes !== (document.notes ?? '')) patch.notes = v.notes.trim() || null;
      if (Object.keys(patch).length) await update.mutateAsync({ id: document.id, ...patch });
      toast.success('Document updated');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Edit ${document.documentNo}`} form={form}>
      <FormField label="Title" htmlFor="ed-name" required error={form.errors.name}>
        <Input id="ed-name" value={form.values.name} onChange={form.handleChange('name')} maxLength={200} />
      </FormField>
      <FormField label="Document type" htmlFor="ed-type" required error={form.errors.documentTypeId}>
        <MasterSelect id="ed-type" type="DOCUMENT_TYPE" value={form.values.documentTypeId} onChange={form.handleChange('documentTypeId')} placeholder="Select type…" />
      </FormField>
      <FormField label="Notes" htmlFor="ed-notes">
        <Textarea id="ed-notes" rows={3} value={form.values.notes} onChange={form.handleChange('notes')} maxLength={1000} />
      </FormField>
    </AdminFormModal>
  );
}
