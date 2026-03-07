/**
 * Tests for chatConversationUtils.
 *
 * Validates the standalone utility module that extracts conversation turns
 * from process and task data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CHAT_UTILS_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'chat', 'chatConversationUtils.ts'
);

describe('chatConversationUtils (standalone)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(CHAT_UTILS_PATH, 'utf-8');
    });

    it('exports getConversationTurns as a named export', () => {
        expect(source).toContain('export function getConversationTurns');
    });

    it('accepts optional task parameter', () => {
        expect(source).toContain('function getConversationTurns(data: any, task?: any)');
    });

    it('checks process.conversationTurns first', () => {
        expect(source).toContain('process?.conversationTurns');
    });

    it('falls back to data.conversation', () => {
        expect(source).toContain("data?.conversation");
    });

    it('falls back to data.turns', () => {
        expect(source).toContain("data?.turns");
    });

    it('creates synthetic turns from fullPrompt and result', () => {
        expect(source).toContain('process.fullPrompt || process.promptPreview');
        expect(source).toContain('process.result');
    });

    it('falls back to task.payload.prompt', () => {
        expect(source).toContain('task?.payload?.prompt');
    });

    it('imports ClientConversationTurn type', () => {
        expect(source).toContain("import type { ClientConversationTurn }");
    });
});

