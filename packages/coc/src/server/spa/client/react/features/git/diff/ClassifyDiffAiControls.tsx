import { AgentSelectorChip } from '../../chat/AgentSelectorChip';
import type { ChatProvider } from '../../chat/AgentSelectorChip';
import { EffortTierSelector } from '../../chat/EffortTierSelector';
import { ModelCommandMenu } from '../../chat/ModelCommandMenu';
import type { UseModalJobAiSelectionResult } from '../../../shared/ModalJobAiControls';
import { isChatProvider, isSelectableProvider } from '../../../shared/ModalJobAiControls';
import { cn } from '../../../ui/cn';

export interface ClassifyDiffAiControlsProps {
    selection: UseModalJobAiSelectionResult;
    disabled?: boolean;
    className?: string;
    testIdPrefix?: string;
}

function ModelIcon() {
    return (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
            <polygon
                points="8,1 14,4.5 14,11.5 8,15 2,11.5 2,4.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function getSelectableProviderCount(selection: UseModalJobAiSelectionResult): number {
    const selectable = new Set<ChatProvider>();
    for (const provider of selection.agentProviders) {
        if (isChatProvider(provider.id) && isSelectableProvider(provider.id, selection.agentProviders)) {
            selectable.add(provider.id);
        }
    }
    if (selection.agentProviders.length === 0 || isSelectableProvider('copilot', selection.agentProviders)) {
        selectable.add('copilot');
    }
    return selectable.size;
}

export function ClassifyDiffAiControls({
    selection,
    disabled = false,
    className,
    testIdPrefix = 'classify',
}: ClassifyDiffAiControlsProps) {
    const {
        provider,
        setProvider,
        agentProviders,
        providersLoading,
        useEffortTierMode,
        effortTierMap,
        selectedEffortTier,
        setEffortTier,
        modelCommand,
        defaultModelId,
        defaultModelLabel,
        validModelOverride,
    } = selection;

    const showProviderSelector = getSelectableProviderCount(selection) > 1;

    return (
        <div
            className={cn('flex flex-wrap items-center gap-x-px gap-y-0.5', className)}
            data-testid={`${testIdPrefix}-ai-controls`}
        >
            {showProviderSelector && (
                <>
                    <AgentSelectorChip
                        providers={agentProviders}
                        loading={providersLoading}
                        selected={provider}
                        onChange={setProvider}
                        disabled={disabled}
                    />
                    <span
                        aria-hidden="true"
                        data-testid={`${testIdPrefix}-provider-divider`}
                        className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center shrink-0"
                    />
                </>
            )}
            {useEffortTierMode ? (
                <EffortTierSelector
                    tiers={effortTierMap}
                    selectedTier={selectedEffortTier}
                    onChange={setEffortTier}
                    disabled={disabled}
                    data-testid={`${testIdPrefix}-effort-tier-selector`}
                    className="ml-0.5"
                    autoProviderMode={provider === 'auto'}
                />
            ) : (
                <div className="relative shrink-0" data-testid={`${testIdPrefix}-model-picker-chip-container`}>
                    <button
                        type="button"
                        className="ctool inline-flex items-center gap-1 h-[22px] px-1.5 rounded-sm text-[11px] text-[#5a5a5a] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 min-w-0 max-w-[40vw] sm:max-w-[180px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => {
                            if (modelCommand.modelMenuVisible) {
                                modelCommand.dismissModelMenu();
                            } else {
                                modelCommand.showModelMenu();
                            }
                        }}
                        disabled={disabled}
                        title={validModelOverride
                            ? `Override active: ${validModelOverride} (click to change or clear)`
                            : defaultModelLabel
                                ? `Default: ${defaultModelLabel} (click to override)`
                                : 'Pick a model'}
                        data-testid={`${testIdPrefix}-model-picker-chip`}
                        aria-haspopup="listbox"
                        aria-expanded={modelCommand.modelMenuVisible}
                    >
                        <ModelIcon />
                        <span className="truncate font-mono text-[10.5px] font-medium text-[#848484] dark:text-[#999]">
                            {validModelOverride || defaultModelLabel || 'model'}
                        </span>
                        <svg width="7" height="7" viewBox="0 0 8 6" fill="none" aria-hidden="true" className="shrink-0 opacity-60">
                            <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <ModelCommandMenu
                        models={modelCommand.filteredModels}
                        filter={modelCommand.modelFilter}
                        onSelect={modelCommand.handleModelSelect}
                        onDismiss={modelCommand.dismissModelMenu}
                        visible={modelCommand.modelMenuVisible}
                        highlightIndex={modelCommand.modelHighlightIndex}
                        currentModelId={validModelOverride ?? defaultModelId}
                        onClearOverride={modelCommand.modelOverride ? () => modelCommand.setModelOverride(null) : undefined}
                    />
                </div>
            )}
        </div>
    );
}
