import type { ChatProvider } from '../ProviderBadge';

/**
 * How the "Rewind to here" action should be presented for a given turn.
 *
 * - `hidden`   — the provider has no native rewind primitive (codex), so the
 *                action is not offered at all.
 * - `disabled` — the provider supports rewind, but this turn was recorded
 *                before anchors were captured, so there is nothing to rewind to.
 * - `enabled`  — provider supports rewind and the turn carries an anchor.
 */
export type RewindCapability = 'hidden' | 'disabled' | 'enabled';

/** Tooltip shown on the disabled menu item so the state is self-explaining. */
export const REWIND_NO_ANCHOR_TOOLTIP = 'This turn predates rewind support';

/**
 * Providers whose SDK exposes a native rewind primitive. Codex has none
 * (neither its SDK nor the app-server protocol), so rewind is never offered
 * there rather than being offered and then rejected by the backend.
 */
const REWIND_CAPABLE_PROVIDERS: ReadonlySet<string> = new Set<ChatProvider>(['copilot', 'claude', 'opencode']);

/**
 * Derive the rewind affordance for a user turn, client-side, from the process
 * provider plus whether the turn captured an SDK anchor (`sdkEventId`). No API
 * round-trip: both inputs already ride along with the conversation payload.
 *
 * An unknown/absent provider is treated as capable — the backend stays the
 * definitive gate and will surface a typed error if it is not.
 */
export function resolveRewindCapability(provider: ChatProvider | undefined, sdkEventId: string | undefined): RewindCapability {
    if (provider && !REWIND_CAPABLE_PROVIDERS.has(provider)) return 'hidden';
    return sdkEventId ? 'enabled' : 'disabled';
}

/**
 * Tooltip shown on the "Edit message" pencil while the conversation is not
 * idle. Editing rewinds + resends, and the rewind route rejects a busy
 * conversation with 409 `CONVERSATION_NOT_IDLE`, so the button is disabled
 * up-front rather than failing on click.
 */
export const EDIT_BUSY_TOOLTIP = 'The conversation is busy';
