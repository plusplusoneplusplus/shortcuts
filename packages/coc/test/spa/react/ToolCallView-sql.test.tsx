/**
 * Tests for ToolCallView — SQL tool rendering.
 * Collapsed summary shows description, expanded view shows query in dedicated section.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makeSqlToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-sql-1',
        toolName: 'sql',
        args: {
            description: 'Insert auth todos',
            query: "INSERT INTO todos (id, title) VALUES ('auth', 'Create auth module');",
            database: 'session',
        },
        result: 'Rows affected: 1',
        status: 'completed',
        ...overrides,
    };
}

function expandToolCall(container: HTMLElement) {
    const header = container.querySelector('.tool-call-header');
    if (header) fireEvent.click(header);
}

describe('ToolCallView — SQL tool', () => {
    it('collapsed summary shows description when present', () => {
        const { container } = render(<ToolCallView toolCall={makeSqlToolCall()} />);
        const header = container.querySelector('.tool-call-header');
        expect(header?.textContent).toContain('Insert auth todos');
    });

    it('collapsed summary shows truncated query when description is missing', () => {
        const tc = makeSqlToolCall({
            args: { query: 'SELECT * FROM todos WHERE status = \'pending\'' },
        });
        const { container } = render(<ToolCallView toolCall={tc} />);
        const header = container.querySelector('.tool-call-header');
        expect(header?.textContent).toContain('SELECT * FROM todos');
    });

    it('collapsed summary truncates long queries to 80 chars', () => {
        const longQuery = 'SELECT ' + 'a'.repeat(200) + ' FROM very_long_table_name';
        const tc = makeSqlToolCall({ args: { query: longQuery } });
        const { container } = render(<ToolCallView toolCall={tc} />);
        const header = container.querySelector('.tool-call-header');
        const summarySpan = header?.querySelectorAll('span');
        const summaryText = Array.from(summarySpan || []).find(s => s.textContent?.includes('...'));
        expect(summaryText?.textContent?.length).toBeLessThanOrEqual(80);
    });

    it('expanded view shows Description section', () => {
        const { container } = render(<ToolCallView toolCall={makeSqlToolCall()} />);
        expandToolCall(container);
        const body = container.querySelector('.tool-call-body');
        expect(body?.textContent).toContain('Description');
        expect(body?.textContent).toContain('Insert auth todos');
    });

    it('expanded view shows Query section with full SQL', () => {
        const { container } = render(<ToolCallView toolCall={makeSqlToolCall()} />);
        expandToolCall(container);
        const body = container.querySelector('.tool-call-body');
        expect(body?.textContent).toContain('Query');
        expect(body?.textContent).toContain("INSERT INTO todos (id, title) VALUES ('auth', 'Create auth module');");
    });

    it('expanded view shows Options section for extra args like database', () => {
        const { container } = render(<ToolCallView toolCall={makeSqlToolCall()} />);
        expandToolCall(container);
        const body = container.querySelector('.tool-call-body');
        expect(body?.textContent).toContain('Options');
        expect(body?.textContent).toContain('session');
    });

    it('expanded view does not show generic Arguments section', () => {
        const { container } = render(<ToolCallView toolCall={makeSqlToolCall()} />);
        expandToolCall(container);
        const body = container.querySelector('.tool-call-body');
        const labels = Array.from(body?.querySelectorAll('div') || []).map(d => d.textContent);
        // Should not have an "Arguments" label (SQL uses Description/Query/Options instead)
        const argLabel = labels.find(l => l?.trim() === 'Arguments');
        expect(argLabel).toBeUndefined();
    });

    it('expanded view shows Result section', () => {
        const { container } = render(<ToolCallView toolCall={makeSqlToolCall()} />);
        expandToolCall(container);
        const body = container.querySelector('.tool-call-body');
        expect(body?.textContent).toContain('Result');
        expect(body?.textContent).toContain('Rows affected: 1');
    });

    it('does not show Description section when description is absent', () => {
        const tc = makeSqlToolCall({
            args: { query: 'SELECT 1' },
        });
        const { container } = render(<ToolCallView toolCall={tc} />);
        expandToolCall(container);
        const body = container.querySelector('.tool-call-body');
        // Query section should exist
        expect(body?.textContent).toContain('Query');
        // Description section should NOT exist — look for the label element
        const upperLabels = Array.from(body?.querySelectorAll('.text-\\[10px\\]') || [])
            .map(el => el.textContent?.trim());
        expect(upperLabels).not.toContain('Description');
    });

    it('does not show Options section when no extra args exist', () => {
        const tc = makeSqlToolCall({
            args: { description: 'Simple query', query: 'SELECT 1' },
        });
        const { container } = render(<ToolCallView toolCall={tc} />);
        expandToolCall(container);
        const body = container.querySelector('.tool-call-body');
        const labels = Array.from(body?.querySelectorAll('div') || [])
            .map(d => d.textContent?.trim())
            .filter(Boolean);
        expect(labels.join(' ')).not.toContain('Options');
    });

    it('handles missing args gracefully', () => {
        const tc = { id: 'tc-sql-empty', toolName: 'sql', args: {}, status: 'completed' };
        const { container } = render(<ToolCallView toolCall={tc} />);
        const header = container.querySelector('.tool-call-header');
        expect(header?.textContent).toContain('sql');
    });
});
