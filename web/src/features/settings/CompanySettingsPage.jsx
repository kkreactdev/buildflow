import { useState } from 'react';
import { useCompanyMutations, useCompanyProfile } from '../../api/company';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import './company-settings.css';

/** Convenience only for the file picker; the server decides by the file's real bytes and enforces the size limit. */
const ACCEPT = 'image/jpeg,image/png,image/webp';

const SLOTS = [
  { key: 'logo', label: 'Full logo', hint: 'Icon plus company name. Shown in the sidebar and on the login page.' },
  { key: 'mark', label: 'Icon / mark', hint: 'The icon alone. Shown when the sidebar is collapsed.' },
  { key: 'logoDark', label: 'Full logo (dark)', hint: 'Optional. Falls back to the light logo on dark backgrounds.' },
  { key: 'markDark', label: 'Icon / mark (dark)', hint: 'Optional. Falls back to the light mark on dark backgrounds.' },
];

/** One logo slot: current artwork, replace and remove. */
function LogoField({ slot, image, canManage, onUpload, onRemove, busy }) {
  const [error, setError] = useState(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again after a failure
    if (!file) return;
    setError(null);
    try {
      await onUpload(slot.key, file);
    } catch (err) {
      // The server's message is the useful one: wrong type, too large, or the upload failed.
      setError(err.message);
    }
  }

  return (
    <div className="logo-field">
      <div className="logo-preview">
        {image?.url ? <img src={image.url} alt={`${slot.label} preview`} /> : <span className="muted">Not set</span>}
      </div>
      <div className="logo-field-body">
        <strong>{slot.label}</strong>
        <p className="muted">{slot.hint}</p>
        {image?.url && <p className="muted logo-field-meta">{image.format?.toUpperCase()} · {Math.round((image.bytes ?? 0) / 1024)} KB</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {canManage && (
          <div className="logo-field-actions">
            <input id={`logo-${slot.key}`} type="file" accept={ACCEPT} onChange={pick} aria-label={`Upload ${slot.label}`} disabled={busy} />
            {image?.url && <Button variant="ghost" onClick={() => onRemove(slot.key)} disabled={busy}>Remove</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The details form. Mounted only once the profile has loaded, so `initialValues` are correct on the
 * first render and no effect is needed to seed it — a later refetch re-renders but does not overwrite
 * what the user has typed.
 */
function DetailsForm({ profile, canManage }) {
  const toast = useToast();
  const { update } = useCompanyMutations();

  const form = useForm({
    initialValues: {
      displayName: profile.displayName ?? '',
      legalName: profile.legalName ?? '',
      phone: profile.phone ?? '',
      email: profile.email ?? '',
      website: profile.website ?? '',
      gstin: profile.gstin ?? '',
      address: profile.address ?? '',
    },
    schema: {
      displayName: [rules.required('Enter the company name'), rules.maxLength(120)],
      email: [rules.email()],
      gstin: [rules.maxLength(20)],
    },
    onSubmit: async (v) => {
      await update.mutateAsync({
        displayName: v.displayName.trim(),
        // An empty string is sent as null: it clears the field rather than storing a blank.
        legalName: v.legalName.trim() || null,
        phone: v.phone.trim() || null,
        email: v.email.trim() || null,
        website: v.website.trim() || null,
        gstin: v.gstin.trim() || null,
        address: v.address.trim() || null,
      });
      toast.success('Company details saved');
    },
  });

  return (
    <Card className="detail-card" aria-label="Company details">
      <h3>Company details</h3>
      <form onSubmit={form.handleSubmit} noValidate>
        <FormField label="Company name" htmlFor="co-name" required error={form.errors.displayName} hint="Shown across the app. This is the only required field.">
          <Input id="co-name" value={form.values.displayName} onChange={form.handleChange('displayName')} disabled={!canManage} autoComplete="organization" />
        </FormField>
        <div className="unit-grid-2">
          <FormField label="Legal name" htmlFor="co-legal" error={form.errors.legalName} hint="If it differs from the company name.">
            <Input id="co-legal" value={form.values.legalName} onChange={form.handleChange('legalName')} disabled={!canManage} />
          </FormField>
          <FormField label="GSTIN" htmlFor="co-gstin" error={form.errors.gstin}>
            <Input id="co-gstin" value={form.values.gstin} onChange={form.handleChange('gstin')} disabled={!canManage} maxLength={20} />
          </FormField>
        </div>
        <div className="unit-grid-2">
          <FormField label="Phone" htmlFor="co-phone" error={form.errors.phone}>
            <Input id="co-phone" type="tel" value={form.values.phone} onChange={form.handleChange('phone')} disabled={!canManage} />
          </FormField>
          <FormField label="Email" htmlFor="co-email" error={form.errors.email}>
            <Input id="co-email" type="email" value={form.values.email} onChange={form.handleChange('email')} disabled={!canManage} />
          </FormField>
        </div>
        <FormField label="Website" htmlFor="co-web" error={form.errors.website} hint="Include https://">
          <Input id="co-web" value={form.values.website} onChange={form.handleChange('website')} disabled={!canManage} />
        </FormField>
        <FormField label="Address" htmlFor="co-addr" error={form.errors.address}>
          <Textarea id="co-addr" rows={3} value={form.values.address} onChange={form.handleChange('address')} disabled={!canManage} />
        </FormField>

        {form.formError && <p className="form-error" role="alert">{form.formError}</p>}

        {canManage ? (
          <div className="detail-actions">
            <Button type="submit" disabled={form.submitting || update.isPending}>{form.submitting ? 'Saving…' : 'Save details'}</Button>
          </div>
        ) : (
          <p className="muted" role="note">You can view these details but not change them.</p>
        )}
      </form>
    </Card>
  );
}

/**
 * Company Settings — the name and artwork shown across the app, plus optional legal details.
 *
 * Every mutation invalidates the branding query, so saving here updates the sidebar, topbar and login
 * page in place: no rebuild, no sign-out, no reload.
 */
export function CompanySettingsPage() {
  const { can } = usePermissions();
  const toast = useToast();
  const canManage = can('company.manage');
  const query = useCompanyProfile(can('company.view'));
  const { uploadLogo, removeLogo } = useCompanyMutations();
  const profile = query.data;
  const busy = uploadLogo.isPending || removeLogo.isPending;

  async function upload(slot, file) {
    await uploadLogo.mutateAsync({ slot, file });
    toast.success('Logo updated');
  }
  async function remove(slot) {
    try {
      await removeLogo.mutateAsync(slot);
      toast.success('Logo removed');
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!can('company.view')) {
    return (
      <div>
        <div className="page-header"><h2>Company Settings</h2></div>
        <EmptyState title="You don't have permission to view company settings" description="Ask an administrator to grant the company settings permission." />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header"><h2>Company Settings</h2></div>
      {query.isPending && <Skeleton height={220} />}
      {query.isError && <EmptyState title="Could not load company settings" description={query.error.message} action={<Button onClick={() => query.refetch()}>Try again</Button>} />}

      {profile && (
        <>
          <Card className="detail-card" aria-label="Logo and name">
            <h3>Logo and name</h3>
            <p className="muted">
              These appear in the sidebar, the header and the login page. Leave a dark variant empty to fall back to the light one.
            </p>
            {SLOTS.map((slot) => (
              <LogoField
                key={slot.key}
                slot={slot}
                image={profile[slot.key]}
                canManage={canManage}
                busy={busy}
                onUpload={upload}
                onRemove={remove}
              />
            ))}
          </Card>

          <DetailsForm profile={profile} canManage={canManage} />
        </>
      )}
    </div>
  );
}