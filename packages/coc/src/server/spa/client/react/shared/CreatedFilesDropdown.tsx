import React, { useState } from 'react';
import { FilePathLink } from './FilePathLink';
import type { CreatedFileRecord } from '../utils/conversationScan';

interface CreatedFilesDropdownProps {
    files: CreatedFileRecord[];
}

export function CreatedFilesDropdown({ files }: CreatedFilesDropdownProps) {
    const [open, setOpen] = useState(false);
    const latest = files.at(-1)!;
    return (
        <div className="relative inline-flex items-center gap-1">
            <FilePathLink path={latest.filePath} />
            <button
                className="text-xs text-[#848484] hover:text-[#0078d4]"
                onClick={() => setOpen(o => !o)}
            >
                +{files.length - 1} files ▾
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-[#252526]
                                border border-[#3c3c3c] rounded shadow-lg p-2
                                flex flex-col gap-1 min-w-[260px]">
                    {files.map((f, i) => (
                        <FilePathLink key={i} path={f.filePath} />
                    ))}
                </div>
            )}
        </div>
    );
}
