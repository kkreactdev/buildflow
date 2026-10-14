import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProgressPill } from './RelationPill';

/** On the unit: which enquiries are considering it (only those the viewer may see). The relationship itself is managed from the enquiry or client. */
export function UnitInterestedEnquiries({ unit }) {
  const data = unit.interests;
  if (!data?.visible) return null;
  const rows = data.rows.filter((i) => i.status === 'INTERESTED');
  return (
    <Card className="detail-card" aria-label="Interested enquiries">
      <h3>Interested enquiries</h3>
      {rows.length === 0 ? (
        <EmptyState title="No enquiries are considering this unit" description="Add the unit from an enquiry or a client. It does not change the unit's status." />
      ) : (
        <ul className="history-list" aria-label="Enquiries interested in this unit">
          {rows.map((i) => (
            <li key={i.id}>
              <Link to={`/enquiries/${i.enquiryId}`}><strong>{i.enquiryNo}</strong></Link>{i.enquiry?.name ? ` · ${i.enquiry.name}` : ''} <ProgressPill progress={i.progress} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
