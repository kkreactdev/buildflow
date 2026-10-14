import { useNavigate } from 'react-router-dom';
import { useBranches, useUsers } from '../../api/admin';
import { useMasterOptions } from '../../api/masters';
import { useSellerMutations } from '../../api/sellers';
import { MasterSelect } from '../../components/data/MasterSelect';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { formatInr } from '../../lib/format';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import { PersonFields } from '../people/PersonFields';
import { personSchema, usePersonPicker } from '../people/usePersonPicker';
import { CHECKLIST_FIELDS } from './sellerChecklist';

/** The proposed-property fields the API takes as numbers; everything else is text. */
const NUMBER_FIELDS = ['askingPrice', 'plotArea', 'builtUpArea', 'bedrooms', 'bathrooms'];
const TEXT_FIELDS = ['name', 'address', 'city', 'state', 'pincode', 'description', 'notes'];
const MASTER_FIELDS = ['propertyTypeId', 'buildingTypeId', 'locationId'];
const EMPTY_PROPERTY = Object.fromEntries([...TEXT_FIELDS, ...NUMBER_FIELDS, ...MASTER_FIELDS].map((f) => [f, '']));

/**
 * Form values → API body. Empty fields are left out (the API rejects empty strings for optional fields) unless
 * `clearEmpty` is set, when a field that HAD a value and is now blank is sent as null so the edit really clears it.
 * Numbers are converted only for numeric fields: a pincode such as "600001" must stay text.
 */
function propertyPayload(values, { original, clearEmpty = false } = {}) {
  const out = {};
  for (const f of [...TEXT_FIELDS, ...NUMBER_FIELDS, ...MASTER_FIELDS]) {
    const raw = typeof values[f] === 'string' ? values[f].trim() : values[f];
    if (raw === '' || raw === undefined || raw === null) {
      if (clearEmpty && original?.[f] != null && f !== 'name') out[f] = null;
      continue;
    }
    out[f] = NUMBER_FIELDS.includes(f) ? Number(raw) : raw;
  }
  return out;
}
const numberRules = Object.fromEntries(NUMBER_FIELDS.map((f) => [f, [rules.number()]]));
const nested = (prefix, schema) => Object.fromEntries(Object.entries(schema).map(([k, v]) => [`${prefix}.${k}`, v]));

/**
 * Proposed-property fields, shared by the registration dialog (values nested under `property`) and the
 * add / edit dialogs (values at the top level).
 */
function PropertyFields({ form, branchId, prefix }) {
  const values = prefix ? form.values[prefix] : form.values;
  const error = (f) => form.errors[prefix ? `${prefix}.${f}` : f];
  const set = (field) => (e) => {
    const value = e?.target ? e.target.value : e;
    if (prefix) form.setValue(prefix, { ...form.values[prefix], [field]: value });
    else form.setValue(field, value);
  };
  const id = (f) => `sp-${f}`;
  return (
    <>
      <FormField label="Property name" htmlFor={id('name')} required error={error('name')}>
        <Input id={id('name')} value={values.name} onChange={set('name')} placeholder="e.g. 12.4 acres on Poonamallee Road" />
      </FormField>
      <div className="form-row">
        <FormField label="Asking price (₹)" htmlFor={id('askingPrice')} error={error('askingPrice')}>
          <Input id={id('askingPrice')} type="number" min="0" value={values.askingPrice} onChange={set('askingPrice')} />
        </FormField>
        <FormField label="Plot area (sq ft)" htmlFor={id('plotArea')} error={error('plotArea')}>
          <Input id={id('plotArea')} type="number" min="0" value={values.plotArea} onChange={set('plotArea')} />
        </FormField>
        <FormField label="Built-up area (sq ft)" htmlFor={id('builtUpArea')} error={error('builtUpArea')}>
          <Input id={id('builtUpArea')} type="number" min="0" value={values.builtUpArea} onChange={set('builtUpArea')} />
        </FormField>
      </div>
      <div className="form-row">
        <FormField label="Property type" htmlFor={id('propertyTypeId')}>
          <MasterSelect id={id('propertyTypeId')} type="PROPERTY_TYPE" value={values.propertyTypeId} onChange={set('propertyTypeId')} placeholder="Not set" />
        </FormField>
        <FormField label="Building type" htmlFor={id('buildingTypeId')}>
          <MasterSelect id={id('buildingTypeId')} type="BUILDING_TYPE" value={values.buildingTypeId} onChange={set('buildingTypeId')} placeholder="Not set" />
        </FormField>
        <FormField label="Location" htmlFor={id('locationId')} hint="Locations of this branch.">
          <MasterSelect id={id('locationId')} type="LOCATION" branchId={branchId} value={values.locationId} onChange={set('locationId')} placeholder="Not set" />
        </FormField>
      </div>
      <FormField label="Address" htmlFor={id('address')}>
        <Input id={id('address')} value={values.address} onChange={set('address')} />
      </FormField>
      <div className="form-row">
        <FormField label="City" htmlFor={id('city')}>
          <Input id={id('city')} value={values.city} onChange={set('city')} />
        </FormField>
        <FormField label="State" htmlFor={id('state')}>
          <Input id={id('state')} value={values.state} onChange={set('state')} />
        </FormField>
        <FormField label="Pincode" htmlFor={id('pincode')}>
          <Input id={id('pincode')} inputMode="numeric" value={values.pincode} onChange={set('pincode')} />
        </FormField>
      </div>
      <div className="form-row">
        <FormField label="Bedrooms" htmlFor={id('bedrooms')} error={error('bedrooms')}>
          <Input id={id('bedrooms')} type="number" min="0" value={values.bedrooms} onChange={set('bedrooms')} />
        </FormField>
        <FormField label="Bathrooms" htmlFor={id('bathrooms')} error={error('bathrooms')}>
          <Input id={id('bathrooms')} type="number" min="0" value={values.bathrooms} onChange={set('bathrooms')} />
        </FormField>
      </div>
      <FormField label="Description" htmlFor={id('description')}>
        <Textarea id={id('description')} rows={3} value={values.description} onChange={set('description')} />
      </FormField>
      <FormField label="Property notes" htmlFor={id('notes')}>
        <Textarea id={id('notes')} rows={2} value={values.notes} onChange={set('notes')} />
      </FormField>
    </>
  );
}

/** Active users of a branch, for "assigned to" pickers. A user who cannot list users can only pick themselves. */
function UserOptions({ branchId, exclude }) {
  const { can, userId } = usePermissions();
  const canList = can('users.view');
  const users = useUsers({ branchId, isActive: 'true', limit: 100 }, { enabled: canList && Boolean(branchId) });
  const rows = canList ? (users.data?.rows ?? []) : userId ? [{ id: userId, name: 'Me' }] : [];
  return rows.filter((u) => u.id !== exclude).map((u) => <option key={u.id} value={u.id}>{u.name}</option>);
}

/**
 * Register a seller together with the first property they offer. Identity goes through the shared person
 * picker, so an existing phone links to that person instead of creating a duplicate.
 */
export function SellerCreateModal({ onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { branchIds, dataScope } = usePermissions();
  const branches = useBranches();
  const { create } = useSellerMutations();
  const picker = usePersonPicker();
  const needsBranch = dataScope === 'ALL' || branchIds.length > 1;
  const canAssign = dataScope !== 'OWN';

  const form = useForm({
    initialValues: { name: '', phone: '', email: '', address: '', branchId: '', assignedTo: '', notes: '', property: { ...EMPTY_PROPERTY } },
    schema: {
      ...personSchema(picker),
      branchId: needsBranch ? [rules.required('Choose a branch')] : [],
      'property.name': [rules.required('Describe the property the seller is offering')],
      ...nested('property', numberRules),
    },
    onSubmit: async (v) => {
      const body = {
        ...picker.payload(v),
        ...(needsBranch ? { branchId: v.branchId } : {}),
        ...(v.assignedTo ? { assignedTo: v.assignedTo } : {}),
        ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
        property: propertyPayload(v.property),
      };
      try {
        const result = await create.mutateAsync(body);
        toast.success(`Seller ${result.seller.sellerNo} registered with property ${result.property.sellerPropertyNo}`);
        onClose();
        navigate(`/sellers/${result.seller.id}`);
      } catch (err) {
        if (err.code === 'PERSON_EXISTS') return void picker.setMatch(err.details);
        throw err;
      }
    },
  });
  const branchId = needsBranch ? form.values.branchId : branchIds[0];

  return (
    <AdminFormModal open onClose={onClose} title="Register a seller" form={form} submitLabel="Register seller" size="lg">
      <p className="muted">A seller is registered together with the first property they offer. Nothing enters inventory until a purchase is completed.</p>
      <h4 className="form-section-title">Seller</h4>
      <PersonFields picker={picker} form={form} branchId={needsBranch ? form.values.branchId : undefined} />
      <div className="form-row">
        {needsBranch && (
          <FormField label="Branch" htmlFor="sc-branch" required error={form.errors.branchId}>
            <Select id="sc-branch" value={form.values.branchId} onChange={form.handleChange('branchId')}>
              <option value="">Select a branch…</option>
              {branches.data?.rows.filter((b) => b.isActive).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </Select>
          </FormField>
        )}
        {canAssign && (
          <FormField label="Handled by" htmlFor="sc-owner" hint="Their properties follow the seller's assignment.">
            <Select id="sc-owner" value={form.values.assignedTo} onChange={form.handleChange('assignedTo')} disabled={!branchId}>
              <option value="">Unassigned</option>
              <UserOptions branchId={branchId} />
            </Select>
          </FormField>
        )}
      </div>
      <FormField label="Notes about the seller" htmlFor="sc-notes">
        <Textarea id="sc-notes" rows={2} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>

      <h4 className="form-section-title">First proposed property</h4>
      <PropertyFields form={form} prefix="property" branchId={branchId} />
    </AdminFormModal>
  );
}

/** Another property from an existing seller. */
export function PropertyCreateModal({ seller, onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { addProperty } = useSellerMutations();
  const form = useForm({
    initialValues: { ...EMPTY_PROPERTY },
    schema: { name: [rules.required('Give the property a name')], ...numberRules },
    onSubmit: async (v) => {
      const p = await addProperty.mutateAsync({ id: seller.id, ...propertyPayload(v) });
      toast.success(`Property ${p.sellerPropertyNo} added`);
      onClose();
      navigate(`/sellers/properties/${p.id}`);
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Add a property from ${seller.personName}`} form={form} submitLabel="Add property" size="lg">
      <PropertyFields form={form} branchId={seller.branchId} />
    </AdminFormModal>
  );
}

/** Edit the details of a proposed property. Only offered while no Unit exists — after that the Unit is edited. */
export function PropertyEditModal({ property, onClose }) {
  const toast = useToast();
  const { updateProperty } = useSellerMutations();
  const form = useForm({
    initialValues: Object.fromEntries(Object.keys(EMPTY_PROPERTY).map((f) => [f, property[f] ?? ''])),
    schema: { name: [rules.required('Give the property a name')], ...numberRules },
    onSubmit: async (v) => {
      await updateProperty.mutateAsync({ id: property.id, ...propertyPayload(v, { original: property, clearEmpty: true }) });
      toast.success('Property updated');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Edit ${property.name}`} form={form} size="lg">
      <PropertyFields form={form} branchId={property.branchId} />
    </AdminFormModal>
  );
}

const CHECK_OUTCOMES = ['PENDING', 'PASSED', 'FAILED'];
const titleCase = (s) => s[0] + s.slice(1).toLowerCase();

export function VerificationDialog({ property, onClose }) {
  const toast = useToast();
  const { verify } = useSellerMutations();
  const existing = property.verification?.checklist ?? {};
  const form = useForm({
    initialValues: {
      outcome: property.verification?.outcome ?? 'PENDING',
      // Opens on what is already recorded rather than a blank form that would look like nothing was checked.
      checks: Object.fromEntries(CHECKLIST_FIELDS.map(([key]) => [key, existing[key] ?? 'PENDING'])),
      notes: '',
      reason: '',
    },
    schema: {
      outcome: [(v, all) => (v === 'PASSED' && Object.values(all.checks).some((c) => c !== 'PASSED') ? 'Verification can only pass when every check has passed' : null)],
    },
    onSubmit: async (v) => {
      await verify.mutateAsync({ id: property.id, outcome: v.outcome, checklist: v.checks, ...(v.notes.trim() ? { notes: v.notes.trim() } : {}), ...(v.reason.trim() ? { reason: v.reason.trim() } : {}) });
      toast.success('Verification recorded');
      onClose();
    },
  });
  const setCheck = (key) => (e) => form.setValue('checks', { ...form.values.checks, [key]: e.target.value });
  return (
    <AdminFormModal open onClose={onClose} title={`Verify ${property.name}`} form={form} submitLabel="Record verification">
      <p className="muted">Approval needs every check passed. Recording again replaces the checklist; earlier results stay in the audit trail.</p>
      <div className="form-row">
        {CHECKLIST_FIELDS.map(([key, label]) => (
          <FormField key={key} label={label} htmlFor={`sv-${key}`}>
            <Select id={`sv-${key}`} value={form.values.checks[key]} onChange={setCheck(key)}>
              {CHECK_OUTCOMES.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
            </Select>
          </FormField>
        ))}
      </div>
      <FormField label="Overall outcome" htmlFor="sv-outcome" required error={form.errors.outcome}>
        <Select id="sv-outcome" value={form.values.outcome} onChange={form.handleChange('outcome')}>
          {CHECK_OUTCOMES.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
        </Select>
      </FormField>
      <FormField label="Findings" htmlFor="sv-notes">
        <Textarea id="sv-notes" rows={2} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
      <FormField label="Reason" htmlFor="sv-reason" hint="Optional. Kept in the property history.">
        <Input id="sv-reason" value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/** One negotiation round. Rounds are appended, never overwritten, so the whole discussion survives. */
export function NegotiationDialog({ property, onClose }) {
  const toast = useToast();
  const { negotiate } = useSellerMutations();
  const latest = property.negotiations?.[0];
  const form = useForm({
    initialValues: { askingPrice: latest?.askingPrice ?? property.askingPrice ?? '', offeredPrice: '', counterPrice: '', outcome: 'PENDING', discussedOn: today(), notes: '' },
    schema: {
      askingPrice: [rules.number(), (v, all) => (v === '' && all.offeredPrice === '' && all.counterPrice === '' ? 'Record at least one price' : null)],
      offeredPrice: [rules.number()],
      counterPrice: [rules.number()],
      discussedOn: [rules.required('When did this discussion take place?')],
    },
    onSubmit: async (v) => {
      const prices = Object.fromEntries(['askingPrice', 'offeredPrice', 'counterPrice'].filter((k) => v[k] !== '').map((k) => [k, Number(v[k])]));
      await negotiate.mutateAsync({ id: property.id, ...prices, outcome: v.outcome, discussedOn: v.discussedOn, ...(v.notes.trim() ? { notes: v.notes.trim() } : {}) });
      toast.success('Negotiation round recorded');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Negotiation · ${property.name}`} form={form} submitLabel="Record this round">
      <p className="muted">Earlier rounds stay on record. Schedule the next discussion as a follow-up.</p>
      <div className="form-row">
        <FormField label="Seller asks (₹)" htmlFor="sn-asking" error={form.errors.askingPrice}>
          <Input id="sn-asking" type="number" min="0" value={form.values.askingPrice} onChange={form.handleChange('askingPrice')} />
        </FormField>
        <FormField label="We offer (₹)" htmlFor="sn-offered" error={form.errors.offeredPrice}>
          <Input id="sn-offered" type="number" min="0" value={form.values.offeredPrice} onChange={form.handleChange('offeredPrice')} />
        </FormField>
        <FormField label="They counter (₹)" htmlFor="sn-counter" error={form.errors.counterPrice}>
          <Input id="sn-counter" type="number" min="0" value={form.values.counterPrice} onChange={form.handleChange('counterPrice')} />
        </FormField>
      </div>
      <div className="form-row">
        <FormField label="Outcome" htmlFor="sn-outcome" required>
          <Select id="sn-outcome" value={form.values.outcome} onChange={form.handleChange('outcome')}>
            {['PENDING', 'AGREED', 'DECLINED', 'WITHDRAWN'].map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
          </Select>
        </FormField>
        <FormField label="Discussed on" htmlFor="sn-date" required error={form.errors.discussedOn}>
          <Input id="sn-date" type="date" max={today()} value={form.values.discussedOn} onChange={form.handleChange('discussedOn')} />
        </FormField>
      </div>
      <FormField label="Notes" htmlFor="sn-notes">
        <Textarea id="sn-notes" rows={2} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
    </AdminFormModal>
  );
}

/** Managerial approval for purchase. Only offered once the server reports no blockers. */
export function ApproveDialog({ property, onClose }) {
  const toast = useToast();
  const { approve } = useSellerMutations();
  const agreed = property.negotiations?.find((n) => n.outcome === 'AGREED');
  const form = useForm({
    initialValues: { reason: '' },
    schema: { reason: [rules.required('Give a reason for approving'), rules.minLength(3)] },
    onSubmit: async (v) => {
      await approve.mutateAsync({ id: property.id, reason: v.reason.trim() });
      toast.success(`${property.name} approved for purchase`);
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Approve ${property.name} for purchase`} form={form} submitLabel="Approve">
      <p className="muted">
        Every verification check has passed and the seller is verified.
        {agreed ? ` Last agreed price: ${formatInr(agreed.offeredPrice ?? agreed.counterPrice ?? agreed.askingPrice)}.` : ' No price has been marked agreed yet.'}
      </p>
      <FormField label="Reason" htmlFor="ap-reason" required error={form.errors.reason} hint="Kept permanently in the property history.">
        <Textarea id="ap-reason" rows={3} value={form.values.reason} onChange={form.handleChange('reason')} placeholder="Documents checked, price within budget" />
      </FormField>
    </AdminFormModal>
  );
}

/**
 * Purchase completion: the point where the company owns the asset. Records the deal and creates exactly one
 * Unit, which stays under development (not offered to buyers) until the property is released.
 */
export function PurchaseDialog({ property, onClose }) {
  const toast = useToast();
  const { purchase } = useSellerMutations();
  const agreed = property.negotiations?.find((n) => n.outcome === 'AGREED');
  const form = useForm({
    initialValues: { finalPrice: agreed?.offeredPrice ?? agreed?.counterPrice ?? property.askingPrice ?? '', purchaseDate: today(), purchaseReference: '', reason: '' },
    schema: {
      finalPrice: [rules.required('Record what was paid'), rules.number()],
      purchaseDate: [rules.required('Record the purchase date')],
      purchaseReference: [rules.required('Record the agreement or document reference'), rules.minLength(3)],
    },
    onSubmit: async (v) => {
      const result = await purchase.mutateAsync({ id: property.id, finalPrice: Number(v.finalPrice), purchaseDate: v.purchaseDate, purchaseReference: v.purchaseReference.trim(), ...(v.reason.trim() ? { reason: v.reason.trim() } : {}) });
      toast.success(result.unitCreated ? `Purchase completed — unit ${result.unitCode} created` : `This purchase was already completed (unit ${result.unitCode})`);
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Complete purchase of ${property.name}`} form={form} submitLabel="Complete purchase">
      <p className="muted">
        This records the company as owner and creates the property’s Unit in inventory, held <strong>under development</strong>: it is not
        offered to buyers or bookable until refurbishment is complete and it is released. This cannot be undone here.
      </p>
      <div className="form-row">
        <FormField label="Final price paid (₹)" htmlFor="pu-price" required error={form.errors.finalPrice}>
          <Input id="pu-price" type="number" min="0" value={form.values.finalPrice} onChange={form.handleChange('finalPrice')} />
        </FormField>
        <FormField label="Purchase date" htmlFor="pu-date" required error={form.errors.purchaseDate}>
          <Input id="pu-date" type="date" max={today()} value={form.values.purchaseDate} onChange={form.handleChange('purchaseDate')} />
        </FormField>
      </div>
      <FormField label="Agreement / document reference" htmlFor="pu-ref" required error={form.errors.purchaseReference} hint="Upload the documents themselves under Documents on this page.">
        <Input id="pu-ref" value={form.values.purchaseReference} onChange={form.handleChange('purchaseReference')} placeholder="Sale deed reg. 1234/2026" />
      </FormField>
      <FormField label="Notes" htmlFor="pu-reason">
        <Textarea id="pu-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}

const WORK_TITLES = { start: 'Start refurbishment / development', update: 'Record development progress', complete: 'Complete development' };

/** Start, update or complete development work. Every save is appended to the work log. */
export function WorkDialog({ property, mode, onClose }) {
  const toast = useToast();
  const { refurbish } = useSellerMutations();
  const form = useForm({
    initialValues: {
      workNotes: '',
      on: today(),
      estimatedCost: mode === 'start' ? '' : (property.estimatedCost ?? ''),
      actualCost: property.actualCost ?? '',
      workAssignedTo: '',
    },
    schema: {
      workNotes: mode === 'start' ? [] : [rules.required('Describe the work')],
      estimatedCost: [rules.number()],
      actualCost: [rules.number()],
    },
    onSubmit: async (v) => {
      const body = {
        action: mode,
        ...(v.workNotes.trim() ? { workNotes: v.workNotes.trim() } : {}),
        ...(mode === 'start' ? { startedOn: v.on } : mode === 'complete' ? { completedOn: v.on } : {}),
        ...(v.estimatedCost !== '' && Number(v.estimatedCost) !== property.estimatedCost ? { estimatedCost: Number(v.estimatedCost) } : {}),
        ...(v.actualCost !== '' && Number(v.actualCost) !== property.actualCost ? { actualCost: Number(v.actualCost) } : {}),
        ...(v.workAssignedTo ? { workAssignedTo: v.workAssignedTo } : {}),
      };
      await refurbish.mutateAsync({ id: property.id, ...body });
      toast.success(mode === 'start' ? 'Development started' : mode === 'complete' ? 'Development recorded as complete' : 'Progress recorded');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={WORK_TITLES[mode]} form={form} submitLabel="Save">
      {mode === 'complete' && <p className="muted">Once complete, an authorised user can release the property to buyers.</p>}
      {mode !== 'update' && (
        <FormField label={mode === 'start' ? 'Started on' : 'Completed on'} htmlFor="wk-on" required>
          <Input id="wk-on" type="date" max={today()} value={form.values.on} onChange={form.handleChange('on')} />
        </FormField>
      )}
      <FormField label="Work notes" htmlFor="wk-notes" required={mode !== 'start'} error={form.errors.workNotes}>
        <Textarea id="wk-notes" rows={3} value={form.values.workNotes} onChange={form.handleChange('workNotes')} placeholder={mode === 'start' ? 'Scope of work' : 'What was done'} />
      </FormField>
      <div className="form-row">
        <FormField label="Estimated cost (₹)" htmlFor="wk-est" error={form.errors.estimatedCost}>
          <Input id="wk-est" type="number" min="0" value={form.values.estimatedCost} onChange={form.handleChange('estimatedCost')} />
        </FormField>
        {mode !== 'start' && (
          <FormField label="Actual cost so far (₹)" htmlFor="wk-act" error={form.errors.actualCost}>
            <Input id="wk-act" type="number" min="0" value={form.values.actualCost} onChange={form.handleChange('actualCost')} />
          </FormField>
        )}
        <FormField label="Responsible person" htmlFor="wk-owner">
          <Select id="wk-owner" value={form.values.workAssignedTo} onChange={form.handleChange('workAssignedTo')}>
            <option value="">{property.workAssignedToName ? `Keep ${property.workAssignedToName}` : 'Not set'}</option>
            <UserOptions branchId={property.branchId} exclude={property.workAssignedTo} />
          </Select>
        </FormField>
      </div>
    </AdminFormModal>
  );
}

/** Release to buyers: the last gate before a seller-acquired Unit becomes selectable and bookable. */
export function ReadyToSellDialog({ property, onClose }) {
  const toast = useToast();
  const { readyToSell } = useSellerMutations();
  const form = useForm({
    initialValues: { expectedPrice: '', reason: '' },
    schema: { expectedPrice: [rules.number()] },
    onSubmit: async (v) => {
      await readyToSell.mutateAsync({ id: property.id, ...(v.expectedPrice !== '' ? { expectedPrice: Number(v.expectedPrice) } : {}), ...(v.reason.trim() ? { reason: v.reason.trim() } : {}) });
      toast.success(`${property.unitCode} is now available to buyers`);
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Release ${property.name} to buyers`} form={form} submitLabel="Mark ready to sell">
      <p className="muted">
        Unit <strong>{property.unitCode}</strong> becomes Available: it can be offered in enquiries and booked, under the usual inventory
        rules. This cannot be undone here.
      </p>
      <FormField label="Listing price (₹)" htmlFor="rs-price" error={form.errors.expectedPrice} hint={`Optional. Purchased for ${formatInr(property.purchasePrice)}.`}>
        <Input id="rs-price" type="number" min="0" value={form.values.expectedPrice} onChange={form.handleChange('expectedPrice')} />
      </FormField>
      <FormField label="Reason" htmlFor="rs-reason" hint="Optional. Kept in the property history.">
        <Textarea id="rs-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}

const CLOSE_COPY = {
  reject: { title: 'Reject', verb: 'Reject property', done: 'rejected', prompt: 'Why is the company declining this property?' },
  withdraw: { title: 'Mark withdrawn', verb: 'Mark withdrawn', done: 'marked withdrawn', prompt: 'Why did the seller withdraw?' },
};

/** Close a proposal: the company rejects it, or the seller withdraws it. Both are final and need a reason. */
export function ClosePropertyDialog({ property, kind, onClose }) {
  const toast = useToast();
  const mutations = useSellerMutations();
  const copy = CLOSE_COPY[kind];
  const form = useForm({
    initialValues: { reason: '' },
    schema: { reason: [rules.required(copy.prompt), rules.minLength(3)] },
    onSubmit: async (v) => {
      await mutations[kind].mutateAsync({ id: property.id, reason: v.reason.trim() });
      toast.success(`${property.name} ${copy.done}`);
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`${copy.title}: ${property.name}`} form={form} submitLabel={copy.verb}>
      <p className="muted">This closes the property. It cannot be reopened; its history is kept.</p>
      <FormField label="Reason" htmlFor="cl-reason" required error={form.errors.reason}>
        <Textarea id="cl-reason" rows={3} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}

/** Seller relationship status. Only the moves the server allows for this seller and user are offered. */
export function SellerStatusDialog({ seller, onClose }) {
  const toast = useToast();
  const { setSellerStatus } = useSellerMutations();
  const statuses = useMasterOptions(['SELLER_STATUS']);
  const label = (key) => statuses.data?.SELLER_STATUS?.find((s) => s.systemKey === key)?.label ?? titleCase(key);
  const targets = seller.allowed?.statusTargets ?? [];
  const form = useForm({
    initialValues: { to: targets.length === 1 ? targets[0] : '', reason: '' },
    schema: { to: [rules.required('Choose a status')], reason: [rules.required('Give a reason'), rules.minLength(3)] },
    onSubmit: async (v) => {
      await setSellerStatus.mutateAsync({ id: seller.id, to: v.to, reason: v.reason.trim() });
      toast.success(`Seller is now ${label(v.to)}`);
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Change status of ${seller.personName}`} form={form} submitLabel="Update status">
      <p className="muted">
        Currently {seller.status?.label ?? seller.statusKey}. This is the seller relationship; each property keeps its own status.
        A seller must be verified before any of their properties can be approved or bought.
      </p>
      <FormField label="New status" htmlFor="ss-to" required error={form.errors.to}>
        <Select id="ss-to" value={form.values.to} onChange={form.handleChange('to')}>
          <option value="">Select a status…</option>
          {targets.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </Select>
      </FormField>
      <FormField label="Reason" htmlFor="ss-reason" required error={form.errors.reason} hint="Kept permanently in the seller history.">
        <Textarea id="ss-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}

/** (Re)assign the seller. Their properties follow, so the new person sees the whole relationship. */
export function SellerAssignDialog({ seller, onClose }) {
  const toast = useToast();
  const { assign } = useSellerMutations();
  const reassigning = Boolean(seller.assignedTo);
  const form = useForm({
    initialValues: { assignedTo: '', reason: '' },
    schema: { assignedTo: [rules.required('Choose who handles this seller')], reason: reassigning ? [rules.required('Give a reason for reassigning')] : [] },
    onSubmit: async (v) => {
      await assign.mutateAsync({ id: seller.id, assignedTo: v.assignedTo, ...(v.reason.trim() ? { reason: v.reason.trim() } : {}) });
      toast.success('Assignment saved');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`${reassigning ? 'Reassign' : 'Assign'} ${seller.sellerNo}`} form={form}>
      {reassigning && <p className="muted">Currently handled by {seller.assignedToName ?? 'another user'}. Their properties move with the seller.</p>}
      <FormField label="Handled by" htmlFor="sa-user" required error={form.errors.assignedTo}>
        <Select id="sa-user" value={form.values.assignedTo} onChange={form.handleChange('assignedTo')}>
          <option value="">Select a person…</option>
          <UserOptions branchId={seller.branchId} exclude={seller.assignedTo} />
        </Select>
      </FormField>
      <FormField label="Reason" htmlFor="sa-reason" required={reassigning} error={form.errors.reason}>
        <Textarea id="sa-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}

export function SellerNotesModal({ seller, onClose }) {
  const toast = useToast();
  const { update } = useSellerMutations();
  const form = useForm({
    initialValues: { notes: seller.notes ?? '' },
    onSubmit: async (v) => {
      await update.mutateAsync({ id: seller.id, notes: v.notes.trim() || null });
      toast.success('Seller updated');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Edit ${seller.personName}`} form={form}>
      <p className="muted">Name and phone belong to the person record and are edited there, so every relationship stays in step.</p>
      <FormField label="Notes" htmlFor="sn-notes2">
        <Textarea id="sn-notes2" rows={4} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
    </AdminFormModal>
  );
}
