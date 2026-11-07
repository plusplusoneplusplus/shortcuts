import { TerminalView } from '../../terminal/TerminalView';
import { WorkspaceSettingsSlot } from '../../repo-settings/WorkspaceSettingsHost';
import { UnifiedTodoTab } from './UnifiedTodoTab';
import type { CocPage } from './unifiedPanelAddresses';

/**
 * The body of a `coc://` page inside a web tab. Each page reuses the view its
 * own tab kind shows; nothing here is re-implemented.
 */
export function UnifiedCocPage({ page, active, terminalOpenRequest, selectItemRequest, onTodoSelectionChange }: {
    page: CocPage;
    active: boolean;
    /** Bumped on each navigation to `coc://terminal`, as the "+" menu does. */
    terminalOpenRequest: number;
    /** A `coc://todo/<itemId>` selection; see `UnifiedTodoTab`. */
    selectItemRequest: { id: string; nonce: number } | null;
    onTodoSelectionChange(itemId: string | null): void;
}) {
    switch (page.kind) {
        case 'settings':
            // One shared form follows the newest slot; a hidden web tab must not keep it.
            return active ? <WorkspaceSettingsSlot ownerKey={page.ownerKey} /> : null;
        case 'terminal':
            return <TerminalView workspaceId={page.ownerWorkspaceId} routingRef={page.ownerRoutingRef}
                openRequest={terminalOpenRequest} isActive={active} />;
        case 'todo':
            return <UnifiedTodoTab owner={page.owner} scopeWorkspaceId={page.scopeWorkspaceId} chatId={page.chatId}
                selectItemRequest={selectItemRequest} onSelectionChange={onTodoSelectionChange} />;
    }
}
