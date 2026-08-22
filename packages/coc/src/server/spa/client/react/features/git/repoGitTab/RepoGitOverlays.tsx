/**
 * RepoGitOverlays — the Git tab's modals, toast and context menu.
 *
 * Everything here is portaled or fixed-positioned, so it is layout-agnostic and
 * renders identically in the standalone and split-workspace layouts. Keeping
 * them in one component means the split branch can't accidentally drop a modal
 * that the standalone branch renders.
 */

import { ContextMenu, type ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import { SkillBrowserDialog } from '../../../queue/SkillBrowserDialog';
import { SkillContextDialog } from '../../chat/SkillContextDialog';
import { BranchPickerModal } from '../branches/BranchPickerModal';
import { AmendMessageModal } from '../working-tree/AmendMessageModal';
import { CrossCloneCherryPickModal } from '../CrossCloneCherryPickModal';
import type { GitPatchApplyResponse } from '@plusplusoneplusplus/coc-client';
import type { ResolvedModalJobAiSelection } from '../../../shared/ModalJobAiControls';
import type { GitCommitItem } from '../commits/CommitList';
import type { GitContextMenuState } from './types';

export interface RepoGitOverlaysProps {
    workspaceId: string;
    branchName: string;

    // Context menu
    contextMenu: GitContextMenuState | null;
    contextMenuItems: ContextMenuItem[];
    onCloseContextMenu: () => void;

    // Toast
    toast: string | null;
    onDismissToast: () => void;

    // Skill dialogs
    skills: Array<{ name: string; description?: string }>;
    skillBrowserOpen: boolean;
    onSkillBrowserSelect: (skillName: string) => void;
    onCloseSkillBrowser: () => void;
    pendingSkillName: string | null;
    pendingSkillTargetSummary: string;
    onCancelSkillRun: () => void;
    onConfirmSkillRun: (userContext: string, aiSelection: ResolvedModalJobAiSelection) => Promise<void>;

    // Branch picker (switch branch)
    branchPickerOpen: boolean;
    onCloseBranchPicker: () => void;
    onBranchSwitched: (newBranch: string) => void;

    // Branch picker (cherry-pick target)
    cherryPickOpen: boolean;
    onCloseCherryPick: () => void;
    onCherryPickToBranch: (targetBranch: string) => Promise<void>;

    // Amend / reword
    amendingCommit: GitCommitItem | null;
    onAmendConfirm: (title: string, body: string) => void;
    onCancelAmend: () => void;
    rewordingCommit: GitCommitItem | null;
    onRewordConfirm: (title: string) => void;
    onCancelReword: () => void;

    // Cross-clone cherry-pick
    crossCloneCommits: GitCommitItem[];
    sourceWorkspace: any;
    onCloseCrossClone: () => void;
    onCrossCloneApplied: (response: GitPatchApplyResponse) => void;
}

export function RepoGitOverlays(props: RepoGitOverlaysProps) {
    const { workspaceId, branchName } = props;
    return (
        <>
            {props.contextMenu && props.contextMenuItems.length > 0 && (
                <ContextMenu
                    position={{ x: props.contextMenu.x, y: props.contextMenu.y }}
                    items={props.contextMenuItems}
                    onClose={props.onCloseContextMenu}
                />
            )}
            {props.toast && (
                <div
                    className="fixed bottom-4 right-4 z-[10010] px-4 py-2.5 rounded-md shadow-lg text-xs text-white bg-[#0078d4] dark:bg-[#1a6bbf] max-w-xs flex items-center gap-2"
                    data-testid="enqueue-toast"
                >
                    <span className="flex-1">{props.toast}</span>
                    <button
                        onClick={props.onDismissToast}
                        data-testid="enqueue-toast-close"
                        aria-label="Close notification"
                        className="ml-2 text-white/80 hover:text-white text-sm leading-none"
                    >
                        ×
                    </button>
                </div>
            )}
            <SkillBrowserDialog
                open={props.skillBrowserOpen}
                skills={props.skills}
                onSelect={props.onSkillBrowserSelect}
                onClose={props.onCloseSkillBrowser}
            />
            <SkillContextDialog
                open={!!props.pendingSkillName}
                workspaceId={workspaceId}
                skillName={props.pendingSkillName ?? ''}
                targetSummary={props.pendingSkillTargetSummary}
                onClose={props.onCancelSkillRun}
                onConfirm={props.onConfirmSkillRun}
            />
            <BranchPickerModal
                workspaceId={workspaceId}
                currentBranch={branchName || 'HEAD'}
                isOpen={props.branchPickerOpen}
                onClose={props.onCloseBranchPicker}
                onSwitched={props.onBranchSwitched}
            />
            <BranchPickerModal
                workspaceId={workspaceId}
                currentBranch={branchName || 'HEAD'}
                isOpen={props.cherryPickOpen}
                onClose={props.onCloseCherryPick}
                onSelected={props.onCherryPickToBranch}
                title="Cherry-pick to branch"
                busyLabel="Cherry-picking…"
                errorLabel="Cherry-pick failed"
            />
            {props.amendingCommit && (
                <AmendMessageModal
                    commit={props.amendingCommit}
                    onConfirm={props.onAmendConfirm}
                    onCancel={props.onCancelAmend}
                />
            )}
            {props.rewordingCommit && (
                <AmendMessageModal
                    commit={props.rewordingCommit}
                    titleOnly
                    onConfirm={(title) => props.onRewordConfirm(title)}
                    onCancel={props.onCancelReword}
                />
            )}
            <CrossCloneCherryPickModal
                open={props.crossCloneCommits.length > 0}
                sourceWorkspaceId={workspaceId}
                sourceWorkspace={props.sourceWorkspace}
                sourceBranch={branchName || undefined}
                commits={props.crossCloneCommits}
                onClose={props.onCloseCrossClone}
                onApplied={props.onCrossCloneApplied}
            />
        </>
    );
}
