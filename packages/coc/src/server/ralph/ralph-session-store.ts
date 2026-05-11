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
import { getRepoDataPath } from '../paths';
import type {
    ParsedProgressSection,
    RalphExitSignal,
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
        const body = section.body.trim();
        const header = `## Iteration ${section.iteration} — ${section.signal} — ${timestamp}`;
        const block = `\n${header}\n${body}${body.endsWith('\n') ? '' : '\n'}`;

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
            return JSON.parse(raw) as RalphSessionRecord;
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

const SECTION_HEADER = /^##\s+Iteration\s+(\d+)\s+[—\-]\s+(RALPH_NEXT|RALPH_COMPLETE|NONE)\s+[—\-]\s+(\S+?)\s*$/;

export function parseProgressSections(progressMd: string): ParsedProgressSection[] {
    const lines = progressMd.replace(/\r\n/g, '\n').split('\n');
    const sections: ParsedProgressSection[] = [];

    let current: ParsedProgressSection | null = null;
    let bodyLines: string[] = [];

    const flush = () => {
        if (!current) return;
        current.body = bodyLines.join('\n').trim();
        sections.push(current);
        current = null;
        bodyLines = [];
    };

    for (const line of lines) {
        const m = SECTION_HEADER.exec(line);
        if (m) {
            flush();
            current = {
                iteration: Number(m[1]),
                signal: m[2] as RalphExitSignal,
                timestamp: m[3],
                body: '',
            };
            continue;
        }
        if (current) bodyLines.push(line);
    }
    flush();

    return sections;
}
