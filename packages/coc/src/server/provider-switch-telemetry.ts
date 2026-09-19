import type { ChatProvider } from './tasks/task-types';
import { getServerLogger } from './logging/server-logger';

export type ProviderSwitchServerAction = 'attempt' | 'session-created' | 'failed';
export type ProviderSwitchFailureReason =
    | 'feature-disabled'
    | 'conversation-busy'
    | 'enqueue-failed'
    | 'before-session-creation'
    | 'after-session-creation'
    | 'cancelled';

export interface ProviderSwitchServerTelemetry {
    action: ProviderSwitchServerAction;
    sourceProvider: ChatProvider;
    targetProvider: ChatProvider;
    workspaceId?: string;
    processId: string;
    handoffOmittedHistory?: boolean;
    failureReason?: ProviderSwitchFailureReason;
}

export function recordProviderSwitchServerTelemetry(event: ProviderSwitchServerTelemetry): void {
    getServerLogger().child({ component: 'provider-switch' }).info({
        event: 'provider-switch',
        action: event.action,
        sourceProvider: event.sourceProvider,
        targetProvider: event.targetProvider,
        workspaceId: event.workspaceId,
        processId: event.processId,
        ...(event.handoffOmittedHistory !== undefined
            ? { handoffOmittedHistory: event.handoffOmittedHistory }
            : {}),
        ...(event.failureReason ? { failureReason: event.failureReason } : {}),
    }, 'Provider switch telemetry');
}
