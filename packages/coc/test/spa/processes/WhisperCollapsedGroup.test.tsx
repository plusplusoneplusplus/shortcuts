import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { WhisperCollapsedGroup } from '../../../src/server/spa/client/react/processes/WhisperCollapsedGroup';
import type { WhisperSummary } from '../../../src/server/spa/client/react/processes/toolGroupUtils';
import type { DetectedCommit } from '../../../src/server/spa/client/react/processes/commitDetection';

function makeToolMap(entries: Array<[string, any]>): Map<string, any> {
    return new Map(entries);
}

const defaultProps = {
    precedingChunks: [],
    toolById: new Map() as any,
    toolsWithChildren: new Set<string>(),
    toolParentById: new Map<string, string>(),
    groupSingleLineMessages: false,
    renderToolTree: () => null,
};

function makeSummary(overrides: Partial<WhisperSummary> = {}): WhisperSummary {
    return {
        toolCallCount: 5,
        messageCount: 2,
        ...overrides,
    };
}

function makeCommit(overrides: Partial<DetectedCommit> = {}): DetectedCommit {
    return {
        shortHash: 'abc1234',
        subject: 'feat: add feature',
        toolCallId: 't1',
        isFixup: false,
        ...overrides,
    };
}

describe('WhisperCollapsedGroup', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders commit count in header', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 3, commits: [
                    makeCommit({ shortHash: 'aaa1111' }),
                    makeCommit({ shortHash: 'bbb2222' }),
                    makeCommit({ shortHash: 'ccc3333' }),
                ] })}
            />,
        );
        expect(screen.getByTestId('whisper-header-text').textContent).toContain('3 commits');
    });

    it('renders commit hover span with dotted underline for commit text', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 1, commits: [makeCommit()] })}
            />,
        );
        const hoverSpan = screen.getByTestId('whisper-commit-hover');
        expect(hoverSpan).toBeDefined();
        expect(hoverSpan.textContent).toBe('1 commit');
        expect(hoverSpan.className).toContain('underline');
    });

    it('shows commit popover on hover', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 2, commits: [
                    makeCommit({ shortHash: 'abc1234', subject: 'feat: first' }),
                    makeCommit({ shortHash: 'def5678', subject: 'fix: second' }),
                ] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        fireEvent.mouseEnter(hoverTarget);

        const popover = screen.getByTestId('commit-hover-popover');
        expect(popover).toBeDefined();
        expect(screen.getByTestId('commit-popover-row-abc1234')).toBeDefined();
        expect(screen.getByTestId('commit-popover-row-def5678')).toBeDefined();
        expect(popover.textContent).toContain('abc1234');
        expect(popover.textContent).toContain('feat: first');
        expect(popover.textContent).toContain('def5678');
        expect(popover.textContent).toContain('fix: second');
    });

    it('hides commit popover on mouse leave after grace timer', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 1, commits: [makeCommit()] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        fireEvent.mouseEnter(hoverTarget);
        expect(screen.getByTestId('commit-hover-popover')).toBeDefined();

        fireEvent.mouseLeave(hoverTarget);
        act(() => { vi.advanceTimersByTime(200); });
        expect(screen.queryByTestId('commit-hover-popover')).toBeNull();
    });

    it('commit popover rows show correct emoji for regular vs fixup commits', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ fixupCommitCount: 1, fixupCommits: [
                    makeCommit({ shortHash: 'fix1234', subject: 'fixup! feat: auth', isFixup: true }),
                ] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-fixup-hover');
        fireEvent.mouseEnter(hoverTarget);

        const row = screen.getByTestId('commit-popover-row-fix1234');
        expect(row.textContent).toContain('🔧');
    });

    it('commit popover row navigates to git tab on click when workspaceId provided', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                workspaceId="my-workspace"
                summary={makeSummary({ commitCount: 1, commits: [
                    makeCommit({ shortHash: 'abc1234', fullHash: 'abc1234567890' }),
                ] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        fireEvent.mouseEnter(hoverTarget);

        const row = screen.getByTestId('commit-popover-row-abc1234');
        fireEvent.click(row);
        expect(location.hash).toBe('#repos/my-workspace/git/abc1234567890');
    });

    it('commit popover row is not clickable when workspaceId is absent', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 1, commits: [makeCommit()] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        fireEvent.mouseEnter(hoverTarget);

        const row = screen.getByTestId('commit-popover-row-abc1234');
        expect(row.getAttribute('role')).toBeNull();
        expect(row.className).not.toContain('cursor-pointer');
    });

    it('shows fixup hover span separately from commit hover span', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({
                    commitCount: 1,
                    commits: [makeCommit({ shortHash: 'aaa1111' })],
                    fixupCommitCount: 1,
                    fixupCommits: [makeCommit({ shortHash: 'bbb2222', isFixup: true })],
                })}
            />,
        );
        expect(screen.getByTestId('whisper-commit-hover').textContent).toBe('1 commit');
        expect(screen.getByTestId('whisper-fixup-hover').textContent).toBe('1 fixup');
    });

    it('no hover span when commitCount is zero or absent', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary()}
            />,
        );
        expect(screen.queryByTestId('whisper-commit-hover')).toBeNull();
        expect(screen.queryByTestId('whisper-fixup-hover')).toBeNull();
    });

    it('uses shortHash for navigation when fullHash is absent', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                workspaceId="ws1"
                summary={makeSummary({ commitCount: 1, commits: [
                    makeCommit({ shortHash: 'abc1234', fullHash: undefined }),
                ] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        fireEvent.mouseEnter(hoverTarget);

        const row = screen.getByTestId('commit-popover-row-abc1234');
        fireEvent.click(row);
        expect(location.hash).toBe('#repos/ws1/git/abc1234');
    });
});
