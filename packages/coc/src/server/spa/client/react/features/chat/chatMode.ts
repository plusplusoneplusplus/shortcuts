import type { ChatMode } from '../../repos/modeConfig';

export function isChatMode(mode: unknown): mode is ChatMode {
    return mode === 'ask' || mode === 'plan' || mode === 'autopilot';
}

export function resolveLoadedTaskMode(task: unknown): ChatMode | undefined {
    const loadedTask = task as {
        payload?: { mode?: unknown };
        metadata?: { mode?: unknown };
    } | null | undefined;

    const payloadMode = loadedTask?.payload?.mode;
    if (isChatMode(payloadMode)) {
        return payloadMode;
    }

    const metadataMode = loadedTask?.metadata?.mode;
    if (isChatMode(metadataMode)) {
        return metadataMode;
    }

    return undefined;
}
