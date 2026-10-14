import { useState } from 'react';
import { openDocument, useDocumentMutations } from '../../api/documents';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../hooks/useToast';
import { EditDocumentDialog, ReplaceDocumentDialog } from './DocumentDialogs';

/**
 * One place that knows how to open / edit / replace / archive a document, so every screen behaves the same. The menu is built from
 * the server's `allowed` flags: the UI offers exactly what the API will accept for this person right now.
 */
export function useDocumentActions({ onArchived } = {}) {
  const toast = useToast();
  const { archive } = useDocumentMutations();
  const [active, setActive] = useState(null);
  const close = () => setActive(null);

  async function open(d, version) {
    try {
      await openDocument(d.id, version);
    } catch (err) {
      toast.error(err.message);
    }
  }
  const menuItems = (d) => [
    { label: 'Open', hidden: !d.allowed.download, onSelect: () => open(d) },
    { label: 'Edit', hidden: !d.allowed.edit, onSelect: () => setActive({ kind: 'edit', d }) },
    { label: 'Replace file', hidden: !d.allowed.replace, onSelect: () => setActive({ kind: 'replace', d }) },
    { label: 'Archive', danger: true, hidden: !d.allowed.archive, onSelect: () => setActive({ kind: 'archive', d }) },
  ];
  const d = active?.d;
  const element = (
    <>
      {active?.kind === 'edit' && <EditDocumentDialog document={d} onClose={close} />}
      {active?.kind === 'replace' && <ReplaceDocumentDialog document={d} onClose={close} />}
      <ConfirmDialog
        open={active?.kind === 'archive'}
        onClose={close}
        title={`Archive ${d?.documentNo}?`}
        description="The document disappears from lists, but the file and its history are kept."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(d.id);
          toast.success('Document archived');
          onArchived?.();
        }}
      />
    </>
  );
  return { menuItems, element, open };
}
