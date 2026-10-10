import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ProcessAutoCompactState } from '@plusplusoneplusplus/coc-client';
import { ComposerMetaStrip } from '../../../../src/server/spa/client/react/features/chat/ComposerMetaStrip';
import { ContextWindowIndicator } from '../../../../src/server/spa/client/react/ui/ContextWindowIndicator';
import {
    deriveAutoCompactStatus, describeAutoCompact, parseThresholdInput, useSentinelAutoCompact,
} from '../../../../src/server/spa/client/react/features/chat/AutoCompactPanel';

afterEach(cleanup);

function makeClient(overrides: Record<string, unknown> = {}) {
    return {
        processes: {
            updateAutoCompact: vi.fn(async (_id: string, settings: { enabled: boolean; thresholdPercent: number }) =>
                ({ autoCompact: { ...settings, consecutiveFailures: 0 } })),
            resumeAutoCompact: vi.fn(async () => ({ autoCompact: { enabled: true, thresholdPercent: 80, consecutiveFailures: 0 } })),
            ...overrides,
        },
    } as any;
}

function Harness({ client, isSentinel = true, initial, compaction, processId = 'queue_s', onCancel = vi.fn(async () => {}), renderer = 'composer' }: {
    client: any;
    isSentinel?: boolean;
    initial?: ProcessAutoCompactState;
    compaction?: { state: string; taskId?: string };
    processId?: string;
    onCancel?: () => Promise<void>;
    renderer?: 'composer' | 'indicator';
}) {
    const [state, setState] = useState(initial);
    const autoCompact = useSentinelAutoCompact({
        isSentinel, processId, workspaceId: 'ws-remote', client,
        metadata: { autoCompact: state, compaction }, usedTokens: 720_000, tokenLimit: 922_000,
        onState: setState, onCancelQueued: onCancel,
    });
    return renderer === 'composer'
        ? <ComposerMetaStrip sessionTokenLimit={922_000} sessionCurrentTokens={720_000} sessionModel="claude-opus-4.8"
            sessionSystemTokens={10_000} sessionToolTokens={20_000} sessionConversationTokens={600_000} autoCompact={autoCompact} />
        : <ContextWindowIndicator tokenLimit={922_000} currentTokens={720_000} autoCompact={autoCompact} />;
}

const openPopover = () => fireEvent.click(screen.getByRole('button', { name: /Context window/ }));

describe('auto-compact helpers', () => {
    it('validates thresholds and derives pill status from the owning compaction', () => {
        expect(parseThresholdInput('85')).toBe(85);
        for (const value of ['45', '100', '83', '', 'abc', '80.5']) expect(parseThresholdInput(value)).toBeUndefined();
        const state = { enabled: true, thresholdPercent: 80, taskId: 't1' };
        expect(deriveAutoCompactStatus(undefined, undefined)).toBe('off');
        expect(deriveAutoCompactStatus(state, { state: 'queued', taskId: 't1' })).toBe('queued');
        expect(deriveAutoCompactStatus(state, { state: 'running', taskId: 't1' })).toBe('running');
        // A manual compaction is not reported as automatic.
        expect(deriveAutoCompactStatus(state, { state: 'running', taskId: 'manual' })).toBe('enabled');
        expect(deriveAutoCompactStatus({ ...state, paused: { reason: 'failures', at: '' } }, undefined)).toBe('paused');
    });

    it('describes each runtime outcome', () => {
        const base = { enabled: true, thresholdPercent: 80 };
        expect(describeAutoCompact(base, 'running', 50)).toMatch(/can’t be cancelled.*Codex stops after 120s.*no time limit/);
        expect(describeAutoCompact({ ...base, lastResult: { outcome: 'succeeded', at: '', tokensBefore: 900_000, tokensAfter: 300_000 } }, 'enabled', 30))
            .toBe('Last auto-compact succeeded — freed ~600.0k tokens.');
        expect(describeAutoCompact({ ...base, lastResult: { outcome: 'insufficient', at: '' } }, 'enabled', 85)).toMatch(/freed too little/);
        expect(describeAutoCompact({ ...base, lastResult: { outcome: 'failed', at: '', error: 'boom' } }, 'enabled', 85)).toMatch(/failed: boom/);
        expect(describeAutoCompact({ ...base, paused: { reason: 'unsupported', at: '' } }, 'paused', 85)).toMatch(/doesn’t support compaction/);
        expect(describeAutoCompact({ ...base, paused: { reason: 'failures', at: '' } }, 'paused', 85)).toMatch(/Paused after 2 unsuccessful attempts/);
        expect(describeAutoCompact(base, 'enabled', undefined)).toMatch(/isn’t reported yet/);
    });
});

describe('Sentinel auto-compact popover section', () => {
    it('renders nothing new for non-Sentinel chats', () => {
        render(<Harness client={makeClient()} isSentinel={false} />);
        openPopover();
        expect(screen.getByTestId('composer-ctx-breakdown-popover').textContent).toContain('System prompt');
        expect(screen.queryByTestId('auto-compact-panel')).toBeNull();
        expect(screen.queryByTestId('composer-ctx-threshold-marker')).toBeNull();
    });

    it('defaults off, keeps the breakdown and model footer, and saves a dirty draft through the owning workspace', async () => {
        const client = makeClient();
        render(<Harness client={client} />);
        openPopover();
        const popover = screen.getByRole('dialog', { name: 'Context usage' });
        expect(popover.textContent).toContain('Conversation');
        expect(screen.getByTestId('composer-ctx-model-name').textContent).toBe('claude-opus-4.8');
        const toggle = screen.getByRole('switch', { name: /Auto-compact · this Sentinel chat/ });
        expect(toggle.getAttribute('aria-checked')).toBe('false');
        expect(screen.queryByTestId('auto-compact-save')).toBeNull();
        expect(screen.getByTestId('auto-compact-token-equivalent').textContent).toContain('≈ 737.6k of 922.0k tokens');

        fireEvent.click(toggle);
        fireEvent.change(screen.getByTestId('auto-compact-slider'), { target: { value: '85' } });
        expect((screen.getByTestId('auto-compact-input') as HTMLInputElement).value).toBe('85');
        expect(screen.getByTestId('auto-compact-token-equivalent').textContent).toContain('783.7k');
        fireEvent.click(screen.getByTestId('auto-compact-save'));
        await waitFor(() => expect(screen.getByTestId('auto-compact-save-status').textContent).toMatch(/Saved/));
        expect(client.processes.updateAutoCompact).toHaveBeenCalledWith('queue_s', { enabled: true, thresholdPercent: 85 }, { workspace: 'ws-remote' });
        expect(screen.queryByTestId('auto-compact-save')).toBeNull();
        expect(screen.getByTestId('composer-ctx-threshold-marker').style.left).toBe('85%');
        expect(screen.getByTestId('composer-ctx-autocompact-badge').getAttribute('data-state')).toBe('enabled');
        expect(screen.getByTestId('composer-ctx-fuel').getAttribute('aria-label')).toContain('auto-compact on at 85%');
    });

    it('flags invalid input, discards drafts, and keeps a draft across popover close', () => {
        render(<Harness client={makeClient()} initial={{ enabled: true, thresholdPercent: 80 }} />);
        openPopover();
        const input = screen.getByTestId('auto-compact-input');
        fireEvent.change(input, { target: { value: '83' } });
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByTestId('auto-compact-save-status').textContent).toBe('Use 50–95% in steps of 5.');
        expect((screen.getByTestId('auto-compact-save') as HTMLButtonElement).disabled).toBe(true);

        fireEvent.change(input, { target: { value: '90' } });
        openPopover(); // close
        expect(screen.queryByTestId('auto-compact-panel')).toBeNull();
        openPopover();
        expect((screen.getByTestId('auto-compact-input') as HTMLInputElement).value).toBe('90');
        fireEvent.click(screen.getByTestId('auto-compact-discard'));
        expect((screen.getByTestId('auto-compact-input') as HTMLInputElement).value).toBe('80');
    });

    it('reports a settings save failure distinctly and keeps the draft', async () => {
        const client = makeClient({ updateAutoCompact: vi.fn().mockRejectedValue(new Error('Auto-compact is available only for Sentinel chats.')) });
        render(<Harness client={client} />);
        openPopover();
        fireEvent.click(screen.getByRole('switch'));
        fireEvent.keyDown(screen.getByTestId('auto-compact-input'), { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('auto-compact-save-status').textContent)
            .toMatch(/^Couldn’t save the setting: /));
        expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('auto-compact-save')).toBeTruthy();
    });

    it('offers Cancel while the automatic compaction is queued and explains a running one', async () => {
        const onCancel = vi.fn(async () => {});
        const state = { enabled: true, thresholdPercent: 80, taskId: 'auto-1' };
        const { rerender } = render(<Harness client={makeClient()} initial={state} compaction={{ state: 'queued', taskId: 'auto-1' }} onCancel={onCancel} />);
        expect(screen.getByTestId('composer-ctx-autocompact-badge').getAttribute('data-state')).toBe('queued');
        openPopover();
        fireEvent.click(screen.getByTestId('auto-compact-cancel'));
        await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
        rerender(<Harness client={makeClient()} initial={state} compaction={{ state: 'running', taskId: 'auto-1' }} onCancel={onCancel} />);
        expect(screen.getByTestId('auto-compact-runtime').textContent).toMatch(/can’t be cancelled/);
        expect(screen.queryByTestId('auto-compact-cancel')).toBeNull();
    });

    it('resumes a paused state', async () => {
        const client = makeClient();
        render(<Harness client={client} initial={{ enabled: true, thresholdPercent: 80, consecutiveFailures: 2, paused: { reason: 'failures', at: '' },
            lastResult: { outcome: 'failed', at: '', error: 'boom' } }} />);
        expect(screen.getByTestId('composer-ctx-autocompact-badge').getAttribute('data-state')).toBe('paused');
        openPopover();
        expect(screen.getByTestId('auto-compact-runtime').getAttribute('role')).toBe('status');
        fireEvent.click(screen.getByTestId('auto-compact-resume'));
        await waitFor(() => expect(screen.queryByTestId('auto-compact-resume')).toBeNull());
        expect(client.processes.resumeAutoCompact).toHaveBeenCalledWith('queue_s', { workspace: 'ws-remote' });
    });

    it('supports keyboard open/close with focus return', () => {
        render(<Harness client={makeClient()} />);
        const trigger = screen.getByRole('button', { name: /Context window/ });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        trigger.focus();
        fireEvent.click(trigger); // Enter/Space on a native button dispatches click
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        act(() => screen.getByRole('switch').focus());
        fireEvent.keyDown(screen.getByRole('switch'), { key: 'Escape' });
        expect(screen.queryByTestId('auto-compact-panel')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('resets the draft when switching conversations', () => {
        const client = makeClient();
        const { rerender } = render(<Harness client={client} processId="queue_a" />);
        openPopover();
        fireEvent.click(screen.getByRole('switch'));
        expect(screen.getByTestId('auto-compact-save')).toBeTruthy();
        rerender(<Harness client={client} processId="queue_b" />);
        expect(screen.queryByTestId('auto-compact-save')).toBeNull();
        expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    });

    it('renders the same section in ContextWindowIndicator', () => {
        render(<Harness client={makeClient()} renderer="indicator" initial={{ enabled: true, thresholdPercent: 90 }} />);
        expect(screen.getByTestId('ctx-threshold-marker').style.left).toBe('90%');
        openPopover();
        expect(screen.getByTestId('ctx-breakdown-popover').getAttribute('role')).toBe('dialog');
        expect(screen.getByTestId('auto-compact-panel')).toBeTruthy();
    });
});
