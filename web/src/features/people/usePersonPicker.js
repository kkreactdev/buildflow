import { useState } from 'react';
import { linkPerson, lookupPhone } from '../../api/clients';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';

/**
 * Duplicate-aware person entry, shared by every form that creates a record for a person (clients,
 * enquiries). The phone number is checked BEFORE saving:
 *  - no match: new identity details are collected and the person is created with the record;
 *  - match you can see: the existing record is shown and you must explicitly choose "Use this person";
 *  - match only in another branch: you learn that it exists (nothing more) and, if allowed, can link it
 *    to your branch with a reason.
 * The server repeats every check; this flow only makes the outcome clear. Nothing is merged silently.
 */
export function usePersonPicker() {
  const { can } = usePermissions();
  const toast = useToast();
  const [match, setMatch] = useState(null);
  const [usePerson, setUsePerson] = useState(null);
  const [linkReason, setLinkReason] = useState('');
  const [linking, setLinking] = useState(false);
  const [lookupError, setLookupError] = useState(null);

  async function check(phone) {
    setLookupError(null);
    if (usePerson || !can('persons.lookup') || !phone || rules.phone()(phone)) return;
    try {
      setMatch(await lookupPhone(phone));
    } catch (err) {
      setLookupError(err.message);
    }
  }

  async function link(phone, branchId) {
    setLinking(true);
    try {
      const res = await linkPerson({ phone, reason: linkReason, ...(branchId ? { branchId } : {}) });
      setUsePerson(res.person);
      setMatch(null);
      toast.success('Linked to your branch');
    } catch (err) {
      setLookupError(err.message);
    } finally {
      setLinking(false);
    }
  }

  /** The `personId` or `person` part of a create request. */
  const payload = (v) =>
    usePerson ? { personId: usePerson.id } : { person: { name: v.name, phone: v.phone, ...(v.email ? { email: v.email } : {}), ...(v.address ? { address: v.address } : {}) } };

  return { match, setMatch, usePerson, setUsePerson, linkReason, setLinkReason, linking, lookupError, check, link, payload };
}

/** Validation rules for the person fields (a chosen existing person needs no name). */
export const personSchema = (picker) => ({
  name: [(v, all) => (picker.usePerson ? null : rules.required('Enter a name')(v, all)), (v) => (!picker.usePerson && v && v.trim().length < 2 ? 'At least 2 characters' : null)],
  phone: [rules.required('Enter a phone number'), rules.phone()],
  email: [rules.email()],
});
