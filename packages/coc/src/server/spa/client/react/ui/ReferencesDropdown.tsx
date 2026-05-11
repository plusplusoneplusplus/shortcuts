import React, { useEffect, useRef, useState } from 'react';
import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';
import { BottomSheet } from './BottomSheet';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { cn } from './cn';

export interface ReferencesDropdownProps {
    planPath?: string;
    files?: { filePath: string }[];
    /** Workspace ID stamped on the mobile BottomSheet content so DOM traversal in file-path-preview.ts can resolve it. */
    wsId?: string;
}

/** Normalize a file path for dedup comparison: forward slashes, lowercased. */
export function normalizeRefPath(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * Return the subset of `files` that are not duplicates of `planPath` or each
 * other.  Comparison is case-insensitive with separator normalization.
 */
export function deduplicateReferenceFiles(
    planPath: string | undefined,
    files: { filePath: string }[] | undefined,
): { filePath: string }[] {
    const normPlan = planPath ? normalizeRefPath(planPath) : '';
    const seen = new Set<string>(normPlan ? [normPlan] : []);
    return (files ?? []).filter(f => {
        const n = normalizeRefPath(f.filePath);
        if (seen.has(n)) return false;
        seen.add(n);
        return true;
    });
}

/** Extract a short uppercase label from the file extension (e.g. "MD", "JSON"). */
function getRefIconLabel(filePath: string): string {
    const normalized = toForwardSlashes(filePath);
    const fileName = normalized.split('/').pop() ?? normalized;
    const dotIdx = fileName.lastIndexOf('.');
    if (dotIdx === -1 || dotIdx === fileName.length - 1) return 'FILE';
    return fileName.slice(dotIdx + 1).toUpperCase().slice(0, 4);
}

/** Return the file extension including the leading dot (e.g. ".md"). */
function getRefExt(filePath: string): string {
    const normalized = toForwardSlashes(filePath);
    const fileName = normalized.split('/').pop() ?? normalized;
    const dotIdx = fileName.lastIndexOf('.');
    return dotIdx === -1 ? '' : fileName.slice(dotIdx);
}

/**
 * Renders a single reference row as a card. The outer span carries
 * `.file-path-link` + `data-full-path` so the global hover-preview /
 * click-to-open delegation in `file-path-preview.ts` resolves the entire
 * row as a single link target.
 *
 * Tailwind `!`-prefixed utilities override the legacy `.file-path-link`
 * defaults (color/decoration/padding/hover-bg) so the card chrome wins.
 */
function ReferenceItem({ filePath, kind }: { filePath: string; kind: 'plan' | 'pinned' }) {
    const normalized = toForwardSlashes(filePath);
    const fileName = normalized.split('/').pop() ?? normalized;
    const iconLabel = getRefIconLabel(filePath);
    const ext = getRefExt(filePath);

    return (
        <span
            className={cn(
                'file-path-link',
                '!p-2 !rounded !no-underline',
                'grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-[9px] w-full',
                'hover:!bg-[#fafafa] dark:hover:!bg-[#2d2d2d]',
            )}
            data-full-path={normalized}
            title={normalized}
        >
            <span
                className={cn(
                    'inline-flex items-center justify-center w-[22px] h-[22px] rounded border',
                    'font-mono text-[10px] font-semibold',
                    kind === 'plan'
                        ? 'bg-[#ddf4ff] border-[#b3d7ff] text-[#0078d4] dark:bg-[rgba(56,139,253,0.15)] dark:border-[rgba(56,139,253,0.4)] dark:text-[#7bbef3]'
                        : 'bg-[#f5f5f4] border-[#e0e0e0] text-[#1e1e1e] dark:bg-[#2d2d2d] dark:border-[#3c3c3c] dark:text-[#cccccc]',
                )}
                aria-hidden="true"
            >
                {iconLabel}
            </span>
            <span className="min-w-0 flex flex-col">
                <span className="block text-xs font-semibold font-sans text-[#1e1e1e] dark:text-[#cccccc] truncate">
                    {fileName}
                </span>
                <span className="block mt-px text-[10.8px] font-mono text-[#6b7280] dark:text-[#9aa0a6] truncate">
                    {normalized}
                </span>
            </span>
            <span className="inline-flex items-center gap-1.5 justify-self-end font-mono text-[10.5px] text-[#6b7280] dark:text-[#9aa0a6]">
                <span
                    className={cn(
                        'inline-flex items-center px-1.5 py-px rounded-full font-medium text-[10px]',
                        kind === 'plan'
                            ? 'bg-[#ddf4ff] text-[#0078d4] dark:bg-[rgba(56,139,253,0.15)] dark:text-[#7bbef3]'
                            : 'bg-[#f5f5f4] text-[#6b7280] dark:bg-[#2d2d2d] dark:text-[#9aa0a6]',
                    )}
                >
                    {kind === 'plan' ? 'Plan' : 'Pinned'}
                </span>
                {ext}
            </span>
        </span>
    );
}

/**
 * Flat list of card-style reference rows. Exported so other surfaces
 * (e.g. ChatHeader's standalone mobile BottomSheet) can reuse the same
 * markup without bringing the dropdown chrome along.
 */
export function ReferenceList({ planPath, files }: { planPath?: string; files?: { filePath: string }[] }) {
    const uniqueFiles = deduplicateReferenceFiles(planPath, files);
    return (
        <>
            {planPath && <ReferenceItem filePath={planPath} kind="plan" />}
            {uniqueFiles.map((f, i) => (
                <ReferenceItem key={i} filePath={f.filePath} kind="pinned" />
            ))}
        </>
    );
}

/** Header + footer chrome shared by the desktop popover and mobile sheet. */
function ReferencesPanelChrome({
    planCount,
    pinnedCount,
    children,
    wsId,
    showHeader = true,
}: {
    planCount: number;
    pinnedCount: number;
    children: React.ReactNode;
    wsId?: string;
    showHeader?: boolean;
}) {
    const subtitle = planCount > 0 && pinnedCount > 0
        ? 'Plan plus pinned text files from created-file scan'
        : planCount > 0
            ? 'Plan file from this conversation'
            : 'Pinned text files from created-file scan';
    const pillLabel = planCount > 0 && pinnedCount > 0
        ? `${planCount} plan · ${pinnedCount} pinned`
        : planCount > 0
            ? `${planCount} plan`
            : `${pinnedCount} pinned`;
    return (
        <div className="flex flex-col" {...(wsId ? { 'data-ws-id': wsId } : {})}>
            {showHeader && (
                <div className="flex items-start justify-between gap-3 px-3 py-2.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#1e1e1e]">
                    <div className="min-w-0">
                        <h2 className="m-0 text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">References</h2>
                        <div className="mt-0.5 text-[11.5px] text-[#6b7280] dark:text-[#9aa0a6]">{subtitle}</div>
                    </div>
                    <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-[#ddf4ff] dark:bg-[rgba(56,139,253,0.15)] text-[#0078d4] dark:text-[#7bbef3] font-mono text-[10.5px]">
                        {pillLabel}
                    </span>
                </div>
            )}
            <div className="flex flex-col p-1">
                {children}
            </div>
            <div className="flex items-center justify-between gap-2.5 px-3 py-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#1e1e1e] text-[11.5px] text-[#6b7280] dark:text-[#9aa0a6]">
                <span>From planPath + .md/.txt/.yaml/.yml/.json writes</span>
                <span className="text-[#2c2f33] dark:text-[#cccccc]">Scratchpad .md files are excluded</span>
            </div>
        </div>
    );
}

export function ReferencesDropdown({ planPath, files, wsId }: ReferencesDropdownProps) {
    const uniqueFiles = deduplicateReferenceFiles(planPath, files);
    const planCount = planPath ? 1 : 0;
    const pinnedCount = uniqueFiles.length;
    const total = planCount + pinnedCount;
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const { isMobile } = useBreakpoint();

    useEffect(() => {
        if (!open || isMobile) return;
        function handleOutsideInteraction(e: MouseEvent | TouchEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleOutsideInteraction);
        document.addEventListener('touchstart', handleOutsideInteraction);
        return () => {
            document.removeEventListener('mousedown', handleOutsideInteraction);
            document.removeEventListener('touchstart', handleOutsideInteraction);
        };
    }, [open, isMobile]);

    // Auto-close when a reference is opened (consistent with ChatHeader's
    // standalone mobile sheet behavior).
    useEffect(() => {
        if (!open) return;
        const handler = () => setOpen(false);
        window.addEventListener('coc-open-markdown-review', handler);
        return () => window.removeEventListener('coc-open-markdown-review', handler);
    }, [open]);

    if (total === 0) return null;

    const button = (
        <button
            className={cn(
                'inline-flex items-center gap-1 px-2 py-[3px] rounded',
                'text-xs font-mono text-[#0078d4] dark:text-[#3794ff]',
                'border border-transparent transition-colors',
                'hover:bg-[#ddf4ff] hover:border-[#b3d7ff]',
                'dark:hover:bg-[rgba(56,139,253,0.15)] dark:hover:border-[rgba(56,139,253,0.4)]',
                open && 'bg-[#ddf4ff] border-[#b3d7ff] dark:bg-[rgba(56,139,253,0.15)] dark:border-[rgba(56,139,253,0.4)]',
            )}
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-haspopup="dialog"
            data-testid="references-dropdown-btn"
        >
            <span>References</span>
            <span
                className={cn(
                    'inline-flex items-center justify-center min-w-[17px] h-[17px] px-1.5 rounded-full',
                    'bg-white dark:bg-[#252526]',
                    'border border-[#b3d7ff] dark:border-[rgba(56,139,253,0.4)]',
                    'text-[10.5px] font-mono text-[#0078d4] dark:text-[#3794ff]',
                )}
            >
                {total}
            </span>
            <span className="text-[9px] opacity-70">▾</span>
        </button>
    );

    if (isMobile) {
        return (
            <>
                {button}
                <BottomSheet
                    isOpen={open}
                    onClose={() => setOpen(false)}
                    title={`References (${total})`}
                >
                    <ReferencesPanelChrome
                        planCount={planCount}
                        pinnedCount={pinnedCount}
                        wsId={wsId}
                        showHeader={false}
                    >
                        <ReferenceList planPath={planPath} files={files} />
                    </ReferencesPanelChrome>
                </BottomSheet>
            </>
        );
    }

    return (
        <div ref={containerRef} className="relative inline-flex items-center">
            {button}
            {open && (
                <div
                    role="dialog"
                    aria-label="References"
                    className={cn(
                        'absolute top-full right-0 mt-[7px] z-50 overflow-hidden',
                        'w-[calc(100vw-24px)] sm:w-[520px] sm:max-w-[520px]',
                        'bg-white dark:bg-[#252526]',
                        'border border-[#e0e0e0] dark:border-[#3c3c3c] rounded-md',
                        'shadow-[0_8px_24px_rgba(31,35,40,0.14)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)]',
                        'text-xs text-[#1e1e1e] dark:text-[#cccccc]',
                    )}
                >
                    <ReferencesPanelChrome
                        planCount={planCount}
                        pinnedCount={pinnedCount}
                        wsId={wsId}
                    >
                        <ReferenceList planPath={planPath} files={files} />
                    </ReferencesPanelChrome>
                </div>
            )}
        </div>
    );
}
