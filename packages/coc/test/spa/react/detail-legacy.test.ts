/**
 * Tests for detail.ts — verify image paste TODO comment exists.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DETAIL_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'detail.ts'
);

describe('detail.ts legacy', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(DETAIL_PATH, 'utf-8');
    });

    it('has TODO comment for image paste support on sendFollowUpMessage', () => {
        expect(source).toContain('TODO(chat-image-attach)');
        // Verify the TODO is associated with the sendFollowUpMessage function
        const todoIdx = source.indexOf('TODO(chat-image-attach)');
        const fnIdx = source.indexOf('function sendFollowUpMessage');
        expect(todoIdx).toBeLessThan(fnIdx);
        expect(fnIdx - todoIdx).toBeLessThan(200);
    });

    it('references React QueueTaskDetail as the supported path', () => {
        expect(source).toContain('React QueueTaskDetail already supports images');
    });

    it('gates chat-input-bar on sdkSessionId for terminal processes', () => {
        // Verify the showChatInput variable is derived from sdkSessionId
        expect(source).toContain('hasSession');
        expect(source).toContain('proc.sdkSessionId');
        expect(source).toContain('showChatInput');
        // The chat-input-bar rendering must be inside a showChatInput guard
        const showChatIdx = source.indexOf('if (showChatInput)');
        const chatBarIdx = source.indexOf('chat-input-bar');
        expect(showChatIdx).toBeGreaterThan(-1);
        expect(chatBarIdx).toBeGreaterThan(showChatIdx);
    });

    it('renders a static footer when chat input is hidden', () => {
        expect(source).toContain('Pipeline completed');
        expect(source).toContain('follow-up chat not available');
    });

    it('gates chat-hint rendering on showChatInput', () => {
        const hintIdx = source.indexOf('chat-hint');
        const showChatIdx = source.lastIndexOf('showChatInput', hintIdx);
        expect(showChatIdx).toBeGreaterThan(-1);
    });
});
