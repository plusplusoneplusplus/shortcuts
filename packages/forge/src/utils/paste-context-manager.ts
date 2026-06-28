/**
 * Paste Context Manager
 *
 * Handles large pasted content by saving it to temp files and providing
 * file-path references for AI prompts. This avoids blowing up the context
 * window when users paste large logs, JSON, or stack traces.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getRepoDataPath } from '../paths';

// ============================================================================
// Constants
// ============================================================================

/** Minimum character count before content is externalized to a temp file. */
export const PASTE_THRESHOLD = 16_384;

/** Maximum character count for a "question prefix" that precedes pasted content. */
const MAX_QUESTION_PREFIX_LENGTH = 500;

/** Default max age for stale paste files (1 hour). */
const DEFAULT_MAX_AGE_MS = 3_600_000;

/** Subdirectory name under the repo data path. */
const PASTE_CONTEXT_DIR = 'paste-context';

// ============================================================================
// Content Sniffing
// ============================================================================

/**
 * Detect file extension based on content heuristics.
 * Returns '.json', '.md', or '.txt'.
 */
export function sniffContentExtension(content: string): string {
    const trimmed = content.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            JSON.parse(trimmed.length > 10_000 ? trimmed.slice(0, 10_000) : trimmed);
            return '.json';
        } catch {
            // After parse fails, only treat as JSON if it looks structural:
            // Objects always look JSON-ish; arrays need JSON-like first element
            if (trimmed.startsWith('{')) return '.json';
            if (/^\[\s*["{[\[]/.test(trimmed)) return '.json';
        }
    }
    // Markdown detection: has headers or fenced code blocks
    const hasMdHeaders = /^#{1,6}\s/m.test(trimmed);
    const fencedCodeMarker = '\u0060\u0060\u0060';
    const hasFencedCode = trimmed.includes(fencedCodeMarker);
    if (hasMdHeaders || hasFencedCode) {
        return '.md';
    }
    return '.txt';
}

// ============================================================================
// Question / Paste Separation
// ============================================================================

export interface SeparatedContent {
    /** Short question prefix, if detected. */
    question: string | undefined;
    /** The large pasted content block. */
    pastedContent: string;
}

/**
 * Attempt to separate a short question prefix from a large pasted block.
 *
 * Heuristic: if the text starts with a short block (≤500 chars) followed by
 * a blank line and then a large block, treat the short block as the question.
 */
export function separateQuestionFromPaste(text: string): SeparatedContent {
    // Look for a blank-line boundary (two consecutive newlines)
    const blankLineIdx = text.search(/\n\s*\n/);
    if (blankLineIdx === -1 || blankLineIdx > MAX_QUESTION_PREFIX_LENGTH) {
        return { question: undefined, pastedContent: text };
    }

    const question = text.slice(0, blankLineIdx).trim();
    const rest = text.slice(blankLineIdx).trim();

    // Only separate if the question is short and the rest is large
    if (question.length > 0 && question.length <= MAX_QUESTION_PREFIX_LENGTH && rest.length > PASTE_THRESHOLD) {
        return { question, pastedContent: rest };
    }

    return { question: undefined, pastedContent: text };
}

// ============================================================================
// Save / Cleanup
// ============================================================================

export interface SavePasteResult {
    /** Absolute path to the saved temp file. */
    filePath: string;
    /** Call this to delete the temp file when done. */
    cleanup: () => void;
}

/**
 * Save large pasted content to a temp file under the repo's paste-context dir.
 *
 * @param dataDir      - Root data directory (e.g. ~/.coc).
 * @param workspaceId  - Workspace identifier for repo-scoped storage.
 * @param content      - The large content to externalize.
 * @returns The absolute file path and a cleanup function.
 */
export async function savePasteContent(
    dataDir: string,
    workspaceId: string,
    content: string,
): Promise<SavePasteResult> {
    const ext = sniffContentExtension(content);
    const id = crypto.randomUUID().slice(0, 8);
    const filename = `${id}${ext}`;
    const dir = getRepoDataPath(dataDir, workspaceId, PASTE_CONTEXT_DIR);
    await fs.promises.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, filename);
    await fs.promises.writeFile(filePath, content, 'utf-8');

    const cleanup = () => {
        try {
            fs.rmSync(filePath, { force: true });
        } catch {
            // Best-effort cleanup
        }
    };

    return { filePath, cleanup };
}

// ============================================================================
// Prompt Rewriting
// ============================================================================

/**
 * Build a replacement prompt snippet that references the externalized file.
 *
 * @param filePath         - Absolute path to the saved paste file.
 * @param charCount        - Character count of the externalized content.
 * @param questionPrefix   - Optional short question that preceded the paste.
 */
export function buildPasteFileReference(
    filePath: string,
    charCount: number,
    questionPrefix?: string,
): string {
    const reference = [
        `The user provided a large text content (approximately ${charCount} characters).`,
        `It has been saved to: ${filePath}`,
        `Read the file to examine its contents. Focus on the parts relevant to the user's question.`,
    ].join('\n');

    if (questionPrefix) {
        return `${questionPrefix}\n\n${reference}`;
    }
    return reference;
}

/**
 * If the prompt exceeds the paste threshold, externalize the large content
 * and return a rewritten prompt with a file-path reference.
 *
 * Returns undefined if no rewriting was needed (prompt is small enough).
 *
 * @param prompt       - The original prompt string.
 * @param dataDir      - Root data directory.
 * @param workspaceId  - Workspace identifier.
 */
export async function rewriteLargePrompt(
    prompt: string,
    dataDir: string,
    workspaceId: string,
): Promise<{ rewrittenPrompt: string; cleanup: () => void } | undefined> {
    if (prompt.length <= PASTE_THRESHOLD) {
        return undefined;
    }

    const { question, pastedContent } = separateQuestionFromPaste(prompt);
    const { filePath, cleanup } = await savePasteContent(dataDir, workspaceId, pastedContent);

    const rewrittenPrompt = buildPasteFileReference(filePath, pastedContent.length, question);
    return { rewrittenPrompt, cleanup };
}

// ============================================================================
// Stale File Cleanup
// ============================================================================

/**
 * Delete paste-context files older than maxAgeMs for a specific workspace.
 */
export async function cleanupStalePasteFiles(
    dataDir: string,
    workspaceId: string,
    maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<number> {
    const dir = getRepoDataPath(dataDir, workspaceId, PASTE_CONTEXT_DIR);
    return cleanupStaleFilesInDir(dir, maxAgeMs);
}

/**
 * Scan all repo paste-context directories and delete stale files.
 * Intended to run once on server startup.
 */
export async function cleanupAllStalePasteFiles(
    dataDir: string,
    maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<number> {
    const reposDir = path.join(dataDir, 'repos');
    let totalCleaned = 0;

    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(reposDir, { withFileTypes: true });
    } catch {
        return 0; // repos dir doesn't exist yet
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pasteDir = path.join(reposDir, entry.name, PASTE_CONTEXT_DIR);
        totalCleaned += await cleanupStaleFilesInDir(pasteDir, maxAgeMs);
    }

    return totalCleaned;
}

async function cleanupStaleFilesInDir(dir: string, maxAgeMs: number): Promise<number> {
    let files: fs.Dirent[];
    try {
        files = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return 0; // Directory doesn't exist
    }

    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
        if (!file.isFile()) continue;
        const filePath = path.join(dir, file.name);
        try {
            const stat = await fs.promises.stat(filePath);
            if (now - stat.mtimeMs > maxAgeMs) {
                await fs.promises.unlink(filePath);
                cleaned++;
            }
        } catch {
            // Best-effort: file may have been removed concurrently
        }
    }

    return cleaned;
}
