import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { createKeys } from './queryKeys';

export const notificationKeys = createKeys('notifications');
const POLL_MS = 30_000;

/** Unread count for the bell; polled so new alerts appear without a reload. */
export const useUnreadCount = ({ enabled = true } = {}) =>
  useQuery({ queryKey: [...notificationKeys.all, 'unread'], queryFn: () => api.get('notifications/unread-count'), refetchInterval: POLL_MS, enabled, retry: false });

export const useNotifications = (params, { enabled = true, poll = false } = {}) =>
  useQuery({ queryKey: notificationKeys.list(params), queryFn: ({ signal }) => api.list('notifications', { query: params, signal }), placeholderData: keepPreviousData, refetchInterval: poll ? POLL_MS : false, enabled });

export function useNotificationMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: notificationKeys.all });
  return {
    markRead: useMutation({ mutationFn: (id) => api.post(`notifications/${id}/read`, {}), onSuccess: done }),
    markAllRead: useMutation({ mutationFn: () => api.post('notifications/read-all', {}), onSuccess: done }),
  };
}
