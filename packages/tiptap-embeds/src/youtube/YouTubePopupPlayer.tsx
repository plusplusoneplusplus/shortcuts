import { youTubeEmbedUrl } from '../urls/index.js';

/**
 * The autoplaying `youtube-nocookie` player for a popup. The host wraps it in its
 * own dialog and opens it from `YouTubeEmbedDecorationExtension`'s `onRequestPopup`.
 * Unmount it on close so playback stops.
 */
export function YouTubePopupPlayer({ videoId }: { videoId: string }) {
    return (
        <div className="yt-embed-popup-frame-wrap">
            <iframe
                className="yt-embed-popup-frame"
                src={youTubeEmbedUrl(videoId, { autoplay: true })}
                title="YouTube video player"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                referrerPolicy="no-referrer-when-downgrade"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
            />
        </div>
    );
}
