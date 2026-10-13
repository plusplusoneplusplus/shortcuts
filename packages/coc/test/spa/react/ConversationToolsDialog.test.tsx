import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ConversationToolInventoryResponse } from '@plusplusoneplusplus/coc-client';
import { ConversationToolsDialog, type ConversationToolsDialogProps } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationToolsDialog';
import { useToolInventoryUpdates } from '../../../src/server/spa/client/react/features/chat/hooks/useToolInventoryUpdates';

const turn = { turnId: 'latest', turnIndex: 3, provider: 'copilot', startedAt: '2026-10-13T10:00:00Z' };
const captured: ConversationToolInventoryResponse = {
    state: 'captured', turn,
    snapshot: { version: 1, provider: 'copilot', capturedAt: '2026-10-13T10:00:01Z', truncated: false,
        categories: [{ source: 'builtin', status: 'complete' }, { source: 'coc', status: 'complete' }, { source: 'mcp', status: 'partial', reason: 'Metadata unavailable' }],
        tools: [
            { source: 'builtin', name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
            { source: 'coc', name: 'list_notes', description: 'Browse saved notes', inputSchema: false },
            { source: 'mcp', serverName: 'CoC', name: 'unused_tool' },
            { source: 'mcp', serverName: 'Search server', name: 'search_web', description: 'Find pages' },
        ],
    },
};

function fixture(response: ConversationToolInventoryResponse = captured) {
    const getToolInventory = vi.fn().mockResolvedValue(response);
    const client = { processes: { getToolInventory } } as any;
    const onClose = vi.fn();
    const props = { open: true, client, workspaceId: 'owner-workspace', processId: 'proc-1', onClose };
    return { props, getToolInventory, onClose };
}

function LiveReader({ baseUrl, ...props }: ConversationToolsDialogProps & { baseUrl?: string }) {
    const refreshKey = useToolInventoryUpdates(baseUrl, props.workspaceId, props.processId);
    return <ConversationToolsDialog {...props} refreshKey={refreshKey} />;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('ConversationToolsDialog', () => {
    it('loads lazily through the supplied owner client with cancellation and no calls while closed', async () => {
        const f = fixture();
        const view = render(<ConversationToolsDialog {...f.props} open={false} />);
        expect(f.getToolInventory).not.toHaveBeenCalled();
        view.rerender(<ConversationToolsDialog {...f.props} />);
        await screen.findByText('read_file');
        expect(f.getToolInventory).toHaveBeenCalledTimes(1);
        expect(f.getToolInventory).toHaveBeenCalledWith('proc-1', { workspace: 'owner-workspace' }, { signal: expect.any(AbortSignal) });
        const signal = f.getToolInventory.mock.calls[0][2].signal;
        view.rerender(<ConversationToolsDialog {...f.props} open={false} />);
        expect(signal.aborted).toBe(true);
    });

    it('groups unused advertised tools by source and individual MCP server, with exact descriptor details', async () => {
        const f = fixture(); render(<ConversationToolsDialog {...f.props} />);
        await screen.findByText('read_file');
        expect(screen.getByRole('region', { name: 'Built-in' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'CoC' })).toBeTruthy();
        const mcp = screen.getByRole('region', { name: 'MCP · CoC' });
        expect(within(mcp).getByText('unused_tool')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'MCP · Search server' })).toBeTruthy();
        fireEvent.click(screen.getByText('read_file'));
        expect(screen.getByText('Read a file')).toBeTruthy();
        expect(screen.getByText(/"path":/)).toBeTruthy();
        expect(screen.getByText('false')).toBeTruthy();
        expect(within(mcp).getByText('Description unavailable')).toBeTruthy();
        expect(within(mcp).getByText('Input schema unavailable')).toBeTruthy();
        expect(screen.getByText(/Latest started turn · copilot/).textContent).toContain('Captured');
        expect(screen.getByText(/may still require approval/)).toBeTruthy();
        expect(screen.getByText('MCP: partial — Metadata unavailable')).toBeTruthy();
    });

    it.each(['LIST_NOTES', 'saved notes', 'Search server'])('searches names, descriptions and server labels: %s', async query => {
        const f = fixture(); render(<ConversationToolsDialog {...f.props} />);
        await screen.findByText('read_file');
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
        expect(screen.queryByText('read_file')).toBeNull();
        expect(screen.getByText(query === 'Search server' ? 'search_web' : 'list_notes')).toBeTruthy();
        expect(screen.getByText('(1 / 1)')).toBeTruthy();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no such tool' } });
        expect(screen.getByText('No matching tools.')).toBeTruthy();
    });

    it('distinguishes historical unavailable, pending, capture gaps, and truncation without invented tools', async () => {
        const f = fixture({ state: 'unavailable' });
        const view = render(<ConversationToolsDialog {...f.props} />);
        await screen.findByText('Inventory unavailable');
        f.getToolInventory.mockResolvedValue({ state: 'pending', turn });
        view.rerender(<ConversationToolsDialog {...f.props} refreshKey={1} />);
        await screen.findByText(/Inventory pending/);
        expect(screen.queryByText('read_file')).toBeNull();
        f.getToolInventory.mockResolvedValue({ ...captured, snapshot: { ...(captured as any).snapshot, tools: [], truncated: true,
            categories: ['builtin', 'coc', 'mcp'].map(source => ({ source, status: 'unavailable', reason: 'Runtime discovery unsupported' })) } });
        view.rerender(<ConversationToolsDialog {...f.props} refreshKey={2} />);
        await screen.findByText('Inventory unavailable');
        expect(screen.getByText(/Inventory truncated/)).toBeTruthy();
        expect(screen.getAllByText(/unavailable — Runtime discovery unsupported/)).toHaveLength(3);
        expect(screen.queryByText('read_file')).toBeNull();
    });

    it('refreshes pending capture only while open', async () => {
        vi.useFakeTimers();
        const f = fixture({ state: 'pending', turn });
        const view = render(<ConversationToolsDialog {...f.props} />);
        await act(async () => { await Promise.resolve(); });
        f.getToolInventory.mockResolvedValue(captured);
        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
        expect(screen.getByText('read_file')).toBeTruthy();
        await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
        expect(f.getToolInventory).toHaveBeenCalledTimes(2);
        view.unmount();
        expect(f.getToolInventory.mock.calls[1][2].signal.aborted).toBe(true);
    });

    it('clears a preceding snapshot immediately on new-turn refresh and ignores late results from another owner', async () => {
        const f = fixture();
        const view = render(<ConversationToolsDialog {...f.props} />);
        await screen.findByText('read_file');
        let finish!: (response: ConversationToolInventoryResponse) => void;
        f.getToolInventory.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        view.rerender(<ConversationToolsDialog {...f.props} refreshKey="new-turn" />);
        expect(screen.queryByText('read_file')).toBeNull();
        expect(screen.getByText('Loading tool inventory…')).toBeTruthy();
        const other = fixture({ state: 'unavailable' });
        view.rerender(<ConversationToolsDialog {...other.props} workspaceId="remote-owner" />);
        await screen.findByText('Inventory unavailable');
        await act(async () => { finish(captured); });
        expect(screen.queryByText('read_file')).toBeNull();
        expect(other.getToolInventory.mock.calls[0][1]).toEqual({ workspace: 'remote-owner' });
        expect(f.getToolInventory.mock.calls[1][2].signal.aborted).toBe(true);
    });

    it.each([undefined, 'https://owner.example.test'])(
        'invalidates an open reader on actual starts and capture from owner %s, ignoring stale reads and recovering on reconnect',
        async baseUrl => {
            const f = fixture();
            const view = render(<LiveReader {...f.props} baseUrl={baseUrl} />);
            await screen.findByText('read_file');
            const emit = (state: 'pending' | 'captured', turnId = 'next-turn') => {
                const message = { type: 'tool-inventory-changed', workspaceId: f.props.workspaceId,
                    processId: f.props.processId, turnId, state };
                act(() => { window.dispatchEvent(new CustomEvent(
                    baseUrl ? 'coc-remote-ws-message' : 'coc-local-ws-message',
                    { detail: baseUrl ? { baseUrl, message } : message },
                )); });
            };
            let finishOld!: (response: ConversationToolInventoryResponse) => void;
            f.getToolInventory.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
            // A reconnect read of the preceding capture can still be in flight at the new start.
            act(() => { window.dispatchEvent(new CustomEvent(
                baseUrl ? 'coc-remote-ws-connect' : 'coc-local-ws-connect', { detail: { baseUrl } },
            )); });
            const oldSignal = f.getToolInventory.mock.calls[1][2].signal;
            const nextTurn = { ...turn, turnId: 'next-turn', provider: 'claude' };
            f.getToolInventory.mockResolvedValue({ state: 'pending', turn: nextTurn });
            emit('pending');
            expect(screen.queryByText('read_file')).toBeNull();
            expect(oldSignal.aborted).toBe(true);
            await screen.findByText(/Inventory pending/);
            await act(async () => { finishOld(captured); });
            expect(screen.queryByText('read_file')).toBeNull();
            const nextCapture: ConversationToolInventoryResponse = { ...captured, turn: nextTurn,
                snapshot: { ...captured.snapshot, provider: 'claude', tools: [{ source: 'builtin', name: 'new_unused_tool' }] } };
            f.getToolInventory.mockResolvedValue(nextCapture);
            emit('captured');
            await screen.findByText('new_unused_tool');
            expect(screen.queryByText('read_file')).toBeNull();
            expect(screen.getByText(/Latest started turn · claude/)).toBeTruthy();
            view.rerender(<LiveReader {...f.props} baseUrl={baseUrl} open={false} />);
            const reads = f.getToolInventory.mock.calls.length;
            emit('pending', 'another-turn');
            expect(f.getToolInventory).toHaveBeenCalledTimes(reads);
            view.rerender(<LiveReader {...f.props} baseUrl={baseUrl} />);
            await screen.findByText('new_unused_tool');
            expect(f.getToolInventory).toHaveBeenCalledTimes(reads + 1);
        },
    );

    it('shows retrieval errors without provider error bodies or a successful empty inventory', async () => {
        const f = fixture(); f.getToolInventory.mockRejectedValue(new Error('secret provider body'));
        render(<ConversationToolsDialog {...f.props} />);
        expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not load tool inventory.');
        expect(screen.queryByText('Inventory unavailable')).toBeNull();
        expect(screen.queryByText(/secret/)).toBeNull();
    });

    it('focuses search, traps keyboard and programmatic focus, handles Escape, and returns focus to the surviving trigger', async () => {
        const f = fixture(); const triggerRef = createRef<HTMLButtonElement>();
        const view = render(<><button ref={triggerRef}>Metadata</button><ConversationToolsDialog {...f.props} returnFocusRef={triggerRef} /></>);
        await screen.findByText('read_file');
        const search = screen.getByRole('searchbox');
        const dialog = screen.getByRole('dialog', { name: 'Tools' });
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.activeElement).toBe(search);
        const close = screen.getByRole('button', { name: 'Close' });
        close.focus(); fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(screen.getByText('search_web'));
        fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
        expect(document.activeElement).toBe(close);
        triggerRef.current!.focus();
        expect(dialog.contains(document.activeElement)).toBe(true);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(f.onClose).toHaveBeenCalledTimes(1);
        view.rerender(<><button ref={triggerRef}>Metadata</button><ConversationToolsDialog {...f.props} open={false} returnFocusRef={triggerRef} /></>);
        expect(document.activeElement).toBe(triggerRef.current);
    });

    it('uses the shared full-screen mobile dialog and renders descriptor strings as inert text', async () => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 767px)', media: query,
            addEventListener: vi.fn(), removeEventListener: vi.fn() }));
        const f = fixture({ ...captured, snapshot: { ...(captured as any).snapshot,
            tools: [{ source: 'builtin', name: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' }] } });
        render(<ConversationToolsDialog {...f.props} />);
        await screen.findByText('<script>alert(1)</script>');
        expect(screen.getByRole('dialog').className).toContain('h-full');
        expect(screen.getByRole('dialog').querySelector('script, img')).toBeNull();
        expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    });
});
