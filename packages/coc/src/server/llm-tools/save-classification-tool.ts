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
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { HunkClassification } from '../spa/client/react/features/pull-requests/classification-types';
import type { PullRequestStorageScopeInput } from '../repos/pr-origin-scope';
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
    /** Optional canonical origin storage scope for shared PR classification state. */
    storageScope?: PullRequestStorageScopeInput;
}

export function createSaveClassificationTool(deps: SaveClassificationDeps) {
    let saved: HunkClassification[] | undefined;

    const tool = defineTool<SaveClassificationArgs>('saveClassification', {
        description:
            'Persist the final hunk classifications for this diff. ' +
            'Call this exactly once, AFTER you have classified every `@@` hunk in the diff. ' +
            'Test hunks must include testFidelityComment; logic hunks must include summaryComment. ' +
            'If validation fails the tool returns an error — read the message, fix the offending entries, and call again.',
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
                                enum: ['logic', 'mechanical', 'test', 'simple', 'generated'],
                                description: 'Dominant category for this hunk.',
                            },
                            intensity: {
                                type: 'string',
                                enum: ['high', 'low'],
                                description: 'Reviewer-attention level.',
                            },
                            reason: { type: 'string', description: 'One-sentence justification.' },
                            testFidelityComment: {
                                type: 'string',
                                description: 'Required for test hunks: high/medium/low fidelity and why.',
                            },
                            summaryComment: {
                                type: 'string',
                                description: 'Required for logic hunks: concise behavior/API/data-flow/error-handling summary.',
                            },
                            critical: {
                                type: 'object',
                                description: 'Critical existing-function metadata. Omit when the hunk is not critical.',
                                properties: {
                                    label: {
                                        type: 'string',
                                        description: 'Short criticality label, such as exported API, route handler, persistence path, or security-sensitive function.',
                                    },
                                    impactSummary: {
                                        type: 'string',
                                        description: 'One short statement of reviewer-impact.',
                                    },
                                    usages: {
                                        type: 'array',
                                        description: 'Up to 3 usage/caller evidence entries. Use [] only with usageNotDetermined: true.',
                                        maxItems: 3,
                                        items: {
                                            type: 'object',
                                            properties: {
                                                file: { type: 'string', description: 'Repo-relative usage/caller file path.' },
                                                symbol: { type: 'string', description: 'Optional symbol, function, route, or command name.' },
                                                line: { type: 'number', description: 'Optional 1-based line number.' },
                                                description: { type: 'string', description: 'Short explanation of why this usage matters.' },
                                            },
                                            required: ['file', 'description'],
                                        },
                                    },
                                    callPath: {
                                        type: 'array',
                                        description: 'One representative call path, up to 4 frames. Use [] only with callStackNotDetermined: true.',
                                        maxItems: 4,
                                        items: {
                                            type: 'object',
                                            properties: {
                                                file: { type: 'string', description: 'Repo-relative frame file path.' },
                                                symbol: { type: 'string', description: 'Function, route, command, or task handler name.' },
                                                line: { type: 'number', description: 'Optional 1-based line number.' },
                                                description: { type: 'string', description: 'Optional short frame note.' },
                                            },
                                            required: ['file', 'symbol'],
                                        },
                                    },
                                    usageNotDetermined: {
                                        type: 'boolean',
                                        description: 'Set true when usage evidence could not be determined.',
                                    },
                                    callStackNotDetermined: {
                                        type: 'boolean',
                                        description: 'Set true when call-stack evidence could not be determined.',
                                    },
                                },
                                required: ['label', 'impactSummary', 'usages', 'callPath'],
                            },
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
                    {
                        processId: deps.processId,
                        storageScope: deps.storageScope,
                    },
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
