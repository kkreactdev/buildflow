import { NavLink } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { useSidebarPreference } from '../../hooks/useSidebarPreference';
import { visibleModules } from '../../app/modules';
import { ChevronRightIcon, CloseIcon } from '../ui/icons';
import { CompanyBrand } from '../brand/CompanyBrand';
import './Sidebar.css';

/**
 * A navigation link. `aria-label` is always present so the link keeps its accessible name when the
 * label is visually hidden in the collapsed rail, and `title` supplies a tooltip in that state only.
 * The tooltip is the browser's own, deliberately: this sidebar scrolls (`overflow-y: auto`), so any
 * tooltip element rendered inside it would be clipped at the edge — a native one never is.
 */
function NavItem({ module: m, collapsed, onNavigate }) {
  const Icon = m.icon;
  return (
    <NavLink
      to={m.path}
      onClick={onNavigate}
      aria-label={m.label}
      title={collapsed ? m.label : undefined}
      className={({ isActive }) => `sidebar-link ${isActive ? 'is-active' : ''}`}
    >
      <Icon size={18} />
      <span className="sidebar-link-label">{m.label}</span>
    </NavLink>
  );
}

/**
 * Navigation is generated from the module registry and filtered by permission
 * keys. Groups with no visible items are not rendered at all.
 *
 * Collapsed, the rail keeps icons only: labels and group headings are removed from the layout
 * entirely (not merely faded) so no fragment of text or empty band is left behind, and the current
 * page keeps its full background highlight rather than only a colour change.
 */
export function Sidebar({ mobileOpen, onCloseMobile }) {
  const { can } = usePermissions();
  const { collapsed, toggle } = useSidebarPreference();
  const modules = visibleModules(can);
  const primary = modules.filter((m) => !m.group);
  const groups = [...new Set(modules.filter((m) => m.group).map((m) => m.group))];

  return (
    <>
      {mobileOpen && <div className="sidebar-scrim" onClick={onCloseMobile} aria-hidden="true" />}
      <aside
        className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-open' : ''}`}
        aria-label="Primary"
        data-collapsed={collapsed ? 'true' : 'false'}
      >
        <div className="sidebar-brand">
          <CompanyBrand variant="logo" className="sidebar-logo" />
          <CompanyBrand variant="mark" className="sidebar-mark" />
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls="sidebar-nav"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronRightIcon size={16} className="sidebar-toggle-icon" />
          </button>
          <button type="button" className="sidebar-close" onClick={onCloseMobile} aria-label="Close menu">
            <CloseIcon size={16} />
          </button>
        </div>
        <nav className="sidebar-nav" id="sidebar-nav">
          {primary.map((m) => (
            <NavItem key={m.key} module={m} collapsed={collapsed} onNavigate={onCloseMobile} />
          ))}
          {groups.map((group) => (
            <div key={group} className="sidebar-group">
              <div className="sidebar-group-label">{group}</div>
              {modules
                .filter((m) => m.group === group)
                .map((m) => (
                  <NavItem key={m.key} module={m} collapsed={collapsed} onNavigate={onCloseMobile} />
                ))}
            </div>
          ))}
          {modules.length === 0 && <p className="sidebar-empty">No modules available for your role.</p>}
        </nav>
      </aside>
    </>
  );
}
