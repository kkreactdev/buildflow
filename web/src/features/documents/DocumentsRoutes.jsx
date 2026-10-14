import { Route, Routes } from 'react-router-dom';
import { DocumentDetailPage } from './DocumentDetailPage';
import { DocumentsPage } from './DocumentsPage';

export function DocumentsRoutes() {
  return (
    <Routes>
      <Route index element={<DocumentsPage />} />
      <Route path=":id" element={<DocumentDetailPage />} />
    </Routes>
  );
}
