import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppProviders } from '../app/AppProviders';

export function renderWithApp(ui, { session = null, route = '/' } = {}) {
  return render(
    <AppProviders initialSession={session}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </AppProviders>,
  );
}

export const session = (permissions, extra = {}) => ({
  user: { name: 'Test User' },
  permissions,
  dataScope: 'BRANCH',
  branchIds: [],
  ...extra,
});
