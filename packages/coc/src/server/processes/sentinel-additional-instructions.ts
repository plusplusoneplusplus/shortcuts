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
