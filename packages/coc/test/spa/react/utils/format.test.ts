import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatRelativeTime, formatConversationAsText } from '../../../../src/server/spa/client/react/utils/format';

afterEach(() => {
    vi.restoreAllMocks();
});

function mockNow(ms: number) {
    vi.spyOn(Date, 'now').mockReturnValue(ms);
}

const BASE = new Date('2024-01-01T12:00:00.000Z').getTime();

describe('formatRelativeTime — past dates', () => {
    it('returns "just now" for 0 ms ago', () => {
        mockNow(BASE);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('just now');
    });

    it('returns "just now" for 59 seconds ago', () => {
        mockNow(BASE + 59_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('just now');
    });

    it('returns "Xm ago" for minutes', () => {
        mockNow(BASE + 5 * 60_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('5m ago');
    });

    it('returns "Xh ago" for hours', () => {
        mockNow(BASE + 3 * 3600_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('3h ago');
    });

    it('returns "yesterday" for exactly 1 day ago', () => {
        mockNow(BASE + 24 * 3600_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('yesterday');
    });

    it('returns "Xd ago" for 2-6 days ago', () => {
        mockNow(BASE + 3 * 24 * 3600_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('3d ago');
    });
});

describe('formatRelativeTime — future dates', () => {
    it('returns "just now" for ~0 seconds in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 30_000).toISOString(); // 30s ahead
        expect(formatRelativeTime(future)).toBe('just now');
    });

    it('returns "in Xm" for 5 minutes in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 5 * 60_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 5m');
    });

    it('returns "in Xm" for 55 minutes in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 55 * 60_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 55m');
    });

    it('returns "in Xh" for 2 hours in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 2 * 3600_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 2h');
    });

    it('returns "in Xd" for 3 days in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 3 * 24 * 3600_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 3d');
    });
});

describe('formatRelativeTime — edge cases', () => {
    it('returns empty string for null', () => {
        expect(formatRelativeTime(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(formatRelativeTime(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(formatRelativeTime('')).toBe('');
    });
});

describe('formatConversationAsText', () => {
    it('returns empty string for empty turns array', () => {
        expect(formatConversationAsText([])).toBe('');
    });

    it('formats a basic user/assistant round-trip', () => {
        const turns = [
            { role: 'user' as const, content: 'Hello', toolCalls: [], timeline: [] },
            { role: 'assistant' as const, content: 'Hi there!', toolCalls: [], timeline: [] },
        ];
        expect(formatConversationAsText(turns)).toBe('[user]\nHello\n\n[assistant]\nHi there!');
    });

    it('includes tool calls with args and result', () => {
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Reading file',
                timeline: [],
                toolCalls: [{
                    id: '1',
                    toolName: 'read_file',
                    args: { path: 'src/foo.ts' },
                    result: 'file content',
                    status: 'completed' as const,
                }],
            },
        ];
        const output = formatConversationAsText(turns);
        expect(output).toContain('[tool: read_file]');
        expect(output).toContain('args: {"path":"src/foo.ts"}');
        expect(output).toContain('→ result: file content');
    });

    it('truncates tool call result longer than truncateAt', () => {
        const longResult = 'a'.repeat(150);
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Done',
                timeline: [],
                toolCalls: [{
                    id: '1',
                    toolName: 'run_cmd',
                    args: {},
                    result: longResult,
                    status: 'completed' as const,
                }],
            },
        ];
        const output = formatConversationAsText(turns, 100);
        expect(output).toContain('→ result: ' + 'a'.repeat(100) + '…');
        expect(output).not.toContain('a'.repeat(101));
    });

    it('truncates tool call args JSON longer than truncateAt', () => {
        const longPath = 'x'.repeat(200);
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Done',
                timeline: [],
                toolCalls: [{
                    id: '1',
                    toolName: 'write_file',
                    args: { path: longPath },
                    result: 'ok',
                    status: 'completed' as const,
                }],
            },
        ];
        const output = formatConversationAsText(turns, 100);
        const argsLine = output.split('\n').find(l => l.startsWith('[tool:'));
        expect(argsLine).toBeDefined();
        // args: ... portion should be truncated
        const argsMatch = argsLine!.match(/args: (.+?) →/);
        expect(argsMatch![1].length).toBeLessThanOrEqual(101); // 100 chars + '…'
    });

    it('omits result for pending/running tool calls', () => {
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Thinking',
                timeline: [],
                toolCalls: [
                    { id: '1', toolName: 'tool_a', args: {}, status: 'pending' as const },
                    { id: '2', toolName: 'tool_b', args: {}, status: 'running' as const },
                ],
            },
        ];
        const output = formatConversationAsText(turns);
        expect(output).toContain('[tool: tool_a]');
        expect(output).not.toContain('→');
    });

    it('renders tool call error instead of result', () => {
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Oops',
                timeline: [],
                toolCalls: [{
                    id: '1',
                    toolName: 'write_file',
                    args: { path: 'x' },
                    error: 'File not found',
                    status: 'failed' as const,
                }],
            },
        ];
        const output = formatConversationAsText(turns);
        expect(output).toContain('→ error: File not found');
    });

    it('uses .name field when .toolName is absent (snapshot replay path)', () => {
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Searching',
                timeline: [],
                toolCalls: [{
                    name: 'grep',
                    args: { pattern: 'foo' },
                    result: 'bar',
                    status: 'completed' as const,
                }] as any[],
            },
        ];
        const output = formatConversationAsText(turns);
        expect(output).toContain('[tool: grep]');
        expect(output).not.toContain('undefined');
    });
});
