import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import type { SentinelTodoOwner, SentinelTodoStatus } from '../sentinel-todos/sentinel-todo-store';
import {
    MAX_SCRUB_RUNS, SCRUB_DEFAULT_CRON, SCRUB_FAILURE_PAUSE_THRESHOLD,
    type ScrubFindingInput, type ScrubVerdict,
} from './scrubber-model';

export type ScrubRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'interrupted' | 'skipped';
export type ScrubTrigger = 'manual' | 'schedule';
export const ACTIVE_SCRUB_STATUSES: readonly ScrubRunStatus[] = ['queued', 'running'];

export interface ScrubberConfig {
    enabled: boolean;
    cron: string;
    paused: boolean;
    consecutiveFailures: number;
    revision: number;
    /** Input fingerprint of the last completed run, for skip-if-unchanged ticks. */
    lastInputFingerprint?: string;
}

export interface ScrubRunRecord {
    id: string;
    trigger: ScrubTrigger;
    status: ScrubRunStatus;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    /** Set for "Scrub selected" runs. */
    selectedItemIds?: string[];
    /** The read-only child chat (queue process id). */
    childProcessId?: string;
    error?: string;
    skipReason?: 'overlap' | 'unchanged';
    /** Item revisions captured when the run started; every write expects them. */
    snapshot: Array<{ itemId: string; revision: number }>;
    deferredItemIds: string[];
    awaitingReviewItemIds: string[];
    inputFingerprint?: string;
    findingsSubmittedAt?: string;
}

/** The parts of an item a scrubber change can touch, before or after it. */
export interface ScrubItemState {
    status: SentinelTodoStatus;
    outcome?: string;
    archived: boolean;
    revision: number;
}

export interface ScrubAuditEntry {
    action: 'applied' | 'accepted' | 'dismissed' | 'undone';
    actor: 'scrubber' | 'user';
    at: string;
    before?: ScrubItemState;
    after?: ScrubItemState;
}

/**
 * - `pending`: submitted, not yet applied (run still active).
 * - `applied`: auto-Done written by the scrubber.
 * - `proposed`: waiting for the user's Accept/Dismiss.
 * - `suppressed`: matched an earlier dismissal/undo with the same evidence.
 */
export type ScrubFindingState = 'pending' | 'applied' | 'proposed' | 'accepted' | 'dismissed' | 'undone'
    | 'unchanged' | 'unverified' | 'suppressed';
export type ScrubDemotion = 'superseded' | 'user_verdict' | 'manual' | 'evidence_gate';

export interface ScrubFindingRecord {
    runId: string;
    itemId: string;
    finding: ScrubFindingInput;
    fingerprint: string;
    /** Item revision from the run snapshot. */
    itemRevision: number;
    state: ScrubFindingState;
    demotedBecause?: ScrubDemotion;
    audit: ScrubAuditEntry[];
}

export class ScrubberStoreError extends Error {
    constructor(readonly code: 'not_found' | 'conflict' | 'invalid', message: string) { super(message); }
}

/**
 * Owner-scoped scrubber config, runs, findings and dismissals in the same
 * native SQLite database as the Sentinel to-do ledger. Every row is keyed by
 * the ledger owner `(workspaceId, parent processId)`; one owner can never
 * read or write another's rows. At most one run per owner is active.
 */
export class ScrubberStore {
    constructor(private readonly db: NativeDatabase) {
        db.transaction(() => db.exec(`
            CREATE TABLE IF NOT EXISTS scrubber_config (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
                cron TEXT NOT NULL,
                paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
                consecutive_failures INTEGER NOT NULL CHECK (consecutive_failures >= 0),
                revision INTEGER NOT NULL CHECK (revision >= 1),
                last_input_fingerprint TEXT,
                PRIMARY KEY (workspace_id, parent_process_id)
            );
            CREATE TABLE IF NOT EXISTS scrubber_runs (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                id TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'timed_out', 'cancelled', 'interrupted', 'skipped')),
                created_at TEXT NOT NULL,
                record TEXT NOT NULL,
                PRIMARY KEY (workspace_id, parent_process_id, id)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS scrubber_runs_single_flight
                ON scrubber_runs (workspace_id, parent_process_id) WHERE status IN ('queued', 'running');
            CREATE INDEX IF NOT EXISTS scrubber_runs_status ON scrubber_runs (status);
            CREATE TABLE IF NOT EXISTS scrubber_findings (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                state TEXT NOT NULL,
                record TEXT NOT NULL,
                PRIMARY KEY (workspace_id, parent_process_id, run_id, item_id),
                FOREIGN KEY (workspace_id, parent_process_id, run_id)
                    REFERENCES scrubber_runs (workspace_id, parent_process_id, id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS scrubber_dismissals (
                workspace_id TEXT NOT NULL,
                parent_process_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                verdict TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                PRIMARY KEY (workspace_id, parent_process_id, item_id, verdict, fingerprint)
            );
        `))();
    }

    getConfig(owner: SentinelTodoOwner): ScrubberConfig {
        const row = this.db.prepare(`SELECT * FROM scrubber_config WHERE workspace_id = ? AND parent_process_id = ?`)
            .get<ConfigRow>(owner.workspaceId, owner.processId);
        if (!row) return { enabled: false, cron: SCRUB_DEFAULT_CRON, paused: false, consecutiveFailures: 0, revision: 0 };
        return {
            enabled: row.enabled === 1, cron: row.cron, paused: row.paused === 1,
            consecutiveFailures: row.consecutive_failures, revision: row.revision,
            ...(row.last_input_fingerprint ? { lastInputFingerprint: row.last_input_fingerprint } : {}),
        };
    }

    /** Owners with an enabled schedule, for arming timers at startup. */
    listEnabledOwners(): SentinelTodoOwner[] {
        return this.db.prepare(`SELECT workspace_id, parent_process_id FROM scrubber_config WHERE enabled = 1`)
            .all<{ workspace_id: string; parent_process_id: string }>()
            .map(row => ({ workspaceId: row.workspace_id, processId: row.parent_process_id }));
    }

    /**
     * Saves the schedule when `expectedRevision` matches. Turning the schedule
     * on (or saving it again) resumes a paused schedule and clears failures.
     */
    putConfig(owner: SentinelTodoOwner, input: { enabled: boolean; cron: string }, expectedRevision: number): ScrubberConfig {
        return this.write(() => {
            const current = this.getConfig(owner);
            if (current.revision !== expectedRevision) throw new ScrubberStoreError('conflict', 'The Coda schedule changed since it was loaded');
            this.saveConfig(owner, { ...current, enabled: input.enabled, cron: input.cron.trim(), paused: false,
                consecutiveFailures: 0, revision: current.revision + 1 });
            return this.getConfig(owner);
        });
    }

    createRun(owner: SentinelTodoOwner, run: ScrubRunRecord): ScrubRunRecord {
        return this.write(() => {
            if (ACTIVE_SCRUB_STATUSES.includes(run.status) && this.activeRun(owner)) {
                throw new ScrubberStoreError('conflict', 'A scrub is already running for this ledger');
            }
            this.db.prepare(`INSERT INTO scrubber_runs (workspace_id, parent_process_id, id, status, created_at, record)
                VALUES (?, ?, ?, ?, ?, ?)`).run(owner.workspaceId, owner.processId, run.id, run.status, run.createdAt, JSON.stringify(run));
            return run;
        });
    }

    activeRun(owner: SentinelTodoOwner): ScrubRunRecord | undefined {
        const row = this.db.prepare(`SELECT record FROM scrubber_runs WHERE workspace_id = ? AND parent_process_id = ?
            AND status IN ('queued', 'running')`).get<{ record: string }>(owner.workspaceId, owner.processId);
        return row ? JSON.parse(row.record) : undefined;
    }

    getRun(owner: SentinelTodoOwner, runId: string): ScrubRunRecord | undefined {
        const row = this.db.prepare(`SELECT record FROM scrubber_runs WHERE workspace_id = ? AND parent_process_id = ? AND id = ?`)
            .get<{ record: string }>(owner.workspaceId, owner.processId, runId);
        return row ? JSON.parse(row.record) : undefined;
    }

    /** Newest first. */
    listRuns(owner: SentinelTodoOwner): ScrubRunRecord[] {
        return this.db.prepare(`SELECT record FROM scrubber_runs WHERE workspace_id = ? AND parent_process_id = ?
            ORDER BY created_at DESC, rowid DESC`).all<{ record: string }>(owner.workspaceId, owner.processId)
            .map(row => JSON.parse(row.record));
    }

    /** Active runs across all owners, for interrupting orphans at startup. */
    listActiveRuns(): Array<{ owner: SentinelTodoOwner; run: ScrubRunRecord }> {
        return this.db.prepare(`SELECT workspace_id, parent_process_id, record FROM scrubber_runs WHERE status IN ('queued', 'running')`)
            .all<{ workspace_id: string; parent_process_id: string; record: string }>()
            .map(row => ({ owner: { workspaceId: row.workspace_id, processId: row.parent_process_id }, run: JSON.parse(row.record) }));
    }

    /**
     * Updates a run only while its status is one of `from`, so a late
     * completion can never overwrite a cancel (or the reverse). Terminal
     * transitions maintain the schedule's failure counter and auto-pause.
     */
    transitionRun(
        owner: SentinelTodoOwner,
        runId: string,
        from: readonly ScrubRunStatus[],
        patch: Partial<Omit<ScrubRunRecord, 'id' | 'trigger' | 'createdAt'>>,
    ): ScrubRunRecord | undefined {
        return this.write(() => {
            const current = this.getRun(owner, runId);
            if (!current || !from.includes(current.status)) return undefined;
            const next: ScrubRunRecord = { ...current, ...patch };
            this.db.prepare(`UPDATE scrubber_runs SET status = ?, record = ? WHERE workspace_id = ? AND parent_process_id = ? AND id = ?`)
                .run(next.status, JSON.stringify(next), owner.workspaceId, owner.processId, runId);
            if (next.status !== current.status) this.countOutcome(owner, next);
            return next;
        });
    }

    /** Drops runs beyond the newest {@link MAX_SCRUB_RUNS}; returns their ids. */
    pruneRuns(owner: SentinelTodoOwner): string[] {
        return this.write(() => {
            // Active runs never count against the kept history.
            const ids = this.listRuns(owner).filter(run => !ACTIVE_SCRUB_STATUSES.includes(run.status))
                .slice(MAX_SCRUB_RUNS).map(run => run.id);
            const remove = this.db.prepare(`DELETE FROM scrubber_runs WHERE workspace_id = ? AND parent_process_id = ? AND id = ?`);
            for (const runId of ids) remove.run(owner.workspaceId, owner.processId, runId);
            return ids;
        });
    }

    saveFindings(owner: SentinelTodoOwner, runId: string, findings: ScrubFindingRecord[]): void {
        this.write(() => {
            const statement = this.db.prepare(`INSERT INTO scrubber_findings (workspace_id, parent_process_id, run_id, item_id, state, record)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (workspace_id, parent_process_id, run_id, item_id) DO UPDATE SET state = excluded.state, record = excluded.record`);
            for (const finding of findings) {
                if (finding.runId !== runId) throw new ScrubberStoreError('conflict', 'Finding belongs to another run');
                statement.run(owner.workspaceId, owner.processId, runId, finding.itemId, finding.state, JSON.stringify(finding));
            }
        });
    }

    listFindings(owner: SentinelTodoOwner, runId: string): ScrubFindingRecord[] {
        return this.db.prepare(`SELECT record FROM scrubber_findings WHERE workspace_id = ? AND parent_process_id = ? AND run_id = ?
            ORDER BY rowid`).all<{ record: string }>(owner.workspaceId, owner.processId, runId).map(row => JSON.parse(row.record));
    }

    getFinding(owner: SentinelTodoOwner, runId: string, itemId: string): ScrubFindingRecord | undefined {
        const row = this.db.prepare(`SELECT record FROM scrubber_findings WHERE workspace_id = ? AND parent_process_id = ?
            AND run_id = ? AND item_id = ?`).get<{ record: string }>(owner.workspaceId, owner.processId, runId, itemId);
        return row ? JSON.parse(row.record) : undefined;
    }

    /**
     * Replaces a finding only while it is still in state `from`, so two
     * concurrent Accept/Dismiss clicks resolve to exactly one winner.
     */
    updateFinding(owner: SentinelTodoOwner, from: ScrubFindingState, next: ScrubFindingRecord): boolean {
        return this.db.prepare(`UPDATE scrubber_findings SET state = ?, record = ? WHERE workspace_id = ? AND parent_process_id = ?
            AND run_id = ? AND item_id = ? AND state = ?`)
            .run(next.state, JSON.stringify(next), owner.workspaceId, owner.processId, next.runId, next.itemId, from).changes === 1;
    }

    /** Remembers a dismissed (or undone) verdict until new evidence appears. */
    suppress(owner: SentinelTodoOwner, itemId: string, verdict: ScrubVerdict, fingerprint: string): void {
        this.db.prepare(`INSERT INTO scrubber_dismissals (workspace_id, parent_process_id, item_id, verdict, fingerprint, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
            .run(owner.workspaceId, owner.processId, itemId, verdict, fingerprint, new Date().toISOString());
    }

    isSuppressed(owner: SentinelTodoOwner, itemId: string, verdict: ScrubVerdict, fingerprint: string): boolean {
        return !!this.db.prepare(`SELECT 1 FROM scrubber_dismissals WHERE workspace_id = ? AND parent_process_id = ?
            AND item_id = ? AND verdict = ? AND fingerprint = ?`).get(owner.workspaceId, owner.processId, itemId, verdict, fingerprint);
    }

    /** Runs `fn` atomically with the database writer reserved first. */
    transaction<T>(fn: () => T): T {
        return this.write(fn);
    }

    private countOutcome(owner: SentinelTodoOwner, run: ScrubRunRecord): void {
        const config = this.getConfig(owner);
        // Without a saved schedule there is nothing to pause.
        if (config.revision === 0) return;
        if (run.status === 'completed') {
            this.saveConfig(owner, { ...config, consecutiveFailures: 0,
                lastInputFingerprint: run.inputFingerprint ?? config.lastInputFingerprint });
        } else if (run.status === 'failed' || run.status === 'timed_out') {
            const failures = config.consecutiveFailures + 1;
            this.saveConfig(owner, { ...config, consecutiveFailures: failures,
                paused: config.paused || failures >= SCRUB_FAILURE_PAUSE_THRESHOLD });
        }
    }

    private saveConfig(owner: SentinelTodoOwner, config: ScrubberConfig): void {
        this.db.prepare(`INSERT INTO scrubber_config (workspace_id, parent_process_id, enabled, cron, paused, consecutive_failures, revision, last_input_fingerprint)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (workspace_id, parent_process_id) DO UPDATE SET enabled = excluded.enabled, cron = excluded.cron,
                paused = excluded.paused, consecutive_failures = excluded.consecutive_failures, revision = excluded.revision,
                last_input_fingerprint = excluded.last_input_fingerprint`)
            .run(owner.workspaceId, owner.processId, Number(config.enabled), config.cron, Number(config.paused),
                config.consecutiveFailures, Math.max(1, config.revision), config.lastInputFingerprint ?? null);
    }

    private write<T>(fn: () => T): T {
        return this.db.transaction(() => {
            // Reserve the SQLite writer before reading, like the ledger store.
            this.db.prepare('UPDATE scrubber_config SET revision = revision WHERE 0').run();
            return fn();
        })();
    }
}

interface ConfigRow {
    enabled: number; cron: string; paused: number; consecutive_failures: number; revision: number;
    last_input_fingerprint: string | null;
}
