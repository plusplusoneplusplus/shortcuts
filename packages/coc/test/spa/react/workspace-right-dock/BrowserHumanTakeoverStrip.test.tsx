import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserHumanTakeoverStrip } from '../../../../src/server/spa/client/react/shared/file-path/BrowserHumanTakeoverStrip';
import { clearBrowserTakeover, setBrowserTakeover } from '../../../../src/server/spa/client/react/shared/file-path/browser-takeover';
const mock = vi.hoisted(() => ({ takeover: vi.fn(), supported: true, flag: true }));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', () => ({ desktopBrowserBridge: () => ({ control: { humanTakeoverSupported: mock.supported, takeover: mock.takeover } }) }));
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({ isFeatureEnabled: () => mock.flag }));
const owner = { workspaceId: 'w', processId: 'p', turnId: 'turn', routingRef: 'clone:w', viewIds: ['one', 'two'] };
afterEach(() => { cleanup(); clearBrowserTakeover('clone:w', 'p'); });
beforeEach(() => { mock.takeover.mockReset().mockResolvedValue(undefined); mock.supported = true; mock.flag = true; });
const mount = () => render(<BrowserHumanTakeoverStrip routingRef="clone:w" viewId="one" />);
describe('browser toolbar human handoff', () => {
    it('supports keyboard buttons, narrow/theme classes, optional note and explicit Return without navigation or chat UI', async () => {
        setBrowserTakeover({ ...owner, status: 'agent' }); const hash = location.hash; mount();
        const take = screen.getByRole('button', { name: 'Take over' }); take.focus(); expect(document.activeElement).toBe(take);
        fireEvent.click(take); await waitFor(() => expect(mock.takeover).toHaveBeenCalledWith(expect.objectContaining(owner), 'take', undefined));
        act(() => setBrowserTakeover({ ...owner, status: 'human', reason: 'Complete sign-in' }));
        expect(screen.getByText('Complete sign-in')).toBeTruthy(); expect(screen.getByRole('status').textContent).toContain('Your help needed');
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Signed in' } });
        fireEvent.click(screen.getByRole('button', { name: 'Return to agent' }));
        await waitFor(() => expect(mock.takeover).toHaveBeenLastCalledWith(expect.objectContaining(owner), 'return', 'Signed in'));
        expect(location.hash).toBe(hash); expect(screen.queryByTestId('chat-takeover')).toBeNull();
        expect(screen.getByTestId('browser-human-takeover').className).toContain('flex-wrap');
        expect(screen.getByTestId('browser-human-takeover').className).toContain('dark:');
    });
    it.each(['taking-over', 'checking'] as const)('shows %s without automatic return or focus stealing', status => {
        setBrowserTakeover({ ...owner, status }); mount();
        expect(screen.getByRole('status').textContent).toContain(status === 'checking' ? 'Checking page' : 'Taking over');
        expect(screen.queryByRole('button', { name: 'Return to agent' })).toBeNull();
        expect(mock.takeover).not.toHaveBeenCalled();
    });
    it('shows refresh failure with retry and Stop, which only calls browser continuation IPC', async () => {
        setBrowserTakeover({ ...owner, status: 'human', error: 'Could not refresh. Retry or Stop.' }); mount();
        expect(screen.getByRole('alert').textContent).toContain('Retry');
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        await waitFor(() => expect(mock.takeover).toHaveBeenCalledWith(expect.objectContaining(owner), 'stop', undefined));
    });
    it('isolates exact view/clone identity and reports older hosts explicitly only when enabled', () => {
        setBrowserTakeover({ ...owner, status: 'human' });
        const other = render(<BrowserHumanTakeoverStrip routingRef="other" viewId="one" />); expect(other.container.textContent).toBe(''); other.unmount();
        mock.supported = false; mount(); // a live state already exists; older-host case uses no matching state
        cleanup(); render(<BrowserHumanTakeoverStrip routingRef="other" viewId="one" />);
        expect(screen.getByRole('status').textContent).toContain('unavailable');
        cleanup(); mock.flag = false; render(<BrowserHumanTakeoverStrip routingRef="other" viewId="one" />);
        expect(screen.queryByRole('status')).toBeNull();
    });
    it('never carries a draft note into another conversation turn on the same view', async () => {
        setBrowserTakeover({ ...owner, status: 'human' }); mount();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'private first-turn note' } });
        act(() => setBrowserTakeover({ ...owner, turnId: 'next', status: 'human' }));
        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
        fireEvent.click(screen.getByRole('button', { name: 'Return to agent' }));
        await waitFor(() => expect(mock.takeover).toHaveBeenCalledWith(expect.objectContaining({ turnId: 'next' }), 'return', ''));
    });

});
