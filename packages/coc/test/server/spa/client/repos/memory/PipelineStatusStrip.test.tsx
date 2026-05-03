/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PipelineStatusStrip } from '../../../../../../src/server/spa/client/react/features/memory/PipelineStatusStrip';
import type { MemoryStats } from '../../../../../../src/server/spa/client/react/features/memory/memoryApi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStats(overrides: Partial<MemoryStats> = {}): MemoryStats {
    return {
        charCount: 500,
        charLimit: 2200,
        lastModified: null,
        pendingRawCount: 0,
        claimedRawCount: 0,
        consolidatedAt: null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Hidden when no raw pipeline data
// ---------------------------------------------------------------------------

describe('PipelineStatusStrip — hidden state', () => {
    it('renders nothing when stats is null', () => {
        const { container } = render(<PipelineStatusStrip stats={null} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when no raw pipeline activity exists', () => {
        const { container } = render(
            <PipelineStatusStrip stats={makeStats({ pendingRawCount: 0, claimedRawCount: 0 })} />
        );
        expect(container.innerHTML).toBe('');
    });
});

// ---------------------------------------------------------------------------
// Up to date (no pending, idle)
// ---------------------------------------------------------------------------

describe('PipelineStatusStrip — up to date', () => {
    it('shows checkmark when no pending records and has lastPromotedAt', () => {
        render(
            <PipelineStatusStrip
                stats={makeStats({ lastPromotedAt: '2024-01-15T10:00:00Z' })}
            />
        );
        const strip = screen.getByTestId('pipeline-status-strip');
        expect(strip.dataset.status).toBe('up-to-date');
        expect(strip.textContent).toContain('Up to date');
        expect(strip.textContent).toContain('Last promotion');
    });

    it('shows up-to-date without last-promotion when lastPromotedAt is null but claimedRawCount > 0', () => {
        render(
            <PipelineStatusStrip
                stats={makeStats({ claimedRawCount: 1 })}
            />
        );
        const strip = screen.getByTestId('pipeline-status-strip');
        expect(strip.dataset.status).toBe('up-to-date');
        expect(strip.textContent).not.toContain('Last promotion');
    });
});

// ---------------------------------------------------------------------------
// Pending + idle
// ---------------------------------------------------------------------------

describe('PipelineStatusStrip — pending idle', () => {
    it('shows pending count and idle label', () => {
        render(
            <PipelineStatusStrip
                stats={makeStats({ pendingRawCount: 5 })}
            />
        );
        const strip = screen.getByTestId('pipeline-status-strip');
        expect(strip.dataset.status).toBe('pending');
        expect(strip.textContent).toContain('5 pending');
        expect(strip.textContent).toContain('idle');
    });

    it('includes last-promotion time when available', () => {
        render(
            <PipelineStatusStrip
                stats={makeStats({ pendingRawCount: 3, lastPromotedAt: '2024-01-15T10:00:00Z' })}
            />
        );
        const strip = screen.getByTestId('pipeline-status-strip');
        expect(strip.textContent).toContain('Last promotion');
    });
});

// ---------------------------------------------------------------------------
// Queued
// ---------------------------------------------------------------------------

describe('PipelineStatusStrip — queued', () => {
    it('shows queued state with pending count', () => {
        render(
            <PipelineStatusStrip
                stats={makeStats({ pendingRawCount: 5, promotionStatus: 'queued' })}
            />
        );
        const strip = screen.getByTestId('pipeline-status-strip');
        expect(strip.dataset.status).toBe('queued');
        expect(strip.textContent).toContain('5 pending');
        expect(strip.textContent).toContain('⏳ queued');
    });

    it('renders strip even with 0 pending when status is queued', () => {
        render(
            <PipelineStatusStrip
                stats={makeStats({ pendingRawCount: 0, promotionStatus: 'queued' })}
            />
        );
        const strip = screen.getByTestId('pipeline-status-strip');
        expect(strip.dataset.status).toBe('queued');
    });
});

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

describe('PipelineStatusStrip — running', () => {
    it('shows running state with claimed count', () => {
        render(
            <PipelineStatusStrip
                stats={makeStats({ pendingRawCount: 3, claimedRawCount: 2, promotionStatus: 'running' })}
            />
        );
        const strip = screen.getByTestId('pipeline-status-strip');
        expect(strip.dataset.status).toBe('running');
        expect(strip.textContent).toContain('3 pending');
        expect(strip.textContent).toContain('2 claimed');
        expect(strip.textContent).toContain('▶ promoting');
    });

    it('renders strip with 0 pending when status is running', () => {
        render(
            <PipelineStatusStrip
                stats={makeStats({ pendingRawCount: 0, claimedRawCount: 0, promotionStatus: 'running' })}
            />
        );
        const strip = screen.getByTestId('pipeline-status-strip');
        expect(strip.dataset.status).toBe('running');
        expect(strip.textContent).toContain('▶ promoting');
    });
});

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

describe('PipelineStatusStrip — error', () => {
    it('shows error state with truncated message', () => {
        const longError = 'A'.repeat(100);
        render(
            <PipelineStatusStrip
                stats={makeStats({ pendingRawCount: 5, lastPromotionError: longError })}
            />
        );
        const strip = screen.getByTestId('pipeline-status-strip');
        expect(strip.dataset.status).toBe('error');
        expect(strip.textContent).toContain('5 pending');
        expect(strip.textContent).toContain('⚠');
        expect(strip.textContent).toContain('…');
    });

    it('shows short error without truncation', () => {
        render(
            <PipelineStatusStrip
                stats={makeStats({ pendingRawCount: 1, lastPromotionError: 'Model unavailable' })}
            />
        );
        const strip = screen.getByTestId('pipeline-status-strip');
        expect(strip.dataset.status).toBe('error');
        expect(strip.textContent).toContain('Model unavailable');
    });

    it('ignores error when promotion is running', () => {
        render(
            <PipelineStatusStrip
                stats={makeStats({ pendingRawCount: 1, lastPromotionError: 'stale error', promotionStatus: 'running' })}
            />
        );
        const strip = screen.getByTestId('pipeline-status-strip');
        expect(strip.dataset.status).toBe('running');
    });
});
