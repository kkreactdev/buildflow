import { Route, Routes } from 'react-router-dom';
import { EnquiriesPage } from './EnquiriesPage';
import { EnquiryDetailPage } from './EnquiryDetailPage';

export function EnquiriesRoutes() {
  return (
    <Routes>
      <Route index element={<EnquiriesPage />} />
      <Route path=":id" element={<EnquiryDetailPage />} />
    </Routes>
  );
}
