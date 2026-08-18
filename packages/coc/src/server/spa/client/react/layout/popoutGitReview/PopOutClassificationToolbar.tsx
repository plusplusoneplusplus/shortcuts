/**
 * Classification toolbar + filter bar shared by the commit and PR pop-out
 * reviews.
 *
 * Classification guides where a reviewer spends attention, so the two review
 * types must offer the exact same controls, disabled states, labels, and error
 * placement. `testIdPrefix` is the only thing that differs
 * (`commit-popout` / `pr-popout`).
 */

import { ClassifyDiffAiControls } from '../../features/git/diff/ClassifyDiffAiControls';
import { HUNK_CATEGORIES, CATEGORY_LABELS } from '../../features/pull-requests/classification-types';
import type { HunkCategory } from '../../features/pull-requests/classification-types';
import type { UseClassificationReturn } from '../../features/git/diff/useClassification';
import type { UseModalJobAiSelectionResult } from '../../shared/ModalJobAiControls';

export interface PopOutClassificationToolbarProps {
    /** `commit-popout` or `pr-popout`. */
    testIdPrefix: string;
    classification: UseClassificationReturn;
    aiSelection: UseModalJobAiSelectionResult;
    chatOpen: boolean;
    onToggleChat: () => void;
}

const CLASSIFY_BUTTON_LOADING_CLASS =
    'inline-flex h-6 items-center gap-1 rounded border border-gray-300 bg-gray-100 px-2 text-[11px] font-medium text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-500 cursor-wait';
const CLASSIFY_BUTTON_CLASS =
    'inline-flex h-6 items-center gap-1 rounded border border-indigo-400 bg-indigo-50 px-2 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-200 dark:hover:bg-indigo-900/50';

export function PopOutClassificationToolbar({
    testIdPrefix,
    classification,
    aiSelection,
    chatOpen,
    onToggleChat,
}: PopOutClassificationToolbarProps) {
    const classifyStatus = classification.state.status;

    return (
        <>
            <div
                className="flex items-center gap-2 px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#2a2a2a]"
                data-testid={`${testIdPrefix}-classify-bar`}
            >
                <ClassifyDiffAiControls
                    selection={aiSelection}
                    disabled={classifyStatus === 'loading'}
                    testIdPrefix={`${testIdPrefix}-classify`}
                />
                <button
                    type="button"
                    onClick={classification.classify}
                    disabled={classifyStatus === 'loading'}
                    className={classifyStatus === 'loading' ? CLASSIFY_BUTTON_LOADING_CLASS : CLASSIFY_BUTTON_CLASS}
                    data-testid={`${testIdPrefix}-classify-button`}
                >
                    {classifyStatus === 'loading' ? (
                        <>
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Classifying…
                        </>
                    ) : classifyStatus === 'ready' ? 'Re-classify' : 'Classify'}
                </button>
                <button
                    type="button"
                    onClick={onToggleChat}
                    className={`inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] font-medium ${
                        chatOpen
                            ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-200'
                            : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                    data-testid={`${testIdPrefix}-chat-toggle`}
                >
                    💬 Chat
                </button>
                {classification.state.error && (
                    <span className="text-[10px] text-red-600 dark:text-red-400">
                        {classification.state.error}
                    </span>
                )}
            </div>
            {/* Classification filter bar — visible when results are ready */}
            {classifyStatus === 'ready' && (
                <div
                    className="flex items-center gap-3 px-3 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#262626]"
                    data-testid={`${testIdPrefix}-filter-bar`}
                >
                    <span className="text-[10px] text-[#616161] dark:text-[#999] font-medium">Filter:</span>
                    {HUNK_CATEGORIES.map(cat => {
                        const active = classification.state.activeFilters.has(cat);
                        return (
                            <label
                                key={cat}
                                className="flex items-center gap-1 text-[11px] cursor-pointer select-none"
                                data-testid={`${testIdPrefix}-filter-${cat}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={active}
                                    onChange={() => classification.toggleFilter(cat as HunkCategory)}
                                    className="h-3 w-3 rounded"
                                />
                                <span className={active ? 'text-[#1e1e1e] dark:text-[#ccc]' : 'text-[#848484]'}>
                                    {CATEGORY_LABELS[cat]}
                                </span>
                            </label>
                        );
                    })}
                </div>
            )}
        </>
    );
}
