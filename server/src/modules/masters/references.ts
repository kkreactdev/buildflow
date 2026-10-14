import type { Types } from 'mongoose';

/**
 * Hard deletion of a master value is only allowed when nothing references it.
 * Each business module registers, for every master type it stores, a checker
 * that answers "is this value used by any record?" (including archived ones).
 * Until at least one checker is registered for a type, deletion of that type is
 * refused (we cannot prove it is unused), and deactivation is the way to retire
 * a value. Historical records keep displaying an inactive value.
 */
export type ReferenceChecker = (masterId: Types.ObjectId) => Promise<boolean>;

const checkers = new Map<string, ReferenceChecker[]>();

export function registerMasterReference(type: string, checker: ReferenceChecker): void {
  checkers.set(type, [...(checkers.get(type) ?? []), checker]);
}

export const hasReferenceCheckers = (type: string): boolean => (checkers.get(type)?.length ?? 0) > 0;

export async function isMasterReferenced(type: string, id: Types.ObjectId): Promise<boolean> {
  for (const check of checkers.get(type) ?? []) if (await check(id)) return true;
  return false;
}

/** Test helper. */
export const clearMasterReferences = (): void => checkers.clear();
