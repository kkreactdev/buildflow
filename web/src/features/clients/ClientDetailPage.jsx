import { DocumentsPanel } from '../documents/DocumentsPanel';
import { MakeReferrerButton } from '../referrals/MakeReferrerButton';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useClient, useClientMutations, useTimeline } from '../../api/clients';
import { useClientRelated } from '../../api/relations';
import { ClientRelatedSections } from './ClientRelatedSections';
import { Timeline } from '../../components/data/Timeline';
import { MasterSelect } from '../../components/data/MasterSelect';
import { QueryState } from '../../components/data/QueryState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Pill } from '../../components/ui/Pill';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { formatDateTime } from '../../lib/format';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import { CategoryPill } from './ClientsPage';
import './clients.css';

function EditClientModal({ client, onClose }) {
  const toast = useToast();
  const { can } = usePermissions();
  const { update, updatePerson } = useClientMutations();
  const editIdentity = can('persons.edit') && Boolean(client.person);
  const form = useForm({
    initialValues: {
      categoryId: client.categoryId ?? '',
      notes: client.notes ?? '',
      name: client.person?.name ?? client.name,
      phone: client.person?.phoneE164 ?? client.phoneE164,
      email: client.person?.email ?? '',
      address: client.person?.address ?? '',
    },
    schema: editIdentity ? { name: [rules.required(), rules.minLength(2)], phone: [rules.required(), rules.phone()], email: [rules.email()] } : {},
    onSubmit: async (v) => {
      await update.mutateAsync({ id: client.id, categoryId: v.categoryId || null, notes: v.notes || null });
      if (editIdentity) {
        const p = client.person;
        const patch = {};
        if (v.name !== p.name) patch.name = v.name;
        if (v.phone !== p.phoneE164 && v.phone !== p.phone) patch.phone = v.phone;
        if (v.email !== (p.email ?? '')) patch.email = v.email || null;
        if (v.address !== (p.address ?? '')) patch.address = v.address || null;
        if (Object.keys(patch).length) await updatePerson.mutateAsync({ id: p.id, ...patch });
      }
      toast.success('Client updated');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Edit ${client.name}`} form={form}>
      {editIdentity && (
        <>
          <p className="muted">Identity details are shared with every branch this person is related to.</p>
          <FormField label="Name" htmlFor="e-name" required error={form.errors.name}><Input id="e-name" value={form.values.name} onChange={form.handleChange('name')} /></FormField>
          <FormField label="Phone" htmlFor="e-phone" required error={form.errors.phone}><Input id="e-phone" value={form.values.phone} onChange={form.handleChange('phone')} /></FormField>
          <FormField label="Email" htmlFor="e-email" error={form.errors.email}><Input id="e-email" type="email" value={form.values.email} onChange={form.handleChange('email')} /></FormField>
          <FormField label="Address" htmlFor="e-addr"><Input id="e-addr" value={form.values.address} onChange={form.handleChange('address')} /></FormField>
        </>
      )}
      <FormField label="Category" htmlFor="e-cat" hint={client.category && !client.category.isActive ? `Current category “${client.category.label}” is inactive; it stays until you choose another.` : undefined}>
        <MasterSelect id="e-cat" type="CLIENT_CATEGORY" value={form.values.categoryId} onChange={form.handleChange('categoryId')} placeholder="No category" />
      </FormField>
      <FormField label="Notes" htmlFor="e-notes" hint="Visible only to this branch.">
        <Textarea id="e-notes" rows={3} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
    </AdminFormModal>
  );
}

function ClientDetail({ client }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = usePermissions();
  const { archive } = useClientMutations();
  const related = useClientRelated(client.id);
  const canSeeTimeline = can('activities.view');
  const timeline = useTimeline('client', canSeeTimeline ? client.id : null); // no request at all without the permission
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const person = client.person;

  return (
    <div>
      <div className="detail-head">
        <div>
          <Link to="/clients" className="muted">← Clients</Link>
          <h2>{client.name} {client.isArchived && <Pill label="Archived" size="sm" />}</h2>
          <span className="id-chip">{client.clientNo}</span>
        </div>
        <div className="detail-actions">
          {!client.isArchived && <MakeReferrerButton client={client} />}
          {can('clients.edit') && !client.isArchived && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
          {can('clients.archive') && !client.isArchived && <Button variant="danger" onClick={() => setArchiving(true)}>Archive</Button>}
        </div>
      </div>

      <div className="detail-grid">
        <Card className="detail-card">
          <h3>Identity</h3>
          <dl className="kv">
            <dt>Name</dt><dd>{person?.name ?? client.name}</dd>
            <dt>Phone</dt><dd><a href={`tel:${client.phoneE164}`}>{person?.phone ?? client.phone}</a></dd>
            <dt>Email</dt><dd>{person?.email ?? '—'}</dd>
            <dt>Address</dt><dd>{person?.address ?? '—'}</dd>
          </dl>
        </Card>
        <Card className="detail-card">
          <h3>Relationship</h3>
          <dl className="kv">
            <dt>Client ID</dt><dd className="id-chip">{client.clientNo}</dd>
            <dt>Branch</dt><dd>{client.branch?.name ?? '—'}</dd>
            <dt>Category</dt><dd><CategoryPill category={client.category} /></dd>
            <dt>Assigned to</dt><dd>{client.assignedToName ?? '—'}</dd>
            <dt>Notes</dt><dd>{client.notes ?? '—'}</dd>
            <dt>Created</dt><dd>{formatDateTime(client.createdAt)}</dd>
          </dl>
        </Card>

        {client.relationships.length > 0 && (
          <Card className="detail-card detail-section-full">
            <h3>Other branch relationships you can see</h3>
            <ul>
              {client.relationships.map((r) => (
                <li key={r.id}><Link to={`/clients/${r.id}`}>{r.clientNo}</Link> · {r.branch?.name ?? 'Branch'}</li>
              ))}
            </ul>
          </Card>
        )}

        <ClientRelatedSections related={related} />

        <DocumentsPanel entityType="client" entityId={client.id} canAdd={!client.isArchived} />

        {canSeeTimeline && (
          <Card className="detail-card detail-section-full">
            <h3>Activity</h3>
            <Timeline query={timeline} emptyDescription="Events for this client will appear here." />
          </Card>
        )}
      </div>

      {editing && <EditClientModal client={client} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        title={`Archive ${client.name}?`}
        description="The client disappears from lists but its history is kept. The person can become a client of this branch again later."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(client.id);
          toast.success('Client archived');
          navigate('/clients');
        }}
      />
    </div>
  );
}

export function ClientDetailPage() {
  const { id } = useParams();
  const query = useClient(id);
  return (
    <QueryState query={query} isEmpty={(d) => !d} empty={{ title: 'Client not found' }}>
      {(client) => <ClientDetail client={client} />}
    </QueryState>
  );
}
