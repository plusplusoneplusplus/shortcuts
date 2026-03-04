/**
 * Tests for fix: chat input should NOT be disabled when task.status === 'running'.
 * Users should be able to type a follow-up while the AI is actively processing.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx'),
    'utf-8',
);

describe('RepoChatTab inputDisabled: running status allows input', () => {
    it('does not include running status in inputDisabled', () => {
        // The fix: remove task?.status === 'running' from inputDisabled
        expect(SRC).not.toMatch(
            /const inputDisabled = .*task\?\.status === 'running'/
        );
    });

    it('still disables input when status is queued', () => {
        expect(SRC).toContain("task?.status === 'queued'");
        expect(SRC).toMatch(/const inputDisabled = .*task\?\.status === 'queued'/);
    });

    it('still disables input when sending is true', () => {
        expect(SRC).toMatch(/const inputDisabled = sending \|\|/);
    });

    it('still disables input when isStreaming is true', () => {
        expect(SRC).toMatch(/const inputDisabled = sending \|\| isStreaming/);
    });

    it('inputDisabled expression is exactly: sending || isStreaming || queued', () => {
        expect(SRC).toContain(
            "const inputDisabled = sending || isStreaming || task?.status === 'queued'"
        );
    });
});

describe('RepoChatTab inputDisabled: sendFollowUp guards are sufficient', () => {
    it('sendFollowUp guards against missing processId', () => {
        expect(SRC).toContain('!processId');
    });

    it('sendFollowUp guards against sending state', () => {
        // The function checks `sending` before proceeding
        const followUpFn = SRC.slice(
            SRC.indexOf('const sendFollowUp'),
            SRC.indexOf('const sendFollowUp') + 500,
        );
        expect(followUpFn).toContain('sending');
    });

    it('sendFollowUp guards against sessionExpired', () => {
        const followUpFn = SRC.slice(
            SRC.indexOf('const sendFollowUp'),
            SRC.indexOf('const sendFollowUp') + 500,
        );
        expect(followUpFn).toContain('sessionExpired');
    });
});
