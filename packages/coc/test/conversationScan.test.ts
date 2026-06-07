import { describe, it, expect } from 'vitest';
import {
    scanTurnsForCreatedFiles,
    PINNED_EXTENSIONS,
} from '../src/server/spa/client/react/utils/conversationScan';
import type { ClientConversationTurn } from '../src/server/spa/client/react/types/dashboard';

// ============================================================================
// Helpers
// ============================================================================

function makeTurn(
    toolCalls: Array<{ toolName: string; args: Record<string, string>; status?: string }>,
    useTimeline = true
): ClientConversationTurn {
    const tc = toolCalls.map((t, i) => ({
        id: `tc${i}`,
        toolName: t.toolName,
        args: t.args,
        status: (t.status ?? 'completed') as 'pending' | 'running' | 'completed' | 'failed',
    }));

    if (useTimeline) {
        return {
            role: 'assistant',
            content: '',
            timeline: tc
                .filter(t => t.status === 'completed')
                .map(t => ({ type: 'tool-complete' as const, timestamp: '', toolCall: t })),
        };
    }

    // Historical turns: no timeline, only toolCalls
    return {
        role: 'assistant',
        content: '',
        timeline: [],
        toolCalls: tc,
    };
}

/**
 * Build a turn that mimics persisted data: tool-complete entries
 * have `name` instead of `toolName`, and args may be empty.
 */
function makePersistedTurn(
    toolCalls: Array<{
        id?: string;
        name: string;
        toolName?: string;
        args: Record<string, string>;
        result?: string;
    }>
): ClientConversationTurn {
    return {
        role: 'assistant',
        content: '',
        timeline: toolCalls.map((t, i) => ({
            type: 'tool-complete' as const,
            timestamp: '',
            toolCall: {
                id: t.id ?? `tc${i}`,
                toolName: t.toolName ?? '',
                name: t.name,
                args: t.args,
                result: t.result,
                status: 'completed' as const,
            } as any,
        })),
    };
}

/**
 * Build a turn that mimics live SSE data: tool-start has full info,
 * tool-complete has toolName='unknown' and args={}.
 */
function makeLiveSSETurn(
    toolCalls: Array<{
        id: string;
        toolName: string;
        args: Record<string, string>;
        result?: string;
    }>
): ClientConversationTurn {
    const timeline: ClientConversationTurn['timeline'] = [];
    for (const t of toolCalls) {
        // tool-start: has full toolName + parameters
        timeline.push({
            type: 'tool-start' as const,
            timestamp: '',
            toolCall: {
                id: t.id,
                toolName: t.toolName,
                args: t.args,
                status: 'running' as const,
            },
        });
        // tool-complete: toolName='unknown', args={}
        timeline.push({
            type: 'tool-complete' as const,
            timestamp: '',
            toolCall: {
                id: t.id,
                toolName: 'unknown',
                args: {},
                result: t.result,
                status: 'completed' as const,
            },
        });
    }
    return { role: 'assistant', content: '', timeline };
}

// ============================================================================
// scanTurnsForCreatedFiles
// ============================================================================

describe('scanTurnsForCreatedFiles', () => {
    it('returns empty for empty turns', () => {
        expect(scanTurnsForCreatedFiles([])).toEqual([]);
    });

    it('returns empty when no create tool calls', () => {
        const turns: ClientConversationTurn[] = [
            makeTurn([{ toolName: 'read_file', args: { path: '/some/file.md' } }]),
        ];
        expect(scanTurnsForCreatedFiles(turns)).toEqual([]);
    });

    it('detects a single create call via timeline', () => {
        const turns = [
            makeTurn([{ toolName: 'create', args: { path: '/tmp/plan.md' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe('/tmp/plan.md');
        expect(results[0].turnIndex).toBe(0);
    });

    it('detects write_file tool name as well', () => {
        const turns = [
            makeTurn([{ toolName: 'write_file', args: { path: '/tmp/notes.txt' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe('/tmp/notes.txt');
    });

    it('detects create_file tool name (Copilot CLI agent)', () => {
        const turns = [
            makeTurn([{ toolName: 'create_file', args: { path: '/home/user/.copilot/session-state/abc123/plan.md' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe('/home/user/.copilot/session-state/abc123/plan.md');
    });

    it('filters out non-pinned extensions (.js, .png)', () => {
        const turns = [
            makeTurn([
                { toolName: 'create', args: { path: '/tmp/script.js' } },
                { toolName: 'create', args: { path: '/tmp/image.png' } },
                { toolName: 'create', args: { path: '/tmp/plan.md' } },
            ]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe('/tmp/plan.md');
    });

    it('deduplicates the same path created twice', () => {
        const turns = [
            makeTurn([{ toolName: 'create', args: { path: '/tmp/plan.md' } }]),
            makeTurn([{ toolName: 'create', args: { path: '/tmp/plan.md' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].turnIndex).toBe(0);
    });

    it('returns multiple distinct files in order', () => {
        const turns = [
            makeTurn([{ toolName: 'create', args: { path: '/tmp/spec.md' } }]),
            makeTurn([{ toolName: 'create', args: { path: '/tmp/plan.md' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(2);
        expect(results[0].filePath).toBe('/tmp/spec.md');
        expect(results[1].filePath).toBe('/tmp/plan.md');
    });

    it('falls back to turn.toolCalls when timeline is empty (historical format)', () => {
        const turns = [
            makeTurn([{ toolName: 'create', args: { path: '/tmp/old.md' } }], false),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe('/tmp/old.md');
    });

    it('ignores failed tool calls (tool-failed events not counted)', () => {
        const turn: ClientConversationTurn = {
            role: 'assistant',
            content: '',
            timeline: [
                {
                    type: 'tool-failed',
                    timestamp: '',
                    toolCall: {
                        id: 'tc0',
                        toolName: 'create',
                        args: { path: '/tmp/failed.md' },
                        status: 'failed',
                    },
                },
            ],
        };
        expect(scanTurnsForCreatedFiles([turn])).toEqual([]);
    });

    it('accepts filePath arg key in addition to path', () => {
        const turns = [
            makeTurn([{ toolName: 'create', args: { filePath: '/tmp/alt.yaml' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe('/tmp/alt.yaml');
    });

    it('all PINNED_EXTENSIONS are accepted', () => {
        const turns = PINNED_EXTENSIONS.map(ext =>
            makeTurn([{ toolName: 'create', args: { path: `/tmp/file${ext}` } }])
        );
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(PINNED_EXTENSIONS.length);
    });

    it('returns correct turnIndex for each record', () => {
        const turns = [
            { role: 'user' as const, content: 'hello', timeline: [] },
            makeTurn([{ toolName: 'create', args: { path: '/tmp/a.md' } }]),
            makeTurn([{ toolName: 'create', args: { path: '/tmp/b.md' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results[0].turnIndex).toBe(1);
        expect(results[1].turnIndex).toBe(2);
    });

    // ==================================================================
    // Bug fix: name vs toolName mismatch (persisted data)
    // ==================================================================

    describe('name fallback (persisted data shape)', () => {
        it('detects create when toolName is empty but name="create"', () => {
            const turns = [
                makePersistedTurn([{ name: 'create', toolName: '', args: { path: '/tmp/plan.md' } }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/plan.md');
        });

        it('detects create when toolName is undefined but name="create"', () => {
            const turn: ClientConversationTurn = {
                role: 'assistant',
                content: '',
                timeline: [{
                    type: 'tool-complete',
                    timestamp: '',
                    toolCall: {
                        id: 'tc0',
                        toolName: undefined as any,
                        name: 'create',
                        args: { path: '/tmp/spec.md' },
                        status: 'completed',
                    } as any,
                }],
            };
            const results = scanTurnsForCreatedFiles([turn]);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/spec.md');
        });

        it('detects write_file via name fallback', () => {
            const turns = [
                makePersistedTurn([{ name: 'write_file', args: { path: '/tmp/notes.txt' } }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
        });

        it('prefers toolName over name when both present', () => {
            const turns = [
                makePersistedTurn([{
                    name: 'read_file',
                    toolName: 'create',
                    args: { path: '/tmp/doc.md' },
                }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/doc.md');
        });
    });

    // ==================================================================
    // Bug fix: args resolution via tool-start entries
    // ==================================================================

    describe('tool-start args resolution (live SSE shape)', () => {
        it('resolves args from tool-start when tool-complete has empty args', () => {
            const turns = [
                makeLiveSSETurn([{
                    id: 'tc-abc',
                    toolName: 'create',
                    args: { path: '/tmp/plan.md' },
                }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/plan.md');
        });

        it('resolves toolName from tool-start when tool-complete has "unknown"', () => {
            const turns = [
                makeLiveSSETurn([{
                    id: 'tc-xyz',
                    toolName: 'create',
                    args: { path: '/tmp/design.yaml' },
                }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/design.yaml');
        });

        it('handles multiple tool calls in same turn via tool-start resolution', () => {
            const turns = [
                makeLiveSSETurn([
                    { id: 'tc1', toolName: 'create', args: { path: '/tmp/a.md' } },
                    { id: 'tc2', toolName: 'create', args: { path: '/tmp/b.json' } },
                ]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(2);
            expect(results.map(r => r.filePath)).toEqual(['/tmp/a.md', '/tmp/b.json']);
        });

        it('ignores non-create tool-start entries', () => {
            const turn: ClientConversationTurn = {
                role: 'assistant',
                content: '',
                timeline: [
                    {
                        type: 'tool-start',
                        timestamp: '',
                        toolCall: { id: 'tc1', toolName: 'read_file', args: { path: '/tmp/read.md' }, status: 'running' as const },
                    },
                    {
                        type: 'tool-complete',
                        timestamp: '',
                        toolCall: { id: 'tc1', toolName: 'unknown', args: {}, status: 'completed' as const },
                    },
                ],
            };
            const results = scanTurnsForCreatedFiles([turn]);
            expect(results).toHaveLength(0);
        });
    });

    // ==================================================================
    // Bug fix: result string parsing as last resort
    // ==================================================================

    describe('result string parsing fallback', () => {
        it('extracts file path from "Created file ..." result text', () => {
            const turn: ClientConversationTurn = {
                role: 'assistant',
                content: '',
                timeline: [{
                    type: 'tool-complete',
                    timestamp: '',
                    toolCall: {
                        id: 'tc0',
                        toolName: 'create',
                        args: {},
                        result: 'Created file C:\\Users\\dev\\project\\plan.md with 7893 characters',
                        status: 'completed',
                    } as any,
                }],
            };
            const results = scanTurnsForCreatedFiles([turn]);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('C:\\Users\\dev\\project\\plan.md');
        });

        it('extracts Unix-style path from result text', () => {
            const turn: ClientConversationTurn = {
                role: 'assistant',
                content: '',
                timeline: [{
                    type: 'tool-complete',
                    timestamp: '',
                    toolCall: {
                        id: 'tc0',
                        toolName: 'create',
                        args: {},
                        result: 'Created file /home/user/project/notes.txt with 512 characters',
                        status: 'completed',
                    } as any,
                }],
            };
            const results = scanTurnsForCreatedFiles([turn]);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/home/user/project/notes.txt');
        });

        it('does not extract path from non-matching result text', () => {
            const turn: ClientConversationTurn = {
                role: 'assistant',
                content: '',
                timeline: [{
                    type: 'tool-complete',
                    timestamp: '',
                    toolCall: {
                        id: 'tc0',
                        toolName: 'create',
                        args: {},
                        result: 'File operation completed successfully',
                        status: 'completed',
                    } as any,
                }],
            };
            const results = scanTurnsForCreatedFiles([turn]);
            expect(results).toHaveLength(0);
        });

        it('prefers args.path over result parsing', () => {
            const turn: ClientConversationTurn = {
                role: 'assistant',
                content: '',
                timeline: [{
                    type: 'tool-complete',
                    timestamp: '',
                    toolCall: {
                        id: 'tc0',
                        toolName: 'create',
                        args: { path: '/primary/path.md' },
                        result: 'Created file /fallback/path.md with 100 characters',
                        status: 'completed',
                    } as any,
                }],
            };
            const results = scanTurnsForCreatedFiles([turn]);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/primary/path.md');
        });

        it('uses result parsing when persisted entry has name but empty args', () => {
            const turns = [
                makePersistedTurn([{
                    name: 'create',
                    args: {},
                    result: 'Created file /tmp/recovered.yaml with 200 characters',
                }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/recovered.yaml');
        });
    });

    // ==================================================================
    // apply_patch support
    // ==================================================================

    describe('apply_patch support', () => {
        /** Build a turn with an apply_patch tool-complete result. */
        function makeApplyPatchResultTurn(
            id: string,
            result: string
        ): ClientConversationTurn {
            return {
                role: 'assistant',
                content: '',
                timeline: [{
                    type: 'tool-complete' as const,
                    timestamp: '',
                    toolCall: {
                        id,
                        toolName: 'apply_patch',
                        args: {},
                        result,
                        status: 'completed' as const,
                    } as any,
                }],
            };
        }

        /** Build a turn with apply_patch tool-start (string args) + tool-complete. */
        function makeApplyPatchArgsTurn(
            id: string,
            patchArgs: string,
            result?: string
        ): ClientConversationTurn {
            return {
                role: 'assistant',
                content: '',
                timeline: [
                    {
                        type: 'tool-start' as const,
                        timestamp: '',
                        toolCall: {
                            id,
                            toolName: 'apply_patch',
                            args: patchArgs,
                            status: 'running' as const,
                        } as any,
                    },
                    {
                        type: 'tool-complete' as const,
                        timestamp: '',
                        toolCall: {
                            id,
                            toolName: 'apply_patch',
                            args: {},
                            result: result ?? '',
                            status: 'completed' as const,
                        } as any,
                    },
                ],
            };
        }

        it('detects single file creation via result text', () => {
            const turns = [
                makeApplyPatchResultTurn('tc0', 'Added 1 file(s): /tmp/plan.md'),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/plan.md');
        });

        it('detects multi-file creation via result text', () => {
            const turns = [
                makeApplyPatchResultTurn('tc0', 'Added 2 file(s): /tmp/a.md, /tmp/b.yaml'),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(2);
            expect(results.map(r => r.filePath)).toEqual(['/tmp/a.md', '/tmp/b.yaml']);
        });

        it('detects file path from tool-start string args', () => {
            const patchArgs = '*** Begin Patch\n*** Add File: /tmp/plan.md\n+# Plan\n+Content';
            const turns = [
                makeApplyPatchArgsTurn('tc0', patchArgs),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/plan.md');
        });

        it('ignores Modified files in result text', () => {
            const turns = [
                makeApplyPatchResultTurn('tc0', 'Modified 1 file(s): /tmp/existing.md'),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(0);
        });

        it('ignores Update File lines in tool-start args, detects Add File', () => {
            const patchArgs = [
                '*** Begin Patch',
                '*** Add File: /tmp/new.md',
                '+# New file',
                '*** Update File: /tmp/old.md',
                ' context line',
                '-old',
                '+new',
            ].join('\n');
            const turns = [
                makeApplyPatchArgsTurn('tc0', patchArgs),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/new.md');
        });

        it('filters out non-pinned extensions', () => {
            const turns = [
                makeApplyPatchResultTurn('tc0', 'Added 2 file(s): /tmp/script.js, /tmp/plan.md'),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/plan.md');
        });

        it('deduplicates paths from tool-start and tool-complete', () => {
            const patchArgs = '*** Begin Patch\n*** Add File: /tmp/plan.md\n+# Plan';
            const turns = [
                makeApplyPatchArgsTurn('tc0', patchArgs, 'Added 1 file(s): /tmp/plan.md'),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/plan.md');
        });

        it('detects apply_patch via name fallback (persisted data)', () => {
            const turns = [
                makePersistedTurn([{
                    name: 'apply_patch',
                    toolName: '',
                    args: {} as any,
                    result: 'Added 1 file(s): /tmp/persisted.md',
                }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/persisted.md');
        });

        it('resolves apply_patch via tool-start name in live SSE (unknown toolName)', () => {
            const turn: ClientConversationTurn = {
                role: 'assistant',
                content: '',
                timeline: [
                    {
                        type: 'tool-start' as const,
                        timestamp: '',
                        toolCall: {
                            id: 'tc0',
                            toolName: 'apply_patch',
                            args: '*** Begin Patch\n*** Add File: /tmp/sse.md\n+# SSE test',
                            status: 'running' as const,
                        } as any,
                    },
                    {
                        type: 'tool-complete' as const,
                        timestamp: '',
                        toolCall: {
                            id: 'tc0',
                            toolName: 'unknown',
                            args: {},
                            result: 'Added 1 file(s): /tmp/sse.md',
                            status: 'completed' as const,
                        },
                    },
                ],
            };
            const results = scanTurnsForCreatedFiles([turn]);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/sse.md');
        });
    });

    // ==================================================================
    // Unified tool set: edit-tool names now recognised
    // ==================================================================

    describe('edit-tool names (unified FILE_WRITE_TOOLS)', () => {
        it('detects edit_file tool call with path arg', () => {
            const turns = [
                makeTurn([{ toolName: 'edit_file', args: { path: '/tmp/notes.md' } }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/notes.md');
        });

        it('detects edit tool call with path arg', () => {
            const turns = [
                makeTurn([{ toolName: 'edit', args: { path: '/tmp/plan.md' } }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/plan.md');
        });

        it('detects str_replace_editor with path arg', () => {
            const turns = [
                makeTurn([{ toolName: 'str_replace_editor', args: { path: '/tmp/spec.yaml' } }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/spec.yaml');
        });

        it('detects str_replace_based_edit_tool with path arg', () => {
            const turns = [
                makeTurn([{ toolName: 'str_replace_based_edit_tool', args: { path: '/tmp/design.md' } }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/design.md');
        });

        it('still ignores read_file and other non-write tools', () => {
            const turns = [
                makeTurn([{ toolName: 'read_file', args: { path: '/tmp/notes.md' } }]),
            ];
            expect(scanTurnsForCreatedFiles(turns)).toHaveLength(0);
        });
    });

    describe('shell mv detection', () => {
        it('detects a goal file destination from a simple mv command', () => {
            const turns = [
                makeTurn([{
                    toolName: 'shell',
                    args: {
                        command: 'mv /tmp/title-generation-transform.plan.md /tmp/title-generation-transform.goal.md',
                    },
                }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/title-generation-transform.goal.md');
        });

        it('detects a quoted mv destination inside bash -lc command chains', () => {
            const turns = [
                makeTurn([{
                    toolName: 'shell',
                    args: {
                        command: "/bin/bash -lc 'mv \"/tmp/Plans/sdk provider/title generation.plan.md\" \"/tmp/Plans/sdk provider/title generation.goal.md\" && ls -l \"/tmp/Plans/sdk provider/title generation.goal.md\"'",
                    },
                }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/Plans/sdk provider/title generation.goal.md');
        });

        it('resolves shell mv command args from tool-start for live SSE completions', () => {
            const turns = [
                makeLiveSSETurn([{
                    id: 'tc0',
                    toolName: 'shell',
                    args: {
                        command: 'mv /tmp/live.plan.md /tmp/live.goal.md',
                    },
                }]),
            ];
            const results = scanTurnsForCreatedFiles(turns);
            expect(results).toHaveLength(1);
            expect(results[0].filePath).toBe('/tmp/live.goal.md');
        });

        it('ignores mv destinations with non-pinned extensions', () => {
            const turns = [
                makeTurn([{
                    toolName: 'shell',
                    args: {
                        command: 'mv /tmp/diagram.md /tmp/diagram.png',
                    },
                }]),
            ];
            expect(scanTurnsForCreatedFiles(turns)).toHaveLength(0);
        });

        it('ignores unrelated shell commands with pinned file paths in output', () => {
            const turns = [
                makePersistedTurn([{
                    name: 'shell',
                    args: {
                        command: 'ls -l /tmp/title-generation-transform.goal.md',
                    },
                    result: '-rw-r--r-- 1 user user 123 /tmp/title-generation-transform.goal.md',
                }]),
            ];
            expect(scanTurnsForCreatedFiles(turns)).toHaveLength(0);
        });
    });
});
