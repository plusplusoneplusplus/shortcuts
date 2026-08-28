/**
 * ChatMetadataButton — the conversation "i" button as one component.
 *
 * Every chat header (the built-in `ChatHeader`, the compact `NotesChatHeader`)
 * renders this instead of mounting `ConversationMetadataPopover` itself, so the
 * rules for when the icon appears and which props survive on mobile live in one
 * place and can't drift apart per surface.
 */

import { useBreakpoint } from '../../../hooks/ui/useBreakpoint';
import { ConversationMetadataPopover, type MetaRow } from './ConversationMetadataPopover';

/**
 * Everything the "i" button needs about a conversation. `ChatDetail` owns the
 * chat state and builds this bundle; hosts that hide the built-in header
 * receive it via `onHeaderMetadataChange` and hand it straight back to their
 * own header.
 */
export interface ChatHeaderMetadata {
    /** Output of `buildMetadataProcess` — queue task merged with the process record. */
    metadataProcess: any;
    turnsCount: number;
    isPending: boolean;
    resumeSessionId: string | null | undefined;
    resumeLaunching: boolean;
    onLaunchInteractiveResume: () => void;
    onCopyResumeCommand?: () => void;
    /** Only set when forking is available (completed chat with an SDK session id). */
    onFork?: () => void;
    forking?: boolean;
    onStartFreshSameContext?: () => Promise<boolean> | boolean | void;
    startingFreshSameContext?: boolean;
}

export interface ChatMetadataButtonProps extends ChatHeaderMetadata {
    /** Extra rows appended after the standard compact rows. */
    extraRows?: MetaRow[];
    /** Overrides the trigger button classes (e.g. a 24px control in a 32px header). */
    triggerClassName?: string;
}

export function ChatMetadataButton({
    metadataProcess,
    turnsCount,
    isPending,
    resumeSessionId,
    resumeLaunching,
    onLaunchInteractiveResume,
    onCopyResumeCommand,
    onFork,
    forking,
    onStartFreshSameContext,
    startingFreshSameContext,
    extraRows,
    triggerClassName,
}: ChatMetadataButtonProps) {
    const { isMobile } = useBreakpoint();

    // Nothing to show before the conversation exists: a queued chat has no
    // process record worth reading, and without a merged process there are no
    // rows at all.
    if (isPending || !metadataProcess) return null;

    return (
        <ConversationMetadataPopover
            process={metadataProcess}
            turnsCount={turnsCount}
            extraRows={extraRows}
            triggerClassName={triggerClassName}
            // Resuming in a CLI is a desktop-only action — there is no terminal
            // to hand the session to on a phone.
            resumeSessionId={isMobile ? undefined : resumeSessionId}
            resumeLaunching={resumeLaunching}
            onLaunchInteractiveResume={isMobile ? undefined : onLaunchInteractiveResume}
            onCopyResumeCommand={isMobile ? undefined : onCopyResumeCommand}
            onFork={onFork}
            forking={forking}
            onStartFreshSameContext={onStartFreshSameContext}
            startingFreshSameContext={startingFreshSameContext}
        />
    );
}
