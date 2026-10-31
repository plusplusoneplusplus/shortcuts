import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { StrictMode } from 'react';
import { BrowserDemoReview } from '../../../../src/server/spa/client/react/shared/file-path/BrowserDemoReview';
import { listBrowserDemos, resetBrowserDemosForTest, runBrowserDemoCommand } from '../../../../src/server/spa/client/react/shared/file-path/browser-demo';
import {
    buildBrowserDemoAttachment, describeBrowserDemoStep, getBrowserDemoEdits, looksLikeSecret, resetBrowserDemoEditsForTest,
} from '../../../../src/server/spa/client/react/shared/file-path/browser-demo-review';
import type { BrowserDemoSnapshot, BrowserDemoState } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

const mock = vi.hoisted(() => ({
    command: vi.fn(),
    listeners: [] as Array<(state: unknown) => void>,
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', () => {
    const demo = {
        supported: true,
        command: (command: unknown) => mock.command(command),
        onState: (callback: (state: unknown) => void) => { mock.listeners.push(callback); return () => { mock.listeners = mock.listeners.filter(c => c !== callback); }; },
    };
    return { desktopBrowserBridge: () => ({ demo }) };
});

const owner = { workspaceId: 'ws-remote', processId: 'chat-1', routingRef: 'clone:ws-remote' };
// Generate synthetic credentials so secret scanners do not flag the test source.
const credentialExample = `ghp_${'x'.repeat(16)}`;
const state = (patch: Partial<BrowserDemoState> = {}): BrowserDemoState => ({
    id: 'demo-1', owner, status: 'stopped', stepCount: 6, tabCount: 2, viewIds: ['one', 'two'], incomplete: true, ...patch,
});
const snapshot = (): BrowserDemoSnapshot => ({
    id: 'demo-1', owner, status: 'stopped', startedAt: 1, incomplete: true,
    tabs: [
        { viewId: 'one', index: 1, url: 'https://shop.example/settings', title: 'Settings' },
        { viewId: 'two', index: 2, openerViewId: 'one', url: 'https://pay.example/checkout?id=', title: 'Checkout' },
    ],
    steps: [
        { id: 1, at: 1, viewId: 'one', type: 'tab-opened', url: 'https://shop.example/settings' },
        { id: 2, at: 2, viewId: 'one', type: 'action', action: { kind: 'click', role: 'link', label: 'Billing `x`', url: 'https://shop.example/settings' } },
        { id: 3, at: 3, viewId: 'two', type: 'tab-opened', openerViewId: 'one', url: 'https://pay.example/checkout?id=' },
        { id: 4, at: 4, viewId: 'two', type: 'action', action: { kind: 'type', role: 'textbox', label: 'Email', url: 'https://pay.example/checkout' } },
        { id: 5, at: 5, viewId: 'two', type: 'action', action: { kind: 'type', role: 'textbox', label: 'Password', url: 'https://pay.example/checkout', sensitive: true } },
        { id: 6, at: 6, viewId: 'two', type: 'gap', reason: 'rate-limit' },
    ],
});
const push = (value: BrowserDemoState) => act(() => { for (const listener of mock.listeners) listener(value); });

let sendMessage: ReturnType<typeof vi.fn>;
const client = () => ({ processes: { sendMessage } }) as unknown as CocClient;
const commands = () => mock.command.mock.calls.map(([command]) => command as { action: string });

async function mount(onClose = vi.fn()) {
    await runBrowserDemoCommand({ action: 'list' });
    const view = render(<BrowserDemoReview demoId="demo-1" client={client()} onClose={onClose} />);
    await screen.findAllByTestId('browser-demo-review-step');
    return { ...view, onClose };
}

beforeEach(() => {
    mock.listeners = [];
    sendMessage = vi.fn(async () => ({}));
    mock.command.mockReset().mockImplementation(async (command: { action: string }) => {
        if (command.action === 'list') return { ok: true, drafts: [state()] };
        if (command.action === 'draft') return { ok: true, draft: snapshot() };
        return { ok: true };
    });
});
afterEach(() => { cleanup(); resetBrowserDemosForTest(); resetBrowserDemoEditsForTest(); });

describe('browser demo attachment', () => {
    it('describes actions without values and keeps lineage', () => {
        const draft = snapshot();
        expect(describeBrowserDemoStep(draft.steps[3], draft.tabs)).toBe('Typed into \'Email\' — value omitted');
        expect(describeBrowserDemoStep(draft.steps[4], draft.tabs)).toBe('Typed into a sensitive field — value omitted');
        expect(describeBrowserDemoStep(draft.steps[2], draft.tabs)).toBe('Opened Tab 2 from Tab 1');
        expect(describeBrowserDemoStep(draft.steps[5], draft.tabs)).toContain('not captured');
    });

    it('leaves out removed steps, adds notes and examples, and keeps site text inside its fences', () => {
        const attachment = buildBrowserDemoAttachment(snapshot(), {
            removed: [1], notes: { 2: 'open billing\n## injected' }, examples: { 4: 'jane@example.com', 5: 'hunter2' }, message: 'How do I automate this?',
        }, new Date(2026, 9, 31, 9, 5));
        expect(attachment.name).toBe('browser-demo-20261031-0905.md');
        expect(attachment.stepCount).toBe(5);
        expect(attachment.markdown).toContain('Do not perform any browser input in this turn');
        expect(attachment.markdown).toContain('1. [Tab 1] Clicked link \'Billing \'x\'\'');
        expect(attachment.markdown).toContain('   - Note: open billing ## injected');
        expect(attachment.markdown).toContain('Example value (made up by the user, not a real value): jane@example.com');
        // A sensitive field never carries an example value, even if one was typed into the edit map.
        expect(attachment.markdown).not.toContain('hunter2');
        expect(attachment.markdown).toContain('Gap: Too many actions');
        expect(attachment.markdown).toContain('Tab 2: Checkout — https://pay.example/checkout?id= (opened from Tab 1)');
        expect(attachment.markdown.match(/```/g)).toHaveLength(2);
        const json = JSON.parse(attachment.markdown.split('```json\n')[1].split('\n```')[0]);
        expect(json.schema).toBe('coc.browser-demo/1');
        expect(json.steps).toHaveLength(5);
        expect(json.steps[2]).toMatchObject({ n: 3, tab: 'T2', kind: 'type', label: 'Email', valueOmitted: true, exampleValue: 'jane@example.com' });
        expect(json.steps[0].label).toBe('Billing \'x\'');
        expect(json.tabs[1]).toMatchObject({ ref: 'T2', openedBy: 'T1' });
    });

    it('flags example values that look like real secrets', () => {
        expect(looksLikeSecret(credentialExample)).toBe(true);
        expect(looksLikeSecret('4111 1111 1111 1111')).toBe(true);
        expect(looksLikeSecret('a1'.repeat(10))).toBe(true);
        expect(looksLikeSecret('a1'.repeat(9))).toBe(false);
        expect(looksLikeSecret('jane@example.com')).toBe(false);
        expect(looksLikeSecret('Order 42')).toBe(false);
        expect(buildBrowserDemoAttachment(snapshot(), { removed: [], notes: {}, examples: { 4: credentialExample }, message: '' }).secretSteps).toEqual([4]);
    });

    it.each(['ghp_', 'gho_', 'github_pat_', 'sk-', 'xoxb-', 'AKIA'])('rejects synthetic %s examples at the credential-prefix boundary', prefix => {
        expect(looksLikeSecret(prefix + 'x'.repeat(6))).toBe(true);
        expect(looksLikeSecret(prefix + 'x'.repeat(5))).toBe(false);
    });
});

describe('browser demo review', () => {
    it('loads the stopped action list through React Strict Mode effect replay', async () => {
        await runBrowserDemoCommand({ action: 'list' });
        render(<StrictMode><BrowserDemoReview demoId="demo-1" client={client()} onClose={vi.fn()} /></StrictMode>);
        expect(await screen.findAllByTestId('browser-demo-review-step')).toHaveLength(6);
        expect(sendMessage).not.toHaveBeenCalled();
    });
    it('edits stay local and survive closing and reopening the review; nothing is sent before Send', async () => {
        const { unmount } = await mount();
        fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }));
        fireEvent.change(screen.getByLabelText('Explanation for step 4'), { target: { value: 'use the work email' } });
        fireEvent.change(screen.getByLabelText('Example value for step 4'), { target: { value: 'jane@example.com' } });
        expect(screen.queryByLabelText('Example value for step 5')).toBeNull();
        unmount();
        await mount();
        expect(screen.getAllByTestId('browser-demo-review-step')[1].dataset.removed).toBe('true');
        expect((screen.getByLabelText('Explanation for step 4') as HTMLInputElement).value).toBe('use the work email');
        expect((screen.getByLabelText('Example value for step 4') as HTMLInputElement).value).toBe('jane@example.com');
        expect(sendMessage).not.toHaveBeenCalled();
        expect(commands().map(command => command.action)).not.toContain('sent');
    });

    it('blocks Send while every step is removed or an example looks like a secret', async () => {
        await mount();
        fireEvent.change(screen.getByLabelText('Example value for step 4'), { target: { value: credentialExample } });
        expect(screen.getByText('This looks like a real secret. Use a made-up example instead.')).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Send to chat…' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('Example value for step 4'), { target: { value: '' } });
        for (let index = 1; index <= 6; index++) fireEvent.click(screen.getByRole('button', { name: `Remove step ${index}` }));
        expect(screen.getByText('Every step is removed. Restore a step to send.')).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Send to chat…' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('previews the exact attachment and sends it to the owning chat on its server, then frees the draft', async () => {
        const { onClose } = await mount();
        fireEvent.change(screen.getByLabelText('Message to send with the demo'), { target: { value: 'Explain this flow' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send to chat…' }));
        const preview = screen.getByTestId('browser-demo-preview').textContent ?? '';
        expect(preview).toContain('# Browser demonstration');
        expect(sendMessage).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Send demo' }));
        await waitFor(() => expect(commands().map(command => command.action)).toContain('sent'));
        expect(sendMessage).toHaveBeenCalledTimes(1);
        const [processId, request, query] = sendMessage.mock.calls[0];
        expect(processId).toBe('chat-1');
        expect(query).toEqual({ workspace: 'ws-remote' });
        expect(request.browserDemo).toEqual({ inputAllowed: false });
        expect(request.content).toMatch(/^Explain this flow\n\nBrowser demo attached \(6 steps, 2 tabs\)/);
        expect(request.attachments).toHaveLength(1);
        expect(request.attachments[0].mimeType).toBe('text/markdown');
        const body = new TextDecoder().decode(Uint8Array.from(atob(request.attachments[0].dataUrl.split(',')[1]), c => c.charCodeAt(0)));
        expect(body).toBe(preview);
        expect(request.attachments[0].size).toBe(new TextEncoder().encode(body).length);
        expect(onClose).toHaveBeenCalled();
        expect(getBrowserDemoEdits('demo-1').message).toBe('');
        expect(listBrowserDemos()).toEqual([]);
    });

    it('keeps the draft and offers retry when Send fails', async () => {
        sendMessage.mockRejectedValueOnce(new Error('offline'));
        await mount();
        fireEvent.click(screen.getByRole('button', { name: 'Send to chat…' }));
        fireEvent.click(screen.getByRole('button', { name: 'Send demo' }));
        expect((await screen.findByTestId('browser-demo-review-error')).textContent).toContain('The demo is kept');
        expect(commands().map(command => command.action)).not.toContain('sent');
        fireEvent.click(screen.getByRole('button', { name: 'Retry send' }));
        await waitFor(() => expect(commands().map(command => command.action)).toContain('sent'));
    });

    it('discards after confirmation without contacting the server', async () => {
        const { onClose } = await mount();
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        fireEvent.click(screen.getByRole('button', { name: 'Discard demo' }));
        await waitFor(() => expect(commands()).toContainEqual({ action: 'discard', id: 'demo-1' }));
        expect(onClose).toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('closes when the demo resumes recording or ends elsewhere', async () => {
        const { onClose } = await mount();
        expect(onClose).not.toHaveBeenCalled();
        push(state({ status: 'recording' }));
        expect(onClose).toHaveBeenCalled();
    });
});

describe('browser demo store', () => {
    it('marks a demo stopped as soon as Stop answers, before main\'s state event', async () => {
        mock.command.mockImplementation(async (command: { action: string }) => {
            if (command.action === 'list') return { ok: true, drafts: [state({ status: 'recording' })] };
            if (command.action === 'stop') return { ok: true, draft: snapshot() };
            return { ok: true };
        });
        await runBrowserDemoCommand({ action: 'list' });
        await runBrowserDemoCommand({ action: 'stop', id: 'demo-1' });
        expect(listBrowserDemos()[0].status).toBe('stopped');
    });
});
