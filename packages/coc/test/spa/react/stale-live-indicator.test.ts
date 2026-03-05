/**
 * App.tsx — WebSocket process-updated terminal invalidation tests
 *
 * Verifies that process-updated WebSocket messages with terminal statuses
 * dispatch INVALIDATE_CONVERSATION to clear the stale conversation cache.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');

describe('App.tsx — INVALIDATE_CONVERSATION on terminal process-updated', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(CLIENT_DIR, 'App.tsx'), 'utf-8');
    });

    it('dispatches INVALIDATE_CONVERSATION in the process-updated case', () => {
        expect(source).toContain("type: 'INVALIDATE_CONVERSATION'");
    });

    it('checks for terminal statuses before dispatching INVALIDATE_CONVERSATION', () => {
        expect(source).toContain('terminalStatuses');
    });

    it('covers completed, failed, and cancelled as terminal statuses', () => {
        expect(source).toContain("'completed'");
        expect(source).toContain("'failed'");
        expect(source).toContain("'cancelled'");
    });

    it('INVALIDATE_CONVERSATION dispatch is inside the process-updated case', () => {
        const processUpdatedIdx = source.indexOf("case 'process-updated':");
        const nextCaseIdx = source.indexOf("case 'process-removed':");
        expect(processUpdatedIdx).toBeGreaterThan(-1);
        expect(nextCaseIdx).toBeGreaterThan(-1);
        const caseBody = source.slice(processUpdatedIdx, nextCaseIdx);
        expect(caseBody).toContain("type: 'INVALIDATE_CONVERSATION'");
        expect(caseBody).toContain('terminalStatuses');
    });

    it('guards INVALIDATE_CONVERSATION with includes() check on msg.process.status', () => {
        const processUpdatedIdx = source.indexOf("case 'process-updated':");
        const nextCaseIdx = source.indexOf("case 'process-removed':");
        const caseBody = source.slice(processUpdatedIdx, nextCaseIdx);
        expect(caseBody).toMatch(/terminalStatuses\.includes\(msg\.process\.status\)/);
    });
});

describe('ProcessDetail.tsx — SSE "done" listener and streaming flag clear', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(
            path.join(CLIENT_DIR, 'processes', 'ProcessDetail.tsx'),
            'utf-8',
        );
    });

    it('registers a "done" SSE event listener', () => {
        expect(source).toContain("addEventListener('done'");
    });

    it('"done" listener calls setTurns to clear streaming flags', () => {
        const doneIdx = source.indexOf("addEventListener('done'");
        expect(doneIdx).toBeGreaterThan(-1);
        const doneBlock = source.slice(doneIdx, doneIdx + 300);
        expect(doneBlock).toContain('streaming: false');
    });

    it('"status" listener clears streaming flags for terminal statuses', () => {
        const statusIdx = source.indexOf("addEventListener('status'");
        expect(statusIdx).toBeGreaterThan(-1);
        const statusBlock = source.slice(statusIdx, statusIdx + 500);
        expect(statusBlock).toContain('terminalStatuses');
        expect(statusBlock).toContain('streaming: false');
    });

    it('data-fetch useEffect depends on process?.status', () => {
        expect(source).toContain('process?.status, dispatch');
    });
});
