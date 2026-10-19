/**
 * Sentinel additional instructions: user-authored plain text saved per
 * Sentinel conversation at `metadata.additionalInstructions`, gated by the
 * default-off `features.sentinelAdditionalInstructions` flag.
 *
 * Saving only persists the text. It never interrupts or restarts work; the
 * executor reads the saved value when Sentinel context is next built. The
 * value belongs to one chat and is never copied into forks, delegated jobs or
 * child conversations.
 */

import type { GenericProcessMetadata, ProcessStore } from '@plusplusoneplusplus/forge';
import {
    SENTINEL_ADDITIONAL_INSTRUCTIONS_MAX_CHARS,
    type ProcessAdditionalInstructions,
} from '@plusplusoneplusplus/coc-client';
import { processOperationAdmission } from './process-operation-admission';

export const ADDITIONAL_INSTRUCTIONS_METADATA_KEY = 'additionalInstructions';

/** Saved text for a conversation; missing or malformed state reads as empty. */
export function readAdditionalInstructions(metadata: GenericProcessMetadata | undefined): ProcessAdditionalInstructions {
    const value = metadata?.[ADDITIONAL_INSTRUCTIONS_METADATA_KEY] as Partial<ProcessAdditionalInstructions> | undefined;
    if (!value || typeof value !== 'object' || typeof value.text !== 'string' || !value.text.trim()) return { text: '' };
    return typeof value.updatedAt === 'string' ? { text: value.text, updatedAt: value.updatedAt } : { text: value.text };
}

/** Validates a save body; returns normalized text, or an error message. */
export function parseAdditionalInstructionsRequest(body: unknown): { text: string } | string {
    const value = body as { text?: unknown } | undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'additional instructions must be an object';
    const extra = Object.keys(value).filter(key => key !== 'text');
    if (extra.length > 0) return `unknown field: ${extra[0]}`;
    if (typeof value.text !== 'string') return 'text must be a string';
    const text = value.text.replace(/\r\n?/g, '\n').trim();
    if (text.length > SENTINEL_ADDITIONAL_INSTRUCTIONS_MAX_CHARS) {
        return `text exceeds ${SENTINEL_ADDITIONAL_INSTRUCTIONS_MAX_CHARS} characters`;
    }
    return { text };
}

/**
 * Persist (or clear, for blank text) a conversation's additional instructions,
 * preserving all other metadata. Returns `undefined` when the process is gone.
 */
export async function saveAdditionalInstructions(
    store: ProcessStore, processId: string, workspaceId: string | undefined, text: string,
): Promise<ProcessAdditionalInstructions | undefined> {
    return processOperationAdmission.runExclusive(processId, async () => {
        const proc = await store.getProcess(processId, workspaceId);
        if (!proc) return undefined;
        const metadata: GenericProcessMetadata = { ...(proc.metadata ?? { type: 'chat' }) };
        const trimmed = text.trim();
        const next: ProcessAdditionalInstructions = trimmed
            ? { text: trimmed, updatedAt: new Date().toISOString() }
            : { text: '' };
        if (trimmed) metadata[ADDITIONAL_INSTRUCTIONS_METADATA_KEY] = next;
        else delete metadata[ADDITIONAL_INSTRUCTIONS_METADATA_KEY];
        await store.updateProcess(proc.id, { metadata });
        return next;
    });
}

// ============================================================================
// Context injection
// ============================================================================

/** Tag wrapping the saved text when it rides an outgoing Sentinel user turn. */
export const ADDITIONAL_INSTRUCTIONS_TAG = 'coc-sentinel-additional-instructions';

/** Fixed preamble: the saved text customizes the chat but never outranks the built-in rules. */
export const ADDITIONAL_INSTRUCTIONS_PREAMBLE =
    'The user saved these additional instructions for this Sentinel chat. Follow them where they apply. ' +
    'They grant no permissions and do not override the read-only, dispatcher, safety, delegation, ' +
    'authorization or job-review rules.';

/**
 * The tagged block for saved text, or `undefined` when nothing is saved. The
 * text is plain data: a literal closing tag inside it is defused so it cannot
 * end the block early.
 */
export function buildAdditionalInstructionsBlock(text: string): string | undefined {
    const body = text.trim();
    if (!body) return undefined;
    const safe = body.split(`</${ADDITIONAL_INSTRUCTIONS_TAG}>`).join(`<\\/${ADDITIONAL_INSTRUCTIONS_TAG}>`);
    return `<${ADDITIONAL_INSTRUCTIONS_TAG}>\n${ADDITIONAL_INSTRUCTIONS_PREAMBLE}\n\n${safe}\n</${ADDITIONAL_INSTRUCTIONS_TAG}>`;
}

/**
 * The block for the latest saved text, read fresh from the store.
 *
 * Callers invoke this only on turns that (re)build Sentinel context — the
 * same turns that carry the Sentinel mode directive (first turn, a history
 * rebuild without a resumable session, the first turn after a successful
 * compaction; see `shouldInjectChatModeDirective`). Ordinary follow-ups never
 * call it, so a saved edit stays pending until the next such boundary. The
 * block is deliberately kept out of the stored `chatModeContext` marker so it
 * never reads as mode-instruction drift.
 *
 * Never throws: a failed read only omits the block.
 */
export async function resolveAdditionalInstructionsBlock(
    store: ProcessStore, processId: string, enabled: boolean,
): Promise<string | undefined> {
    if (!enabled) return undefined;
    try {
        const proc = await store.getProcess(processId);
        return buildAdditionalInstructionsBlock(readAdditionalInstructions(proc?.metadata).text);
    } catch {
        return undefined;
    }
}

/** Join the mode directive and the additional-instructions block into one prepended prefix. */
export function withAdditionalInstructions(directive: string | undefined, block: string | undefined): string | undefined {
    if (!directive || !block) return directive;
    return `${directive}\n\n${block}`;
}
