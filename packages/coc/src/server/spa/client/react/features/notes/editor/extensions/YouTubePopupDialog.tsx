/**
 * YouTubePopupDialog — the ⛶ Popup player for YouTube note links (AC-03).
 *
 * Bridges the plain-DOM decoration widget (YouTubeEmbedDecorationExtension) to
 * the React world: RichEditorCore holds a `popupVideoId` state, the ⛶ button's
 * `onRequestPopup` sets it, and this component renders the shared {@link Dialog}
 * around the embeds package's autoplaying {@link YouTubePopupPlayer}.
 *
 * Rendering is fully gated on `videoId`: when it is `null` the component returns
 * `null`, so closing the dialog unmounts the iframe and playback stops.
 */

import { Dialog } from '../../../../ui/Dialog';
import { YouTubePopupPlayer } from '@plusplusoneplusplus/tiptap-embeds/youtube';

export interface YouTubePopupDialogProps {
    /** The video id to play, or `null` to keep the dialog closed / unmounted. */
    videoId: string | null;
    /** Called when the reader dismisses the dialog (backdrop / ✕ / Esc). */
    onClose: () => void;
}

export function YouTubePopupDialog({ videoId, onClose }: YouTubePopupDialogProps) {
    // Gate on the id so a close (id → null) unmounts the iframe → playback stops.
    if (!videoId) return null;

    return (
        <Dialog open onClose={onClose} title="YouTube" className="max-w-[800px]">
            <YouTubePopupPlayer videoId={videoId} />
        </Dialog>
    );
}
