import { CocToolRuntime, RUN_TOOL_SCRIPT_TOOL_NAME } from '@plusplusoneplusplus/coc-agent-sdk';
import { buildChatTurnContext, type ChatTurnContextInput } from '../executors/chat-turn-context-builder';
import { readApprovalRequiredLlmTools } from '../preferences-handler';
import { runJobGate } from './job-gate-runner';

export interface JobGateOwnerTools extends Omit<ChatTurnContextInput,
    'askUser' | 'unattendedScript' | 'query' | 'browserActivation' | 'browserSignal'> {
    dataDir: string;
    workspaceId: string;
    processId: string;
}

/**
 * Runs with the owner's resolved chat capabilities, including tools that ordinary
 * chat scripts omit. The caller validates live flags, owner and rule revision,
 * supplies owner-bound capabilities, and cancels on revocation or shutdown.
 * No provider session is started: only the CoC handlers in this context execute.
 */
export async function runJobGateWithOwnerTools(options: {
    ownerTools: JobGateOwnerTools;
    code: string;
    state: unknown;
    signal?: AbortSignal;
}): Promise<unknown> {
    const { ownerTools, signal } = options;
    signal?.throwIfAborted();
    const context = await buildChatTurnContext({
        ...ownerTools,
        unattendedScript: true,
        askUser: undefined,
        query: undefined,
        browserActivation: false,
        browserSignal: signal,
    });
    let runtime: CocToolRuntime | undefined;
    try {
        signal?.throwIfAborted();
        const allowNestedScripts = context.tools.some(tool => tool.name === RUN_TOOL_SCRIPT_TOOL_NAME)
            && !readApprovalRequiredLlmTools(ownerTools.dataDir, ownerTools.workspaceId)
                .includes(RUN_TOOL_SCRIPT_TOOL_NAME);
        runtime = new CocToolRuntime(context.tools, {
            workspaceId: ownerTools.workspaceId, processId: ownerTools.processId,
        });
        return await runJobGate({
            code: options.code, state: options.state, runtime, signal, allowNestedScripts,
        });
    } finally {
        runtime?.dispose();
        context.dispose();
    }
}
