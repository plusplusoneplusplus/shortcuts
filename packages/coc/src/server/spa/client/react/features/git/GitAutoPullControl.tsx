/**
 * GitAutoPullControl — per-repo auto-pull interval selector for the git panel.
 *
 * Presents preset intervals (Off / 30m / 1h / 4h / 8h / 1d) plus a custom
 * hours input, and reports the chosen `{ enabled, intervalMinutes }` back
 * through `onChange`. Purely presentational: the parent (RepoGitTab) owns the
 * persisted `autoPull` preference and wires `onChange` to `patchRepo`.
 *
 * Auto-pull itself runs on the server, so the "next run" and "last run" rows are
 * read-only reflections of `GET /api/workspaces/:id/git/auto-pull` — the control
 * never counts down on its own schedule, which is why the countdown survives a
 * page reload.
 *
 * "Off" keeps the last chosen interval in `intervalMinutes` (so re-enabling
 * restores it) while flipping `enabled` to false. The server schema requires a
 * positive-integer interval even while disabled, so a valid minutes value is
 * always sent — never a zero/undefined.
 */

import { useState, useEffect, useRef } from 'react';
import type { GitAutoPullStatusResponse } from '@plusplusoneplusplus/coc-client';
import { formatTimeUntil, describeLastRun, describeLastRunDetail } from './autoPullStatusView';

export interface AutoPullSetting {
    enabled: boolean;
    intervalMinutes: number;
}

interface GitAutoPullControlProps {
    /** Current persisted setting, or undefined when never configured (treated as Off). */
    value?: AutoPullSetting;
    /** Called with the full setting whenever the user picks a preset or applies a valid custom value. */
    onChange: (next: AutoPullSetting) => void;
    /** Server-owned schedule + last run. Read-only; absent until the first read. */
    status?: GitAutoPullStatusResponse;
    /** Slim variant to match the compact GitPanelHeader row. */
    compact?: boolean;
}

/** How often the "in 4m" label is recomputed. Display only — it starts no pull. */
const COUNTDOWN_REFRESH_MS = 30_000;

/** Minutes cap mirrors the server AutoPullSchema (AUTO_PULL_MAX_INTERVAL_MINUTES). */
export const AUTO_PULL_MAX_INTERVAL_MINUTES = 1440;
/** Interval kept when auto-pull is turned off without a prior value, so re-enabling has a sane default. */
const DEFAULT_INTERVAL_MINUTES = 30;
/** Preset intervals (minutes) offered besides Off + custom. */
export const AUTO_PULL_PRESETS = [30, 60, 240, 480, 1440] as const;
const AUTO_PULL_MAX_CUSTOM_HOURS = AUTO_PULL_MAX_INTERVAL_MINUTES / 60;

function isValidMinutes(n: number): boolean {
    return Number.isInteger(n) && n >= 1 && n <= AUTO_PULL_MAX_INTERVAL_MINUTES;
}

function formatInterval(intervalMinutes: number): string {
    if (intervalMinutes % 1440 === 0) return `${intervalMinutes / 1440}d`;
    if (intervalMinutes % 60 === 0) return `${intervalMinutes / 60}h`;
    return `${intervalMinutes}m`;
}

export function GitAutoPullControl({ value, onChange, status, compact }: GitAutoPullControlProps) {
    const enabled = !!value?.enabled;
    const intervalMinutes = value?.intervalMinutes;
    const isPreset = enabled && intervalMinutes != null && (AUTO_PULL_PRESETS as readonly number[]).includes(intervalMinutes);
    const isCustom = enabled && intervalMinutes != null && !isPreset;

    const [open, setOpen] = useState(false);
    const [customText, setCustomText] = useState('');
    const [customError, setCustomError] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    function toggleOpen() {
        setOpen(prev => {
            const next = !prev;
            if (next) {
                // Seed the custom field only when the active custom value is an exact hour.
                setCustomError(false);
                setCustomText(isCustom && intervalMinutes != null && intervalMinutes % 60 === 0
                    ? String(intervalMinutes / 60)
                    : '');
            }
            return next;
        });
    }

    // Close on outside click, mirroring the GitPanelHeader dropdown pattern.
    useEffect(() => {
        if (!open) return;
        function handleClickOutside(e: MouseEvent) {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    // Re-render periodically so the relative "next run" label stays honest. This
    // only refreshes text; the schedule itself lives on the server.
    const [nowMs, setNowMs] = useState(() => Date.now());
    useEffect(() => {
        if (!status?.nextRunAt) return;
        const handle = setInterval(() => setNowMs(Date.now()), COUNTDOWN_REFRESH_MS);
        return () => clearInterval(handle);
    }, [status?.nextRunAt]);

    const nextRunLabel = formatTimeUntil(status?.nextRunAt, nowMs);
    const lastRunLabel = describeLastRun(status);
    const lastRunDetail = describeLastRunDetail(status);

    const label = enabled && intervalMinutes != null ? formatInterval(intervalMinutes) : 'Off';
    const title = [
        enabled && intervalMinutes != null
            ? `Auto-pull every ${formatInterval(intervalMinutes)}`
            : 'Auto-pull off',
        nextRunLabel && `next run ${nextRunLabel}`,
        lastRunDetail && `last run: ${lastRunDetail}`,
    ].filter(Boolean).join(' · ');

    function selectOff() {
        // Preserve the last valid interval so re-enabling restores it; fall back to a default.
        const keep = intervalMinutes != null && isValidMinutes(intervalMinutes)
            ? intervalMinutes
            : DEFAULT_INTERVAL_MINUTES;
        onChange({ enabled: false, intervalMinutes: keep });
        setOpen(false);
    }

    function selectPreset(min: number) {
        onChange({ enabled: true, intervalMinutes: min });
        setOpen(false);
    }

    function applyCustom() {
        const hours = Number(customText.trim());
        const intervalMinutes = hours * 60;
        if (customText.trim() === '' || !Number.isInteger(hours) || !isValidMinutes(intervalMinutes)) {
            // Reject invalid input with a visible affordance; do not persist.
            setCustomError(true);
            return;
        }
        onChange({ enabled: true, intervalMinutes });
        setCustomError(false);
        setOpen(false);
    }

    return (
        <div className="relative inline-flex" ref={rootRef} data-testid="git-autopull-control">
            <button
                type="button"
                className={`inline-flex items-center gap-1 rounded-md border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] hover:bg-[#f3f3f3] dark:hover:bg-[#3c3c3c] transition-colors disabled:opacity-50 ${enabled ? 'text-[#16825d]' : 'text-[#616161] dark:text-[#999]'} ${compact ? 'h-[18px] px-1 text-[10px] leading-[16px]' : 'h-6 px-1.5 text-[11px] leading-[22px]'}`}
                onClick={toggleOpen}
                title={title}
                data-testid="git-autopull-toggle"
                aria-label="Auto-pull interval"
                aria-expanded={open}
            >
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8z" />
                    <path d="M8 3.75a.75.75 0 01.75.75v3.19l1.97 1.14a.75.75 0 11-.75 1.3L7.6 8.9A.75.75 0 017.25 8.25V4.5A.75.75 0 018 3.75z" />
                </svg>
                <span data-testid="git-autopull-current" className="tabular-nums">{label}</span>
                {enabled && nextRunLabel && (
                    <span
                        data-testid="git-autopull-next-run"
                        className="tabular-nums text-[#999] dark:text-[#777]"
                    >
                        {nextRunLabel}
                    </span>
                )}
                <span aria-hidden="true">▾</span>
            </button>

            {open && (
                <div
                    className="absolute right-0 top-full mt-1 z-30 min-w-[140px] bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#d0d0d0] dark:border-[#555] rounded shadow-md py-1"
                    data-testid="git-autopull-dropdown"
                >
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#999] dark:text-[#777]">
                        Auto-pull
                    </div>
                    <button
                        type="button"
                        className={`flex w-full items-center justify-between gap-2 px-3 py-1 text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors ${!enabled ? 'font-semibold text-[#16825d]' : 'text-[#1e1e1e] dark:text-[#ccc]'}`}
                        onClick={selectOff}
                        data-testid="git-autopull-option-off"
                    >
                        <span>Off</span>
                        {!enabled && <span aria-hidden="true">✓</span>}
                    </button>
                    {AUTO_PULL_PRESETS.map(presetMinutes => {
                        const selected = isPreset && intervalMinutes === presetMinutes;
                        return (
                            <button
                                key={presetMinutes}
                                type="button"
                                className={`flex w-full items-center justify-between gap-2 px-3 py-1 text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors ${selected ? 'font-semibold text-[#16825d]' : 'text-[#1e1e1e] dark:text-[#ccc]'}`}
                                onClick={() => selectPreset(presetMinutes)}
                                data-testid={`git-autopull-option-${presetMinutes}`}
                            >
                                <span>{formatInterval(presetMinutes)}</span>
                                {selected && <span aria-hidden="true">✓</span>}
                            </button>
                        );
                    })}
                    <div className="mt-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-3 pb-1 pt-1">
                        <label className="mb-1 block text-[10px] text-[#999] dark:text-[#777]" htmlFor="git-autopull-custom-input">
                            Custom (hours)
                        </label>
                        <div className="flex items-center gap-1">
                            <input
                                id="git-autopull-custom-input"
                                type="number"
                                min={1}
                                max={AUTO_PULL_MAX_CUSTOM_HOURS}
                                step={1}
                                value={customText}
                                onChange={e => { setCustomText(e.target.value); if (customError) setCustomError(false); }}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyCustom(); } }}
                                className={`w-16 rounded border bg-white px-1 py-0.5 text-xs text-[#1e1e1e] dark:bg-[#1e1e1e] dark:text-[#ccc] ${customError ? 'border-[#d32f2f]' : 'border-[#d0d0d0] dark:border-[#3c3c3c]'}`}
                                data-testid="git-autopull-custom-input"
                                aria-label="Custom auto-pull hours"
                                aria-invalid={customError}
                            />
                            <button
                                type="button"
                                className="rounded bg-[#0078d4] px-2 py-0.5 text-xs text-white transition-colors hover:bg-[#106ebe]"
                                onClick={applyCustom}
                                data-testid="git-autopull-custom-apply"
                            >
                                Set
                            </button>
                        </div>
                        {customError && (
                            <div className="mt-1 text-[10px] text-[#d32f2f]" data-testid="git-autopull-custom-error">
                                Enter a whole number 1–{AUTO_PULL_MAX_CUSTOM_HOURS}.
                            </div>
                        )}
                    </div>

                    {/* Read-only view of the server's schedule and last result. */}
                    {(nextRunLabel || lastRunLabel) && (
                        <div
                            className="mt-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-3 pb-1 pt-1 text-[10px] text-[#999] dark:text-[#777]"
                            data-testid="git-autopull-status"
                        >
                            {nextRunLabel && (
                                <div data-testid="git-autopull-status-next">Next run {nextRunLabel}</div>
                            )}
                            {lastRunLabel && (
                                <div data-testid="git-autopull-status-last" title={lastRunDetail}>
                                    Last run: {lastRunLabel}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
