/**
 * ConversationMiniMap — comprehensive tests.
 *
 * Covers rendering, strip colors, click navigation, viewport indicator,
 * collapse/expand, keyboard shortcut, streaming, landmarks, and edge cases.
 *
 * Updated for the `coc-conversation-redesign-3` look-and-feel:
 *   - 7 strip kinds (user / assistant / whisper / agent / error / pinned / historical)
 *     plus a streaming overlay (CSS class).
 *   - Active strip tracked from scroll position.
 *   - Click navigation uses scroll-container math (no scrollIntoView).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
    ConversationMiniMap,
    buildStrips,
    getTurnColor,
    getTurnKind,
    computeStripHeights,
    getLandmark,
    MIN_TURNS_TO_SHOW,
    type StripInfo,
} from '../../../src/server/spa/client/react/features/chat/conversation/ConversationMiniMap';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

// ── Helpers ────────────────────────────────────────────────────────────

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'user',
        content: 'Hello world',
        timeline: [],
        ...overrides,
    };
}

function makeAssistantTurn(content = 'Response text', overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content,
        timeline: [],
        ...overrides,
    };
}

function makeTurns(count: number): ClientConversationTurn[] {
    const turns: ClientConversationTurn[] = [];
    for (let i = 0; i < count; i++) {
        turns.push(i % 2 === 0
            ? makeTurn({ content: `User message ${i}` })
            : makeAssistantTurn(`Assistant response ${i}`)
        );
    }
    return turns;
}

/**
 * Mock scroll container with predictable rect/scroll geometry. Children of the
 * turns container get realistic getBoundingClientRect values so the active-
 * strip probe + click-to-scroll math can run end-to-end.
 */
function createScrollContainer(): HTMLDivElement {
    const el = document.createElement('div');
    Object.defineProperties(el, {
        scrollHeight: { value: 2000, configurable: true },
        clientHeight: { value: 500, configurable: true },
        scrollTop: { value: 0, writable: true, configurable: true },
    });
    el.getBoundingClientRect = vi.fn(() => ({
        top: 0, left: 0, right: 500, bottom: 500, width: 500, height: 500, x: 0, y: 0, toJSON() { return {}; },
    } as DOMRect));
    el.scrollTo = vi.fn((opts?: ScrollToOptions) => {
        if (opts?.top !== undefined) (el as any).scrollTop = opts.top;
    });
    return el;
}

function createTurnsContainer(count: number): HTMLDivElement {
    const el = document.createElement('div');
    for (let i = 0; i < count; i++) {
        const child = document.createElement('div');
        // Each child is 80px tall, stacked from the top. The mock returns rects
        // relative to the (fake) scroll container origin (top=0).
        const top = i * 80;
        child.getBoundingClientRect = vi.fn(() => ({
            top, left: 0, right: 500, bottom: top + 80, width: 500, height: 80, x: 0, y: top, toJSON() { return {}; },
        } as DOMRect));
        el.appendChild(child);
    }
    return el;
}

interface RenderMiniMapOptions {
    turns?: ClientConversationTurn[];
    isStreaming?: boolean;
    scrollContainer?: HTMLDivElement;
    turnsContainer?: HTMLDivElement;
}

function renderMiniMap(options: RenderMiniMapOptions = {}) {
    const turns = options.turns ?? makeTurns(10);
    const scrollContainer = options.scrollContainer ?? createScrollContainer();
    const turnsContainer = options.turnsContainer ?? createTurnsContainer(turns.length);

    const scrollRef = { current: scrollContainer };
    const turnsRef = { current: turnsContainer };

    const result = render(
        <ConversationMiniMap
            turns={turns}
            scrollContainerRef={scrollRef}
            turnsContainerRef={turnsRef}
            isStreaming={options.isStreaming ?? false}
        />
    );

    return { ...result, scrollContainer, turnsContainer, scrollRef, turnsRef };
}

// ── Mocks ──────────────────────────────────────────────────────────────

let matchMediaListeners: Array<(e: MediaQueryListEvent) => void> = [];

beforeEach(() => {
    matchMediaListeners = [];
    window.matchMedia = vi.fn().mockImplementation((_query: string) => ({
        matches: false,
        addEventListener: vi.fn((_: string, cb: (e: MediaQueryListEvent) => void) => {
            matchMediaListeners.push(cb);
        }),
        removeEventListener: vi.fn(),
    }));
    // jsdom doesn't implement rAF the way the browser does — proxy to
    // setTimeout so updates flush synchronously inside `act`.
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        return window.setTimeout(() => cb(performance.now()), 0);
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Pure function tests ────────────────────────────────────────────────

describe('getTurnKind / getTurnColor', () => {
    it('returns "user" for user turns', () => {
        expect(getTurnKind(makeTurn())).toBe('user');
        expect(getTurnColor(makeTurn())).toBe('var(--minimap-user)');
    });

    it('returns "assistant" for plain assistant turns', () => {
        expect(getTurnKind(makeAssistantTurn())).toBe('assistant');
        expect(getTurnColor(makeAssistantTurn())).toBe('var(--minimap-assistant)');
    });

    it('returns "agent" for assistant turns that dispatch a sub-agent', () => {
        const turn = makeAssistantTurn('resp', {
            toolCalls: [{ id: '1', toolName: 'read_agent', args: { agent_id: 'x' }, status: 'completed' }],
        });
        expect(getTurnKind(turn)).toBe('agent');
        expect(getTurnColor(turn)).toBe('var(--minimap-agent)');
    });

    it('returns "agent" for `task` tool calls too (alias)', () => {
        const turn = makeAssistantTurn('resp', {
            toolCalls: [{ id: '1', toolName: 'task', args: {}, status: 'completed' }],
        });
        expect(getTurnKind(turn)).toBe('agent');
    });

    it('returns "whisper" for assistant turns with heavy plain-tool activity', () => {
        const turn = makeAssistantTurn('resp', {
            toolCalls: [
                { id: '1', toolName: 'read', args: {}, status: 'completed' },
                { id: '2', toolName: 'grep', args: {}, status: 'completed' },
                { id: '3', toolName: 'edit', args: {}, status: 'completed' },
            ],
        });
        expect(getTurnKind(turn)).toBe('whisper');
        expect(getTurnColor(turn)).toBe('var(--minimap-whisper)');
    });

    it('returns "assistant" when there are only a couple of tool calls', () => {
        const turn = makeAssistantTurn('resp', {
            toolCalls: [
                { id: '1', toolName: 'read', args: {}, status: 'completed' },
                { id: '2', toolName: 'grep', args: {}, status: 'completed' },
            ],
        });
        expect(getTurnKind(turn)).toBe('assistant');
    });

    it('returns "error" for turns with failed tool calls', () => {
        const turn = makeAssistantTurn('resp', {
            toolCalls: [{ id: '1', toolName: 'read', args: {}, status: 'failed', error: 'oops' }],
        });
        expect(getTurnKind(turn)).toBe('error');
        expect(getTurnColor(turn)).toBe('var(--minimap-error)');
    });

    it('returns "error" when isError is set even without tool calls', () => {
        const turn = makeAssistantTurn('boom', { isError: true });
        expect(getTurnKind(turn)).toBe('error');
    });

    it('returns "streaming" for streaming turns (highest priority)', () => {
        const turn = makeAssistantTurn('', { streaming: true, isError: true });
        expect(getTurnKind(turn)).toBe('streaming');
        expect(getTurnColor(turn)).toBe('var(--minimap-streaming)');
    });

    it('returns "pinned" for pinned turns (regardless of role)', () => {
        const pinnedUser = makeTurn({ pinnedAt: '2026-05-10T10:00:00Z' });
        const pinnedAssistant = makeAssistantTurn('hi', { pinnedAt: '2026-05-10T10:00:00Z' });
        expect(getTurnKind(pinnedUser)).toBe('pinned');
        expect(getTurnKind(pinnedAssistant)).toBe('pinned');
    });

    it('returns "historical" for historical turns', () => {
        expect(getTurnKind(makeTurn({ historical: true }))).toBe('historical');
        expect(getTurnColor(makeTurn({ historical: true }))).toBe('var(--minimap-historical)');
    });

    it('priority: streaming > error > pinned > historical > user/assistant', () => {
        expect(getTurnKind(makeTurn({ streaming: true, isError: true, pinnedAt: '1', historical: true }))).toBe('streaming');
        expect(getTurnKind(makeTurn({ isError: true, pinnedAt: '1', historical: true }))).toBe('error');
        expect(getTurnKind(makeTurn({ pinnedAt: '1', historical: true }))).toBe('pinned');
        expect(getTurnKind(makeTurn({ historical: true }))).toBe('historical');
    });
});

describe('computeStripHeights', () => {
    it('returns empty array for empty turns', () => {
        expect(computeStripHeights([])).toEqual([]);
    });

    it('returns heights between min and max', () => {
        const turns = [
            makeTurn({ content: 'short' }),
            makeTurn({ content: 'a'.repeat(1000) }),
        ];
        const heights = computeStripHeights(turns);
        expect(heights.length).toBe(2);
        expect(heights[0]).toBeGreaterThanOrEqual(4);
        expect(heights[1]).toBeLessThanOrEqual(60);
    });

    it('gives max height to the longest turn', () => {
        const turns = [
            makeTurn({ content: 'short' }),
            makeTurn({ content: 'a'.repeat(2000) }),
            makeTurn({ content: 'b'.repeat(500) }),
        ];
        const heights = computeStripHeights(turns);
        expect(heights[1]).toBe(60); // longest gets max
    });
});

describe('getLandmark', () => {
    it('marks first user message with ▶', () => {
        const turns = [makeTurn(), makeAssistantTurn()];
        expect(getLandmark(turns[0], 0, turns)).toBe('▶');
    });

    it('does not mark second user message as first', () => {
        const turns = [makeTurn(), makeAssistantTurn(), makeTurn()];
        expect(getLandmark(turns[2], 2, turns)).toBeNull();
    });

    it('marks turns with failed tool calls with ⚠', () => {
        const turn = makeAssistantTurn('err', {
            toolCalls: [{ id: '1', toolName: 'x', args: {}, status: 'failed', error: 'e' }],
        });
        const turns = [makeTurn(), turn];
        expect(getLandmark(turn, 1, turns)).toBe('⚠');
    });

    it('marks streaming turns with ●', () => {
        const turn = makeAssistantTurn('', { streaming: true });
        const turns = [makeTurn(), turn];
        expect(getLandmark(turn, 1, turns)).toBe('●');
    });

    it('marks pinned turns with 📌', () => {
        const turn = makeAssistantTurn('hi', { pinnedAt: '2026-05-10T10:00:00Z' });
        const turns = [makeTurn(), turn];
        expect(getLandmark(turn, 1, turns)).toBe('📌');
    });

    it('marks sub-agent turns with 🤖', () => {
        const turn = makeAssistantTurn('dispatched', {
            toolCalls: [{ id: '1', toolName: 'read_agent', args: { agent_id: 'a' }, status: 'completed' }],
        });
        const turns = [makeTurn(), turn];
        expect(getLandmark(turn, 1, turns)).toBe('🤖');
    });

    it('marks whisper (heavy tools) turns with 🔇', () => {
        const turn = makeAssistantTurn('tools', {
            toolCalls: [
                { id: '1', toolName: 'a', args: {}, status: 'completed' },
                { id: '2', toolName: 'b', args: {}, status: 'completed' },
                { id: '3', toolName: 'c', args: {}, status: 'completed' },
            ],
        });
        const turns = [makeTurn(), turn];
        expect(getLandmark(turn, 1, turns)).toBe('🔇');
    });

    it('returns null for plain turns', () => {
        const turns = [makeTurn(), makeAssistantTurn()];
        expect(getLandmark(turns[1], 1, turns)).toBeNull();
    });
});

describe('buildStrips', () => {
    it('creates one strip per turn', () => {
        const turns = makeTurns(6);
        const strips = buildStrips(turns);
        expect(strips.length).toBe(6);
    });

    it('assigns correct role labels', () => {
        const turns = [makeTurn(), makeAssistantTurn()];
        const strips = buildStrips(turns);
        expect(strips[0].tooltipRole).toBe('User');
        expect(strips[1].tooltipRole).toBe('Assistant');
    });

    it('truncates tooltip preview to 60 chars', () => {
        const turn = makeTurn({ content: 'a'.repeat(100) });
        const strips = buildStrips([turn]);
        expect(strips[0].tooltipPreview.length).toBe(60);
    });

    it('exposes kind on each strip', () => {
        const turns = [
            makeTurn(),
            makeAssistantTurn(),
            makeAssistantTurn('hi', { pinnedAt: '1' }),
        ];
        const strips = buildStrips(turns);
        expect(strips[0].kind).toBe('user');
        expect(strips[1].kind).toBe('assistant');
        expect(strips[2].kind).toBe('pinned');
    });
});

// ── Component rendering tests ──────────────────────────────────────────

describe('ConversationMiniMap', () => {
    describe('visibility', () => {
        it('renders nothing when turns < MIN_TURNS_TO_SHOW', () => {
            renderMiniMap({ turns: makeTurns(3) });
            expect(screen.queryByTestId('minimap-panel')).toBeNull();
        });

        it('renders panel when turns >= MIN_TURNS_TO_SHOW', () => {
            renderMiniMap({ turns: makeTurns(MIN_TURNS_TO_SHOW) });
            expect(screen.getByTestId('minimap-panel')).toBeTruthy();
        });

        it('renders correct number of strips', () => {
            renderMiniMap({ turns: makeTurns(8) });
            for (let i = 0; i < 8; i++) {
                expect(screen.getByTestId(`minimap-strip-${i}`)).toBeTruthy();
            }
        });

        it('renders the panel at the compact half-width', () => {
            renderMiniMap({ turns: makeTurns(MIN_TURNS_TO_SHOW) });
            const panel = screen.getByTestId('minimap-panel') as HTMLElement;
            expect(panel.style.width).toBe('28px');
        });
    });

    describe('strip colors', () => {
        it('applies the correct kind class and inline background per strip', () => {
            const turns = [
                makeTurn(),
                makeAssistantTurn(),
                makeAssistantTurn('with sub-agent', {
                    toolCalls: [{ id: '1', toolName: 'read_agent', args: { agent_id: 'a' }, status: 'completed' }],
                }),
                makeAssistantTurn('error', {
                    toolCalls: [{ id: '1', toolName: 'x', args: {}, status: 'failed', error: 'e' }],
                }),
                makeTurn({ historical: true }),
                makeAssistantTurn('pinned', { pinnedAt: '2026-05-10T10:00:00Z' }),
            ];
            renderMiniMap({ turns });

            const strip0 = screen.getByTestId('minimap-strip-0');
            const strip1 = screen.getByTestId('minimap-strip-1');
            const strip2 = screen.getByTestId('minimap-strip-2');
            const strip3 = screen.getByTestId('minimap-strip-3');
            const strip4 = screen.getByTestId('minimap-strip-4');
            const strip5 = screen.getByTestId('minimap-strip-5');

            expect(strip0.dataset.kind).toBe('user');
            expect(strip0.style.backgroundColor).toBe('var(--minimap-user)');
            expect(strip0.className).toContain('minimap-strip-user');

            expect(strip1.dataset.kind).toBe('assistant');
            expect(strip1.style.backgroundColor).toBe('var(--minimap-assistant)');

            expect(strip2.dataset.kind).toBe('agent');
            expect(strip2.style.backgroundColor).toBe('var(--minimap-agent)');
            expect(strip2.className).toContain('minimap-strip-agent');

            expect(strip3.dataset.kind).toBe('error');
            expect(strip3.style.backgroundColor).toBe('var(--minimap-error)');

            expect(strip4.dataset.kind).toBe('historical');
            expect(strip4.style.backgroundColor).toBe('var(--minimap-historical)');

            expect(strip5.dataset.kind).toBe('pinned');
            expect(strip5.style.backgroundColor).toBe('var(--minimap-pinned)');
            expect(strip5.className).toContain('minimap-strip-pinned');
        });

        it('streaming strip uses the streaming class with no inline background', () => {
            const turns = [
                ...makeTurns(4),
                makeAssistantTurn('', { streaming: true }),
            ];
            renderMiniMap({ turns, isStreaming: true });
            const last = screen.getByTestId(`minimap-strip-${turns.length - 1}`);
            expect(last.className).toContain('minimap-strip-streaming');
            // No inline backgroundColor — the class supplies the animated gradient
            expect(last.style.backgroundColor).toBe('');
        });
    });

    describe('click navigation', () => {
        it('scrolls the conversation container to the target turn (top - 14)', () => {
            const turns = makeTurns(10);
            const scrollContainer = createScrollContainer();
            const turnsContainer = createTurnsContainer(10);
            renderMiniMap({ turns, scrollContainer, turnsContainer });

            fireEvent.click(screen.getByTestId('minimap-strip-3'));

            // Child 3 sits at top=240; container at top=0; scrollTop=0; offset=14
            expect(scrollContainer.scrollTo).toHaveBeenCalledWith({
                top: 240 - 14,
                behavior: 'smooth',
            });
        });

        it('adds highlight pulse class on click', () => {
            const turns = makeTurns(10);
            const turnsContainer = createTurnsContainer(10);
            renderMiniMap({ turns, turnsContainer });

            fireEvent.click(screen.getByTestId('minimap-strip-5'));

            const child = turnsContainer.children[5] as HTMLElement;
            expect(child.classList.contains('minimap-highlight-pulse')).toBe(true);
        });
    });

    describe('collapse and expand', () => {
        it('collapses when collapse button is clicked', () => {
            renderMiniMap();
            expect(screen.getByTestId('minimap-panel')).toBeTruthy();

            fireEvent.click(screen.getByTestId('minimap-collapse-btn'));

            expect(screen.queryByTestId('minimap-panel')).toBeNull();
            expect(screen.getByTestId('minimap-collapsed')).toBeTruthy();
        });

        it('expands when collapsed strip is clicked', () => {
            renderMiniMap();
            fireEvent.click(screen.getByTestId('minimap-collapse-btn'));
            expect(screen.getByTestId('minimap-collapsed')).toBeTruthy();

            fireEvent.click(screen.getByTestId('minimap-collapsed'));

            expect(screen.getByTestId('minimap-panel')).toBeTruthy();
        });
    });

    describe('keyboard shortcut', () => {
        it('toggles collapse on Alt+M', () => {
            renderMiniMap();
            expect(screen.getByTestId('minimap-panel')).toBeTruthy();

            // Collapse
            fireEvent.keyDown(document, { key: 'm', code: 'KeyM', altKey: true });
            expect(screen.queryByTestId('minimap-panel')).toBeNull();
            expect(screen.getByTestId('minimap-collapsed')).toBeTruthy();

            // Expand via macOS Option+M (e.key is a Unicode char, e.code is reliable)
            fireEvent.keyDown(document, { key: 'µ', code: 'KeyM', altKey: true });
            expect(screen.getByTestId('minimap-panel')).toBeTruthy();
        });

        it('does not toggle without Alt key', () => {
            renderMiniMap();
            fireEvent.keyDown(document, { key: 'm', code: 'KeyM', altKey: false });
            expect(screen.getByTestId('minimap-panel')).toBeTruthy();
        });
    });

    describe('viewport indicator', () => {
        it('renders viewport indicator', () => {
            renderMiniMap();
            expect(screen.getByTestId('minimap-viewport-indicator')).toBeTruthy();
        });

        it('viewport indicator carries the canonical class', () => {
            renderMiniMap();
            const indicator = screen.getByTestId('minimap-viewport-indicator');
            expect(indicator.className).toContain('minimap-viewport-indicator');
        });
    });

    describe('landmarks', () => {
        it('renders landmark markers for first user message', () => {
            const turns = makeTurns(6);
            renderMiniMap({ turns });
            expect(screen.getByTestId('minimap-landmark-0')).toBeTruthy();
            expect(screen.getByTestId('minimap-landmark-0').textContent).toBe('▶');
        });

        it('renders ⚠ landmark for error turns', () => {
            const turns = [
                makeTurn(),
                makeAssistantTurn('err', {
                    toolCalls: [{ id: '1', toolName: 'x', args: {}, status: 'failed', error: 'e' }],
                }),
                ...makeTurns(4),
            ];
            renderMiniMap({ turns });
            expect(screen.getByTestId('minimap-landmark-1').textContent).toBe('⚠');
        });

        it('renders 🔇 landmark for whisper (heavy-tool) turns', () => {
            const turns = [
                makeTurn(),
                makeAssistantTurn('tools', {
                    toolCalls: [
                        { id: '1', toolName: 'a', args: {}, status: 'completed' },
                        { id: '2', toolName: 'b', args: {}, status: 'completed' },
                        { id: '3', toolName: 'c', args: {}, status: 'completed' },
                    ],
                }),
                ...makeTurns(4),
            ];
            renderMiniMap({ turns });
            expect(screen.getByTestId('minimap-landmark-1').textContent).toBe('🔇');
        });

        it('renders 🤖 landmark for sub-agent turns', () => {
            const turns = [
                makeTurn(),
                makeAssistantTurn('dispatch', {
                    toolCalls: [{ id: '1', toolName: 'read_agent', args: { agent_id: 'x' }, status: 'completed' }],
                }),
                ...makeTurns(4),
            ];
            renderMiniMap({ turns });
            expect(screen.getByTestId('minimap-landmark-1').textContent).toBe('🤖');
        });

        it('renders 📌 landmark for pinned turns', () => {
            const turns = [
                makeTurn(),
                makeAssistantTurn('pinned', { pinnedAt: '2026-05-10T10:00:00Z' }),
                ...makeTurns(4),
            ];
            renderMiniMap({ turns });
            expect(screen.getByTestId('minimap-landmark-1').textContent).toBe('📌');
        });
    });

    describe('streaming', () => {
        it('shows streaming class on streaming turns', () => {
            const turns = [
                ...makeTurns(4),
                makeAssistantTurn('', { streaming: true }),
            ];
            renderMiniMap({ turns, isStreaming: true });

            const lastStrip = screen.getByTestId(`minimap-strip-${turns.length - 1}`);
            expect(lastStrip.className).toContain('minimap-strip-streaming');
        });

        it('shows Latest ↓ jump badge when a streaming strip exists and user scrolled up', async () => {
            const scrollContainer = createScrollContainer();
            // Simulate user scrolled up: scrollTop far from bottom
            Object.defineProperty(scrollContainer, 'scrollTop', { value: 100, writable: true, configurable: true });

            const turns = [
                ...makeTurns(9),
                makeAssistantTurn('', { streaming: true }),
            ];
            const turnsContainer = createTurnsContainer(turns.length);

            const scrollRef = { current: scrollContainer };
            const turnsRef = { current: turnsContainer };

            render(
                <ConversationMiniMap
                    turns={turns}
                    scrollContainerRef={scrollRef}
                    turnsContainerRef={turnsRef}
                    isStreaming={true}
                />
            );

            // Trigger scroll event to update state through rAF
            await act(async () => {
                const scrollEvent = new Event('scroll');
                scrollContainer.dispatchEvent(scrollEvent);
                // Wait for the rAF-via-setTimeout shim to flush
                await new Promise(r => setTimeout(r, 10));
            });

            const badge = screen.getByTestId('minimap-jump-latest');
            expect(badge).toBeTruthy();
            expect(badge.textContent).toBe('Latest ↓');
        });

        it('hides Latest ↓ badge when no streaming strip exists', async () => {
            const scrollContainer = createScrollContainer();
            Object.defineProperty(scrollContainer, 'scrollTop', { value: 100, writable: true, configurable: true });

            renderMiniMap({ turns: makeTurns(10), scrollContainer, isStreaming: true });

            await act(async () => {
                const scrollEvent = new Event('scroll');
                scrollContainer.dispatchEvent(scrollEvent);
                await new Promise(r => setTimeout(r, 10));
            });

            expect(screen.queryByTestId('minimap-jump-latest')).toBeNull();
        });
    });

    describe('active strip', () => {
        it('marks the strip nearest the probe line as active and sets aria-current', async () => {
            const scrollContainer = createScrollContainer();
            // scrollTop=0, clientHeight=500 → probe = 500 * 0.28 = 140.
            // Children sit at top=0,80,160,... → indices with offset <= 140 are 0, 1.
            // Active index should be the LAST one above the probe: 1.
            const turns = makeTurns(10);
            const turnsContainer = createTurnsContainer(turns.length);
            const scrollRef = { current: scrollContainer };
            const turnsRef = { current: turnsContainer };

            render(
                <ConversationMiniMap
                    turns={turns}
                    scrollContainerRef={scrollRef}
                    turnsContainerRef={turnsRef}
                />
            );

            await act(async () => {
                const scrollEvent = new Event('scroll');
                scrollContainer.dispatchEvent(scrollEvent);
                await new Promise(r => setTimeout(r, 10));
            });

            const strip1 = screen.getByTestId('minimap-strip-1');
            expect(strip1.className).toContain('active');
            expect(strip1.getAttribute('aria-current')).toBe('location');

            const strip2 = screen.getByTestId('minimap-strip-2');
            expect(strip2.className).not.toContain('active');
            expect(strip2.getAttribute('aria-current')).toBeNull();
        });
    });

    describe('tooltip', () => {
        it('shows tooltip on mouse enter and hides on mouse leave', () => {
            renderMiniMap();
            const strip = screen.getByTestId('minimap-strip-0');

            fireEvent.mouseEnter(strip, { clientX: 100, clientY: 100 });
            expect(screen.getByTestId('minimap-tooltip')).toBeTruthy();

            fireEvent.mouseLeave(strip);
            expect(screen.queryByTestId('minimap-tooltip')).toBeNull();
        });

        it('tooltip shows role and turn number', () => {
            renderMiniMap();
            const strip = screen.getByTestId('minimap-strip-0');

            fireEvent.mouseEnter(strip, { clientX: 100, clientY: 100 });
            const tooltip = screen.getByTestId('minimap-tooltip');
            expect(tooltip.textContent).toContain('User');
            expect(tooltip.textContent).toContain('Turn 1');
        });

        it('tooltip left position is clamped to stay within viewport', () => {
            Object.defineProperty(window, 'innerWidth', { value: 400, writable: true, configurable: true });
            renderMiniMap();
            const strip = screen.getByTestId('minimap-strip-0');

            fireEvent.mouseEnter(strip, { clientX: 1200, clientY: 100 });
            const tooltip = screen.getByTestId('minimap-tooltip');
            const left = parseFloat(tooltip.style.left as string);
            // Default width = 220, margin = 8 → upper bound = 400 - 220 - 8 = 172
            expect(left).toBeLessThanOrEqual(172);
        });

        it('tooltip left position has a minimum margin', () => {
            renderMiniMap();
            const strip = screen.getByTestId('minimap-strip-0');

            // clientX near 0 — left would be -ve without clamp; min is TOOLTIP_MARGIN (8)
            fireEvent.mouseEnter(strip, { clientX: 0, clientY: 100 });
            const tooltip = screen.getByTestId('minimap-tooltip');
            const left = parseFloat(tooltip.style.left as string);
            expect(left).toBeGreaterThanOrEqual(8);
        });

        it('tooltip top is clamped to stay within viewport height', () => {
            Object.defineProperty(window, 'innerHeight', { value: 400, writable: true, configurable: true });
            renderMiniMap();
            const strip = screen.getByTestId('minimap-strip-0');

            fireEvent.mouseEnter(strip, { clientX: 100, clientY: 10000 });
            const tooltip = screen.getByTestId('minimap-tooltip');
            const top = parseFloat(tooltip.style.top as string);
            // Default height = 56, margin = 8 → upper bound = 400 - 56 - 8 = 336
            expect(top).toBeLessThanOrEqual(336);
            expect(top).toBeGreaterThanOrEqual(8);
        });

        it('tooltip has max-w class to prevent overflow on narrow screens', () => {
            renderMiniMap();
            const strip = screen.getByTestId('minimap-strip-0');
            fireEvent.mouseEnter(strip, { clientX: 100, clientY: 100 });
            const tooltip = screen.getByTestId('minimap-tooltip');
            expect(tooltip.className).toContain('max-w-[calc(100vw-16px)]');
        });
    });

    describe('edge cases', () => {
        it('handles empty turns array', () => {
            renderMiniMap({ turns: [] });
            expect(screen.queryByTestId('minimap-panel')).toBeNull();
        });

        it('handles single turn', () => {
            renderMiniMap({ turns: [makeTurn()] });
            expect(screen.queryByTestId('minimap-panel')).toBeNull();
        });

        it('handles turns with empty content', () => {
            const turns = Array.from({ length: 6 }, () => makeTurn({ content: '' }));
            renderMiniMap({ turns });
            expect(screen.getByTestId('minimap-panel')).toBeTruthy();
        });

        it('handles turns with very long content', () => {
            const turns = Array.from({ length: 6 }, () =>
                makeTurn({ content: 'x'.repeat(100000) })
            );
            renderMiniMap({ turns });
            expect(screen.getByTestId('minimap-panel')).toBeTruthy();
            const strip = screen.getByTestId('minimap-strip-0');
            expect(parseInt(strip.style.height)).toBeLessThanOrEqual(60);
        });
    });

    describe('responsive collapse', () => {
        it('auto-collapses on narrow viewport via matchMedia', () => {
            // Override matchMedia to report narrow viewport
            window.matchMedia = vi.fn().mockImplementation((_query: string) => ({
                matches: true, // narrow viewport
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));

            renderMiniMap();
            expect(screen.queryByTestId('minimap-panel')).toBeNull();
            expect(screen.getByTestId('minimap-collapsed')).toBeTruthy();
        });
    });
});
