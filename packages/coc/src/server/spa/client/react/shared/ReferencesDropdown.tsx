import React, { useEffect, useRef, useState } from 'react';
import { FilePathLink } from './FilePathLink';

export interface ReferencesDropdownProps {
    planPath?: string;
    files?: { filePath: string }[];
}

export function ReferencesDropdown({ planPath, files }: ReferencesDropdownProps) {
    const total = (planPath ? 1 : 0) + (files?.length ?? 0);
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function handleClickOutside(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    if (total === 0) return null;

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
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] rounded shadow-lg p-2 min-w-[300px] max-w-[600px] max-h-[300px] overflow-y-auto z-50 flex flex-col gap-1">
                    {planPath && (
                        <span className="inline-flex items-center gap-1 hover:bg-[#f3f3f3] dark:hover:bg-[#2d2d2d] rounded px-1">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0" aria-hidden="true">
                                <path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                                <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                            </svg>
                            <FilePathLink path={planPath} noTruncate className="text-xs font-sans" />
                        </span>
                    )}
                    {files?.map((f, i) => (
                        <span key={i} className="inline-flex items-center gap-1 hover:bg-[#f3f3f3] dark:hover:bg-[#2d2d2d] rounded px-1">
                            <FilePathLink path={f.filePath} noTruncate className="text-xs font-sans" />
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
