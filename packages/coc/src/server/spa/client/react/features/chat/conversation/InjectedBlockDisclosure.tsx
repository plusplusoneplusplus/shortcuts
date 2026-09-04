import React, { useState } from 'react';
import { cn } from '../../../ui/cn';

export interface InjectedBlockDisclosureProps {
    block: string;
    label: string;
    testIdPrefix: 'chat-mode-block' | 'chat-style-block';
}

/** Displays one server-injected user-message prefix as a local disclosure. */
export function InjectedBlockDisclosure({ block, label, testIdPrefix }: InjectedBlockDisclosureProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="mt-1.5" data-testid={`${testIdPrefix}-disclosure`}>
            <button
                type="button"
                className={cn(
                    'inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer',
                    'text-[12px] text-[#6b7280] dark:text-[#9aa0a6] hover:text-[#1f2328] dark:hover:text-[#cccccc]',
                )}
                data-testid={`${testIdPrefix}-toggle`}
                aria-expanded={expanded}
                onClick={() => setExpanded(value => !value)}
            >
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                <span>{expanded ? `Hide ${label.toLowerCase()}` : label}</span>
            </button>
            {expanded && (
                <pre
                    className={cn(
                        'mt-1.5 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]',
                        'bg-[#ffffff] dark:bg-[#1e1e1e] px-3 py-2 overflow-auto max-h-[360px]',
                        'text-[#1e1e1e] dark:text-[#cccccc]',
                        'text-[12px] leading-[1.5] whitespace-pre-wrap break-all font-mono',
                    )}
                    data-testid={`${testIdPrefix}-body`}
                >
                    {block}
                </pre>
            )}
        </div>
    );
}
