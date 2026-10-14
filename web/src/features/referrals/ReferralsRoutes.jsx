import { Route, Routes } from 'react-router-dom';
import { ReferralDetailPage } from './ReferralDetailPage';
import { ReferralsPage } from './ReferralsPage';

export function ReferralsRoutes() {
  return (
    <Routes>
      <Route index element={<ReferralsPage />} />
      <Route path=":id" element={<ReferralDetailPage />} />
    </Routes>
  );
}
