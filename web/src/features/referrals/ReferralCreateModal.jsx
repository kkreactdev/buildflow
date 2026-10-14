import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBranches, useUsers } from '../../api/admin';
import { useReferralMutations } from '../../api/referrals';
import { FormField } from '../../components/ui/FormField';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import { PersonFields } from '../people/PersonFields';
import { personSchema, usePersonPicker } from '../people/usePersonPicker';
import { ClientPicker, EmployeePicker } from './ReferralPickers';
import './referrals.css';

const FLOWS = [
  { key: 'client', title: 'From an existing client', hint: 'Nothing to retype' },
  { key: 'employee', title: 'From an existing employee', hint: 'Uses their name and phone' },
  { key: 'external', title: 'External person', hint: 'Someone new to us' },
];

/**
 * Create a referral. The three ways are deliberately separate so it is always clear where the person comes from:
 * an existing client, an existing employee (both reuse the identity already on file), or an external person (entered
 * once, with the same duplicate check as clients and enquiries). The server decides the type from the way chosen.
 * `initial` pre-selects a way and a source (for "Make referrer" on a client or employee).
 */
export function ReferralCreateModal({ onClose, initial = {} }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can, dataScope, branchIds } = usePermissions();
  const { createExternal, fromClient, fromUser } = useReferralMutations();
  const [flow, setFlow] = useState(initial.flow ?? 'external');
  const [client, setClient] = useState(initial.client ?? null);
  const [employee, setEmployee] = useState(initial.employee ?? null);
  const picker = usePersonPicker();
  const branches = useBranches();
  const needsBranch = dataScope === 'ALL' || branchIds.length > 1;
  const canPickOwner = can('users.view') && dataScope !== 'OWN';
  const canListEmployees = can('users.view');
  const branchNeeded = flow !== 'client' && needsBranch;

  const form = useForm({
    initialValues: { name: '', phone: '', email: '', address: '', branchId: '', assignedTo: '', reason: '', notes: '' },
    schema: {
      ...(flow === 'external' ? personSchema(picker) : {}),
      branchId: branchNeeded ? [rules.required('Choose a branch')] : [],
    },
    onSubmit: async (v) => {
      const common = { ...(v.assignedTo ? { assignedTo: v.assignedTo } : {}), ...(v.reason ? { reason: v.reason } : {}), ...(v.notes ? { notes: v.notes } : {}) };
      let created;
      try {
        if (flow === 'client') {
          if (!client) throw new Error('Choose the client to convert');
          created = await fromClient.mutateAsync({ clientId: client.id, ...common });
        } else if (flow === 'employee') {
          if (!employee) throw new Error('Choose the employee to convert');
          created = await fromUser.mutateAsync({ userId: employee.id, ...(needsBranch && v.branchId ? { branchId: v.branchId } : {}), ...common });
        } else {
          created = await createExternal.mutateAsync({ ...picker.payload(v), ...(needsBranch ? { branchId: v.branchId } : {}), ...common });
        }
      } catch (err) {
        if (err.code === 'PERSON_EXISTS' && flow === 'external') return void picker.setMatch(err.details);
        throw err;
      }
      toast.success(`Referral ${created.referralNo} created`);
      onClose();
      navigate(`/referrals/${created.id}`);
    },
  });
  const branchId = needsBranch ? form.values.branchId || undefined : branchIds[0];
  const users = useUsers({ branchId, isActive: 'true', limit: 100 }, { enabled: canPickOwner && Boolean(branchId) && flow !== 'client' });

  return (
    <AdminFormModal open onClose={onClose} title="New referral" form={form} submitLabel="Create referral" size="lg">
      <div className="flow-choice" role="group" aria-label="Where does the referrer come from?">
        {FLOWS.map((f) => (
          <button key={f.key} type="button" className="flow-card" aria-pressed={flow === f.key} onClick={() => setFlow(f.key)}>
            <strong>{f.title}</strong>
            <span>{f.hint}</span>
          </button>
        ))}
      </div>

      {flow === 'client' && (
        <FormField label="Client" htmlFor="rf-client" required hint="Their details are used as they are; nothing is copied or retyped.">
          <ClientPicker value={client} onChange={setClient} />
        </FormField>
      )}
      {flow === 'employee' && (
        <FormField label="Employee" htmlFor="rf-employee" required hint="Their name and phone become the referrer's details.">
          {canListEmployees ? <EmployeePicker value={employee} onChange={setEmployee} /> : <p className="muted">You need permission to view employees to choose one.</p>}
        </FormField>
      )}
      {flow === 'external' && <PersonFields picker={picker} form={form} branchId={needsBranch ? form.values.branchId : undefined} />}

      {branchNeeded && (
        <FormField label="Branch" htmlFor="rf-branch" required error={form.errors.branchId}>
          <Select id="rf-branch" value={form.values.branchId} onChange={form.handleChange('branchId')}>
            <option value="">Select a branch…</option>
            {branches.data?.rows.filter((b) => b.isActive).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </Select>
        </FormField>
      )}
      {flow !== 'client' && canPickOwner && (
        <FormField label="Assigned to" htmlFor="rf-owner">
          <Select id="rf-owner" value={form.values.assignedTo} onChange={form.handleChange('assignedTo')}>
            <option value="">Unassigned</option>
            {users.data?.rows.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </FormField>
      )}
      <FormField label="Relationship / reason" htmlFor="rf-reason" hint="Optional. For example how they know us.">
        <Textarea id="rf-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
      <FormField label="Notes" htmlFor="rf-notes">
        <Textarea id="rf-notes" rows={2} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
    </AdminFormModal>
  );
}
