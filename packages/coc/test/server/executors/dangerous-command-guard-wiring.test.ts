/**
 * Host side of the dangerous-command guard (AC-04 / AC-05 / AC-06):
 * the approval payload that goes out on the `ask-user` channel, approve-once
 * vs approve-for-session, and the non-interactive immediate deny.
 */
import { describe, it, expect, vi } from 'vitest';
import { screenDangerousCommand } from '@plusplusoneplusplus/coc-agent-sdk';
import type { DangerousCommandMatcher } from '@plusplusoneplusplus/coc-agent-sdk';
import { buildAskUserAddon } from '../../../src/server/executors/prompt-builder';
import {
    buildDangerousCommandGuardWiring,
    type DangerousCommandDecisionRecord,
} from '../../../src/server/executors/dangerous-command-guard-wiring';
import { DangerousCommandSessionApprovals } from '../../../src/server/executors/dangerous-command-session-approvals';
import type { AskUserSSEPayload, AskUserToolDeps } from '../../../src/server/llm-tools/ask-user-tool';

/** Stand-in for the Rust matcher: fires on anything containing `rm -rf /`. */
const matcher: DangerousCommandMatcher = (command) =>
    command.includes('rm -rf /')
        ? {
            matched: true,
            ruleId: 'rm-recursive-dangerous-target',
            description: 'Recursive delete of a root or home path',
            matchedSegment: 'rm -rf /tmp/demo',
        }
        : { matched: false };

/**
 * One turn's ask-user channel, plus the handles the wiring reaches through.
 * `emitted` is what a connected SPA would receive on the `ask-user` SSE event.
 */
function makeTurn(opts: { askUserEnabled?: boolean; isInteractive?: () => boolean } = {}) {
    const emitted: AskUserSSEPayload[] = [];
    const deps: AskUserToolDeps = {
        emitQuestions: (payloads) => { emitted.push(...payloads); },
        computeTurnIndex: () => 3,
        ...(opts.isInteractive ? { isInteractive: opts.isInteractive } : {}),
    };
    const addon = buildAskUserAddon(opts.askUserEnabled ?? true, deps);
    return { emitted, addon };
}

function screen(guard: ReturnType<typeof buildDangerousCommandGuardWiring>, command = 'rm -rf /tmp/demo') {
    return screenDangerousCommand('Bash', { command }, guard, { matcher });
}

describe('buildDangerousCommandGuardWiring', () => {
    it('is inert when the admin flag is off', async () => {
        const { emitted, addon } = makeTurn();
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: false,
            isInteractive: () => true,
            getAskApproval: () => addon.askApproval,
        });

        expect(guard).toEqual({ enabled: false });
        // The SDK short-circuits on a disabled guard, so nothing is screened
        // and nothing is asked.
        await expect(screen(guard)).resolves.toEqual({ allowed: true });
        expect(emitted).toEqual([]);
    });

    it('emits the approval payload on the ask-user channel with the full command and the rule', async () => {
        const { emitted, addon } = makeTurn();
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: true,
            isInteractive: () => true,
            getAskApproval: () => addon.askApproval,
        });

        const pending = screen(guard, 'ls && rm -rf /tmp/demo');
        await vi.waitFor(() => expect(emitted).toHaveLength(1));

        const payload = emitted[0];
        expect(payload.approval).toEqual({
            kind: 'dangerous-command',
            command: 'ls && rm -rf /tmp/demo',
            ruleId: 'rm-recursive-dangerous-target',
            description: 'Recursive delete of a root or home path',
            matchedSegment: 'rm -rf /tmp/demo',
        });
        // Full command text, not a rule name only.
        expect(payload.question).toContain('ls && rm -rf /tmp/demo');
        expect(payload.type).toBe('select');
        expect(payload.options?.map(o => o.value)).toEqual(['approve-once', 'approve-session', 'deny']);
        expect(payload.defaultValue).toBe('deny');
        expect(payload.turnIndex).toBe(3);
        expect(payload.batchSize).toBe(1);

        addon.answerQuestion(payload.questionId, 'approve-once');
        await expect(pending).resolves.toMatchObject({ allowed: true, decision: 'approve-once' });
    });

    it('prompts again after approve-once', async () => {
        const { emitted, addon } = makeTurn();
        const approvals = new DangerousCommandSessionApprovals();
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: true,
            isInteractive: () => true,
            getAskApproval: () => addon.askApproval,
            approvals,
        });

        const first = screen(guard);
        await vi.waitFor(() => expect(emitted).toHaveLength(1));
        addon.answerQuestion(emitted[0].questionId, 'approve-once');
        await expect(first).resolves.toMatchObject({ allowed: true });
        expect(approvals.list('p1')).toEqual([]);

        const second = screen(guard);
        await vi.waitFor(() => expect(emitted).toHaveLength(2));
        addon.answerQuestion(emitted[1].questionId, 'deny');
        await expect(second).resolves.toMatchObject({ allowed: false, decision: 'deny' });
    });

    it('short-circuits later matches of the same rule after approve-for-session', async () => {
        const { emitted, addon } = makeTurn();
        const approvals = new DangerousCommandSessionApprovals();
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: true,
            isInteractive: () => true,
            getAskApproval: () => addon.askApproval,
            approvals,
        });

        const first = screen(guard);
        await vi.waitFor(() => expect(emitted).toHaveLength(1));
        addon.answerQuestion(emitted[0].questionId, 'approve-session');
        await expect(first).resolves.toMatchObject({ allowed: true, decision: 'approve-session' });
        expect(approvals.list('p1')).toEqual(['rm-recursive-dangerous-target']);

        // Second matching command: allowed with no second prompt.
        await expect(screen(guard, 'rm -rf /tmp/other')).resolves.toMatchObject({
            allowed: true,
            decision: 'approve-session',
        });
        expect(emitted).toHaveLength(1);
    });

    it('scopes a session approval to its own chat process', async () => {
        const approvals = new DangerousCommandSessionApprovals();
        approvals.add('p1', 'rm-recursive-dangerous-target');
        const { emitted, addon } = makeTurn();
        const other = buildDangerousCommandGuardWiring({
            processId: 'p2',
            enabled: true,
            isInteractive: () => true,
            getAskApproval: () => addon.askApproval,
            approvals,
        });

        const pending = screen(other);
        await vi.waitFor(() => expect(emitted).toHaveLength(1));
        addon.answerQuestion(emitted[0].questionId, 'deny');
        await expect(pending).resolves.toMatchObject({ allowed: false });
    });

    it('denies a non-interactive turn immediately, with a reason that names the cause', async () => {
        const { emitted, addon } = makeTurn({ isInteractive: () => false });
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: true,
            isInteractive: () => false,
            getAskApproval: () => addon.askApproval,
        });

        // No approval channel at all — that absence is the signal the SDK reads.
        expect(guard.requestApproval).toBeUndefined();

        const result = await screen(guard);
        expect(result.allowed).toBe(false);
        expect(result.denialMessage).toContain('not interactive');
        expect(result.denialMessage).toContain('rm-recursive-dangerous-target');
        expect(emitted).toEqual([]);
    });

    it('denies when the turn has no ask-user handles left', async () => {
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: true,
            isInteractive: () => true,
            getAskApproval: () => undefined,
        });

        await expect(screen(guard)).resolves.toMatchObject({ allowed: false, decision: 'deny' });
    });

    it('treats a skipped or cancelled prompt as a denial', async () => {
        const { emitted, addon } = makeTurn();
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: true,
            isInteractive: () => true,
            getAskApproval: () => addon.askApproval,
        });

        const skipped = screen(guard);
        await vi.waitFor(() => expect(emitted).toHaveLength(1));
        addon.skipQuestion(emitted[0].questionId);
        await expect(skipped).resolves.toMatchObject({ allowed: false, decision: 'deny' });

        const cancelled = screen(guard);
        await vi.waitFor(() => expect(emitted).toHaveLength(2));
        addon.cancelAll();
        await expect(cancelled).resolves.toMatchObject({ allowed: false, decision: 'deny' });
    });

    it('leaves a benign command alone', async () => {
        const { emitted, addon } = makeTurn();
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: true,
            isInteractive: () => true,
            getAskApproval: () => addon.askApproval,
        });

        await expect(screen(guard, 'npm test')).resolves.toEqual({ allowed: true });
        expect(emitted).toEqual([]);
    });

    it('still reaches the user when the ask_user tool itself is disabled', async () => {
        const { emitted, addon } = makeTurn({ askUserEnabled: false });
        expect(addon.tools).toEqual([]);
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: true,
            isInteractive: () => true,
            getAskApproval: () => addon.askApproval,
        });

        const pending = screen(guard);
        await vi.waitFor(() => expect(emitted).toHaveLength(1));
        addon.answerQuestion(emitted[0].questionId, 'approve-once');
        await expect(pending).resolves.toMatchObject({ allowed: true });
    });

    it('records every decision for the audit trail, without the command text', async () => {
        const records: DangerousCommandDecisionRecord[] = [];
        const { emitted, addon } = makeTurn();
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: true,
            isInteractive: () => true,
            getAskApproval: () => addon.askApproval,
            approvals: new DangerousCommandSessionApprovals(),
            onDecision: (record) => { records.push(record); },
        });

        const first = screen(guard);
        await vi.waitFor(() => expect(emitted).toHaveLength(1));
        addon.answerQuestion(emitted[0].questionId, 'approve-session');
        await first;
        await screen(guard);

        expect(records).toHaveLength(2);
        expect(records[0]).toMatchObject({
            ruleId: 'rm-recursive-dangerous-target',
            decision: 'approved-session',
            fromSessionApproval: false,
        });
        expect(records[1]).toMatchObject({ decision: 'approved-session', fromSessionApproval: true });
        expect(Number.isNaN(Date.parse(records[0].timestamp))).toBe(false);
        expect(JSON.stringify(records)).not.toContain('rm -rf');
    });

    it('records a non-interactive block, where there is no approval callback at all', async () => {
        // AC-06 denies by omitting `requestApproval`, so the wiring's own
        // callbacks never run. The audit sink still has to fire, otherwise a
        // cron or Ralph turn blocks a command with nothing left behind to show
        // for it.
        const records: DangerousCommandDecisionRecord[] = [];
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: true,
            isInteractive: () => false,
            getAskApproval: () => undefined,
            onDecision: (record) => { records.push(record); },
        });
        expect(guard.requestApproval).toBeUndefined();

        await expect(screen(guard)).resolves.toMatchObject({ allowed: false });

        expect(records).toEqual([
            expect.objectContaining({
                ruleId: 'rm-recursive-dangerous-target',
                decision: 'auto-denied-non-interactive',
                fromSessionApproval: false,
            }),
        ]);
    });

    it('records a denial when the user says no', async () => {
        const records: DangerousCommandDecisionRecord[] = [];
        const { emitted, addon } = makeTurn();
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: true,
            isInteractive: () => true,
            getAskApproval: () => addon.askApproval,
            approvals: new DangerousCommandSessionApprovals(),
            onDecision: (record) => { records.push(record); },
        });

        const pending = screen(guard);
        await vi.waitFor(() => expect(emitted).toHaveLength(1));
        addon.answerQuestion(emitted[0].questionId, 'deny');
        await expect(pending).resolves.toMatchObject({ allowed: false });

        expect(records).toEqual([
            expect.objectContaining({ decision: 'denied', fromSessionApproval: false }),
        ]);
    });

    it('does not wire an audit sink when the flag is off', () => {
        const guard = buildDangerousCommandGuardWiring({
            processId: 'p1',
            enabled: false,
            isInteractive: () => true,
            getAskApproval: () => undefined,
            onDecision: () => { throw new Error('should not be called'); },
        });
        expect(guard).toEqual({ enabled: false });
    });
});

describe('DangerousCommandSessionApprovals', () => {
    it('remembers rule ids per process and forgets on clear', () => {
        const approvals = new DangerousCommandSessionApprovals();
        approvals.add('p1', 'pipe-to-shell');
        approvals.add('p1', 'host-lifecycle');
        expect(approvals.has('p1', 'pipe-to-shell')).toBe(true);
        expect(approvals.has('p2', 'pipe-to-shell')).toBe(false);
        expect(approvals.list('p1').sort()).toEqual(['host-lifecycle', 'pipe-to-shell']);
        approvals.clear('p1');
        expect(approvals.has('p1', 'pipe-to-shell')).toBe(false);
    });

    it('evicts the oldest process once the cap is exceeded', () => {
        const approvals = new DangerousCommandSessionApprovals();
        for (let i = 0; i < 205; i++) approvals.add(`p${i}`, 'pipe-to-shell');
        expect(approvals.has('p0', 'pipe-to-shell')).toBe(false);
        expect(approvals.has('p204', 'pipe-to-shell')).toBe(true);
    });
});
