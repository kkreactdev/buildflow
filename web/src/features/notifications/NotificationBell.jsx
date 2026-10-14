import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationMutations, useNotifications, useUnreadCount } from '../../api/notifications';
import { IconButton } from '../../components/ui/IconButton';
import { BellIcon } from '../../components/ui/icons';
import { usePermissions } from '../../hooks/usePermissions';
import { formatRelativeTime } from '../../lib/format';
import '../followups/followups.css';
import { notificationTarget } from './notificationLinks';

/** Header bell: unread count (polled) and the latest notifications. Only rendered for users who may view them. */
export function NotificationBell() {
  const { can } = usePermissions();
  const allowed = can('notifications.view');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const count = useUnreadCount({ enabled: allowed });
  const recent = useNotifications({ limit: 8 }, { enabled: allowed && open, poll: open });
  const { markRead, markAllRead } = useNotificationMutations();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!allowed) return null;
  const unread = count.data?.unread ?? 0;

  function openItem(n) {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    const to = notificationTarget(n.refs);
    if (to) navigate(to);
  }

  return (
    <div className="bell" ref={ref}>
      <IconButton icon={<BellIcon size={17} />} label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      {unread > 0 && <span className="bell-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-panel-head">
            <span>Notifications</span>
            <button type="button" className="btn btn-ghost" disabled={unread === 0 || markAllRead.isPending} onClick={() => markAllRead.mutate()}>Mark all read</button>
          </div>
          {recent.isPending && <div className="notif-item">Loading…</div>}
          {recent.isError && <div className="notif-item">Could not load notifications.</div>}
          {recent.data?.rows.length === 0 && <div className="notif-item">You're all caught up.</div>}
          {recent.data?.rows.map((n) => (
            <button key={n.id} type="button" className={`notif-item ${n.read ? '' : 'is-unread'}`} onClick={() => openItem(n)}>
              <div className="notif-title">{n.title}</div>
              {n.body && <div className="notif-body">{n.body}</div>}
              <div className="notif-time">{formatRelativeTime(n.createdAt)}</div>
            </button>
          ))}
          <button type="button" className="notif-item" onClick={() => { setOpen(false); navigate('/notifications'); }}>View all notifications</button>
        </div>
      )}
    </div>
  );
}
