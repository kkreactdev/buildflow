import { useState } from 'react';
import { useFollowUpMutations } from '../../api/followups';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../hooks/useToast';
import { CancelDialog, CompleteDialog, RescheduleDialog } from './FollowUpDialogs';
import { FollowUpFormModal } from './FollowUpFormModal';

/**
 * One place that knows how to complete / reschedule / cancel / edit / archive a follow-up, so every screen
 * (list, enquiry, client) behaves identically. `menuItems(followUp)` builds ActionMenu entries from the
 * server's `allowed` flags: the UI offers exactly what the API will accept for this person right now.
 */
export function useFollowUpActions({ branchId } = {}) {
  const toast = useToast();
  const { archive } = useFollowUpMutations();
  const [active, setActive] = useState(null); // { kind, followUp }
  const close = () => setActive(null);

  const menuItems = (f) => [
    { label: 'Complete', hidden: !f.allowed.complete, onSelect: () => setActive({ kind: 'complete', followUp: f }) },
    { label: 'Reschedule', hidden: !f.allowed.reschedule, onSelect: () => setActive({ kind: 'reschedule', followUp: f }) },
    { label: 'Edit', hidden: !f.allowed.edit, onSelect: () => setActive({ kind: 'edit', followUp: f }) },
    { label: 'Cancel follow-up', danger: true, hidden: !f.allowed.cancel, onSelect: () => setActive({ kind: 'cancel', followUp: f }) },
    { label: 'Archive', danger: true, hidden: !f.allowed.archive, onSelect: () => setActive({ kind: 'archive', followUp: f }) },
  ];

  const f = active?.followUp;
  const element = (
    <>
      {active?.kind === 'complete' && <CompleteDialog followUp={f} onClose={close} />}
      {active?.kind === 'reschedule' && <RescheduleDialog followUp={f} onClose={close} />}
      {active?.kind === 'cancel' && <CancelDialog followUp={f} onClose={close} />}
      {active?.kind === 'edit' && <FollowUpFormModal followUp={f} branchId={branchId ?? f.branchId} onClose={close} />}
      <ConfirmDialog
        open={active?.kind === 'archive'}
        onClose={close}
        title="Archive this follow-up?"
        description="It disappears from lists, but its history is kept."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(f.id);
          toast.success('Follow-up archived');
        }}
      />
    </>
  );
  return { menuItems, element };
}
