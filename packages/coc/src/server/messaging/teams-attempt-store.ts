import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type TeamsAttemptStage = 'started' | 'authenticating' | 'resolving' | 'starting-polling' | 'connected';
export type TeamsAttemptResult = 'disconnected' | 'superseded' | 'failed' | 'interrupted';
export type TeamsFailureCategory = 'configuration' | 'authentication' | 'resolution' | 'polling' | 'unknown';
export type TeamsEventType = 'poll-failed' | 'inbound-observed' | 'inbound-skipped'
    | 'dispatch-command' | 'dispatch-queued' | 'dispatch-follow-up' | 'dispatch-failed'
    | 'reply-attempt' | 'reply-accepted' | 'reply-rejected';
export type TeamsSkipReason = 'initial' | 'unchanged' | 'own' | 'empty' | 'bot';
export interface TeamsAttemptEvent {
    at: string;
    type: TeamsEventType;
    category?: TeamsSkipReason;
}

export interface TeamsAttempt {
    id: string;
    startedAt: string;
    phases: Array<{ stage: TeamsAttemptStage; at: string }>;
    endedAt?: string;
    result?: TeamsAttemptResult;
    failureCategory?: TeamsFailureCategory;
    stage: TeamsAttemptStage;
    events: TeamsAttemptEvent[];
    totals: Record<string, number>;
    pollSuccessCount: number;
    lastPollSuccessAt?: string;
    lastSendSuccessAt?: string;
    pollDegraded: boolean;
    sendDegraded: boolean;
    degraded: boolean;
}

type StoredAttempt = Omit<TeamsAttempt, 'stage' | 'degraded'>;
const STAGES: TeamsAttemptStage[] = ['started', 'authenticating', 'resolving', 'starting-polling', 'connected'];
const RESULTS: TeamsAttemptResult[] = ['disconnected', 'superseded', 'failed', 'interrupted'];
const CATEGORIES: TeamsFailureCategory[] = ['configuration', 'authentication', 'resolution', 'polling', 'unknown'];
const EVENTS: TeamsEventType[] = ['poll-failed', 'inbound-observed', 'inbound-skipped',
    'dispatch-command', 'dispatch-queued', 'dispatch-follow-up', 'dispatch-failed',
    'reply-attempt', 'reply-accepted', 'reply-rejected'];
const SKIP_REASONS: TeamsSkipReason[] = ['initial', 'unchanged', 'own', 'empty', 'bot'];
const TOTAL_KEYS: string[] = ['poll-success', ...EVENTS];
const MAX_EVENTS = 100;
const MAX_COMPLETED = 200;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function readAttempt(value: unknown): StoredAttempt {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Teams attempt history');
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.id)
        || typeof row.startedAt !== 'string' || !Number.isFinite(Date.parse(row.startedAt))
        || !Array.isArray(row.phases) || row.phases.length < 1 || row.phases.length > STAGES.length
        || row.phases.some((phase: unknown) => {
            if (!phase || typeof phase !== 'object') return true;
            const p = phase as Record<string, unknown>;
            return !STAGES.includes(p.stage as TeamsAttemptStage)
                || typeof p.at !== 'string' || !Number.isFinite(Date.parse(p.at));
        })
        || (row.endedAt !== undefined && (typeof row.endedAt !== 'string' || !Number.isFinite(Date.parse(row.endedAt))))
        || (row.result !== undefined && !RESULTS.includes(row.result as TeamsAttemptResult))
        || (row.failureCategory !== undefined && !CATEGORIES.includes(row.failureCategory as TeamsFailureCategory))
        || (row.events !== undefined && (!Array.isArray(row.events) || row.events.length > MAX_EVENTS
            || row.events.some((event: unknown) => {
                if (!event || typeof event !== 'object' || Array.isArray(event)) return true;
                const e = event as Record<string, unknown>;
                return typeof e.at !== 'string' || !Number.isFinite(Date.parse(e.at))
                    || !EVENTS.includes(e.type as TeamsEventType)
                    || (e.category !== undefined && (!SKIP_REASONS.includes(e.category as TeamsSkipReason) || e.type !== 'inbound-skipped'))
                    || (e.reason !== undefined && (!SKIP_REASONS.includes(e.reason as TeamsSkipReason) || e.type !== 'inbound-skipped'));
            })))
        || (row.totals !== undefined && (!row.totals || typeof row.totals !== 'object' || Array.isArray(row.totals)
            || Object.entries(row.totals).some(([key, count]) =>
                !TOTAL_KEYS.includes(key) || !Number.isSafeInteger(count) || (count as number) < 0)))
        || (row.pollSuccessCount !== undefined && (!Number.isSafeInteger(row.pollSuccessCount) || (row.pollSuccessCount as number) < 0))
        || (row.lastPollSuccessAt !== undefined && (typeof row.lastPollSuccessAt !== 'string' || !Number.isFinite(Date.parse(row.lastPollSuccessAt))))
        || (row.lastSendSuccessAt !== undefined && (typeof row.lastSendSuccessAt !== 'string' || !Number.isFinite(Date.parse(row.lastSendSuccessAt))))
        || (row.pollDegraded !== undefined && typeof row.pollDegraded !== 'boolean')
        || (row.sendDegraded !== undefined && typeof row.sendDegraded !== 'boolean')
        || (row.endedAt === undefined) !== (row.result === undefined)) {
        throw new Error('Invalid Teams attempt history');
    }
    const events = (row.events as Array<TeamsAttemptEvent & { reason?: TeamsSkipReason }> | undefined ?? []).map(e => ({
        at: e.at, type: e.type,
        ...((e.category ?? e.reason) ? { category: e.category ?? e.reason } : {}),
    }));
    const totals: Record<string, number> = row.totals
        ? Object.fromEntries(Object.entries(row.totals))
        : { 'poll-success': row.pollSuccessCount as number | undefined ?? 0 };
    if (!row.totals) {
        for (const event of events) totals[event.type] = (totals[event.type] ?? 0) + 1;
    }
    return {
        id: row.id,
        startedAt: row.startedAt,
        phases: row.phases.map((p: { stage: TeamsAttemptStage; at: string }) => ({ stage: p.stage, at: p.at })),
        ...(row.endedAt ? { endedAt: row.endedAt as string, result: row.result as TeamsAttemptResult } : {}),
        ...(row.failureCategory ? { failureCategory: row.failureCategory as TeamsFailureCategory } : {}),
        events,
        totals,
        pollSuccessCount: row.pollSuccessCount as number | undefined ?? 0,
        ...(row.lastPollSuccessAt ? { lastPollSuccessAt: row.lastPollSuccessAt as string } : {}),
        ...(row.lastSendSuccessAt ? { lastSendSuccessAt: row.lastSendSuccessAt as string } : {}),
        pollDegraded: row.pollDegraded as boolean | undefined ?? false,
        sendDegraded: row.sendDegraded as boolean | undefined ?? false,
    };
}

/** Server-global, privacy-allowlisted history of normal Teams bridge connections. */
export class TeamsAttemptStore {
    private readonly filePath: string;
    private attempts: StoredAttempt[] = [];
    private activeId: string | null = null;

    constructor(dataDir: string, private readonly now: () => Date = () => new Date()) {
        this.filePath = path.join(dataDir, 'teams-attempts.json');
        let normalized = false;
        if (fs.existsSync(this.filePath)) {
            const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            if (!Array.isArray(parsed)) throw new Error('Invalid Teams attempt history');
            this.attempts = parsed.map(readAttempt);
            normalized = JSON.stringify(parsed) !== JSON.stringify(this.attempts);
        }
        const interruptedAt = this.now().toISOString();
        let recovered = false;
        for (const attempt of this.attempts) {
            if (!attempt.endedAt) {
                attempt.endedAt = interruptedAt;
                attempt.result = 'interrupted';
                recovered = true;
            }
        }
        if (this.prune() || recovered || normalized) this.save();
    }

    list(): TeamsAttempt[] {
        return this.attempts.map(a => ({
            id: a.id, startedAt: a.startedAt, phases: a.phases.map(p => ({ stage: p.stage, at: p.at })),
            stage: a.phases[a.phases.length - 1].stage,
            ...(a.endedAt ? { endedAt: a.endedAt, result: a.result } : {}),
            ...(a.failureCategory ? { failureCategory: a.failureCategory } : {}),
            events: a.events.map(e => ({ at: e.at, type: e.type, ...(e.category ? { category: e.category } : {}) })),
            totals: { ...a.totals },
            pollSuccessCount: a.pollSuccessCount,
            ...(a.lastPollSuccessAt ? { lastPollSuccessAt: a.lastPollSuccessAt } : {}),
            ...(a.lastSendSuccessAt ? { lastSendSuccessAt: a.lastSendSuccessAt } : {}),
            pollDegraded: a.pollDegraded, sendDegraded: a.sendDegraded,
            degraded: a.pollDegraded || a.sendDegraded,
        }));
    }

    start(): string {
        if (this.activeId) this.finish(this.activeId, 'superseded');
        const id = randomUUID();
        const at = this.now().toISOString();
        this.attempts.unshift({ id, startedAt: at, phases: [{ stage: 'started', at }],
            events: [], totals: {}, pollSuccessCount: 0, pollDegraded: false, sendDegraded: false });
        this.activeId = id;
        this.prune();
        this.save();
        return id;
    }

    phase(id: string, stage: Exclude<TeamsAttemptStage, 'started'>): void {
        const attempt = this.getActive(id);
        if (!attempt) return;
        attempt.phases.push({ stage, at: this.now().toISOString() });
        this.save();
    }

    finish(id: string, result: TeamsAttemptResult, category?: TeamsFailureCategory): void {
        const attempt = this.getActive(id);
        if (!attempt) return;
        attempt.endedAt = this.now().toISOString();
        attempt.result = result;
        if (category) attempt.failureCategory = category;
        this.activeId = null;
        this.prune();
        this.save();
    }

    poll(id: string, outcome: 'success' | 'failure'): void {
        const attempt = this.getActive(id);
        if (!attempt) return;
        if (outcome === 'success') {
            attempt.pollSuccessCount = Math.min(Number.MAX_SAFE_INTEGER, attempt.pollSuccessCount + 1);
            this.increment(attempt, 'poll-success');
            attempt.lastPollSuccessAt = this.now().toISOString();
            attempt.pollDegraded = false;
        } else {
            attempt.pollDegraded = true;
            this.append(attempt, 'poll-failed');
        }
        this.save();
    }

    send(id: string, outcome: 'accepted' | 'rejected'): void {
        const attempt = this.getActive(id);
        if (!attempt) return;
        attempt.sendDegraded = outcome === 'rejected';
        if (outcome === 'accepted') attempt.lastSendSuccessAt = this.now().toISOString();
        this.append(attempt, outcome === 'accepted' ? 'reply-accepted' : 'reply-rejected');
        this.save();
    }

    event(id: string, type: TeamsEventType, reason?: TeamsSkipReason): void {
        const attempt = this.getActive(id);
        if (!attempt || !EVENTS.includes(type)) return;
        this.append(attempt, type, type === 'inbound-skipped' && reason && SKIP_REASONS.includes(reason) ? reason : undefined);
        this.save();
    }

    private append(attempt: StoredAttempt, type: TeamsEventType, category?: TeamsSkipReason): void {
        attempt.events.push({ at: this.now().toISOString(), type, ...(category ? { category } : {}) });
        this.increment(attempt, type);
        if (attempt.events.length > MAX_EVENTS) attempt.events.shift();
    }

    private increment(attempt: StoredAttempt, key: string): void {
        attempt.totals[key] = Math.min(Number.MAX_SAFE_INTEGER, (attempt.totals[key] ?? 0) + 1);
    }

    private getActive(id: string): StoredAttempt | undefined {
        return this.activeId === id ? this.attempts.find(a => a.id === id) : undefined;
    }

    private prune(): boolean {
        const previous = this.attempts.length;
        const cutoff = this.now().getTime() - RETENTION_MS;
        let completed = 0;
        this.attempts = this.attempts.filter(a =>
            !a.endedAt || (Date.parse(a.endedAt) >= cutoff && ++completed <= MAX_COMPLETED));
        return this.attempts.length !== previous;
    }

    private save(): void {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temporary = `${this.filePath}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporary, JSON.stringify(this.attempts));
            fs.renameSync(temporary, this.filePath);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    }
}
