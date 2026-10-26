import type { TeamsIc3Session } from '@plusplusoneplusplus/coc-native';
import type { Ic3ReactionClient } from '@plusplusoneplusplus/coc-connector/teams';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { CLIConfig } from '../../config';
import { createTeamsReactionAdmission, type TeamsRobotReactionEvidence } from './teams-reaction-admission';
import { collectTeamsReactionContext } from './teams-reaction-context';
import { resolveTeamsReactionDispatcher } from './teams-reaction-dispatcher';
import type { createTeamsReactionExecution } from './teams-reaction-execution';

/** One registered native session; the execution coordinator belongs to the server. */
export function createTeamsReactionPickup(options: {
    account: { tenantId: string; userId: string };
    startedAt: number;
    reader: Pick<TeamsIc3Session, 'readHistory'>;
    reactions: Pick<Ic3ReactionClient, 'acknowledgeSourceMessage'>;
    execution: Pick<ReturnType<typeof createTeamsReactionExecution>, 'run'>;
    store: ProcessStore;
    dataDir: string;
    getConfig: () => Pick<CLIConfig, 'features' | 'teamsReactionDelegation' | 'skills'>;
    signal: AbortSignal;
    /** Account/config lifetime for acknowledged work; notification reconnects only revoke pickup. */
    executionSignal?: AbortSignal;
}) {
    const account = { tenantId: options.account.tenantId.toLowerCase(), userId: options.account.userId.toLowerCase() };
    const admit = createTeamsReactionAdmission(account, options.startedAt);
    const reader = { readHistory: options.reader.readHistory.bind(options.reader) };
    const acknowledge = options.reactions.acknowledgeSourceMessage.bind(options.reactions);
    const lifetime = new AbortController();
    const signal = AbortSignal.any([options.signal, lifetime.signal]);
    const executionSignal = options.executionSignal ?? signal;
    let pending = 0;

    return {
        async handle(evidence: TeamsRobotReactionEvidence) {
            signal.throwIfAborted();
            if (options.getConfig().features?.teamsReactionDelegation !== true) {
                return { admitted: false, reason: 'disabled' } as const;
            }
            if (pending >= 256) throw new Error('Teams reaction pickup capacity exceeded.');
            const admission = admit(evidence);
            if (!admission.admitted) return admission;
            pending++;
            try {
                const binding = await resolveTeamsReactionDispatcher(
                    options.store, options.dataDir, options.getConfig(), signal,
                );
                signal.throwIfAborted();
                const context = await collectTeamsReactionContext(reader, {
                    chatId: admission.conversationId, messageId: admission.messageId,
                }, signal);
                signal.throwIfAborted();
                const current = await resolveTeamsReactionDispatcher(
                    options.store, options.dataDir, options.getConfig(), signal,
                );
                signal.throwIfAborted();
                if (current.workspaceId !== binding.workspaceId || current.workingDirectory !== binding.workingDirectory
                    || current.dispatcherSkill !== binding.dispatcherSkill
                    || current.dispatcherSkillPath !== binding.dispatcherSkillPath) {
                    throw new Error('Teams reaction dispatcher changed during pickup.');
                }
                await acknowledge(admission.conversationId, admission.messageId, signal);
                signal.throwIfAborted();
                const job = await options.execution.run({
                    ...account, conversationId: admission.conversationId, messageId: admission.messageId,
                }, admission.requestId, context.messageContext, executionSignal);
                executionSignal.throwIfAborted();
                return { ...admission, ...job, sourceText: context.sourceText };
            } finally { pending--; }
        },
        dispose() {
            lifetime.abort(new Error('Teams reaction pickup stopped.'));
        },
    };
}
