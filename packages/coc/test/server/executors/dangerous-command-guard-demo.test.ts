/**
 * DoD 7, as a test: the manual demo script, walked end to end.
 *
 * Every other suite for this feature stubs at least one layer — the wiring
 * tests hand `screenDangerousCommand` a fake matcher, the SDK gate tests stub
 * the host. This one stubs nothing below the SSE boundary: the **real** Rust
 * rule set in `coc-native` decides, the real ask-user addon writes the prompt,
 * the real session store remembers, and the real audit writer persists. What
 * stands in for a human is answering the pending question — which is exactly
 * what `POST /api/processes/:id/ask-user-response` does in the running app.
 *
 * The script it follows, from the spec's Definition of Done:
 *
 *   enable the flag, open an ask-mode chat, ask the agent to run
 *   `rm -rf /tmp/demo-dir`, confirm the approval prompt appears with the full
 *   command and matched rule, deny it and confirm the model is told; re-run and
 *   approve-for-session, then confirm a second matching command runs without a
 *   second prompt.
 *
 * Because it pins the guard against the real rule set, it is also the
 * regression test for the matcher and the host agreeing on rule ids: a rule
 * rename in Rust that the session store did not hear about would surface here
 * as a second prompt where the demo expects none.
 */

import { describe, expect, it, vi } from 'vitest';
import type { GenericProcessMetadata } from '@plusplusoneplusplus/forge';
import { screenDangerousCommand } from '@plusplusoneplusplus/coc-agent-sdk';
import { buildAskUserAddon } from '../../../src/server/executors/prompt-builder';
import {
    buildDangerousCommandGuardWiring,
    type DangerousCommandDecisionRecord,
} from '../../../src/server/executors/dangerous-command-guard-wiring';
import { DangerousCommandSessionApprovals } from '../../../src/server/executors/dangerous-command-session-approvals';
import {
    readDangerousCommandAudit,
    recordDangerousCommandDecision,
} from '../../../src/server/executors/dangerous-command-audit';
import type { AskUserSSEPayload, AskUserToolDeps } from '../../../src/server/llm-tools/ask-user-tool';

const DEMO_COMMAND = 'rm -rf /tmp/demo-dir';
/** A different command that trips the same rule — the second half of the demo. */
const SECOND_COMMAND = 'rm -rf /tmp/demo-dir-2';
const DEMO_RULE = 'rm-recursive-dangerous-target';

/** Minimal process store: the read-modify-write surface the audit writer uses. */
function makeStore() {
    let metadata: GenericProcessMetadata = { type: 'chat' };
    return {
        get metadata() {
            return metadata;
        },
        getProcess: vi.fn(async () => ({ metadata })),
        updateProcess: vi.fn(async (_id: string, update: { metadata?: GenericProcessMetadata }) => {
            if (update.metadata) metadata = update.metadata;
        }),
    };
}

/**
 * One ask-mode chat process with the admin flag on, wired the way
 * `chat-base-executor` wires an interactive turn.
 *
 * `emitted` is what a connected SPA receives on the `ask-user` SSE event;
 * `answer` is what the ask-user-response route does with the reply. The session
 * store and the audit store are per-chat, so they outlive a turn — `newTurn()`
 * rebuilds only the parts that are genuinely per-turn.
 */
function openAskModeChat(processId = 'demo-process') {
    const emitted: AskUserSSEPayload[] = [];
    const audit: DangerousCommandDecisionRecord[] = [];
    const approvals = new DangerousCommandSessionApprovals();
    const store = makeStore();

    const deps: AskUserToolDeps = {
        emitQuestions: (payloads) => {
            emitted.push(...payloads);
        },
        computeTurnIndex: () => 1,
    };
    const addon = buildAskUserAddon(true, deps);

    const newTurn = (isInteractive = true) =>
        buildDangerousCommandGuardWiring({
            processId,
            enabled: true,
            isInteractive: () => isInteractive,
            getAskApproval: () => addon.askApproval,
            approvals,
            onDecision: (record) => {
                audit.push(record);
                // Fire-and-forget in the executor; awaited here so assertions
                // do not race the write.
                void recordDangerousCommandDecision(store, processId, record);
            },
        });

    /** Stand in for the user clicking an option in the chat UI. */
    const answer = (decision: string) => {
        const prompt = emitted.at(-1);
        if (!prompt) throw new Error('no approval prompt was emitted');
        expect(addon.answerQuestion(prompt.questionId, decision)).toBe(true);
    };

    /** The agent asking to run a command in ask mode — no matcher override. */
    const runCommand = (guard: ReturnType<typeof newTurn>, command: string) =>
        screenDangerousCommand('Bash', { command }, guard, {});

    return { emitted, audit, store, approvals, newTurn, answer, runCommand, processId };
}

describe('dangerous-command guard — the DoD 7 demo, end to end', () => {
    it('prompts with the full command and the real matched rule, then blocks on deny', async () => {
        const chat = openAskModeChat();
        const guard = chat.newTurn();

        const screened = chat.runCommand(guard, DEMO_COMMAND);

        // The turn is now parked on the prompt. Nothing has been decided.
        await vi.waitFor(() => expect(chat.emitted).toHaveLength(1));
        const prompt = chat.emitted[0];

        // AC-04: the full command text, the rule that fired, and the segment.
        expect(prompt.approval).toEqual({
            kind: 'dangerous-command',
            command: DEMO_COMMAND,
            ruleId: DEMO_RULE,
            // Straight from the Rust rule set — not a fixture.
            description: 'Recursive delete targeting the filesystem root, the home directory, or an absolute path',
            matchedSegment: DEMO_COMMAND,
        });
        expect(prompt.question).toContain(DEMO_COMMAND);
        expect(prompt.type).toBe('select');
        expect(prompt.options?.map((o) => o.value)).toEqual([
            'approve-once',
            'approve-session',
            'deny',
        ]);
        // Losing the connection must not approve anything.
        expect(prompt.defaultValue).toBe('deny');

        chat.answer('deny');

        const result = await screened;
        expect(result.allowed).toBe(false);
        // The model is told why, and the reason names the rule so it can
        // choose a different approach rather than retrying blindly.
        expect(result.denialMessage).toContain(DEMO_RULE);
        expect(result.denialMessage).toMatch(/denied/i);

        // AC-08: visible after the turn ends, and never carrying the command.
        await vi.waitFor(() =>
            expect(readDangerousCommandAudit(chat.store.metadata)).toEqual([
                {
                    ruleId: DEMO_RULE,
                    decision: 'denied',
                    fromSessionApproval: false,
                    timestamp: expect.any(String),
                },
            ]),
        );
        expect(JSON.stringify(chat.store.metadata)).not.toContain('/tmp/demo-dir');
    });

    it('runs a second matching command with no second prompt after approve-for-session', async () => {
        const chat = openAskModeChat();

        // First turn: the user approves for the session.
        const first = chat.runCommand(chat.newTurn(), DEMO_COMMAND);
        await vi.waitFor(() => expect(chat.emitted).toHaveLength(1));
        chat.answer('approve-session');
        await expect(first).resolves.toMatchObject({ allowed: true });

        // A later turn in the same chat — the wiring is rebuilt per turn, so
        // this only works if the approval outlived it.
        const second = chat.runCommand(chat.newTurn(), SECOND_COMMAND);
        await expect(second).resolves.toMatchObject({ allowed: true });

        // AC-05: the whole point — no second prompt.
        expect(chat.emitted).toHaveLength(1);

        await vi.waitFor(() => expect(readDangerousCommandAudit(chat.store.metadata)).toHaveLength(2));
        expect(chat.audit.map((r) => [r.decision, r.fromSessionApproval])).toEqual([
            ['approved-session', false],
            // The second one was answered off the standing approval.
            ['approved-session', true],
        ]);
    });

    it('still prompts a second time after approve-once', async () => {
        const chat = openAskModeChat();

        const first = chat.runCommand(chat.newTurn(), DEMO_COMMAND);
        await vi.waitFor(() => expect(chat.emitted).toHaveLength(1));
        chat.answer('approve-once');
        await expect(first).resolves.toMatchObject({ allowed: true });

        const second = chat.runCommand(chat.newTurn(), SECOND_COMMAND);
        await vi.waitFor(() => expect(chat.emitted).toHaveLength(2));
        chat.answer('deny');
        await expect(second).resolves.toMatchObject({ allowed: false });
    });

    it('leaves the benign commands of an ordinary demo session alone', async () => {
        const chat = openAskModeChat();
        const guard = chat.newTurn();

        // Real rule set, real lookalikes — none of these may stop the turn.
        for (const command of [
            'rm -rf ./build',
            'rm -rf node_modules',
            'ls -la /tmp/demo-dir',
            'echo shutdown',
            'git diff',
        ]) {
            await expect(chat.runCommand(guard, command)).resolves.toEqual({ allowed: true });
        }

        expect(chat.emitted).toHaveLength(0);
        // Nothing fired, so nothing is audited.
        expect(readDangerousCommandAudit(chat.store.metadata)).toEqual([]);
    });

    it('denies the same demo command outright when nobody is watching the turn', async () => {
        const chat = openAskModeChat();
        // A cron or Ralph turn: same chat, same flag, no attached client.
        const guard = chat.newTurn(false);

        const result = await chat.runCommand(guard, DEMO_COMMAND);

        expect(result.allowed).toBe(false);
        expect(result.denialMessage).toMatch(/not interactive/i);
        // AC-06: it denies immediately rather than parking the turn forever.
        expect(chat.emitted).toHaveLength(0);

        await vi.waitFor(() =>
            expect(readDangerousCommandAudit(chat.store.metadata)).toMatchObject([
                { ruleId: DEMO_RULE, decision: 'auto-denied-non-interactive' },
            ]),
        );
    });
});
