import { Route, Routes } from 'react-router-dom';
import { SellerDetailPage } from './SellerDetailPage';
import { SellerPropertyDetailPage } from './SellerPropertyDetailPage';
import { SellersPage } from './SellersPage';

/**
 * `properties/:id` is declared before `:id` so a property id is never mistaken for a seller id.
 * The two live under one module because they are one workflow read at two levels.
 */
export function SellersRoutes() {
  return (
    <Routes>
      <Route index element={<SellersPage />} />
      <Route path="properties/:id" element={<SellerPropertyDetailPage />} />
      <Route path=":id" element={<SellerDetailPage />} />
    </Routes>
  );
}