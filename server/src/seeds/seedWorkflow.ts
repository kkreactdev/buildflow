import { WorkflowStage } from '../modules/workflow/workflow.model';
import { CANONICAL_STAGES } from '../modules/workflow/workflowDefaults';

export interface SeedWorkflowResult {
  created: string[];
  existing: string[];
}

/**
 * Idempotent. Missing canonical stages are inserted with their initial label,
 * colour and position. Existing stages keep their administrator-chosen label,
 * colour, description, position and (for non-system stages) active state, but
 * the system-managed rules (entry policy, domain operation, active for core
 * stages) are re-asserted on every run.
 */
export async function seedWorkflow(): Promise<SeedWorkflowResult> {
  const result: SeedWorkflowResult = { created: [], existing: [] };
  let order = 0;
  for (const def of CANONICAL_STAGES) {
    if (def.kind === 'FLOW') order++;
    const res = await WorkflowStage.updateOne(
      { systemKey: def.systemKey },
      {
        $setOnInsert: {
          systemKey: def.systemKey, label: def.label, description: def.description, color: def.color,
          order: def.kind === 'FLOW' ? order : 1000, kind: def.kind, isSystem: true,
        },
        $set: { entryPolicy: def.entryPolicy, domainOperation: def.domainOperation ?? null, isActive: true },
      },
      { upsert: true, overwriteImmutable: true },
    );
    (res.upsertedCount ? result.created : result.existing).push(def.systemKey);
  }
  return result;
}
