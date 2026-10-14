import { useState } from 'react';
import { useSiteVisitMutations } from '../../api/sitevisits';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../hooks/useToast';
import { SiteVisitFormModal } from './SiteVisitFormModal';
import { AssignVisitDialog, CancelVisitDialog, CompleteVisitDialog } from './VisitDialogs';

/**
 * One place that knows how to complete / cancel / reassign / edit / archive a visit, so every screen behaves
 * identically. `menuItems(visit)` is built from the server's `allowed` flags: the UI offers exactly what the API
 * will accept for this person right now, and never decides lifecycle rules itself.
 */
export function useVisitActions({ onArchived } = {}) {
  const toast = useToast();
  const { archive } = useSiteVisitMutations();
  const [active, setActive] = useState(null);
  const close = () => setActive(null);

  const menuItems = (v) => [
    { label: 'Complete…', hidden: !v.allowed.complete, onSelect: () => setActive({ kind: 'complete', visit: v }) },
    { label: 'Edit', hidden: !v.allowed.edit, onSelect: () => setActive({ kind: 'edit', visit: v }) },
    { label: 'Reassign', hidden: !v.allowed.assign, onSelect: () => setActive({ kind: 'assign', visit: v }) },
    { label: 'Cancel visit', danger: true, hidden: !v.allowed.cancel, onSelect: () => setActive({ kind: 'cancel', visit: v }) },
    { label: 'Archive', danger: true, hidden: !v.allowed.archive, onSelect: () => setActive({ kind: 'archive', visit: v }) },
  ];

  const v = active?.visit;
  const element = (
    <>
      {active?.kind === 'complete' && <CompleteVisitDialog visit={v} onClose={close} />}
      {active?.kind === 'edit' && <SiteVisitFormModal visit={v} onClose={close} />}
      {active?.kind === 'assign' && <AssignVisitDialog visit={v} onClose={close} />}
      {active?.kind === 'cancel' && <CancelVisitDialog visit={v} onClose={close} />}
      <ConfirmDialog
        open={active?.kind === 'archive'}
        onClose={close}
        title={`Archive ${v?.visitNo}?`}
        description="The visit disappears from lists, but its history is kept."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(v.id);
          toast.success('Site visit archived');
          onArchived?.();
        }}
      />
    </>
  );
  return { menuItems, element };
}
