import { Route, Routes } from 'react-router-dom';
import { BookingDetailPage } from './BookingDetailPage';
import { BookingsPage } from './BookingsPage';
import { ConflictsPage } from './ConflictsPage';

export function BookingsRoutes() {
  return (
    <Routes>
      <Route index element={<BookingsPage />} />
      <Route path="conflicts" element={<ConflictsPage />} />
      <Route path=":id" element={<BookingDetailPage />} />
    </Routes>
  );
}
