import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { readCodexRolloutContextUsage } from '../../src/codex-rollout-usage';

// ── Fixture helpers ─────────────────────────────────────────────────────────

function tokenCountLine(info: unknown): string {
    return JSON.stringify({
        timestamp: '2026-07-25T00:00:00.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info, rate_limits: null },
    });
}

function info(totalTokens: number | null, contextWindow: number | null): Record<string, unknown> {
    return {
        total_token_usage: { total_tokens: (totalTokens ?? 0) + 100 },
        last_token_usage: totalTokens === null ? null : { total_tokens: totalTokens },
        model_context_window: contextWindow,
    };
}

async function writeRollout(
    root: string,
    threadId: string,
    lines: string[],
    opts?: { datePath?: string },
): Promise<string> {
    const dir = path.join(root, opts?.datePath ?? path.join('2026', '07', '25'));
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `rollout-2026-07-25T00-00-00-${threadId}.jsonl`);
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
    return filePath;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('readCodexRolloutContextUsage', () => {
    let root: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rollout-'));
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it('happy path: returns the LAST token_count occupancy and context window', async () => {
        await writeRollout(root, 'thread-1', [
            tokenCountLine(info(1000, 258_400)),
            JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', text: 'hi' } }),
            tokenCountLine(info(76_223, 258_400)),
        ]);

        const usage = await readCodexRolloutContextUsage('thread-1', { sessionsRoot: root });
        expect(usage?.currentTokens).toBe(76_223);
        expect(usage?.tokenLimit).toBe(258_400);
        expect(usage?.rolloutPath).toContain('thread-1');
    });

    it('null window: currentTokens set, tokenLimit omitted', async () => {
        await writeRollout(root, 'thread-1', [tokenCountLine(info(5000, null))]);

        const usage = await readCodexRolloutContextUsage('thread-1', { sessionsRoot: root });
        expect(usage?.currentTokens).toBe(5000);
        expect(usage?.tokenLimit).toBeUndefined();
    });

    it('null info: falls back to the previous parseable token_count', async () => {
        await writeRollout(root, 'thread-1', [
            tokenCountLine(info(4000, 200_000)),
            tokenCountLine(null),
        ]);

        const usage = await readCodexRolloutContextUsage('thread-1', { sessionsRoot: root });
        expect(usage?.currentTokens).toBe(4000);
        expect(usage?.tokenLimit).toBe(200_000);
    });

    it('null last_token_usage: skips that envelope and uses the earlier one', async () => {
        await writeRollout(root, 'thread-1', [
            tokenCountLine(info(3200, 128_000)),
            tokenCountLine(info(null, 128_000)),
        ]);

        const usage = await readCodexRolloutContextUsage('thread-1', { sessionsRoot: root });
        expect(usage?.currentTokens).toBe(3200);
    });

    it('no token_count: returns undefined', async () => {
        await writeRollout(root, 'thread-1', [
            JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', text: 'hi' } }),
            JSON.stringify({ type: 'session_meta', payload: { id: 'thread-1' } }),
        ]);

        const usage = await readCodexRolloutContextUsage('thread-1', { sessionsRoot: root });
        expect(usage).toBeUndefined();
    });

    it('missing file / wrong threadId: returns undefined, no throw', async () => {
        await writeRollout(root, 'thread-1', [tokenCountLine(info(1000, 100_000))]);

        expect(await readCodexRolloutContextUsage('thread-missing', { sessionsRoot: root })).toBeUndefined();
    });

    it('missing root: returns undefined, no throw', async () => {
        const usage = await readCodexRolloutContextUsage('thread-1', {
            sessionsRoot: path.join(root, 'does-not-exist'),
        });
        expect(usage).toBeUndefined();
    });

    it('empty threadId or root: returns undefined', async () => {
        expect(await readCodexRolloutContextUsage('', { sessionsRoot: root })).toBeUndefined();
        expect(await readCodexRolloutContextUsage('thread-1', { sessionsRoot: '' })).toBeUndefined();
    });

    it('malformed tail: garbage lines are skipped, the token_count is still found', async () => {
        await writeRollout(root, 'thread-1', [
            tokenCountLine(info(8000, 300_000)),
            '{ not valid json',
            'plain garbage',
            '',
        ]);

        const usage = await readCodexRolloutContextUsage('thread-1', { sessionsRoot: root });
        expect(usage?.currentTokens).toBe(8000);
        expect(usage?.tokenLimit).toBe(300_000);
    });

    it('tail window: an event beyond 64 KB of trailing garbage is not found', async () => {
        const filler = 'x'.repeat(70 * 1024);
        await writeRollout(root, 'thread-1', [
            tokenCountLine(info(9000, 100_000)),
            filler,
        ]);

        // The only token_count sits before 64 KB of trailing garbage → out of the window.
        const usage = await readCodexRolloutContextUsage('thread-1', { sessionsRoot: root });
        expect(usage).toBeUndefined();
    });

    it('tail window: a near-EOF event in a >64 KB file is found', async () => {
        const filler = 'x'.repeat(70 * 1024);
        await writeRollout(root, 'thread-1', [
            filler,
            tokenCountLine(info(12_000, 258_400)),
        ]);

        const usage = await readCodexRolloutContextUsage('thread-1', { sessionsRoot: root });
        expect(usage?.currentTokens).toBe(12_000);
        expect(usage?.tokenLimit).toBe(258_400);
    });

    it('date-dir discovery: finds a file nested under YYYY/MM/DD', async () => {
        await writeRollout(root, 'thread-1', [tokenCountLine(info(2222, 128_000))], {
            datePath: path.join('2026', '01', '02'),
        });

        const usage = await readCodexRolloutContextUsage('thread-1', { sessionsRoot: root });
        expect(usage?.currentTokens).toBe(2222);
    });

    it('date-dir discovery: newest-first ordering picks the file in the later date', async () => {
        // Same threadId in two date dirs (pathological); newest date wins.
        await writeRollout(root, 'thread-1', [tokenCountLine(info(111, 100_000))], {
            datePath: path.join('2026', '07', '20'),
        });
        await writeRollout(root, 'thread-1', [tokenCountLine(info(999, 100_000))], {
            datePath: path.join('2026', '07', '25'),
        });

        const usage = await readCodexRolloutContextUsage('thread-1', { sessionsRoot: root });
        expect(usage?.currentTokens).toBe(999);
        expect(usage?.rolloutPath).toContain(path.join('2026', '07', '25'));
    });

    it('cached path: reads directly when the cached file still exists', async () => {
        const filePath = await writeRollout(root, 'thread-1', [tokenCountLine(info(4321, 200_000))]);

        // Point sessionsRoot at a non-existent dir so a walk would fail — proving
        // the cached path is used directly.
        const usage = await readCodexRolloutContextUsage('thread-1', {
            sessionsRoot: path.join(root, 'nope'),
            cachedPath: filePath,
        });
        expect(usage?.currentTokens).toBe(4321);
        expect(usage?.rolloutPath).toBe(filePath);
    });

    it('cached path gone: re-walks and finds the file', async () => {
        await writeRollout(root, 'thread-1', [tokenCountLine(info(5555, 200_000))]);

        const usage = await readCodexRolloutContextUsage('thread-1', {
            sessionsRoot: root,
            cachedPath: path.join(root, 'stale', 'rollout-old-thread-1.jsonl'),
        });
        expect(usage?.currentTokens).toBe(5555);
    });
});
