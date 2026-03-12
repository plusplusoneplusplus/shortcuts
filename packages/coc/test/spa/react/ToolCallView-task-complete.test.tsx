/**
 * Tests for ToolCallView — task_complete and suggest_follow_ups tool rendering.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

vi.mock('../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

function makeTaskCompleteCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-complete-1',
        toolName: 'task_complete',
        args: { summary: 'Added **new feature** with tests.' },
        status: 'completed',
        result: 'Added **new feature** with tests.',
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
        ...overrides,
    };
}

function makeSuggestFollowUpsCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-followups-1',
        toolName: 'suggest_follow_ups',
        args: { suggestions: ['Run the tests', 'Review the diff', 'Deploy to staging'] },
        status: 'completed',
        result: '',
        ...overrides,
    };
}

function getHeader(container: HTMLElement) {
    return container.querySelector('.tool-call-header');
}

function getBody(container: HTMLElement) {
    return container.querySelector('.tool-call-body');
}

describe('ToolCallView — task_complete rendering', () => {
    it('shows summary text in the collapsed header', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall()} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Added **new feature** with tests.');
    });

    it('shows truncated summary in header for long summaries', () => {
        const longSummary = 'A'.repeat(100);
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall({ args: { summary: longSummary }, result: longSummary })} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('A'.repeat(77) + '...');
    });

    it('shows "Task completed" when summary is empty', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall({ args: {}, result: '' })} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Task completed');
    });

    it('defaults to expanded state', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall()} />
        );
        const body = getBody(container);
        expect(body).toBeTruthy();
        expect(body!.classList.contains('hidden')).toBe(false);
    });

    it('renders result as markdown, not plain text', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall()} />
        );
        const mdEl = container.querySelector('[data-testid="task-complete-markdown"]');
        expect(mdEl).toBeTruthy();
        expect(mdEl!.innerHTML).toContain('<p>');
        expect(mdEl!.classList.contains('markdown-body')).toBe(true);
    });

    it('does not render generic Arguments or Result sections', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall()} />
        );
        const body = getBody(container)!;
        const labels = body.querySelectorAll('.text-\\[10px\\]');
        const labelTexts = Array.from(labels).map(el => el.textContent);
        expect(labelTexts).not.toContain('Arguments');
        expect(labelTexts).not.toContain('Result');
    });

    it('falls back to args.summary when result is empty', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall({ result: '' })} />
        );
        const mdEl = container.querySelector('[data-testid="task-complete-markdown"]');
        expect(mdEl).toBeTruthy();
        expect(mdEl!.innerHTML).toContain('Added **new feature** with tests.');
    });

    it('can be collapsed by clicking the header', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall()} />
        );
        // Initially expanded
        let body = getBody(container)!;
        expect(body.classList.contains('hidden')).toBe(false);

        // Click to collapse
        const header = getHeader(container)!;
        fireEvent.click(header);
        body = getBody(container)!;
        expect(body.classList.contains('hidden')).toBe(true);
    });
});

describe('ToolCallView — suggest_follow_ups summary', () => {
    it('shows suggestions joined with · in header', () => {
        const { container } = render(
            <ToolCallView toolCall={makeSuggestFollowUpsCall()} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Run the tests · Review the diff · Deploy to staging');
    });
});

describe('ToolCallView — read_agent summary', () => {
    it('shows agent ID in header summary', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'ra-1',
                toolName: 'read_agent',
                args: { agent_id: 'agent-0', wait: true, timeout: 10 },
                status: 'completed',
                result: 'agent completed',
            }} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Agent agent-0 (wait)');
    });

    it('shows agent ID without wait flag when wait is false', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'ra-2',
                toolName: 'read_agent',
                args: { agent_id: 'agent-5' },
                status: 'completed',
            }} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Agent agent-5');
        expect(header.textContent).not.toContain('(wait)');
    });

    it('shows empty summary when agent_id is missing', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'ra-3',
                toolName: 'read_agent',
                args: {},
                status: 'completed',
            }} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('read_agent');
        expect(header.textContent).not.toContain('Agent');
    });
});
