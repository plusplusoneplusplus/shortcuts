/**
 * Characterization tests for the pure tool-call render-model kernel.
 *
 * These lock in the summary derivation, argument parsing, result truncation,
 * shell/sql section extraction, preview eligibility, and whisper-row metric
 * behavior that ToolCallView renders, so the extraction from the component
 * preserves the exact facts each variant shows.
 */

import { describe, it, expect } from 'vitest';
import {
    getToolSummary,
    buildToolCallRenderModel,
    parseArgsObject,
    formatArgs,
    truncateSummary,
    formatCount,
    formatDuration,
    formatStartTime,
    statusIndicator,
    isImageDataUrl,
    MAX_RESULT_LENGTH,
    TRUNCATED_RESULT_LENGTH,
} from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolCallRenderModel';

describe('getToolSummary', () => {
    it('summarizes grep with /pattern/ in path', () => {
        expect(getToolSummary('grep', { pattern: 'foo', path: '/repo/src' })).toBe('/foo/ in /repo/src');
    });

    it('summarizes grep with glob fallback', () => {
        expect(getToolSummary('grep', { pattern: 'foo', glob: '*.ts' })).toBe('/foo/ in *.ts');
    });

    it('summarizes view with a path and a view range', () => {
        expect(getToolSummary('view', { path: '/a/b.ts', view_range: [1, 10] })).toBe('/a/b.ts L1-L10');
    });

    it('summarizes view with filePath fallback and no range', () => {
        expect(getToolSummary('view', { filePath: '/a/c.ts' })).toBe('/a/c.ts');
    });

    it('summarizes edit and create by path', () => {
        expect(getToolSummary('edit', { path: '/x/y.ts' })).toBe('/x/y.ts');
        expect(getToolSummary('create', { filePath: '/x/z.ts' })).toBe('/x/z.ts');
    });

    it('truncates long shell commands to 80 chars with ellipsis', () => {
        const cmd = 'echo ' + 'a'.repeat(200);
        const out = getToolSummary('bash', { command: cmd });
        expect(out.length).toBe(80);
        expect(out.endsWith('...')).toBe(true);
    });

    it('summarizes shell and powershell commands', () => {
        expect(getToolSummary('shell', { command: 'ls -la' })).toBe('ls -la');
        expect(getToolSummary('powershell', { command: 'Get-Process' })).toBe('Get-Process');
    });

    it('summarizes glob with pattern and path', () => {
        expect(getToolSummary('glob', { pattern: '**/*.ts', path: '/repo' })).toBe('**/*.ts in /repo');
        expect(getToolSummary('glob', { glob_pattern: '*.md' })).toBe('*.md');
    });

    it('prefers sql description over query, truncating query when needed', () => {
        expect(getToolSummary('sql', { description: 'count rows', query: 'SELECT 1' })).toBe('count rows');
        const longQuery = 'SELECT ' + 'x'.repeat(200);
        const out = getToolSummary('sql', { query: longQuery });
        expect(out.length).toBe(80);
        expect(out.endsWith('...')).toBe(true);
    });

    it('summarizes skill from name/skill_name/skill', () => {
        expect(getToolSummary('skill', { name: 'impl' })).toBe('impl');
        expect(getToolSummary('skill', { skill_name: 'draft' })).toBe('draft');
        expect(getToolSummary('skill', { skill: 'code-review' })).toBe('code-review');
    });

    it('summarizes task with agent type prefix + description', () => {
        expect(getToolSummary('task', { agent_type: 'explore', description: 'Look around' })).toBe('[explore] Look around');
    });

    it('summarizes task by truncated prompt when description missing', () => {
        const out = getToolSummary('task', { prompt: 'p'.repeat(100) });
        expect(out).toBe('p'.repeat(57) + '...');
    });

    it('summarizes read_agent with wait flag', () => {
        expect(getToolSummary('read_agent', { agent_id: 'agent-0', wait: true })).toBe('Agent agent-0 (wait)');
        expect(getToolSummary('read_agent', { agent_id: 'agent-5' })).toBe('Agent agent-5');
        expect(getToolSummary('read_agent', {})).toBe('');
    });

    it('summarizes task_complete from summary, defaulting when empty', () => {
        expect(getToolSummary('task_complete', { summary: 'All done' })).toBe('All done');
        expect(getToolSummary('task_complete', {})).toBe('Task completed');
    });

    it('summarizes suggest_follow_ups by joining first three suggestions', () => {
        expect(getToolSummary('suggest_follow_ups', { suggestions: ['a', 'b', 'c', 'd'] })).toBe('a · b · c');
    });

    it('summarizes ask_user from the first question with more-count', () => {
        expect(getToolSummary('ask_user', { questions: [{ question: 'One?' }, { question: 'Two?' }] }))
            .toBe('One? (+1 more)');
        expect(getToolSummary('ask_user', {})).toBe('Ask user');
    });

    it('summarizes apply_patch codex changes (single path vs count)', () => {
        expect(getToolSummary('apply_patch', { changes: [{ path: 'src/a.ts', kind: 'update' }] })).toBe('src/a.ts');
        expect(getToolSummary('apply_patch', {
            changes: [{ path: 'src/a.ts', kind: 'update' }, { path: 'src/b.ts', kind: 'add' }],
        })).toBe('2 files');
    });

    it('falls back to a generic string arg for unknown tools', () => {
        expect(getToolSummary('mystery', { url: 'https://example.com' })).toBe('https://example.com');
        expect(getToolSummary('mystery', {})).toBe('');
    });

    it('returns empty string for non-object args', () => {
        expect(getToolSummary('view', null)).toBe('');
        expect(getToolSummary('view', 'string-arg')).toBe('');
    });
});

describe('small pure helpers', () => {
    it('parseArgsObject parses JSON strings and rejects arrays/invalid', () => {
        expect(parseArgsObject('{"a":1}')).toEqual({ a: 1 });
        expect(parseArgsObject({ b: 2 })).toEqual({ b: 2 });
        expect(parseArgsObject('[1,2]')).toBeNull();
        expect(parseArgsObject('not json')).toBeNull();
        expect(parseArgsObject(null)).toBeNull();
    });

    it('formatArgs pretty-prints and skips empty objects', () => {
        expect(formatArgs({})).toBe('');
        expect(formatArgs({ a: 1 })).toBe('{\n  "a": 1\n}');
        expect(formatArgs('plain')).toBe('plain');
    });

    it('truncateSummary trims to max length with ellipsis', () => {
        expect(truncateSummary('short')).toBe('short');
        expect(truncateSummary('a'.repeat(90))).toBe('a'.repeat(77) + '...');
    });

    it('formatCount inserts thousands separators deterministically', () => {
        expect(formatCount(4900)).toBe('4,900');
        expect(formatCount(1234567)).toBe('1,234,567');
    });

    it('formatDuration renders ms and seconds', () => {
        expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:00.500Z')).toBe('500ms');
        expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:02Z')).toBe('2.0s');
        expect(formatDuration(undefined, '2026-01-01T00:00:02Z')).toBe('');
    });

    it('formatStartTime renders MM/DD hh:mm AM/PM or empty on bad input', () => {
        expect(formatStartTime('')).toBe('');
        expect(formatStartTime('not-a-date')).toBe('');
        expect(formatStartTime('2026-01-01T00:00:00Z')).toMatch(/^\d\d\/\d\d \d{1,2}:\d\d (AM|PM)$/);
    });

    it('statusIndicator maps status to an emoji', () => {
        expect(statusIndicator('running')).toBe('🔄');
        expect(statusIndicator('completed')).toBe('✅');
        expect(statusIndicator('failed')).toBe('❌');
        expect(statusIndicator(undefined)).toBe('⏳');
    });

    it('isImageDataUrl detects base64 image data urls', () => {
        expect(isImageDataUrl('data:image/png;base64,AAAA')).toBe(true);
        expect(isImageDataUrl('https://example.com/a.png')).toBe(false);
    });
});

describe('buildToolCallRenderModel', () => {
    it('normalizes the tool name and identity', () => {
        const model = buildToolCallRenderModel({ id: 't1', toolName: 'Read', args: { path: '/a.ts' } }, 'card');
        expect(model.name).toBe('view');
        expect(model.id).toBe('t1');
    });

    it('falls back id to normalized tool name then unknown', () => {
        expect(buildToolCallRenderModel({ toolName: 'Bash', args: {} }, 'card').id).toBe('bash');
        expect(buildToolCallRenderModel({ args: {} }, 'card').id).toBe('unknown');
    });

    it('flags path summaries with the backing full path', () => {
        const model = buildToolCallRenderModel({ toolName: 'view', args: { path: '/repo/x.ts' } }, 'card');
        expect(model.summaryIsPath).toBe(true);
        expect(model.summaryFullPath).toBe('/repo/x.ts');
    });

    it('does not flag non-path summaries', () => {
        const model = buildToolCallRenderModel({ toolName: 'bash', args: { command: 'ls' } }, 'card');
        expect(model.summaryIsPath).toBe(false);
        expect(model.summaryFullPath).toBe('');
    });

    it('truncates long results and reports the truncation', () => {
        const result = 'x'.repeat(MAX_RESULT_LENGTH + 100);
        const model = buildToolCallRenderModel({ toolName: 'bash', args: { command: 'x' }, result }, 'card');
        expect(model.isResultTruncated).toBe(true);
        expect(model.visibleResult).toContain('output truncated');
        expect(model.visibleResult.startsWith('x'.repeat(TRUNCATED_RESULT_LENGTH))).toBe(true);
    });

    it('keeps short results untruncated', () => {
        const model = buildToolCallRenderModel({ toolName: 'bash', args: { command: 'x' }, result: 'ok' }, 'card');
        expect(model.isResultTruncated).toBe(false);
        expect(model.visibleResult).toBe('ok');
    });

    it('prefers the patch body as popover text for apply_patch', () => {
        const model = buildToolCallRenderModel({
            toolName: 'apply_patch',
            args: { changes: [{ path: 'src/f.ts', kind: 'update' }], diff: 'diff-body-here' },
            result: 'update: src/f.ts',
        }, 'card');
        expect(model.applyPatchText).toBe('diff-body-here');
        expect(model.popoverResultText).toBe('diff-body-here');
    });

    it('marks hover eligibility only for previewable tools with a result', () => {
        expect(buildToolCallRenderModel({ toolName: 'view', args: { path: '/a' }, result: '1' }, 'card').hasHoverResult).toBe(true);
        expect(buildToolCallRenderModel({ toolName: 'view', args: { path: '/a' }, result: '' }, 'card').hasHoverResult).toBe(false);
        expect(buildToolCallRenderModel({ toolName: 'random', args: {}, result: 'x' }, 'card').hasHoverResult).toBe(false);
    });

    it('computes a whisper-row metric but omits it for the card variant', () => {
        const input = { toolName: 'view', args: { path: '/a' }, result: '1\n2\n3' };
        expect(buildToolCallRenderModel(input, 'card').metric).toBeNull();
        expect(buildToolCallRenderModel(input, 'whisper-row').metric).toEqual({ kind: 'plain', text: '3 lines' });
    });

    it('extracts shell description/command/options sections', () => {
        const model = buildToolCallRenderModel({
            toolName: 'bash',
            args: { command: 'ls', description: 'list', timeout: 10, run_in_background: true },
        }, 'card');
        expect(model.isShellLike).toBe(true);
        expect(model.bashCommand).toBe('ls');
        expect(model.bashDescription).toBe('list');
        expect(model.bashOptionsText).toBe(JSON.stringify({ timeout: 10, run_in_background: true }, null, 2));
    });

    it('extracts sql description/query/options sections', () => {
        const model = buildToolCallRenderModel({
            toolName: 'sql',
            args: { query: 'SELECT 1', description: 'one', limit: 5 },
        }, 'card');
        expect(model.isSql).toBe(true);
        expect(model.sqlQuery).toBe('SELECT 1');
        expect(model.sqlDescription).toBe('one');
        expect(model.sqlOptionsText).toBe(JSON.stringify({ limit: 5 }, null, 2));
    });

    it('exposes task_complete summary from result then args', () => {
        expect(buildToolCallRenderModel({ toolName: 'task_complete', args: { summary: 'from-args' }, result: 'from-result' }, 'card').taskCompleteSummary).toBe('from-result');
        expect(buildToolCallRenderModel({ toolName: 'task_complete', args: { summary: 'from-args' }, result: '' }, 'card').taskCompleteSummary).toBe('from-args');
    });

    it('falls back rowSummary to error when there is no summary', () => {
        const model = buildToolCallRenderModel({ toolName: 'random', args: {}, error: 'boom' }, 'whisper-row');
        expect(model.summary).toBe('');
        expect(model.rowSummary).toBe('error');
    });

    it('reports hasDetails when any of args/result/error is present', () => {
        expect(buildToolCallRenderModel({ toolName: 'random', args: {} }, 'card').hasDetails).toBe(false);
        expect(buildToolCallRenderModel({ toolName: 'random', args: { a: 1 } }, 'card').hasDetails).toBe(true);
        expect(buildToolCallRenderModel({ toolName: 'random', args: {}, result: 'r' }, 'card').hasDetails).toBe(true);
        expect(buildToolCallRenderModel({ toolName: 'random', args: {}, error: 'e' }, 'card').hasDetails).toBe(true);
    });
});

describe('semantic shell display', () => {
    it('relabels a wrapped rg command as Search with a concise summary', () => {
        const model = buildToolCallRenderModel({
            toolName: 'command_execution',
            args: { command: "/bin/zsh -lc 'rg foo src'" },
            result: 'a\nb\nc',
        }, 'whisper-row');
        expect(model.name).toBe('shell');           // canonical identity unchanged
        expect(model.displayName).toBe('Search');    // title-cased semantic label
        expect(model.kindInfo.label).toBe('Search');
        expect(model.kindInfo.cls).toBe('grep');
        expect(model.isSemanticShell).toBe(true);
        expect(model.summary).toBe('foo in src');
        expect(model.metric).toEqual({ kind: 'plain', text: '3 hits' });
        // Raw command (with the interpreter wrapper) is preserved for copy/detail.
        expect(model.bashCommand).toBe("/bin/zsh -lc 'rg foo src'");
    });

    it('labels a read-only sed -n as Read with a lines metric', () => {
        const model = buildToolCallRenderModel({
            toolName: 'shell',
            args: { command: "sed -n '1,5p' file.ts" },
            result: '1\n2\n3',
        }, 'whisper-row');
        expect(model.displayName).toBe('Read');
        expect(model.kindInfo.cls).toBe('read');
        expect(model.summary).toBe('file.ts, lines 1–5');
        expect(model.metric).toEqual({ kind: 'plain', text: '3 lines' });
    });

    it('labels rg --files as Files with a files metric', () => {
        const model = buildToolCallRenderModel({
            toolName: 'shell',
            args: { command: 'rg --files src' },
            result: 'a.ts\nb.ts',
        }, 'whisper-row');
        expect(model.displayName).toBe('Files');
        expect(model.kindInfo.cls).toBe('glob');
        expect(model.metric).toEqual({ kind: 'plain', text: '2 files' });
    });

    it('keeps ambiguous/mutating commands as Shell with the raw command summary', () => {
        const model = buildToolCallRenderModel({
            toolName: 'shell',
            args: { command: 'npm run build' },
            result: 'done',
        }, 'whisper-row');
        expect(model.displayName).toBe('Shell');
        expect(model.kindInfo.label).toBe('Shell');
        expect(model.kindInfo.cls).toBe('shell');
        expect(model.isSemanticShell).toBe(false);
        expect(model.summary).toBe('npm run build');
        expect(model.metric).toEqual({ kind: 'plain', text: '1 line' });
    });

    it('prefers a human-written description as the summary while keeping the family', () => {
        const model = buildToolCallRenderModel({
            toolName: 'shell',
            args: { command: 'rg foo src', description: 'Look for foo' },
        }, 'whisper-row');
        expect(model.kindInfo.label).toBe('Search');
        expect(model.summary).toBe('Look for foo');
    });

    it('does not classify PowerShell', () => {
        const model = buildToolCallRenderModel({
            toolName: 'powershell',
            args: { command: 'Select-String foo' },
        }, 'whisper-row');
        expect(model.displayName).toBe('powershell'); // PowerShell card retains its existing name
        expect(model.isSemanticShell).toBe(false);
    });

    it('marks summaryIsPath false for a semantic shell call', () => {
        const model = buildToolCallRenderModel({
            toolName: 'shell',
            args: { command: 'cat src/index.ts' },
        }, 'card');
        expect(model.summaryIsPath).toBe(false);
    });
});
