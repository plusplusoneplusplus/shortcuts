// @vitest-environment jsdom
/**
 * Behavioural coverage for dragging an Explorer row out to a chat composer.
 *
 * The sibling TreeNode.test.ts is a source-mirror test, so it can assert the
 * row is `draggable` but not that the payload actually lands on the
 * DataTransfer. These tests fire a real dragstart and read back what was
 * written.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: { tree: vi.fn(), searchFiles: vi.fn(), reveal: vi.fn() },
}));

import { TreeNode } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/TreeNode';
import {
    FILE_PATH_DRAG_KIND,
    FILE_PATH_DRAG_MIME,
} from '../../../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-1';
const FILE: TreeEntry = { name: 'RichTextInput.tsx', type: 'file', path: 'packages/coc/src/shared/RichTextInput.tsx' };
const DIR: TreeEntry = { name: 'docs', type: 'dir', path: 'packages/coc/docs' };

function renderNode(entry: TreeEntry, workspaceId = WS) {
    return render(
        <TreeNode
            entry={entry}
            depth={0}
            workspaceId={workspaceId}
            selectedPath={null}
            expandedPaths={new Set()}
            childrenMap={new Map()}
            onToggle={vi.fn()}
            onSelect={vi.fn()}
            onChildrenLoaded={vi.fn()}
        />,
    );
}

/**
 * Minimal DataTransfer stand-in — jsdom does not implement one. `types` is
 * derived from setData like a browser's, because the composer sniffs `types`
 * to decide whether to accept the drop.
 */
function makeDataTransfer() {
    const store: Record<string, string> = {};
    return {
        store,
        effectAllowed: 'uninitialized' as string,
        setData(format: string, data: string) { store[format] = data; },
        getData(format: string) { return store[format] ?? ''; },
        get types(): string[] { return Object.keys(store); },
    };
}

function dragStart(testId: string) {
    const dataTransfer = makeDataTransfer();
    const row = screen.getByTestId(testId);
    const prevented = !fireEvent.dragStart(row, { dataTransfer });
    return { dataTransfer, prevented };
}

describe('TreeNode drag source', () => {
    beforeEach(() => { vi.clearAllMocks(); });
    afterEach(() => { cleanup(); });

    it('marks file rows draggable', () => {
        renderNode(FILE);
        expect(screen.getByTestId(`tree-node-${FILE.path}`)).toHaveProperty('draggable', true);
    });

    it('marks directory rows draggable too', () => {
        renderNode(DIR);
        expect(screen.getByTestId(`tree-node-${DIR.path}`)).toHaveProperty('draggable', true);
    });

    it('writes the file-path payload and a text/plain fallback with a copy-only effect', () => {
        renderNode(FILE);
        const { dataTransfer } = dragStart(`tree-node-${FILE.path}`);

        expect(dataTransfer.effectAllowed).toBe('copy');
        expect(JSON.parse(dataTransfer.getData(FILE_PATH_DRAG_MIME))).toEqual({
            kind: FILE_PATH_DRAG_KIND,
            version: 1,
            workspaceId: WS,
            paths: [FILE.path],
        });
        expect(dataTransfer.getData('text/plain')).toBe(FILE.path);
        // The composer accepts a drop by sniffing `types`, so advertising the
        // MIME there is as load-bearing as the payload itself.
        expect(dataTransfer.types).toContain(FILE_PATH_DRAG_MIME);
        expect(dataTransfer.types).toContain('text/plain');
    });

    it('drags a directory by its repo-relative path, verbatim', () => {
        renderNode(DIR);
        const { dataTransfer } = dragStart(`tree-node-${DIR.path}`);
        expect(JSON.parse(dataTransfer.getData(FILE_PATH_DRAG_MIME)).paths).toEqual([DIR.path]);
    });

    it('cancels the drag when there is no workspace to attribute the path to', () => {
        renderNode(FILE, '');
        const { dataTransfer, prevented } = dragStart(`tree-node-${FILE.path}`);
        expect(prevented).toBe(true);
        expect(dataTransfer.getData(FILE_PATH_DRAG_MIME)).toBe('');
    });

    it('leaves click selection and context-menu behaviour intact', () => {
        const onSelect = vi.fn();
        const onToggle = vi.fn();
        const onContextMenu = vi.fn();
        render(
            <TreeNode
                entry={DIR}
                depth={0}
                workspaceId={WS}
                selectedPath={null}
                expandedPaths={new Set()}
                childrenMap={new Map()}
                onToggle={onToggle}
                onSelect={onSelect}
                onChildrenLoaded={vi.fn()}
                onContextMenu={onContextMenu}
            />,
        );
        const row = screen.getByTestId(`tree-node-${DIR.path}`);

        fireEvent.click(row);
        expect(onToggle).toHaveBeenCalledWith(DIR.path);
        expect(onSelect).toHaveBeenCalledWith(DIR.path, true);

        fireEvent.contextMenu(row);
        expect(onContextMenu).toHaveBeenCalled();
    });
});
