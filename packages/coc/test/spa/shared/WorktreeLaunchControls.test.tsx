/**
 * @vitest-environment jsdom
 *
 * Tests for WorktreeLaunchControls — the shared opt-in "Use isolated Git
 * worktree" launch control plus its request-builder and capability hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';
import { useState } from 'react';
import {
    WorktreeLaunchControls,
    buildWorktreeRequest,
    useWorktreeCapability,
    type WorktreeLaunchControlsProps,
} from '../../../src/server/spa/client/react/shared/WorktreeLaunchControls';

/** Controlled harness so checkbox/base-ref interactions drive real state. */
function Harness(props: Partial<WorktreeLaunchControlsProps> & { available: boolean }) {
    const [enabled, setEnabled] = useState(false);
    const [baseRef, setBaseRef] = useState('');
    return (
        <WorktreeLaunchControls
            available={props.available}
            supported={props.supported}
            isGitRepo={props.isGitRepo}
            enabled={enabled}
            onEnabledChange={setEnabled}
            baseRef={baseRef}
            onBaseRefChange={setBaseRef}
            disabled={props.disabled}
            testIdPrefix={props.testIdPrefix ?? 'wt'}
        />
    );
}

describe('WorktreeLaunchControls', () => {
    it('renders nothing when the feature flag is off', () => {
        const { container } = render(<Harness available={false} />);
        expect(container.innerHTML).toBe('');
    });

    it('shows the opt-in checkbox when the feature is available', () => {
        render(<Harness available />);
        expect(screen.getByTestId('wt-worktree-checkbox')).toBeDefined();
        // Base-ref field + warning only appear once checked.
        expect(screen.queryByTestId('wt-worktree-details')).toBeNull();
    });

    it('reveals the base-ref field and dirty warning when checked', () => {
        render(<Harness available />);
        fireEvent.click(screen.getByTestId('wt-worktree-checkbox'));
        expect(screen.getByTestId('wt-worktree-base-ref')).toBeDefined();
        expect(screen.getByTestId('wt-worktree-dirty-warning').textContent)
            .toContain('Uncommitted changes');
    });

    it('disables the option with a message when the workspace is not a Git repo', () => {
        render(<Harness available isGitRepo={false} />);
        expect(screen.getByTestId('wt-worktree-checkbox')).toBeDisabled();
        expect(screen.getByTestId('wt-worktree-unavailable').textContent)
            .toContain('not a Git repository');
    });

    it('disables the option with a message when the target lacks capability', () => {
        render(<Harness available supported={false} />);
        expect(screen.getByTestId('wt-worktree-checkbox')).toBeDisabled();
        expect(screen.getByTestId('wt-worktree-unavailable').textContent)
            .toContain('does not support');
    });

    it('does not disable while capability is still resolving (undefined)', () => {
        render(<Harness available supported={undefined} isGitRepo />);
        expect(screen.getByTestId('wt-worktree-checkbox')).not.toBeDisabled();
        expect(screen.queryByTestId('wt-worktree-unavailable')).toBeNull();
    });

    it('honors the disabled prop while a launch is in flight', () => {
        render(<Harness available disabled isGitRepo />);
        expect(screen.getByTestId('wt-worktree-checkbox')).toBeDisabled();
    });
});

describe('buildWorktreeRequest', () => {
    it('returns undefined when the option is off', () => {
        expect(buildWorktreeRequest(false, 'main')).toBeUndefined();
    });

    it('omits an empty/whitespace base ref so the server uses HEAD', () => {
        expect(buildWorktreeRequest(true, '')).toEqual({ enabled: true });
        expect(buildWorktreeRequest(true, '   ')).toEqual({ enabled: true });
    });

    it('trims and includes a non-empty base ref', () => {
        expect(buildWorktreeRequest(true, '  release/1.2  ')).toEqual({ enabled: true, baseRef: 'release/1.2' });
    });
});

describe('useWorktreeCapability', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('does not fetch and returns undefined when the feature flag is off', () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useWorktreeCapability('http://x/api', { enabled: false }));
        expect(result.current).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports supported=true when the target advertises the flag', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ features: { gitWorktreeExecutionEnabled: true } }),
        }));
        const { result } = renderHook(() => useWorktreeCapability('http://x/api', { enabled: true }));
        await waitFor(() => expect(result.current).toBe(true));
        expect(fetch).toHaveBeenCalledWith('http://x/api/config/runtime');
    });

    it('reports supported=false when the target does not advertise the flag', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ features: {} }),
        }));
        const { result } = renderHook(() => useWorktreeCapability('http://x/api', { enabled: true }));
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('reports supported=false when the target is unreachable', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        const { result } = renderHook(() => useWorktreeCapability('http://x/api', { enabled: true }));
        await waitFor(() => expect(result.current).toBe(false));
    });
});
