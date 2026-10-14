import { useState } from 'react';
import { MasterSelect } from '../../components/data/MasterSelect';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Textarea';

export function ReasonDialog({ request, busy, error, onSubmit, onClose }) {
  const { enquiry, target } = request;
  const lost = target.direction === 'LOST';
  const [reason, setReason] = useState('');
  const [lostReasonId, setLostReasonId] = useState('');
  const reopen = target.direction === 'REOPEN';
  const needsText = !lost && target.requiresReason;
  const ready = lost ? Boolean(lostReasonId) : needsText ? reason.trim().length > 0 : true;
  const title = lost ? `Mark ${enquiry.enquiryNo} as lost` : reopen ? `Reopen ${enquiry.enquiryNo}` : `Move ${enquiry.enquiryNo} back to ${target.label}`;
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={lost ? 'danger' : 'primary'} disabled={!ready || busy} onClick={() => onSubmit({ reason: reason.trim() || undefined, lostReasonId: lostReasonId || undefined })}>
            {busy ? 'Saving…' : lost ? 'Mark lost' : reopen ? 'Reopen' : 'Move back'}
          </Button>
        </>
      }
    >
      <div className="admin-form">
        {lost && (
          <FormField label="Why was it lost?" htmlFor="sm-lost" required>
            <MasterSelect id="sm-lost" type="LOST_REASON" value={lostReasonId} onChange={setLostReasonId} placeholder="Select a reason…" />
          </FormField>
        )}
        <FormField label={lost ? 'Note (optional)' : 'Reason'} htmlFor="sm-reason" required={needsText} hint={needsText ? 'Recorded in the history and audit log.' : undefined}>
          <Textarea id="sm-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
