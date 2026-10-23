// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BrowserNavigationPrompts, FloatingBrowserNavigationPrompts } from '../../../../src/server/spa/client/react/shared/file-path/BrowserNavigationApprovalCard';
import { clearBrowserNavigationPrompt, setBrowserNavigationPrompt, type BrowserNavigationPromptEntry } from '../../../../src/server/spa/client/react/shared/file-path/browser-navigation-prompts';
import { registerCloneBaseUrls } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const entry = (overrides: Partial<BrowserNavigationPromptEntry> = {}): BrowserNavigationPromptEntry => ({
    key: 'k1', checkId: 'c1', workspaceId: 'ws-a', processId: 'p1', turnId: 't1',
    site: 'example.com', url: 'https://mail.example.com/inbox?x=1', answer: vi.fn(), ...overrides,
});

afterEach(() => {
    cleanup();
    for (const key of ['k1', 'k2']) clearBrowserNavigationPrompt(key);
    registerCloneBaseUrls([]);
});

describe('browser navigation approval card', () => {
    it.each([
        ['browser-navigation-allow-once', 'once'],
        ['browser-navigation-allow-always', 'always'],
        ['browser-navigation-deny', 'deny'],
    ] as const)('%s answers %s once and disables the buttons', (testId, answer) => {
        const prompt = entry();
        render(<BrowserNavigationPrompts workspaceId="ws-a" processId="p1" />);
        act(() => setBrowserNavigationPrompt(prompt));
        expect(screen.getByTestId('browser-navigation-site').textContent).toBe('example.com');
        expect(screen.getByTestId('browser-navigation-url').textContent).toBe('https://mail.example.com/inbox?x=1');
        expect(screen.getByTestId('browser-navigation-allow-always').textContent).toBe('Always allow example.com');
        fireEvent.click(screen.getByTestId(testId));
        expect(prompt.answer).toHaveBeenCalledExactlyOnceWith(answer);
        for (const id of ['browser-navigation-allow-once', 'browser-navigation-allow-always', 'browser-navigation-deny']) {
            expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
        }
    });

    it('removes the card when the prompt is cleared (stop, cancel, turn end or socket close)', () => {
        render(<BrowserNavigationPrompts workspaceId="ws-a" processId="p1" />);
        act(() => setBrowserNavigationPrompt(entry()));
        expect(screen.getByTestId('browser-navigation-approval')).toBeTruthy();
        act(() => clearBrowserNavigationPrompt('k1'));
        expect(screen.queryByTestId('browser-navigation-approval')).toBeNull();
    });

    it('shows only the conversation’s own prompts inline, matching remote clones by their server', () => {
        const baseUrl = 'http://127.0.0.1:4500';
        registerCloneBaseUrls([{ workspaceId: 'ws-a', serverId: 'server', baseUrl }]);
        render(<>
            <div data-testid="local"><BrowserNavigationPrompts workspaceId="ws-a" processId="p1" /></div>
            <div data-testid="remote"><BrowserNavigationPrompts workspaceId="remote:server:ws-a" processId="p1" /></div>
        </>);
        act(() => {
            setBrowserNavigationPrompt(entry());
            setBrowserNavigationPrompt(entry({ key: 'k2', sourceBaseUrl: baseUrl, site: 'remote.dev', url: 'https://remote.dev/' }));
        });
        expect(screen.getByTestId('local').textContent).toContain('example.com');
        expect(screen.getByTestId('local').textContent).not.toContain('remote.dev');
        expect(screen.getByTestId('remote').textContent).toContain('remote.dev');
        expect(screen.getByTestId('remote').textContent).not.toContain('example.com');
    });

    it('floats prompts whose chat is not on screen and stops floating them once the chat mounts', () => {
        render(<FloatingBrowserNavigationPrompts />);
        act(() => setBrowserNavigationPrompt(entry()));
        expect(screen.getAllByTestId('browser-navigation-approval')).toHaveLength(1);
        const chat = render(<BrowserNavigationPrompts workspaceId="ws-a" processId="p1" />);
        // One card total: the inline one; the floating list skips the hosted conversation.
        expect(screen.getAllByTestId('browser-navigation-approval')).toHaveLength(1);
        expect(chat.container.querySelector('[data-testid="browser-navigation-approval"]')).toBeTruthy();
        chat.unmount();
        expect(screen.getAllByTestId('browser-navigation-approval')).toHaveLength(1);
    });
});
