/**
 * Tests for ToolCallGroupView's "whisper-row" variant.
 *
 * The variant kicks in only when wrapped in a ToolCallVariantProvider with
 * value="whisper-row" (used by WhisperCollapsedGroup expanded body). The
 * wrapper card adopts the reference design's surface background, the header
 * shows a "Show/Hide" toggle (vs the default chevron), and the body uses a
 * white background separated by a 1px rule.
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ToolCallGroupView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallGroupView';
import type { RenderToolCall } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallGroupView';
import { ToolCallVariantProvider } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallVariant';

const baseToolCalls: RenderToolCall[] = [
    {
        id: 'a',
        toolName: 'view',
        args: { path: '/x.ts' },
        status: 'completed',
        startTime: '2026-05-10T08:00:00Z',
        endTime: '2026-05-10T08:00:01Z',
    },
    {
        id: 'b',
        toolName: 'grep',
        args: { pattern: 'foo' },
        status: 'completed',
        startTime: '2026-05-10T08:00:01Z',
        endTime: '2026-05-10T08:00:02Z',
    },
];

function renderInWhisper(extra: Partial<React.ComponentProps<typeof ToolCallGroupView>> = {}) {
    return render(
        <ToolCallVariantProvider value="whisper-row">
            <ToolCallGroupView
                category="read"
                toolCalls={baseToolCalls}
                compactness={1}
                renderToolTree={(id) => <div key={id} data-testid={`child-${id}`}>{id}</div>}
                {...extra}
            />
        </ToolCallVariantProvider>
    );
}

describe('ToolCallGroupView — whisper-row variant', () => {
    it('uses the surface background and rounded-md border in whisper variant', () => {
        const { container } = renderInWhisper();
        const card = container.querySelector('.tool-call-group--whisper');
        expect(card).toBeTruthy();
        expect(card?.className).toContain('bg-[#fafafa]');
        expect(card?.className).toContain('rounded-md');
        expect(card?.getAttribute('data-tool-variant')).toBe('whisper-row');
    });

    it('renders a "Show" toggle pill in collapsed state', () => {
        const { getByTestId } = renderInWhisper();
        const toggle = getByTestId('whisper-group-toggle');
        expect(toggle.textContent?.trim().startsWith('Show')).toBe(true);
        expect(toggle.className).toContain('text-[#0969da]');
    });

    it('flips to "Hide" toggle when expanded', () => {
        const { getByTestId, container } = renderInWhisper();
        const header = container.querySelector('.tool-call-group-header')!;
        act(() => {
            fireEvent.click(header);
        });
        const toggle = getByTestId('whisper-group-toggle');
        expect(toggle.textContent?.includes('Hide')).toBe(true);
    });

    it('omits the legacy category emoji icon in whisper variant', () => {
        const { container } = renderInWhisper();
        const header = container.querySelector('.tool-call-group-header')!;
        // Legacy CATEGORY_ICONS would render emoji like 📄 — assert it's not present
        expect(header.textContent ?? '').not.toMatch(/[📄✏️💻🤖]/);
    });

    it('renders body with white surface and reference border when expanded', () => {
        const { container } = renderInWhisper();
        const header = container.querySelector('.tool-call-group-header')!;
        act(() => {
            fireEvent.click(header);
        });
        const body = container.querySelector('.tool-call-group-body');
        expect(body).toBeTruthy();
        expect(body?.className).toContain('bg-white');
        expect(body?.className).toContain('border-[#e5e7eb]');
    });

    it('inserts a "·" rule before duration with font-mono in whisper variant', () => {
        const { container } = renderInWhisper();
        const header = container.querySelector('.tool-call-group-header')!;
        const duration = Array.from(header.querySelectorAll('span')).find((el) => /\d+(\.\d+)?s|ms/.test(el.textContent ?? ''));
        expect(duration).toBeTruthy();
        expect(duration?.className).toContain('font-mono');
        expect(duration?.className).toContain("before:content-[\"·\"]");
    });
});

describe('ToolCallGroupView — default (card) variant outside provider', () => {
    function renderDefault() {
        return render(
            <ToolCallGroupView
                category="read"
                toolCalls={baseToolCalls}
                compactness={1}
                renderToolTree={(id) => <div key={id} data-testid={`child-${id}`}>{id}</div>}
            />
        );
    }

    it('does not render the whisper card class', () => {
        const { container } = renderDefault();
        expect(container.querySelector('.tool-call-group--whisper')).toBeNull();
    });

    it('does not render the Show/Hide pill toggle', () => {
        const { container } = renderDefault();
        expect(container.querySelector('[data-testid="whisper-group-toggle"]')).toBeNull();
    });

    it('still renders the category emoji icon', () => {
        const { container } = renderDefault();
        const header = container.querySelector('.tool-call-group-header')!;
        expect(header.textContent ?? '').toMatch(/📄/);
    });
});
