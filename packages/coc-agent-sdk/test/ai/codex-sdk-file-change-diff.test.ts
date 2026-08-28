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

    it('keeps the dirty-start baseline for a path git would quote', async () => {
        // `git status --porcelain` without `-z` renders this name as its quoted
        // C-string, `"caf\303\251.txt"`, which names no file on disk — so a
        // baseline read through the addon's parsed `gitStatusEntries` would be
        // lost and the diff would fall back to HEAD.
        const quoted = 'caf\u00e9.txt';
        fs.writeFileSync(path.join(repoDir, quoted), 'base\n', 'utf8');
        git(repoDir, ['add', '--', quoted]);
        git(repoDir, ['commit', '-m', 'add quoted']);
        fs.writeFileSync(path.join(repoDir, quoted), 'user dirty\n', 'utf8');

        const result = await sendWithFileChange({
            cwd: repoDir,
            changes: [{ path: quoted, kind: 'update' }],
            changeBeforeEvent: () => {
                fs.writeFileSync(path.join(repoDir, quoted), 'codex dirty\n', 'utf8');
            },
        });

        const toolCall = result.toolCalls?.find(call => call.name === 'apply_patch');
        const diff = (toolCall?.args as { diff?: string }).diff ?? '';
        expect(diff).toContain('-user dirty');
        expect(diff).toContain('+codex dirty');
        expect(diff).not.toContain('-base');
    });

    it.skipIf(process.platform === 'win32')(
        'resolves absolute paths spelled through a symlinked working directory',
        async () => {
            // The repository root has two spellings: the one the working
            // directory reaches it by, and the one symlinks resolve to. Codex
            // can report either, so both have to be aliases.
            fs.writeFileSync(path.join(repoDir, 'second.txt'), 'second base\n', 'utf8');
            git(repoDir, ['add', 'second.txt']);
            git(repoDir, ['commit', '-m', 'add second']);

            const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-file-change-link-'));
            const link = path.join(linkDir, 'repo');
            fs.symlinkSync(repoDir, link, 'dir');
            try {
                const result = await sendWithFileChange({
                    cwd: link,
                    changes: [
                        // One file per spelling, so a spelling that failed to
                        // resolve loses its own diff rather than deduplicating
                        // against the other's.
                        { path: path.join(link, 'file.txt'), kind: 'update' },
                        { path: path.join(fs.realpathSync(repoDir), 'second.txt'), kind: 'update' },
                    ],
                    changeBeforeEvent: () => {
                        fs.writeFileSync(path.join(repoDir, 'file.txt'), 'codex linked\n', 'utf8');
                        fs.writeFileSync(path.join(repoDir, 'second.txt'), 'second linked\n', 'utf8');
                    },
                });

                const toolCall = result.toolCalls?.find(call => call.name === 'apply_patch');
                const diff = (toolCall?.args as { diff?: string }).diff ?? '';
                expect(diff).toContain('--- a/file.txt');
                expect(diff).toContain('+codex linked');
                expect(diff).toContain('--- a/second.txt');
                expect(diff).toContain('+second linked');
            } finally {
                fs.rmSync(linkDir, { recursive: true, force: true });
            }
        },
    );

    it('diffs a file that does not exist at HEAD against /dev/null', async () => {
        const result = await sendWithFileChange({
            cwd: repoDir,
            changes: [{ path: 'fresh.txt', kind: 'add' }],
            changeBeforeEvent: () => {
                fs.writeFileSync(path.join(repoDir, 'fresh.txt'), 'brand new\n', 'utf8');
            },
        });

        const toolCall = result.toolCalls?.find(call => call.name === 'apply_patch');
        const diff = (toolCall?.args as { diff?: string }).diff ?? '';
        expect(diff).toContain('--- /dev/null');
        expect(diff).toContain('+++ b/fresh.txt');
        expect(diff).toContain('+brand new');
    });

    it('keeps the file list without diff when the working directory is not a repository', async () => {
        const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-file-change-plain-'));
        try {
            fs.writeFileSync(path.join(plainDir, 'file.txt'), 'before\n', 'utf8');
            const result = await sendWithFileChange({
                cwd: plainDir,
                changes: [{ path: 'file.txt', kind: 'update' }],
                changeBeforeEvent: () => {
                    fs.writeFileSync(path.join(plainDir, 'file.txt'), 'after\n', 'utf8');
                },
            });

            const toolCall = result.toolCalls?.find(call => call.name === 'apply_patch');
            expect(toolCall?.args).toEqual({
                changes: [{ path: 'file.txt', kind: 'update' }],
            });
        } finally {
            fs.rmSync(plainDir, { recursive: true, force: true });
        }
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
