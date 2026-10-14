import { Route, Routes } from 'react-router-dom';
import { SiteVisitDetailPage } from './SiteVisitDetailPage';
import { SiteVisitsPage } from './SiteVisitsPage';

export function SiteVisitsRoutes() {
  return (
    <Routes>
      <Route index element={<SiteVisitsPage />} />
      <Route path=":id" element={<SiteVisitDetailPage />} />
    </Routes>
  );
}
