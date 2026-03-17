import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    INSTRUCTION_DIR,
    MAX_INSTRUCTION_SIZE,
    findInstructionFiles,
    loadInstructions,
} from '../../src/discovery/instruction-files';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(files: Record<string, string>): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-test-'));
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(tmpDir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
    }
    return tmpDir;
}

function cleanup(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// findInstructionFiles()
// ---------------------------------------------------------------------------

describe('findInstructionFiles', () => {
    let repoDir: string;

    afterEach(() => cleanup(repoDir));

    it('returns empty set when .github/coc/ does not exist', () => {
        repoDir = makeRepo({});
        const result = findInstructionFiles(repoDir);
        expect(result).toEqual({});
    });

    it('discovers only files that are present', () => {
        repoDir = makeRepo({
            [path.join(INSTRUCTION_DIR, 'instructions.md')]: 'base',
            [path.join(INSTRUCTION_DIR, 'instructions-ask.md')]: 'ask',
        });
        const result = findInstructionFiles(repoDir);
        expect(result.base).toBeDefined();
        expect(result.ask).toBeDefined();
        expect(result.plan).toBeUndefined();
        expect(result.autopilot).toBeUndefined();
    });

    it('discovers all four files when all are present', () => {
        repoDir = makeRepo({
            [path.join(INSTRUCTION_DIR, 'instructions.md')]: 'b',
            [path.join(INSTRUCTION_DIR, 'instructions-ask.md')]: 'a',
            [path.join(INSTRUCTION_DIR, 'instructions-plan.md')]: 'p',
            [path.join(INSTRUCTION_DIR, 'instructions-autopilot.md')]: 'ap',
        });
        const result = findInstructionFiles(repoDir);
        expect(result.base).toBeDefined();
        expect(result.ask).toBeDefined();
        expect(result.plan).toBeDefined();
        expect(result.autopilot).toBeDefined();
    });

    it('returns absolute paths', () => {
        repoDir = makeRepo({
            [path.join(INSTRUCTION_DIR, 'instructions.md')]: 'x',
        });
        const result = findInstructionFiles(repoDir);
        expect(path.isAbsolute(result.base!)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// loadInstructions()
// ---------------------------------------------------------------------------

describe('loadInstructions', () => {
    let repoDir: string;

    afterEach(() => cleanup(repoDir));

    it('returns undefined when no files exist', async () => {
        repoDir = makeRepo({});
        const result = await loadInstructions(repoDir, 'ask');
        expect(result).toBeUndefined();
    });

    it('returns base instructions for any mode when only base exists', async () => {
        repoDir = makeRepo({
            [path.join(INSTRUCTION_DIR, 'instructions.md')]: 'Base content',
        });
        const result = await loadInstructions(repoDir, 'plan');
        expect(result).toContain('Base content');
        expect(result).toMatch(/<custom_instruction>/);
        expect(result).toMatch(/<\/custom_instruction>/);
    });

    it('returns only mode-specific instructions when base is absent', async () => {
        repoDir = makeRepo({
            [path.join(INSTRUCTION_DIR, 'instructions-autopilot.md')]: 'Autopilot only',
        });
        const result = await loadInstructions(repoDir, 'autopilot');
        expect(result).toContain('Autopilot only');
    });

    it('concatenates base + mode-specific with base first', async () => {
        repoDir = makeRepo({
            [path.join(INSTRUCTION_DIR, 'instructions.md')]: 'BASE',
            [path.join(INSTRUCTION_DIR, 'instructions-ask.md')]: 'ASK',
        });
        const result = await loadInstructions(repoDir, 'ask');
        expect(result).toBeDefined();
        const idx_base = result!.indexOf('BASE');
        const idx_ask = result!.indexOf('ASK');
        expect(idx_base).toBeLessThan(idx_ask);
    });

    it('does not include mode instructions when a different mode is requested', async () => {
        repoDir = makeRepo({
            [path.join(INSTRUCTION_DIR, 'instructions.md')]: 'BASE',
            [path.join(INSTRUCTION_DIR, 'instructions-ask.md')]: 'ASK',
        });
        const result = await loadInstructions(repoDir, 'plan');
        expect(result).toContain('BASE');
        expect(result).not.toContain('ASK');
    });

    it('returns undefined when all present files are empty', async () => {
        repoDir = makeRepo({
            [path.join(INSTRUCTION_DIR, 'instructions.md')]: '   \n  ',
        });
        const result = await loadInstructions(repoDir, 'ask');
        expect(result).toBeUndefined();
    });

    it('truncates combined content exceeding MAX_INSTRUCTION_SIZE', async () => {
        const bigContent = 'x'.repeat(MAX_INSTRUCTION_SIZE + 100);
        repoDir = makeRepo({
            [path.join(INSTRUCTION_DIR, 'instructions.md')]: bigContent,
        });
        const result = await loadInstructions(repoDir, 'ask');
        expect(result).toBeDefined();
        // Truncated content should not exceed the limit (+tags overhead)
        expect(Buffer.byteLength(result!, 'utf-8')).toBeLessThan(MAX_INSTRUCTION_SIZE + 200);
    });

    it('wraps content in <custom_instruction> tags', async () => {
        repoDir = makeRepo({
            [path.join(INSTRUCTION_DIR, 'instructions.md')]: 'Hello',
        });
        const result = await loadInstructions(repoDir, 'ask');
        expect(result).toBe('<custom_instruction>\nHello\n</custom_instruction>');
    });
});
