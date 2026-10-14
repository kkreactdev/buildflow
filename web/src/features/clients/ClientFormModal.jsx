import { useNavigate } from 'react-router-dom';
import { useBranches } from '../../api/admin';
import { useClientMutations } from '../../api/clients';
import { MasterSelect } from '../../components/data/MasterSelect';
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
import './clients.css';

/** New client: person entry with duplicate detection (see PersonFields), then the branch-specific details. */
export function ClientFormModal({ onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { branchIds, dataScope } = usePermissions();
  const branches = useBranches();
  const { create } = useClientMutations();
  const picker = usePersonPicker();
  const needsBranch = dataScope === 'ALL' || branchIds.length > 1;

  const form = useForm({
    initialValues: { name: '', phone: '', email: '', address: '', categoryId: '', branchId: '', notes: '' },
    schema: { ...personSchema(picker), branchId: needsBranch ? [rules.required('Choose a branch')] : [] },
    onSubmit: async (v) => {
      const body = { ...picker.payload(v), ...(needsBranch ? { branchId: v.branchId } : {}), ...(v.categoryId ? { categoryId: v.categoryId } : {}), ...(v.notes ? { notes: v.notes } : {}) };
      try {
        const client = await create.mutateAsync(body);
        toast.success(`Client ${client.clientNo} created`);
        onClose();
        navigate(`/clients/${client.id}`);
      } catch (err) {
        if (err.code === 'PERSON_EXISTS') return void picker.setMatch(err.details); // e.g. someone created it a moment ago
        if (err.code === 'CLIENT_EXISTS') return void picker.setMatch({ status: 'CLIENT_EXISTS', ...err.details, message: err.message });
        throw err;
      }
    },
  });

  return (
    <AdminFormModal open onClose={onClose} title="New client" form={form} submitLabel="Create client" size="lg">
      <PersonFields picker={picker} form={form} branchId={needsBranch ? form.values.branchId : undefined} />
      {needsBranch && (
        <FormField label="Branch" htmlFor="c-branch" required error={form.errors.branchId}>
          <Select id="c-branch" value={form.values.branchId} onChange={form.handleChange('branchId')}>
            <option value="">Select a branch…</option>
            {branches.data?.rows.filter((b) => b.isActive).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </Select>
        </FormField>
      )}
      <FormField label="Category" htmlFor="c-category">
        <MasterSelect id="c-category" type="CLIENT_CATEGORY" value={form.values.categoryId} onChange={form.handleChange('categoryId')} placeholder="No category" />
      </FormField>
      <FormField label="Notes" htmlFor="c-notes" hint="Visible only to this branch.">
        <Textarea id="c-notes" rows={3} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
    </AdminFormModal>
  );
}
