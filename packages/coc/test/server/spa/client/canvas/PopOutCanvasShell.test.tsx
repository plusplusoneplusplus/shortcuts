/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    canvasProps: null as any,
    wsOnMessage: null as ((msg: unknown) => void) | null,
}));

// CanvasPanel is heavy (network + Monaco); capture the props it receives.
vi.mock('../../../../../src/server/spa/client/react/features/canvas/CanvasPanel', () => ({
    CanvasPanel: (props: any) => {
        mocks.canvasProps = props;
        return (
            <div
                data-testid="mock-canvas-panel"
                data-workspace={props.workspaceId}
                data-canvas={props.canvasId}
                data-revision={props.liveEvent?.revision ?? 'none'}
                data-has-popout={props.onPopOut ? 'yes' : 'no'}
            />
        );
    },
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: ({ onMessage }: { onMessage: (msg: unknown) => void }) => {
        mocks.wsOnMessage = onMessage;
        return { status: 'open', connect: vi.fn(), disconnect: vi.fn() };
    },
}));

// Provider passthroughs to avoid real network/context wiring.
vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    AppProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    QueueProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    useToast: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    ToastContainer: () => null,
}));
vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getHostname: () => 'localhost',
}));

import { PopOutCanvasShell, parsePopOutCanvasRoute } from '../../../../../src/server/spa/client/react/layout/PopOutCanvasShell';

describe('parsePopOutCanvasRoute', () => {
    it('parses workspace and canvasId from the pop-out URL', () => {
        expect(parsePopOutCanvasRoute('#popout/canvas', '?workspace=ws-1&canvasId=doc-1')).toEqual({
            wsId: 'ws-1',
            canvasId: 'doc-1',
        });
    });

    it('returns null for a non-canvas hash or missing params', () => {
        expect(parsePopOutCanvasRoute('#popout/markdown', '?workspace=ws-1&canvasId=doc-1')).toBeNull();
        expect(parsePopOutCanvasRoute('#popout/canvas', '?workspace=ws-1')).toBeNull();
        expect(parsePopOutCanvasRoute('#popout/canvas', '?canvasId=doc-1')).toBeNull();
    });
});

describe('PopOutCanvasShell', () => {
    beforeEach(() => {
        mocks.canvasProps = null;
        mocks.wsOnMessage = null;
    });

    it('renders the canvas for a valid URL and maps WS canvas-updated to liveEvent', () => {
        window.history.replaceState({}, '', '/?workspace=ws-1&canvasId=doc-1#popout/canvas');

        render(<PopOutCanvasShell />);

        const panel = screen.getByTestId('mock-canvas-panel');
        expect(panel.getAttribute('data-workspace')).toBe('ws-1');
        expect(panel.getAttribute('data-canvas')).toBe('doc-1');
        // The pop-out window itself does not offer a nested pop-out button.
        expect(panel.getAttribute('data-has-popout')).toBe('no');
        expect(panel.getAttribute('data-revision')).toBe('none');

        // A matching WS event becomes the panel's liveEvent.
        act(() => {
            mocks.wsOnMessage?.({ type: 'canvas-updated', canvasId: 'doc-1', title: 'T', revision: 7, editor: 'user' });
        });
        expect(screen.getByTestId('mock-canvas-panel').getAttribute('data-revision')).toBe('7');

        // An event for a different canvas is ignored.
        act(() => {
            mocks.wsOnMessage?.({ type: 'canvas-updated', canvasId: 'other', revision: 9, editor: 'ai' });
        });
        expect(screen.getByTestId('mock-canvas-panel').getAttribute('data-revision')).toBe('7');
    });

    it('shows an error for an invalid pop-out URL', () => {
        window.history.replaceState({}, '', '/?workspace=ws-1#popout/canvas');

        render(<PopOutCanvasShell />);

        expect(screen.queryByTestId('mock-canvas-panel')).toBeNull();
        expect(screen.getByText('Invalid canvas pop-out URL.')).toBeTruthy();
    });
});
