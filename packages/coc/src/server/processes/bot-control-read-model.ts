import { toQueueProcessId, type AIProcess, type ProcessIndexEntry, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { BotControlPresentation } from '@plusplusoneplusplus/coc-client';
import {
    BotControlValidationError, validateBotControlMetadata,
    type AuthorizeBotThreadUrl,
} from '../messaging/bot-control-metadata';
import { getServerLogger } from '../logging/server-logger';

export function projectBotControl(
    value: unknown,
    enabled: boolean,
    authorizeThreadUrl?: AuthorizeBotThreadUrl,
): BotControlPresentation | undefined {
    if (!enabled || value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        getServerLogger().warn('Omitting invalid bot control presentation');
        return undefined;
    }

    // A rejected link must not erase otherwise valid control. Keep every other
    // field for strict validation, including unexpected private fields.
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
    const { externalThreadUrl, ...core } = record;
    let control: ReturnType<typeof validateBotControlMetadata>;
    try {
        control = validateBotControlMetadata(core);
    } catch (error) {
        if (!(error instanceof BotControlValidationError)) throw error;
        getServerLogger().warn('Omitting invalid bot control presentation');
        return undefined;
    }
    const presentation: BotControlPresentation = {
        state: control.state,
        source: control.source,
        controllerLabel: control.controllerLabel,
    };
    if (externalThreadUrl !== undefined && authorizeThreadUrl) {
        try {
            presentation.externalThreadUrl = validateBotControlMetadata(value, authorizeThreadUrl).externalThreadUrl;
        } catch (error) {
            if (!(error instanceof BotControlValidationError)) throw error;
            getServerLogger().warn('Omitting invalid or unauthorized bot control thread link');
        }
    }
    return presentation;
}

/** Public read projection only; never write this value back to the process store. */
export function projectProcessBotControl(
    process: AIProcess,
    enabled: boolean,
    authorizeThreadUrl?: AuthorizeBotThreadUrl,
): AIProcess & { botControl?: BotControlPresentation } {
    const projected: AIProcess & { botControl?: BotControlPresentation } = { ...process };
    delete projected.botControl;
    if (process.metadata) {
        const { botControl, ...metadata } = process.metadata;
        projected.metadata = metadata;
        const presentation = projectBotControl(botControl, enabled, authorizeThreadUrl);
        if (presentation) projected.botControl = presentation;
    }
    return projected;
}

/** Index-only read projection; the store retains the authoritative contract. */
export function projectProcessIndexBotControl(
    entry: ProcessIndexEntry,
    enabled: boolean,
): Omit<ProcessIndexEntry, 'botControl'> & { botControl?: BotControlPresentation } {
    const { botControl, ...projected } = entry;
    const presentation = projectBotControl(botControl, enabled);
    return presentation ? { ...projected, botControl: presentation } : projected;
}

/** Current process ownership wins over the queue's immutable admission provenance. */
export async function projectQueueTaskBotControl(
    task: QueuedTask,
    store: ProcessStore | undefined,
    enabled: boolean,
): Promise<BotControlPresentation | undefined> {
    if (!enabled || task.type !== 'chat') return undefined;
    const payload = task.payload;
    if (payload.kind !== 'chat' || !task.repoId || payload.workspaceId !== task.repoId) return undefined;

    const targetId = typeof payload.processId === 'string' ? payload.processId : undefined;
    const processId = targetId ?? task.processId ?? toQueueProcessId(task.id);
    const process = await store?.getProcess(processId);
    if (process) {
        if (process.metadata?.workspaceId !== task.repoId) {
            getServerLogger().warn('Omitting bot control for a mismatched queue workspace');
            return undefined;
        }
        return projectBotControl(process.metadata.botControl, enabled);
    }

    // Only a not-yet-started origin has current control before process creation.
    // Completed/cancelled tasks and orphaned follow-ups cannot revive a saved claim.
    return task.status === 'queued' && !payload.processId
        ? projectBotControl(task.botControl, enabled)
        : undefined;
}
