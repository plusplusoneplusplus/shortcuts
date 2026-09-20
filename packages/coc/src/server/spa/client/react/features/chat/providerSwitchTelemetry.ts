import type { ConcreteChatProvider } from '../../utils/providerSelection';

export const PROVIDER_SWITCH_UI_TELEMETRY_EVENT = 'coc-provider-switch-telemetry';

export type ProviderSwitchUiAction = 'attempt' | 'confirmation' | 'cancellation';

export interface ProviderSwitchUiTelemetry {
    action: ProviderSwitchUiAction;
    sourceProvider: ConcreteChatProvider;
    targetProvider: ConcreteChatProvider;
    workspaceId?: string;
    processId?: string;
}

export function recordProviderSwitchUiTelemetry(event: ProviderSwitchUiTelemetry): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(PROVIDER_SWITCH_UI_TELEMETRY_EVENT, {
        detail: {
            action: event.action,
            sourceProvider: event.sourceProvider,
            targetProvider: event.targetProvider,
            workspaceId: event.workspaceId,
            processId: event.processId,
        },
    }));
}
