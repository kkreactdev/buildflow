import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './http';
import { createKeys } from './queryKeys';

export const dashboardKeys = createKeys('dashboard');

/** `params`: { from, to, branchId, assignedTo, sourceId, propertyTypeId, buildingTypeId }. The server scopes every number to the caller. */
const dashboardQuery = (part, params, enabled = true) => ({
  queryKey: [...dashboardKeys.all, part, params],
  queryFn: ({ signal }) => api.get(`dashboard/${part}`, { query: params, signal }),
  placeholderData: keepPreviousData,
  enabled,
  retry: false,
});

export const useDashboardSummary = (params) => useQuery(dashboardQuery('summary', params));
export const useDashboardFunnel = (params, enabled) => useQuery(dashboardQuery('funnel', params, enabled));
export const useDashboardSources = (params, enabled) => useQuery(dashboardQuery('sources', params, enabled));
export const useDashboardPerformance = (params, enabled) => useQuery(dashboardQuery('performance', params, enabled));
