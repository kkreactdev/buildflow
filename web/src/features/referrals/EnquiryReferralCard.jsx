import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useReferralMutations } from '../../api/referrals';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { AdminFormModal } from '../admin/AdminFormModal';
import { ReferralPicker } from './ReferralPickers';

function LinkReferralDialog({ enquiry, onClose }) {
  const toast = useToast();
  const { linkEnquiry } = useReferralMutations();
  const [referral, setReferral] = useState(null);
  const form = useForm({
    initialValues: {},
    onSubmit: async () => {
      if (!referral) throw new Error('Choose the referral this enquiry came through');
      await linkEnquiry.mutateAsync({ id: referral.id, enquiryId: enquiry.id });
      toast.success(`Linked to ${referral.referralNo}`);
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Link ${enquiry.enquiryNo} to a referral`} form={form} submitLabel="Link referral">
      <FormField label="Referral" htmlFor="rf-pick" required>
        <ReferralPicker value={referral} onChange={setReferral} />
      </FormField>
    </AdminFormModal>
  );
}

/** Who referred this enquiry (if anyone), and the controlled way to record it. Nothing is created here. */
export function EnquiryReferralCard({ enquiry, canLink }) {
  const { can } = usePermissions();
  const [linking, setLinking] = useState(false);
  if (!can('referrals.view') && !enquiry.referral) return null;
  return (
    <Card className="detail-card">
      <div className="fu-section-head">
        <h3>Referral</h3>
        {!enquiry.referral && canLink && can('referrals.edit') && <Button variant="secondary" onClick={() => setLinking(true)}>Link referral</Button>}
      </div>
      {enquiry.referral ? (
        <dl className="kv">
          <dt>Referred by</dt><dd><Link to={`/referrals/${enquiry.referral.id}`}>{enquiry.referral.name}</Link> <span className="id-chip">{enquiry.referral.referralNo}</span></dd>
        </dl>
      ) : (
        <EmptyState title="Not referred" description="No referrer is recorded for this enquiry." />
      )}
      {linking && <LinkReferralDialog enquiry={enquiry} onClose={() => setLinking(false)} />}
    </Card>
  );
}
