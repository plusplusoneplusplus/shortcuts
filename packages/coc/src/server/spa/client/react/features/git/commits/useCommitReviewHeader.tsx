import { useEffect, useId, useState } from 'react';
import { copyToClipboard } from '../../../utils/format';
import { ClassifySplitButton } from '../diff/ClassifySplitButton';
import { ClassificationFilterBar } from '../diff/ClassificationFilterBar';
import type { GitReviewHeader, GitReviewToolbarAction } from '../diff/GitReviewToolbar';
import type { UseClassificationReturn } from '../diff/useClassification';
import type { UseModalJobAiSelectionResult } from '../../../shared/ModalJobAiControls';
import { CommitInfoHeader, CommitInfoSummary } from './CommitInfoHeader';
import type { GitCommitItem } from './commitListTypes';

/**
 * Commit identity, Classify split button and below-toolbar details shared by
 * the inline and pop-out commit reviews. Disclosure and copy feedback reset
 * whenever `resetKey` (owner + workspace + commit) changes.
 */
export function useCommitReviewHeader({ commit, fileCount, classification, aiSelection, classificationEnabled = true, testIdPrefix, actions, resetKey }: {
    commit?: GitCommitItem | null;
    fileCount: number;
    classification: UseClassificationReturn;
    aiSelection: UseModalJobAiSelectionResult;
    classificationEnabled?: boolean;
    testIdPrefix: string;
    actions: GitReviewToolbarAction[];
    resetKey: string;
}): GitReviewHeader {
    const [collapsed, setCollapsed] = useState(true);
    const [copied, setCopied] = useState(false);
    const headerId = useId();
    useEffect(() => { setCollapsed(true); setCopied(false); }, [resetKey]);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);
    const info = commit ? {
        commit, headerCollapsed: collapsed, headerId, hashCopied: copied,
        onToggle: () => setCollapsed(value => !value),
        onCopy: () => { void copyToClipboard(commit.hash).then(() => setCopied(true)); },
    } : null;
    return {
        identity: info && <CommitInfoSummary {...info} />,
        classify: classificationEnabled && <ClassifySplitButton classification={classification} aiSelection={aiSelection} testIdPrefix={testIdPrefix} />,
        actions,
        below: <>
            {info && <CommitInfoHeader {...info} fileCount={fileCount} />}
            {classificationEnabled && classification.state.error && (
                <div role="alert" className="border-b border-[#e0e0e0] dark:border-[#3c3c3c] px-4 py-2 text-[11px] text-red-600 dark:text-red-400">
                    {classification.state.error}
                </div>
            )}
            {classificationEnabled && <ClassificationFilterBar classification={classification} testIdPrefix={testIdPrefix} />}
        </>,
    };
}
