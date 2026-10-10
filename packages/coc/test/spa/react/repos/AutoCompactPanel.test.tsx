import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { CocClient, type ProcessAutoCompactState } from '@plusplusoneplusplus/coc-client';
import { ComposerMetaStrip } from '../../../../src/server/spa/client/react/features/chat/ComposerMetaStrip';
import { ContextWindowIndicator } from '../../../../src/server/spa/client/react/ui/ContextWindowIndicator';
import { deriveAutoCompactStatus, describeAutoCompact, parseThresholdInput, useSentinelAutoCompact } from '../../../../src/server/spa/client/react/features/chat/AutoCompactPanel';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function makeClient() {
    const client = new CocClient({ baseUrl: 'https://owner.example.test' });
    vi.spyOn(client.processes, 'updateAutoCompact').mockImplementation(async (_id, settings) =>
        ({ autoCompact: { ...settings, consecutiveFailures: 0 } }));
    vi.spyOn(client.processes, 'resumeAutoCompact').mockResolvedValue({ autoCompact: { enabled: true, thresholdTokens: 700_000, consecutiveFailures: 0 } });
    return client;
}

function deferred() {
    let resolve!: (value: { autoCompact: ProcessAutoCompactState }) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<{ autoCompact: ProcessAutoCompactState }>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function Harness({ client, isSentinel = true, initial, compaction, processId = 'queue_s', workspaceId = 'ws-remote',
    tokenLimit = 922_000, onCancel = vi.fn(async () => {}), renderer = 'composer', onState }: {
    client: CocClient;
    isSentinel?: boolean;
    initial?: ProcessAutoCompactState;
    compaction?: { state: string; taskId?: string };
    processId?: string;
    workspaceId?: string;
    tokenLimit?: number;
    onCancel?: () => Promise<void>;
    onState?: (state: ProcessAutoCompactState) => void;
    renderer?: 'composer' | 'indicator';
}) {
    const [state, setState] = useState(initial);
    const autoCompact = useSentinelAutoCompact({
        isSentinel, processId, workspaceId, client, metadata: { autoCompact: state, compaction },
        usedTokens: 720_000, tokenLimit,
        onState: value => { setState(value); onState?.(value); }, onCancelQueued: onCancel,
    });
    return renderer === 'composer'
        ? <ComposerMetaStrip sessionTokenLimit={tokenLimit} sessionCurrentTokens={720_000} sessionModel="claude-opus-4.8"
            sessionSystemTokens={10_000} sessionToolTokens={20_000} sessionConversationTokens={600_000} autoCompact={autoCompact} />
        : <ContextWindowIndicator tokenLimit={tokenLimit} currentTokens={720_000} modelName="claude-opus-4.8" autoCompact={autoCompact} />;
}

const openPopover = () => fireEvent.click(screen.getByRole('button', { name: /Context window/ }));
const input = () => screen.getByTestId('auto-compact-input') as HTMLInputElement;
const status = () => screen.getByTestId('auto-compact-status');
const enabled = { enabled: true, thresholdTokens: 700_000 };

describe('auto-compact helpers', () => {
    it('converts positive k values exactly to safe integer tokens', () => {
        expect(parseThresholdInput('850')).toBe(850_000);
        expect(parseThresholdInput(' 0.001 ')).toBe(1);
        expect(parseThresholdInput('700.125')).toBe(700_125);
        expect(parseThresholdInput('9007199254740.991')).toBe(Number.MAX_SAFE_INTEGER);
        for (const value of ['0', '-1', 'Infinity', 'NaN', '', 'abc', '0.0001', '9007199254740.992', '1e3'])
            expect(parseThresholdInput(value)).toBeUndefined();
    });

    it('derives pill status only from the owning automatic compaction', () => {
        const state = { ...enabled, taskId: 't1' };
        expect(deriveAutoCompactStatus(undefined, undefined)).toBe('off');
        expect(deriveAutoCompactStatus(state, { state: 'queued', taskId: 't1' })).toBe('queued');
        expect(deriveAutoCompactStatus(state, { state: 'running', taskId: 't1' })).toBe('running');
        expect(deriveAutoCompactStatus(state, { state: 'running', taskId: 'manual' })).toBe('enabled');
        expect(deriveAutoCompactStatus({ ...state, paused: { reason: 'failures', at: '' } }, undefined)).toBe('paused');
    });

    it('describes all runtime outcomes and actual provider deadlines', () => {
        expect(describeAutoCompact(enabled, 'running', 500_000)).toBe('Compacting in the background...');
        expect(describeAutoCompact({ ...enabled, lastResult: { outcome: 'succeeded', at: '', tokensBefore: 900_000, tokensAfter: 300_000 } }, 'enabled', 300_000))
            .toBe('Auto-compacted · freed ~600.0k tokens.');
        expect(describeAutoCompact({ ...enabled, lastResult: { outcome: 'insufficient', at: '' } }, 'enabled', 850_000)).toMatch(/Freed too little/);
        expect(describeAutoCompact({ ...enabled, lastResult: { outcome: 'failed', at: '', error: 'boom' } }, 'enabled', 850_000)).toMatch(/Failed: boom/);
        expect(describeAutoCompact({ ...enabled, lastResult: { outcome: 'cancelled', at: '' } }, 'enabled', 850_000)).toMatch(/cancelled/);
        expect(describeAutoCompact({ ...enabled, paused: { reason: 'unsupported', at: '' } }, 'paused', 850_000)).toMatch(/does not support/);
        expect(describeAutoCompact({ ...enabled, paused: { reason: 'failures', at: '' } }, 'paused', 850_000)).toMatch(/Paused after 2/);
        expect(describeAutoCompact(enabled, 'enabled', undefined)).toMatch(/Usage not reported/);
    });
});

describe('approved Sentinel auto-compact popover', () => {
    it('renders no new controls for non-Sentinel chats', () => {
        render(<Harness client={makeClient()} isSentinel={false} />);
        openPopover();
        expect(screen.getByTestId('composer-ctx-breakdown-popover').textContent).toContain('System prompt');
        expect(screen.queryByTestId('auto-compact-panel')).toBeNull();
        expect(screen.queryByTestId('composer-ctx-threshold-marker')).toBeNull();
    });

    it('defaults OFF with the 700k mock default, one row/status and actual breakdown/footer', async () => {
        const client = makeClient();
        render(<Harness client={client} />);
        openPopover();
        expect(screen.getByRole('dialog').textContent).toContain('Conversation');
        expect(screen.getByTestId('composer-ctx-model-name').textContent).toBe('claude-opus-4.8');
        expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
        expect(input().value).toBe('700');
        expect(input().disabled).toBe(true);
        expect(screen.queryByRole('slider')).toBeNull();
        expect(screen.queryByRole('button', { name: /Save|Discard/ })).toBeNull();
        expect(screen.getByTestId('auto-compact-panel').querySelectorAll('[role="status"]')).toHaveLength(1);
        expect(client.processes.updateAutoCompact).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('switch'));
        await waitFor(() => expect(status().textContent).toMatch(/Saved/));
        expect(client.processes.updateAutoCompact).toHaveBeenCalledWith('queue_s', enabled, { workspace: 'ws-remote' });
        expect(screen.getByTestId('composer-ctx-fuel').getAttribute('aria-label')).toContain('at 700k tokens');
    });

    it.each(['composer', 'indicator'] as const)('auto-saves absolute tokens on Enter+blur once in %s', async renderer => {
        const client = makeClient();
        const pending = deferred();
        vi.mocked(client.processes.updateAutoCompact).mockReturnValueOnce(pending.promise);
        render(<Harness client={client} initial={enabled} renderer={renderer} />);
        openPopover();
        fireEvent.change(input(), { target: { value: '850.125' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        fireEvent.blur(input());
        expect(client.processes.updateAutoCompact).toHaveBeenCalledOnce();
        expect(client.processes.updateAutoCompact).toHaveBeenCalledWith('queue_s', { enabled: true, thresholdTokens: 850_125 }, { workspace: 'ws-remote' });
        await act(async () => pending.resolve({ autoCompact: { enabled: true, thresholdTokens: 850_125 } }));
        expect(client.processes.updateAutoCompact).toHaveBeenCalledOnce();
        expect(input().value).toBe('850.125');
        expect(status().textContent).toMatch(/Saved/);
        expect(screen.getByTestId(renderer === 'composer' ? 'composer-ctx-threshold-marker' : 'ctx-threshold-marker').style.left)
            .toBe(`${850_125 / 922_000 * 100}%`);
    });

    it('saves on blur alone and ignores an unchanged equivalent draft', async () => {
        const client = makeClient();
        render(<Harness client={client} initial={enabled} />);
        openPopover();
        fireEvent.change(input(), { target: { value: '700.000' } });
        fireEvent.blur(input());
        expect(client.processes.updateAutoCompact).not.toHaveBeenCalled();
        fireEvent.change(input(), { target: { value: '800' } });
        fireEvent.blur(input());
        await waitFor(() => expect(status().textContent).toMatch(/Saved/));
        expect(client.processes.updateAutoCompact).toHaveBeenCalledOnce();
    });

    it('round-trips the largest safe token threshold without floating-point loss', async () => {
        const client = makeClient();
        render(<Harness client={client} initial={{ ...enabled, thresholdTokens: Number.MAX_SAFE_INTEGER }} />);
        openPopover();
        expect(input().value).toBe('9007199254740.991');
        fireEvent.click(screen.getByRole('switch'));
        await waitFor(() => expect(client.processes.updateAutoCompact).toHaveBeenCalledWith('queue_s',
            { enabled: false, thresholdTokens: Number.MAX_SAFE_INTEGER }, { workspace: 'ws-remote' }));
    });

    it('retains invalid drafts across close, shows errors, and never writes invalid tokens', () => {
        const client = makeClient();
        render(<Harness client={client} initial={enabled} />);
        openPopover();
        fireEvent.change(input(), { target: { value: '0.0001' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        fireEvent.blur(input());
        expect(input().getAttribute('aria-invalid')).toBe('true');
        expect(status().textContent).toMatch(/positive k value/);
        openPopover();
        expect(screen.queryByTestId('auto-compact-panel')).toBeNull();
        openPopover();
        expect(input().value).toBe('0.0001');
        expect(client.processes.updateAutoCompact).not.toHaveBeenCalled();
    });

    it('retains a failed draft and retries only on a fresh commit', async () => {
        const client = makeClient();
        vi.mocked(client.processes.updateAutoCompact).mockRejectedValueOnce(new Error('storage unavailable'));
        render(<Harness client={client} initial={enabled} />);
        openPopover();
        fireEvent.change(input(), { target: { value: '850' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        fireEvent.blur(input());
        await waitFor(() => expect(status().textContent).toMatch(/Could not save/));
        expect(input().value).toBe('850');
        expect(client.processes.updateAutoCompact).toHaveBeenCalledOnce();
        fireEvent.blur(input());
        await waitFor(() => expect(status().textContent).toMatch(/Saved/));
        expect(client.processes.updateAutoCompact).toHaveBeenCalledTimes(2);
    });

    it('preserves newer edits during a save and serializes a requested subsequent commit', async () => {
        const client = makeClient();
        const pending = deferred();
        vi.mocked(client.processes.updateAutoCompact).mockReturnValueOnce(pending.promise);
        render(<Harness client={client} initial={enabled} />);
        openPopover();
        fireEvent.change(input(), { target: { value: '800' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        fireEvent.change(input(), { target: { value: '850' } });
        fireEvent.blur(input());
        expect(client.processes.updateAutoCompact).toHaveBeenCalledOnce();
        await act(async () => pending.resolve({ autoCompact: { enabled: true, thresholdTokens: 800_000 } }));
        await waitFor(() => expect(status().textContent).toMatch(/Saved/));
        expect(client.processes.updateAutoCompact).toHaveBeenNthCalledWith(2, 'queue_s', { enabled: true, thresholdTokens: 850_000 }, { workspace: 'ws-remote' });
        expect(input().value).toBe('850');
    });

    it('attempts a newer committed draft after an earlier save fails, without retrying the failed value', async () => {
        const client = makeClient();
        const pending = deferred();
        vi.mocked(client.processes.updateAutoCompact).mockReturnValueOnce(pending.promise);
        render(<Harness client={client} initial={enabled} />);
        openPopover();
        fireEvent.change(input(), { target: { value: '800' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        fireEvent.change(input(), { target: { value: '850' } });
        fireEvent.blur(input());
        await act(async () => pending.reject(new Error('first save failed')));
        await waitFor(() => expect(status().textContent).toMatch(/Saved/));
        expect(client.processes.updateAutoCompact).toHaveBeenCalledTimes(2);
        expect(client.processes.updateAutoCompact).toHaveBeenNthCalledWith(2, 'queue_s',
            { enabled: true, thresholdTokens: 850_000 }, { workspace: 'ws-remote' });
        expect(input().value).toBe('850');
    });

    it('does not save a newer draft until Enter/blur even if an earlier save completes', async () => {
        const client = makeClient();
        const pending = deferred();
        vi.mocked(client.processes.updateAutoCompact).mockReturnValueOnce(pending.promise);
        render(<Harness client={client} initial={enabled} />);
        openPopover();
        fireEvent.change(input(), { target: { value: '800' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        fireEvent.change(input(), { target: { value: '850' } });
        await act(async () => pending.resolve({ autoCompact: { enabled: true, thresholdTokens: 800_000 } }));
        expect(input().value).toBe('850');
        expect(status().textContent).toMatch(/Unsaved/);
        expect(client.processes.updateAutoCompact).toHaveBeenCalledOnce();
    });

    it('can turn OFF even with an invalid draft', async () => {
        const client = makeClient();
        render(<Harness client={client} initial={enabled} />);
        openPopover();
        fireEvent.change(input(), { target: { value: '' } });
        fireEvent.click(screen.getByRole('switch'));
        await waitFor(() => expect(client.processes.updateAutoCompact).toHaveBeenCalledWith('queue_s', { enabled: false, thresholdTokens: 700_000 }, { workspace: 'ws-remote' }));
        expect(input().value).toBe('');
        expect(input().disabled).toBe(true);
    });

    it.each(['composer', 'indicator'] as const)('keeps absolute thresholds across model limit changes and unknown limits in %s', renderer => {
        const client = makeClient();
        const { rerender } = render(<Harness client={client} initial={enabled} renderer={renderer} />);
        openPopover();
        const markerId = renderer === 'composer' ? 'composer-ctx-threshold-marker' : 'ctx-threshold-marker';
        expect(screen.getByTestId(markerId).style.left).toBe(`${700_000 / 922_000 * 100}%`);
        rerender(<Harness client={client} initial={enabled} renderer={renderer} tokenLimit={700_000} />);
        expect(status().textContent).toMatch(/meets\/exceeds/);
        expect(screen.queryByTestId(markerId)).toBeNull();
        rerender(<Harness client={client} initial={enabled} renderer={renderer} tokenLimit={600_000} />);
        expect(input().value).toBe('700');
        expect(status().textContent).toMatch(/meets\/exceeds.*may not fire/);
        expect(screen.queryByTestId(markerId)).toBeNull();
        rerender(<Harness client={client} initial={enabled} renderer={renderer} tokenLimit={0} />);
        expect(input().value).toBe('700');
        expect(status().textContent).toMatch(/limit unknown/);
        expect(screen.getByRole('dialog').textContent).toContain('unknown');
        expect(client.processes.updateAutoCompact).not.toHaveBeenCalled();
    });

    it('offers queued Cancel, running deadline information, and reports action errors', async () => {
        const client = makeClient();
        const onCancel = vi.fn().mockRejectedValue(new Error('already running'));
        const state = { ...enabled, taskId: 'auto-1' };
        const { rerender } = render(<Harness client={client} initial={state} compaction={{ state: 'queued', taskId: 'auto-1' }} onCancel={onCancel} />);
        openPopover();
        fireEvent.click(screen.getByTestId('auto-compact-cancel'));
        await waitFor(() => expect(status().textContent).toMatch(/Could not cancel/));
        expect(onCancel).toHaveBeenCalledOnce();
        rerender(<Harness client={client} initial={state} compaction={{ state: 'running', taskId: 'auto-1' }} />);
        expect(screen.queryByTestId('auto-compact-cancel')).toBeNull();
        expect(status().querySelector('span')?.title).toMatch(/Codex: 120s.*no overall deadline.*queued-only/);
    });

    it('resumes a paused state through its owner without changing threshold', async () => {
        const client = makeClient();
        render(<Harness client={client} initial={{ ...enabled, consecutiveFailures: 2, paused: { reason: 'failures', at: '' }, lastResult: { outcome: 'failed', at: '', error: 'boom' } }} />);
        openPopover();
        expect(status().textContent).toMatch(/Paused after 2/);
        fireEvent.click(screen.getByTestId('auto-compact-resume'));
        await waitFor(() => expect(screen.queryByTestId('auto-compact-resume')).toBeNull());
        expect(client.processes.resumeAutoCompact).toHaveBeenCalledWith('queue_s', { workspace: 'ws-remote' });
        expect(input().value).toBe('700');
    });

    it('serializes committed settings behind Resume so late action state cannot replace newer tokens', async () => {
        const client = makeClient();
        const pending = deferred();
        vi.mocked(client.processes.resumeAutoCompact).mockReturnValueOnce(pending.promise);
        render(<Harness client={client} initial={{ ...enabled, paused: { reason: 'failures', at: '' } }} />);
        openPopover();
        fireEvent.click(screen.getByTestId('auto-compact-resume'));
        fireEvent.change(input(), { target: { value: '850' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        expect(client.processes.updateAutoCompact).not.toHaveBeenCalled();
        await act(async () => pending.resolve({ autoCompact: enabled }));
        await waitFor(() => expect(client.processes.updateAutoCompact).toHaveBeenCalledOnce());
        expect(input().value).toBe('850');
        expect(screen.getByTestId('composer-ctx-fuel').getAttribute('aria-label')).toContain('850k tokens');
    });

    it('supports keyboard close and focus return', () => {
        render(<Harness client={makeClient()} />);
        const trigger = screen.getByRole('button', { name: /Context window/ });
        trigger.focus();
        fireEvent.click(trigger);
        act(() => screen.getByRole('switch').focus());
        fireEvent.keyDown(screen.getByRole('switch'), { key: 'Escape' });
        expect(screen.queryByTestId('auto-compact-panel')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it.each(['process', 'workspace', 'client'] as const)('rejects late saves and resets drafts when the exact %s owner changes', async scope => {
        const client = makeClient();
        const pending = deferred();
        const onState = vi.fn();
        vi.mocked(client.processes.updateAutoCompact).mockReturnValueOnce(pending.promise);
        const props = { client, processId: 'queue_a', workspaceId: 'ws-a', onState, initial: enabled };
        const { rerender } = render(<Harness {...props} />);
        openPopover();
        fireEvent.change(input(), { target: { value: '850' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        rerender(<Harness {...props} {...(scope === 'process' ? { processId: 'queue_b' } : scope === 'workspace' ? { workspaceId: 'ws-b' } : { client: makeClient() })} />);
        expect(input().value).toBe('700');
        await act(async () => pending.resolve({ autoCompact: { enabled: true, thresholdTokens: 850_000 } }));
        expect(onState).not.toHaveBeenCalled();
        expect(input().value).toBe('700');
        expect(status().textContent).not.toMatch(/Saved/);
    });

    it('ignores a late resume after owner change and save after unmount', async () => {
        const client = makeClient();
        const pending = deferred();
        const onState = vi.fn();
        vi.mocked(client.processes.resumeAutoCompact).mockReturnValueOnce(pending.promise);
        const { rerender, unmount } = render(<Harness client={client} initial={{ ...enabled, paused: { reason: 'failures', at: '' } }} onState={onState} />);
        openPopover();
        fireEvent.click(screen.getByTestId('auto-compact-resume'));
        rerender(<Harness client={client} processId="queue_other" onState={onState} />);
        await act(async () => pending.resolve({ autoCompact: enabled }));
        expect(onState).not.toHaveBeenCalled();
        const save = deferred();
        vi.mocked(client.processes.updateAutoCompact).mockReturnValueOnce(save.promise);
        fireEvent.change(input(), { target: { value: '850' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        unmount();
        await act(async () => save.resolve({ autoCompact: { ...enabled, thresholdTokens: 850_000 } }));
        expect(onState).not.toHaveBeenCalled();
    });

    it.each([
        '{"enabled":true,"thresholdPercent":80}',
        '{"enabled":true,"thresholdPercent":80,"thresholdTokens":700000}',
        '{"enabled":true,"thresholdTokens":0}',
    ])('shows malformed persisted state explicitly and never auto-enables it: %s', json => {
        const client = makeClient();
        const legacy = JSON.parse(json);
        render(<Harness client={client} initial={legacy} />);
        openPopover();
        expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
        expect(status().textContent).toMatch(/Stored threshold is invalid/);
        expect(client.processes.updateAutoCompact).not.toHaveBeenCalled();
    });

    it('returns controls even when usage and context limit are unknown', () => {
        const client = makeClient();
        const { result } = renderHook(() => useSentinelAutoCompact({
            isSentinel: true, processId: 'queue_s', workspaceId: 'ws-remote', client,
            metadata: undefined, usedTokens: undefined, tokenLimit: undefined, onState: vi.fn(), onCancelQueued: vi.fn(),
        }));
        expect(result.current?.status).toBe('off');
        expect(result.current?.thresholdTokens).toBe(700_000);
    });
});
