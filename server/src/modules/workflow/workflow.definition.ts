import { AppError } from '../../lib/appError';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import type { PermissionKey } from '../../core/permissions/catalog';
import { LAST_STAGE, type DomainOperation, type EntryPolicy, type StageKind } from './workflowDefaults';

export interface StageView {
  id: string;
  systemKey: string;
  label: string;
  order: number;
  kind: StageKind;
  entryPolicy: EntryPolicy;
  domainOperation?: string;
  isActive: boolean;
  isSystem: boolean;
}

export type Direction = 'FORWARD' | 'BACKWARD' | 'LOST' | 'REOPEN';

export interface TransitionRequest {
  from: string;
  to: string;
  principal: Principal;
  reason?: string;
  /**
   * Set ONLY by server-side domain services (schedule visit, book, convert…) acting
   * under their own authorization. It is what allows entering a DOMAIN-controlled
   * stage. It is never read from a client request.
   */
  via?: DomainOperation;
}

export interface TransitionPlan {
  from: StageView;
  to: StageView;
  direction: Direction;
  reason?: string;
}

/** Extra business rules registered by later modules (e.g. "cannot leave BOOKED while a booking is active"). */
export type TransitionGuard = (plan: TransitionPlan, ctx: { principal: Principal }) => void | Promise<void>;
const guards: TransitionGuard[] = [];
export function registerTransitionGuard(guard: TransitionGuard): void {
  guards.push(guard);
}
export const clearTransitionGuards = (): void => void (guards.length = 0);

export const PERM = {
  forward: 'enquiries.edit',
  backward: 'enquiries.revert',
  lose: 'enquiries.lose',
  reopen: 'enquiries.reopen',
} as const satisfies Record<string, PermissionKey>;

const MAX_REASON = 500;

export interface AvailableTransition {
  to: string;
  direction: Direction;
  requiresReason: boolean;
  /** Present when the target can only be entered through a domain operation (open that dialog instead of a plain move). */
  domainOperation?: string;
}

/**
 * The enquiry state machine over a snapshot of the configured stages. It is a
 * pure function of (stages, request): no database access, so the API, the
 * Kanban endpoint and future bulk actions all share one set of rules, and the
 * rules are unit-testable. Persisting the move atomically is the caller's job.
 */
export class WorkflowDefinition {
  private readonly byKey = new Map<string, StageView>();
  /** Active FLOW stages in order. */
  readonly chain: StageView[];

  constructor(readonly stages: StageView[]) {
    for (const s of stages) this.byKey.set(s.systemKey, s);
    this.chain = stages.filter((s) => s.kind === 'FLOW' && s.isActive).sort((a, b) => a.order - b.order);
  }

  get(key: string): StageView {
    const s = this.byKey.get(key);
    if (!s) throw new AppError('UNKNOWN_STAGE', 409, `Unknown workflow stage "${key}"`);
    return s;
  }

  /** The immediately following ACTIVE stage (works even if `key` itself was later deactivated). */
  next(key: string): StageView | undefined {
    const from = this.get(key);
    return from.kind === 'FLOW' ? this.chain.find((s) => s.order > from.order) : undefined;
  }

  /** Earlier active stages, nearest first. */
  previous(key: string): StageView[] {
    const from = this.get(key);
    return from.kind === 'FLOW' ? this.chain.filter((s) => s.order < from.order).reverse() : [];
  }

  /** Validates a move and returns the plan to execute, or throws the reason it is refused. */
  async plan(req: TransitionRequest): Promise<TransitionPlan> {
    const { principal, via } = req;
    const from = this.get(req.from);
    const to = this.get(req.to);
    const reason = req.reason?.trim() || undefined;

    if (from.systemKey === to.systemKey) throw new AppError('NO_CHANGE', 409, 'The enquiry is already in that stage');
    if (!to.isActive) throw new AppError('STAGE_INACTIVE', 409, `Stage "${to.label}" is not active`);

    const need = (perm: PermissionKey, what: string) => {
      if (!hasPermission(principal, perm)) throw AppError.forbidden(`Missing permission to ${what}: ${perm}`);
    };
    const needReason = (what: string) => {
      if (!reason) throw AppError.validation(`A reason is required to ${what}`, [{ path: 'reason', message: 'Required' }]);
      if (reason.length > MAX_REASON) throw AppError.validation(`Reason is too long (max ${MAX_REASON})`, [{ path: 'reason', message: 'Too long' }]);
    };

    let direction: Direction;
    if (from.kind === 'LOST') {
      // Reopen: back into the open pipeline, only to stages a person may enter directly.
      need(PERM.reopen, 'reopen an enquiry');
      if (to.kind !== 'FLOW' || to.entryPolicy !== 'MANUAL') {
        throw new AppError('REOPEN_TARGET', 409, `A lost enquiry cannot be reopened into "${to.label}"`);
      }
      needReason('reopen an enquiry');
      direction = 'REOPEN';
    } else if (to.kind === 'LOST') {
      // A converted enquiry is a client now; it can no longer be lost.
      if (from.systemKey === LAST_STAGE) throw new AppError('TERMINAL_STAGE', 409, `A ${from.label.toLowerCase()} enquiry cannot be marked lost`);
      need(PERM.lose, 'mark an enquiry lost');
      needReason('mark an enquiry lost');
      direction = 'LOST';
    } else if (to.order > from.order) {
      direction = 'FORWARD';
      if (!via) need(PERM.forward, 'move an enquiry forward');
      // A domain operation is a real activity being recorded (a visit is being scheduled, a booking
      // made, a conversion done), not a claim that the intermediate stages happened. Those stages
      // describe sales progress that a walk-in — someone who comes straight to the office to see a
      // unit — genuinely never passed through, so forcing them would mean inventing history to
      // record something that really happened. The activity itself is still audited, and the stage
      // jump is still recorded in stage history with its real reason, so the trail is complete.
      //
      // Adjacency therefore applies only to manual moves (`!via`). Every other rule below is
      // unchanged: DOMAIN_ONLY still stops a domain stage being entered by hand or by the wrong
      // operation, and BACKWARD still needs its own permission and a reason.
      if (!via) {
        const next = this.next(from.systemKey);
        if (!next || next.systemKey !== to.systemKey) {
          throw new AppError('STAGE_SKIP', 409, `Cannot move from "${from.label}" to "${to.label}": stages cannot be skipped${next ? ` (next is "${next.label}")` : ''}`, { next: next?.systemKey });
        }
      }
      if (to.entryPolicy === 'DOMAIN' && via !== to.domainOperation) {
        throw new AppError('DOMAIN_ONLY', 409, `"${to.label}" can only be entered through its own action (${to.domainOperation}), not by moving the enquiry`, { domainOperation: to.domainOperation });
      }
    } else {
      direction = 'BACKWARD';
      need(PERM.backward, 'move an enquiry backward');
      needReason('move an enquiry backward');
    }

    const plan: TransitionPlan = { from, to, direction, reason };
    for (const g of guards) await g(plan, { principal });
    return plan;
  }

  /** What the principal could do from `from`, for the UI (Kanban drop targets, action menus). */
  availableTransitions(fromKey: string, principal: Principal): AvailableTransition[] {
    const from = this.get(fromKey);
    const out: AvailableTransition[] = [];
    const add = (s: StageView, direction: Direction, requiresReason: boolean) =>
      out.push({ to: s.systemKey, direction, requiresReason, ...(s.entryPolicy === 'DOMAIN' && direction === 'FORWARD' ? { domainOperation: s.domainOperation } : {}) });

    if (from.kind === 'LOST') {
      if (hasPermission(principal, PERM.reopen)) for (const s of this.chain) if (s.entryPolicy === 'MANUAL') add(s, 'REOPEN', true);
      return out;
    }
    const next = this.next(from.systemKey);
    if (next && hasPermission(principal, PERM.forward)) add(next, 'FORWARD', false);
    if (hasPermission(principal, PERM.backward)) for (const s of this.previous(from.systemKey)) add(s, 'BACKWARD', true);
    if (hasPermission(principal, PERM.lose)) for (const s of this.stages) if (s.kind === 'LOST' && s.isActive) add(s, 'LOST', true);
    return out;
  }
}
