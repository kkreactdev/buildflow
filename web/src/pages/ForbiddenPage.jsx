import { EmptyState } from '../components/ui/EmptyState';
import { LockIcon } from '../components/ui/icons';

export function ForbiddenPage() {
  return <EmptyState icon={<LockIcon size={28} />} title="You don't have access to this page" description="Ask an administrator to grant the required permission." />;
}
