import React, { useEffect, useRef, useState } from 'react';
import { FilePathLink } from './FilePathLink';
import { BottomSheet } from './BottomSheet';
import { useBreakpoint } from '../hooks/useBreakpoint';

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

function PlanFileIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0" aria-hidden="true">
            <path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.2" fill="none"/>
        </svg>
    );
}

export function ReferenceList({ planPath, files }: { planPath?: string; files?: { filePath: string }[] }) {
    const uniqueFiles = deduplicateReferenceFiles(planPath, files);
    return (
        <>
            {planPath && (
                <span className="inline-flex items-center gap-1 hover:bg-[#f3f3f3] dark:hover:bg-[#2d2d2d] rounded px-1">
                    <PlanFileIcon />
                    <FilePathLink path={planPath} noTruncate className="text-xs font-sans" />
                </span>
            )}
            {uniqueFiles.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 hover:bg-[#f3f3f3] dark:hover:bg-[#2d2d2d] rounded px-1">
                    <FilePathLink path={f.filePath} noTruncate className="text-xs font-sans" />
                </span>
            ))}
        </>
    );
}

export function ReferencesDropdown({ planPath, files, wsId }: ReferencesDropdownProps) {
    const uniqueFiles = deduplicateReferenceFiles(planPath, files);
    const total = (planPath ? 1 : 0) + uniqueFiles.length;
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

    if (total === 0) return null;

    if (isMobile) {
        return (
            <>
                <button
                    className="text-xs text-[#848484] hover:text-[#0078d4]"
                    onClick={() => setOpen(o => !o)}
                    data-testid="references-dropdown-btn"
                >
                    References ({total}) ▾
                </button>
                <BottomSheet
                    isOpen={open}
                    onClose={() => setOpen(false)}
                    title={`References (${total})`}
                >
                    <div className="flex flex-col gap-1 p-2" {...(wsId ? { 'data-ws-id': wsId } : {})}>
                        <ReferenceList planPath={planPath} files={files} />
                    </div>
                </BottomSheet>
            </>
        );
    }

    return (
        <div ref={containerRef} className="relative inline-flex items-center">
            <button
                className="text-xs text-[#848484] hover:text-[#0078d4]"
                onClick={() => setOpen(o => !o)}
                data-testid="references-dropdown-btn"
            >
                References ({total}) ▾
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] rounded shadow-lg p-2 w-[calc(100vw-32px)] sm:min-w-[420px] sm:w-auto sm:max-w-[800px] max-h-[300px] overflow-y-auto z-50 flex flex-col gap-1">
                    <ReferenceList planPath={planPath} files={files} />
                </div>
            )}
        </div>
    );
}
