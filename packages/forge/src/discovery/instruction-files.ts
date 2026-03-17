import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../logger';
import type { InstructionFileSet } from './types';

/** Maximum combined instruction size (50 KB) */
export const MAX_INSTRUCTION_SIZE = 50 * 1024;

/** Directory within a repo that holds instruction files */
export const INSTRUCTION_DIR = '.github/coc';

/** File names for each scope */
const INSTRUCTION_FILES = {
    base: 'instructions.md',
    ask: 'instructions-ask.md',
    plan: 'instructions-plan.md',
    autopilot: 'instructions-autopilot.md',
} as const;

export type InstructionMode = keyof typeof INSTRUCTION_FILES;

/**
 * Discover which instruction files exist for the given repository root.
 * Returns an `InstructionFileSet` with absolute paths for files that are present.
 */
export function findInstructionFiles(rootDir: string): InstructionFileSet {
    const dir = path.join(rootDir, INSTRUCTION_DIR);
    const result: InstructionFileSet = {};
    for (const [key, filename] of Object.entries(INSTRUCTION_FILES) as [InstructionMode, string][]) {
        const filePath = path.join(dir, filename);
        if (fs.existsSync(filePath)) {
            result[key] = filePath;
        }
    }
    return result;
}

/**
 * Load and concatenate instructions for the given repo root and chat mode.
 *
 * Injection order: base instructions first, then mode-specific instructions.
 * Combined content is capped at {@link MAX_INSTRUCTION_SIZE} bytes.
 *
 * @returns Combined instruction string wrapped in `<custom_instruction>` tags,
 *          or `undefined` if no relevant files exist or both are empty.
 */
export async function loadInstructions(
    rootDir: string,
    mode: InstructionMode
): Promise<string | undefined> {
    const fileSet = findInstructionFiles(rootDir);
    const parts: string[] = [];

    for (const key of ['base', mode] as InstructionMode[]) {
        if (key === mode && key === 'base') continue; // avoid duplicating 'base' if mode === 'base'
        const filePath = fileSet[key];
        if (!filePath) continue;
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const trimmed = content.trim();
            if (trimmed) {
                parts.push(trimmed);
            }
        } catch (err) {
            getLogger().debug('Discovery', `Failed to read instruction file ${filePath}: ${err}`);
        }
    }

    if (parts.length === 0) return undefined;

    const combined = parts.join('\n\n');
    const bytes = Buffer.byteLength(combined, 'utf-8');
    if (bytes > MAX_INSTRUCTION_SIZE) {
        getLogger().warn(
            'Discovery',
            `Repo instructions for '${rootDir}' exceed ${MAX_INSTRUCTION_SIZE} bytes (${bytes} bytes). Content will be truncated.`
        );
        return `<custom_instruction>\n${combined.slice(0, MAX_INSTRUCTION_SIZE)}\n</custom_instruction>`;
    }

    return `<custom_instruction>\n${combined}\n</custom_instruction>`;
}
