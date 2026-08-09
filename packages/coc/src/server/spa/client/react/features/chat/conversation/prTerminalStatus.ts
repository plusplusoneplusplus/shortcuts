/**
 * The single source of truth for "this pull request is settled".
 *
 * A terminal PR needs nothing further from the user and can never change state
 * again, which is why the same predicate drives three different behaviours:
 * {@link PrStatusCard} mutes terminal rows, {@link isPrItemActive} stops polling
 * them, and {@link partitionComposerPrChips} folds them into the composer's
 * "earlier PRs" row.
 */

/** PR lifecycle states that are settled — no further user action or polling. */
export const TERMINAL_PR_STATES: ReadonlySet<string> = new Set<string>(['merged', 'closed']);

/** Whether a PR status string is settled. Missing/unknown statuses are not. */
export function isTerminalPrStatus(status: string | undefined): boolean {
    return !!status && TERMINAL_PR_STATES.has(status);
}
