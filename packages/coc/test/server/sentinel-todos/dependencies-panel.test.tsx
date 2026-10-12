/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SentinelTodoDependencyEvaluation, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';

const { evaluate, save, bind, references, fakeClient } = vi.hoisted(() => {
    const evaluate = vi.fn();
    const save = vi.fn();
    const bind = vi.fn();
    return { evaluate, save, bind, references: [] as unknown[], fakeClient: { sentinelTodos: {
        evaluateDependencies: evaluate, setDependencies: save, bindPrOutput: bind,
    } } };
});
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (reference: unknown) => { references.push(reference); return fakeClient; },
}));
import { SentinelTodoDependencies } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoDependencies';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';

const owner = { ownerWorkspaceId: 'ws-owner', processId: 'queue_parent', ownerRoutingRef: 'remote:server-a:ws-owner' };
const onLedgerChange = vi.fn();
const onItemLink = vi.fn();
const onArtifactLink = vi.fn();
function item(id: string, extra: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    return { id, title: id, type: 'normal', priority: 'regular', status: 'todo', notes: '',
        completionCondition: 'Final delivery', revision: 1, archived: false, jobs: [],
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdBy: 'user', updatedBy: 'user', ...extra };
}
const source = item('Source');
const dependent = item('Dependent', { dependsOn: [{ itemId: source.id, condition: { kind: 'done' } }] });
function evaluation(current: SentinelTodoItem, state: 'ready' | 'waiting' = 'waiting'): SentinelTodoDependencyEvaluation {
    return { itemId: current.id, itemRevision: current.revision, ledgerRevision: 2, evaluatedAt: '2026-01-01T00:00:00Z',
        state, edges: (current.dependsOn ?? []).map(dependency => ({ dependency, satisfied: state === 'ready',
            ...(state === 'waiting' ? { blocker: 'Explicit Done required' } : {}) })) };
}
function props(current = dependent) {
    return { owner, item: current, items: [source, current], expanded: true, ledgerRevision: 2,
        onLedgerChange, onItemLink, onArtifactLink };
}
beforeEach(() => {
    applyRuntimeConfigPatch({ sentinelTodoDependenciesEnabled: true });
    evaluate.mockReset().mockResolvedValue(evaluation(dependent));
    save.mockReset().mockResolvedValue({});
    bind.mockReset().mockResolvedValue({});
    references.length = 0;
    onLedgerChange.mockReset(); onItemLink.mockReset(); onArtifactLink.mockReset();
});
afterEach(() => { cleanup(); applyRuntimeConfigPatch({ sentinelTodoDependenciesEnabled: false }); });

describe('owner-scoped dependency details', () => {
    it('is default-off and adds no tracking or launch actions when disabled', () => {
        applyRuntimeConfigPatch({ sentinelTodoDependenciesEnabled: false });
        const view = render(<SentinelTodoDependencies {...props()} />);
        expect(view.container.textContent).toBe('');
        expect(evaluate).not.toHaveBeenCalled();
    });

    it('shows an independent waiting chip, named chain navigation and explicit evidence blockers', async () => {
        render(<SentinelTodoDependencies {...props()} />);
        await screen.findByText('Waiting');
        expect(screen.getByText('Dependencies - ALL required')).toBeTruthy();
        expect(screen.getByRole('list', { name: 'Dependency chain' })).toBeTruthy();
        expect(screen.getByText('Explicit Done required')).toBeTruthy();
        fireEvent.click(screen.getAllByRole('button', { name: source.title })[0]);
        expect(onItemLink).toHaveBeenCalledWith(source.id);
        expect(references).toContain(owner.ownerRoutingRef);
        expect(evaluate).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, dependent.id, { signal: expect.any(AbortSignal) });
        expect(screen.queryByRole('button', { name: /launch|retry job|cancel job/i })).toBeNull();
    });

    it('shows Needs approval for satisfied normal dependencies, but manual readiness stays tracking-only', async () => {
        evaluate.mockResolvedValue(evaluation(dependent, 'ready'));
        const view = render(<SentinelTodoDependencies {...props()} />);
        await screen.findByText('Needs approval');
        const manual = { ...dependent, type: 'manual' as const };
        view.rerender(<SentinelTodoDependencies {...props(manual)} />);
        await screen.findByText('Ready');
        expect(screen.getByText('Tracking only')).toBeTruthy();
    });

    it('preserves graph drafts and the original revision after conflict until explicit rebasing', async () => {
        const current = item('Dependent');
        save.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409, code: 'conflict', body: { current: { ...current, revision: 4 } } }));
        const view = render(<SentinelTodoDependencies {...props(current)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit dependencies' }));
        fireEvent.change(screen.getByLabelText('Prerequisite'), { target: { value: source.id } });
        fireEvent.click(screen.getByRole('button', { name: 'Add prerequisite' }));
        fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'pr_merge' } });
        fireEvent.change(screen.getByLabelText('Future PR output slot'), { target: { value: 'feature-pr' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save dependencies' }));
        await screen.findByRole('alert');
        expect(save.mock.calls[0][3]).toEqual({ expectedRevision: 1,
            dependsOn: [{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'feature-pr' } }] });
        view.rerender(<SentinelTodoDependencies {...props({ ...current, revision: 4 })} ledgerRevision={5} />);
        expect((screen.getByLabelText('Future PR output slot') as HTMLInputElement).value).toBe('feature-pr');
        expect(save).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Use current revision and keep draft' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save dependencies' }));
        await waitFor(() => expect(onLedgerChange).toHaveBeenCalledTimes(1));
        expect(save.mock.calls[1][3].expectedRevision).toBe(4);
    });

    it('offers typed artifact selectors with exact versions and removes only on an explicit save', async () => {
        render(<SentinelTodoDependencies {...props()} />);
        await screen.findByText('Waiting');
        fireEvent.click(screen.getByRole('button', { name: 'Edit dependencies' }));
        fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'accepted_artifact' } });
        fireEvent.change(screen.getByLabelText('Artifact reference'), { target: { value: 'notes/design.md' } });
        expect((screen.getByRole('button', { name: 'Save dependencies' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('Artifact content version'), { target: { value: `sha256:${'a'.repeat(64)}` } });
        fireEvent.click(screen.getByRole('button', { name: 'Remove prerequisite' }));
        expect(save).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Save dependencies' }));
        await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        expect(save.mock.calls[0][3]).toEqual({ expectedRevision: 1, dependsOn: [] });
    });

    it('binds an exact future PR output visibly with source revision and explicit owner provenance', async () => {
        const current = item('Dependent', { dependsOn: [{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'feature' } }] });
        evaluate.mockResolvedValue(evaluation(current));
        render(<SentinelTodoDependencies {...props(current)} />);
        await screen.findByText('URL pending');
        fireEvent.click(screen.getByRole('button', { name: 'Bind PR output' }));
        fireEvent.change(screen.getByLabelText('Produced PR URL'), { target: { value: 'https://github.com/example/repository/pull/1' } });
        fireEvent.change(screen.getByLabelText('Output ownership evidence'), { target: { value: 'Selected the exact produced output' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save PR binding' }));
        await waitFor(() => expect(bind).toHaveBeenCalledTimes(1));
        expect(bind.mock.calls[0]).toEqual([owner.ownerWorkspaceId, owner.processId, source.id, {
            expectedRevision: source.revision, outputSlot: 'feature', prUrl: 'https://github.com/example/repository/pull/1',
            provenance: { kind: 'owner_selection', reason: 'Selected the exact produced output' },
        }]);
    });

    it('keeps unavailable evidence explicit and retries only the read', async () => {
        evaluate.mockRejectedValueOnce(new Error('Permission denied'));
        render(<SentinelTodoDependencies {...props()} />);
        await screen.findByText(/Evidence unavailable: Permission denied/);
        expect(screen.getByText('Waiting')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Retry evidence read' }));
        await screen.findByText('Explicit Done required');
        expect(save).not.toHaveBeenCalled();
        expect(bind).not.toHaveBeenCalled();
    });

    it('drops delayed reads and mutation callbacks after switching server ownership', async () => {
        let resolveRead!: (value: SentinelTodoDependencyEvaluation) => void;
        let resolveSave!: (value: object) => void;
        evaluate.mockImplementationOnce(() => new Promise<SentinelTodoDependencyEvaluation>(resolve => { resolveRead = resolve; }));
        save.mockImplementationOnce(() => new Promise<object>(resolve => { resolveSave = resolve; }));
        const view = render(<SentinelTodoDependencies {...props()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit dependencies' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save dependencies' }));
        await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        view.rerender(<SentinelTodoDependencies {...props()} owner={{ ...owner, ownerRoutingRef: 'remote:server-b:ws-owner' }} />);
        await screen.findByText('Waiting');
        await act(async () => { resolveRead(evaluation(dependent, 'ready')); resolveSave({}); });
        expect(screen.queryByText('Needs approval')).toBeNull();
        expect(screen.queryByRole('form', { name: 'Edit dependencies' })).toBeNull();
        expect(onLedgerChange).not.toHaveBeenCalled();
        expect(references).toContain('remote:server-b:ws-owner');
    });

    it('refreshes evidence when only a prerequisite revision changes', async () => {
        const view = render(<SentinelTodoDependencies {...props()} />);
        await screen.findByText('Waiting');
        evaluate.mockResolvedValue(evaluation(dependent, 'ready'));
        view.rerender(<SentinelTodoDependencies {...props()} items={[{ ...source, revision: 2, status: 'done' }, dependent]} ledgerRevision={3} />);
        await screen.findByText('Needs approval');
        expect(evaluate).toHaveBeenCalledTimes(2);
    });

    it('opens artifact evidence using an owner-bound callback, never an untrusted path as a URL', async () => {
        const current = item('Dependent', { dependsOn: [{ itemId: source.id, condition: {
            kind: 'accepted_artifact', phase: 'design', reference: 'notes/design.md', version: `sha256:${'a'.repeat(64)}`,
        } }] });
        const result = evaluation(current, 'ready');
        result.edges[0].evidenceLink = 'notes/design.md';
        evaluate.mockResolvedValue(result);
        render(<SentinelTodoDependencies {...props(current)} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Artifact evidence' }));
        expect(onArtifactLink).toHaveBeenCalledWith('notes/design.md');
        expect(screen.queryByRole('link', { name: 'Evidence' })).toBeNull();
    });

    it('routes artifact evidence to its prerequisite content workspace on the owning server', async () => {
        const current = item('Dependent', { dependsOn: [{ itemId: source.id, condition: {
            kind: 'accepted_artifact', phase: 'design', reference: 'notes/design.md', version: `sha256:${'a'.repeat(64)}`,
        } }] });
        const result = evaluation(current, 'ready');
        result.edges[0].evidenceLink = 'notes/design.md';
        result.edges[0].artifactWorkspaceId = 'ws-execution';
        evaluate.mockResolvedValue(result);
        render(<SentinelTodoDependencies {...props(current)} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Artifact evidence' }));
        expect(onArtifactLink).toHaveBeenCalledWith('notes/design.md', 'ws-execution');
        expect(references).toContain(owner.ownerRoutingRef);
    });

    it('shows previously bound PR identity, provenance and the authoritative evidence link', async () => {
        const current = item('Dependent', { dependsOn: [{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'feature' } }] });
        const pr = { provider: 'github' as const, host: 'github.com', repoPath: 'example/repository', number: 1, url: 'https://github.com/example/repository/pull/1' };
        const bound = { ...source, evidence: [{ kind: 'pr_binding' as const, receiptId: 'receipt', recordedRevision: 1,
            recordedAt: '2026-01-01T00:00:00Z', recordedBy: 'user' as const, outputSlot: 'feature', pr,
            provenance: { kind: 'owner_selection' as const, reason: 'Exact output selected' } }] };
        const result = evaluation(current, 'ready');
        result.edges[0].evidenceLink = pr.url;
        evaluate.mockResolvedValue(result);
        render(<SentinelTodoDependencies {...props(current)} items={[bound, current]} />);
        expect((await screen.findByRole('link', { name: 'Evidence' })).getAttribute('href')).toBe(pr.url);
        expect(screen.getByText('Bound by user: Exact output selected')).toBeTruthy();
        expect(screen.queryByText('URL pending')).toBeNull();
        expect(screen.getByRole('button', { name: 'Rebind PR output' })).toBeTruthy();
    });

    it('keeps captured action settings and authority separate from readiness and exposes review warnings', async () => {
        const current = { ...dependent, dependencyAction: {
            revision: 1, state: 'authorized' as const, mode: 'ask' as const, provider: 'claude' as const,
            model: 'captured-model', targetWorkspaceId: 'ws-execution', prompt: 'Design only', scope: 'Design only, no implementation',
            taskId: 'fixed-child', authorizedAt: '2026-01-01T00:00:00Z', authorizedBy: 'user' as const,
        } };
        evaluate.mockResolvedValue(evaluation(current, 'ready'));
        const view = render(<SentinelTodoDependencies {...props(current)} />);
        await screen.findByText('Ready');
        expect(screen.getByLabelText('Saved action configuration')).toBeTruthy();
        expect(screen.getByText('Ask')).toBeTruthy();
        expect(screen.getByText('claude')).toBeTruthy();
        expect(screen.getByText('captured-model')).toBeTruthy();
        expect(screen.getByText('ws-execution')).toBeTruthy();
        expect(screen.getByText('Design only, no implementation')).toBeTruthy();
        view.rerender(<SentinelTodoDependencies {...props({ ...current, dependencyAction: { ...current.dependencyAction, state: 'revoked', requiresReview: true } })} />);
        await screen.findByText('Needs approval');
        expect(screen.getByText('Revoked')).toBeTruthy();
        expect(screen.getByText(/Requires review - prerequisite evidence changed/)).toBeTruthy();
    });
});
