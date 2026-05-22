/**
 * Title Generator
 *
 * Fire-and-forget title generation for AI processes.
 * Extracted from CLITaskExecutor to keep the bridge as a thin facade.
 *
 * Idempotent: skips if the process already has a title.
 * Re-syncs the AI-generated title back to the task's displayName on every turn.
 */

import type { ConversationTurn, ISDKService, ProcessStore, TaskQueueManager } from '@plusplusoneplusplus/forge';
import { denyAllPermissions, getLogger, LogCategory, isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';

const SCRIPT_TITLE_MAX_LEN = 60;
export const TITLE_GENERATION_TIMEOUT_MS = 30_000;

export interface TitleGenerationServiceOptions {
    store: ProcessStore;
    aiService: ISDKService;
    defaultWorkingDirectory?: string;
    queueManager?: TaskQueueManager;
    timeoutMs?: number;
}

/**
 * Derive a short, human-readable title from a shell script without any AI call.
 *
 * Takes the first non-empty, non-comment line and truncates it to
 * SCRIPT_TITLE_MAX_LEN characters. Falls back to "Script" for empty/comment-only input.
 */
export function deriveScriptTitle(script: string): string {
    const lines = script.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            return trimmed.length > SCRIPT_TITLE_MAX_LEN
                ? trimmed.substring(0, SCRIPT_TITLE_MAX_LEN)
                : trimmed;
        }
    }
    return 'Script';
}

export class TitleGenerationService {
    private readonly logger = getLogger();
    private readonly timeoutMs: number;
    private warmClientPromise: Promise<unknown> | null = null;
    private readonly inFlightByProcessId = new Map<string, Promise<void>>();
    private queueManager: TaskQueueManager | undefined;

    constructor(private readonly options: TitleGenerationServiceOptions) {
        this.timeoutMs = options.timeoutMs ?? TITLE_GENERATION_TIMEOUT_MS;
        this.queueManager = options.queueManager;
    }

    setQueueManager(queueManager: TaskQueueManager | undefined): void {
        this.queueManager = queueManager;
    }

    async getOrCreateWarmClient(): Promise<unknown | null> {
        const createClient = (this.options.aiService as { createClient?: (cwd?: string) => Promise<unknown> }).createClient?.bind(this.options.aiService);
        if (!createClient) return null;
        if (!this.warmClientPromise) {
            this.warmClientPromise = createClient(this.options.defaultWorkingDirectory).catch((err) => {
                this.warmClientPromise = null;
                throw err;
            });
        }
        try {
            return await this.warmClientPromise;
        } catch {
            return null;
        }
    }

    async prewarm(): Promise<void> {
        const warmClient = await this.getOrCreateWarmClient();
        if (!warmClient) return;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 30_000));
        try {
            await this.options.aiService.sendMessage({
                prompt: 'Generate a title for: user asked a question and assistant answered.',
                model: 'gpt-4.1',
                timeoutMs: Math.min(this.timeoutMs, 30_000),
                signal: controller.signal,
                workingDirectory: this.options.defaultWorkingDirectory,
                loadDefaultMcpConfig: false,
                onPermissionRequest: denyAllPermissions,
                client: warmClient as never,
            });
        } catch {
            // Pre-warm is best-effort; normal title generation can retry lazily.
        } finally {
            clearTimeout(timeout);
        }
    }

    generateIfNeeded(processId: string, turns: ConversationTurn[]): void {
        const firstUserContent = (turns ?? []).find(t => t?.role === 'user')?.content ?? '';
        if (!firstUserContent) return;

        const firstAssistantContent = (turns ?? []).find(t => t?.role === 'assistant')?.content ?? '';
        if (!firstAssistantContent) return;

        if (this.inFlightByProcessId.has(processId)) return;

        const job = this.generate(processId, firstUserContent, firstAssistantContent)
            .catch((err) => {
                const errMsg = err instanceof Error ? err.message : String(err);
                this.logger.warn(LogCategory.AI, `Title generation failed for ${processId}: ${errMsg}`);
            })
            .finally(() => {
                this.inFlightByProcessId.delete(processId);
            });

        this.inFlightByProcessId.set(processId, job);
    }

    private async generate(processId: string, firstUserContent: string, firstAssistantContent: string): Promise<void> {
        const existing = await this.options.store.getProcess(processId);
        if (existing?.title) {
            this.syncQueueDisplayName(processId, existing.title);
            return;
        }

        const truncatedUser = firstUserContent.substring(0, 400);
        const truncatedAssistant = firstAssistantContent.substring(0, 400);

        const prompt = [
            'Summarise the following conversation as a short title (max 8 words, no punctuation).',
            'Focus on what was actually done or discussed, not on the instruction itself.',
            '',
            `User: "${truncatedUser}"`,
            `Assistant: "${truncatedAssistant}"`,
        ].join('\n');

        const title = await this.generateTitle(prompt);
        if (!title) return;

        await this.options.store.updateProcess(processId, { title });
        this.syncQueueDisplayName(processId, title);
    }

    private async generateTitle(prompt: string): Promise<string> {
        const warmClient = await this.getOrCreateWarmClient();
        const result = await this.options.aiService.sendMessage({
            prompt,
            model: 'gpt-4.1',
            timeoutMs: this.timeoutMs,
            workingDirectory: this.options.defaultWorkingDirectory,
            loadDefaultMcpConfig: false,
            onPermissionRequest: denyAllPermissions,
            ...(warmClient ? { client: warmClient as never } : {}),
        });
        if (!result.success) {
            if (warmClient) this.warmClientPromise = null;
            throw new Error(result.error || 'AI title generation failed');
        }
        return (result.response ?? '').trim().replace(/[".]/g, '');
    }

    private syncQueueDisplayName(processId: string, title: string): void {
        if (!isQueueProcessId(processId) || !this.queueManager) return;
        this.queueManager.updateTask(toTaskId(processId), { displayName: title });
    }
}

export function generateTitleIfNeeded(
    processId: string,
    turns: ConversationTurn[],
    store: ProcessStore,
    aiService: ISDKService,
    defaultWorkingDirectory: string | undefined,
    queueManager: TaskQueueManager | undefined,
): void {
    new TitleGenerationService({ store, aiService, defaultWorkingDirectory, queueManager }).generateIfNeeded(processId, turns);
}
