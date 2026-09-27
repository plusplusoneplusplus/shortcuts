import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type TeamsAttemptStage = 'started' | 'authenticating' | 'resolving' | 'starting-polling' | 'connected';
export type TeamsAttemptResult = 'disconnected' | 'superseded' | 'failed' | 'interrupted';
export type TeamsFailureCategory = 'configuration' | 'authentication' | 'resolution' | 'polling' | 'unknown';

export interface TeamsAttempt {
    id: string;
    startedAt: string;
    phases: Array<{ stage: TeamsAttemptStage; at: string }>;
    endedAt?: string;
    result?: TeamsAttemptResult;
    failureCategory?: TeamsFailureCategory;
}

const STAGES: TeamsAttemptStage[] = ['started', 'authenticating', 'resolving', 'starting-polling', 'connected'];
const RESULTS: TeamsAttemptResult[] = ['disconnected', 'superseded', 'failed', 'interrupted'];
const CATEGORIES: TeamsFailureCategory[] = ['configuration', 'authentication', 'resolution', 'polling', 'unknown'];
const MAX_COMPLETED = 200;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function readAttempt(value: unknown): TeamsAttempt {
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
        || (row.endedAt === undefined) !== (row.result === undefined)) {
        throw new Error('Invalid Teams attempt history');
    }
    return {
        id: row.id,
        startedAt: row.startedAt,
        phases: row.phases.map((p: { stage: TeamsAttemptStage; at: string }) => ({ stage: p.stage, at: p.at })),
        ...(row.endedAt ? { endedAt: row.endedAt as string, result: row.result as TeamsAttemptResult } : {}),
        ...(row.failureCategory ? { failureCategory: row.failureCategory as TeamsFailureCategory } : {}),
    };
}

/** Server-global, privacy-allowlisted history of normal Teams bridge connections. */
export class TeamsAttemptStore {
    private readonly filePath: string;
    private attempts: TeamsAttempt[] = [];
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
        return this.attempts.map(a => ({ ...a, phases: a.phases.map(p => ({ ...p })) }));
    }

    start(): string {
        if (this.activeId) this.finish(this.activeId, 'superseded');
        const id = randomUUID();
        const at = this.now().toISOString();
        this.attempts.unshift({ id, startedAt: at, phases: [{ stage: 'started', at }] });
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

    private getActive(id: string): TeamsAttempt | undefined {
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
