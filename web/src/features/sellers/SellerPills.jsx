import { StatusPill } from '../../components/ui/StatusPill';
import { Pill } from '../../components/ui/Pill';

/**
 * Seller and proposed-property badges. The label comes from the SELLER_STATUS / PROPERTY_STATUS
 * master, so renaming a status in Masters renames it here; the colour is the shared semantic one
 * for the states the whole app already knows about.
 */
export function SellerStatusPill({ seller }) {
  return <StatusPill statusKey={seller.statusKey} label={seller.status?.label} color={seller.status?.color} />;
}

export function PropertyStatusPill({ property }) {
  return <StatusPill statusKey={property.statusKey} label={property.status?.label} color={property.status?.color} />;
}

/** Buyers may only see a property's Unit once the property is released. Shown wherever eligibility matters. */
export function EligibilityPill({ property }) {
  if (property.eligibleForBuyers) return <Pill label="Eligible for buyers" size="sm" dot color="#16a34a" bg="#16a34a22" />;
  if (!property.unitId) return <span className="muted">Not yet inventory</span>;
  return <Pill label="Withheld from buyers" size="sm" dot color="#b45309" bg="#b4530919" />;
}