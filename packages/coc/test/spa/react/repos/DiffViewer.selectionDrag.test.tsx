/**
 * Dragging a text selection out of the Unified / Split diff viewers carries a
 * diff-selection context payload (AC-01 drag source).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { UnifiedDiffViewer } from '../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';
import type { DiffSelectionDragSource } from '../../../../src/server/spa/client/react/features/git/diff/diffSelectionContext';
import { DIFF_SELECTION_CONTEXT_DRAG_MIME } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

//  0-3: file preamble (meta)
//  4: @@ -1,2 +1,2 @@
//  5: -old line      old 1
//  6: +new line      new 1
//  7:  context line  old 2 / new 2
const DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 0000000..1111111 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
-old line
+new line
 context line`;

const SOURCE: DiffSelectionDragSource = {
    workspaceId: 'ws-1',
    ref: { type: 'commit', commitHash: '585e64d0123456789abcdef0123456789abcdef0' },
};

function mockSelection(startNode: Node, endNode: Node) {
    const range = { startContainer: startNode, endContainer: endNode, startOffset: 0, endOffset: 3 };
    vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => range,
        toString: () => 'selected',
        removeAllRanges: vi.fn(),
    } as unknown as Selection);
}

function makeDataTransfer() {
    const data = new Map<string, string>();
    return {
        data,
        effectAllowed: 'all',
        setData: vi.fn((format: string, value: string) => { data.set(format, value); }),
        getData: (format: string) => data.get(format) ?? '',
        types: [] as string[],
    };
}

/** Text node (or deepest element) inside a rendered row — what a real selection points at. */
function innerNode(el: Element): Node {
    let node: Node = el;
    while (node.lastChild) node = node.lastChild;
    return node;
}

function row(container: HTMLElement, index: number, side?: 'left' | 'right'): HTMLElement {
    const sel = side
        ? `[data-split-side="${side}"][data-diff-line-index="${index}"]`
        : `[data-diff-line-index="${index}"]`;
    const el = container.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`row ${index} not found`);
    return el;
}

function readPayload(dt: ReturnType<typeof makeDataTransfer>) {
    const raw = dt.data.get(DIFF_SELECTION_CONTEXT_DRAG_MIME);
    return raw ? JSON.parse(raw) : null;
}

beforeEach(() => { applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true }); });
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: false });
});

describe('UnifiedDiffViewer selection drag', () => {
    it('writes a diff-selection payload built from the diff line model', () => {
        const { container } = render(<UnifiedDiffViewer diff={DIFF} showLineNumbers diffSelectionDragSource={SOURCE} />);
        mockSelection(innerNode(row(container, 5)), innerNode(row(container, 7)));
        const dt = makeDataTransfer();
        const notCancelled = fireEvent.dragStart(row(container, 6), { dataTransfer: dt });

        // Native text drag must continue (selection/copy untouched).
        expect(notCancelled).toBe(true);
        expect(dt.effectAllowed).toBe('copy');
        expect(readPayload(dt)).toMatchObject({
            sourceWorkspaceId: 'ws-1',
            filePath: 'src/foo.ts',
            oldRange: { start: 1, end: 2 },
            newRange: { start: 1, end: 2 },
            ref: SOURCE.ref,
            snippet: '-old line\n+new line\n context line',
        });
        expect(dt.data.get('text/plain')).toBe('-old line\n+new line\n context line');
    });

    it('uses the source file path when the diff has no file header', () => {
        const headerless = '@@ -3,1 +3,1 @@\n-a\n+b';
        const { container } = render(
            <UnifiedDiffViewer diff={headerless} diffSelectionDragSource={{ ...SOURCE, filePath: 'lib/x.ts' }} />,
        );
        mockSelection(innerNode(row(container, 1)), innerNode(row(container, 2)));
        const dt = makeDataTransfer();
        fireEvent.dragStart(row(container, 1), { dataTransfer: dt });
        expect(readPayload(dt)).toMatchObject({ filePath: 'lib/x.ts', oldRange: { start: 3, end: 3 }, newRange: { start: 3, end: 3 } });
    });

    it('leaves the drag alone when the feature flag is off', () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: false });
        const { container } = render(<UnifiedDiffViewer diff={DIFF} diffSelectionDragSource={SOURCE} />);
        mockSelection(innerNode(row(container, 5)), innerNode(row(container, 7)));
        const dt = makeDataTransfer();
        fireEvent.dragStart(row(container, 6), { dataTransfer: dt });
        expect(dt.setData).not.toHaveBeenCalled();
    });

    it('leaves the drag alone without a drag source', () => {
        const { container } = render(<UnifiedDiffViewer diff={DIFF} />);
        mockSelection(innerNode(row(container, 5)), innerNode(row(container, 7)));
        const dt = makeDataTransfer();
        fireEvent.dragStart(row(container, 6), { dataTransfer: dt });
        expect(dt.setData).not.toHaveBeenCalled();
    });

    it('writes nothing when the selection covers only the hunk header', () => {
        const { container } = render(<UnifiedDiffViewer diff={DIFF} diffSelectionDragSource={SOURCE} />);
        mockSelection(innerNode(row(container, 4)), innerNode(row(container, 4)));
        const dt = makeDataTransfer();
        fireEvent.dragStart(row(container, 4), { dataTransfer: dt });
        expect(dt.setData).not.toHaveBeenCalled();
    });

    it('keeps the "Add comment" context menu working alongside the drag source', () => {
        const { container, getByText } = render(
            <UnifiedDiffViewer diff={DIFF} enableComments showLineNumbers onAddComment={vi.fn()} diffSelectionDragSource={SOURCE} />,
        );
        const root = container.firstElementChild as HTMLElement;
        mockSelection(innerNode(row(container, 5)), innerNode(row(container, 7)));
        fireEvent.dragStart(row(container, 6), { dataTransfer: makeDataTransfer() });
        fireEvent.mouseUp(root, { button: 0 });
        fireEvent.contextMenu(root, { clientX: 10, clientY: 10 });
        expect(getByText('Add comment')).toBeTruthy();
    });
});

describe('SideBySideDiffViewer selection drag', () => {
    it('a left-column selection yields only the old side', () => {
        const { container } = render(<SideBySideDiffViewer diff={DIFF} showLineNumbers diffSelectionDragSource={SOURCE} />);
        mockSelection(innerNode(row(container, 5, 'left')), innerNode(row(container, 7, 'left')));
        const dt = makeDataTransfer();
        fireEvent.dragStart(row(container, 5, 'left'), { dataTransfer: dt });
        const payload = readPayload(dt);
        expect(payload).toMatchObject({ filePath: 'src/foo.ts', oldRange: { start: 1, end: 2 }, snippet: '-old line\n context line' });
        expect(payload.newRange).toBeUndefined();
    });

    it('a right-column selection yields only the new side', () => {
        const { container } = render(<SideBySideDiffViewer diff={DIFF} diffSelectionDragSource={SOURCE} />);
        mockSelection(innerNode(row(container, 6, 'right')), innerNode(row(container, 7, 'right')));
        const dt = makeDataTransfer();
        fireEvent.dragStart(row(container, 6, 'right'), { dataTransfer: dt });
        const payload = readPayload(dt);
        expect(payload).toMatchObject({ newRange: { start: 1, end: 2 }, snippet: '+new line\n context line' });
        expect(payload.oldRange).toBeUndefined();
    });

    it('releases the column selection lock when the drag ends elsewhere', () => {
        const { container } = render(<SideBySideDiffViewer diff={DIFF} diffSelectionDragSource={SOURCE} />);
        const root = container.firstElementChild as HTMLElement;
        fireEvent.mouseDown(row(container, 5, 'left'), { button: 0 });
        expect(row(container, 6, 'right').style.userSelect).toBe('none');
        fireEvent.dragEnd(root);
        expect(row(container, 6, 'right').style.userSelect).toBe('');
    });
});
