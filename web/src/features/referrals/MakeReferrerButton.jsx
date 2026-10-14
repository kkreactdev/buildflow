import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { usePermissions } from '../../hooks/usePermissions';
import { ReferralCreateModal } from './ReferralCreateModal';

/** "Make referrer" on a client or employee: opens the create dialog already set to that source (nothing is retyped). */
export function MakeReferrerButton({ client, employee }) {
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  if (!can('referrals.create')) return null;
  const initial = client ? { flow: 'client', client: { id: client.id, clientNo: client.clientNo, name: client.name } } : { flow: 'employee', employee: { id: employee.id, name: employee.name } };
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Make referrer</Button>
      {open && <ReferralCreateModal initial={initial} onClose={() => setOpen(false)} />}
    </>
  );
}
