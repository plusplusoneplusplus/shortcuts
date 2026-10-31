import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { GitFileReview } from '../../../../src/server/spa/client/react/features/git/diff/GitFileReview';
import { UnifiedPanelHostProvider } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
import type { DiffSource } from '../../../../src/server/spa/client/react/features/git/diff/diffSource';

const openTab = vi.hoisted(() => vi.fn(() => 'tab-id'));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen', () => ({
    openUnifiedPanelTab: openTab,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    FileDiffPanel: (props: any) => <div data-testid="focused-diff">{props.filePath}</div>,
}));

const files = [
    { path: 'src/z.ts', status: 'modified', additions: 4, deletions: 2 },
    { path: 'src/a.ts', oldPath: 'old/name.ts', status: 'R100', additions: 1, deletions: 0 },
    { path: 'packages/coc-desktop/test/e2e/html-download.e2e.test.ts', status: 'M', additions: 2, deletions: 1 },
    { path: 'docs/README.md', status: 'D', additions: 0, deletions: 5 },
];
const source = {
    files: [], cacheKey: 'commit:abc', label: 'Commit abc',
    commentContext: (filePath: string) => ({ repositoryId: 'ws', filePath, oldRef: 'abc^', newRef: 'abc' }),
} as unknown as DiffSource;
const props = { workspaceId: 'ws', attachmentDestinationId: 'remote:one:ws', comparisonKey: 'abc', files, source };
const host = { workspaceId: 'group-1', chatId: 'chat-1', routingRef: null };
const nav = () => screen.getByRole('complementary', { name: 'Changed files' });
const row = (path: string) => nav().querySelector<HTMLElement>(`[data-file-path="${path}"]`)!;
function renderInPanel(overrides: Partial<typeof props> = {}) {
    return render(<UnifiedPanelHostProvider host={host}><GitFileReview {...props} {...overrides} /></UnifiedPanelHostProvider>);
}
function openFileItem() { return within(screen.getByTestId('context-menu')).getByRole('menuitem', { name: /Open file/ }); }

beforeEach(() => openTab.mockClear());
afterEach(() => { location.hash = ''; });

describe('changed-file row Open file', () => {
    it.each(['Groups', 'Tree', 'Flat'])('opens the right-clicked row as a raw source tab in %s view without changing the diff', view => {
        renderInPanel();
        fireEvent.click(screen.getByRole('button', { name: view, exact: true }));
        const selected = screen.getByTestId('focused-diff').textContent;
        const target = 'packages/coc-desktop/test/e2e/html-download.e2e.test.ts';
        expect(selected).not.toBe(target);
        fireEvent.contextMenu(row(target), { clientX: 40, clientY: 50 });
        fireEvent.click(openFileItem());
        expect(openTab).toHaveBeenCalledTimes(1);
        expect(openTab).toHaveBeenCalledWith('group-1', expect.objectContaining({
            kind: 'file', ownerWorkspaceId: 'ws', ownerRoutingRef: 'remote:one:ws', chatId: 'chat-1',
            resourceId: target, label: 'html-download.e2e.test.ts', rawSource: true,
        }));
        expect(screen.getByTestId('focused-diff').textContent).toBe(selected);
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('opens a rename at its new path and disables deleted files', () => {
        renderInPanel();
        fireEvent.contextMenu(row('src/a.ts'), { clientX: 1, clientY: 1 });
        fireEvent.click(openFileItem());
        expect(openTab).toHaveBeenLastCalledWith('group-1', expect.objectContaining({ resourceId: 'src/a.ts' }));
        fireEvent.contextMenu(row('docs/README.md'), { clientX: 1, clientY: 1 });
        const deleted = openFileItem();
        expect(deleted).toBeDisabled();
        fireEvent.click(deleted);
        expect(openTab).toHaveBeenCalledTimes(1);
    });

    it('pins a local owner to page origin', () => {
        renderInPanel({ attachmentDestinationId: 'ws' });
        fireEvent.contextMenu(row('src/z.ts'), { clientX: 1, clientY: 1 });
        fireEvent.click(openFileItem());
        expect(openTab).toHaveBeenCalledWith('group-1', expect.objectContaining({ ownerWorkspaceId: 'ws', ownerRoutingRef: null }));
    });

    it('opens from the keyboard, focuses the menu, and returns focus on Escape', () => {
        renderInPanel();
        const target = row('src/z.ts');
        target.focus();
        fireEvent.keyDown(target, { key: 'F10', shiftKey: true });
        expect(document.activeElement).toBe(openFileItem());
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('context-menu')).toBeNull();
        expect(document.activeElement).toBe(target);
        fireEvent.keyDown(target, { key: 'ContextMenu' });
        fireEvent.keyDown(openFileItem(), { key: 'Enter' });
        expect(openTab).toHaveBeenCalledWith('group-1', expect.objectContaining({ resourceId: 'src/z.ts', rawSource: true }));
    });

    it('keeps left-click selecting the diff', () => {
        renderInPanel();
        fireEvent.click(row('src/a.ts'));
        expect(screen.getByTestId('focused-diff').textContent).toBe('src/a.ts');
        expect(openTab).not.toHaveBeenCalled();
    });

    it('falls back to the owner Explorer deep link without a panel', () => {
        render(<GitFileReview {...props} />);
        fireEvent.contextMenu(row('src/z.ts'), { clientX: 1, clientY: 1 });
        fireEvent.click(openFileItem());
        expect(openTab).not.toHaveBeenCalled();
        expect(location.hash).toBe('#repos/remote%3Aone%3Aws/explorer/src%2Fz.ts');
    });
});
