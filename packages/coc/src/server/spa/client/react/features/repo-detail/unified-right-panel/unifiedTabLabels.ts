import type { UnifiedPanelTab } from './unifiedPanelTabsModel';

/** Display only: browser descriptors retain their repository ownership. */
export function unifiedTabRepoLabel(
    tab: Pick<UnifiedPanelTab, 'kind' | 'repoLabel'>,
    hideBrowserRepoLabels = false,
): string | undefined {
    return hideBrowserRepoLabels && tab.kind === 'browser' ? undefined : tab.repoLabel;
}
