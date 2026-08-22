/**
 * useGitSkillActions — running a skill, or an AI task, against git targets.
 *
 * Covers the whole "pick a skill → confirm context → enqueue" path plus the
 * direct Ask AI / Queue Task launches and the multi-commit squash request. The
 * skills list, the MRU usage map that ranks it, the pending run, and the skill
 * browser overflow dialog all live here so the context menu only has to name a
 * skill — it never builds a prompt or touches the queue.
 *
 * The browse dialog outlives the context menu, so a run captures its target
 * when it starts rather than reading menu state at confirm time.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import { useQueue } from '../../../contexts/QueueContext';
import type { ResolvedModalJobAiSelection } from '../../../shared/ModalJobAiControls';
import { mergeAutoProviderRoutingContext } from '../../../utils/providerSelection';
import type { GitCommitItem } from '../commits/CommitList';
import type { BranchRangeInfo } from '../branches/BranchChanges';
import {
    buildBranchRangeSkillPrompt, buildBranchReferencePrompt, buildCommitReferencePrompt,
    buildCommitSkillPrompt, buildConflictResolutionPrompt, buildMultiCommitReferencePrompt,
    buildMultiCommitSkillPrompt, buildSquashPrompt,
} from './gitPrompts';
import type { GitRepoStateInfo, SkillMenuContext } from './types';

/** A skill run awaiting the user's extra context + model choice. */
export interface PendingSkillRun extends SkillMenuContext {
    skillName: string;
}

export interface UseGitSkillActionsOptions {
    workspaceId: string;
    /** Root path for the enqueued job's working directory. */
    workspaceRootPath: string | undefined;
    commits: GitCommitItem[];
    unpushedCount: number;
    branchRangeData: BranchRangeInfo | null;
    branchName: string;
    resolvedBaseRef: string | null;
    repoState: GitRepoStateInfo | null;
    showToast: (message: string, durationMs?: number) => void;
}

export interface UseGitSkillActionsReturn {
    skills: Array<{ name: string; description?: string }>;
    /** skillName → ISO timestamp of last use, ranking the menu's MRU list. */
    commitSkillUsageMap: Record<string, string>;
    pendingSkillRun: PendingSkillRun | null;
    /** Human-readable description of what a pending run applies to. */
    pendingSkillTargetSummary: string;
    cancelSkillRun: () => void;
    /** Stage a skill run against `target` (menu selection or browser pick). */
    startSkillRun: (skillName: string, target: SkillMenuContext) => void;
    confirmSkillRun: (userContext: string, aiSelection: ResolvedModalJobAiSelection) => Promise<void>;
    // Skill browser overflow dialog
    skillBrowserContext: SkillMenuContext | null;
    openSkillBrowser: (target: SkillMenuContext) => void;
    closeSkillBrowser: () => void;
    // Direct AI launches
    askAboutCommit: (commit: GitCommitItem, mode: 'ask' | 'task') => void;
    askAboutCommits: (commits: GitCommitItem[], mode: 'ask' | 'task') => void;
    askAboutBranch: (mode: 'ask' | 'task') => void;
    // Queue-backed rewrites
    squashCommits: (selected: GitCommitItem[]) => Promise<void>;
    resolveConflictsWithAI: () => Promise<void>;
}

export function useGitSkillActions({
    workspaceId, workspaceRootPath, commits, unpushedCount, branchRangeData,
    branchName, resolvedBaseRef, repoState, showToast,
}: UseGitSkillActionsOptions): UseGitSkillActionsReturn {
    // AC-07: skills, prefs and enqueue all target the selected clone's server.
    const cloneClient = useCocClient(workspaceId);
    const { dispatch: queueDispatch } = useQueue();

    const [skills, setSkills] = useState<Array<{ name: string; description?: string }>>([]);
    const [commitSkillUsageMap, setCommitSkillUsageMap] = useState<Record<string, string>>({});
    const [pendingSkillRun, setPendingSkillRun] = useState<PendingSkillRun | null>(null);
    const [skillBrowserContext, setSkillBrowserContext] = useState<SkillMenuContext | null>(null);

    // Fetch skills once per workspace
    useEffect(() => {
        setSkills([]);
        cloneClient.request<{ skills?: Array<{ name: string; description?: string }> }>(
            `/workspaces/${encodeURIComponent(workspaceId)}/skills`)
            .then(data => {
                if (data?.skills && Array.isArray(data.skills)) {
                    setSkills(data.skills);
                }
            })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId]);

    // Fetch the commit-scoped skill usage map per workspace
    useEffect(() => {
        setCommitSkillUsageMap({});
        cloneClient.preferences.getRepo(workspaceId)
            .then(prefs => {
                if (prefs?.commitSkillUsageMap) {
                    setCommitSkillUsageMap(prefs.commitSkillUsageMap);
                }
            })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId]);

    /** Enqueue an autopilot chat job in this repo. */
    const enqueueChat = useCallback(async (job: {
        displayName: string;
        prompt: string;
        skillName?: string;
        aiSelection?: ResolvedModalJobAiSelection;
    }) => {
        const { aiSelection } = job;
        const config = {
            ...(aiSelection?.model ? { model: aiSelection.model } : {}),
            ...(aiSelection?.reasoningEffort ? { reasoningEffort: aiSelection.reasoningEffort } : {}),
            ...(aiSelection?.effortTier ? { effortTier: aiSelection.effortTier } : {}),
        };
        await cloneClient.queue.enqueue({
            type: 'chat',
            priority: 'normal',
            displayName: job.displayName,
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: job.prompt,
                workingDirectory: workspaceRootPath || '',
                workspaceId,
                ...(aiSelection?.provider ? { provider: aiSelection.provider } : {}),
                ...(aiSelection || job.skillName
                    ? { context: mergeAutoProviderRoutingContext(aiSelection ?? {} as ResolvedModalJobAiSelection, {
                        ...(job.skillName ? { skills: [job.skillName] } : {}),
                    }) }
                    : {}),
            },
            ...(Object.keys(config).length > 0 ? { config } : {}),
        });
    }, [workspaceId, workspaceRootPath]);

    // ── Skill runs ────────────────────────────────────────────────────────────

    const startSkillRun = useCallback((skillName: string, target: SkillMenuContext) => {
        setPendingSkillRun({ skillName, type: target.type, commit: target.commit, commits: target.commits });
    }, []);

    const cancelSkillRun = useCallback(() => setPendingSkillRun(null), []);
    const openSkillBrowser = useCallback((target: SkillMenuContext) => setSkillBrowserContext(target), []);
    const closeSkillBrowser = useCallback(() => setSkillBrowserContext(null), []);

    const pendingSkillTargetSummary = useMemo(() => {
        if (!pendingSkillRun) return '';
        if (pendingSkillRun.type === 'commit' && pendingSkillRun.commit) {
            return `Commit ${pendingSkillRun.commit.shortHash} — ${pendingSkillRun.commit.subject}`;
        }
        if (pendingSkillRun.type === 'multi-commit' && pendingSkillRun.commits?.length) {
            return `${pendingSkillRun.commits.length} commits selected`;
        }
        return `Branch range: ${branchName || 'current branch'}`;
    }, [pendingSkillRun, branchName]);

    const confirmSkillRun = useCallback(async (userContext: string, aiSelection: ResolvedModalJobAiSelection) => {
        if (!pendingSkillRun) return;

        let promptContent: string;
        if (pendingSkillRun.type === 'commit' && pendingSkillRun.commit) {
            promptContent = buildCommitSkillPrompt(pendingSkillRun.commit);
        } else if (pendingSkillRun.type === 'multi-commit' && pendingSkillRun.commits?.length) {
            promptContent = buildMultiCommitSkillPrompt(pendingSkillRun.commits);
        } else {
            promptContent = buildBranchRangeSkillPrompt(branchRangeData, branchName, resolvedBaseRef);
        }

        if (userContext) {
            promptContent += `\n\nUser context:\n${userContext}`;
        }

        const shortId =
            pendingSkillRun.type === 'commit' && pendingSkillRun.commit
                ? pendingSkillRun.commit.shortHash
                : pendingSkillRun.type === 'multi-commit' && pendingSkillRun.commits?.length
                    ? `${pendingSkillRun.commits.length} commits`
                    : branchName || 'branch';

        await enqueueChat({
            displayName: `Skill: ${pendingSkillRun.skillName} — ${shortId}`,
            prompt: promptContent,
            skillName: pendingSkillRun.skillName,
            aiSelection,
        });

        setPendingSkillRun(null);
        showToast(`Skill "${pendingSkillRun.skillName}" enqueued`);

        // Record commit-scoped skill usage (best-effort) and optimistic local update
        const skillName = pendingSkillRun.skillName;
        setCommitSkillUsageMap(prev => ({ ...prev, [skillName]: new Date().toISOString() }));
        cloneClient.preferences.recordCommitSkillUsage(workspaceId, skillName).catch(() => {});
    }, [pendingSkillRun, workspaceId, branchRangeData, branchName, resolvedBaseRef, enqueueChat, showToast]);

    // ── Direct AI launches ────────────────────────────────────────────────────

    const openChatDialog = useCallback((mode: 'ask' | 'task', initialPrompt: string) => {
        queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode, initialPrompt, launchMode: 'floating-chat' });
    }, [queueDispatch, workspaceId]);

    const askAboutCommit = useCallback((commit: GitCommitItem, mode: 'ask' | 'task') => {
        openChatDialog(mode, buildCommitReferencePrompt(commit));
    }, [openChatDialog]);

    const askAboutCommits = useCallback((selected: GitCommitItem[], mode: 'ask' | 'task') => {
        openChatDialog(mode, buildMultiCommitReferencePrompt(selected));
    }, [openChatDialog]);

    const askAboutBranch = useCallback((mode: 'ask' | 'task') => {
        openChatDialog(mode, buildBranchReferencePrompt({
            branchRangeData, branchName, resolvedBaseRef, commits,
        }));
    }, [openChatDialog, branchRangeData, branchName, resolvedBaseRef, commits]);

    // ── Queue-backed rewrites ─────────────────────────────────────────────────

    const squashCommits = useCallback(async (selected: GitCommitItem[]) => {
        if (selected.length < 2) return;

        // All selected commits must be unpushed
        const indices = selected
            .map(c => {
                const idx = commits.indexOf(c);
                return idx >= 0 && idx < unpushedCount ? idx : -1;
            })
            .filter(i => i !== -1)
            .sort((a, b) => a - b);

        if (indices.length !== selected.length) {
            showToast('Squash failed: all selected commits must be unpushed', 5000);
            return;
        }

        try {
            await enqueueChat({
                displayName: `Squash ${selected.length} commits`,
                prompt: buildSquashPrompt(commits, selected, indices),
            });
            showToast(`Squash task enqueued (${selected.length} commits)`);
        } catch (err: any) {
            showToast(`Failed to enqueue squash: ${err.message || 'Unknown error'}`, 5000);
        }
    }, [commits, unpushedCount, enqueueChat, showToast]);

    const resolveConflictsWithAI = useCallback(async () => {
        if (!repoState || repoState.operation === 'none') return;
        try {
            await enqueueChat({
                displayName: `Resolve ${repoState.operation} conflicts`,
                prompt: buildConflictResolutionPrompt(repoState),
            });
            showToast('Conflict resolution task enqueued');
        } catch (err: any) {
            showToast(`Failed: ${err.message || 'Unknown error'}`, 5000);
        }
    }, [repoState, enqueueChat, showToast]);

    return {
        skills, commitSkillUsageMap,
        pendingSkillRun, pendingSkillTargetSummary, cancelSkillRun, startSkillRun, confirmSkillRun,
        skillBrowserContext, openSkillBrowser, closeSkillBrowser,
        askAboutCommit, askAboutCommits, askAboutBranch,
        squashCommits, resolveConflictsWithAI,
    };
}
