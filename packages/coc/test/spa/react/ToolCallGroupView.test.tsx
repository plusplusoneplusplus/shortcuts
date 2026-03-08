import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    ToolCallGroupView,
    type RenderToolCall,
} from '../../../src/server/spa/client/react/processes/ToolCallGroupView';

function makeTc(id: string, status: string, toolName = 'view'): RenderToolCall {
    return { id, toolName, status, startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:00:01Z' };
}

const noop = () => null;

describe('ToolCallGroupView — partial failure rendering', () => {
    it('shows ❓ icon and status summary when there is a partial failure', () => {
        const toolCalls = [
            makeTc('t1', 'completed'),
            makeTc('t2', 'failed'),
            makeTc('t3', 'completed'),
        ];
        const { container } = render(
            <ToolCallGroupView
                category="read"
                toolCalls={toolCalls}
                compactness={1}
                renderToolTree={noop}
            />
        );
        const header = container.querySelector('.tool-call-group-header')!;
        expect(header.textContent).toContain('❓');
        expect(header.textContent).toContain('1 failed, 2 succeeded');
    });

    it('shows ✅ icon and no status summary when all succeeded', () => {
        const toolCalls = [makeTc('t1', 'completed'), makeTc('t2', 'completed')];
        const { container } = render(
            <ToolCallGroupView
                category="read"
                toolCalls={toolCalls}
                compactness={1}
                renderToolTree={noop}
            />
        );
        const header = container.querySelector('.tool-call-group-header')!;
        expect(header.textContent).toContain('✅');
        expect(container.querySelector('.tool-call-group-status')).toBeNull();
    });

    it('shows ❌ icon and no status summary when all failed', () => {
        const toolCalls = [makeTc('t1', 'failed'), makeTc('t2', 'failed')];
        const { container } = render(
            <ToolCallGroupView
                category="read"
                toolCalls={toolCalls}
                compactness={1}
                renderToolTree={noop}
            />
        );
        const header = container.querySelector('.tool-call-group-header')!;
        expect(header.textContent).toContain('❌');
        expect(container.querySelector('.tool-call-group-status')).toBeNull();
    });

    it('shows 🔄 icon when some tools are still running', () => {
        const toolCalls = [makeTc('t1', 'completed'), makeTc('t2', 'running')];
        const { container } = render(
            <ToolCallGroupView
                category="read"
                toolCalls={toolCalls}
                compactness={1}
                renderToolTree={noop}
            />
        );
        const header = container.querySelector('.tool-call-group-header')!;
        expect(header.textContent).toContain('🔄');
    });

    it('status summary shows correct counts for large partial failure group', () => {
        const toolCalls = [
            ...Array.from({ length: 14 }, (_, i) => makeTc(`t${i}`, 'completed')),
            makeTc('t14', 'failed'),
        ];
        const { container } = render(
            <ToolCallGroupView
                category="read"
                toolCalls={toolCalls}
                compactness={1}
                renderToolTree={noop}
            />
        );
        const status = container.querySelector('.tool-call-group-status')!;
        expect(status.textContent).toBe('(1 failed, 14 succeeded)');
    });
});
