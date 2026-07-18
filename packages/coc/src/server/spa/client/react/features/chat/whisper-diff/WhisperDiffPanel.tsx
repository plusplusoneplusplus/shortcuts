/**
 * WhisperDiffPanel — inner chrome for the converged read-only whisper diff
 * panel (AC-01/02/03).
 *
 * One panel, one docked slot. The body is a filterable whole-group view driven
 * by a header dropdown selector:
 *
 *  - `All files` (the default): every reconstructable file's diff stacked under
 *    a filename divider, followed by the trailing "Not shown" list of the
 *    group's deleted / non-reconstructable files. The subtitle shows the
 *    `N files (+X −Y)` totals.
 *  - a single file: only that file's diff (one `UnifiedDiffViewer`). The subtitle
 *    shows the file's project-relative path.
 *
 * The dropdown lists `All files` plus every file in group order, each with its
 * basename + green/red +/- stats. Deleted / non-reconstructable files are listed
 * but disabled (they have no reconstructable diff and only appear under the
 * All-files "Not shown" list). Selection lives inside the panel (React state),
 * initialized from the entry point (`focusPath` → a file, or All files) and
 * reset when a new group's context replaces the current one.
 *
 * This is a read-only surface: no copy/reveal/comments/Ask-AI, no save, and no
 * canvas record is ever written. The dropdown is a navigation control only.
 * Layout (docked column vs mobile BottomSheet) and resizing are owned by the
 * host (`WhisperDiffDock`); this is inner chrome.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../ui';
import { UnifiedDiffViewer } from '../../git/diff/UnifiedDiffViewer';
import { getSourceCanvasDisplayPath } from '../source-canvas/resolve';
import type { CombinedWhisperDiffSection } from '../conversation/tool-calls/buildWhisperCombinedDiff';
import type { FileEdit } from '../conversation/tool-calls/toolGroupUtils';
import type { CombinedWhisperDiffView, WhisperDiffState } from './useWhisperDiffState';

/** Sentinel selection value for the stacked "All files" view. */
const ALL_FILES = '__all_files__';

function basename(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    return normalized.split('/').pop() || p;
}

/** "N files (+X −Y)" — mirrors the popover footer's totals formatting. */
function combinedTotalsLabel(view: CombinedWhisperDiffView): string {
    const { fileCount, totalInsertions, totalDeletions } = view;
    const parts: string[] = [];
    if (totalInsertions > 0) parts.push(`+${totalInsertions}`);
    if (totalDeletions > 0) parts.push(`−${totalDeletions}`);
    const totals = parts.length ? ` (${parts.join(' ')})` : '';
    return `${fileCount} file${fileCount !== 1 ? 's' : ''}${totals}`;
}

const headerBtnClass =
    'shrink-0 flex items-center justify-center w-7 h-7 rounded text-[#848484] ' +
    'hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]';

export interface WhisperDiffPanelProps {
    /** Renderable diff state from `useWhisperDiffState` (whole-group view + files). */
    state: WhisperDiffState;
    /** Current workspace root, used to show a project-relative path in the header. */
    workspaceRootPath?: string | null;
    /** Close the panel (X button). */
    onClose: () => void;
}

/** One entry in the header file-selector dropdown. */
interface FileSelectOption {
    /** `ALL_FILES` sentinel or a file path. */
    value: string;
    /** "All files" or the file's basename. */
    label: string;
    insertions: number;
    deletions: number;
    /** Deleted / non-reconstructable files are listed but not selectable. */
    disabled: boolean;
    /** True for the `All files` entry (no per-file stats shown). */
    isAll: boolean;
}

export function WhisperDiffPanel({
    state,
    workspaceRootPath,
    onClose,
}: WhisperDiffPanelProps) {
    const { view, files, focusPath } = state;

    // Reconstructable sections keyed by path — the selectable set, and the source
    // for the single-file body.
    const sectionByPath = useMemo(() => {
        const m = new Map<string, CombinedWhisperDiffSection>();
        for (const s of view.sections) m.set(s.file.path, s);
        return m;
    }, [view]);

    // Dropdown items: `All files` + every file in group order. A file is
    // selectable only when it has a reconstructable section; deleted / Codex-style
    // non-reconstructable files are listed but disabled.
    const options = useMemo<FileSelectOption[]>(() => {
        const opts: FileSelectOption[] = [
            { value: ALL_FILES, label: 'All files', insertions: 0, deletions: 0, disabled: false, isAll: true },
        ];
        for (const f of files) {
            opts.push({
                value: f.path,
                label: basename(f.path),
                insertions: f.netInsertions ?? f.insertions,
                deletions: f.netDeletions ?? f.deletions,
                disabled: !sectionByPath.has(f.path),
                isAll: false,
            });
        }
        return opts;
    }, [files, sectionByPath]);

    // Selection lives in the panel. Initialized from the entry point: a focused
    // file when it is reconstructable, otherwise All files (a focus on a
    // non-reconstructable/deleted file falls back to the stack, where it appears
    // under "Not shown").
    const initialSelection =
        focusPath && sectionByPath.has(focusPath) ? focusPath : ALL_FILES;
    const [selected, setSelected] = useState<string>(initialSelection);

    // Reset the selection whenever a new group's context replaces the current one.
    // `state` has a stable identity per open (useWhisperDiffState memoizes on the
    // held context), so this fires exactly once per open — footer, file row, or a
    // fresh group — and never on unrelated re-renders.
    useEffect(() => {
        setSelected(focusPath && sectionByPath.has(focusPath) ? focusPath : ALL_FILES);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    const showingAll = selected === ALL_FILES;
    const selectedSection = showingAll ? null : sectionByPath.get(selected) ?? null;

    // Subtitle: group totals for All files, else the selected file's project path.
    let subtitle: string;
    let subtitleTitle: string | undefined;
    let subtitleTestId: string;
    if (showingAll || !selectedSection) {
        subtitle = combinedTotalsLabel(view);
        subtitleTitle = undefined;
        subtitleTestId = 'whisper-diff-totals';
    } else {
        const fullPath = selectedSection.file.path;
        subtitle = getSourceCanvasDisplayPath(fullPath, workspaceRootPath);
        subtitleTitle = fullPath;
        subtitleTestId = 'whisper-diff-path';
    }

    return (
        <div
            className="flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e]"
            data-testid="whisper-diff-panel"
        >
            <div
                className="px-3 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] flex items-center justify-between gap-2"
                data-testid="whisper-diff-header"
            >
                <div
                    className="min-w-0 flex items-center gap-2"
                    data-testid="whisper-diff-header-main"
                >
                    <WhisperFileSelect
                        options={options}
                        selected={selected}
                        onSelect={setSelected}
                    />
                    <div
                        className="text-xs text-[#848484] truncate"
                        title={subtitleTitle}
                        data-testid={subtitleTestId}
                    >
                        {subtitle}
                    </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        type="button"
                        data-testid="whisper-diff-close-btn"
                        onClick={onClose}
                        className={headerBtnClass}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto" data-testid="whisper-diff-body">
                {showingAll || !selectedSection ? (
                    <AllFilesBody view={view} error={state.error} workspaceRootPath={workspaceRootPath} />
                ) : (
                    <div className="p-2">
                        <UnifiedDiffViewer
                            diff={selectedSection.diff}
                            fileName={basename(selectedSection.file.path)}
                            showLineNumbers
                            hideFileHeaders
                            data-testid="whisper-diff-viewer"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * WhisperFileSelect — a lightweight accessible single-select menu for the header
 * (no app-wide single-select primitive exists). Closes on outside click /
 * Escape; disabled entries (deleted / non-reconstructable) are not selectable.
 */
function WhisperFileSelect({
    options,
    selected,
    onSelect,
}: {
    options: FileSelectOption[];
    selected: string;
    onSelect: (value: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const current = options.find((o) => o.value === selected) ?? options[0];

    return (
        <div ref={ref} className="relative min-w-0">
            <button
                type="button"
                data-testid="whisper-diff-file-select"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
                className="flex items-center gap-1 max-w-full text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] hover:text-[#0078d4] dark:hover:text-[#3794ff]"
            >
                <span className="truncate" data-testid="whisper-diff-filename">
                    {current?.label ?? 'All files'}
                </span>
                <span className="shrink-0 text-[10px] text-[#848484]">{open ? '▴' : '▾'}</span>
            </button>
            {open && (
                <div
                    role="listbox"
                    aria-label="Select a file"
                    data-testid="whisper-diff-file-select-menu"
                    className="absolute left-0 top-full mt-1 z-50 max-h-[320px] overflow-auto min-w-[240px] max-w-[420px] rounded border border-[#e0e0e0] dark:border-[#474749] bg-white dark:bg-[#252526] shadow-lg py-1"
                >
                    {options.map((opt) => {
                        const isSelected = opt.value === selected;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                aria-disabled={opt.disabled || undefined}
                                disabled={opt.disabled}
                                data-testid="whisper-diff-file-option"
                                data-value={opt.value}
                                data-path={opt.isAll ? undefined : opt.value}
                                data-disabled={opt.disabled ? 'true' : 'false'}
                                onClick={() => {
                                    if (opt.disabled) return;
                                    onSelect(opt.value);
                                    setOpen(false);
                                }}
                                className={cn(
                                    'flex items-center gap-2 w-full text-left px-2.5 py-1 text-xs',
                                    opt.disabled
                                        ? 'opacity-50 cursor-not-allowed'
                                        : 'cursor-pointer hover:bg-[#e1effe] dark:hover:bg-[#1f2d42]',
                                    isSelected && !opt.disabled && 'bg-[#e8f0fe] dark:bg-[#1f2d42]',
                                )}
                            >
                                <span
                                    className={cn(
                                        'truncate min-w-0 flex-1',
                                        opt.isAll ? 'font-medium' : '',
                                        opt.disabled
                                            ? 'text-[#999] dark:text-[#666]'
                                            : 'text-[#1e1e1e] dark:text-[#ccc]',
                                    )}
                                >
                                    {opt.label}
                                </span>
                                {!opt.isAll && opt.insertions > 0 && (
                                    <span className="shrink-0 text-[#22863a] dark:text-[#85e89d]">+{opt.insertions}</span>
                                )}
                                {!opt.isAll && opt.deletions > 0 && (
                                    <span className="shrink-0 text-[#cb2431] dark:text-[#f97583]">−{opt.deletions}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function AllFilesBody({
    view,
    error,
    workspaceRootPath,
}: {
    view: CombinedWhisperDiffView;
    error: string;
    workspaceRootPath?: string | null;
}) {
    const notShown = [...view.deletedFiles, ...view.nonReconstructableFiles];
    const hasSections = view.sections.length > 0;
    return (
        <>
            {!hasSections ? (
                // Nothing in the group has a reconstructable diff — show the
                // no-diff message rather than a blank body.
                <div className="p-4 text-xs text-[#848484]" data-testid="whisper-diff-empty">
                    {error || 'No diff is available for these files.'}
                </div>
            ) : (
                view.sections.map((section) => {
                    const relPath = getSourceCanvasDisplayPath(section.file.path, workspaceRootPath);
                    return (
                        <div
                            key={section.file.path}
                            data-testid="whisper-diff-file-section"
                            data-path={section.file.path}
                        >
                            <div
                                className="sticky-0 px-3 py-1.5 text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#2a2a2b] border-b border-[#e0e0e0] dark:border-[#3c3c3c] truncate"
                                title={section.file.path}
                                data-testid="whisper-diff-file-divider"
                            >
                                {relPath}
                            </div>
                            <div className="p-2">
                                <UnifiedDiffViewer
                                    diff={section.diff}
                                    fileName={basename(relPath)}
                                    showLineNumbers
                                    hideFileHeaders
                                    data-testid="whisper-diff-section-viewer"
                                />
                            </div>
                        </div>
                    );
                })
            )}
            {notShown.length > 0 && (
                <div
                    className="px-3 py-2 text-xs text-[#848484] border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="whisper-diff-not-shown"
                >
                    <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1">
                        Not shown
                    </div>
                    {view.deletedFiles.map((f) => (
                        <div
                            key={f.path}
                            className="truncate"
                            title={f.path}
                            data-testid="whisper-diff-not-shown-item"
                            data-path={f.path}
                        >
                            {getSourceCanvasDisplayPath(f.path, workspaceRootPath)} — deleted
                        </div>
                    ))}
                    {view.nonReconstructableFiles.map((f) => (
                        <div
                            key={f.path}
                            className="truncate"
                            title={f.path}
                            data-testid="whisper-diff-not-shown-item"
                            data-path={f.path}
                        >
                            {getSourceCanvasDisplayPath(f.path, workspaceRootPath)} — no diff available
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}
