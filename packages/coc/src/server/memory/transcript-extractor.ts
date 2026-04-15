/**
 * Transcript Extractor
 *
 * Reads conversation turns from the ProcessStore, builds a transcript string,
 * calls AI with the extraction prompt, parses the structured JSON response,
 * and writes each extracted fact as a raw observation via FileMemoryStore.
 *
 * No VS Code dependencies — pure Node.js.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AIInvoker, ConversationTurn, ProcessStore } from '@plusplusoneplusplus/forge';
import { FileMemoryStore as ObservationStore, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import {
    EXTRACTION_SYSTEM_PROMPT,
    buildExtractionUserPrompt,
    parseExtractionResponse,
} from '@plusplusoneplusplus/forge';
import { readMemoryConfig } from './memory-config-handler';
import { getRepoDataPath } from '../paths';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface TranscriptExtractorOptions {
    dataDir: string;
    store: ProcessStore;
    aiInvoker: AIInvoker;
    model?: string;
    /** Minimum number of conversation turns to attempt extraction (default: 2). */
    minTurns?: number;
}

export interface ExtractionResult {
    processId: string;
    factsExtracted: number;
    skipped?: boolean;
    error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a human-readable transcript from conversation turns.
 * Only includes user and assistant text content — tool calls are skipped.
 */
export function buildTranscript(turns: ConversationTurn[]): string {
    const lines: string[] = [];
    for (const turn of turns) {
        if (turn.streaming) continue;
        if (turn.historical) continue;
        const role = turn.role === 'user' ? 'User' : 'Assistant';
        // Truncate very long assistant responses
        const content = turn.content.length > 4000
            ? turn.content.slice(0, 4000) + '… (truncated)'
            : turn.content;
        lines.push(`[${role}]: ${content}`);
    }
    return lines.join('\n\n');
}

// ============================================================================
// TranscriptExtractor
// ============================================================================

export class TranscriptExtractor {
    private readonly dataDir: string;
    private readonly store: ProcessStore;
    private readonly aiInvoker: AIInvoker;
    private readonly model: string;
    private readonly minTurns: number;

    constructor(options: TranscriptExtractorOptions) {
        this.dataDir = options.dataDir;
        this.store = options.store;
        this.aiInvoker = options.aiInvoker;
        this.model = options.model ?? 'gpt-4.1';
        this.minTurns = options.minTurns ?? 2;
    }

    /**
     * Extract durable facts from a completed conversation and write them
     * as raw observations to the observation store.
     */
    async extract(processId: string, workspaceId: string): Promise<ExtractionResult> {
        const logger = getLogger();

        // Load conversation
        const process = await this.store.getProcess(processId);
        if (!process) {
            return { processId, factsExtracted: 0, error: 'Process not found' };
        }

        const turns = process.conversationTurns ?? [];
        if (turns.length < this.minTurns) {
            return { processId, factsExtracted: 0, skipped: true };
        }

        // Build transcript (user/assistant text only)
        const transcript = buildTranscript(turns);
        if (transcript.trim().length === 0) {
            return { processId, factsExtracted: 0, skipped: true };
        }

        // Resolve repo context
        const workspaces = await this.store.getWorkspaces();
        const ws = workspaces.find(w => w.id === workspaceId);
        const repoContext = ws?.name || ws?.rootPath;

        const userPrompt = buildExtractionUserPrompt(transcript, repoContext);

        // Call AI
        let response: string;
        try {
            const result = await this.aiInvoker(userPrompt, {
                model: this.model,
                systemMessage: { mode: 'replace', content: EXTRACTION_SYSTEM_PROMPT },
            });
            if (!result.success) {
                return { processId, factsExtracted: 0, error: result.error ?? 'AI call failed' };
            }
            response = result.response ?? '';
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.AI, `[TranscriptExtractor] AI call failed for ${processId}: ${msg}`);
            return { processId, factsExtracted: 0, error: msg };
        }

        // Parse facts
        const facts = parseExtractionResponse(response);
        if (facts.length === 0) {
            return { processId, factsExtracted: 0 };
        }

        // Write each fact as a raw observation
        const obsStore = this.createObservationStore(workspaceId);
        for (const fact of facts) {
            const content = `${fact.fact}\n\nCategory: ${fact.category}`;
            await obsStore.writeRaw('repo', undefined, {
                pipeline: `transcript-${processId}`,
                timestamp: new Date().toISOString(),
            }, content);
        }

        logger.debug(LogCategory.AI, `[TranscriptExtractor] Extracted ${facts.length} facts from ${processId}`);
        return { processId, factsExtracted: facts.length };
    }

    private createObservationStore(workspaceId: string): ObservationStore {
        const config = readMemoryConfig(this.dataDir);
        const repoDir = getRepoDataPath(this.dataDir, workspaceId, path.join('memory', 'observations'));
        return new ObservationStore({ dataDir: config.storageDir, repoDir });
    }
}
