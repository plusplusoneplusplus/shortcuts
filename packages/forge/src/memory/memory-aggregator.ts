import { MemoryStore, MemoryLevel, RawObservation } from './types';
import { AIInvoker } from '../ai/types';

export interface AggregatorOptions {
    /** Minimum raw file count before automatic aggregation triggers. Default: 5 */
    batchThreshold?: number;
}

/**
 * Counts top-level markdown bullet lines (`- `) in the consolidated output.
 */
export function countFacts(content: string): number {
    return content.split('\n').filter(line => line.startsWith('- ')).length;
}

/**
 * Batch consolidation of raw observations into updated consolidated.md.
 *
 * Checks if raw observations have accumulated past a threshold, and if so,
 * consolidates them via an AI call. Safety invariant: raw files are only
 * deleted after the new consolidated content is successfully written.
 */
export class MemoryAggregator {
    private readonly store: MemoryStore;
    private readonly batchThreshold: number;

    constructor(store: MemoryStore, options?: AggregatorOptions) {
        this.store = store;
        this.batchThreshold = options?.batchThreshold ?? 5;
    }

    /**
     * Check raw count against threshold and aggregate if needed.
     * Returns true if aggregation ran, false if skipped.
     */
    async aggregateIfNeeded(
        aiInvoker: AIInvoker,
        level: MemoryLevel,
        repoHash?: string,
    ): Promise<boolean> {
        if (level === 'both') {
            const ranSystem = await this.aggregateIfNeeded(aiInvoker, 'system');
            const ranRepo = await this.aggregateIfNeeded(aiInvoker, 'repo', repoHash);
            return ranSystem || ranRepo;
        }

        const filenames = await this.store.listRaw(level, repoHash);
        if (filenames.length < this.batchThreshold) {
            return false;
        }

        await this.aggregate(aiInvoker, level, repoHash);
        return true;
    }

    /**
     * Force aggregation regardless of threshold.
     * No-op if there are zero raw files.
     */
    async aggregate(
        aiInvoker: AIInvoker,
        level: MemoryLevel,
        repoHash?: string,
    ): Promise<void> {
        if (level === 'both') {
            await this.aggregate(aiInvoker, 'system');
            await this.aggregate(aiInvoker, 'repo', repoHash);
            return;
        }

        // 1. List raw files
        const filenames = await this.store.listRaw(level, repoHash);
        if (filenames.length === 0) {
            return;
        }

        // 2. Read all raw observations
        const results = await Promise.all(
            filenames.map(f => this.store.readRaw(level, repoHash, f)),
        );
        const observations = results.filter((o): o is RawObservation => o !== undefined);

        // 3. Read existing consolidated
        const existing = await this.store.readConsolidated(level, repoHash);

        // 4. Build consolidation prompt
        const prompt = this.buildPrompt(existing, observations);

        // 5. Call AI
        const result = await aiInvoker(prompt);
        if (!result.success) {
            throw new Error(`Aggregation AI call failed: ${result.error ?? 'unknown error'}`);
        }

        // 6. Write new consolidated (MUST succeed before deleting raw)
        await this.store.writeConsolidated(level, result.response!, repoHash);

        // 7. Update index
        await this.store.updateIndex(level, repoHash, {
            lastAggregation: new Date().toISOString(),
            rawCount: 0,
            factCount: countFacts(result.response!),
        });

        // 8. Delete raw files (safe — consolidated already written)
        for (const filename of filenames) {
            await this.store.deleteRaw(level, repoHash, filename);
        }
    }

    private buildPrompt(
        existing: string | null,
        observations: RawObservation[],
    ): string {
        const existingSection = existing ?? 'No existing memory';
        const rawSection = observations
            .map(o => o.content)
            .join('\n\n');

        return [
            '## Existing Memory',
            existingSection,
            '',
            `## New Observations (${observations.length} sessions)`,
            rawSection,
            '',
            'Produce an updated memory document following these rules:',
            '- Deduplicate: merge similar or redundant facts',
            '- Resolve conflicts: newer observations override older ones',
            '- Prune: drop facts that appear no longer relevant',
            '- Categorize: group by topic (conventions, architecture, patterns, tools, gotchas)',
            '- Keep it concise: target <100 facts total',
            '- Use markdown with clear section headers',
        ].join('\n');
    }
}
