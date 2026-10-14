import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { createKeys } from './queryKeys';

export const relatedKeys = createKeys('client-related');

/** Everything connected to a client (enquiries, follow-ups, site visits, bookings, units), resolved and scoped by the server. */
export const useClientRelated = (clientId) => useQuery({ queryKey: relatedKeys.detail(clientId), queryFn: () => api.get(`clients/${clientId}/related`), enabled: Boolean(clientId) });

/**
 * Units the caller can offer as a NEW interest for an enquiry, right now. The server filters out
 * SOLD / booked / on-hold / archived units so the picker never shows a choice the API would reject.
 * The query key sits under the `units` namespace so existing invalidations refresh it.
 */
export const useEligibleUnitsForEnquiry = (enquiryId, params, options = {}) =>
  useQuery({
    queryKey: ['units', 'eligible-for-enquiry', enquiryId, params ?? {}],
    queryFn: ({ signal }) => api.list(`enquiries/${enquiryId}/eligible-units`, { query: params, signal }),
    placeholderData: keepPreviousData,
    enabled: Boolean(enquiryId) && (options.enabled ?? true),
  });

/**
 * The units ALREADY linked to an enquiry, resolved server-side from the one relationship model
 * (interests + bookings + visits merged, one row per unit). This is what a picker should offer, so
 * it never has to fall back to "every unit in the branch".
 *
 * `data` is `{ units: [...] }`, and `units` is `null` — not `[]` — when the caller may not view units.
 * Callers must keep that distinction: "you may not see units" and "this enquiry has none" are
 * different answers and need different words on screen.
 */
export const useEnquiryLinkedUnits = (enquiryId) =>
  useQuery({
    queryKey: ['units', 'linked-for-enquiry', enquiryId],
    queryFn: ({ signal }) => api.get(`enquiries/${enquiryId}/units`, { signal }),
    enabled: Boolean(enquiryId),
  });

/**
 * The units linked to a CLIENT across ALL of its enquiries, deduplicated server-side: a unit three
 * of their enquiries touch is one row carrying all three references under `via`. Same null-vs-empty
 * rule as the enquiry version.
 */
export const useClientLinkedUnits = (clientId) =>
  useQuery({
    queryKey: ['units', 'linked-for-client', clientId],
    queryFn: ({ signal }) => api.get(`clients/${clientId}/units`, { signal }),
    enabled: Boolean(clientId),
  });

/**
 * Unit interest links an enquiry's person to a unit. It changes no enquiry stage, unit status or booking, so only the screens
 * that SHOW interests are refreshed (enquiry, unit, client), plus the timeline.
 */
export function useUnitInterestMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['enquiries'] }),
    qc.invalidateQueries({ queryKey: ['units'] }),
    qc.invalidateQueries({ queryKey: ['client-related'] }),
    qc.invalidateQueries({ queryKey: ['clients'] }),
    qc.invalidateQueries({ queryKey: ['activities'] }),
  ]);
  return {
    add: useMutation({ mutationFn: ({ enquiryId, ...body }) => api.post(`enquiries/${enquiryId}/unit-interests`, body), onSuccess: refresh }),
    withdraw: useMutation({ mutationFn: ({ id, ...body }) => api.post(`unit-interests/${id}/withdraw`, body), onSuccess: refresh }),
  };
}
