import { normalizeChatMode } from '../../repos/modeConfig';
import type { ChatMode } from '../../repos/modeConfig';

export function isChatMode(mode: unknown): mode is ChatMode {
    return normalizeChatMode(mode) === mode;
}

export function resolveLoadedTaskMode(task: unknown): ChatMode | undefined {
    const loadedTask = task as {
        payload?: { mode?: unknown };
        metadata?: { mode?: unknown };
    } | null | undefined;

    const payloadMode = loadedTask?.payload?.mode;
    const normalizedPayloadMode = normalizeChatMode(payloadMode);
    if (normalizedPayloadMode) {
        return normalizedPayloadMode;
    }

    const metadataMode = loadedTask?.metadata?.mode;
    const normalizedMetadataMode = normalizeChatMode(metadataMode);
    if (normalizedMetadataMode) {
        return normalizedMetadataMode;
    }

    return undefined;
}
