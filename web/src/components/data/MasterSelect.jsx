import { useMasterOptions } from '../../api/masters';
import { Select } from '../ui/Select';

/**
 * A dropdown backed by a master type. Options come from the API (active values,
 * in the admin-configured order) — pages never hard-code them. If the record
 * already holds a value that has since been deactivated, it is still shown
 * (marked "inactive") so history stays meaningful, but it cannot be newly chosen
 * once changed.
 */
export function MasterSelect({ type, value, onChange, branchId, placeholder = 'Select…', id, disabled, ...rest }) {
  // One request for active + inactive values; inactive ones are only kept when they are the current value.
  const { data, isPending, isError } = useMasterOptions([type], { branchId, includeInactive: true });
  const rows = data?.[type] ?? [];
  const options = rows.filter((m) => m.isActive || m._id === value);

  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled || isPending} {...rest}>
      <option value="">{isPending ? 'Loading…' : isError ? 'Could not load options' : placeholder}</option>
      {options.map((m) => (
        <option key={m._id} value={m._id}>
          {m.label}
          {m.isActive ? '' : ' (inactive)'}
        </option>
      ))}
    </Select>
  );
}
