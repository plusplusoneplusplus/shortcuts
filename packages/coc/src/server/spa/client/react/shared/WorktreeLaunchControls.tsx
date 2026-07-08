/**
 * WorktreeLaunchControls — shared opt-in "Use isolated Git worktree" control for
 * Work Item and Ralph launch surfaces (AC-05).
 *
 * Renders a checkbox and, when checked, an optional "Base ref/SHA" field
 * (defaulting to the workspace's current `HEAD` when empty) plus a warning that
 * uncommitted source-checkout changes are excluded from the worktree.
 *
 * The whole control is hidden when the feature flag is off. It is disabled with
 * an explanatory message when the selected target does not advertise worktree
 * support or when the workspace is not a Git repository. Visibility/disabled
 * state is fully prop-driven so the control stays trivially testable; callers
 * resolve `available`/`supported`/`isGitRepo` from config, target capability,
 * and the workspace record respectively.
 */
import { useEffect, useState } from 'react';
import type { WorktreeExecutionRequest } from '@plusplusoneplusplus/coc-client';

export interface WorktreeLaunchState {
    /** Whether the user opted into isolated worktree execution. */
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
    /** Raw base ref/branch/SHA input (empty means "use current HEAD"). */
    baseRef: string;
    setBaseRef: (baseRef: string) => void;
    /**
     * The worktree launch request to embed under the `worktree` key, or
     * `undefined` when the option is not enabled (preserving non-worktree
     * behavior). Empty/whitespace base refs are dropped so the server uses HEAD.
     */
    request: WorktreeExecutionRequest | undefined;
    /** Reset both fields to their defaults. */
    reset: () => void;
}

/**
 * Build the opt-in worktree request from the control state. Returns `undefined`
 * when not enabled; a trimmed non-empty base ref is included, otherwise omitted
 * so the server defaults to the workspace's current `HEAD`.
 */
export function buildWorktreeRequest(enabled: boolean, baseRef: string): WorktreeExecutionRequest | undefined {
    if (!enabled) return undefined;
    const trimmed = baseRef.trim();
    return trimmed ? { enabled: true, baseRef: trimmed } : { enabled: true };
}

/**
 * State hook for the worktree launch control. Resets whenever the owning dialog
 * transitions to open so a prior launch's selection never leaks into the next.
 */
export function useWorktreeLaunchControls({ open }: { open: boolean }): WorktreeLaunchState {
    const [enabled, setEnabled] = useState(false);
    const [baseRef, setBaseRef] = useState('');

    useEffect(() => {
        if (!open) return;
        setEnabled(false);
        setBaseRef('');
    }, [open]);

    return {
        enabled,
        setEnabled,
        baseRef,
        setBaseRef,
        request: buildWorktreeRequest(enabled, baseRef),
        reset: () => {
            setEnabled(false);
            setBaseRef('');
        },
    };
}

/**
 * Fetch whether a target CoC server advertises Git worktree execution support.
 *
 * The runtime flag `gitWorktreeExecutionEnabled` (GET /api/config/runtime)
 * doubles as the per-server capability signal, so this works for both the local
 * server and remote targets addressed by their own API base. The fetch only
 * fires when `enabled` (the local feature flag is on) so tests/screens with the
 * feature off never hit the network. `undefined` means "still resolving" and is
 * treated optimistically by the control (not blocked); an explicit `false`
 * disables the option.
 */
export function useWorktreeCapability(
    apiBase: string | undefined,
    { enabled }: { enabled: boolean },
): boolean | undefined {
    const [supported, setSupported] = useState<boolean | undefined>(undefined);

    useEffect(() => {
        if (!enabled || !apiBase) {
            setSupported(undefined);
            return;
        }
        let cancelled = false;
        setSupported(undefined);
        (async () => {
            try {
                const resp = await fetch(`${apiBase}/config/runtime`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                const flag = data?.features?.gitWorktreeExecutionEnabled === true;
                if (!cancelled) setSupported(flag);
            } catch {
                // Unreachable target / old server → treat as unsupported so the
                // client disables the option rather than launching into a 400.
                if (!cancelled) setSupported(false);
            }
        })();
        return () => { cancelled = true; };
    }, [apiBase, enabled]);

    return supported;
}

export interface WorktreeLaunchControlsProps {
    /** Feature flag on (GET /api/config/runtime `gitWorktreeExecutionEnabled`). */
    available: boolean;
    /**
     * Whether the selected target advertises worktree support. `undefined`
     * (still resolving) is treated as supported so the option isn't blocked
     * while the capability check is in flight.
     */
    supported?: boolean;
    /** Whether the selected workspace is a Git repository. */
    isGitRepo?: boolean;
    enabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
    baseRef: string;
    onBaseRefChange: (baseRef: string) => void;
    disabled?: boolean;
    testIdPrefix: string;
}

export function WorktreeLaunchControls({
    available,
    supported,
    isGitRepo,
    enabled,
    onEnabledChange,
    baseRef,
    onBaseRefChange,
    disabled = false,
    testIdPrefix,
}: WorktreeLaunchControlsProps) {
    // Flag off → render nothing at all.
    if (!available) return null;

    const notGitRepo = isGitRepo === false;
    const unsupported = supported === false;
    const blocked = notGitRepo || unsupported;
    const checkboxDisabled = disabled || blocked;
    // A blocked target must never keep a stale "checked" opt-in.
    const isChecked = enabled && !blocked;

    const blockedMessage = notGitRepo
        ? 'The selected workspace is not a Git repository, so worktree execution is unavailable.'
        : 'The selected target does not support Git worktree execution.';

    return (
        <div data-testid={`${testIdPrefix}-worktree-controls`} className="rounded border border-[#d0d0d0] dark:border-[#3c3c3c] px-2 py-2 space-y-1.5">
            <label className="flex items-start gap-2 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                <input
                    type="checkbox"
                    data-testid={`${testIdPrefix}-worktree-checkbox`}
                    checked={isChecked}
                    disabled={checkboxDisabled}
                    onChange={(e) => onEnabledChange(e.target.checked)}
                    className="mt-0.5"
                />
                <span>
                    <span className="font-medium">Use isolated Git worktree</span>
                    <span className="block text-[11px] text-[#848484]">
                        Run in a dedicated per-run checkout; your current workspace checkout stays untouched.
                    </span>
                </span>
            </label>

            {blocked && (
                <p className="text-[11px] text-[#848484]" data-testid={`${testIdPrefix}-worktree-unavailable`}>
                    {blockedMessage}
                </p>
            )}

            {isChecked && (
                <div className="space-y-1 pl-6" data-testid={`${testIdPrefix}-worktree-details`}>
                    <label className="block text-[11px] text-[#848484]" htmlFor={`${testIdPrefix}-worktree-base-ref`}>
                        Base ref/SHA (optional)
                    </label>
                    <input
                        id={`${testIdPrefix}-worktree-base-ref`}
                        data-testid={`${testIdPrefix}-worktree-base-ref`}
                        type="text"
                        value={baseRef}
                        disabled={disabled}
                        onChange={(e) => onBaseRefChange(e.target.value)}
                        placeholder="Defaults to current HEAD"
                        className="w-full rounded border border-[#d0d0d0] dark:border-[#4a4a4a] bg-white dark:bg-[#1e1e1e] text-xs text-[#1e1e1e] dark:text-[#cccccc] px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500/30 disabled:opacity-60"
                    />
                    <p className="text-[11px] text-amber-600 dark:text-amber-400" data-testid={`${testIdPrefix}-worktree-dirty-warning`}>
                        Uncommitted changes in the source checkout are not copied into the worktree.
                    </p>
                </div>
            )}
        </div>
    );
}
