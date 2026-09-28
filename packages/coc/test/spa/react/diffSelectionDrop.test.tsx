// @vitest-environment jsdom
/**
 * Dropping a Git diff selection onto a chat composer (AC-02): drop parsing,
 * validation (multi-repo, dedupe), the 4000-char cap + truncated flag, the
 * chip, and chip removal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import {
    createDiffSelectionContextItem,
    DIFF_SELECTION_TEXT_SIZE_LIMIT,
    useAttachedContext,
    type AttachedContextItem,
} from '../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import {
    dataTransferHasSessionContext,
    readDiffSelectionContextDragPayload,
    readSessionContextDropPayload,
    readSessionContextDropPayloads,
    validateSessionContextAttachmentsForSend,
    validateSessionContextDrop,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import {
    createDiffSelectionContextDragPayload,
    DIFF_SELECTION_CONTEXT_DRAG_MIME,
    SESSION_CONTEXT_BUNDLE_DRAG_MIME,
    writeSessionContextDragBundle,
    type DiffSelectionContextDragPayload,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { AttachedContextPreviews } from '../../../src/server/spa/client/react/ui/AttachedContextPreviews';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { MinimizedDialogsProvider } from '../../../src/server/spa/client/react/contexts/MinimizedDialogsContext';
import { EnqueueDialog } from '../../../src/server/spa/client/react/queue/EnqueueDialog';

function makeDiffPayload(overrides: Partial<Parameters<typeof createDiffSelectionContextDragPayload>[0]> = {}): DiffSelectionContextDragPayload {
    const payload = createDiffSelectionContextDragPayload({
        sourceWorkspaceId: 'ws-1',
        filePath: 'src/a.ts',
        oldRange: { start: 10, end: 11 },
        newRange: { start: 10, end: 12 },
        ref: { type: 'commit', commitHash: '585e64d1234567890abcdef' },
        snippet: ' context\n-old line\n+new line\n+another',
        ...overrides,
    });
    if (!payload) throw new Error('fixture payload is invalid');
    return payload;
}

function transferFrom(data: Record<string, string>) {
    return {
        types: Object.keys(data),
        getData: (type: string) => data[type] ?? '',
    };
}

describe('diff-selection drop parsing', () => {
    it('recognises the diff-selection MIME as a CoC context drag', () => {
        expect(dataTransferHasSessionContext(transferFrom({ [DIFF_SELECTION_CONTEXT_DRAG_MIME]: '{}' }))).toBe(true);
    });

    it('reads a valid payload back through the shared drop reader', () => {
        const payload = makeDiffPayload();
        const dt = transferFrom({ [DIFF_SELECTION_CONTEXT_DRAG_MIME]: JSON.stringify(payload) });
        expect(readSessionContextDropPayload(dt)).toEqual(payload);
        expect(readSessionContextDropPayloads(dt)).toEqual([payload]);
    });

    it('rejects malformed, wrong-kind, and absolute-path payloads', () => {
        const payload = makeDiffPayload();
        expect(readDiffSelectionContextDragPayload(transferFrom({ [DIFF_SELECTION_CONTEXT_DRAG_MIME]: 'not json' }))).toBeNull();
        expect(readDiffSelectionContextDragPayload(transferFrom({
            [DIFF_SELECTION_CONTEXT_DRAG_MIME]: JSON.stringify({ ...payload, kind: 'coc.other' }),
        }))).toBeNull();
        expect(readDiffSelectionContextDragPayload(transferFrom({
            [DIFF_SELECTION_CONTEXT_DRAG_MIME]: JSON.stringify({ ...payload, filePath: '/etc/passwd' }),
        }))).toBeNull();
        expect(readDiffSelectionContextDragPayload(transferFrom({
            [DIFF_SELECTION_CONTEXT_DRAG_MIME]: JSON.stringify({ ...payload, snippet: '   ' }),
        }))).toBeNull();
    });

    it('rebuilds the label instead of trusting the dropped one', () => {
        const payload = makeDiffPayload();
        const dt = transferFrom({ [DIFF_SELECTION_CONTEXT_DRAG_MIME]: JSON.stringify({ ...payload, label: '<script>' }) });
        expect(readDiffSelectionContextDragPayload(dt)?.label).toBe('src/a.ts:L10-L12 @ 585e64d');
    });

    it('survives a multi-item bundle', () => {
        const a = makeDiffPayload();
        const b = makeDiffPayload({ filePath: 'src/b.ts' });
        const data: Record<string, string> = {};
        writeSessionContextDragBundle({
            effectAllowed: 'all',
            setData: (type: string, value: string) => { data[type] = value; },
        } as unknown as DataTransfer, [a, b]);
        expect(data[DIFF_SELECTION_CONTEXT_DRAG_MIME]).toBeTruthy();
        expect(data[SESSION_CONTEXT_BUNDLE_DRAG_MIME]).toBeTruthy();
        expect(readSessionContextDropPayloads(transferFrom(data))).toEqual([a, b]);
    });
});

describe('diff-selection drop validation', () => {
    const base = {
        featureEnabled: true,
        activeWorkspaceId: 'ws-1',
        currentProcessId: null,
        existingItems: [] as AttachedContextItem[],
        canRetrieveConversations: false,
    };

    it('accepts a drop without conversation retrieval', () => {
        const result = validateSessionContextDrop({ ...base, payload: makeDiffPayload() });
        expect(result.ok).toBe(true);
    });

    it('accepts a selection from another workspace (multi-repo)', () => {
        const payload = makeDiffPayload({ sourceWorkspaceId: 'ws-other' });
        expect(validateSessionContextDrop({ ...base, payload }).ok).toBe(true);
        const item = createDiffSelectionContextItem(payload, 'ctx-x');
        expect(validateSessionContextAttachmentsForSend({ ...base, items: [item] })).toBeNull();
    });

    it('rejects the same lines of the same file and ref twice', () => {
        const payload = makeDiffPayload();
        const existing = createDiffSelectionContextItem(payload, 'ctx-1');
        const result = validateSessionContextDrop({ ...base, existingItems: [existing], payload });
        expect(result).toEqual({ ok: false, error: 'This diff selection is already attached to the message.' });
    });

    it('treats a different line range as a separate attachment', () => {
        const existing = createDiffSelectionContextItem(makeDiffPayload(), 'ctx-1');
        const payload = makeDiffPayload({ newRange: { start: 40, end: 41 } });
        expect(validateSessionContextDrop({ ...base, existingItems: [existing], payload }).ok).toBe(true);
    });
});

describe('diff-selection attached-context item', () => {
    it('keeps a snippet at the cap untouched', () => {
        const snippet = '+'.repeat(DIFF_SELECTION_TEXT_SIZE_LIMIT);
        const item = createDiffSelectionContextItem(makeDiffPayload({ snippet }), 'ctx-1');
        expect(item.snippet).toHaveLength(DIFF_SELECTION_TEXT_SIZE_LIMIT);
        expect(item.truncated).toBe(false);
    });

    it('cuts a snippet over 4000 chars and flags it truncated', () => {
        const snippet = '+x\n'.repeat(2000);
        const item = createDiffSelectionContextItem(makeDiffPayload({ snippet }), 'ctx-1');
        expect(DIFF_SELECTION_TEXT_SIZE_LIMIT).toBe(4000);
        expect(item.snippet).toBe(snippet.slice(0, 4000));
        expect(item.truncated).toBe(true);
    });

    it('copies location fields from the payload', () => {
        const item = createDiffSelectionContextItem(makeDiffPayload(), 'ctx-1');
        expect(item).toMatchObject({
            kind: 'diff-selection',
            sourceWorkspaceId: 'ws-1',
            filePath: 'src/a.ts',
            oldRange: { start: 10, end: 11 },
            newRange: { start: 10, end: 12 },
            ref: { type: 'commit', commitHash: '585e64d1234567890abcdef' },
            label: 'src/a.ts:L10-L12 @ 585e64d',
        });
    });

    it('adds via addSessionContext and removes by id', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => { result.current.addSessionContext(makeDiffPayload()); });
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].kind).toBe('diff-selection');
        act(() => { result.current.remove(result.current.items[0].id); });
        expect(result.current.items).toHaveLength(0);
    });
});

describe('diff-selection chip', () => {
    it('shows the label, a snippet preview, and no truncated badge for a short snippet', () => {
        const item = createDiffSelectionContextItem(makeDiffPayload(), 'ctx-1');
        render(<AttachedContextPreviews items={[item]} onRemove={vi.fn()} />);
        const chip = screen.getByTestId('attached-diff-selection-context-chip');
        expect(chip.textContent).toContain('Diff');
        expect(chip.textContent).toContain('src/a.ts:L10-L12 @ 585e64d');
        expect(screen.getByTestId('attached-diff-selection-context-preview').getAttribute('title')).toBe(item.snippet);
        expect(screen.queryByTestId('attached-diff-selection-truncated')).toBeNull();
    });

    it('marks a truncated snippet', () => {
        const item = createDiffSelectionContextItem(makeDiffPayload({ snippet: '+'.repeat(5000) }), 'ctx-1');
        render(<AttachedContextPreviews items={[item]} onRemove={vi.fn()} />);
        expect(screen.getByTestId('attached-diff-selection-truncated').textContent).toBe('truncated');
    });

    it('calls onRemove with the chip id', () => {
        const onRemove = vi.fn();
        const item = createDiffSelectionContextItem(makeDiffPayload(), 'ctx-7');
        render(<AttachedContextPreviews items={[item]} onRemove={onRemove} />);
        fireEvent.click(screen.getByTestId('attached-context-remove'));
        expect(onRemove).toHaveBeenCalledWith('ctx-7');
    });
});

// ── Enqueue dialog drop zone ────────────────────────────────────────────

if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

function WorkspaceSetter() {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'WORKSPACES_LOADED', workspaces: [{ id: 'ws-1', name: 'Repo', rootPath: '/repo' }] });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function DialogOpener() {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'OPEN_DIALOG', workspaceId: 'ws-1' });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <MinimizedDialogsProvider>
                    <WorkspaceSetter />
                    {children}
                </MinimizedDialogsProvider>
            </QueueProvider>
        </AppProvider>
    );
}

describe('EnqueueDialog diff-selection drop', () => {
    beforeEach(() => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        global.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) as any;
    });

    afterEach(() => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: false });
        vi.restoreAllMocks();
    });

    it('attaches a dropped diff selection as a chip', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>,
        );
        await waitFor(() => expect(screen.getByTestId('enqueue-drop-zone')).toBeTruthy());
        const payload = makeDiffPayload();
        act(() => {
            fireEvent.drop(screen.getByTestId('enqueue-drop-zone'), {
                dataTransfer: { files: [], ...transferFrom({ [DIFF_SELECTION_CONTEXT_DRAG_MIME]: JSON.stringify(payload) }) },
            });
        });
        await waitFor(() => {
            expect(screen.getByTestId('attached-diff-selection-context-chip').textContent).toContain('src/a.ts:L10-L12 @ 585e64d');
        });
    });
});
