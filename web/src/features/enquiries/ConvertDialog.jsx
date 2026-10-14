import { useEnquiryMutations } from '../../api/enquiries';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../hooks/useToast';

/**
 * Asks before converting. The server does the work in one transaction (creates the client, or links the person's existing
 * client in this branch, and moves the enquiry to Converted); this only confirms, blocks double submits (ConfirmDialog keeps
 * its button busy until the request ends) and reports the outcome. A failure leaves the dialog open with the server's message.
 */
export function ConvertDialog({ enquiry, onClose }) {
  const toast = useToast();
  const { convert } = useEnquiryMutations();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Convert ${enquiry.enquiryNo} to a client?`}
      description={`${enquiry.name} becomes a client of this branch. If they already are one, the enquiry is linked to that client; no duplicate is created. The enquiry moves to Converted and can no longer be marked lost.`}
      confirmLabel="Convert to client"
      onConfirm={async () => {
        const r = await convert.mutateAsync({ id: enquiry.id });
        toast.success(r.alreadyConverted
          ? `${enquiry.enquiryNo} was already converted (${r.client?.clientNo ?? 'client'})`
          : r.createdClient ? `Converted: client ${r.client.clientNo} created` : `Converted: linked to existing client ${r.client.clientNo}`);
      }}
    />
  );
}
