/**
 * CopyButton — the small "Copy" affordance every Dev Tools card puts next to a
 * readout.
 *
 * `copyToClipboard` can throw *synchronously* when neither the async clipboard
 * API nor `document.execCommand` exists (jsdom, and browsers with the
 * permission denied), so the try/catch has to wrap the call itself rather than
 * only the returned promise. A clipboard-less environment must never break the
 * card — the readout stays selectable either way.
 */

import { useState } from 'react';
import { copyToClipboard } from '../../utils/format';

export interface CopyButtonProps {
    text: string;
    label: string;
    testId: string;
}

export function CopyButton({ text, label, testId }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);
    const onClick = () => {
        try {
            void copyToClipboard(text).catch(() => undefined);
        } catch {
            /* ignore */
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    };
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            data-testid={testId}
            className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] border border-[#e0e0e0] dark:border-[#3c3c3c] text-[#656d76] dark:text-[#999] hover:text-[#0078d4] hover:border-[#0078d4]"
        >
            {copied ? 'Copied' : 'Copy'}
        </button>
    );
}
