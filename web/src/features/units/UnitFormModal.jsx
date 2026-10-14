import { useNavigate } from 'react-router-dom';
import { useBranches, useUsers } from '../../api/admin';
import { useUnitMutations } from '../../api/units';
import { MasterSelect } from '../../components/data/MasterSelect';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import './units.css';

const NUMBER_FIELDS = ['latitude', 'longitude', 'plotArea', 'builtUpArea', 'expectedPrice', 'bedrooms', 'bathrooms'];
const TEXT_FIELDS = ['address', 'city', 'state', 'pincode', 'description'];
const MASTER_IDS = ['propertyTypeId', 'buildingTypeId', 'locationId'];

const range = (min, max, what) => (v) => (v !== '' && v != null && !Number.isNaN(Number(v)) && (Number(v) < min || Number(v) > max) ? `${what} must be between ${min} and ${max}` : null);
const whole = (v) => (v !== '' && v != null && !Number.isInteger(Number(v)) ? 'Enter a whole number' : null);

const SCHEMA = {
  name: [rules.required('Enter a name'), rules.maxLength(150)],
  latitude: [rules.number(), range(-90, 90, 'Latitude'), (v, all) => (v !== '' && all.longitude === '' ? 'Enter the longitude too' : null)],
  longitude: [rules.number(), range(-180, 180, 'Longitude'), (v, all) => (v !== '' && all.latitude === '' ? 'Enter the latitude too' : null)],
  plotArea: [rules.number(), range(0, 10_000_000, 'Area')],
  builtUpArea: [rules.number(), range(0, 10_000_000, 'Area')],
  expectedPrice: [rules.number(), range(0, 100_000_000_000, 'Price')],
  bedrooms: [rules.number(), whole, range(0, 50, 'Bedrooms')],
  bathrooms: [rules.number(), whole, range(0, 50, 'Bathrooms')],
  description: [rules.maxLength(3000)],
};

/** Shared fields. Locations are those of the unit's branch (the server enforces it). */
function Fields({ form, branchId }) {
  const text = (field, label, props = {}) => (
    <FormField label={label} htmlFor={`u-${field}`} error={form.errors[field]}>
      <Input id={`u-${field}`} value={form.values[field]} onChange={form.handleChange(field)} {...props} />
    </FormField>
  );
  return (
    <>
      <FormField label="Property type" htmlFor="u-propertyTypeId" error={form.errors.propertyTypeId}>
        <MasterSelect id="u-propertyTypeId" type="PROPERTY_TYPE" value={form.values.propertyTypeId} onChange={form.handleChange('propertyTypeId')} placeholder="Select property type…" />
      </FormField>
      <FormField label="Building type" htmlFor="u-buildingTypeId" error={form.errors.buildingTypeId}>
        <MasterSelect id="u-buildingTypeId" type="BUILDING_TYPE" value={form.values.buildingTypeId} onChange={form.handleChange('buildingTypeId')} placeholder="Select building type…" />
      </FormField>
      <FormField label="Location" htmlFor="u-locationId" error={form.errors.locationId} hint="Locations of this unit's branch.">
        <MasterSelect id="u-locationId" type="LOCATION" branchId={branchId} value={form.values.locationId} onChange={form.handleChange('locationId')} placeholder="Select location…" />
      </FormField>
      {text('address', 'Address', { maxLength: 300 })}
      <div className="unit-grid-2">
        {text('city', 'City', { maxLength: 100 })}
        {text('state', 'State', { maxLength: 100 })}
        {text('pincode', 'Pincode', { maxLength: 12 })}
      </div>
      <div className="unit-grid-2">
        {text('latitude', 'Latitude', { type: 'number', step: 'any', inputMode: 'decimal' })}
        {text('longitude', 'Longitude', { type: 'number', step: 'any', inputMode: 'decimal' })}
      </div>
      <div className="unit-grid-2">
        {text('plotArea', 'Plot area (sq ft)', { type: 'number', min: 0, step: 'any' })}
        {text('builtUpArea', 'Built-up area (sq ft)', { type: 'number', min: 0, step: 'any' })}
      </div>
      {text('expectedPrice', 'Expected price (₹)', { type: 'number', min: 0, step: 'any' })}
      <div className="unit-grid-2">
        {text('bedrooms', 'Bedrooms', { type: 'number', min: 0, step: 1 })}
        {text('bathrooms', 'Bathrooms', { type: 'number', min: 0, step: 1 })}
      </div>
      <FormField label="Description" htmlFor="u-description" error={form.errors.description}>
        <Textarea id="u-description" rows={3} value={form.values.description} onChange={form.handleChange('description')} />
      </FormField>
    </>
  );
}

const blank = { name: '', propertyTypeId: '', buildingTypeId: '', locationId: '', address: '', city: '', state: '', pincode: '', latitude: '', longitude: '', plotArea: '', builtUpArea: '', expectedPrice: '', bedrooms: '', bathrooms: '', description: '' };
const fromUnit = (u) => Object.fromEntries(Object.keys(blank).map((k) => [k, u[k] === undefined || u[k] === null ? '' : String(u[k])]));

/** New unit. Status always starts as the initial status and is not chosen here. */
export function UnitFormModal({ onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can, branchIds, dataScope } = usePermissions();
  const branches = useBranches();
  const { create } = useUnitMutations();
  const needsBranch = dataScope === 'ALL' || branchIds.length > 1;
  const canPickOwner = can('users.view') && dataScope !== 'OWN';

  const form = useForm({
    initialValues: { ...blank, branchId: '', assignedTo: '' },
    schema: { ...SCHEMA, branchId: needsBranch ? [rules.required('Choose a branch')] : [] },
    onSubmit: async (v) => {
      const body = { name: v.name.trim() };
      if (needsBranch) body.branchId = v.branchId;
      for (const f of MASTER_IDS) if (v[f]) body[f] = v[f];
      for (const f of TEXT_FIELDS) if (v[f].trim()) body[f] = v[f].trim();
      for (const f of NUMBER_FIELDS) if (v[f] !== '') body[f] = Number(v[f]);
      if (v.assignedTo) body.assignedTo = v.assignedTo;
      const u = await create.mutateAsync(body);
      toast.success(`Unit ${u.unitCode} created`);
      onClose();
      navigate(`/units/${u.id}`);
    },
  });
  const branchId = needsBranch ? form.values.branchId || undefined : branchIds[0];
  const users = useUsers({ branchId, isActive: 'true', limit: 100 }, { enabled: canPickOwner && Boolean(branchId) });

  return (
    <AdminFormModal open onClose={onClose} title="New unit" form={form} submitLabel="Create unit" size="lg">
      <FormField label="Name" htmlFor="u-name" required error={form.errors.name}>
        <Input id="u-name" value={form.values.name} onChange={form.handleChange('name')} maxLength={150} autoFocus />
      </FormField>
      {needsBranch && (
        <FormField label="Branch" htmlFor="u-branch" required error={form.errors.branchId}>
          <Select id="u-branch" value={form.values.branchId} onChange={form.handleChange('branchId')}>
            <option value="">Select a branch…</option>
            {branches.data?.rows.filter((b) => b.isActive).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </Select>
        </FormField>
      )}
      <Fields form={form} branchId={branchId} />
      {canPickOwner && (
        <FormField label="Salesperson" htmlFor="u-owner">
          <Select id="u-owner" value={form.values.assignedTo} onChange={form.handleChange('assignedTo')}>
            <option value="">Unassigned</option>
            {users.data?.rows.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </FormField>
      )}
    </AdminFormModal>
  );
}

/** Edit descriptive fields only. Status, salesperson, branch and media have their own controlled operations. */
export function UnitEditModal({ unit, onClose }) {
  const toast = useToast();
  const { update } = useUnitMutations();
  const initial = fromUnit(unit);
  const form = useForm({
    initialValues: initial,
    schema: SCHEMA,
    onSubmit: async (v) => {
      const patch = {};
      if (v.name.trim() !== initial.name) patch.name = v.name.trim();
      for (const f of [...MASTER_IDS, ...TEXT_FIELDS]) if (v[f].trim() !== initial[f]) patch[f] = v[f].trim() || null;
      for (const f of NUMBER_FIELDS) if (v[f] !== initial[f]) patch[f] = v[f] === '' ? null : Number(v[f]);
      if (Object.keys(patch).length) await update.mutateAsync({ id: unit.id, ...patch });
      toast.success('Unit updated');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Edit ${unit.unitCode}`} form={form} size="lg">
      <FormField label="Name" htmlFor="u-name" required error={form.errors.name}>
        <Input id="u-name" value={form.values.name} onChange={form.handleChange('name')} maxLength={150} />
      </FormField>
      <Fields form={form} branchId={unit.branchId} />
    </AdminFormModal>
  );
}
