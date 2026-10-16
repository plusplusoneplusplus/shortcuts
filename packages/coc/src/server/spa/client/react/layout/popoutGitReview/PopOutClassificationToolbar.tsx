/**
 * Classification toolbar + filter bar for the PR pop-out review. Commit
 * reviews use the single-row `GitReviewToolbar` with the same filter bar.
 */

import { ClassifyDiffAiControls } from '../../features/git/diff/ClassifyDiffAiControls';
import { ClassificationFilterBar } from '../../features/git/diff/ClassificationFilterBar';
import type { UseClassificationReturn } from '../../features/git/diff/useClassification';
import type { UseModalJobAiSelectionResult } from '../../shared/ModalJobAiControls';

export interface PopOutClassificationToolbarProps {
    /** e.g. `pr-popout`. */
    testIdPrefix: string;
    classification: UseClassificationReturn;
    aiSelection: UseModalJobAiSelectionResult;
    chatOpen: boolean;
    onToggleChat: () => void;
    classificationEnabled?: boolean;
}

const CLASSIFY_BUTTON_LOADING_CLASS =
    'inline-flex h-6 shrink-0 whitespace-nowrap items-center gap-1 rounded border border-gray-300 bg-gray-100 px-2 text-[11px] font-medium text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-500 cursor-wait';
const CLASSIFY_BUTTON_CLASS =
    'inline-flex h-6 shrink-0 whitespace-nowrap items-center gap-1 rounded border border-indigo-400 bg-indigo-50 px-2 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-200 dark:hover:bg-indigo-900/50';

export function PopOutClassificationToolbar({
    testIdPrefix,
    classification,
    aiSelection,
    chatOpen,
    onToggleChat,
    classificationEnabled = true,
}: PopOutClassificationToolbarProps) {
    const classifyStatus = classification.state.status;

    return (
        <>
            {/* Outer div is the size container; the bar wraps whole groups, never a control's text. */}
            <div className="[container-type:inline-size] border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#2a2a2a]">
                <div
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5"
                    data-testid={`${testIdPrefix}-classify-bar`}
                >
                    {classificationEnabled && <div className="flex flex-nowrap items-center gap-2 min-w-0" data-testid={`${testIdPrefix}-classify-left`}>
                        <ClassifyDiffAiControls
                            selection={aiSelection}
                            disabled={classifyStatus === 'loading'}
                            testIdPrefix={`${testIdPrefix}-classify`}
                            collapseLabels
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
                    </div>}
                    <div className="flex flex-nowrap items-center gap-2 shrink-0" data-testid={`${testIdPrefix}-classify-right`}>
                        <button
                            type="button"
                            onClick={onToggleChat}
                            className={`inline-flex h-6 shrink-0 whitespace-nowrap items-center gap-1 rounded border px-2 text-[11px] font-medium ${
                                chatOpen
                                    ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-200'
                                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                            }`}
                            data-testid={`${testIdPrefix}-chat-toggle`}
                        >
                            💬 Chat
                        </button>
                        {classificationEnabled && classification.state.error && (
                            <span className="max-w-[240px] truncate text-[10px] text-red-600 dark:text-red-400" title={classification.state.error}>
                                {classification.state.error}
                            </span>
                        )}
                    </div>
                </div>
            </div>
            {classificationEnabled && <ClassificationFilterBar classification={classification} testIdPrefix={testIdPrefix} />}
        </>
    );
}
