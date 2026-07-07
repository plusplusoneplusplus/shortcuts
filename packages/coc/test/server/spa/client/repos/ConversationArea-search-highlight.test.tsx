/**
 * ConversationArea search-highlight tests — AC-04 / AC-05 of the Ctrl+F Search
 * Experience.
 *
 * AC-04: clicking a chat-list search result opens the conversation and, once it
 * renders, every case-insensitive occurrence of the query is highlighted across
 * the rendered turns and the first is scrolled into view.
 * AC-05: the highlight persists until the search box is exited (empty query),
 * and is torn down on empty query / unmount.
 *
 * jsdom lacks the CSS Custom Highlight API, so `CSS.highlights`, `Highlight` and
 * `scrollIntoView` are mocked here (memory `vitest4-local-drift-jsdom-pragma`).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ConversationArea } from '../../../../../src/server/spa/client/react/features/chat/ConversationArea';
import {
    buildHighlightRanges,
    clearSearchHighlight,
    isHighlightApiSupported,
    SEARCH_HIGHLIGHT_NAME,
} from '../../../../../src/server/spa/client/react/features/chat/hooks/useConversationSearchHighlight';
import type { ClientConversationTurn } from '../../../../../src/server/spa/client/react/types/dashboard';

// ---------------------------------------------------------------------------
// CSS Custom Highlight API mock (absent in jsdom).
// ---------------------------------------------------------------------------
class MockHighlight {
    ranges: Range[];
    constructor(...ranges: Range[]) {
        this.ranges = ranges;
    }
}

let highlightsSet: ReturnType<typeof vi.fn>;
let highlightsDelete: ReturnType<typeof vi.fn>;
let highlightsStore: Map<string, MockHighlight>;

beforeAll(() => {
    // scrollIntoView is not implemented in jsdom.
    Element.prototype.scrollIntoView = vi.fn();
    (globalThis as any).Highlight = MockHighlight;
});

beforeEach(() => {
    highlightsStore = new Map();
    highlightsSet = vi.fn((name: string, h: MockHighlight) => highlightsStore.set(name, h));
    highlightsDelete = vi.fn((name: string) => highlightsStore.delete(name));
    if (typeof (globalThis as any).CSS === 'undefined') (globalThis as any).CSS = {};
    (globalThis as any).CSS.highlights = {
        set: highlightsSet,
        delete: highlightsDelete,
        get: (n: string) => highlightsStore.get(n),
    };
    (Element.prototype.scrollIntoView as any).mockClear?.();
});

// ---------------------------------------------------------------------------
// ConversationArea child mocks (mirrors the sibling ConversationArea tests).
// The ConversationTurnBubble mock emits `data-turn-index` so the highlight
// walker can locate rendered turns, matching the real bubble's contract.
// ---------------------------------------------------------------------------
vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Spinner: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: ({ turn, turnIndex }: any) => (
        <div data-turn-index={turnIndex}>{turn.content}</div>
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/queue/PendingTaskInfoPanel', () => ({
    PendingTaskInfoPanel: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/QueuedBubble', () => ({
    QueuedFollowUps: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/BackgroundTasksIndicator', () => ({
    BackgroundTasksIndicator: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/AskUserInline', () => ({
    AskUserInline: () => null,
}));

function makeTurn(turnIndex: number, content: string): ClientConversationTurn {
    return {
        role: turnIndex % 2 === 0 ? 'user' : 'assistant',
        content,
        timeline: [],
        turnIndex,
    } as ClientConversationTurn;
}

const baseProps = {
    loading: false,
    error: null,
    pendingQueue: [],
    isScrolledUp: false,
    scrollRef: { current: null } as any,
    onScrollToBottom: vi.fn(),
    isPending: false,
    task: { status: 'completed' },
    fullTask: null,
    onCancel: vi.fn(),
    onMoveToTop: vi.fn(),
    variant: 'inline' as const,
    taskId: 'task-1',
};

// ---------------------------------------------------------------------------
// Pure helper: buildHighlightRanges
// ---------------------------------------------------------------------------
function container(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
}

describe('buildHighlightRanges', () => {
    it('finds every case-insensitive occurrence of the full query within turns', () => {
        const c = container('<div data-turn-index="0">A BANANA and a banana</div><div data-turn-index="1">banana</div>');
        expect(buildHighlightRanges(c, 'banana').length).toBe(3);
    });

    it('falls back to whitespace-split terms when the full string never appears', () => {
        const c = container('<div data-turn-index="0">foo lives here and bar lives there</div>');
        // "foo bar" is not contiguous, so we fall back to matching "foo" + "bar".
        expect(buildHighlightRanges(c, 'foo bar').length).toBe(2);
    });

    it('prefers the full-string match over the term fallback when present', () => {
        const c = container('<div data-turn-index="0">foo bar and a lone foo</div>');
        // "foo bar" appears once contiguously → 1 range, NOT the 3 loose terms.
        expect(buildHighlightRanges(c, 'foo bar').length).toBe(1);
    });

    it('returns nothing when there is no match', () => {
        const c = container('<div data-turn-index="0">nothing to see here</div>');
        expect(buildHighlightRanges(c, 'banana')).toEqual([]);
    });

    it('ignores text outside [data-turn-index] (e.g. the composer)', () => {
        const c = container('<textarea>banana</textarea><div data-turn-index="0">no fruit here</div>');
        expect(buildHighlightRanges(c, 'banana')).toEqual([]);
    });

    it('skips pinned-section duplicates so a turn is not highlighted twice', () => {
        const c = container(
            '<div data-pinned-section><div data-turn-index="0">banana</div></div>' +
            '<div data-turn-index="0">banana</div>',
        );
        expect(buildHighlightRanges(c, 'banana').length).toBe(1);
    });

    it('treats a blank/whitespace query as no highlight', () => {
        const c = container('<div data-turn-index="0">banana</div>');
        expect(buildHighlightRanges(c, '   ')).toEqual([]);
    });
});

describe('isHighlightApiSupported / clearSearchHighlight', () => {
    it('detects the mocked CSS Custom Highlight API', () => {
        expect(isHighlightApiSupported()).toBe(true);
    });

    it('clearSearchHighlight deletes the registered highlight', () => {
        (globalThis as any).CSS.highlights.set(SEARCH_HIGHLIGHT_NAME, new MockHighlight());
        clearSearchHighlight();
        expect(highlightsDelete).toHaveBeenCalledWith(SEARCH_HIGHLIGHT_NAME);
    });
});

// ---------------------------------------------------------------------------
// Integration: ConversationArea + useConversationSearchHighlight
// ---------------------------------------------------------------------------
describe('ConversationArea search highlight (AC-04 / AC-05)', () => {
    it('AC-04: highlights every occurrence and scrolls the first into view', () => {
        const turnsRef = { current: null } as any;
        const turns = [makeTurn(0, 'I love banana bread'), makeTurn(1, 'banana banana')];
        render(
            <ConversationArea
                {...baseProps}
                turns={turns}
                turnsContainerRef={turnsRef}
                searchHighlightQuery="banana"
            />,
        );

        expect(highlightsSet).toHaveBeenCalledWith(SEARCH_HIGHLIGHT_NAME, expect.any(MockHighlight));
        const highlight = highlightsSet.mock.calls.at(-1)![1] as MockHighlight;
        expect(highlight.ranges.length).toBe(3); // 1 + 2 occurrences
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('does not highlight or scroll when there is no query', () => {
        const turnsRef = { current: null } as any;
        render(
            <ConversationArea
                {...baseProps}
                turns={[makeTurn(0, 'banana')]}
                turnsContainerRef={turnsRef}
                searchHighlightQuery=""
            />,
        );
        expect(highlightsSet).not.toHaveBeenCalled();
        expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('AC-05: clears the highlight when the query is emptied (search exit)', () => {
        const turnsRef = { current: null } as any;
        const turns = [makeTurn(0, 'banana')];
        const { rerender } = render(
            <ConversationArea
                {...baseProps}
                turns={turns}
                turnsContainerRef={turnsRef}
                searchHighlightQuery="banana"
            />,
        );
        expect(highlightsSet).toHaveBeenCalled();

        highlightsDelete.mockClear();
        rerender(
            <ConversationArea
                {...baseProps}
                turns={turns}
                turnsContainerRef={turnsRef}
                searchHighlightQuery=""
            />,
        );
        expect(highlightsDelete).toHaveBeenCalledWith(SEARCH_HIGHLIGHT_NAME);
    });

    it('AC-05: clears the highlight on unmount', () => {
        const turnsRef = { current: null } as any;
        const { unmount } = render(
            <ConversationArea
                {...baseProps}
                turns={[makeTurn(0, 'banana')]}
                turnsContainerRef={turnsRef}
                searchHighlightQuery="banana"
            />,
        );
        highlightsDelete.mockClear();
        unmount();
        expect(highlightsDelete).toHaveBeenCalledWith(SEARCH_HIGHLIGHT_NAME);
    });

    it('scrolls only once even as the query is refined within the same conversation', () => {
        const turnsRef = { current: null } as any;
        const turns = [makeTurn(0, 'banana bandana')];
        const { rerender } = render(
            <ConversationArea
                {...baseProps}
                turns={turns}
                turnsContainerRef={turnsRef}
                searchHighlightQuery="ban"
            />,
        );
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

        rerender(
            <ConversationArea
                {...baseProps}
                turns={turns}
                turnsContainerRef={turnsRef}
                searchHighlightQuery="banana"
            />,
        );
        // Still a single scroll — refining the query must not re-jump the view.
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });
});
