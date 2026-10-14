import { useNavigate } from 'react-router-dom';
import { useNotificationMutations, useNotifications } from '../../api/notifications';
import { QueryState } from '../../components/data/QueryState';
import { Button } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { Segmented } from '../../components/ui/Segmented';
import { useTableState } from '../../hooks/useTableState';
import { formatDateTime } from '../../lib/format';
import '../followups/followups.css';
import { notificationTarget } from './notificationLinks';

const TABS = [{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }];

export function NotificationsPage() {
  const navigate = useNavigate();
  const table = useTableState({ defaultSort: '-createdAt', defaultLimit: 25, filterKeys: ['view'] });
  const tab = table.params.view === 'unread' ? 'unread' : 'all';
  const query = useNotifications({ page: table.params.page, limit: table.params.limit, ...(tab === 'unread' ? { unread: true } : {}) }, { poll: true });
  const { markRead, markAllRead } = useNotificationMutations();
  const unread = query.data?.meta.unread ?? 0;

  return (
    <div>
      <div className="page-header">
        <h2>Notifications</h2>
        <Button variant="secondary" disabled={unread === 0 || markAllRead.isPending} onClick={() => markAllRead.mutate()}>Mark all read</Button>
      </div>
      <div className="enq-toolbar">
        <Segmented options={TABS.map((t) => (t.value === 'unread' ? { ...t, label: `Unread (${unread})` } : t))} value={tab} onChange={(v) => table.setFilter('view', v === 'unread' ? 'unread' : '')} aria-label="Notification filter" />
      </div>
      <QueryState query={query} isEmpty={(d) => d.rows.length === 0} empty={{ title: tab === 'unread' ? 'No unread notifications' : 'No notifications yet', description: "You'll be told here when a follow-up is assigned, due soon or missed." }}>
        {(data) => (
          <>
            <div className="data-table-wrap">
              {data.rows.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`notif-item ${n.read ? '' : 'is-unread'}`}
                  onClick={() => {
                    if (!n.read) markRead.mutate(n.id);
                    const to = notificationTarget(n.refs);
                    if (to) navigate(to);
                  }}
                >
                  <div className="notif-title">{n.title}</div>
                  {n.body && <div className="notif-body">{n.body}</div>}
                  <div className="notif-time">{formatDateTime(n.createdAt)}{n.read ? '' : ' · unread'}</div>
                </button>
              ))}
            </div>
            <Pagination page={data.meta.page} pageSize={data.meta.limit} totalCount={data.meta.total} totalPages={Math.max(1, Math.ceil(data.meta.total / data.meta.limit))} onPageChange={table.setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}
