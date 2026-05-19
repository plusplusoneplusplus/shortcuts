/**
 * Excalidraw LLM Tools
 *
 * Per-invocation tool factories for creating/updating and reading Excalidraw
 * diagram files. Diagrams are stored as `.excalidraw` JSON files under
 * `~/.coc/repos/<workspaceId>/diagrams/`.
 *
 * Two tools:
 *   - `create_or_update_excalidraw` — upserts a diagram (full-replace)
 *   - `read_excalidraw` — reads an existing diagram
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { defineTool } from '@plusplusoneplusplus/forge';
import type { Tool } from '@plusplusoneplusplus/forge';
import { getRepoDataPath } from '../paths';

// ============================================================================
// Types
// ============================================================================

export interface ExcalidrawToolsDeps {
    dataDir: string;
    workspaceId: string;
}

export interface CreateOrUpdateExcalidrawArgs {
    filename: string;
    content: Record<string, unknown>;
}

export interface ReadExcalidrawArgs {
    filename: string;
}

export interface CreateOrUpdateExcalidrawResult {
    success: boolean;
    filename?: string;
    created?: boolean;
    sizeBytes?: number;
    error?: string;
    excalidrawLink?: string;
}

export interface ReadExcalidrawResult {
    success: boolean;
    filename?: string;
    content?: Record<string, unknown>;
    sizeBytes?: number;
    error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const EXCALIDRAW_EXTENSION = '.excalidraw';

// ============================================================================
// Helpers
// ============================================================================

function getDiagramsRoot(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'diagrams');
}

/**
 * Validate and normalise a diagram filename.
 * Returns the sanitised filename (always ending in `.excalidraw`) or null if invalid.
 */
export function normaliseFilename(raw: string): string | null {
    if (!raw || typeof raw !== 'string') return null;

    const decoded = raw.trim();
    // Reject path traversal
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) return null;

    // Ensure the extension
    const name = decoded.endsWith(EXCALIDRAW_EXTENSION)
        ? decoded
        : decoded + EXCALIDRAW_EXTENSION;

    // No empty base name
    const base = name.slice(0, -EXCALIDRAW_EXTENSION.length);
    if (!base || base.trim().length === 0) return null;

    return name;
}

// ============================================================================
// Tool Factories
// ============================================================================

export function createExcalidrawTools(deps: ExcalidrawToolsDeps): {
    createOrUpdate: Tool<unknown>;
    read: Tool<unknown>;
} {
    const diagramsRoot = getDiagramsRoot(deps.dataDir, deps.workspaceId);

    // ------------------------------------------------------------------
    // create_or_update_excalidraw
    // ------------------------------------------------------------------
    const createOrUpdate = defineTool<CreateOrUpdateExcalidrawArgs>('create_or_update_excalidraw', {
        description:
            'Create or update an Excalidraw diagram file. Provide the full Excalidraw scene JSON — ' +
            'the tool performs a full-replace (not a patch). The filename is auto-suffixed with ' +
            '`.excalidraw` if missing. Returns an `excalidrawLink` that renders inline in chat ' +
            'when included in your response.',
        parameters: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description:
                        'Diagram filename (e.g. "architecture" or "architecture.excalidraw"). ' +
                        'Must not contain path separators or "..".',
                },
                content: {
                    type: 'object',
                    description:
                        'The complete Excalidraw scene JSON object. Must include at minimum ' +
                        'an "elements" array and an "appState" object.',
                },
            },
            required: ['filename', 'content'],
        },
        handler: async (args): Promise<CreateOrUpdateExcalidrawResult> => {
            if (!args?.filename) {
                return { success: false, error: 'filename is required' };
            }
            if (!args.content || typeof args.content !== 'object') {
                return { success: false, error: 'content must be an Excalidraw scene JSON object' };
            }

            const filename = normaliseFilename(args.filename);
            if (!filename) {
                return { success: false, error: 'Invalid filename — must not contain path separators or ".."' };
            }

            try {
                await fs.promises.mkdir(diagramsRoot, { recursive: true });

                const filePath = path.join(diagramsRoot, filename);
                const isNew = !fs.existsSync(filePath);
                const json = JSON.stringify(args.content, null, 2);
                await fs.promises.writeFile(filePath, json, 'utf-8');

                const stat = await fs.promises.stat(filePath);
                return {
                    success: true,
                    filename,
                    created: isNew,
                    sizeBytes: stat.size,
                    excalidrawLink: `excalidraw://${deps.workspaceId}/${filename}`,
                };
            } catch (err) {
                return {
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        },
    });

    // ------------------------------------------------------------------
    // read_excalidraw
    // ------------------------------------------------------------------
    const read = defineTool<ReadExcalidrawArgs>('read_excalidraw', {
        description:
            'Read an existing Excalidraw diagram file and return its full scene JSON. ' +
            'Use this to inspect a diagram before modifying it with `create_or_update_excalidraw`.',
        parameters: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description:
                        'Diagram filename (e.g. "architecture" or "architecture.excalidraw"). ' +
                        'Must not contain path separators or "..".',
                },
            },
            required: ['filename'],
        },
        handler: async (args): Promise<ReadExcalidrawResult> => {
            if (!args?.filename) {
                return { success: false, error: 'filename is required' };
            }

            const filename = normaliseFilename(args.filename);
            if (!filename) {
                return { success: false, error: 'Invalid filename — must not contain path separators or ".."' };
            }

            const filePath = path.join(diagramsRoot, filename);

            try {
                const [raw, stat] = await Promise.all([
                    fs.promises.readFile(filePath, 'utf-8'),
                    fs.promises.stat(filePath),
                ]);
                const content = JSON.parse(raw);
                return {
                    success: true,
                    filename,
                    content,
                    sizeBytes: stat.size,
                };
            } catch (err: any) {
                if (err?.code === 'ENOENT') {
                    return { success: false, error: `Diagram not found: ${filename}` };
                }
                return {
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        },
    });

    return {
        createOrUpdate: createOrUpdate as Tool<unknown>,
        read: read as Tool<unknown>,
    };
}
