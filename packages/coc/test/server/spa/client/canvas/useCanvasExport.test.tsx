/**
 * @vitest-environment jsdom
 *
 * useCanvasExport — copy / download / save-to-Notes / export-as-HTML state
 * transitions, driven through the injected browser primitives so nothing here
 * touches the real clipboard or triggers a download.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRef } from 'react';

const mocks = vi.hoisted(() => ({ exportCanvasAsHtml: vi.fn() }));

// Keep the real browser deps factory; stub only the orchestrator so the render
// pipeline (mermaid/excalidraw) never runs under Node.
vi.mock('../../../../../src/server/spa/client/react/features/canvas/html-export/exportCanvasAsHtml', async (importOriginal) => ({
    ...(await importOriginal() as Record<string, unknown>),
    exportCanvasAsHtml: mocks.exportCanvasAsHtml,
}));

import { useCanvasExport } from '../../../../../src/server/spa/client/react/features/canvas/hooks/useCanvasExport';

function makeCanvas(overrides: Record<string, unknown> = {}) {
    return {
        id: 'doc-abc123',
        workspaceId: 'ws-1',
        title: 'My Plan',
        type: 'markdown',
        revision: 3,
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z',
        lastEditor: 'ai',
        content: '# Plan body',
        ...overrides,
    } as any;
}

describe('useCanvasExport', () => {
    let copyText: ReturnType<typeof vi.fn>;
    let downloadBlob: ReturnType<typeof vi.fn>;
    let notify: ReturnType<typeof vi.fn>;
    let saveContent: ReturnType<typeof vi.fn>;
    let getExtension: ReturnType<typeof vi.fn>;
    let client: any;

    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        copyText = vi.fn().mockResolvedValue(undefined);
        downloadBlob = vi.fn();
        notify = vi.fn();
        saveContent = vi.fn().mockResolvedValue(undefined);
        getExtension = vi.fn();
        client = { canvases: { getExtension }, notes: { saveContent } };
        mocks.exportCanvasAsHtml.mockReset().mockResolvedValue({ ok: true, warnings: [] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function mount(canvas: any) {
        return renderHook(() => {
            const canvasRef = useRef(canvas);
            canvasRef.current = canvas;
            return useCanvasExport({
                client, workspaceId: 'ws-1', canvasRef, notify, deps: { copyText, downloadBlob },
            });
        });
    }

    it('copies the canvas content and clears the status after the flash window', async () => {
        const { result } = mount(makeCanvas());

        act(() => { result.current.setExportOpen(true); });
        await act(async () => { await result.current.copyContent(); });

        expect(copyText).toHaveBeenCalledWith('# Plan body');
        expect(result.current.exportStatus).toBe('Copied');
        // The menu closes as soon as an action runs.
        expect(result.current.exportOpen).toBe(false);

        await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
        expect(result.current.exportStatus).toBeNull();
    });

    it('reports a clipboard rejection as a failed copy, not a failed save', async () => {
        copyText.mockRejectedValue(new Error('denied'));
        const { result } = mount(makeCanvas());

        await act(async () => { await result.current.copyContent(); });

        expect(result.current.exportStatus).toBe('Copy failed');
        expect(notify).not.toHaveBeenCalled();
    });

    it('downloads plain text with the type-derived filename', async () => {
        const { result } = mount(makeCanvas());

        act(() => { result.current.download(); });

        const [blob, filename] = downloadBlob.mock.calls[0];
        expect(filename).toBe('doc.md');
        expect(blob.type).toBe('text/plain;charset=utf-8');
        // jsdom's Blob has no .text(); size is enough to prove the content went in.
        expect(blob.size).toBe('# Plan body'.length);
        expect(result.current.exportStatus).toBe('Downloaded');
    });

    it('downloads an svg code canvas with the image/svg+xml type', () => {
        const { result } = mount(makeCanvas({ type: 'code', language: 'svg', content: '<svg/>' }));

        act(() => { result.current.download(); });

        const [blob, filename] = downloadBlob.mock.calls[0];
        expect(filename).toBe('doc.svg');
        expect(blob.type).toBe('image/svg+xml');
    });

    it('reports a download failure without unmounting anything', () => {
        downloadBlob.mockImplementation(() => { throw new Error('blocked'); });
        const { result } = mount(makeCanvas());

        act(() => { result.current.download(); });

        expect(result.current.exportStatus).toBe('Download failed');
    });

    it('saves markdown canvases under canvases/ and ignores other types', async () => {
        const { result } = mount(makeCanvas());
        await act(async () => { await result.current.saveToNotes(); });
        expect(saveContent).toHaveBeenCalledWith('ws-1', 'canvases/doc.md', '# Plan body');
        expect(result.current.exportStatus).toBe('Saved to Notes');

        const code = mount(makeCanvas({ type: 'code', language: 'ts' }));
        await act(async () => { await code.result.current.saveToNotes(); });
        expect(saveContent).toHaveBeenCalledTimes(1);
    });

    it('reports a Notes write failure', async () => {
        saveContent.mockRejectedValue(new Error('no notes repo'));
        const { result } = mount(makeCanvas());

        await act(async () => { await result.current.saveToNotes(); });

        expect(result.current.exportStatus).toBe('Save to Notes failed');
    });

    it('hands the orchestrator the current canvas and reports success', async () => {
        const { result } = mount(makeCanvas({ type: 'code', language: 'python', content: 'x = 1' }));

        await act(async () => { await result.current.exportHtml(); });

        expect(mocks.exportCanvasAsHtml).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'My Plan', type: 'code', content: 'x = 1', language: 'python', workspaceId: 'ws-1' }),
            expect.any(Object),
        );
        expect(result.current.exportStatus).toBe('Exported HTML');
        expect(notify).not.toHaveBeenCalled();
    });

    it('skips kusto canvases entirely — there is no static snapshot to produce', async () => {
        const { result } = mount(makeCanvas({ type: 'kusto', content: '{}' }));

        await act(async () => { await result.current.exportHtml(); });

        expect(mocks.exportCanvasAsHtml).not.toHaveBeenCalled();
        expect(result.current.exportStatus).toBeNull();
    });

    it('fetches the extension UI doc and passes { uiHtml, revision } — never capabilitiesJs', async () => {
        getExtension.mockResolvedValue({ uiHtml: '<div>ui</div>', capabilitiesJs: 'SECRET' });
        const { result } = mount(makeCanvas({ type: 'extension', content: '{"n":1}' }));

        await act(async () => { await result.current.exportHtml(); });

        expect(getExtension).toHaveBeenCalledWith('ws-1', 'doc-abc123');
        const [source] = mocks.exportCanvasAsHtml.mock.calls[0];
        expect(source.extension).toEqual({ uiHtml: '<div>ui</div>', revision: 3 });
        expect(JSON.stringify(source)).not.toContain('SECRET');
    });

    it('aborts before any export when the extension UI doc cannot be fetched', async () => {
        getExtension.mockRejectedValue(new Error('404'));
        const { result } = mount(makeCanvas({ type: 'extension' }));

        await act(async () => { await result.current.exportHtml(); });

        expect(mocks.exportCanvasAsHtml).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith('Could not load the extension to export as HTML', 'error');
        expect(result.current.exportStatus).toBe('Export failed');
    });

    it('surfaces the orchestrator error message on a failed export', async () => {
        mocks.exportCanvasAsHtml.mockResolvedValue({ ok: false, error: 'render timed out', warnings: [] });
        const { result } = mount(makeCanvas());

        await act(async () => { await result.current.exportHtml(); });

        expect(notify).toHaveBeenCalledWith('render timed out', 'error');
        expect(result.current.exportStatus).toBe('Export failed');
    });

    it('reports warnings as info while still counting the export a success', async () => {
        mocks.exportCanvasAsHtml.mockResolvedValue({ ok: true, warnings: ['a', 'b'] });
        const { result } = mount(makeCanvas());

        await act(async () => { await result.current.exportHtml(); });

        expect(notify).toHaveBeenCalledWith('Exported HTML with 2 warnings', 'info');
        expect(result.current.exportStatus).toBe('Exported HTML');
    });

    it('singularizes a lone warning', async () => {
        mocks.exportCanvasAsHtml.mockResolvedValue({ ok: true, warnings: ['a'] });
        const { result } = mount(makeCanvas());

        await act(async () => { await result.current.exportHtml(); });

        expect(notify).toHaveBeenCalledWith('Exported HTML with 1 warning', 'info');
    });

    it('stays mounted when the orchestrator itself throws', async () => {
        mocks.exportCanvasAsHtml.mockRejectedValue(new Error('deps blew up'));
        const { result } = mount(makeCanvas());

        await act(async () => { await result.current.exportHtml(); });

        expect(notify).toHaveBeenCalledWith('Export failed', 'error');
        expect(result.current.exportStatus).toBe('Export failed');
    });

    it('does nothing at all before the canvas has loaded', async () => {
        const { result } = mount(null);

        await act(async () => { await result.current.copyContent(); });
        act(() => { result.current.download(); });
        await act(async () => { await result.current.saveToNotes(); });
        await act(async () => { await result.current.exportHtml(); });

        expect(copyText).not.toHaveBeenCalled();
        expect(downloadBlob).not.toHaveBeenCalled();
        expect(saveContent).not.toHaveBeenCalled();
        expect(mocks.exportCanvasAsHtml).not.toHaveBeenCalled();
        expect(result.current.exportStatus).toBeNull();
    });
});
