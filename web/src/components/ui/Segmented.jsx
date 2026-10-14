import './Segmented.css';
export function Segmented({
  options,
  value,
  onChange,
  disabled = false,
  ...rest
}) {
  return <div className={`segmented ${disabled ? 'is-disabled' : ''}`} role="tablist" aria-disabled={disabled || undefined} {...rest}>
      {options.map(opt => <button key={opt.value} type="button" role="tab" aria-selected={opt.value === value} disabled={disabled} className={`segmented-item ${opt.value === value ? 'is-active' : ''}`} onClick={() => !disabled && onChange(opt.value)}>
          {opt.label}
        </button>)}
    </div>;
}