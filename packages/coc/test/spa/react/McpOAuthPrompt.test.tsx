import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpOAuthPrompts } from '../../../src/server/spa/client/react/features/chat/McpOAuthPrompt';
import { useChatMcpOAuthPrompts } from '../../../src/server/spa/client/react/features/chat/hooks/useChatMcpOAuthPrompts';

let controls: ReturnType<typeof useChatMcpOAuthPrompts>;
const request = vi.fn();
const client = { request };
function Harness({ owner = 'remote-a/workspace/chat', workspace = 'workspace', process = 'chat', available = true, ownerClient = client }) {
    controls = useChatMcpOAuthPrompts(owner, ownerClient, workspace, process, available);
    return <McpOAuthPrompts controls={controls} />;
}
const prompt = (requestId: string, authorizationUrl?: string) => ({
    requestId, serverName: `Server ${requestId}`, serverUrl: 'https://mcp.example', authorizationUrl,
});
const add = (...ids: string[]) => act(() => ids.forEach(id => controls.add(prompt(id))));
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
    vi.useFakeTimers();
    request.mockReset().mockResolvedValue({ status: 'pending' });
    vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('chat MCP authentication dismissal', () => {
    it('leaves no empty section before prompts arrive or after the last dismissal', async () => {
        const { container } = render(<Harness />);
        expect(container).toBeEmptyDOMElement();
        add('one');
        expect(screen.getByRole('region', { name: 'MCP authentication requests' })).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: /Dismiss authentication/ }));
        await flush();
        expect(container).toBeEmptyDOMElement();
    });

    it('dismisses one card without authenticating and preserves its sibling', async () => {
        render(<Harness />);
        add('one', 'two');
        expect(screen.getByRole('button', { name: /Dismiss all MCP/ })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss authentication request for Server one' }));
        await flush();
        expect(screen.queryByText('Server one')).toBeNull();
        expect(screen.getByText('Server two')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Dismiss all MCP/ })).toBeNull();
        expect(request.mock.calls).toEqual([[
            '/mcp-oauth/pending/one?workspaceId=workspace&processId=chat', { method: 'DELETE', timeoutMs: 15_000 },
        ]]);
        add('one', 'fresh');
        expect(screen.queryByText('Server one')).toBeNull();
        expect(screen.getByText('Server fresh')).toBeTruthy();
    });

    it('dismisses only the visible snapshot and permits a fresh request from the same server', async () => {
        render(<Harness />);
        add('one', 'two');
        fireEvent.click(screen.getByRole('button', { name: /Dismiss all MCP/ }));
        add('fresh');
        await flush();
        expect(screen.getAllByTestId('mcp-oauth-prompt')).toHaveLength(1);
        expect(screen.getByText('Server fresh')).toBeTruthy();
        expect(request.mock.calls.map(([path]) => path)).toEqual([
            '/mcp-oauth/pending/one?workspaceId=workspace&processId=chat',
            '/mcp-oauth/pending/two?workspaceId=workspace&processId=chat',
        ]);
        act(() => controls.add({ ...prompt('another'), serverName: 'Server one' }));
        expect(screen.getByText('Server one')).toBeTruthy();
    });

    it.each(['individual', 'all'])('blocks late poll completion and retry after %s dismissal', async mode => {
        let resolvePoll!: (value: unknown) => void;
        request.mockImplementation((_path, options) => options?.method === 'DELETE'
            ? Promise.resolve({ removed: true }) : new Promise(resolve => { resolvePoll = resolve; }));
        render(<Harness />);
        act(() => controls.add(prompt('one', 'https://auth.example')));
        if (mode === 'all') add('two');
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        fireEvent.click(screen.getByRole('button', { name: mode === 'all' ? /Dismiss all MCP/ : 'Dismiss authentication request for Server one' }));
        await act(async () => { resolvePoll({ status: 'completed' }); await Promise.resolve(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
        expect(screen.queryByTestId('mcp-oauth-prompt')).toBeNull();
        expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toEqual([]);
        expect(request.mock.calls.filter(([, options]) => !options?.method)).toHaveLength(1);
    });

    it.each([
        { owner: 'remote-b/workspace/chat', workspace: 'workspace', process: 'chat' },
        { owner: 'remote-a/other/chat', workspace: 'other', process: 'chat' },
        { owner: 'remote-a/workspace/other', workspace: 'workspace', process: 'other' },
    ])('isolates dismissal from another owner $owner and rejects old callbacks', async next => {
        const view = render(<Harness />);
        add('same');
        const old = controls;
        fireEvent.click(screen.getByRole('button', { name: /Dismiss authentication/ }));
        view.rerender(<Harness {...next} />);
        act(() => old.add(prompt('late')));
        expect(screen.queryByTestId('mcp-oauth-prompt')).toBeNull();
        add('same');
        act(() => old.dismiss(['same']));
        expect(screen.getByText('Server same')).toBeTruthy();
        await flush();
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('retains dismissal across navigation back to the same owner, using each owner client', async () => {
        const remoteRequest = vi.fn().mockResolvedValue({ removed: true });
        const remoteClient = { request: remoteRequest };
        const view = render(<Harness />);
        add('same');
        fireEvent.click(screen.getByRole('button', { name: /Dismiss authentication/ }));
        view.rerender(<Harness owner="remote-b/workspace/chat" ownerClient={remoteClient} />);
        add('same');
        fireEvent.click(screen.getByRole('button', { name: /Dismiss authentication/ }));
        await flush();
        expect(request).toHaveBeenCalledTimes(1);
        expect(remoteRequest).toHaveBeenCalledTimes(1);
        view.rerender(<Harness />);
        add('same', 'fresh');
        expect(screen.queryByText('Server same')).toBeNull();
        expect(screen.getByText('Server fresh')).toBeTruthy();
    });

    it('stops late completion on navigation without cancelling a different owner', async () => {
        let resolvePoll!: (value: unknown) => void;
        request.mockImplementation(() => new Promise(resolve => { resolvePoll = resolve; }));
        const view = render(<Harness />);
        act(() => controls.add(prompt('one', 'https://auth.example')));
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        view.rerender(<Harness owner="other" process="other" />);
        await act(async () => { resolvePoll({ status: 'completed' }); });
        expect(request).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('mcp-oauth-prompt')).toBeNull();
    });

    it('shows cancellation failure with a scoped retry, while keeping the card retired', async () => {
        request.mockRejectedValueOnce(new Error('offline'));
        render(<Harness />);
        add('one');
        fireEvent.click(screen.getByRole('button', { name: /Dismiss authentication/ }));
        await flush();
        expect(screen.getByRole('alert').textContent).toContain('could not be cancelled');
        expect(screen.getByRole('region', { name: 'MCP authentication requests' })).toBeVisible();
        add('one');
        expect(screen.queryByTestId('mcp-oauth-prompt')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry dismissal' }));
        await flush();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
    });

    it('keeps a late cancellation error with its exact owner across navigation', async () => {
        let rejectCancellation!: (error: Error) => void;
        request.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCancellation = reject; }));
        const view = render(<Harness />);
        add('one');
        fireEvent.click(screen.getByRole('button', { name: /Dismiss authentication/ }));
        view.rerender(<Harness owner="other" process="other" />);
        await act(async () => { rejectCancellation(new Error('offline')); });
        expect(screen.queryByRole('alert')).toBeNull();
        view.rerender(<Harness />);
        expect(screen.getByRole('alert')).toBeTruthy();
        add('one');
        expect(screen.queryByTestId('mcp-oauth-prompt')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry dismissal' }));
        await flush();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('treats a missing request as dismissed and fails closed for unavailable owners', async () => {
        request.mockRejectedValueOnce({ status: 404 });
        const view = render(<Harness />);
        add('one');
        fireEvent.click(screen.getByRole('button', { name: /Dismiss authentication/ }));
        await flush();
        expect(screen.queryByRole('alert')).toBeNull();
        view.rerender(<Harness owner="unresolved" available={false} />);
        add('two');
        fireEvent.click(screen.getByRole('button', { name: /Dismiss authentication/ }));
        await flush();
        expect(request).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('keeps sign-in and successful polling on the owner request path', async () => {
        request.mockResolvedValue({ status: 'completed' });
        render(<Harness />);
        act(() => controls.add(prompt('one', 'https://auth.example')));
        expect(window.open).toHaveBeenCalledWith('https://auth.example', '_blank', 'noopener,noreferrer');
        expect(screen.getByRole('link', { name: /Open authorization page again/ })).toBeTruthy();
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(request.mock.calls).toEqual([
            ['/mcp-oauth/pending/one?workspaceId=workspace&processId=chat', { timeoutMs: 15_000 }],
            ['/mcp-oauth/pending/one/complete-and-retry?workspaceId=workspace&processId=chat', { method: 'POST', timeoutMs: 15_000 }],
        ]);
    });
});
