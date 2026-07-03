import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodexSDKService } from '../../src/codex-sdk-service';

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function sendWithFileChange(params: {
    cwd?: string;
    changeBeforeEvent?: () => void;
    changes: Array<{ path: string; kind: string }>;
    onToolEvent?: (event: any) => void;
}) {
    const svc = new CodexSDKService();
    const thread = {
        id: 'thread-1',
        runStreamed: vi.fn(async () => ({
            events: (async function* () {
                yield { type: 'thread.started', thread_id: 'thread-1' };
                yield {
                    type: 'item.started',
                    item: { id: 'change-1', type: 'file_change', changes: params.changes, status: 'completed' },
                };
                params.changeBeforeEvent?.();
                yield {
                    type: 'item.completed',
                    item: { id: 'change-1', type: 'file_change', changes: params.changes, status: 'completed' },
                };
                yield { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } };
            })(),
        })),
    };
    const client = {
        startThread: vi.fn(() => thread),
        resumeThread: vi.fn(() => thread),
    };
    (svc as unknown as { sdk: unknown }).sdk = client;
    (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

    try {
        return await svc.sendMessage({
            prompt: 'edit file',
            workingDirectory: params.cwd,
            onToolEvent: params.onToolEvent,
        });
    } finally {
        svc.dispose();
    }
}

describe('CodexSDKService file_change diff enrichment', () => {
    let repoDir: string;

    beforeEach(() => {
        repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-file-change-diff-'));
        git(repoDir, ['init', '-b', 'main']);
        git(repoDir, ['config', 'user.email', 'test@example.com']);
        git(repoDir, ['config', 'user.name', 'Test User']);
        fs.writeFileSync(path.join(repoDir, 'file.txt'), 'base\n', 'utf8');
        git(repoDir, ['add', 'file.txt']);
        git(repoDir, ['commit', '-m', 'init']);
    });

    afterEach(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
    });

    it('adds a unified diff to completed Codex file_change tool calls', async () => {
        const completedEvents: any[] = [];
        const result = await sendWithFileChange({
            cwd: repoDir,
            changes: [{ path: 'file.txt', kind: 'update' }],
            changeBeforeEvent: () => {
                fs.writeFileSync(path.join(repoDir, 'file.txt'), 'codex\n', 'utf8');
            },
            onToolEvent: event => {
                if (event.type === 'tool-complete') completedEvents.push(event);
            },
        });

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(result.success, JSON.stringify(result)).toBe(true);
        const toolCall = result.toolCalls?.find(call => call.name === 'apply_patch');
        expect(toolCall?.args).toMatchObject({
            changes: [{ path: 'file.txt', kind: 'update' }],
        });
        const diff = (toolCall?.args as { diff?: string }).diff ?? '';
        expect(diff).toContain('--- a/file.txt');
        expect(diff).toContain('+++ b/file.txt');
        expect(diff).toContain('-base');
        expect(diff).toContain('+codex');
        expect(completedEvents[0]?.parameters?.diff).toBe(diff);
    });

    it('adds a unified diff when Codex reports an absolute path under the git root', async () => {
        const absolutePath = path.join(repoDir, 'file.txt');
        const result = await sendWithFileChange({
            cwd: repoDir,
            changes: [{ path: absolutePath, kind: 'update' }],
            changeBeforeEvent: () => {
                fs.writeFileSync(path.join(repoDir, 'file.txt'), 'codex absolute\n', 'utf8');
            },
        });

        expect(result.success, JSON.stringify(result)).toBe(true);
        const toolCall = result.toolCalls?.find(call => call.name === 'apply_patch');
        expect(toolCall?.args).toMatchObject({
            changes: [{ path: absolutePath, kind: 'update' }],
        });
        const diff = (toolCall?.args as { diff?: string }).diff ?? '';
        expect(diff).toContain('--- a/file.txt');
        expect(diff).toContain('+++ b/file.txt');
        expect(diff).toContain('-base');
        expect(diff).toContain('+codex absolute');
    });

    it('does not diff absolute paths outside the git root', async () => {
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-file-change-outside-'));
        try {
            const outsidePath = path.join(outsideDir, 'outside.txt');
            fs.writeFileSync(outsidePath, 'outside before\n', 'utf8');

            const result = await sendWithFileChange({
                cwd: repoDir,
                changes: [{ path: outsidePath, kind: 'update' }],
                changeBeforeEvent: () => {
                    fs.writeFileSync(outsidePath, 'outside after\n', 'utf8');
                },
            });

            expect(result.success, JSON.stringify(result)).toBe(true);
            const toolCall = result.toolCalls?.find(call => call.name === 'apply_patch');
            expect(toolCall?.args).toEqual({
                changes: [{ path: outsidePath, kind: 'update' }],
            });
        } finally {
            fs.rmSync(outsideDir, { recursive: true, force: true });
        }
    });

    it('diffs against the pre-turn dirty worktree snapshot instead of HEAD', async () => {
        fs.writeFileSync(path.join(repoDir, 'file.txt'), 'user dirty\n', 'utf8');

        const result = await sendWithFileChange({
            cwd: repoDir,
            changes: [{ path: 'file.txt', kind: 'update' }],
            changeBeforeEvent: () => {
                fs.writeFileSync(path.join(repoDir, 'file.txt'), 'codex dirty\n', 'utf8');
            },
        });

        const toolCall = result.toolCalls?.find(call => call.name === 'apply_patch');
        const diff = (toolCall?.args as { diff?: string }).diff ?? '';
        expect(diff).toContain('-user dirty');
        expect(diff).toContain('+codex dirty');
        expect(diff).not.toContain('-base');
    });

    it('keeps the file list without diff when no working directory is available', async () => {
        const result = await sendWithFileChange({
            changes: [{ path: 'file.txt', kind: 'update' }],
        });

        const toolCall = result.toolCalls?.find(call => call.name === 'apply_patch');
        expect(toolCall?.args).toEqual({
            changes: [{ path: 'file.txt', kind: 'update' }],
        });
    });
});
