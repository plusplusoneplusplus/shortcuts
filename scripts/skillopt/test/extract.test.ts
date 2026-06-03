/**
 * Tests: extraction step (extract.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    buildExtractPrompt,
    parseStructuredOutput,
    extractStructuredOutput,
} from '../extract';

vi.mock('../cli-driver', () => ({
    runCopilotCli: vi.fn(),
}));
import { runCopilotCli } from '../cli-driver';

describe('buildExtractPrompt', () => {
    it('embeds the answer text and requests JSON output', () => {
        const prompt = buildExtractPrompt('decide to split into two commits');
        expect(prompt).toContain('decide to split into two commits');
        expect(prompt).toContain('```json');
        expect(prompt.toLowerCase()).toContain('do not add');
    });

    it('handles empty input without throwing', () => {
        expect(() => buildExtractPrompt('')).not.toThrow();
        expect(buildExtractPrompt('')).toContain('(empty)');
    });
});

describe('parseStructuredOutput', () => {
    it('parses a fenced json block', () => {
        const raw = 'Here you go:\n```json\n{ "points": [ { "id": 1, "text": "a" }, { "id": 2, "text": "b", "group": "g1" } ] }\n```\n';
        const out = parseStructuredOutput(raw);
        expect(out.points).toHaveLength(2);
        expect(out.points[0].text).toBe('a');
        expect(out.points[1].group).toBe('g1');
    });

    it('parses a bare json object', () => {
        const raw = '{ "points": [ { "id": 5, "text": "only" } ] }';
        const out = parseStructuredOutput(raw);
        expect(out.points[0].id).toBe(5);
    });

    it('defaults missing ids to sequential indices', () => {
        const raw = '```json\n{ "points": [ { "text": "x" }, { "text": "y" } ] }\n```';
        const out = parseStructuredOutput(raw);
        expect(out.points[0].id).toBe(1);
        expect(out.points[1].id).toBe(2);
    });

    it('trims whitespace and drops empty group labels', () => {
        const raw = '{ "points": [ { "id": 1, "text": "  hi  ", "group": "   " } ] }';
        const out = parseStructuredOutput(raw);
        expect(out.points[0].text).toBe('hi');
        expect(out.points[0].group).toBeUndefined();
    });

    it('throws when no json is present', () => {
        expect(() => parseStructuredOutput('no json here')).toThrow(/no json/i);
    });

    it('throws when points is not an array', () => {
        expect(() => parseStructuredOutput('{ "points": "nope" }')).toThrow(/points/i);
    });

    it('throws when a point has no text', () => {
        expect(() => parseStructuredOutput('{ "points": [ { "id": 1 } ] }')).toThrow(/text/i);
    });
});

describe('extractStructuredOutput', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns empty points for empty input without calling the CLI', async () => {
        const out = await extractStructuredOutput('', 'm', '/tmp');
        expect(out.points).toEqual([]);
        expect(runCopilotCli).not.toHaveBeenCalled();
    });

    it('parses valid CLI output on first attempt', async () => {
        vi.mocked(runCopilotCli).mockResolvedValue({
            stdout: '```json\n{ "points": [ { "id": 1, "text": "ok" } ] }\n```',
            exitCode: 0,
            diff: '',
        });
        const out = await extractStructuredOutput('something', 'm', '/tmp');
        expect(out.points[0].text).toBe('ok');
        expect(runCopilotCli).toHaveBeenCalledTimes(1);
    });

    it('retries once on malformed output then succeeds', async () => {
        vi.mocked(runCopilotCli)
            .mockResolvedValueOnce({ stdout: 'garbage', exitCode: 0, diff: '' })
            .mockResolvedValueOnce({ stdout: '{ "points": [ { "id": 1, "text": "ok" } ] }', exitCode: 0, diff: '' });
        const out = await extractStructuredOutput('something', 'm', '/tmp');
        expect(out.points).toHaveLength(1);
        expect(runCopilotCli).toHaveBeenCalledTimes(2);
    });

    it('falls back to empty points after two failures', async () => {
        vi.mocked(runCopilotCli).mockResolvedValue({ stdout: 'garbage', exitCode: 0, diff: '' });
        const out = await extractStructuredOutput('something', 'm', '/tmp');
        expect(out.points).toEqual([]);
        expect(runCopilotCli).toHaveBeenCalledTimes(2);
    });

    it('falls back to empty points if the CLI throws', async () => {
        vi.mocked(runCopilotCli).mockRejectedValue(new Error('boom'));
        const out = await extractStructuredOutput('something', 'm', '/tmp');
        expect(out.points).toEqual([]);
    });
});
