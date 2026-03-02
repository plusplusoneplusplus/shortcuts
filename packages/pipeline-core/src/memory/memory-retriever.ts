import { MemoryStore, MemoryLevel } from './types';

/**
 * Loads consolidated memory from the MemoryStore and formats it
 * as a markdown context block suitable for prompt injection.
 */
export class MemoryRetriever {
    constructor(private store: MemoryStore) {}

    /**
     * Retrieve consolidated memory at the given level.
     *
     * - `'repo'`   — returns raw repo consolidated content or null
     * - `'system'` — returns raw system consolidated content or null
     * - `'both'`   — returns a formatted markdown block combining both levels
     */
    async retrieve(level: MemoryLevel, repoHash?: string): Promise<string | null> {
        if (level === 'repo') {
            return this.readAndNormalize('repo', repoHash);
        }

        if (level === 'system') {
            return this.readAndNormalize('system');
        }

        // level === 'both'
        const [repo, system] = await Promise.all([
            this.readAndNormalize('repo', repoHash),
            this.readAndNormalize('system'),
        ]);

        if (!repo && !system) {
            return null;
        }

        const sections: string[] = [];

        if (repo) {
            sections.push(`### Project-Specific\n\n${repo}`);
        }

        if (system) {
            sections.push(`### General Knowledge\n\n${system}`);
        }

        return `## Context from Memory\n\n${sections.join('\n\n')}\n`;
    }

    private async readAndNormalize(
        level: 'repo' | 'system',
        repoHash?: string,
    ): Promise<string | null> {
        const raw = await this.store.readConsolidated(level, repoHash);
        if (raw === null || raw.trim().length === 0) {
            return null;
        }
        return raw.trim();
    }
}
