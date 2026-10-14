import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './http';
import { createKeys } from './queryKeys';

export const reportKeys = createKeys('reports');

export const useReportCatalog = () => useQuery({ queryKey: reportKeys.lists(), queryFn: () => api.get('reports') });

/** One report page; `params` are that report's own filters plus page / limit / sort. Filtering and paging happen on the server. */
export const useReport = (key, params) =>
  useQuery({ queryKey: reportKeys.list({ key, ...params }), queryFn: ({ signal }) => api.get(`reports/${key}`, { query: params, signal }), enabled: Boolean(key), placeholderData: keepPreviousData, retry: false });

/** The CSV uses the same filters (and the same server-side authorization) as the table; page and limit do not apply. */
export function downloadReport(key, params) {
  const { page: _page, limit: _limit, ...filters } = params ?? {};
  return api.download(`reports/${key}/export.csv`, { query: filters, filename: `${key}-report.csv` });
}
