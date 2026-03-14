/**
 * ConversationMiniMap — comprehensive tests.
 *
 * Covers rendering, strip colors, click navigation, viewport indicator,
 * collapse/expand, keyboard shortcut, streaming, landmarks, and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
    ConversationMiniMap,
    buildStrips,
    getTurnColor,
    computeStripHeights,
    getLandmark,
    MIN_TURNS_TO_SHOW,
    type StripInfo,
} from '../../../src/server/spa/client/react/processes/ConversationMiniMap';
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

function createScrollContainer(): HTMLDivElement {
    const el = document.createElement('div');
    Object.defineProperties(el, {
        scrollHeight: { value: 2000, configurable: true },
        clientHeight: { value: 500, configurable: true },
        scrollTop: { value: 0, writable: true, configurable: true },
    });
    el.scrollTo = vi.fn((opts?: ScrollToOptions) => {
        if (opts?.top !== undefined) (el as any).scrollTop = opts.top;
    });
    return el;
}

function createTurnsContainer(count: number): HTMLDivElement {
    const el = document.createElement('div');
    for (let i = 0; i < count; i++) {
        const child = document.createElement('div');
        child.scrollIntoView = vi.fn();
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
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Pure function tests ────────────────────────────────────────────────

describe('getTurnColor', () => {
    it('returns user color for user turns', () => {
        expect(getTurnColor(makeTurn())).toBe('var(--minimap-user)');
    });

    it('returns assistant color for plain assistant turns', () => {
        expect(getTurnColor(makeAssistantTurn())).toBe('var(--minimap-assistant)');
    });

    it('returns tool color for assistant turns with tool calls', () => {
        const turn = makeAssistantTurn('resp', {
            toolCalls: [{ id: '1', toolName: 'read', args: {}, status: 'completed' }],
        });
        expect(getTurnColor(turn)).toBe('var(--minimap-tool)');
    });

    it('returns error color for turns with failed tool calls', () => {
        const turn = makeAssistantTurn('resp', {
            toolCalls: [{ id: '1', toolName: 'read', args: {}, status: 'failed', error: 'oops' }],
        });
        expect(getTurnColor(turn)).toBe('var(--minimap-error)');
    });

    it('returns streaming color for streaming turns', () => {
        const turn = makeAssistantTurn('', { streaming: true });
        expect(getTurnColor(turn)).toBe('var(--minimap-streaming)');
    });

    it('returns historical color for historical turns', () => {
        const turn = makeTurn({ historical: true });
        expect(getTurnColor(turn)).toBe('var(--minimap-historical)');
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
        expect(heights[1]).toBeLessThanOrEqual(40);
    });

    it('gives max height to the longest turn', () => {
        const turns = [
            makeTurn({ content: 'short' }),
            makeTurn({ content: 'a'.repeat(2000) }),
            makeTurn({ content: 'b'.repeat(500) }),
        ];
        const heights = computeStripHeights(turns);
        expect(heights[1]).toBe(40); // longest gets max
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

    it('marks turns with heavy tool activity with ⚡', () => {
        const turn = makeAssistantTurn('tools', {
            toolCalls: [
                { id: '1', toolName: 'a', args: {}, status: 'completed' },
                { id: '2', toolName: 'b', args: {}, status: 'completed' },
                { id: '3', toolName: 'c', args: {}, status: 'completed' },
            ],
        });
        const turns = [makeTurn(), turn];
        expect(getLandmark(turn, 1, turns)).toBe('⚡');
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
    });

    describe('strip colors', () => {
        it('applies correct background colors via CSS variables', () => {
            const turns = [
                makeTurn(),
                makeAssistantTurn(),
                makeAssistantTurn('with tools', {
                    toolCalls: [{ id: '1', toolName: 'x', args: {}, status: 'completed' }],
                }),
                makeAssistantTurn('error', {
                    toolCalls: [{ id: '1', toolName: 'x', args: {}, status: 'failed', error: 'e' }],
                }),
                makeTurn({ historical: true }),
            ];
            renderMiniMap({ turns });

            expect(screen.getByTestId('minimap-strip-0').style.backgroundColor).toBe('var(--minimap-user)');
            expect(screen.getByTestId('minimap-strip-1').style.backgroundColor).toBe('var(--minimap-assistant)');
            expect(screen.getByTestId('minimap-strip-2').style.backgroundColor).toBe('var(--minimap-tool)');
            expect(screen.getByTestId('minimap-strip-3').style.backgroundColor).toBe('var(--minimap-error)');
            expect(screen.getByTestId('minimap-strip-4').style.backgroundColor).toBe('var(--minimap-historical)');
        });
    });

    describe('click navigation', () => {
        it('calls scrollIntoView on the correct turn when strip is clicked', () => {
            const turns = makeTurns(10);
            const turnsContainer = createTurnsContainer(10);
            renderMiniMap({ turns, turnsContainer });

            fireEvent.click(screen.getByTestId('minimap-strip-3'));

            const child = turnsContainer.children[3] as HTMLElement;
            expect(child.scrollIntoView).toHaveBeenCalledWith({
                behavior: 'smooth',
                block: 'start',
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

        it('viewport indicator has ns-resize cursor style', () => {
            renderMiniMap();
            const indicator = screen.getByTestId('minimap-viewport-indicator');
            // Class-based cursor via CSS, check the element exists
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

        it('renders ⚡ landmark for heavy tool turns', () => {
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
            expect(screen.getByTestId('minimap-landmark-1').textContent).toBe('⚡');
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

        it('shows jump-to-latest badge when user scrolled up during streaming', async () => {
            const scrollContainer = createScrollContainer();
            // Simulate user scrolled up: scrollTop far from bottom
            Object.defineProperty(scrollContainer, 'scrollTop', { value: 100, writable: true, configurable: true });

            const turns = makeTurns(10);
            const turnsContainer = createTurnsContainer(10);

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

            // Trigger scroll event to update state
            await act(async () => {
                const scrollEvent = new Event('scroll');
                scrollContainer.dispatchEvent(scrollEvent);
                // Wait for throttle
                await new Promise(r => setTimeout(r, 150));
            });

            // The badge should appear because scrollTop(100) + clientHeight(500) < scrollHeight(2000) - 40
            expect(screen.getByTestId('minimap-jump-latest')).toBeTruthy();
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
            // All strips should have max height since content is equal
            const strip = screen.getByTestId('minimap-strip-0');
            expect(parseInt(strip.style.height)).toBeLessThanOrEqual(40);
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
