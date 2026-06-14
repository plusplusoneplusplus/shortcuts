import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    ClaudeNativeSessionProvider,
    CodexNativeSessionProvider,
    dashEncodeWorkspaceRoot,
} from '../../src/server/native-copilot-sessions/native-cli-session-service';

let tmpDir: string;

function line(value: unknown): string {
    return JSON.stringify(value);
}

function writeJsonl(filePath: string, records: unknown[]): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, records.map(line).join('\n'), 'utf8');
}

function dashEncode(rootPath: string): string {
    return path.resolve(rootPath).replace(/\\/g, '/').replace(/[/:]/g, '-');
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-cli-sessions-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('dashEncodeWorkspaceRoot', () => {
    it('returns undefined when no root is provided', () => {
        expect(dashEncodeWorkspaceRoot(undefined)).toBeUndefined();
        expect(dashEncodeWorkspaceRoot('')).toBeUndefined();
    });

    it('encodes to a single path segment with no separators or colons', () => {
        // Regression: Windows drive-letter roots (C:\...) previously kept their
        // colon, yielding an invalid path segment that broke directory reads.
        const encoded = dashEncodeWorkspaceRoot(path.join(tmpDir, 'repo'));
        expect(encoded).toBeDefined();
        expect(encoded!).not.toMatch(/[:/\\]/);
    });

    it('strips the drive-letter colon from the encoded folder name', () => {
        expect(dashEncodeWorkspaceRoot('/home/runner/C:fakepath')).not.toContain(':');
    });
});

describe('CodexNativeSessionProvider', () => {
    it('lists workspace-scoped rollout sessions with filters, pagination, text snippets, and dedup', () => {
        const workspaceRoot = path.join(tmpDir, 'repo');
        const storePath = path.join(tmpDir, 'codex', 'sessions');
        const inScope = path.join(storePath, '2026', '06', '13', 'rollout-2026-06-13T10-00-00-codex-1.jsonl');
        const deduped = path.join(storePath, '2026', '06', '13', 'rollout-2026-06-13T11-00-00-codex-dedup.jsonl');
        const outOfScope = path.join(storePath, '2026', '06', '13', 'rollout-2026-06-13T12-00-00-codex-out.jsonl');

        writeJsonl(inScope, [
            { timestamp: '2026-06-13T10:00:00.000Z', type: 'session_meta', payload: { id: 'codex-1', cwd: workspaceRoot, timestamp: '2026-06-13T10:00:00.000Z', git: { branch: 'main' } } },
            { timestamp: '2026-06-13T10:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5.1-codex' } },
            { timestamp: '2026-06-13T10:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Find the billing regression' }] } },
            { timestamp: '2026-06-13T10:00:03.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I found it.' }] } },
        ]);
        writeJsonl(deduped, [
            { timestamp: '2026-06-13T11:00:00.000Z', type: 'session_meta', payload: { id: 'codex-dedup', cwd: path.join(workspaceRoot, 'pkg'), timestamp: '2026-06-13T11:00:00.000Z', git: { branch: 'main' } } },
            { timestamp: '2026-06-13T11:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'already tracked' }] } },
        ]);
        writeJsonl(outOfScope, [
            { timestamp: '2026-06-13T12:00:00.000Z', type: 'session_meta', payload: { id: 'codex-out', cwd: path.join(tmpDir, 'other'), timestamp: '2026-06-13T12:00:00.000Z', git: { branch: 'main' } } },
            { timestamp: '2026-06-13T12:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'outside' }] } },
        ]);
        fs.utimesSync(inScope, new Date('2026-06-13T10:05:00.000Z'), new Date('2026-06-13T10:05:00.000Z'));
        fs.utimesSync(deduped, new Date('2026-06-13T11:05:00.000Z'), new Date('2026-06-13T11:05:00.000Z'));
        fs.utimesSync(outOfScope, new Date('2026-06-13T12:05:00.000Z'), new Date('2026-06-13T12:05:00.000Z'));

        const provider = new CodexNativeSessionProvider({ storePath });
        const result = provider.listSessions(
            { rootPath: workspaceRoot },
            {
                q: 'billing regression',
                branch: 'main',
                sessionId: 'codex',
                limit: 1,
                offset: 0,
                excludeSessionIds: new Set(['codex-dedup']),
            },
        );

        expect(result.available).toBe(true);
        if (!result.available) return;
        expect(result.total).toBe(1);
        expect(result.deduplicatedCount).toBe(1);
        expect(result.searchIndexAvailable).toBe(false);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            id: 'codex-1',
            provider: 'codex',
            cwd: workspaceRoot,
            branch: 'main',
            hostType: 'codex',
            summaryPreview: 'Find the billing regression',
            turnCount: 2,
            storePath,
            searchIndexAvailable: false,
        });
        expect(result.items[0].matchSnippets[0]).toContain('billing regression');
    });

    it('returns reconstructed detail and null for out-of-workspace IDs', () => {
        const workspaceRoot = path.join(tmpDir, 'repo');
        const storePath = path.join(tmpDir, 'codex', 'sessions');
        writeJsonl(path.join(storePath, '2026', '06', '13', 'rollout-2026-06-13T10-00-00-codex-detail.jsonl'), [
            { timestamp: '2026-06-13T10:00:00.000Z', type: 'session_meta', payload: { id: 'codex-detail', cwd: workspaceRoot, timestamp: '2026-06-13T10:00:00.000Z' } },
            { timestamp: '2026-06-13T10:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Ready.' }] } },
        ]);

        const provider = new CodexNativeSessionProvider({ storePath });
        const detail = provider.getSession({ rootPath: workspaceRoot }, 'codex-detail');

        expect(detail.available).toBe(true);
        if (!detail.available) return;
        expect(detail.session?.provider).toBe('codex');
        expect(detail.session?.conversation).toHaveLength(1);
        expect(detail.session?.conversation[0].content).toBe('Ready.');
        expect(provider.getSession({ rootPath: path.join(tmpDir, 'other') }, 'codex-detail')).toEqual({
            available: true,
            session: null,
        });
    });

    it('returns store-missing for absent Codex stores', () => {
        const provider = new CodexNativeSessionProvider({ storePath: path.join(tmpDir, 'missing') });

        expect(provider.listSessions({ rootPath: tmpDir }).available).toBe(false);
        expect(provider.getSession({ rootPath: tmpDir }, 'any')).toEqual({ available: false, reason: 'store-missing' });
    });

    it('returns store-invalid when the configured store path is not a directory', () => {
        const storePath = path.join(tmpDir, 'codex-store-file');
        fs.writeFileSync(storePath, 'not a directory', 'utf8');
        const provider = new CodexNativeSessionProvider({ storePath });

        expect(provider.listSessions({ rootPath: tmpDir })).toMatchObject({ available: false, reason: 'store-invalid' });
        expect(provider.getSession({ rootPath: tmpDir }, 'any')).toEqual({ available: false, reason: 'store-invalid' });
    });
});

describe('ClaudeNativeSessionProvider', () => {
    it('scopes projects by dash-encoded workspace folder and confirms transcript cwd', () => {
        const workspaceRoot = path.join(tmpDir, 'repo');
        const storePath = path.join(tmpDir, 'claude', 'projects');
        const encodedFolder = path.join(storePath, dashEncode(workspaceRoot));
        writeJsonl(path.join(encodedFolder, 'claude-1.jsonl'), [
            { type: 'user', sessionId: 'claude-1', cwd: workspaceRoot, gitBranch: 'feature/native-cli', timestamp: '2026-06-13T09:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Review Claude transcript' }] } },
            { type: 'assistant', sessionId: 'claude-1', cwd: workspaceRoot, timestamp: '2026-06-13T09:00:01.000Z', message: { role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'Transcript reviewed.' }] } },
        ]);
        writeJsonl(path.join(encodedFolder, 'claude-wrong-cwd.jsonl'), [
            { type: 'user', sessionId: 'claude-wrong-cwd', cwd: path.join(tmpDir, 'other'), timestamp: '2026-06-13T09:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'wrong cwd' }] } },
        ]);
        writeJsonl(path.join(encodedFolder, 'claude-mixed-cwd.jsonl'), [
            { type: 'user', sessionId: 'claude-mixed-cwd', cwd: workspaceRoot, gitBranch: 'feature/native-cli', timestamp: '2026-06-13T09:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'mixed cwd transcript' }] } },
            { type: 'assistant', sessionId: 'claude-mixed-cwd', cwd: path.join(tmpDir, 'other'), timestamp: '2026-06-13T09:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'escaped cwd' }] } },
        ]);

        const provider = new ClaudeNativeSessionProvider({ storePath });
        const result = provider.listSessions({ rootPath: workspaceRoot }, { q: 'transcript', branch: 'feature/native-cli' });

        expect(result.available).toBe(true);
        if (!result.available) return;
        expect(result.total).toBe(1);
        expect(result.items[0]).toMatchObject({
            id: 'claude-1',
            provider: 'claude',
            cwd: workspaceRoot,
            branch: 'feature/native-cli',
            hostType: 'claude',
            summaryPreview: 'Review Claude transcript',
            turnCount: 2,
        });
        expect(result.items[0].matchSnippets[0]).toContain('transcript');
        const mixedDetail = provider.getSession({ rootPath: workspaceRoot }, 'claude-mixed-cwd');
        expect(mixedDetail).toEqual({ available: true, session: null });
    });

    it('collapses duplicate transcript files with the same session id to the newest record', () => {
        const workspaceRoot = path.join(tmpDir, 'repo');
        const storePath = path.join(tmpDir, 'claude', 'projects');
        const encodedFolder = path.join(storePath, dashEncode(workspaceRoot));
        writeJsonl(path.join(encodedFolder, 'older.jsonl'), [
            { type: 'user', sessionId: 'claude-dup', cwd: workspaceRoot, gitBranch: 'main', timestamp: '2026-06-13T08:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Older duplicate transcript' }] } },
            { type: 'assistant', sessionId: 'claude-dup', cwd: workspaceRoot, timestamp: '2026-06-13T08:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Old answer' }] } },
        ]);
        writeJsonl(path.join(encodedFolder, 'newer.jsonl'), [
            { type: 'user', sessionId: 'claude-dup', cwd: workspaceRoot, gitBranch: 'main', timestamp: '2026-06-13T09:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Newer duplicate transcript' }] } },
            { type: 'assistant', sessionId: 'claude-dup', cwd: workspaceRoot, timestamp: '2026-06-13T09:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'New answer' }] } },
        ]);

        const provider = new ClaudeNativeSessionProvider({ storePath });
        const listed = provider.listSessions({ rootPath: workspaceRoot });

        expect(listed.available).toBe(true);
        if (!listed.available) return;
        expect(listed.total).toBe(1);
        expect(listed.items).toHaveLength(1);
        expect(listed.items[0]).toMatchObject({
            id: 'claude-dup',
            summaryPreview: 'Newer duplicate transcript',
            updatedAt: '2026-06-13T09:00:01.000Z',
        });

        const detail = provider.getSession({ rootPath: workspaceRoot }, 'claude-dup');
        expect(detail.available).toBe(true);
        if (!detail.available) return;
        expect(detail.session?.conversation[0].content).toBe('Newer duplicate transcript');

        const deduped = provider.listSessions({ rootPath: workspaceRoot }, {
            excludeSessionIds: new Set(['claude-dup']),
        });
        expect(deduped.available).toBe(true);
        if (!deduped.available) return;
        expect(deduped.total).toBe(0);
        expect(deduped.deduplicatedCount).toBe(1);
    });

    it('returns reconstructed Claude detail with tool results', () => {
        const workspaceRoot = path.join(tmpDir, 'repo');
        const storePath = path.join(tmpDir, 'claude', 'projects');
        writeJsonl(path.join(storePath, dashEncode(workspaceRoot), 'claude-detail.jsonl'), [
            { type: 'assistant', sessionId: 'claude-detail', cwd: workspaceRoot, timestamp: '2026-06-13T09:00:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } }] } },
            { type: 'user', sessionId: 'claude-detail', cwd: workspaceRoot, timestamp: '2026-06-13T09:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: workspaceRoot }] } },
        ]);

        const provider = new ClaudeNativeSessionProvider({ storePath });
        const detail = provider.getSession({ rootPath: workspaceRoot }, 'claude-detail');

        expect(detail.available).toBe(true);
        if (!detail.available) return;
        expect(detail.session?.provider).toBe('claude');
        expect(detail.session?.conversation[0].toolCalls?.[0]).toMatchObject({
            toolName: 'Bash',
            status: 'completed',
            result: workspaceRoot,
        });
    });
});
