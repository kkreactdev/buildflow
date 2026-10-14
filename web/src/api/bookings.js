import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activityKeys } from './clients';
import { enquiryKeys } from './enquiries';
import { api } from './http';
import { createKeys } from './queryKeys';
import { unitKeys } from './units';

export const bookingKeys = createKeys('bookings');
export const conflictKeys = createKeys('booking-conflicts');

export const useBookings = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: bookingKeys.list(params), queryFn: ({ signal }) => api.list('bookings', { query: params, signal }), placeholderData: keepPreviousData, enabled });

export const useBooking = (id) => useQuery({ queryKey: bookingKeys.detail(id), queryFn: () => api.get(`bookings/${id}`), enabled: Boolean(id) });

export const useConflicts = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: conflictKeys.list(params), queryFn: ({ signal }) => api.list('booking-conflicts', { query: params, signal }), placeholderData: keepPreviousData, enabled });

/**
 * A booking changes the unit, the enquiry's stage, the timeline and the conflict queue, so every operation refreshes all
 * of them. This also runs when the server REFUSES (for example a conflict): the screen then shows the unit's real state
 * instead of a stale one, and nothing is ever marked booked before the server says so.
 */
export function useBookingMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([bookingKeys, conflictKeys, unitKeys, enquiryKeys, activityKeys].map((k) => qc.invalidateQueries({ queryKey: k.all })).concat(qc.invalidateQueries({ queryKey: ['audit'] })));
  const opts = { onSettled: refresh };
  return {
    create: useMutation({ mutationFn: (body) => api.post('bookings', body), ...opts }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`bookings/${id}`, body), ...opts }),
    release: useMutation({ mutationFn: ({ id, ...body }) => api.post(`bookings/${id}/release`, body), ...opts }),
    resolve: useMutation({ mutationFn: ({ id, ...body }) => api.post(`booking-conflicts/${id}/resolve`, body), ...opts }),
  };
}
