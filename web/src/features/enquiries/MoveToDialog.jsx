import { useTransitions } from '../../api/enquiries';
import { useWorkflowStages } from '../../api/masters';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';

const DIRECTION_TEXT = { FORWARD: 'Move forward', BACKWARD: 'Move back (reason required)', LOST: 'Mark lost (reason required)', REOPEN: 'Reopen (reason required)' };

/**
 * Lists exactly what the backend says this user can do from the enquiry's stage — the keyboard/touch
 * counterpart of dragging a card. Stages owned by another action are shown but not selectable.
 */
export function MoveToDialog({ enquiry, onPick, onClose }) {
  const transitions = useTransitions(enquiry.stageCode);
  const stages = useWorkflowStages();
  const label = (key) => stages.data?.find((s) => s.systemKey === key)?.label ?? key;

  return (
    <Modal open onClose={onClose} title={`Move ${enquiry.enquiryNo}`} subtitle={`Currently: ${enquiry.stage.label}`} size="sm">
      {transitions.isPending && <Skeleton height={44} />}
      {transitions.isError && <p className="form-error" role="alert">{transitions.error.message}</p>}
      {transitions.data?.length === 0 && <p className="muted">You cannot move this enquiry from its current stage.</p>}
      <div className="move-list">
        {transitions.data?.map((t) => (
          <button key={t.to} type="button" className="move-item" disabled={Boolean(t.domainOperation)} onClick={() => onPick({ ...t, label: label(t.to) })}>
            <strong>{label(t.to)}</strong>
            <span className="muted">{t.domainOperation === 'enquiry.convert' ? 'Use the Convert to Client button' : t.domainOperation ? 'Set by its own action' : DIRECTION_TEXT[t.direction]}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
