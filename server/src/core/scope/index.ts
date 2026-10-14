// Public surface of the scope layer. `systemRepo` is intentionally NOT re-exported:
// importing it requires the explicit path `core/scope/system`, which is easy to audit.
export { scopedRepo, ScopedRepo, type RepoOptions } from './scopedRepo';
export { scopePlugin, branchOwnedFields, softDeleteFields } from './scopePlugin';
export { ScopeRequiredError } from './grant';
export { resolveScope, resolveWriteBranch, assertBranchWritable, allowedBranchSet, type ScopeSpec } from './scopeResolver';
export { resolveWriteScope } from './scopeResolver';
