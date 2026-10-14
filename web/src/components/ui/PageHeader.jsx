import './PageHeader.css';

/** Title, optional subtitle and an actions slot, in one consistent header for every page. */
export function PageHeader({ title, subtitle, actions, eyebrow }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <p className="page-head-eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {subtitle && <p className="page-head-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  );
}
