/**
 * AC-08: a guard decision has to be readable after the turn ends, so it is
 * appended to the chat process's metadata. These cover the append itself —
 * ordering under concurrency, the cap, the untouched neighbours, and the rule
 * that the command text never reaches the store.
 */

import { describe, expect, it, vi } from 'vitest';
import type { GenericProcessMetadata } from '@plusplusoneplusplus/forge';
import {
    DANGEROUS_COMMAND_AUDIT_LIMIT,
    DANGEROUS_COMMAND_AUDIT_METADATA_KEY,
    readDangerousCommandAudit,
    recordDangerousCommandDecision,
} from '../../../src/server/executors/dangerous-command-audit';
import type { DangerousCommandDecisionRecord } from '../../../src/server/executors/dangerous-command-guard-wiring';

function makeRecord(
    overrides: Partial<DangerousCommandDecisionRecord> = {},
): DangerousCommandDecisionRecord {
    return {
        ruleId: 'rm-recursive-dangerous-target',
        decision: 'denied',
        fromSessionApproval: false,
        timestamp: '2026-09-07T00:00:00.000Z',
        ...overrides,
    };
}

/** Minimal store double with the read-modify-write surface the audit uses. */
function makeStore(initial: GenericProcessMetadata | undefined = { type: 'chat' }) {
    let metadata = initial;
    return {
        get metadata() {
            return metadata;
        },
        getProcess: vi.fn(async (_id: string) => (metadata ? { metadata } : { metadata: undefined })),
        updateProcess: vi.fn(async (_id: string, update: { metadata?: GenericProcessMetadata }) => {
            metadata = update.metadata;
        }),
    };
}

describe('recordDangerousCommandDecision', () => {
    it('appends a decision to the process metadata', async () => {
        const store = makeStore();
        await recordDangerousCommandDecision(store, 'p1', makeRecord());

        expect(readDangerousCommandAudit(store.metadata)).toEqual([makeRecord()]);
        expect(store.metadata?.type).toBe('chat');
    });

    it('keeps existing metadata keys and the process type', async () => {
        const store = makeStore({ type: 'chat', workspaceId: 'ws1', systemPrompt: 'hello' });
        await recordDangerousCommandDecision(store, 'p1', makeRecord());

        expect(store.metadata).toMatchObject({
            type: 'chat',
            workspaceId: 'ws1',
            systemPrompt: 'hello',
        });
    });

    it('appends in order without losing a concurrent write', async () => {
        // Two decisions in the same tick would race a plain read-modify-write.
        const store = makeStore();
        await Promise.all([
            recordDangerousCommandDecision(store, 'p1', makeRecord({ ruleId: 'a' })),
            recordDangerousCommandDecision(store, 'p1', makeRecord({ ruleId: 'b' })),
            recordDangerousCommandDecision(store, 'p1', makeRecord({ ruleId: 'c' })),
        ]);

        expect(readDangerousCommandAudit(store.metadata).map((r) => r.ruleId)).toEqual(['a', 'b', 'c']);
    });

    it('keeps only the most recent decisions once the cap is reached', async () => {
        const store = makeStore();
        for (let i = 0; i < DANGEROUS_COMMAND_AUDIT_LIMIT + 5; i++) {
            await recordDangerousCommandDecision(store, 'p1', makeRecord({ ruleId: `r${i}` }));
        }

        const decisions = readDangerousCommandAudit(store.metadata);
        expect(decisions).toHaveLength(DANGEROUS_COMMAND_AUDIT_LIMIT);
        expect(decisions[0].ruleId).toBe('r5');
        expect(decisions[decisions.length - 1].ruleId).toBe(`r${DANGEROUS_COMMAND_AUDIT_LIMIT + 4}`);
    });

    it('scopes the trail per process', async () => {
        const one = makeStore();
        const two = makeStore();
        await recordDangerousCommandDecision(one, 'p1', makeRecord({ ruleId: 'pipe-to-shell' }));
        await recordDangerousCommandDecision(two, 'p2', makeRecord({ ruleId: 'host-lifecycle' }));

        expect(readDangerousCommandAudit(one.metadata).map((r) => r.ruleId)).toEqual(['pipe-to-shell']);
        expect(readDangerousCommandAudit(two.metadata).map((r) => r.ruleId)).toEqual(['host-lifecycle']);
    });

    it('records every decision value the guard can produce', async () => {
        const store = makeStore();
        for (const decision of [
            'approved-once',
            'approved-session',
            'denied',
            'auto-denied-non-interactive',
        ] as const) {
            await recordDangerousCommandDecision(store, 'p1', makeRecord({ decision }));
        }

        expect(readDangerousCommandAudit(store.metadata).map((r) => r.decision)).toEqual([
            'approved-once',
            'approved-session',
            'denied',
            'auto-denied-non-interactive',
        ]);
    });

    it('never persists command text', async () => {
        const store = makeStore();
        await recordDangerousCommandDecision(store, 'p1', makeRecord());

        expect(JSON.stringify(store.metadata)).not.toContain('rm -rf');
    });

    it('does nothing when the process is gone', async () => {
        const store = {
            getProcess: vi.fn(async () => undefined),
            updateProcess: vi.fn(async () => undefined),
        };
        await recordDangerousCommandDecision(store as never, 'missing', makeRecord());

        expect(store.updateProcess).not.toHaveBeenCalled();
    });

    it('swallows a store failure — an audit write must not fail the turn', async () => {
        const store = {
            getProcess: vi.fn(async () => ({ metadata: { type: 'chat' } })),
            updateProcess: vi.fn(async () => {
                throw new Error('database is locked');
            }),
        };
        await expect(
            recordDangerousCommandDecision(store as never, 'p1', makeRecord()),
        ).resolves.toBeUndefined();
    });

    it('recovers after a failed write and still appends the next decision', async () => {
        let failNext = true;
        let metadata: GenericProcessMetadata | undefined = { type: 'chat' };
        const store = {
            getProcess: vi.fn(async () => ({ metadata })),
            updateProcess: vi.fn(async (_id: string, update: { metadata?: GenericProcessMetadata }) => {
                if (failNext) {
                    failNext = false;
                    throw new Error('transient');
                }
                metadata = update.metadata;
            }),
        };
        await recordDangerousCommandDecision(store as never, 'p1', makeRecord({ ruleId: 'a' }));
        await recordDangerousCommandDecision(store as never, 'p1', makeRecord({ ruleId: 'b' }));

        expect(readDangerousCommandAudit(metadata).map((r) => r.ruleId)).toEqual(['b']);
    });
});

describe('readDangerousCommandAudit', () => {
    it('returns an empty trail for missing or malformed metadata', () => {
        expect(readDangerousCommandAudit(undefined)).toEqual([]);
        expect(readDangerousCommandAudit({ type: 'chat' })).toEqual([]);
        expect(
            readDangerousCommandAudit({
                type: 'chat',
                [DANGEROUS_COMMAND_AUDIT_METADATA_KEY]: { decisions: 'nope' },
            }),
        ).toEqual([]);
    });
});
