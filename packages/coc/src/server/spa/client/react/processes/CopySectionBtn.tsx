/**
 * CopySectionBtn — small copy button shown on hover next to H2/H3 headings.
 * Copies the section's raw markdown to clipboard with a transient ✓ state.
 */

import React, { useState, useCallback } from 'react';
import { copyToClipboard } from '../utils/format';

interface CopySectionBtnProps {
    /** Raw markdown text for this section (heading + body). */
    sectionMarkdown: string;
}

export function CopySectionBtn({ sectionMarkdown }: CopySectionBtnProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await copyToClipboard(sectionMarkdown);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            console.error('Section copy failed:', err);
        }
    }, [sectionMarkdown]);

    return (
        <button
            className="section-copy-btn text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] opacity-0 group-hover/section:opacity-100 transition-opacity text-[10px]"
            title="Copy to clipboard"
            onClick={handleCopy}
            data-testid="section-copy-btn"
            style={{
                position: 'absolute',
                right: '0',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 4px',
                lineHeight: 1,
            }}
        >
            {copied ? '✓' : '📋'}
        </button>
    );
}
