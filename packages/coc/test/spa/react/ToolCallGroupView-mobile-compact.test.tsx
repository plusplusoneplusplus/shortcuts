/**
 * Tests for ToolCallGroupView mobile compaction:
 * - Tighter padding on headers
 * - Timestamp hidden on mobile
 * - Reduced outer margin
 * - Compact content item padding
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallGroupView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallGroupView';
import { mockViewport } from '../helpers/viewport-mock';

let viewportCleanup: (() => void) | undefined;

afterEach(() => {
    viewportCleanup?.();
    viewportCleanup = undefined;
});

const baseToolCalls = [
    {
        id: 'tc-1',
        toolName: 'view',
        args: { path: '/src/a.ts' },
        result: 'file content',
        status: 'completed',
        startTime: '2026-04-04T12:30:00.000Z',
        endTime: '2026-04-04T12:30:01.200Z',
    },
    {
        id: 'tc-2',
        toolName: 'view',
        args: { path: '/src/b.ts' },
        result: 'file content',
        status: 'completed',
        startTime: '2026-04-04T12:30:01.500Z',
        endTime: '2026-04-04T12:30:02.000Z',
    },
];

function renderGroup(overrides: Record<string, unknown> = {}) {
    return render(
        <ToolCallGroupView
            category="read"
            toolCalls={baseToolCalls}
            compactness={1}
            renderToolTree={(id) => <div data-testid={`tool-${id}`}>{id}</div>}
            {...overrides}
        />
    );
}

describe('ToolCallGroupView — semantic shell group summary', () => {
    const shellCalls = [
        { id: 'sh-1', toolName: 'shell', args: { command: 'rg foo' }, status: 'completed' },
        { id: 'sh-2', toolName: 'shell', args: { command: 'grep bar src' }, status: 'completed' },
    ];

    it('uses a homogeneous semantic label for an all-search shell group', () => {
        render(
            <ToolCallGroupView
                category="shell"
                toolCalls={shellCalls}
                compactness={1}
                renderToolTree={(id) => <div data-testid={`tool-${id}`}>{id}</div>}
            />
        );
        expect(document.querySelector('.tool-call-group-label')?.textContent).toContain('2 searches');
    });

    it('falls back to the generic summary for a mixed shell group', () => {
        render(
            <ToolCallGroupView
                category="shell"
                toolCalls={[
                    { id: 'm-1', toolName: 'shell', args: { command: 'rg foo' }, status: 'completed' },
                    { id: 'm-2', toolName: 'shell', args: { command: 'npm test' }, status: 'completed' },
                ]}
                compactness={1}
                renderToolTree={(id) => <div data-testid={`tool-${id}`}>{id}</div>}
            />
        );
        const label = document.querySelector('.tool-call-group-label')?.textContent ?? '';
        expect(label).toContain('shell operations');
    });
});

describe('ToolCallGroupView — mobile compact header', () => {
    it('applies compact padding classes', () => {
        viewportCleanup = mockViewport(375);
        renderGroup();
        const header = document.querySelector('.tool-call-group-header')!;
        expect(header.className).toContain('gap-1.5');
        expect(header.className).toContain('px-2');
        expect(header.className).toContain('py-1');
        expect(header.className).toContain('md:gap-2');
        expect(header.className).toContain('md:px-2.5');
        expect(header.className).toContain('md:py-1.5');
    });
});

describe('ToolCallGroupView — timestamp hidden on mobile', () => {
    it('hides timestamp on mobile viewport', () => {
        viewportCleanup = mockViewport(375);
        renderGroup();
        // On mobile, the start-time label is not rendered at all
        const d = new Date('2026-04-04T12:30:00.000Z');
        let hh = d.getHours();
        const ampm = hh >= 12 ? 'PM' : 'AM';
        hh = hh % 12 || 12;
        const mm = String(d.getMinutes()).padStart(2, '0');
        expect(screen.queryByText(new RegExp(`${hh}:${mm} ${ampm}`))).toBeNull();
    });

    it('shows timestamp on desktop viewport', () => {
        viewportCleanup = mockViewport(1024);
        renderGroup();
        const d = new Date('2026-04-04T12:30:00.000Z');
        let hh = d.getHours();
        const ampm = hh >= 12 ? 'PM' : 'AM';
        hh = hh % 12 || 12;
        const mm = String(d.getMinutes()).padStart(2, '0');
        expect(screen.getByText(new RegExp(`${hh}:${mm} ${ampm}`))).toBeTruthy();
    });

    it('duration gets ml-auto on mobile when timestamp is hidden', () => {
        viewportCleanup = mockViewport(375);
        renderGroup();
        const duration = screen.getByText('2.0s');
        expect(duration.className).toContain('ml-auto');
    });

    it('arrow gets ml-auto on mobile when no duration and no timestamp rendered', () => {
        viewportCleanup = mockViewport(375);
        renderGroup({
            toolCalls: [
                { id: 'tc-x', toolName: 'view', status: 'completed' },
            ],
        });
        // No startTime/endTime → no duration, no startLabel
        // On mobile, startLabel also hidden, so arrow should get ml-auto
        const arrows = screen.getAllByText('▶');
        const lastArrow = arrows[arrows.length - 1];
        expect(lastArrow.className).toContain('ml-auto');
    });
});

describe('ToolCallGroupView — compact outer spacing', () => {
    it('group has my-0.5 md:my-1 classes', () => {
        viewportCleanup = mockViewport(375);
        renderGroup();
        const group = document.querySelector('.tool-call-group')!;
        expect(group.className).toContain('my-0.5');
        expect(group.className).toContain('md:my-1');
    });
});

describe('ToolCallGroupView — compact content items', () => {
    it('content items have compact padding with md overrides', () => {
        viewportCleanup = mockViewport(375);
        renderGroup({
            orderedItems: [
                { type: 'tool' as const, toolId: 'tc-1', key: 'k1' },
                { type: 'content' as const, key: 'k2', html: '<p>A message</p>' },
            ],
        });
        // Expand the group
        const header = document.querySelector('.tool-call-group-header') as HTMLElement;
        fireEvent.click(header);
        const contentItem = document.querySelector('.tool-call-group-content')!;
        expect(contentItem.className).toContain('px-2');
        expect(contentItem.className).toContain('py-0.5');
        expect(contentItem.className).toContain('md:px-3');
        expect(contentItem.className).toContain('md:py-1');
    });
});
