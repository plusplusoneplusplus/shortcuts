import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    ToolCallGroupView,
    type RenderToolCall,
} from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallGroupView';

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

describe('ToolCallGroupView — commit strip', () => {
    it('renders commit strip when commits are provided', () => {
        const toolCalls = [makeTc('t1', 'completed', 'powershell')];
        const commits = [{
            shortHash: 'abc1234',
            subject: 'Fix bug',
            branch: 'main',
            toolCallId: 't1',
        }];
        const { container } = render(
            <ToolCallGroupView
                category="shell"
                toolCalls={toolCalls}
                compactness={1}
                renderToolTree={noop}
                commits={commits}
            />
        );
        const strip = container.querySelector('[data-testid="commit-strip"]');
        expect(strip).toBeTruthy();
        expect(strip!.textContent).toContain('abc1234');
        expect(strip!.textContent).toContain('Fix bug');
    });

    it('does not render commit strip when commits is empty', () => {
        const toolCalls = [makeTc('t1', 'completed', 'powershell')];
        const { container } = render(
            <ToolCallGroupView
                category="shell"
                toolCalls={toolCalls}
                compactness={1}
                renderToolTree={noop}
                commits={[]}
            />
        );
        const strip = container.querySelector('[data-testid="commit-strip"]');
        expect(strip).toBeNull();
    });

    it('does not render commit strip when commits is undefined', () => {
        const toolCalls = [makeTc('t1', 'completed', 'powershell')];
        const { container } = render(
            <ToolCallGroupView
                category="shell"
                toolCalls={toolCalls}
                compactness={1}
                renderToolTree={noop}
            />
        );
        const strip = container.querySelector('[data-testid="commit-strip"]');
        expect(strip).toBeNull();
    });

    it('commit strip is visible even when group is collapsed', () => {
        const toolCalls = [makeTc('t1', 'completed', 'powershell')];
        const commits = [{
            shortHash: 'abc1234',
            subject: 'Fix bug',
            branch: 'main',
            toolCallId: 't1',
        }];
        const { container } = render(
            <ToolCallGroupView
                category="shell"
                toolCalls={toolCalls}
                compactness={1}
                renderToolTree={noop}
                commits={commits}
                isStreaming={false}
            />
        );
        // Group should be collapsed (no expanded body)
        expect(container.querySelector('.tool-call-group-body')).toBeNull();
        // But strip should be visible
        const strip = container.querySelector('[data-testid="commit-strip"]');
        expect(strip).toBeTruthy();
    });

    it('passes workspaceId to CommitStrip', () => {
        const toolCalls = [makeTc('t1', 'completed', 'powershell')];
        const commits = [{
            shortHash: 'abc1234',
            subject: 'Fix bug',
            branch: 'main',
            toolCallId: 't1',
        }];
        const { container } = render(
            <ToolCallGroupView
                category="shell"
                toolCalls={toolCalls}
                compactness={1}
                renderToolTree={noop}
                commits={commits}
                workspaceId="ws-123"
            />
        );
        const row = container.querySelector('[data-testid="commit-strip-row-abc1234"]')!;
        // With workspaceId, row should be clickable
        expect(row.className).toContain('cursor-pointer');
    });
});
