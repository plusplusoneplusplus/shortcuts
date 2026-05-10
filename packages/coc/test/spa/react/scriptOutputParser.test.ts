/**
 * Tests for scriptOutputParser — verifies that we round-trip the output
 * shape produced by `formatScriptResponse` (run-script-strategy.ts) into a
 * structured `ParsedScriptOutput` the SPA can render as a terminal block.
 */

import { describe, it, expect } from 'vitest';
import {
    parseScriptOutput,
    describeScriptExit,
} from '../../../src/server/spa/client/react/features/chat/conversation/scriptOutputParser';
import { formatScriptResponse } from '../../../src/server/task-strategies/run-script-strategy';

describe('parseScriptOutput', () => {
    it('parses a happy-path success body produced by formatScriptResponse', () => {
        const body = formatScriptResponse(
            'npm test -- ConversationArea',
            '/repo',
            true,
            'PASS  test/spa/react/repos/ConversationArea-sort-order.test.tsx\nPASS  test/spa/react/ConversationTurnBubble.test.tsx\nPASS  test/spa/react/ConversationTurnBubble-context-menu.test.tsx\n\nTest Suites: 3 passed, 3 total\nTests:       42 passed, 42 total\nTime:        4.812 s',
            '',
            0,
            false,
            4812,
        );
        const parsed = parseScriptOutput(body);
        expect(parsed.recognised).toBe(true);
        expect(parsed.script).toBe('npm test -- ConversationArea');
        expect(parsed.workingDirectory).toBe('/repo');
        expect(parsed.status).toBe('success');
        expect(parsed.exitCode).toBe(0);
        expect(parsed.durationMs).toBe(4812);
        expect(parsed.stdout).toContain('Test Suites: 3 passed');
        expect(parsed.stderr).toBeUndefined();
    });

    it('parses a non-zero exit body and captures the exit code', () => {
        const body = formatScriptResponse('bad-cmd', undefined, false, '', 'fatal: not a git repo', 127, false, 50);
        const parsed = parseScriptOutput(body);
        expect(parsed.status).toBe('failed');
        expect(parsed.exitCode).toBe(127);
        expect(parsed.workingDirectory).toBeUndefined();
        expect(parsed.stderr).toBe('fatal: not a git repo');
        expect(parsed.stdout).toBeUndefined();
    });

    it('parses a timeout body as status=timeout exitCode=null', () => {
        const body = formatScriptResponse('sleep 100', undefined, false, '', '', null, true, 200);
        const parsed = parseScriptOutput(body);
        expect(parsed.status).toBe('timeout');
        expect(parsed.exitCode).toBeNull();
        expect(parsed.durationMs).toBe(200);
    });

    it('captures both stdout and stderr when present', () => {
        const body = formatScriptResponse(
            'do-thing',
            '/x',
            false,
            'partial output\nmore output',
            'WARN: something broke',
            2,
            false,
            123,
        );
        const parsed = parseScriptOutput(body);
        expect(parsed.stdout).toBe('partial output\nmore output');
        expect(parsed.stderr).toBe('WARN: something broke');
        expect(parsed.exitCode).toBe(2);
        expect(parsed.status).toBe('failed');
    });

    it('treats unrecognised content (no **Script:** header) as not recognised', () => {
        const parsed = parseScriptOutput('just some markdown\n\n```\nhello\n```');
        expect(parsed.recognised).toBe(false);
        expect(parsed.script).toBeUndefined();
        expect(parsed.status).toBe('unknown');
    });

    it('handles empty input safely', () => {
        const parsed = parseScriptOutput('');
        expect(parsed.recognised).toBe(false);
        expect(parsed.status).toBe('unknown');
        expect(parsed.stdout).toBeUndefined();
        expect(parsed.stderr).toBeUndefined();
    });

    it('handles CRLF line endings (Windows-formatted bodies) correctly', () => {
        const body = formatScriptResponse('echo hi', undefined, true, 'hi', '', 0, false, 10).replace(/\n/g, '\r\n');
        const parsed = parseScriptOutput(body);
        expect(parsed.recognised).toBe(true);
        expect(parsed.status).toBe('success');
        expect(parsed.stdout).toBe('hi');
    });

    it('treats a missing closing fence as end-of-section (lenient mode)', () => {
        const body = '**Script:** `echo hi`\n**Status:** ✅ Success\n**stdout:**\n```\nfirst line\nsecond line\n';
        const parsed = parseScriptOutput(body);
        expect(parsed.recognised).toBe(true);
        expect(parsed.stdout).toBe('first line\nsecond line\n');
    });

    it('keeps fence info-strings (e.g. ```text) from leaking into the body', () => {
        const body = '**Script:** `echo hi`\n**Status:** ✅ Success\n**stdout:**\n```text\nhello\n```';
        const parsed = parseScriptOutput(body);
        expect(parsed.stdout).toBe('hello');
    });
});

describe('describeScriptExit', () => {
    it('shows "exit 0" for success', () => {
        expect(describeScriptExit({ status: 'success', exitCode: 0, recognised: true })).toBe('exit 0');
    });

    it('shows "exit N" for failed runs with a known exit code', () => {
        expect(describeScriptExit({ status: 'failed', exitCode: 127, recognised: true })).toBe('exit 127');
    });

    it('falls back to "failed" when exit code is unknown', () => {
        expect(describeScriptExit({ status: 'failed', recognised: true })).toBe('failed');
    });

    it('shows "timed out" for timeout regardless of exit code', () => {
        expect(describeScriptExit({ status: 'timeout', exitCode: null, recognised: true })).toBe('timed out');
    });

    it('returns undefined for unknown status with no exit code', () => {
        expect(describeScriptExit({ status: 'unknown', recognised: false })).toBeUndefined();
    });
});
