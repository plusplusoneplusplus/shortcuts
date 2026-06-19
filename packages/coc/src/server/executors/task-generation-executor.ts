/**
 * Task Generation Executor
 *
 * Concrete executor for task-generation chat tasks.
 * Builds an enriched AI prompt from feature context, plan/spec content, or a
 * user-supplied name, then delegates to ChatBaseExecutor for the full AI call
 * lifecycle (images, availability, skill resolution, streaming, cleanup).
 *
 * Extends ChatBaseExecutor so that the shared execute() lifecycle is reused.
 * The `execute(task)` override builds the enriched prompt before calling
 * `super.execute(task, aiPrompt)`, and `buildModeOptions()` injects the
 * plan-generation system message stored in a per-task Map.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    AutoFolderContext,
    ProcessStore,
    QueuedTask,
    SelectedContext,
} from '@plusplusoneplusplus/forge';
import {
    applyDeepModePrefix,
    AUTO_FOLDER_SENTINEL,
    buildCreateFromFeaturePrompt,
    buildCreateTaskPrompt,
    buildCreateTaskPromptWithName,
    buildDeepModePrompt,
    buildPlanGenerationSystemPrompt,
    gatherFeatureContext,
    toQueueProcessId,
} from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../tasks/task-types';
import { resolveTaskRoot } from '../tasks/task-root-resolver';
import type { ChatModeAIOptions, ChatModeExecutionResult, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import { systemMessageBuilder } from './system-message-builder';
import { isValidTaskFolder } from './auto-folder-utils';

// ============================================================================
// TaskGenerationExecutor
// ============================================================================

export class TaskGenerationExecutor extends ChatBaseExecutor {
    /** Stores the computed system prompt keyed by task.id before super.execute() runs. */
    private readonly pendingSystemPrompts = new Map<string, string>();

    constructor(store: ProcessStore, options: ChatModeExecutorOptions, dataDir?: string) {
        super(store, options, dataDir);
    }

    /**
     * Execute a task-generation chat task.
     *
     * Flow:
     * 1. Extract task-generation context from payload
     * 2. Build enriched AI prompt (from feature context / name / auto-folder)
     * 3. Apply deep-mode prefix when depth is 'deep'
     * 4. Build plan-generation system prompt
     * 5. Update process store with enriched prompt
     * 6. Store system prompt in Map keyed by task.id
     * 7. Call super.execute(task, aiPrompt) for full AI lifecycle
     */
    async execute(task: QueuedTask, _prompt?: string): Promise<ChatModeExecutionResult> {
        const payload = task.payload as unknown as ChatPayload;
        const tg = payload.context!.taskGeneration!;
        const workingDirectory = payload.workingDirectory || this.defaultWorkingDirectory || '';

        const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
        const wsId = payload.workspaceId || await this.resolveWorkspaceIdForPathFn(workingDirectory);
        const tasksBase = resolveTaskRoot({
            dataDir: effectiveDataDir,
            rootPath: workingDirectory,
            workspaceId: wsId,
        }).absolutePath;
        const isAutoFolder = tg.targetFolder === AUTO_FOLDER_SENTINEL;
        const resolvedTarget = (isAutoFolder || !tg.targetFolder)
            ? tasksBase
            : path.resolve(tasksBase, tg.targetFolder);
        fs.mkdirSync(resolvedTarget, { recursive: true });

        let autoFolderContext: AutoFolderContext | undefined;
        if (isAutoFolder) {
            const entries = await fs.promises.readdir(tasksBase, { withFileTypes: true })
                .catch(() => [] as fs.Dirent[]);
            const subfolders = entries
                .filter(e => e.isDirectory() && isValidTaskFolder(e.name) && e.name !== 'archive')
                .map(e => e.name);
            const deepFolders: string[] = [];
            for (const sub of subfolders) {
                const nested = await fs.promises.readdir(path.join(tasksBase, sub), { withFileTypes: true })
                    .catch(() => [] as fs.Dirent[]);
                for (const n of nested) {
                    if (n.isDirectory() && isValidTaskFolder(n.name)) deepFolders.push(`${sub}/${n.name}`);
                }
            }
            autoFolderContext = { tasksRoot: tasksBase, existingFolders: [...subfolders, ...deepFolders] };
        }

        let aiPrompt: string;
        if (tg.mode === 'from-feature') {
            const context = await gatherFeatureContext(resolvedTarget, workingDirectory);
            const selectedContext: SelectedContext = {
                description: context.description,
                planContent: context.planContent,
                specContent: context.specContent,
                relatedFiles: context.relatedFiles,
            };
            aiPrompt = tg.depth === 'deep'
                ? buildDeepModePrompt(selectedContext, payload.prompt, tg.name, resolvedTarget, workingDirectory)
                : buildCreateFromFeaturePrompt(selectedContext, payload.prompt, tg.name, resolvedTarget);
        } else if (tg.name?.trim()) {
            aiPrompt = buildCreateTaskPromptWithName(tg.name, payload.prompt, resolvedTarget, autoFolderContext);
        } else if (isAutoFolder) {
            aiPrompt = buildCreateTaskPromptWithName(undefined, payload.prompt, resolvedTarget, autoFolderContext);
        } else {
            aiPrompt = buildCreateTaskPrompt(payload.prompt, resolvedTarget);
        }

        if (tg.depth === 'deep') {
            aiPrompt = applyDeepModePrefix(aiPrompt);
        }

        const systemPrompt = buildPlanGenerationSystemPrompt({
            targetPath: resolvedTarget,
            autoFolder: isAutoFolder,
            tasksRoot: isAutoFolder ? tasksBase : undefined,
            existingFolders: autoFolderContext?.existingFolders,
        });

        // Update process store with the enriched prompt BEFORE calling super.execute()
        const processId = toQueueProcessId(task.id);
        const enrichedPreview = aiPrompt.length > 80 ? aiPrompt.substring(0, 77) + '...' : aiPrompt;
        try {
            await this.store.updateProcess(processId, {
                fullPrompt: aiPrompt,
                promptPreview: enrichedPreview,
            });
            await this.store.updateTurnContent(processId, 0, aiPrompt);
        } catch {
            // Non-fatal: store may be a stub
        }

        this.pendingSystemPrompts.set(task.id, systemPrompt);
        try {
            return await super.execute(task, aiPrompt);
        } finally {
            this.pendingSystemPrompts.delete(task.id);
        }
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        _workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const systemPrompt = this.pendingSystemPrompts.get(task.id) ?? '';
        // Task generation is a user-facing agent session (AC-03): append the
        // admin-configured global system prompt after the plan-generation
        // contract via the shared builder. No-op when unset, so structured
        // plan output is unchanged by default.
        const systemMessage = await systemMessageBuilder()
            .append(systemPrompt || undefined)
            .appendGlobalSystemPrompt(this.resolveGlobalSystemPrompt())
            .build();
        return {
            agentMode: undefined,
            systemMessage,
            tools: [],
            effectivePrompt: prompt,
        };
    }
}
