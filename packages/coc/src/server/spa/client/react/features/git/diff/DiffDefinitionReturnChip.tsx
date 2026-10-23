/**
 * DiffDefinitionReturnChip — "← Back to <ref> · <file>" above an Explorer file
 * tab that a diff's go to definition opened. Renders nothing for other tabs.
 */

import { useEffect } from 'react';
import { clearDiffDefinitionReturn, returnToDiffDefinitionOrigin, useDiffDefinitionReturn } from './diffDefinitionReturn';

export interface DiffDefinitionReturnChipProps {
    scopeWorkspaceId: string;
    tabId: string;
}

export function DiffDefinitionReturnChip({ scopeWorkspaceId, tabId }: DiffDefinitionReturnChipProps) {
    const entry = useDiffDefinitionReturn(scopeWorkspaceId, tabId);
    // Closing the tab forgets its way back.
    useEffect(() => () => clearDiffDefinitionReturn(scopeWorkspaceId, tabId), [scopeWorkspaceId, tabId]);
    if (!entry) return null;
    return (
        <div className="flex flex-shrink-0 items-center px-2 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
            <button
                type="button"
                onClick={() => returnToDiffDefinitionOrigin(scopeWorkspaceId, tabId)}
                className="max-w-full truncate rounded border border-[#0078d4]/40 px-1.5 text-[10px] text-[#0078d4] dark:text-[#3794ff] hover:bg-[#0078d4]/10"
                title="Back to the diff where go to definition started (Alt+←)"
                data-testid="diff-definition-return-chip"
            >
                ← Back to {entry.label}
            </button>
        </div>
    );
}
