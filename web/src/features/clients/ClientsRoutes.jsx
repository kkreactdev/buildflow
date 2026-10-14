import { Route, Routes } from 'react-router-dom';
import { ClientDetailPage } from './ClientDetailPage';
import { ClientsPage } from './ClientsPage';

export function ClientsRoutes() {
  return (
    <Routes>
      <Route index element={<ClientsPage />} />
      <Route path=":id" element={<ClientDetailPage />} />
    </Routes>
  );
}
