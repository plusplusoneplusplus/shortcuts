/**
 * How a follow-up turn continues the conversation (AC-04).
 *
 * Every follow-up resolves to exactly one of two modes:
 *
 * - **Native resume** — the requested provider matches the conversation's
 *   active binding and that binding holds a session id. The provider resumes
 *   its own session, exactly as before this feature existed.
 * - **Reconstructed continuation** — the requested provider differs from the
 *   active binding, or no resumable session exists at all (the cold-recovery
 *   path). A fresh session is started on the requested provider with no old
 *   session id, and prior context is rebuilt from CoC's canonical transcript.
 *
 * This decision lives here rather than inside the follow-up executor so the
 * same primitive can serve expired-session recovery, fork, and future
 * cross-segment rewind instead of each growing its own transcript-replay
 * branch.
 *
 * The one rule this module exists to enforce: a session id created by one
 * provider is never offered to another. When the provider changes, the resume
 * session id is dropped here, before anything can reach the SDK.
 */

import type { ActiveProviderSession } from '@plusplusoneplusplus/forge';
import type { ChatProvider } from '../tasks/task-types';

export type ContinuationMode = 'native-resume' | 'reconstructed';

export interface ContinuationDecisionInput {
    /** The conversation's authoritative provider/session binding. */
    binding: ActiveProviderSession;
    /**
     * Concrete provider accepted with this message. Omitted by older clients
     * and by every non-switching caller, which means "keep the conversation's
     * provider".
     */
    requestedProvider?: ChatProvider;
    /**
     * Stopped-chat strict continuation target. Only meaningful for a
     * same-provider follow-up: a different provider cannot resume it, and a
     * cross-provider continuation does not need it because it rebuilds from
     * canonical history instead.
     */
    strictResumeSessionId?: string;
}

export interface ContinuationDecision {
    mode: ContinuationMode;
    /** Concrete provider that will run this turn. */
    provider: ChatProvider;
    /** Native session id to resume; never set for a reconstructed continuation. */
    resumeSessionId?: string;
    /** True when this turn changes provider relative to the active binding. */
    providerChanged: boolean;
    /**
     * True when the resumed session must be the exact requested one and a
     * provider-created replacement is a failure rather than a fallback.
     */
    strictResume: boolean;
}

/**
 * Decide how this follow-up continues, given the conversation's active binding
 * and the provider carried by the message itself.
 *
 * The requested provider comes from the accepted message, never from mutable
 * conversation metadata, so a metadata change after acceptance cannot retarget
 * a turn that is already in flight.
 */
export function resolveContinuationMode(input: ContinuationDecisionInput): ContinuationDecision {
    const bindingProvider = input.binding.provider as ChatProvider;
    const provider = input.requestedProvider ?? bindingProvider;
    const providerChanged = provider !== bindingProvider;

    if (providerChanged) {
        // Switching back to a provider used earlier lands here too: its older
        // session is missing the intervening turns, so it is never resumed.
        return {
            mode: 'reconstructed',
            provider,
            providerChanged: true,
            strictResume: false,
        };
    }

    const resumeSessionId = input.strictResumeSessionId ?? input.binding.sessionId;
    if (!resumeSessionId) {
        return {
            mode: 'reconstructed',
            provider,
            providerChanged: false,
            strictResume: false,
        };
    }

    return {
        mode: 'native-resume',
        provider,
        resumeSessionId,
        providerChanged: false,
        strictResume: input.strictResumeSessionId !== undefined,
    };
}
