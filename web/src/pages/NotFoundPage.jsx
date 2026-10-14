import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';

export function NotFoundPage() {
  return <EmptyState title="Page not found" description="The page you are looking for does not exist." action={<Link to="/dashboard">Go to dashboard</Link>} />;
}
