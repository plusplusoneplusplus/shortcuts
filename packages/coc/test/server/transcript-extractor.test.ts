/**
 * Tests for TranscriptExtractor
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AIInvoker, ConversationTurn } from '@plusplusoneplusplus/forge';
import { FileMemoryStore as ObservationStore } from '@plusplusoneplusplus/forge';
import { writeMemoryConfig, DEFAULT_MEMORY_CONFIG } from '../../src/server/memory/memory-config-handler';
import { TranscriptExtractor, buildTranscript } from '../../src/server/memory/transcript-extractor';
import { createMockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Helpers
// ============================================================================

const WORKSPACE_ID = 'test-workspace';

function makeTurn(role: 'user' | 'assistant', content: string, index: number): ConversationTurn {
    return {
        role,
        content,
        timestamp: new Date(),
        turnIndex: index,
        timeline: [],
    };
}

function createMockAIInvoker(response: string): AIInvoker {
    return vi.fn().mockResolvedValue({
        success: true,
        response,
    });
}

// ============================================================================
// buildTranscript
// ============================================================================

describe('buildTranscript', () => {
    it('builds user/assistant text', () => {
        const turns: ConversationTurn[] = [
            makeTurn('user', 'Hello', 0),
            makeTurn('assistant', 'Hi there', 1),
        ];
        const transcript = buildTranscript(turns);
        expect(transcript).toContain('[User]: Hello');
        expect(transcript).toContain('[Assistant]: Hi there');
    });

    it('skips streaming turns', () => {
        const turns: ConversationTurn[] = [
            makeTurn('user', 'Hello', 0),
            { ...makeTurn('assistant', 'partial...', 1), streaming: true },
        ];
        const transcript = buildTranscript(turns);
        expect(transcript).toContain('[User]: Hello');
        expect(transcript).not.toContain('partial');
    });

    it('skips historical turns', () => {
        const turns: ConversationTurn[] = [
            { ...makeTurn('user', 'old message', 0), historical: true },
            makeTurn('user', 'new message', 1),
        ];
        const transcript = buildTranscript(turns);
        expect(transcript).not.toContain('old message');
        expect(transcript).toContain('new message');
    });

    it('truncates long assistant responses', () => {
        const longContent = 'x'.repeat(5000);
        const turns: ConversationTurn[] = [
            makeTurn('assistant', longContent, 0),
        ];
        const transcript = buildTranscript(turns);
        expect(transcript.length).toBeLessThan(5000);
        expect(transcript).toContain('truncated');
    });
});

// ============================================================================
// TranscriptExtractor
// ============================================================================

describe('TranscriptExtractor', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-extractor-test-'));
        writeMemoryConfig(tmpDir, { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('extracts facts and writes raw observations', async () => {
        const turns = [
            makeTurn('user', 'How do I configure ESLint?', 0),
            makeTurn('assistant', 'The project uses ESLint with the recommended config in .eslintrc.js', 1),
        ];

        const processStore = createMockProcessStore({
            initialProcesses: [{
                id: 'proc-1',
                type: 'prompt',
                status: 'completed',
                promptPreview: 'test',
                fullPrompt: 'test',
                startTime: new Date(),
                conversationTurns: turns,
            }],
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'my-repo', rootPath: '/repo' }],
        });

        const aiInvoker = createMockAIInvoker(JSON.stringify([
            { fact: 'Project uses ESLint with recommended config', category: 'tools' },
            { fact: '.eslintrc.js is in the project root', category: 'conventions' },
        ]));

        const extractor = new TranscriptExtractor({
            dataDir: tmpDir,
            store: processStore,
            aiInvoker,
        });

        const result = await extractor.extract('proc-1', WORKSPACE_ID);
        expect(result.factsExtracted).toBe(2);
        expect(result.error).toBeUndefined();

        // Verify observations were written
        const repoDir = path.join(tmpDir, 'repos', WORKSPACE_ID, 'memory', 'observations');
        const obsStore = new ObservationStore({ dataDir: path.join(tmpDir, 'memory'), repoDir });
        const files = await obsStore.listRaw('repo', undefined);
        expect(files).toHaveLength(2);
    });

    it('skips when process not found', async () => {
        const processStore = createMockProcessStore();
        const aiInvoker = createMockAIInvoker('[]');

        const extractor = new TranscriptExtractor({
            dataDir: tmpDir,
            store: processStore,
            aiInvoker,
        });

        const result = await extractor.extract('nonexistent', WORKSPACE_ID);
        expect(result.factsExtracted).toBe(0);
        expect(result.error).toBe('Process not found');
    });

    it('skips when too few turns', async () => {
        const processStore = createMockProcessStore({
            initialProcesses: [{
                id: 'proc-1',
                type: 'prompt',
                status: 'completed',
                promptPreview: 'test',
                fullPrompt: 'test',
                startTime: new Date(),
                conversationTurns: [makeTurn('user', 'Hello', 0)],
            }],
        });

        const aiInvoker = createMockAIInvoker('[]');
        const extractor = new TranscriptExtractor({
            dataDir: tmpDir,
            store: processStore,
            aiInvoker,
            minTurns: 2,
        });

        const result = await extractor.extract('proc-1', WORKSPACE_ID);
        expect(result.skipped).toBe(true);
        expect(result.factsExtracted).toBe(0);
        // AI should NOT have been called
        expect(aiInvoker).not.toHaveBeenCalled();
    });

    it('handles AI returning empty array', async () => {
        const processStore = createMockProcessStore({
            initialProcesses: [{
                id: 'proc-1',
                type: 'prompt',
                status: 'completed',
                promptPreview: 'test',
                fullPrompt: 'test',
                startTime: new Date(),
                conversationTurns: [
                    makeTurn('user', 'What time is it?', 0),
                    makeTurn('assistant', 'I cannot tell time.', 1),
                ],
            }],
        });

        const aiInvoker = createMockAIInvoker('[]');
        const extractor = new TranscriptExtractor({
            dataDir: tmpDir,
            store: processStore,
            aiInvoker,
        });

        const result = await extractor.extract('proc-1', WORKSPACE_ID);
        expect(result.factsExtracted).toBe(0);
        expect(result.error).toBeUndefined();
    });

    it('handles AI failure gracefully', async () => {
        const processStore = createMockProcessStore({
            initialProcesses: [{
                id: 'proc-1',
                type: 'prompt',
                status: 'completed',
                promptPreview: 'test',
                fullPrompt: 'test',
                startTime: new Date(),
                conversationTurns: [
                    makeTurn('user', 'Hello', 0),
                    makeTurn('assistant', 'Hi', 1),
                ],
            }],
        });

        const aiInvoker = vi.fn().mockResolvedValue({
            success: false,
            error: 'Model unavailable',
        }) as unknown as AIInvoker;

        const extractor = new TranscriptExtractor({
            dataDir: tmpDir,
            store: processStore,
            aiInvoker,
        });

        const result = await extractor.extract('proc-1', WORKSPACE_ID);
        expect(result.factsExtracted).toBe(0);
        expect(result.error).toBe('Model unavailable');
    });

    it('uses correct model in AI call', async () => {
        const processStore = createMockProcessStore({
            initialProcesses: [{
                id: 'proc-1',
                type: 'prompt',
                status: 'completed',
                promptPreview: 'test',
                fullPrompt: 'test',
                startTime: new Date(),
                conversationTurns: [
                    makeTurn('user', 'Hello', 0),
                    makeTurn('assistant', 'Hi', 1),
                ],
            }],
        });

        const aiInvoker = createMockAIInvoker('[]');
        const extractor = new TranscriptExtractor({
            dataDir: tmpDir,
            store: processStore,
            aiInvoker,
            model: 'custom-model',
        });

        await extractor.extract('proc-1', WORKSPACE_ID);
        expect(aiInvoker).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ model: 'custom-model' }),
        );
    });

    it('writes observations with transcript source identifier', async () => {
        const processStore = createMockProcessStore({
            initialProcesses: [{
                id: 'proc-42',
                type: 'prompt',
                status: 'completed',
                promptPreview: 'test',
                fullPrompt: 'test',
                startTime: new Date(),
                conversationTurns: [
                    makeTurn('user', 'How to deploy?', 0),
                    makeTurn('assistant', 'Use npm run deploy', 1),
                ],
            }],
        });

        const aiInvoker = createMockAIInvoker(JSON.stringify([
            { fact: 'Deploy via npm run deploy', category: 'tools' },
        ]));

        const extractor = new TranscriptExtractor({
            dataDir: tmpDir,
            store: processStore,
            aiInvoker,
        });

        await extractor.extract('proc-42', WORKSPACE_ID);

        const repoDir = path.join(tmpDir, 'repos', WORKSPACE_ID, 'memory', 'observations');
        const obsStore = new ObservationStore({ dataDir: path.join(tmpDir, 'memory'), repoDir });
        const files = await obsStore.listRaw('repo', undefined);
        expect(files).toHaveLength(1);

        const obs = await obsStore.readRaw('repo', undefined, files[0]);
        expect(obs).toBeDefined();
        expect(obs!.metadata.pipeline).toBe('transcript-proc-42');
        expect(obs!.content).toContain('Deploy via npm run deploy');
        expect(obs!.content).toContain('Category: tools');
    });
});
