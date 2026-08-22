/**
 * Tests for the branch-range base selector ("vs main" | "unpushed").
 *
 * Covers the toggle UI in BranchCommitStrip, the per-workspace persistence in
 * useBranchRangeBaseMode, and the RepoGitTab wiring that refetches with the
 * selected base.
 */

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { readRepoGitTabSource } from '../../helpers/repo-git-tab-source';

import { BranchCommitStrip } from '../../../../src/server/spa/client/react/features/git/branches/BranchCommitStrip';
import {
    loadBranchRangeBaseMode,
    saveBranchRangeBaseMode,
    useBranchRangeBaseMode,
} from '../../../../src/server/spa/client/react/features/git/hooks/useBranchRangeBaseMode';

const RANGE = {
    baseRef: 'origin/main',
    headRef: 'HEAD',
    commitCount: 3,
    additions: 10,
    deletions: 2,
    mergeBase: 'abc123',
    branchName: 'feature/foo',
    fileCount: 1,
};

describe('BranchCommitStrip base toggle', () => {
    it('hides the toggle when no handler is given', () => {
        render(<BranchCommitStrip commits={[]} branchRangeData={RANGE} />);
        expect(screen.queryByTestId('branch-range-base-toggle')).toBeNull();
    });

    it('renders both modes and marks the active one', () => {
        render(<BranchCommitStrip commits={[]} branchRangeData={RANGE} baseMode="default-branch" onBaseModeChange={vi.fn()} />);
        expect(screen.getByTestId('branch-range-base-default-branch').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('branch-range-base-upstream').getAttribute('aria-pressed')).toBe('false');
    });

    it('shows the resolved base ref as the label', () => {
        render(<BranchCommitStrip commits={[]} branchRangeData={{ ...RANGE, baseRef: 'origin/feature/foo' }} baseMode="upstream" onBaseModeChange={vi.fn()} />);
        expect(screen.getByTestId('branch-range-base-ref').textContent).toBe('origin/feature/foo');
    });

    it('reports the picked mode', () => {
        const onChange = vi.fn();
        render(<BranchCommitStrip commits={[]} branchRangeData={RANGE} baseMode="default-branch" onBaseModeChange={onChange} />);
        fireEvent.click(screen.getByTestId('branch-range-base-upstream'));
        expect(onChange).toHaveBeenCalledWith('upstream');
    });

    it('explains the fallback when the branch has no upstream', () => {
        render(
            <BranchCommitStrip
                commits={[]}
                branchRangeData={{ ...RANGE, baseModeFallback: true }}
                baseMode="upstream"
                onBaseModeChange={vi.fn()}
            />,
        );
        expect(screen.getByTestId('branch-range-base-fallback').textContent).toBe('no upstream — showing vs origin/main');
    });

    it('shows no fallback note in default-branch mode', () => {
        render(<BranchCommitStrip commits={[]} branchRangeData={RANGE} baseMode="default-branch" onBaseModeChange={vi.fn()} />);
        expect(screen.queryByTestId('branch-range-base-fallback')).toBeNull();
    });
});

describe('useBranchRangeBaseMode', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    function Probe({ workspaceId }: { workspaceId: string }) {
        const [mode, setMode] = useBranchRangeBaseMode(workspaceId);
        return (
            <button data-testid="probe" onClick={() => setMode(mode === 'upstream' ? 'default-branch' : 'upstream')}>
                {mode}
            </button>
        );
    }

    it('defaults to default-branch', () => {
        expect(loadBranchRangeBaseMode('ws1')).toBe('default-branch');
    });

    it('round-trips through localStorage', () => {
        saveBranchRangeBaseMode('ws1', 'upstream');
        expect(loadBranchRangeBaseMode('ws1')).toBe('upstream');
        expect(loadBranchRangeBaseMode('ws2')).toBe('default-branch');
    });

    it('ignores an unrecognised stored value', () => {
        localStorage.setItem('coc.branchRange.baseMode.ws1', 'sideways');
        expect(loadBranchRangeBaseMode('ws1')).toBe('default-branch');
    });

    it('persists the choice per workspace and restores it on switch back', () => {
        const { rerender } = render(<Probe workspaceId="ws1" />);
        act(() => { fireEvent.click(screen.getByTestId('probe')); });
        expect(screen.getByTestId('probe').textContent).toBe('upstream');

        rerender(<Probe workspaceId="ws2" />);
        expect(screen.getByTestId('probe').textContent).toBe('default-branch');

        rerender(<Probe workspaceId="ws1" />);
        expect(screen.getByTestId('probe').textContent).toBe('upstream');
    });
});

describe('RepoGitTab wiring', () => {
    const source = readRepoGitTabSource();

    it('sends the selected base with the branch-range request', () => {
        expect(source).toContain('getBranchRange(workspaceId, { refresh, base: mode })');
    });

    it('refetches when the toggle changes the mode', () => {
        const start = source.indexOf('const setBaseModeAndRefetch = useCallback');
        const block = source.slice(start, start + 400);
        expect(block).toContain('setBaseMode(mode)');
        expect(block).toContain('fetchBranchRange(false, mode)');
    });

    it('passes the mode into the overview and the file diff source', () => {
        expect(source).toContain('onBaseModeChange={data.setBaseModeAndRefetch}');
        expect(source).toContain('baseMode,');
    });
});
