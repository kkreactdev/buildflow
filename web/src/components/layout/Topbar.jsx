import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { CompanyName } from '../brand/CompanyBrand';
import { ActionMenu } from '../ui/ActionMenu';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/IconButton';
import { GlobalSearch } from '../../features/search/GlobalSearch';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import { LogOutIcon, MenuIcon, MoonIcon, SunIcon } from '../ui/icons';
import './Topbar.css';

function initialsOf(name) {
  return (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export function Topbar({ onMenuClick }) {
  const { user, signOut } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <header className="topbar">
      <IconButton className="topbar-menu" icon={<MenuIcon size={18} />} label="Open menu" onClick={onMenuClick} />
      {/* The company name, not the page name: every page already renders its own heading in the
          content below, so repeating it here printed "Enquiries" twice. */}
      <CompanyName className="topbar-title" />
      <div className="topbar-spacer" />
      <GlobalSearch />
      <IconButton
        icon={resolvedTheme === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />}
        label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        onClick={toggleTheme}
      />
      <NotificationBell />
      <div className="topbar-user">
        <Avatar initials={initialsOf(user?.name)} size="sm" />
        <span className="topbar-user-name">{user?.name}</span>
        <ActionMenu label="Account" items={[{ label: 'Sign out', icon: <LogOutIcon size={15} />, onSelect: () => void signOut() }]} />
      </div>
    </header>
  );
}
