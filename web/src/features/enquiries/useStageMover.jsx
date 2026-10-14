import { useState } from 'react';
import { useEnquiryMutations } from '../../api/enquiries';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { BookingFormModal } from '../bookings/BookingFormModal';
import { SiteVisitFormModal } from '../sitevisits/SiteVisitFormModal';
import { ConvertDialog } from './ConvertDialog';
import { ReasonDialog } from './ReasonDialog';

/** Plain-language description of the dedicated action that owns a domain-controlled stage. */
const DOMAIN_ACTIONS = {
  'sitevisit.schedule': 'scheduling a site visit',
  'sitevisit.complete': 'completing a site visit',
  'booking.create': 'booking a unit',
  'enquiry.convert': 'converting the enquiry to a client',
};

/**
 * Moves an enquiry between stages using the BACKEND's transition metadata
 * (`GET /workflow/transitions`): `requestMove(enquiry, target)` where `target` is one entry of that list
 * plus its display `label`. Used by the Kanban and the detail page so both follow identical rules.
 *
 *  - domain-owned stages (`domainOperation`) are never moved to here: scheduling a site visit, booking a unit or converting to a
 *    client opens its own dialog (that action moves the enquiry); other owned stages tell the user which action owns them;
 *  - moves needing a reason (backward, lost, reopen) open a dialog first;
 *  - plain forward moves are sent directly.
 * Nothing changes on screen until the server confirms: a card is only marked "pending", and on a server
 * refusal the card simply stays where it was and the server's message is shown.
 */
export function useStageMover() {
  const toast = useToast();
  const { can } = usePermissions();
  const { transition, lose, reopen } = useEnquiryMutations();
  const [request, setRequest] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState(null);
  const [scheduleFor, setScheduleFor] = useState(null);
  const [bookFor, setBookFor] = useState(null);
  const [convertFor, setConvertFor] = useState(null);

  async function send(enquiry, target, extra = {}) {
    const base = { id: enquiry.id, from: enquiry.stageCode };
    setPendingId(enquiry.id);
    try {
      if (target.direction === 'LOST') await lose.mutateAsync({ ...base, lostReasonId: extra.lostReasonId, note: extra.reason });
      else if (target.direction === 'REOPEN') await reopen.mutateAsync({ ...base, to: target.to, reason: extra.reason });
      else await transition.mutateAsync({ ...base, to: target.to, reason: extra.reason });
      toast.success(`${enquiry.enquiryNo} → ${target.label}`);
      return true;
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
      return false;
    } finally {
      setPendingId(null);
    }
  }

  function requestMove(enquiry, target) {
    setError(null);
    if (target.domainOperation === 'sitevisit.schedule' && can('sitevisits.create')) {
      setScheduleFor({ id: enquiry.id, enquiryNo: enquiry.enquiryNo, name: enquiry.name, branchId: enquiry.branchId });
      return;
    }
    if (target.domainOperation === 'booking.create' && can('bookings.create')) {
      setBookFor({ id: enquiry.id, enquiryNo: enquiry.enquiryNo, name: enquiry.name, branchId: enquiry.branchId });
      return;
    }
    if (target.domainOperation === 'enquiry.convert' && can('enquiries.convert') && can('clients.create')) {
      setConvertFor({ id: enquiry.id, enquiryNo: enquiry.enquiryNo, name: enquiry.name });
      return;
    }
    if (target.domainOperation) {
      toast.info(`“${target.label}” is set by ${DOMAIN_ACTIONS[target.domainOperation] ?? 'its own action'}, not by moving the card.`);
      return;
    }
    if (target.requiresReason) return void setRequest({ enquiry, target });
    void send(enquiry, target);
  }

  const visitDialog = scheduleFor ? <SiteVisitFormModal enquiry={scheduleFor} onClose={() => setScheduleFor(null)} /> : null;
  const bookDialog = bookFor ? <BookingFormModal enquiry={bookFor} onClose={() => setBookFor(null)} /> : null;
  const convertDialog = convertFor ? <ConvertDialog enquiry={convertFor} onClose={() => setConvertFor(null)} /> : null;
  const reasonDialog = request ? (
    <ReasonDialog
      request={request}
      busy={pendingId === request.enquiry.id}
      error={error}
      onClose={() => setRequest(null)}
      onSubmit={async (extra) => {
        if (await send(request.enquiry, request.target, extra)) setRequest(null);
      }}
    />
  ) : null;
  const dialog = (
    <>
      {reasonDialog}
      {visitDialog}
      {bookDialog}
      {convertDialog}
    </>
  );

  return { requestMove, dialog, pendingId };
}
