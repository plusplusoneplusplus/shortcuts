/**
 * Ralph task-kind discriminator.
 *
 * A queued `mode: 'ralph'` task can be one of three things, distinguished only
 * by which optional marker `context.ralph` carries. Both the executor (which
 * decides whether to rewrite the prompt) and the completion router in
 * `queue-executor-bridge.ts` (which decides where to route the result) need the
 * same answer, so the mapping lives here rather than being re-derived from
 * `ralphCtx.finalCheck` / `ralphCtx.submit` at each call site.
 *
 * Pure — no I/O, no dependencies beyond the context type.
 */

import type { RalphContext } from '../tasks/task-types';

export type RalphTaskKind = 'iteration' | 'final-check' | 'submit';

/** Single source of truth for which kind of Ralph task a payload carries. */
export function getRalphTaskKind(ctx?: RalphContext): RalphTaskKind {
    if (ctx?.finalCheck) return 'final-check';
    if (ctx?.submit) return 'submit';
    return 'iteration';
}
