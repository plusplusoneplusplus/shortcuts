/**
 * @vitest-environment jsdom
 *
 * Tests for RalphSubmitNode — the per-submit card in the Ralph workflow
 * pane timeline. Pure presentational: status dot/badge per status, PR link
 * on a completed submit, error copy on a failed one, and click-through to
 * the recorded submit `processId`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RalphSubmitNode } from '../../../../src/server/spa/client/react/features/chat/RalphSubmitNode';
import type { RalphSubmitRecord } from '@plusplusoneplusplus/coc-client';

function makeSubmit(overrides: Partial<RalphSubmitRecord> = {}): RalphSubmitRecord {
    return {
        submitIndex: 1,
        taskId: 'task-s1',
        processId: 'proc-s1',
        startedAt: new Date(Date.now() - 20_000).toISOString(),
        status: 'queued',
        ...overrides,
    };
}

describe('RalphSubmitNode', () => {
    it.each(['queued', 'running', 'completed', 'failed'] as const)(
        'renders the %s status badge',
        (status) => {
            render(<RalphSubmitNode submit={makeSubmit({ status })} />);
            const badge = screen.getByTestId('ralph-submit-status-1');
            expect(badge.textContent?.toLowerCase()).toBe(status);
        },
    );

    it('renders the header with the submit index', () => {
        render(<RalphSubmitNode submit={makeSubmit({ submitIndex: 3 })} />);
        expect(screen.getByTestId('ralph-submit-node-3').textContent).toContain('PR submit #3');
    });

    it('renders the PR URL as a new-tab link on a completed submit', () => {
        render(
            <RalphSubmitNode
                submit={makeSubmit({
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    prUrl: 'https://github.com/acme/repo/pull/42',
                    prNumber: 42,
                })}
            />,
        );
        const link = screen.getByTestId('ralph-submit-link-1') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('https://github.com/acme/repo/pull/42');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.textContent).toBe('PR #42');
    });

    it('falls back to the raw URL text when prNumber is missing', () => {
        render(
            <RalphSubmitNode
                submit={makeSubmit({ status: 'completed', prUrl: 'https://github.com/acme/repo/pull/7' })}
            />,
        );
        expect(screen.getByTestId('ralph-submit-link-1').textContent).toBe(
            'https://github.com/acme/repo/pull/7',
        );
    });

    it('shows the error text on a failed submit', () => {
        render(
            <RalphSubmitNode
                submit={makeSubmit({ status: 'failed', error: 'cherry-pick conflict on abc123' })}
            />,
        );
        expect(screen.getByTestId('ralph-submit-summary-1').textContent).toBe(
            'cherry-pick conflict on abc123',
        );
    });

    it('shows a generic failure copy when a failed submit has no error text', () => {
        render(<RalphSubmitNode submit={makeSubmit({ status: 'failed', error: undefined })} />);
        expect(screen.getByTestId('ralph-submit-summary-1').textContent).toBe('Submit failed');
    });

    it('clicking the card forwards the recorded processId', () => {
        const onSelect = vi.fn();
        render(<RalphSubmitNode submit={makeSubmit()} onSelect={onSelect} />);
        fireEvent.click(screen.getByTestId('ralph-submit-node-1'));
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('proc-s1');
    });

    it('clicking the PR link does not also select the node', () => {
        const onSelect = vi.fn();
        render(
            <RalphSubmitNode
                submit={makeSubmit({ status: 'completed', prUrl: 'https://github.com/acme/repo/pull/42' })}
                onSelect={onSelect}
            />,
        );
        fireEvent.click(screen.getByTestId('ralph-submit-link-1'));
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('is inert without a processId', () => {
        const onSelect = vi.fn();
        render(<RalphSubmitNode submit={makeSubmit({ processId: undefined })} onSelect={onSelect} />);
        const node = screen.getByTestId('ralph-submit-node-1');
        expect(node.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(node);
        expect(onSelect).not.toHaveBeenCalled();
    });
});
