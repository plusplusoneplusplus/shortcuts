/**
 * RalphSessionStore — file-backed journal for one Ralph session.
 *
 * Layout under `~/.coc/repos/<workspaceId>/ralph-sessions/<sessionId>/`:
 *
 *   progress.md   — append-only Markdown journal, AI-writable
 *   session.json  — small metadata document (atomic write-temp + rename)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    formatProgressSection,
    parseProgressSections as parsePortableProgressSections,
} from '@plusplusoneplusplus/coc-workflow/ralph';
import { getRepoDataPath } from '../paths';
import type {
    ParsedProgressSection,
    RalphExitSignal,
    RalphFinalCheckRecord,
    RalphLoopRecord,
    RalphSessionRecord,
} from './types';

const SESSIONS_DIR = 'ralph-sessions';
const PROGRESS_FILE = 'progress.md';
const RECORD_FILE = 'session.json';

const PROGRESS_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const PROGRESS_TRUNCATE_KEEP_BYTES = 500 * 1024; // 500 KB

export interface RalphSessionStoreOptions {
    dataDir: string;
}

export interface RalphSessionFile {
    name: string;
    content: string;
}

export interface InitSessionInput {
    originalGoal: string;
    maxIterations: number;
    startedAt?: string;
}

export interface AppendProgressInput {
    iteration: number;
    signal: RalphExitSignal;
    timestamp?: string;
    body: string;
}

export class RalphSessionStore {
    constructor(private readonly options: RalphSessionStoreOptions) {}

    getSessionDir(workspaceId: string, sessionId: string): string {
        return getRepoDataPath(
            this.options.dataDir,
            workspaceId,
            path.join(SESSIONS_DIR, sessionId),
        );
    }

    getProgressPath(workspaceId: string, sessionId: string): string {
        return path.join(this.getSessionDir(workspaceId, sessionId), PROGRESS_FILE);
    }

    getSessionRecordPath(workspaceId: string, sessionId: string): string {
        return path.join(this.getSessionDir(workspaceId, sessionId), RECORD_FILE);
    }

    /**
     * Idempotent. Creates the session directory and seeds `session.json`
     * (and an empty `progress.md` header) if they do not already exist.
     */
    async initSession(
        workspaceId: string,
        sessionId: string,
        init: InitSessionInput,
    ): Promise<void> {
        const dir = this.getSessionDir(workspaceId, sessionId);
        await fs.promises.mkdir(dir, { recursive: true });

        const recordPath = this.getSessionRecordPath(workspaceId, sessionId);
        const progressPath = this.getProgressPath(workspaceId, sessionId);
        const startedAt = init.startedAt ?? new Date().toISOString();

        if (!(await pathExists(recordPath))) {
            const record: RalphSessionRecord = {
                sessionId,
                workspaceId,
                originalGoal: init.originalGoal,
                maxIterations: init.maxIterations,
                currentIteration: 0,
                phase: 'executing',
                startedAt,
                iterations: [],
            };
            await this.atomicWriteJson(recordPath, record);
        }

        if (!(await pathExists(progressPath))) {
            const goalPreview = singleLine(init.originalGoal);
            const header = `# Ralph Session: ${sessionId}\nGoal: ${goalPreview}\nStarted: ${startedAt}\n`;
            await fs.promises.writeFile(progressPath, header, 'utf-8');
        }
    }

    /**
     * Append a `## Iteration N — SIGNAL — TIMESTAMP` block to `progress.md`.
     */
    async appendProgressSection(
        workspaceId: string,
        sessionId: string,
        section: AppendProgressInput,
    ): Promise<void> {
        const dir = this.getSessionDir(workspaceId, sessionId);
        await fs.promises.mkdir(dir, { recursive: true });

        const progressPath = this.getProgressPath(workspaceId, sessionId);
        const timestamp = section.timestamp ?? new Date().toISOString();
        const block = `\n${formatProgressSection({
            iteration: section.iteration,
            signal: section.signal,
            timestamp,
            body: section.body,
        })}`;

        await fs.promises.appendFile(progressPath, block, 'utf-8');
        await this.enforceSizeCap(progressPath);
    }

    async readProgress(workspaceId: string, sessionId: string): Promise<string> {
        const p = this.getProgressPath(workspaceId, sessionId);
        try {
            return await fs.promises.readFile(p, 'utf-8');
        } catch (err: any) {
            if (err?.code === 'ENOENT') return '';
            throw err;
        }
    }

    async readSessionFiles(workspaceId: string, sessionId: string): Promise<RalphSessionFile[]> {
        const dir = this.getSessionDir(workspaceId, sessionId);
        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (err: any) {
            if (err?.code === 'ENOENT') return [];
            throw err;
        }

        const fileNames = entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .sort();

        return Promise.all(fileNames.map(async (name) => ({
            name,
            content: await fs.promises.readFile(path.join(dir, name), 'utf-8'),
        })));
    }

    async readSessionRecord(
        workspaceId: string,
        sessionId: string,
    ): Promise<RalphSessionRecord | null> {
        const p = this.getSessionRecordPath(workspaceId, sessionId);
        let raw: string;
        try {
            raw = await fs.promises.readFile(p, 'utf-8');
        } catch (err: any) {
            if (err?.code === 'ENOENT') return null;
            throw err;
        }
        try {
            return normaliseSessionRecord(JSON.parse(raw));
        } catch {
            return null;
        }
    }

    /**
     * Load → mutate → atomic-write rename. Returns the final record.
     */
    async updateSessionRecord(
        workspaceId: string,
        sessionId: string,
        mutator: (rec: RalphSessionRecord | null) => RalphSessionRecord,
    ): Promise<RalphSessionRecord> {
        const dir = this.getSessionDir(workspaceId, sessionId);
        await fs.promises.mkdir(dir, { recursive: true });

        const current = await this.readSessionRecord(workspaceId, sessionId);
        const next = mutator(current);
        await this.atomicWriteJson(this.getSessionRecordPath(workspaceId, sessionId), next);
        return next;
    }

    /**
     * Has the journal file's mtime advanced past the given threshold?
     */
    async progressMtimeAfter(
        workspaceId: string,
        sessionId: string,
        thresholdMs: number,
    ): Promise<boolean> {
        const p = this.getProgressPath(workspaceId, sessionId);
        try {
            const stat = await fs.promises.stat(p);
            return stat.mtimeMs > thresholdMs;
        } catch {
            return false;
        }
    }

    static parseProgressSections(progressMd: string): ParsedProgressSection[] {
        return parseProgressSections(progressMd);
    }

    /**
     * Extend an existing session's iteration cap. Resets the session to
     * `executing` phase and clears the previous terminal markers so the
     * loop can resume from `currentIteration + 1`.
     *
     * Returns the updated record. Throws if the session does not exist.
     */
    async extendSession(
        workspaceId: string,
        sessionId: string,
        addBy: number,
        nowIso?: string,
    ): Promise<RalphSessionRecord> {
        if (!Number.isInteger(addBy) || addBy <= 0) {
            throw new Error(`extendSession: addBy must be a positive integer, got ${addBy}`);
        }
        const existing = await this.readSessionRecord(workspaceId, sessionId);
        if (!existing) {
            throw new Error(`Ralph session ${sessionId} not found in workspace ${workspaceId}`);
        }
        const newMax = existing.maxIterations + addBy;
        return this.updateSessionRecord(workspaceId, sessionId, (rec) => {
            const base = rec ?? existing;
            const next: RalphSessionRecord = { ...base };
            next.maxIterations = newMax;
            next.phase = 'executing';
            delete next.completedAt;
            delete next.terminalReason;
            return next;
        });
    }

    /**
     * Start a new loop inside an existing session that has completed with
     * `RALPH_COMPLETE`.
     *
     * 1. Validates `phase === complete` + `terminalReason === RALPH_COMPLETE`.
     * 2. Lazily populates `loops[]` from the session's `originalGoal` if absent.
     * 3. Appends a new `RalphLoopRecord` for the new goal.
     * 4. Resets the session to `executing` phase and bumps `maxIterations`.
     * 5. Appends a loop banner to `progress.md`.
     *
     * Throws with `statusCode: 404` if the session is missing.
     * Throws with `statusCode: 409` if the session is not in a new-loop eligible state.
     */
    async startNewLoop(
        workspaceId: string,
        sessionId: string,
        newGoal: string,
        additionalIterations: number,
        nowIso?: string,
    ): Promise<RalphSessionRecord> {
        const existing = await this.readSessionRecord(workspaceId, sessionId);
        if (!existing) {
            const err = new Error(
                `Ralph session ${sessionId} not found in workspace ${workspaceId}`,
            );
            (err as any).statusCode = 404;
            throw err;
        }

        if (existing.phase !== 'complete' || existing.terminalReason !== 'RALPH_COMPLETE') {
            const reason = existing.phase !== 'complete'
                ? `Session phase is "${existing.phase}"; new-loop requires phase=complete`
                : `Session terminalReason is "${existing.terminalReason}"; new-loop requires RALPH_COMPLETE`;
            const err = new Error(reason);
            (err as any).statusCode = 409;
            throw err;
        }

        const ts = nowIso ?? new Date().toISOString();

        // Lazily build loops[] from the session's originalGoal if absent.
        const currentLoops: RalphLoopRecord[] = existing.loops ?? [{
            loopIndex: 1,
            goal: existing.originalGoal,
            startIteration: 1,
            endIteration: existing.currentIteration,
            terminalReason: existing.terminalReason,
            startedAt: existing.startedAt,
            completedAt: existing.completedAt,
        }];

        const newLoopIndex = currentLoops.length + 1;
        const newLoop: RalphLoopRecord = {
            loopIndex: newLoopIndex,
            goal: newGoal,
            startIteration: existing.currentIteration + 1,
            startedAt: ts,
        };
        const updatedLoops = [...currentLoops, newLoop];

        const updated = await this.updateSessionRecord(workspaceId, sessionId, (rec) => {
            const base = rec ?? existing;
            const next: RalphSessionRecord = { ...base };
            next.phase = 'executing';
            next.maxIterations = base.maxIterations + additionalIterations;
            delete next.completedAt;
            delete next.terminalReason;
            next.loops = updatedLoops;
            return next;
        });

        try {
            await this.appendNewLoopBanner(workspaceId, sessionId, newLoopIndex, newGoal, ts);
        } catch {
            // Banner failure is cosmetic; loop proceeds correctly without it.
        }

        return updated;
    }

    /**
     * Append a "Loop N — <ts>" banner to `progress.md`.
     * Idempotent: re-running with an identical `(loopIndex, ts)` pair skips
     * the write if the tail already contains the same marker.
     */
    private async appendNewLoopBanner(
        workspaceId: string,
        sessionId: string,
        loopIndex: number,
        goal: string,
        nowIso: string,
    ): Promise<void> {
        const dir = this.getSessionDir(workspaceId, sessionId);
        await fs.promises.mkdir(dir, { recursive: true });
        const progressPath = this.getProgressPath(workspaceId, sessionId);
        const goalPreview = goal.length > 200 ? `${goal.slice(0, 200)}…` : goal;
        const marker = `\n---\n## Loop ${loopIndex} — ${nowIso}\nGoal: ${goalPreview}\n`;

        try {
            const stat = await fs.promises.stat(progressPath);
            const readBytes = Math.min(stat.size, 1024);
            if (readBytes > 0) {
                const fd = await fs.promises.open(progressPath, 'r');
                try {
                    const buf = Buffer.alloc(readBytes);
                    await fd.read(buf, 0, readBytes, stat.size - readBytes);
                    const tail = buf.toString('utf-8');
                    if (tail.includes(`## Loop ${loopIndex} — ${nowIso}`)) {
                        return;
                    }
                } finally {
                    await fd.close();
                }
            }
        } catch {
            // Missing file — fall through and append (which will create it).
        }

        await fs.promises.appendFile(progressPath, marker, 'utf-8');
    }

    /**
     * Append a "Loop continued at <ts> — extending to <newMax>" banner to
     * `progress.md`. Idempotent against double-appends within the same
     * tick — re-running with an identical `(newMax, timestamp)` pair will
     * skip if the most recent line already matches.
     */
    async appendContinuationMarker(
        workspaceId: string,
        sessionId: string,
        newMax: number,
        nowIso?: string,
    ): Promise<void> {
        const dir = this.getSessionDir(workspaceId, sessionId);
        await fs.promises.mkdir(dir, { recursive: true });
        const progressPath = this.getProgressPath(workspaceId, sessionId);
        const ts = nowIso ?? new Date().toISOString();
        const marker = `\n---\n## Loop continued at ${ts} — extending to ${newMax}\n`;

        // Idempotency: skip if the tail already contains an identical marker
        // for this newMax in the last 1 KB. Cheaply guards against accidental
        // double-appends from concurrent continue requests.
        try {
            const stat = await fs.promises.stat(progressPath);
            const readBytes = Math.min(stat.size, 1024);
            if (readBytes > 0) {
                const fd = await fs.promises.open(progressPath, 'r');
                try {
                    const buf = Buffer.alloc(readBytes);
                    await fd.read(buf, 0, readBytes, stat.size - readBytes);
                    const tail = buf.toString('utf-8');
                    if (tail.includes(`## Loop continued at ${ts} — extending to ${newMax}`)) {
                        return;
                    }
                } finally {
                    await fd.close();
                }
            }
        } catch {
            // Missing file — fall through and append (which will create it).
        }

        await fs.promises.appendFile(progressPath, marker, 'utf-8');
    }

    /**
     * Append a "Session resumed at <ts> — picking up from iteration <N>" banner
     * to `progress.md`. Idempotent against double-appends within the same tick.
     */
    async appendResumeMarker(
        workspaceId: string,
        sessionId: string,
        lastIteration: number,
        nowIso?: string,
    ): Promise<void> {
        const dir = this.getSessionDir(workspaceId, sessionId);
        await fs.promises.mkdir(dir, { recursive: true });
        const progressPath = this.getProgressPath(workspaceId, sessionId);
        const ts = nowIso ?? new Date().toISOString();
        const marker = `\n---\n## Session resumed at ${ts} — picking up from iteration ${lastIteration}\n`;

        try {
            const stat = await fs.promises.stat(progressPath);
            const readBytes = Math.min(stat.size, 1024);
            if (readBytes > 0) {
                const fd = await fs.promises.open(progressPath, 'r');
                try {
                    const buf = Buffer.alloc(readBytes);
                    await fd.read(buf, 0, readBytes, stat.size - readBytes);
                    const tail = buf.toString('utf-8');
                    if (tail.includes(`## Session resumed at ${ts} — picking up from iteration ${lastIteration}`)) {
                        return;
                    }
                } finally {
                    await fd.close();
                }
            }
        } catch {
            // Missing file — fall through and append (which will create it).
        }

        await fs.promises.appendFile(progressPath, marker, 'utf-8');
    }

    /**
     * Append a final-check section to `progress.md`.
     *
     * The `content` is raw Markdown. The caller is responsible for formatting
     * (heading, status, gap list, etc.). The content is appended with a leading
     * newline separator so sections remain visually distinct.
     */
    async appendFinalCheckSection(
        workspaceId: string,
        sessionId: string,
        content: string,
    ): Promise<void> {
        const dir = this.getSessionDir(workspaceId, sessionId);
        await fs.promises.mkdir(dir, { recursive: true });
        const progressPath = this.getProgressPath(workspaceId, sessionId);
        const block = `\n${content.trim()}\n`;
        await fs.promises.appendFile(progressPath, block, 'utf-8');
        await this.enforceSizeCap(progressPath);
    }

    /**
     * Add or update a `RalphFinalCheckRecord` in `session.json`.
     *
     * - If `finalChecks` is absent (legacy session), it is initialised as `[]`.
     * - If a record with `checkIndex` already exists, it is replaced.
     * - Otherwise the record is appended.
     *
     * Returns the updated session record.
     */
    async upsertFinalCheckRecord(
        workspaceId: string,
        sessionId: string,
        checkIndex: number,
        partial: Partial<RalphFinalCheckRecord> & Pick<RalphFinalCheckRecord, 'status'>,
    ): Promise<RalphSessionRecord> {
        return this.updateSessionRecord(workspaceId, sessionId, (rec) => {
            const base = rec ?? {
                sessionId,
                workspaceId,
                originalGoal: '',
                maxIterations: 0,
                currentIteration: 0,
                phase: 'complete' as const,
                startedAt: new Date().toISOString(),
                iterations: [],
            };
            const existing = base.finalChecks ?? [];
            const idx = existing.findIndex(c => c.checkIndex === checkIndex);
            const updated: RalphFinalCheckRecord = {
                checkIndex,
                loopIndex: partial.loopIndex ?? 1,
                sourceIteration: partial.sourceIteration ?? 0,
                startedAt: partial.startedAt ?? new Date().toISOString(),
                ...partial,
            };
            const next = [...existing];
            if (idx >= 0) {
                next[idx] = { ...next[idx], ...updated };
            } else {
                next.push(updated);
            }
            return { ...base, finalChecks: next };
        });
    }

    private async atomicWriteJson(filePath: string, value: unknown): Promise<void> {
        const dir = path.dirname(filePath);
        await fs.promises.mkdir(dir, { recursive: true });
        const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const json = JSON.stringify(value, null, 2);
        await fs.promises.writeFile(tmp, json, 'utf-8');
        try {
            await fs.promises.rename(tmp, filePath);
        } catch (err) {
            try { await fs.promises.unlink(tmp); } catch { /* ignore */ }
            throw err;
        }
    }

    /**
     * Defensive cap: if `progress.md` exceeds PROGRESS_MAX_BYTES, keep
     * only the last PROGRESS_TRUNCATE_KEEP_BYTES with a banner note.
     */
    private async enforceSizeCap(progressPath: string): Promise<void> {
        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(progressPath);
        } catch {
            return;
        }
        if (stat.size <= PROGRESS_MAX_BYTES) return;

        const fd = await fs.promises.open(progressPath, 'r');
        try {
            const start = Math.max(0, stat.size - PROGRESS_TRUNCATE_KEEP_BYTES);
            const length = stat.size - start;
            const buf = Buffer.alloc(length);
            await fd.read(buf, 0, length, start);
            const tail = buf.toString('utf-8');
            const banner = `# Ralph Session (truncated)\n[earlier content removed; original size ${stat.size} bytes]\n\n`;
            await fs.promises.writeFile(progressPath, banner + tail, 'utf-8');
        } finally {
            await fd.close();
        }
    }
}

// ============================================================================
// Normalisation — read-time migration shim
// ============================================================================

/**
 * Normalise a raw deserialized `session.json` object.
 *
 * Handles pre-existing records that lack `loopIndex` on iteration entries:
 * those iterations are treated as belonging to loop 1.
 *
 * No file writes are triggered — normalisation is applied in memory only.
 */
export function normaliseSessionRecord(raw: unknown): RalphSessionRecord {
    const rec = raw as RalphSessionRecord;
    if (!rec || typeof rec !== 'object') return rec;

    if (Array.isArray(rec.iterations)) {
        rec.iterations = rec.iterations.map(iter =>
            (iter as any).loopIndex == null
                ? { ...iter, loopIndex: 1 }
                : iter,
        );
    }

    return rec;
}

// ============================================================================
// Pure helpers
// ============================================================================

async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.promises.access(p, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function singleLine(text: string): string {
    const first = text.split(/\r?\n/, 1)[0] ?? '';
    return first.length > 240 ? `${first.slice(0, 237)}...` : first;
}

export function parseProgressSections(progressMd: string): ParsedProgressSection[] {
    return parsePortableProgressSections(progressMd);
}
