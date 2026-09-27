// @vitest-environment jsdom
/**
 * AC-03/AC-04: a language-server jump out of a right-panel file tab.
 *
 * The panel's tab strip is the surface here, so what has to be pinned is which
 * repo the target opens against. A file tab carries its own owner, and a repo
 * group can point its dock somewhere else at any time, so the navigation is
 * bound to the SOURCE tab rather than to the dock's current target.
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { UnifiedTabView } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTabView';
import type { UnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const viewProps = vi.hoisted(() => ({ preview: null as any, notes: null as any }));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: (props: any) => {
        viewProps.preview = props;
        return <div data-testid="mock-preview-pane" />;
    },
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: (props: any) => {
        viewProps.notes = props;
        return <div data-testid="mock-notes-view" />;
    },
}));

function fileTab(overrides: Partial<UnifiedPanelTab> = {}): UnifiedPanelTab {
    return {
        id: 'file|member-b|chat-1|src/a.ts',
        kind: 'file',
        ownerWorkspaceId: 'member-b',
        chatId: 'chat-1',
        resourceId: 'src/a.ts',
        label: 'a.ts',
        ...overrides,
    } as UnifiedPanelTab;
}

function renderTab(tab: UnifiedPanelTab, onOpenFile?: any, onNotesSelectionChange?: any) {
    return render(
        <UnifiedTabView
            tab={tab}
            scopeWorkspaceId="group-1"
            onClose={() => undefined}
            {...(onOpenFile ? { onOpenFile } : {})}
            {...(onNotesSelectionChange ? { onNotesSelectionChange } : {})}
        />,
    );
}

describe('UnifiedTabView — language navigation (AC-03/AC-04)', () => {
    it('opens the target against the source tab’s owner and label', () => {
        const onOpenFile = vi.fn();
        renderTab(fileTab({
            repoLabel: 'member-b',
            ownerRoutingRef: 'remote:server-b:member-b',
        }), onOpenFile);

        viewProps.preview.onNavigate({ path: 'src/types.ts', name: 'types.ts', line: 12, column: 17 });

        expect(viewProps.preview.routingRef).toBe('remote:server-b:member-b');
        expect(onOpenFile).toHaveBeenCalledWith(
            { path: 'src/types.ts', name: 'types.ts', line: 12, column: 17 },
            {
                ownerWorkspaceId: 'member-b',
                ownerRoutingRef: 'remote:server-b:member-b',
                repoLabel: 'member-b',
            },
        );
    });

    it('carries no repo label for a tab that has none', () => {
        const onOpenFile = vi.fn();
        renderTab(fileTab({ ownerWorkspaceId: 'group-1' }), onOpenFile);

        viewProps.preview.onNavigate({ path: 'src/types.ts', name: 'types.ts', line: 1, column: 1 });

        expect(onOpenFile.mock.calls[0][1]).toEqual({ ownerWorkspaceId: 'group-1' });
    });

    it('wires no navigation at all when the panel offers no opener', () => {
        renderTab(fileTab());

        expect(viewProps.preview.onNavigate).toBeUndefined();
    });

    it('passes the tab’s reveal position down to the buffer', () => {
        renderTab(fileTab({ line: 12, column: 17 }));

        expect(viewProps.preview.revealLine).toBe(12);
        expect(viewProps.preview.revealColumn).toBe(17);
    });

    it('renders the full Notes view with panel-local navigation for the panel scope', () => {
        const onNotesSelectionChange = vi.fn();
        renderTab({
            id: 'notes',
            kind: 'notes',
            ownerWorkspaceId: 'member-b',
            resourceId: 'notes',
            label: 'Notes',
            notesView: { notePath: 'Plans/Release.md' },
        } as UnifiedPanelTab, undefined, onNotesSelectionChange);

        expect(viewProps.notes).toMatchObject({
            workspaceId: 'group-1',
            initialNotePath: 'Plans/Release.md',
            navigation: 'local',
            layout: 'container',
            active: false,
        });
        viewProps.notes.onSelectedNotePathChange('Plans/Next.md');
        expect(onNotesSelectionChange).toHaveBeenCalledWith('notes', 'Plans/Next.md');
    });
});
