import type { SentinelTodoItem, SentinelTodoOwner, SentinelTodoPatch, SentinelTodoStore } from '../sentinel-todos/sentinel-todo-store';
import { SentinelTodoError } from '../sentinel-todos/sentinel-todo-store';
import { evidenceFingerprint, type CodaFindingInput } from './coda-model';
import {
    CodaStoreError, type CodaAuditEntry, type CodaStore, type CodaDemotion,
    type CodaFindingRecord, type CodaFindingState, type CodaItemState, type CodaRunRecord,
} from './coda-store';

/** Retires an item's armed PR rules inside the current transaction; the callback runs after commit. */
export interface CodaRunSourceRetirer {
    retireItemRules(owner: SentinelTodoOwner, itemId: string): () => void;
}

export interface CodaEngineDeps {
    todos: SentinelTodoStore;
    scrubber: CodaStore;
    triggers?: CodaRunSourceRetirer;
    now?: () => Date;
}

const OUTCOME_LIMIT = 4_000;

/**
 * Applies a run's findings to the ledger under the authority guards, and
 * resolves the resulting proposals. Only `done` with `autoApply` is ever
 * written by the scrubber; every other change waits for the user.
 */
export class CodaEngine {
    constructor(private readonly deps: CodaEngineDeps) {}

    /**
     * Completes a running run and settles its findings in one transaction.
     * Returns `undefined` (and applies nothing) when the run is no longer
     * running, e.g. it was cancelled or timed out first.
     */
    complete(owner: SentinelTodoOwner, runId: string, findings: readonly CodaFindingInput[]):
        { run: CodaRunRecord; findings: CodaFindingRecord[] } | undefined {
        return this.withEffects(effects => {
            const now = this.now();
            const run = this.deps.scrubber.transitionRun(owner, runId, ['running'],
                { status: 'completed', finishedAt: now.toISOString() });
            if (!run) return undefined;
            const items = new Map(this.deps.todos.get(owner).items.map(item => [item.id, item]));
            const snapshot = new Map(run.snapshot.map(entry => [entry.itemId, entry.revision]));
            const records: CodaFindingRecord[] = [];
            const seen = new Set<string>();
            for (const finding of findings) {
                const revision = snapshot.get(finding.itemId);
                const item = items.get(finding.itemId);
                // Only items the run was given can be assessed, once each.
                if (revision === undefined || !item || seen.has(finding.itemId)) continue;
                seen.add(finding.itemId);
                records.push(this.settle(owner, run, item, revision, finding, effects));
            }
            this.deps.scrubber.saveFindings(owner, runId, records);
            return { run, findings: records };
        });
    }

    /** Applies a proposal as the user. Stale items need a fresh scrub. */
    accept(owner: SentinelTodoOwner, runId: string, itemId: string, expectedItemRevision: number):
        { item: SentinelTodoItem; finding: CodaFindingRecord } {
        return this.withEffects(effects => {
            const record = this.requireFinding(owner, runId, itemId, 'proposed');
            const current = this.currentItem(owner, itemId, record.itemRevision, expectedItemRevision);
            const { item } = this.deps.todos.update(owner, itemId, current.revision, proposalPatch(record.finding), 'user');
            if (item.status === 'done') effects.push(this.retireRules(owner, itemId));
            return { item, finding: this.resolve(owner, record, 'proposed', 'accepted', current, item, 'user') };
        });
    }

    /** Hides a proposal until its evidence changes. */
    dismiss(owner: SentinelTodoOwner, runId: string, itemId: string): CodaFindingRecord {
        return this.deps.scrubber.transaction(() => {
            const record = this.requireFinding(owner, runId, itemId, 'proposed');
            this.deps.scrubber.suppress(owner, itemId, record.finding.verdict, record.fingerprint);
            return this.resolve(owner, record, 'proposed', 'dismissed', undefined, undefined, 'user');
        });
    }

    /**
     * Restores the item as it was before an auto-applied Done. This is a
     * user verdict, and the same finding is never re-applied.
     */
    undo(owner: SentinelTodoOwner, runId: string, itemId: string, expectedItemRevision: number):
        { item: SentinelTodoItem; finding: CodaFindingRecord } {
        return this.deps.scrubber.transaction(() => {
            const record = this.requireFinding(owner, runId, itemId, 'applied');
            const applied = record.audit.find(entry => entry.action === 'applied');
            if (!applied?.before || !applied.after) throw new CodaStoreError('conflict', 'Nothing to undo');
            const current = this.currentItem(owner, itemId, applied.after.revision, expectedItemRevision);
            const before = applied.before;
            const { item } = this.deps.todos.update(owner, itemId, current.revision, {
                status: before.status, outcome: before.outcome ?? null, archived: before.archived,
            }, 'user');
            this.deps.scrubber.suppress(owner, itemId, record.finding.verdict, record.fingerprint);
            return { item, finding: this.resolve(owner, record, 'applied', 'undone', current, item, 'user') };
        });
    }

    private settle(
        owner: SentinelTodoOwner,
        run: CodaRunRecord,
        item: SentinelTodoItem,
        itemRevision: number,
        finding: CodaFindingInput,
        effects: Array<() => void>,
    ): CodaFindingRecord {
        const record: CodaFindingRecord = {
            runId: run.id, itemId: item.id, finding, fingerprint: evidenceFingerprint(finding.evidence),
            itemRevision, state: 'proposed', audit: [],
        };
        if (finding.verdict === 'unchanged' || finding.verdict === 'unverified') return { ...record, state: finding.verdict };
        if (matchesItem(item, finding)) return { ...record, state: 'unchanged' };
        if (this.deps.scrubber.isSuppressed(owner, item.id, finding.verdict, record.fingerprint)) {
            return { ...record, state: 'suppressed' };
        }
        if (!finding.autoApply) return record;
        const demotion = demote(run, item, itemRevision, finding, this.now());
        if (demotion) return { ...record, demotedBecause: demotion };
        const written = this.deps.todos.recordCodaDone(owner, item.id, itemRevision, doneOutcome(finding)).item;
        effects.push(this.retireRules(owner, item.id));
        return {
            ...record, state: 'applied',
            audit: [audit('applied', 'scrubber', this.now(), item, written)],
        };
    }

    private resolve(
        owner: SentinelTodoOwner,
        record: CodaFindingRecord,
        from: CodaFindingState,
        state: CodaFindingState,
        before: SentinelTodoItem | undefined,
        after: SentinelTodoItem | undefined,
        actor: CodaAuditEntry['actor'],
    ): CodaFindingRecord {
        const action = state as 'accepted' | 'dismissed' | 'undone';
        const next: CodaFindingRecord = { ...record, state, audit: [...record.audit, audit(action, actor, this.now(), before, after)] };
        if (!this.deps.scrubber.updateFinding(owner, from, next)) {
            throw new CodaStoreError('conflict', 'This finding was already resolved');
        }
        return next;
    }

    private requireFinding(owner: SentinelTodoOwner, runId: string, itemId: string, state: CodaFindingState): CodaFindingRecord {
        const record = this.deps.scrubber.getFinding(owner, runId, itemId);
        if (!record) throw new CodaStoreError('not_found', 'Finding not found');
        if (record.state !== state) throw new CodaStoreError('conflict', `This finding is ${record.state}`);
        return record;
    }

    /** The item must still be exactly the version the finding (and the caller) saw. */
    private currentItem(owner: SentinelTodoOwner, itemId: string, findingRevision: number, expectedRevision: number): SentinelTodoItem {
        const item = this.deps.todos.get(owner).items.find(candidate => candidate.id === itemId);
        if (!item) throw new SentinelTodoError('not_found', `To-do item ${itemId} not found`);
        if (item.revision !== findingRevision || item.revision !== expectedRevision) {
            throw new SentinelTodoError('conflict', 'Item changed since this proposal; run Coda again', item);
        }
        return item;
    }

    private retireRules(owner: SentinelTodoOwner, itemId: string): () => void {
        return this.deps.triggers?.retireItemRules(owner, itemId) ?? (() => undefined);
    }

    /** Ledger, findings and rule retirement commit together; in-memory effects follow. */
    private withEffects<T>(fn: (effects: Array<() => void>) => T): T {
        const effects: Array<() => void> = [];
        const result = this.deps.scrubber.transaction(() => fn(effects));
        for (const effect of effects) effect();
        return result;
    }

    private now(): Date {
        return (this.deps.now ?? (() => new Date()))();
    }
}

/**
 * Why an auto-Done must become a proposal: a manual item, an item that
 * changed since the run snapshot, a newer user verdict, then the structural
 * evidence gate (high confidence and an entry checked during this run).
 */
function demote(run: CodaRunRecord, item: SentinelTodoItem, itemRevision: number, finding: CodaFindingInput, now: Date):
    CodaDemotion | undefined {
    if (item.type === 'manual') return 'manual';
    if (item.status === 'deferred') return 'user_verdict';
    if (item.revision !== itemRevision) return 'superseded';
    if (userVerdictIsNewer(item, finding)) return 'user_verdict';
    const startedAt = Date.parse(run.startedAt ?? run.createdAt);
    const fresh = finding.evidence.some(entry => {
        const checkedAt = Date.parse(entry.checkedAt);
        return checkedAt >= startedAt && checkedAt <= now.getTime();
    });
    if (finding.confidence !== 'high' || !fresh) return 'evidence_gate';
    return undefined;
}

/**
 * A user verdict wins unless at least one cited entry is newer: an
 * observation after the user's last edit, or a job linked after the verdict.
 * Entries without a time cannot prove they are newer.
 */
function userVerdictIsNewer(item: SentinelTodoItem, finding: CodaFindingInput): boolean {
    if (item.userVerdictRevision === undefined) return false;
    return !finding.evidence.some(entry => {
        const job = entry.kind === 'job' ? item.jobs.find(link => entry.ref === link.processId || entry.ref === link.openLink) : undefined;
        if (job && job.linkedRevision >= item.userVerdictRevision!) return true;
        return !!entry.observedAt && !!item.userEditedAt && Date.parse(entry.observedAt) > Date.parse(item.userEditedAt);
    });
}

function matchesItem(item: SentinelTodoItem, finding: CodaFindingInput): boolean {
    if (finding.verdict === 'obsolete') return item.status === 'done' && item.archived;
    return item.status === finding.verdict;
}

/** The user-applied change for an accepted proposal. Obsolete closes and archives. */
function proposalPatch(finding: CodaFindingInput): SentinelTodoPatch {
    switch (finding.verdict) {
        case 'done': return { status: 'done', outcome: doneOutcome(finding) };
        case 'obsolete': return { status: 'done', outcome: `Obsolete: ${finding.summary}`.slice(0, OUTCOME_LIMIT), archived: true };
        case 'deferred': return { status: 'deferred', statusReason: finding.summary };
        case 'in_progress': return { status: 'in_progress', statusReason: finding.summary };
        case 'needs_attention': return { status: 'needs_attention', statusReason: finding.summary };
        default: throw new CodaStoreError('conflict', `A ${finding.verdict} finding has nothing to accept`);
    }
}

function doneOutcome(finding: CodaFindingInput): string {
    const links = finding.evidence.map(entry => entry.ref);
    return (links.length ? `${finding.summary}\nEvidence: ${links.join(' ')}` : finding.summary).slice(0, OUTCOME_LIMIT);
}

function audit(action: CodaAuditEntry['action'], actor: CodaAuditEntry['actor'], at: Date,
    before?: SentinelTodoItem, after?: SentinelTodoItem): CodaAuditEntry {
    return { action, actor, at: at.toISOString(),
        ...(before ? { before: itemState(before) } : {}), ...(after ? { after: itemState(after) } : {}) };
}

function itemState(item: SentinelTodoItem): CodaItemState {
    return { status: item.status, ...(item.outcome ? { outcome: item.outcome.summary } : {}), archived: item.archived, revision: item.revision };
}
