import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BoundedMemoryStore } from '../../src/memory/bounded-memory-store';
import { MemoryRecallIndex } from '../../src/memory/memory-recall-index';
import {
    MemoryPromptBuilder,
    MEMORY_GUIDANCE,
    ENTRY_DELIMITER,
    getMemoryGuidance,
} from '../../src/memory/memory-prompt-builder';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mem-prompt-'));
}

function writeMemory(dir: string, content: string, filename = 'MEMORY.md'): string {
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

async function loadedStore(filePath: string, charLimit?: number): Promise<BoundedMemoryStore> {
    const store = new BoundedMemoryStore({ filePath, charLimit });
    await store.load();
    return store;
}

describe('MemoryPromptBuilder', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = makeTempDir();
    });

    it('empty store → getSystemPromptBlock() returns null', async () => {
        const filePath = path.join(tmpDir, 'MEMORY.md');
        const store = await loadedStore(filePath);
        const builder = new MemoryPromptBuilder({ store });
        expect(builder.getSystemPromptBlock()).toBeNull();
    });

    it('single entry → block contains separator, header, content', async () => {
        const filePath = writeMemory(tmpDir, 'Project uses TypeScript');
        const store = await loadedStore(filePath, 3000);
        const builder = new MemoryPromptBuilder({ store });

        const block = builder.getSystemPromptBlock();
        expect(block).not.toBeNull();
        expect(block!).toContain('══════════════════════════════════════════════');
        expect(block!).toContain('MEMORY (your personal notes)');
        expect(block!).toContain('Project uses TypeScript');
        expect(block!).toContain(MEMORY_GUIDANCE);
    });

    it('multiple entries → entries joined by § delimiter', async () => {
        const entries = [
            'Project uses TypeScript',
            'API follows REST conventions',
            'Build with npm run build',
        ];
        const filePath = writeMemory(tmpDir, entries.join(ENTRY_DELIMITER));
        const store = await loadedStore(filePath, 3000);
        const builder = new MemoryPromptBuilder({ store });

        const block = builder.getSystemPromptBlock()!;
        for (const entry of entries) {
            expect(block).toContain(entry);
        }
        // § appears as delimiter between entries
        expect(block).toContain('§');
    });

    it('usage percentage calculation', async () => {
        // Create content of known length with a limit of 100
        const content = 'a'.repeat(67);
        const filePath = writeMemory(tmpDir, content);
        const store = await loadedStore(filePath, 100);
        const builder = new MemoryPromptBuilder({ store });

        const block = builder.getSystemPromptBlock()!;
        expect(block).toContain('[67% — 67/100 chars]');
    });

    it('usage percentage clamps at 100%', async () => {
        // Force content longer than limit by loading with a tiny limit after writing
        const content = 'This is some content that is quite long';
        const filePath = writeMemory(tmpDir, content);
        const store = await loadedStore(filePath, 10);
        const builder = new MemoryPromptBuilder({ store });

        const block = builder.getSystemPromptBlock()!;
        expect(block).toContain('[100% —');
    });

    it('frozen snapshot — mutations after construction do not affect output', async () => {
        const filePath = writeMemory(tmpDir, 'original entry');
        const store = await loadedStore(filePath, 3000);
        const builder = new MemoryPromptBuilder({ store });

        const blockBefore = builder.getSystemPromptBlock()!;

        // Mutate the store
        await store.add('new entry added after construction');

        const blockAfter = builder.getSystemPromptBlock()!;
        expect(blockAfter).toBe(blockBefore);
        expect(blockAfter).toContain('original entry');
        expect(blockAfter).not.toContain('new entry added after construction');
    });

    it('repo + system blocks — both rendered with separate headers', async () => {
        const repoDir = makeTempDir();
        const sysDir = makeTempDir();
        const repoPath = writeMemory(repoDir, 'repo fact');
        const sysPath = writeMemory(sysDir, 'system fact');

        const repoStore = await loadedStore(repoPath, 3000);
        const systemStore = await loadedStore(sysPath, 2000);

        const builder = new MemoryPromptBuilder({ store: repoStore, systemStore });
        const block = builder.getSystemPromptBlock()!;

        expect(block).toContain('MEMORY (your personal notes)');
        expect(block).toContain('SYSTEM MEMORY (cross-project notes)');
        // MEMORY_GUIDANCE appears exactly once
        const guidanceCount = block.split(MEMORY_GUIDANCE).length - 1;
        expect(guidanceCount).toBe(1);
    });

    it('repo only, no system — system header absent', async () => {
        const filePath = writeMemory(tmpDir, 'repo fact');
        const store = await loadedStore(filePath, 3000);
        const builder = new MemoryPromptBuilder({ store });

        const block = builder.getSystemPromptBlock()!;
        expect(block).toContain('MEMORY (your personal notes)');
        expect(block).not.toContain('SYSTEM MEMORY');
    });

    it('system only, no repo — repo header absent', async () => {
        const emptyPath = path.join(tmpDir, 'MEMORY.md');
        const sysDir = makeTempDir();
        const sysPath = writeMemory(sysDir, 'system fact');

        const repoStore = await loadedStore(emptyPath, 3000);
        const systemStore = await loadedStore(sysPath, 2000);

        const builder = new MemoryPromptBuilder({ store: repoStore, systemStore });
        const block = builder.getSystemPromptBlock()!;

        expect(block).toContain('SYSTEM MEMORY (cross-project notes)');
        expect(block).not.toContain('MEMORY (your personal notes)');
    });

    it('getGuidance() returns MEMORY_GUIDANCE constant', async () => {
        const filePath = path.join(tmpDir, 'MEMORY.md');
        const store = await loadedStore(filePath);
        const builder = new MemoryPromptBuilder({ store });

        expect(builder.getGuidance()).toBe(MEMORY_GUIDANCE);
    });

    it('whitespace-only file content treated as empty', async () => {
        const filePath = writeMemory(tmpDir, '   \n  ');
        const store = await loadedStore(filePath, 3000);
        const builder = new MemoryPromptBuilder({ store });

        expect(builder.getSystemPromptBlock()).toBeNull();
    });

    it('exact snapshot format — inline snapshot test', async () => {
        const entries = [
            'Project uses TypeScript with Vitest for testing',
            'API endpoints follow REST conventions with kebab-case paths',
            'Build with npm run build, test with npm run test',
        ];
        const filePath = writeMemory(tmpDir, entries.join(ENTRY_DELIMITER));
        const store = await loadedStore(filePath, 3000);
        const builder = new MemoryPromptBuilder({ store });

        const block = builder.getSystemPromptBlock()!;

        // Verify structural format
        const lines = block.split('\n');
        // First line is separator
        expect(lines[0]).toBe('══════════════════════════════════════════════');
        // Second line is header with usage
        expect(lines[1]).toMatch(/^MEMORY \(your personal notes\) \[\d+% — [\d,]+\/[\d,]+ chars\]$/);
        // Third line is separator
        expect(lines[2]).toBe('══════════════════════════════════════════════');
        // Content follows
        expect(block).toContain(entries[0]);
        expect(block).toContain(entries[1]);
        expect(block).toContain(entries[2]);
        // Ends with guidance
        expect(block).toContain(MEMORY_GUIDANCE);
    });

    it('ranked recall injects relevant repo memory and protected system memory only', async () => {
        const repoDir = makeTempDir();
        const sysDir = makeTempDir();
        const repoPath = writeMemory(repoDir, [
            'User prefers dark mode',
            'Project uses Vitest for package tests',
            'Deploy production with Docker',
        ].join(ENTRY_DELIMITER));
        const sysPath = writeMemory(sysDir, 'Always prefer Windows-style paths');
        const repoStore = await loadedStore(repoPath, 3000);
        const systemStore = await loadedStore(sysPath, 3000);
        const recallIndex = new MemoryRecallIndex({ dbPath: path.join(makeTempDir(), 'recall.db') });

        try {
            const builder = new MemoryPromptBuilder({
                store: repoStore,
                systemStore,
                recall: {
                    index: recallIndex,
                    namespace: 'ws-test',
                    query: 'How do I run vitest tests?',
                    maxEntries: 1,
                    charBudget: 120,
                },
            });

            const block = builder.getSystemPromptBlock()!;

            expect(block).toContain('Project uses Vitest for package tests');
            expect(block).toContain('Always prefer Windows-style paths');
            expect(block).not.toContain('User prefers dark mode');
            expect(block).not.toContain('Deploy production with Docker');
        } finally {
            recallIndex.close();
        }
    });

    // -----------------------------------------------------------------------
    // Write frequency support
    // -----------------------------------------------------------------------

    describe('write frequency', () => {
        it('default (no writeFrequency) → uses medium guidance', async () => {
            const filePath = writeMemory(tmpDir, 'fact');
            const store = await loadedStore(filePath, 3000);
            const builder = new MemoryPromptBuilder({ store });

            const block = builder.getSystemPromptBlock()!;
            expect(block).toContain(MEMORY_GUIDANCE);
            expect(builder.getGuidance()).toBe(MEMORY_GUIDANCE);
        });

        it('writeFrequency "medium" → uses default MEMORY_GUIDANCE', async () => {
            const filePath = writeMemory(tmpDir, 'fact');
            const store = await loadedStore(filePath, 3000);
            const builder = new MemoryPromptBuilder({ store, writeFrequency: 'medium' });

            const block = builder.getSystemPromptBlock()!;
            expect(block).toContain(MEMORY_GUIDANCE);
            expect(builder.getGuidance()).toBe(MEMORY_GUIDANCE);
        });

        it('writeFrequency "low" → uses low guidance', async () => {
            const filePath = writeMemory(tmpDir, 'fact');
            const store = await loadedStore(filePath, 3000);
            const builder = new MemoryPromptBuilder({ store, writeFrequency: 'low' });

            const block = builder.getSystemPromptBlock()!;
            expect(block).toContain('sparingly');
            expect(block).not.toContain(MEMORY_GUIDANCE);
            expect(builder.getGuidance()).toContain('sparingly');
        });

        it('writeFrequency "high" → uses high guidance', async () => {
            const filePath = writeMemory(tmpDir, 'fact');
            const store = await loadedStore(filePath, 3000);
            const builder = new MemoryPromptBuilder({ store, writeFrequency: 'high' });

            const block = builder.getSystemPromptBlock()!;
            expect(block).toContain('Actively capture');
            expect(block).not.toContain(MEMORY_GUIDANCE);
            expect(builder.getGuidance()).toContain('Actively capture');
        });

        it('frozen guidance — writeFrequency does not change after construction', async () => {
            const filePath = writeMemory(tmpDir, 'fact');
            const store = await loadedStore(filePath, 3000);
            const builder = new MemoryPromptBuilder({ store, writeFrequency: 'high' });

            const block1 = builder.getSystemPromptBlock();
            const block2 = builder.getSystemPromptBlock();
            expect(block1).toBe(block2);
        });
    });
});

// ---------------------------------------------------------------------------
// getMemoryGuidance tests
// ---------------------------------------------------------------------------

describe('getMemoryGuidance', () => {
    it('returns MEMORY_GUIDANCE for undefined', () => {
        expect(getMemoryGuidance()).toBe(MEMORY_GUIDANCE);
    });

    it('returns MEMORY_GUIDANCE for medium', () => {
        expect(getMemoryGuidance('medium')).toBe(MEMORY_GUIDANCE);
    });

    it('returns low guidance for low', () => {
        const g = getMemoryGuidance('low');
        expect(g).toContain('sparingly');
        expect(g).not.toBe(MEMORY_GUIDANCE);
    });

    it('returns high guidance for high', () => {
        const g = getMemoryGuidance('high');
        expect(g).toContain('Actively capture');
        expect(g).not.toBe(MEMORY_GUIDANCE);
    });
});
