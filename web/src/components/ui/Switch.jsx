import './Switch.css';

export function Switch({ checked, onChange, label, description }) {
  return (
    <label className="switch-row">
      <span className="switch-row-text">
        <span className="switch-row-label">{label}</span>
        {description && <span className="switch-row-description">{description}</span>}
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track">
          <span className="switch-thumb" />
        </span>
      </span>
    </label>
  );
}
