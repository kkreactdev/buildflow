/**
 * Duplicate-aware person entry fields (see usePersonPicker for the flow and its rules).
 */
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import '../clients/clients.css';

export function PersonFields({ picker, form, branchId }) {
  const { usePerson, match } = picker;
  const visible = match?.status === 'VISIBLE_MATCH' ? match : null;
  return (
    <>
      <FormField label="Phone" htmlFor="pf-phone" required error={form.errors.phone} hint="Any common format. Used to detect existing people.">
        <Input
          id="pf-phone"
          inputMode="tel"
          value={form.values.phone}
          disabled={Boolean(usePerson)}
          onChange={(e) => {
            form.handleChange('phone')(e);
            picker.setMatch(null);
          }}
          onBlur={() => picker.check(form.values.phone)}
        />
      </FormField>

      {picker.lookupError && <p className="form-error" role="alert">{picker.lookupError}</p>}

      {visible && !usePerson && (
        <div className="match-box is-warning" role="status">
          <strong>This person already exists</strong>
          <span>
            {visible.person.name} · {visible.person.phone}
            {visible.clients?.length ? ` · already a client (${visible.clients.map((c) => c.clientNo).join(', ')})` : ''}
          </span>
          <div>
            <Button variant="secondary" onClick={() => picker.setUsePerson(visible.person)}>Use this person</Button>
          </div>
        </div>
      )}
      {match?.status === 'HIDDEN_MATCH' && (
        <div className="match-box is-info" role="status">
          <strong>This number is already registered with another branch</strong>
          {match.canLink ? (
            <>
              <span>You can link the existing person to your branch instead of creating a duplicate. Say why:</span>
              <Input aria-label="Reason for linking" placeholder="e.g. Customer relocated to our city" value={picker.linkReason} onChange={(e) => picker.setLinkReason(e.target.value)} />
              <div>
                <Button variant="secondary" onClick={() => picker.link(form.values.phone, branchId)} disabled={picker.linking || picker.linkReason.trim().length < 3}>{picker.linking ? 'Linking…' : 'Link to my branch'}</Button>
              </div>
            </>
          ) : (
            <span>Ask a manager to link this number to your branch.</span>
          )}
        </div>
      )}
      {match?.status === 'CLIENT_EXISTS' && (
        <div className="match-box is-warning" role="alert">
          <strong>{match.message}</strong>
        </div>
      )}
      {usePerson && (
        <div className="match-box is-info" role="status">
          <strong>Using existing person</strong>
          <span>{usePerson.name} · {usePerson.phone}</span>
          <div>
            <Button variant="ghost" onClick={() => picker.setUsePerson(null)}>Choose a different number</Button>
          </div>
        </div>
      )}

      {!usePerson && (
        <>
          <FormField label="Name" htmlFor="pf-name" required error={form.errors.name}>
            <Input id="pf-name" value={form.values.name} onChange={form.handleChange('name')} />
          </FormField>
          <FormField label="Email" htmlFor="pf-email" error={form.errors.email}>
            <Input id="pf-email" type="email" value={form.values.email} onChange={form.handleChange('email')} />
          </FormField>
          <FormField label="Address" htmlFor="pf-address">
            <Input id="pf-address" value={form.values.address} onChange={form.handleChange('address')} />
          </FormField>
        </>
      )}
    </>
  );
}
