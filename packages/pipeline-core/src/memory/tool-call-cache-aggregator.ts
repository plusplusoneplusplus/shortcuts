/**
 * Tool Call Cache Aggregator
 *
 * Consolidates raw Q&A cache entries into a searchable consolidated.json
 * index via AI-powered deduplication, clustering, and normalization.
 * Mirrors MemoryAggregator's safety-first pattern: write consolidated FIRST,
 * delete raw AFTER.
 *
 * No VS Code dependencies — pure Node.js.
 */

import { randomUUID } from 'crypto';
import { ToolCallCacheStore, ConsolidatedToolCallEntry, ToolCallQAEntry } from './tool-call-cache-types';
import { AIInvoker } from '../map-reduce/types';

export interface ToolCallCacheAggregatorOptions {
    /** Minimum raw entry count before automatic aggregation triggers. Default: 5 */
    batchThreshold?: number;
}

export class ToolCallCacheAggregator {
    private readonly store: ToolCallCacheStore;
    private readonly batchThreshold: number;

    constructor(store: ToolCallCacheStore, options?: ToolCallCacheAggregatorOptions) {
        this.store = store;
        this.batchThreshold = options?.batchThreshold ?? 5;
    }

    /**
     * Runs aggregation only if raw entry count meets the batch threshold.
     * Returns true if aggregation ran, false if skipped.
     */
    async aggregateIfNeeded(aiInvoker: AIInvoker): Promise<boolean> {
        const filenames = await this.store.listRaw();
        if (filenames.length < this.batchThreshold) return false;
        await this.aggregate(aiInvoker);
        return true;
    }

    /**
     * Full aggregation pipeline: read raw → AI consolidate → write consolidated → delete raw.
     * Safety invariant: raw files are only deleted after consolidated write succeeds.
     */
    async aggregate(aiInvoker: AIInvoker): Promise<void> {
        const filenames = await this.store.listRaw();
        if (filenames.length === 0) return;

        const results = await Promise.all(filenames.map(f => this.store.readRaw(f)));
        const rawEntries = results.filter((e): e is ToolCallQAEntry => e !== undefined);

        const existing = await this.store.readConsolidated();
        const prompt = this.buildPrompt(existing, rawEntries);

        const result = await aiInvoker(prompt);
        if (!result.success) {
            throw new Error(`Tool call cache aggregation failed: ${result.error ?? 'unknown error'}`);
        }

        const consolidated = this.parseConsolidatedResponse(result.response!);

        await this.store.writeConsolidated(consolidated);
        await this.store.updateIndex({
            lastAggregation: new Date().toISOString(),
            rawCount: 0,
            consolidatedCount: consolidated.length,
        });

        for (const filename of filenames) {
            await this.store.deleteRaw(filename);
        }
    }

    private buildPrompt(
        existing: ConsolidatedToolCallEntry[],
        rawEntries: ToolCallQAEntry[],
    ): string {
        const existingSection = existing.length > 0
            ? JSON.stringify(existing, null, 2)
            : 'No existing consolidated entries';

        const rawSection = rawEntries
            .map(e => JSON.stringify({
                question: e.question,
                answer: e.answer,
                toolSources: [e.toolName],
                gitHash: e.gitHash ?? null,
            }, null, 2))
            .join('\n\n');

        return [
            'You are a tool-call cache consolidator. Your job is to merge raw Q&A pairs into a deduplicated, clustered, normalized index.',
            '',
            '## Existing Consolidated Entries',
            existingSection,
            '',
            `## New Raw Entries (${rawEntries.length} entries)`,
            rawSection,
            '',
            '## Instructions',
            '1. **Deduplicate**: Merge entries with near-identical questions (e.g. "list files in src" vs "list files in the src directory"). Keep the best answer.',
            '2. **Cluster by topic**: Assign 1-3 topic tags per entry (e.g. ["file-structure", "git"], ["testing", "vitest"]).',
            '3. **Normalize questions**: Rewrite questions to be generic and reusable. Remove repo-specific paths where possible, but preserve the semantic intent.',
            '4. **Preserve tool sources**: Union all toolSources from merged entries.',
            '5. **Set confidence**: 1.0 for entries with consistent answers, lower for entries with conflicting answers.',
            '6. **Merge with existing**: If an existing consolidated entry covers the same question, update its answer and increment hitCount.',
            '7. **Prune**: Drop entries that appear trivial or overly specific to a single context.',
            '',
            '## Output Format',
            'Respond with ONLY a JSON array of consolidated entries. No markdown fences, no explanation.',
            'Each entry must have this exact shape:',
            '```',
            '{',
            '  "id": "<unique-kebab-case-id>",',
            '  "question": "<normalized question>",',
            '  "answer": "<best answer>",',
            '  "topics": ["<topic1>", "<topic2>"],',
            '  "gitHash": "<most-recent-git-hash-or-null>",',
            '  "toolSources": ["<tool1>", "<tool2>"],',
            '  "createdAt": "<ISO-8601>",',
            '  "hitCount": <number>',
            '}',
            '```',
        ].join('\n');
    }

    /** Parse AI response into ConsolidatedToolCallEntry[], defensively handling malformed output. */
    parseConsolidatedResponse(response: string): ConsolidatedToolCallEntry[] {
        let cleaned = response.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const parsed = JSON.parse(cleaned);

        if (!Array.isArray(parsed)) {
            throw new Error('AI response is not a JSON array');
        }

        return parsed.map((entry: Record<string, unknown>) => ({
            id: String(entry.id ?? randomUUID()),
            question: String(entry.question ?? ''),
            answer: String(entry.answer ?? ''),
            topics: Array.isArray(entry.topics) ? entry.topics.map(String) : [],
            gitHash: entry.gitHash ? String(entry.gitHash) : undefined,
            toolSources: Array.isArray(entry.toolSources) ? entry.toolSources.map(String) : [],
            createdAt: String(entry.createdAt ?? new Date().toISOString()),
            hitCount: typeof entry.hitCount === 'number' ? entry.hitCount : 1,
        }));
    }
}
