// @vitest-environment jsdom
/**
 * AC-04: useDesktopScreenshotAttach subscribes to the desktop preload bridge's
 * screenshot push channel while mounted and forwards each PNG data URL to the
 * consumer; it is inert (no crash) when the bridge is absent.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDesktopScreenshotAttach } from '../../../../src/server/spa/client/react/features/chat/hooks/useDesktopScreenshotAttach';

type AttachCb = (dataUrl: string) => void;

function installBridge(): { emit: (url: string) => void; unsubscribe: ReturnType<typeof vi.fn> } {
    let handler: AttachCb | null = null;
    const unsubscribe = vi.fn(() => { handler = null; });
    (window as unknown as { cocDesktop: unknown }).cocDesktop = {
        screenshot: {
            onScreenshotAttach: (cb: AttachCb) => { handler = cb; return unsubscribe; },
        },
    };
    return {
        emit: (url: string) => { if (handler) handler(url); },
        unsubscribe,
    };
}

afterEach(() => {
    delete (window as unknown as { cocDesktop?: unknown }).cocDesktop;
});

describe('useDesktopScreenshotAttach', () => {
    it('forwards pushed screenshot data URLs to the consumer', () => {
        const bridge = installBridge();
        const onScreenshot = vi.fn();

        renderHook(() => useDesktopScreenshotAttach(onScreenshot));
        bridge.emit('data:image/png;base64,AAAA');

        expect(onScreenshot).toHaveBeenCalledWith('data:image/png;base64,AAAA');
    });

    it('unsubscribes on unmount', () => {
        const bridge = installBridge();
        const { unmount } = renderHook(() => useDesktopScreenshotAttach(vi.fn()));

        unmount();
        expect(bridge.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('is inert when not running in the desktop shell (no bridge)', () => {
        // No cocDesktop bridge installed.
        expect(() => {
            const { unmount } = renderHook(() => useDesktopScreenshotAttach(vi.fn()));
            unmount();
        }).not.toThrow();
    });
});
