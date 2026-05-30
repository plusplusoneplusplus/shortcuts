/**
 * effortUtils — pure helpers for the reasoning-effort smart-defaults feature.
 *
 * `deriveEffort` is the single derivation function used by both NewChatArea
 * (new-chat auto-derive) and ChatDetail (existing-chat init + mid-conversation
 * model swap).  Keeping it as a free function makes it trivially unit-testable.
 */
import type { EffortLevel } from '../features/chat/EffortPillSelector';

/**
 * Derive the reasoning-effort override to show in the pill selector, given:
 *  - `preferred`  — the user's stored preference for this model
 *                   (from `GET /api/agent-providers/<provider>/models/reasoning-efforts`)
 *  - `supported`  — list of effort levels the model accepts
 *                   (from the model catalog's `supportedReasoningEfforts`)
 *  - `capabilitySupportsReasoning` — `false` when the model explicitly opts out
 *                   of reasoning (i.e. `capabilities.supports.reasoningEffort === false`)
 *
 * Returns the derived `EffortLevel` to pre-select, or `null` (Auto).
 */
export function deriveEffort(
    preferred: string | undefined,
    supported: readonly string[] | undefined,
    capabilitySupportsReasoning: boolean,
): EffortLevel | null {
    if (!capabilitySupportsReasoning) return null;
    if (!preferred) return null;
    if (supported && supported.length > 0 && !supported.includes(preferred)) return null;
    return preferred as EffortLevel;
}
