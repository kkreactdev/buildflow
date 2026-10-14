import { Route, Routes } from 'react-router-dom';
import { UnitDetailPage } from './UnitDetailPage';
import { UnitsPage } from './UnitsPage';

export function UnitsRoutes() {
  return (
    <Routes>
      <Route index element={<UnitsPage />} />
      <Route path=":id" element={<UnitDetailPage />} />
    </Routes>
  );
}
