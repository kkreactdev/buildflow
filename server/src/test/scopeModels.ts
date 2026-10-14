import { model, Schema } from 'mongoose';
import { branchOwnedFields, scopePlugin, softDeleteFields } from '../core/scope/scopePlugin';
import type { Principal } from '../core/permissions/principal';

/**
 * Test-only models standing in for future business modules. `Widget` follows the
 * branch-ownership convention (branchId + assignee + soft delete); `Gadget` is a
 * second scoped collection; `Note` is deliberately NOT scoped (global data).
 */
const widgetSchema = new Schema({ name: String, amount: Number, assignedTo: Schema.Types.ObjectId, ...branchOwnedFields, ...softDeleteFields });
widgetSchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'assignedTo' });
export const Widget = model('Widget', widgetSchema);

const gadgetSchema = new Schema({ name: String, ...branchOwnedFields });
gadgetSchema.plugin(scopePlugin, { branchField: 'branchId' });
export const Gadget = model('Gadget', gadgetSchema);

export const Note = model('Note', new Schema({ text: String }));

export function principal(dataScope: Principal['dataScope'], branchIds: string[] = [], userId = '64b0000000000000000000a1'): Principal {
  return { userId, permissions: new Set(), dataScope, branchIds };
}

/** A "shared" model: records without a branch are global (readable by all in scope, writable only by ALL). */
const sharedSchema = new Schema({ name: String, branchId: { type: Schema.Types.ObjectId } });
sharedSchema.plugin(scopePlugin, { branchField: 'branchId', shared: true });
export const Shared = model('Shared', sharedSchema);
