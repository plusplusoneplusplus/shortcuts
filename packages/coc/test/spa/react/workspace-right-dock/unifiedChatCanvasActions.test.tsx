/**
 * unifiedChatCanvasActions — the registry a shared-panel canvas tab uses to
 * reach the composer of the chat that owns it.
 *
 * The cases pin the two properties the tab depends on: an action always
 * resolves through the ORIGINATING chat id (so switching chats cannot redirect
 * it), and an unmounted chat resolves to nothing rather than to a handler that
 * silently drops the work.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import {
    clearUnifiedChatCanvasActions,
    getUnifiedChatCanvasActions,
    publishUnifiedChatCanvasActions,
    useUnifiedChatCanvasActions,
    withdrawUnifiedChatCanvasActions,
    type UnifiedChatCanvasActions,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedChatCanvasActions';

function actions(overrides: Partial<UnifiedChatCanvasActions> = {}): UnifiedChatCanvasActions {
    return {
        askAi: vi.fn(),
        sendToAi: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

/** A stand-in for the canvas tab, reporting whether its chat is reachable. */
function Probe({ chatId }: { chatId: string | null }) {
    const resolved = useUnifiedChatCanvasActions(chatId);
    return <div data-testid="probe" data-available={resolved ? 'yes' : 'no'} />;
}

beforeEach(() => {
    clearUnifiedChatCanvasActions();
});

afterEach(() => {
    cleanup();
    clearUnifiedChatCanvasActions();
});

describe('publish / withdraw', () => {
    it('resolves a published chat and reports the registry moving', () => {
        const a = actions();
        expect(publishUnifiedChatCanvasActions('chat-a', a)).toBe(true);
        expect(getUnifiedChatCanvasActions('chat-a')).toBe(a);
        // Re-publishing the same reference is a no-op, so a re-render cannot
        // churn the tabs subscribed to it.
        expect(publishUnifiedChatCanvasActions('chat-a', a)).toBe(false);
    });

    it('keeps chats separate — one chat’s actions never answer for another', () => {
        const a = actions();
        publishUnifiedChatCanvasActions('chat-a', a);
        expect(getUnifiedChatCanvasActions('chat-b')).toBeNull();
        expect(getUnifiedChatCanvasActions(null)).toBeNull();
    });

    it('withdraws only the entry the caller published', () => {
        const first = actions();
        const second = actions();
        publishUnifiedChatCanvasActions('chat-a', first);
        publishUnifiedChatCanvasActions('chat-a', second);

        // The first mount unmounting must not unregister the survivor.
        expect(withdrawUnifiedChatCanvasActions('chat-a', first)).toBe(false);
        expect(getUnifiedChatCanvasActions('chat-a')).toBe(second);

        expect(withdrawUnifiedChatCanvasActions('chat-a', second)).toBe(true);
        expect(getUnifiedChatCanvasActions('chat-a')).toBeNull();
        expect(withdrawUnifiedChatCanvasActions('chat-a')).toBe(false);
    });
});

describe('routing under a chat switch', () => {
    it('reaches the originating chat even while another one is selected', async () => {
        const a = actions();
        const b = actions();
        publishUnifiedChatCanvasActions('chat-a', a);
        publishUnifiedChatCanvasActions('chat-b', b);

        // The tab's descriptor names chat-a; the user is looking at chat-b.
        getUnifiedChatCanvasActions('chat-a')!.askAi('Edit this');
        await getUnifiedChatCanvasActions('chat-a')!.sendToAi('2 comments');

        expect(a.askAi).toHaveBeenCalledWith('Edit this');
        expect(a.sendToAi).toHaveBeenCalledWith('2 comments');
        expect(b.askAi).not.toHaveBeenCalled();
        expect(b.sendToAi).not.toHaveBeenCalled();
    });
});

describe('useUnifiedChatCanvasActions', () => {
    it('appears when the chat mounts after the tab, and goes away when it leaves', () => {
        render(<Probe chatId="chat-a" />);
        expect(screen.getByTestId('probe').getAttribute('data-available')).toBe('no');

        const a = actions();
        act(() => { publishUnifiedChatCanvasActions('chat-a', a); });
        expect(screen.getByTestId('probe').getAttribute('data-available')).toBe('yes');

        act(() => { withdrawUnifiedChatCanvasActions('chat-a', a); });
        expect(screen.getByTestId('probe').getAttribute('data-available')).toBe('no');
    });

    it('is unavailable for a chatless tab', () => {
        publishUnifiedChatCanvasActions('chat-a', actions());
        render(<Probe chatId={null} />);
        expect(screen.getByTestId('probe').getAttribute('data-available')).toBe('no');
    });
});
