import { type ReactNode } from 'react';
import { NotesView } from '../../notes/NotesView';
import { TerminalView, type TerminalSessionSummary } from '../../terminal/TerminalView';
import { WorkspaceSettingsSlot } from '../../repo-settings/WorkspaceSettingsHost';
import { UnifiedCanvasTab } from './UnifiedCanvasTab';
import { UnifiedTodoTab } from './UnifiedTodoTab';
import type { CocPage } from './unifiedPanelAddresses';

/**
 * The body of a `coc://` page inside a web tab. Each page reuses an existing
 * view; nothing here is re-implemented.
 */
export function UnifiedCocPage({ page, active, terminalOpenRequest, selectItemRequest, reloadNonce = 0, onTodoSelectionChange, onTerminalSessionsChange, onClose, onDirtyChange, onRegisterSave, canvasSwitcher, onCanvasTitle, notePath = null, onNotesSelectionChange }: {
    page: CocPage;
    active: boolean;
    /** Bumped on each navigation to `coc://terminal`, as the "+" menu does. */
    terminalOpenRequest: number;
    /** A `coc://todo/<itemId>` selection; see `UnifiedTodoTab`. */
    selectItemRequest: { id: string; nonce: number } | null;
    /** Toolbar reload. Settings rebuilds its form; To-do and Canvas re-read. */
    reloadNonce?: number;
    onTodoSelectionChange(itemId: string | null): void;
    /** Live terminal sessions, so the panel can confirm before a close kills them. */
    onTerminalSessionsChange?: (sessions: readonly TerminalSessionSummary[]) => void;
    /** Canvas page close, dirty mark and flush, owned by the web tab. */
    onClose?: () => void;
    onDirtyChange?: (isDirty: boolean) => void;
    onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
    canvasSwitcher?: ReactNode;
    onCanvasTitle?: (title: string) => void;
    /** The note a `coc://notes/…` address currently shows. */
    notePath?: string | null;
    onNotesSelectionChange?: (notePath: string | null) => void;
}) {
    switch (page.kind) {
        case 'settings':
            // One shared form follows the newest slot; a hidden web tab must not keep it.
            return active ? <WorkspaceSettingsSlot ownerKey={page.ownerKey} reloadNonce={reloadNonce} /> : null;
        case 'terminal':
            return <TerminalView workspaceId={page.ownerWorkspaceId} routingRef={page.ownerRoutingRef}
                openRequest={terminalOpenRequest} isActive={active} onSessionsChange={onTerminalSessionsChange} />;
        case 'todo':
            return <UnifiedTodoTab owner={page.owner} scopeWorkspaceId={page.scopeWorkspaceId} chatId={page.chatId}
                selectItemRequest={selectItemRequest} reloadNonce={reloadNonce} onSelectionChange={onTodoSelectionChange} />;
        case 'notes':
            return <NotesView
                workspaceId={page.ownerWorkspaceId}
                sourceSelectionId={page.ownerRoutingRef ?? undefined}
                initialNotePath={notePath}
                navigation="local"
                layout="container"
                active={false}
                onSelectedNotePathChange={onNotesSelectionChange}
            />;
        case 'canvas':
            return <UnifiedCanvasTab
                routingRef={page.ownerRoutingRef}
                workspaceId={page.ownerWorkspaceId}
                scopeWorkspaceId={page.scopeWorkspaceId}
                canvasId={page.canvasId}
                chatId={page.chatId}
                {...(page.repoLabel ? { repoLabel: page.repoLabel } : {})}
                titleAccessory={canvasSwitcher}
                reloadNonce={reloadNonce}
                onClose={onClose ?? (() => {})}
                onDirtyChange={onDirtyChange}
                onRegisterSave={onRegisterSave}
                onTitleChange={onCanvasTitle}
            />;
    }
}
