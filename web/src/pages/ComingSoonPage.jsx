import { EmptyState } from '../components/ui/EmptyState';

/** Placeholder mounted for every module until its implementation-plan phase lands. */
export function ComingSoonPage({ module }) {
  return (
    <EmptyState
      title={`${module.label} is coming soon`}
      description={`This module is scheduled for Phase ${module.phase} of the implementation plan.`}
    />
  );
}
