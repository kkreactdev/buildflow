import { useNavigate } from 'react-router-dom';
import { useBranches, useUsers } from '../../api/admin';
import { useEnquiryMutations } from '../../api/enquiries';
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

const MASTER_FIELDS = [
  ['sourceId', 'ENQUIRY_SOURCE', 'Source'],
  ['typeId', 'ENQUIRY_TYPE', 'Enquiry type'],
  ['propertyTypeId', 'PROPERTY_TYPE', 'Property type'],
  ['buildingTypeId', 'BUILDING_TYPE', 'Building type'],
];

/** The master pickers shared by create and edit. Options come from the API; locations are those of the enquiry's branch. */
function MasterFields({ form, branchId, sourceRequired }) {
  return (
    <>
      {MASTER_FIELDS.map(([field, type, label]) => (
        <FormField key={field} label={label} htmlFor={`e-${field}`} required={field === 'sourceId' && sourceRequired} error={form.errors[field]}>
          <MasterSelect id={`e-${field}`} type={type} value={form.values[field]} onChange={form.handleChange(field)} placeholder={`Select ${label.toLowerCase()}…`} />
        </FormField>
      ))}
      <FormField label="Preferred location" htmlFor="e-locationId" hint="Locations of this enquiry's branch.">
        <MasterSelect id="e-locationId" type="LOCATION" branchId={branchId} value={form.values.locationId} onChange={form.handleChange('locationId')} placeholder="Select location…" />
      </FormField>
    </>
  );
}

const emptyMasters = { sourceId: '', typeId: '', propertyTypeId: '', buildingTypeId: '', locationId: '' };
const mastersBody = (v) => Object.fromEntries(['sourceId', 'typeId', 'propertyTypeId', 'buildingTypeId', 'locationId'].filter((f) => v[f]).map((f) => [f, v[f]]));

/** New enquiry: person entry with duplicate detection, branch, masters, optional owner. */
export function EnquiryFormModal({ onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can, branchIds, dataScope } = usePermissions();
  const branches = useBranches();
  const { create } = useEnquiryMutations();
  const picker = usePersonPicker();
  const needsBranch = dataScope === 'ALL' || branchIds.length > 1;
  const canPickOwner = can('users.view') && dataScope !== 'OWN';

  const form = useForm({
    initialValues: { name: '', phone: '', email: '', address: '', branchId: '', ...emptyMasters, assignedTo: '', notes: '' },
    schema: { ...personSchema(picker), sourceId: [rules.required('Choose a source')], branchId: needsBranch ? [rules.required('Choose a branch')] : [] },
    onSubmit: async (v) => {
      const body = { ...picker.payload(v), ...(needsBranch ? { branchId: v.branchId } : {}), ...mastersBody(v), ...(v.assignedTo ? { assignedTo: v.assignedTo } : {}), ...(v.notes ? { notes: v.notes } : {}) };
      try {
        const e = await create.mutateAsync(body);
        toast.success(`Enquiry ${e.enquiryNo} created`);
        onClose();
        navigate(`/enquiries/${e.id}`);
      } catch (err) {
        if (err.code === 'PERSON_EXISTS') return void picker.setMatch(err.details);
        throw err;
      }
    },
  });
  const branchId = needsBranch ? form.values.branchId || undefined : branchIds[0];
  const users = useUsers({ branchId, isActive: 'true', limit: 100 }, { enabled: canPickOwner && Boolean(branchId) });

  return (
    <AdminFormModal open onClose={onClose} title="New enquiry" form={form} submitLabel="Create enquiry" size="lg">
      <PersonFields picker={picker} form={form} branchId={needsBranch ? form.values.branchId : undefined} />
      {needsBranch && (
        <FormField label="Branch" htmlFor="e-branch" required error={form.errors.branchId}>
          <Select id="e-branch" value={form.values.branchId} onChange={form.handleChange('branchId')}>
            <option value="">Select a branch…</option>
            {branches.data?.rows.filter((b) => b.isActive).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </Select>
        </FormField>
      )}
      <MasterFields form={form} branchId={branchId} sourceRequired />
      {canPickOwner && (
        <FormField label="Assigned to" htmlFor="e-owner">
          <Select id="e-owner" value={form.values.assignedTo} onChange={form.handleChange('assignedTo')}>
            <option value="">Unassigned</option>
            {users.data?.rows.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </FormField>
      )}
      <FormField label="Notes" htmlFor="e-notes">
        <Textarea id="e-notes" rows={3} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
    </AdminFormModal>
  );
}

/** Edit descriptive fields only. Stage, owner, branch and person have their own controlled operations. */
export function EnquiryEditModal({ enquiry, onClose }) {
  const toast = useToast();
  const { update } = useEnquiryMutations();
  const form = useForm({
    // A source can be changed but not removed; older enquiries that never had one are not forced to pick one.
    schema: enquiry.sourceId ? { sourceId: [rules.required('An enquiry must keep a source')] } : {},
    initialValues: { sourceId: enquiry.sourceId ?? '', typeId: enquiry.typeId ?? '', propertyTypeId: enquiry.propertyTypeId ?? '', buildingTypeId: enquiry.buildingTypeId ?? '', locationId: enquiry.locationId ?? '', notes: enquiry.notes ?? '' },
    onSubmit: async (v) => {
      const patch = {};
      for (const f of ['sourceId', 'typeId', 'propertyTypeId', 'buildingTypeId', 'locationId']) if (v[f] !== (enquiry[f] ?? '')) patch[f] = v[f] || null; // sourceId is never empty here (validated above)
      if (v.notes !== (enquiry.notes ?? '')) patch.notes = v.notes || null;
      if (Object.keys(patch).length) await update.mutateAsync({ id: enquiry.id, ...patch });
      toast.success('Enquiry updated');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Edit ${enquiry.enquiryNo}`} form={form}>
      <MasterFields form={form} branchId={enquiry.branchId} sourceRequired={Boolean(enquiry.sourceId)} />
      <FormField label="Notes" htmlFor="ee-notes">
        <Textarea id="ee-notes" rows={3} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
    </AdminFormModal>
  );
}
