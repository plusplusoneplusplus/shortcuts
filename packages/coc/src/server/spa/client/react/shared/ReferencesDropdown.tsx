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
                <div className="absolute top-full left-0 mt-1 bg-[#252526] border border-[#3c3c3c] rounded shadow-lg p-2 min-w-[260px] z-50 flex flex-col gap-1">
                    {planPath && (
                        <span className="inline-flex items-center gap-1">
                            <span>📄</span>
                            <FilePathLink path={planPath} />
                        </span>
                    )}
                    {files?.map((f, i) => (
                        <FilePathLink key={i} path={f.filePath} />
                    ))}
                </div>
            )}
        </div>
    );
}
