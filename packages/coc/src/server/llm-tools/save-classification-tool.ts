/**
 * Save Classification Tool
 *
 * Per-invocation `saveClassification` LLM tool. Persists a complete
 * `DiffClassificationResult` to the file-based classification store
 * (`packages/coc/src/server/repos/classification-store.ts`).
 *
 * Context (workspaceId, repoId, prId, headSha) is pre-bound at construction
 * time via `createSaveClassificationTool()` so the AI only supplies the
 * `classifications` array. Validation is strict — the tool returns an error
 * response when entries are malformed so the AI can retry with corrections.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { HunkClassification } from '../spa/client/react/features/pull-requests/classification-types';
import {
    validateClassificationResult,
    writeClassification,
} from '../repos/classification-store';

export interface SaveClassificationArgs {
    classifications: HunkClassification[];
}

export interface SaveClassificationDeps {
    dataDir: string;
    workspaceId: string;
    repoId: string;
    prId: string;
    headSha: string;
    /** Optional processId stamped onto the stored record. */
    processId?: string;
}

export function createSaveClassificationTool(deps: SaveClassificationDeps) {
    let saved: HunkClassification[] | undefined;

    const tool = defineTool<SaveClassificationArgs>('saveClassification', {
        description:
            'Persist the final hunk classifications for this pull request. ' +
            'Call this exactly once, AFTER you have classified every `@@` hunk in the diff. ' +
            'Pass the full array of classifications (one entry per hunk). ' +
            'Each entry must include: file, hunkIndex (0-based within the file), ' +
            'category (logic|mechanical|test|generated), intensity (high|low), and a one-sentence reason. ' +
            'If validation fails the tool returns an error — read the message, correct the offending entries, and call the tool again.',
        parameters: {
            type: 'object',
            properties: {
                classifications: {
                    type: 'array',
                    description: 'Per-hunk classifications, ordered by file then hunk index.',
                    items: {
                        type: 'object',
                        properties: {
                            file: { type: 'string', description: 'Repo-relative file path as it appears in the diff.' },
                            hunkIndex: { type: 'number', description: '0-based hunk index within the file.' },
                            category: {
                                type: 'string',
                                enum: ['logic', 'mechanical', 'test', 'generated'],
                                description: 'Dominant category for this hunk.',
                            },
                            intensity: {
                                type: 'string',
                                enum: ['high', 'low'],
                                description: 'Reviewer-attention level.',
                            },
                            reason: { type: 'string', description: 'One-sentence justification.' },
                        },
                        required: ['file', 'hunkIndex', 'category', 'intensity', 'reason'],
                    },
                },
            },
            required: ['classifications'],
        },
        handler: async (args) => {
            const validation = validateClassificationResult({ classifications: args?.classifications });
            if (!validation.ok) {
                return {
                    success: false,
                    error: validation.error,
                    hint: 'Fix the offending entries and call saveClassification again with the corrected array.',
                };
            }

            try {
                const record = writeClassification(
                    deps.dataDir,
                    deps.workspaceId,
                    deps.repoId,
                    deps.prId,
                    deps.headSha,
                    { classifications: validation.classifications },
                    { processId: deps.processId },
                );
                saved = validation.classifications;
                return {
                    success: true,
                    count: validation.classifications.length,
                    createdAt: record.createdAt,
                };
            } catch (err) {
                return {
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        },
    });

    return {
        tool: tool as Tool<unknown>,
        /** Returns the classifications written by the most recent successful call, if any. */
        getSaved: (): HunkClassification[] | undefined => saved,
    };
}
