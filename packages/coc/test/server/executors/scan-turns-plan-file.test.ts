/**
 * @vitest-environment node
 *
 * Tests for scanTurnsForPlanFile in process-lifecycle-runner.ts.
 */
import { describe, it, expect } from 'vitest';
import { scanTurnsForPlanFile } from '../../../src/server/executors/process-lifecycle-runner';
import type { ConversationTurn } from '@plusplusoneplusplus/forge';

function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
    return {
        role: 'assistant',
        content: 'response',
        timestamp: new Date(),
        turnIndex: 0,
        timeline: [],
        ...overrides,
    };
}

describe('scanTurnsForPlanFile', () => {
    it('returns undefined when turns have no tool calls', () => {
        const turns = [makeTurn()];
        expect(scanTurnsForPlanFile(turns)).toBeUndefined();
    });

    it('detects create_file tool call with .plan.md path', () => {
        const turns = [
            makeTurn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            name: 'create_file',
                            status: 'completed',
                            startTime: new Date(),
                            args: { path: '/repo/tasks/auth.plan.md' },
                            result: 'Created file /repo/tasks/auth.plan.md',
                        },
                    },
                ],
            }),
        ];
        expect(scanTurnsForPlanFile(turns)).toBe('/repo/tasks/auth.plan.md');
    });

    it('detects create tool call with .plan.md path', () => {
        const turns = [
            makeTurn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            name: 'create',
                            status: 'completed',
                            startTime: new Date(),
                            args: { path: '/repo/test.plan.md' },
                            result: 'ok',
                        },
                    },
                ],
            }),
        ];
        expect(scanTurnsForPlanFile(turns)).toBe('/repo/test.plan.md');
    });

    it('detects write_file tool call with .plan.md path', () => {
        const turns = [
            makeTurn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            name: 'write_file',
                            status: 'completed',
                            startTime: new Date(),
                            args: { filePath: '/repo/plan.plan.md' },
                            result: 'ok',
                        },
                    },
                ],
            }),
        ];
        expect(scanTurnsForPlanFile(turns)).toBe('/repo/plan.plan.md');
    });

    it('returns undefined when tool creates non-plan file', () => {
        const turns = [
            makeTurn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            name: 'create_file',
                            status: 'completed',
                            startTime: new Date(),
                            args: { path: '/repo/src/index.ts' },
                            result: 'ok',
                        },
                    },
                ],
            }),
        ];
        expect(scanTurnsForPlanFile(turns)).toBeUndefined();
    });

    it('ignores non-create tool calls', () => {
        const turns = [
            makeTurn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            name: 'read_file',
                            status: 'completed',
                            startTime: new Date(),
                            args: { path: '/repo/test.plan.md' },
                            result: 'content',
                        },
                    },
                ],
            }),
        ];
        expect(scanTurnsForPlanFile(turns)).toBeUndefined();
    });

    it('ignores tool-start entries (only looks at tool-complete)', () => {
        const turns = [
            makeTurn({
                timeline: [
                    {
                        type: 'tool-start',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            name: 'create_file',
                            status: 'running',
                            startTime: new Date(),
                            args: { path: '/repo/test.plan.md' },
                        },
                    },
                ],
            }),
        ];
        expect(scanTurnsForPlanFile(turns)).toBeUndefined();
    });

    it('returns the first .plan.md found across multiple turns', () => {
        const turns = [
            makeTurn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            name: 'create_file',
                            status: 'completed',
                            startTime: new Date(),
                            args: { path: '/repo/first.plan.md' },
                            result: 'ok',
                        },
                    },
                ],
            }),
            makeTurn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-2',
                            name: 'create_file',
                            status: 'completed',
                            startTime: new Date(),
                            args: { path: '/repo/second.plan.md' },
                            result: 'ok',
                        },
                    },
                ],
            }),
        ];
        expect(scanTurnsForPlanFile(turns)).toBe('/repo/first.plan.md');
    });

    it('handles apply_patch with "Added N file(s):" result', () => {
        const turns = [
            makeTurn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            name: 'apply_patch',
                            status: 'completed',
                            startTime: new Date(),
                            args: { diff: '' },
                            result: 'Added 1 file(s): /repo/tasks/fix.plan.md',
                        },
                    },
                ],
            }),
        ];
        expect(scanTurnsForPlanFile(turns)).toBe('/repo/tasks/fix.plan.md');
    });

    it('handles apply_patch with Codex "add:" result and toolName field', () => {
        const turns = [
            makeTurn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            toolName: 'apply_patch',
                            status: 'completed',
                            startTime: new Date(),
                            args: {},
                            result: 'add: /home/user/.coc/repos/ws-xjvuoc/notes/Plans/work-item-ai/get-work-item-tool.plan.md',
                        } as any,
                    },
                ],
            }),
        ];
        expect(scanTurnsForPlanFile(turns)).toBe('/home/user/.coc/repos/ws-xjvuoc/notes/Plans/work-item-ai/get-work-item-tool.plan.md');
    });

    it('handles apply_patch with "*** Add File:" in args', () => {
        const turns = [
            makeTurn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            name: 'apply_patch',
                            status: 'completed',
                            startTime: new Date(),
                            args: { diff: '*** Add File: /repo/tasks/new.plan.md\n+content' },
                            result: 'ok',
                        },
                    },
                ],
            }),
        ];
        expect(scanTurnsForPlanFile(turns)).toBe('/repo/tasks/new.plan.md');
    });

    it('returns undefined for empty turns', () => {
        expect(scanTurnsForPlanFile([])).toBeUndefined();
    });

    it('handles turns with no timeline', () => {
        const turns = [makeTurn({ timeline: undefined as any })];
        expect(scanTurnsForPlanFile(turns)).toBeUndefined();
    });

    it('uses name field on ToolCall', () => {
        const turns = [
            makeTurn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            name: 'create',
                            status: 'completed',
                            startTime: new Date(),
                            args: { path: '/repo/legacy.plan.md' },
                            result: 'ok',
                        },
                    },
                ],
            }),
        ];
        expect(scanTurnsForPlanFile(turns)).toBe('/repo/legacy.plan.md');
    });
});
