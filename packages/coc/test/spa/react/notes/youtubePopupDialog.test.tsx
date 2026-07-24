/**
 * youtubePopupDialog.test.tsx — AC-03 (popup player).
 *
 * The ⛶ Popup button on a decorated YouTube link opens the shared Dialog with an
 * autoplaying `youtube-nocookie` iframe. Gating on the video id means closing the
 * dialog unmounts the iframe, which stops playback.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { YouTubePopupDialog } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/YouTubePopupDialog';

// Force desktop layout so the Dialog renders its ✕ close button deterministically.
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('YouTubePopupDialog', () => {
    it('renders nothing (no dialog, no iframe) when videoId is null', () => {
        render(<YouTubePopupDialog videoId={null} onClose={vi.fn()} />);
        expect(screen.queryByTestId('dialog-overlay')).toBeNull();
        expect(document.querySelector('iframe')).toBeNull();
    });

    it('opens a Dialog with an autoplaying nocookie iframe for a video id', () => {
        render(<YouTubePopupDialog videoId={VIDEO_ID} onClose={vi.fn()} />);

        expect(screen.getByTestId('dialog-overlay')).toBeTruthy();
        const iframe = document.querySelector('iframe') as HTMLIFrameElement;
        expect(iframe).toBeTruthy();
        expect(iframe.getAttribute('src')).toBe(
            `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1`,
        );
        // Privacy default: never the tracking host, always nocookie.
        expect(iframe.getAttribute('src')).not.toContain('youtube.com/embed');
        // Sandboxed like the map embed.
        expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
        expect(iframe.getAttribute('allow')).toContain('autoplay');
    });

    it('calls onClose when the dialog ✕ button is clicked', () => {
        const onClose = vi.fn();
        render(<YouTubePopupDialog videoId={VIDEO_ID} onClose={onClose} />);
        fireEvent.click(screen.getByTestId('dialog-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('removes the iframe from the DOM when closed (stops playback)', () => {
        // Stateful harness: closing sets the id to null → the iframe unmounts.
        function Harness() {
            const [id, setId] = useState<string | null>(VIDEO_ID);
            return <YouTubePopupDialog videoId={id} onClose={() => setId(null)} />;
        }
        render(<Harness />);
        expect(document.querySelector('iframe')).toBeTruthy();

        fireEvent.click(screen.getByTestId('dialog-close-btn'));
        expect(document.querySelector('iframe')).toBeNull();
    });
});
