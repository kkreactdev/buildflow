import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';

export const companyKeys = {
  all: ['company'],
  branding: () => ['company', 'branding'],
  profile: () => ['company', 'profile'],
};

/**
 * The branding shown before anyone signs in, so the login page can render it. Public by design and
 * deliberately tiny: a display name and four image URLs, never the legal or contact details.
 */
export const useCompanyBranding = () =>
  useQuery({ queryKey: companyKeys.branding(), queryFn: () => api.get('company/branding'), staleTime: 5 * 60_000 });

/** The full profile for the settings screen. Server answers with an empty profile rather than 404. */
export const useCompanyProfile = (enabled = true) =>
  useQuery({ queryKey: companyKeys.profile(), queryFn: () => api.get('company'), enabled, staleTime: 30_000 });

/**
 * Saving invalidates BOTH keys, so the sidebar, topbar and login page pick the new name and logos up
 * straight away — no rebuild, no sign-out, no reload.
 */
export function useCompanyMutations() {
  const qc = useQueryClient();
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: companyKeys.all })]);
  return {
    update: useMutation({ mutationFn: (body) => api.patch('company', body), onSuccess: done }),
    uploadLogo: useMutation({
      mutationFn: ({ slot, file }) => {
        const form = new FormData();
        form.append('file', file); // last, so the server has the fields before the file stream
        return api.upload(`company/logo/${slot}`, form);
      },
      onSuccess: done,
    }),
    removeLogo: useMutation({ mutationFn: (slot) => api.delete(`company/logo/${slot}`), onSuccess: done }),
  };
}