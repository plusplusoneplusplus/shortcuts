/**
 * Factory for the `create_pull_request` LLM tool.
 *
 * Creates a GitHub (`gh`) or Azure DevOps (`az repos`) pull request for the
 * calling chat's own repo through the shared create-PR service, then writes the
 * chat ↔ PR binding for the calling process. The shared PR detector also reads
 * successful results for the live composer and task-completion binding backstop.
 *
 * Autopilot-only: the executor passes these deps only for write-capable turns,
 * so ask/read-only chats never see the tool.
 *
 * Per-invocation factory: the workspace, working directory, and process are
 * bound at construction and never come from tool arguments, so a chat can only
 * open PRs against its own repo (multi-repo safe).
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import {
    createPullRequest as defaultCreatePullRequest,
    CreatePullRequestError,
    type CreatePullRequestInput,
    type CreatePullRequestResult,
    type PullRequestMergeMethod,
} from '../git/create-pull-request-service';
import { recordPullRequestBinding, type PrBindingWriterStore } from '../processes/record-pull-request-binding';

export const CREATE_PULL_REQUEST_TOOL_NAME = 'create_pull_request';

export interface CreatePullRequestToolDeps {
    /** The chat's workspace. Bindings are written under its canonical origin. */
    workspaceId: string;
    /** The calling chat's process id (queue-prefixed or bare). */
    processId: string;
    /** The chat's working directory. Falls back to the workspace root. */
    workingDirectory?: string;
    /** Process store used to resolve the workspace and write the binding. */
    store: PrBindingWriterStore;
    /** Injectable service (tests). Defaults to the shared create-PR service. */
    createPullRequest?: (input: CreatePullRequestInput) => Promise<CreatePullRequestResult>;
}

export interface CreatePullRequestArgs {
    title?: string;
    body?: string;
    base?: string;
    draft?: boolean;
    autoMerge?: boolean;
    mergeMethod?: PullRequestMergeMethod;
    commits?: string | string[];
}

const MERGE_METHODS: readonly PullRequestMergeMethod[] = ['merge', 'squash', 'rebase'];

/** An empty string/list means "no commits" — current-branch mode. */
function hasCommits(commits: string | string[] | undefined): commits is string | string[] {
    if (typeof commits === 'string') return commits.trim().length > 0;
    return Array.isArray(commits) && commits.length > 0;
}

export function createCreatePullRequestTool(deps: CreatePullRequestToolDeps): { tool: Tool<CreatePullRequestArgs> } {
    const run = deps.createPullRequest ?? ((input: CreatePullRequestInput) => defaultCreatePullRequest(input));

    const tool = defineTool<CreatePullRequestArgs>(CREATE_PULL_REQUEST_TOOL_NAME, {
        description:
            'Create a pull request for this chat\'s repo (GitHub via `gh`, Azure DevOps via `az repos`; the provider '
            + 'comes from the origin remote). Use this ONLY when the user explicitly asks to create, open, or submit a '
            + 'PR — never on your own initiative. Do not run `gh pr create` / `az repos pr create` yourself; this tool '
            + 'is what links the PR to the chat. Two modes: pass `commits` (a SHA, a list of SHAs, or `A..B`) to '
            + 'cherry-pick those commits onto a fresh branch off origin/<base> in a temporary worktree (your checkout '
            + 'is untouched; any conflict aborts the whole run and reports the conflicting SHA — do NOT try to resolve '
            + 'it); or omit `commits` to open a PR from the current branch (pushed if needed). If the branch already '
            + 'has an open PR, that PR is returned. Uses the user\'s existing gh/az login.',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'PR title.' },
                body: { type: 'string', description: 'PR description (markdown).' },
                base: { type: 'string', description: 'Target branch. Defaults to the repo\'s default branch.' },
                draft: { type: 'boolean', description: 'Open as a draft PR. Default false.' },
                autoMerge: { type: 'boolean', description: 'Turn on auto-merge. Default false — only set when the user asks.' },
                mergeMethod: { type: 'string', enum: [...MERGE_METHODS], description: 'Auto-merge method. Default "merge".' },
                commits: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Commits mode: SHAs to submit, e.g. ["abc123"], ["abc123", "def456"], or ["A..B"] for a range. Omit to use the current branch.',
                },
            },
            required: ['title'],
        },
        handler: async (args) => {
            const a = args ?? ({} as CreatePullRequestArgs);
            const title = typeof a.title === 'string' ? a.title.trim() : '';
            if (!title) return { success: false, code: 'invalid-input', error: 'title is required' };
            if (a.mergeMethod !== undefined && !MERGE_METHODS.includes(a.mergeMethod)) {
                return { success: false, code: 'invalid-input', error: `mergeMethod must be one of ${MERGE_METHODS.join(', ')}` };
            }

            const workspace = (await deps.store.getWorkspaces()).find(ws => ws.id === deps.workspaceId);
            const repoRoot = deps.workingDirectory || workspace?.rootPath;
            if (!repoRoot) {
                return { success: false, code: 'invalid-input', error: 'This chat has no repository working directory.' };
            }

            let result: CreatePullRequestResult;
            try {
                result = await run({
                    repoRoot,
                    title,
                    ...(typeof a.body === 'string' ? { body: a.body } : {}),
                    ...(typeof a.base === 'string' && a.base.trim() ? { base: a.base.trim() } : {}),
                    ...(typeof a.draft === 'boolean' ? { draft: a.draft } : {}),
                    ...(typeof a.autoMerge === 'boolean' ? { autoMerge: a.autoMerge } : {}),
                    ...(a.mergeMethod ? { mergeMethod: a.mergeMethod } : {}),
                    ...(hasCommits(a.commits) ? { commits: a.commits } : {}),
                });
            } catch (err) {
                if (err instanceof CreatePullRequestError) {
                    return {
                        success: false,
                        code: err.code,
                        error: err.message,
                        ...(err.commit ? { commit: err.commit } : {}),
                    };
                }
                return { success: false, code: 'command-failed', error: err instanceof Error ? err.message : String(err) };
            }

            let bound = false;
            try {
                bound = (await recordPullRequestBinding(deps.store, deps.workspaceId, deps.processId, result.id)) !== undefined;
            } catch (err) {
                getLogger().warn(
                    LogCategory.AI,
                    `[create_pull_request] PR ${result.url} created but the chat binding failed: ${err instanceof Error ? err.message : String(err)}`,
                );
            }

            return { success: true, ...result, bound };
        },
    });

    return { tool };
}
