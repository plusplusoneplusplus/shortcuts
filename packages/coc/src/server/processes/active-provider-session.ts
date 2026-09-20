/**
 * The authoritative provider/native-session binding for a conversation (AC-06).
 *
 * A CoC process is the canonical conversation; a provider-native session is
 * replaceable continuation state. Which provider owns the conversation and
 * which native session id continues it are therefore one value, written in one
 * store operation. Readers must go through {@link readActiveProviderSession} —
 * combining a provider read from `metadata.provider` with a session id read
 * from `sdkSessionId` is exactly how a new provider ends up paired with the
 * previous provider's session id.
 *
 * Processes recorded before bindings existed have none. For those this module
 * synthesizes a read-only projection from the legacy fields so callers have a
 * single shape to work with; it is never written back.
 */

import type { ActiveProviderSession, AIProcess, ConversationTurn } from '@plusplusoneplusplus/forge';
import { type ChatProvider, resolveChatProvider, resolveChatProviderOrDefault } from '../tasks/task-types';

/**
 * Segment id used for the projection of a pre-binding conversation. Segment
 * ids are only ever compared within one process, so a shared sentinel is safe
 * and makes "this conversation predates bindings" obvious in stored data.
 */
export const LEGACY_SEGMENT_ID = 'legacy';

/** Shape a process needs to expose for its binding to be resolved. */
export type ProcessBindingSource = Pick<AIProcess, 'activeProviderSession' | 'sdkSessionId' | 'metadata'>;

/**
 * Resolve the conversation's active binding: the stored one when present,
 * otherwise a projection of the legacy `metadata.provider` + `sdkSessionId`
 * pair so old conversations keep resuming exactly as before.
 */
export function readActiveProviderSession(process: ProcessBindingSource): ActiveProviderSession {
    const stored = process.activeProviderSession;
    if (stored && resolveChatProviderOrDefault(stored.provider, 'copilot') === stored.provider) {
        return stored;
    }
    return {
        provider: resolveChatProviderOrDefault(process.metadata?.provider),
        ...(process.sdkSessionId ? { sessionId: process.sdkSessionId } : {}),
        segmentId: LEGACY_SEGMENT_ID,
        firstTurnIndex: 0,
    };
}

/** The concrete provider that currently owns the conversation. */
export function resolveActiveProvider(process: ProcessBindingSource): ChatProvider {
    return readActiveProviderSession(process).provider as ChatProvider;
}

/**
 * The provider explicitly recorded for this conversation, or `undefined` when
 * nothing recorded one. Unlike {@link resolveActiveProvider} this does not
 * substitute a default, so a caller routing to a provider service can keep
 * falling back to the server default instead of guessing Copilot.
 */
export function resolveRecordedProvider(process: ProcessBindingSource): ChatProvider | undefined {
    const candidate = process.activeProviderSession?.provider ?? process.metadata?.provider;
    if (typeof candidate !== 'string') return undefined;
    return resolveChatProvider(candidate);
}

/** The native session id the conversation can currently resume, if any. */
export function resolveActiveSessionId(process: ProcessBindingSource): string | undefined {
    return readActiveProviderSession(process).sessionId;
}

export interface AdvanceBindingInput {
    /** Provider that produced the session. */
    provider: ChatProvider;
    /** Native session id the provider just reported. */
    sessionId: string;
    /** Conversation turn index where the segment would start if it is new. */
    turnIndex: number;
    /** Injected for deterministic tests. */
    now?: Date;
    /** Injected for deterministic tests. */
    newSegmentId?: () => string;
}

export interface AdvanceBindingResult {
    binding: ActiveProviderSession;
    /** True when this starts a new provider segment rather than continuing one. */
    startedNewSegment: boolean;
}

/**
 * Compute the binding that should follow a provider reporting a session id.
 *
 * A new segment starts when the provider changes or when a fresh native
 * session replaces the previous one — including switching back to a provider
 * used earlier, which never resumes that provider's older session because it
 * is missing the intervening turns.
 */
export function advanceActiveProviderSession(
    current: ActiveProviderSession | undefined,
    input: AdvanceBindingInput,
): AdvanceBindingResult {
    const mintSegmentId = input.newSegmentId ?? defaultSegmentId;

    // Continuation is decided on provider + session id alone. A legacy
    // projection that already names this provider and session is the same
    // segment; it just has not been written as a real binding yet, so it gets
    // a proper segment id without being reported as a provider boundary.
    const continuesSession =
        current !== undefined &&
        current.provider === input.provider &&
        (current.sessionId === input.sessionId || current.sessionId === undefined);

    if (continuesSession && current && current.segmentId !== LEGACY_SEGMENT_ID) {
        return {
            binding: current.sessionId === input.sessionId
                ? current
                : { ...current, sessionId: input.sessionId },
            startedNewSegment: false,
        };
    }

    return {
        binding: {
            provider: input.provider,
            sessionId: input.sessionId,
            segmentId: mintSegmentId(),
            firstTurnIndex: continuesSession && current ? current.firstTurnIndex : input.turnIndex,
            boundAt: (input.now ?? new Date()).toISOString(),
        },
        startedNewSegment: !continuesSession,
    };
}

/**
 * The single store update that persists a binding. Provider, session id,
 * segment id and segment start move together, and the legacy `sdkSessionId`
 * projection is written in the same operation so the two can never disagree.
 */
export function activeProviderSessionUpdate(binding: ActiveProviderSession): Partial<AIProcess> {
    return {
        activeProviderSession: binding,
        sdkSessionId: binding.sessionId,
    };
}

function defaultSegmentId(): string {
    return `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The attribution fields a newly recorded turn carries: which provider ran it
 * and which provider segment it belongs to. Both are written from what the
 * turn actually ran on and never re-derived later, so a turn keeps its
 * original attribution after the conversation switches providers.
 *
 * `segmentId` is omitted when the segment is not yet known — a reconstructed
 * continuation has no segment until the target provider reports a session.
 */
export function turnProviderAttribution(
    provider: ChatProvider | undefined,
    segmentId: string | undefined,
): Pick<ConversationTurn, 'provider' | 'segmentId'> {
    return {
        ...(provider ? { provider } : {}),
        ...(segmentId ? { segmentId } : {}),
    };
}
