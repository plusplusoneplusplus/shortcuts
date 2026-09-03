/**
 * `recordRalphIteration`'s post-iteration HEAD capture is best-effort: any git
 * failure leaves `headSha` absent, but a broken native addon propagates (it is
 * a broken install, not a repo with nothing to say).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';

const gitHeadSha = vi.hoisted(() => vi.fn());
vi.mock('../../../src/server/ralph/capture-baseline-sha', () => ({ gitHeadSha }));

import { recordRalphIteration } from '../../../src/server/ralph/record-iteration';

let dataDir: string;
const WS = 'ws-1';
const SID = 'sess-head-sha';

const BASE = {
    workspaceId: WS,
    sessionId: SID,
    iteration: 1,
    maxIterations: 3,
    signal: 'RALPH_NEXT' as const,
    progressBody: 'x',
    taskId: 't1',
    processId: 'p1',
    shouldContinue: true,
    workingDirectory: '/some/checkout',
};

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-iteration-head-sha-'));
    gitHeadSha.mockReset();
});
afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('recordRalphIteration HEAD capture failures', () => {
    it('leaves headSha absent when gitHeadSha resolves undefined', async () => {
        gitHeadSha.mockResolvedValue(undefined);

        const r = await recordRalphIteration({ dataDir, ...BASE });

        expect(r.record?.iterations[0].headSha).toBeUndefined();
    });

    it('propagates NativeAddonLoadError', async () => {
        gitHeadSha.mockRejectedValue(new NativeAddonLoadError('addon missing'));

        await expect(recordRalphIteration({ dataDir, ...BASE }))
            .rejects.toBeInstanceOf(NativeAddonLoadError);
    });
});
