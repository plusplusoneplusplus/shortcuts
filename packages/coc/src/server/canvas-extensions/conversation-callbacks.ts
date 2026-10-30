import { randomUUID } from 'node:crypto';
import type { AIProcess, ISDKService, ProcessStore } from '@plusplusoneplusplus/forge';
import type { CLIConfig } from '../../config';
import { createCLIAIInvoker } from '../../ai-invoker';
import { CANVAS_COMPLETE_TIMEOUT_MS, createCanvasCompleteFn } from '../canvas/canvas-capability-completion';
import type { QueueExecutorBridge } from '../core/api-handler';
import { resolveChatTurnModel } from '../executors/chat-turn-policy-resolver';
import { resolveActiveProvider } from '../processes/active-provider-session';
import { emitDeliveryEvents, ProcessMessageDeliveryService } from '../processes/process-message-delivery-service';
import type { ChatProvider } from '../tasks/task-types';
import type { CanvasExtensionOwner, CanvasExtensionRegistryOptions } from './host-registry';

interface ConversationCallbackOptions {
    config: () => Pick<CLIConfig, 'canvasExtensions'>;
    store: ProcessStore;
    bridge: QueueExecutorBridge;
    dataDir: string;
    resolveAiService: (provider: ChatProvider) => ISDKService;
    log: (message: string) => void;
}

/** Reuse ordinary follow-up admission and canvas one-shot completion, never provider sessions. */
export function createCanvasExtensionCallbacks(options: ConversationCallbackOptions):
    Required<Pick<CanvasExtensionRegistryOptions, 'send' | 'ephemeralQuery'>> {
    const delivery = new ProcessMessageDeliveryService({ store: options.store, bridge: options.bridge });

    function validateOwner(owner: CanvasExtensionOwner, process: AIProcess | undefined): asserts process is AIProcess {
        if (!options.config().canvasExtensions?.enabled) throw new Error('Canvas extensions are disabled');
        if (!process || process.archived || process.metadata?.workspaceId !== owner.workspaceId) {
            throw new Error('Canvas conversation is missing, archived or owned by another workspace');
        }
    }

    async function readOwner(owner: CanvasExtensionOwner) {
        if (!options.config().canvasExtensions?.enabled) throw new Error('Canvas extensions are disabled');
        const process = await options.store.getProcess(owner.processId, owner.workspaceId);
        validateOwner(owner, process);
        return process;
    }

    return {
        async send(owner, extensionKey, prompt) {
            if (!prompt.trim()) throw new Error('Canvas extension follow-up needs a non-empty prompt');
            await readOwner(owner);
            const messageId = randomUUID();
            const content = `[Canvas extension ${extensionKey}]\n\n${prompt}`;
            const result = await delivery.deliverOnce(owner.workspaceId, owner.processId, messageId,
                { content, displayContent: content }, process => validateOwner(owner, process));
            emitDeliveryEvents(options.store, owner.processId, result.events);
            options.log(`[canvas-extension ${extensionKey}] session.send workspace=${owner.workspaceId} `
                + `process=${owner.processId} message=${messageId}`);
            return { messageId };
        },
        async ephemeralQuery(owner, extensionKey, question) {
            const process = await readOwner(owner);
            const provider = resolveActiveProvider(process);
            const complete = createCanvasCompleteFn(options.dataDir, {
                ...owner, canvasId: extensionKey, capability: 'session.ui.ephemeralQuery',
            }, {
                log: options.log,
                defaultModel: () => resolveChatTurnModel({
                    provider,
                    requestedModel: typeof process.metadata?.model === 'string' ? process.metadata.model : undefined,
                    dataDir: options.dataDir, workspaceId: owner.workspaceId, defaultModelMode: 'followUp',
                    onCoerced: report => options.log(`[canvas-extension ${extensionKey}] Dropping unsupported `
                        + `${report.source} model '${report.requestedModel}' for provider '${provider}'`),
                }),
                invoke: async (prompt, model) => {
                    const invoke = createCLIAIInvoker({
                        aiService: options.resolveAiService(provider), model,
                        workingDirectory: process.workingDirectory,
                        approvePermissions: false, loadMcpConfig: false,
                    });
                    const result = await invoke(prompt, { timeoutMs: CANVAS_COMPLETE_TIMEOUT_MS });
                    return result.success
                        ? { success: true, response: result.response ?? '' }
                        : { success: false, error: result.error || 'AI request failed' };
                },
            });
            const result = await complete({ prompt: question });
            if (!result.ok) throw new Error(result.error);
            await readOwner(owner);
            return { answer: result.text };
        },
    };
}
