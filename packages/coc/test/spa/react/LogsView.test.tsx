/**
 * Tests for LogsView — SSE lifecycle, filtering, clear, pause/resume,
 * connection status, session filter, entry cap, and combined filter logic.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

import { LogsView } from '../../../src/server/spa/client/react/views/logs/LogsView';

// ── Types (mirror the component's internal LogEntry) ──────────────────────

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
    ts: string;
    level: LogLevel;
    component?: string;
    msg: string;
    [key: string]: unknown;
}

const BASE_TS = '2024-01-01T00:00:00.000Z';

// ── FakeEventSource ────────────────────────────────────────────────────────

class FakeEventSource extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;

    readyState = FakeEventSource.CONNECTING;
    url: string;
    withCredentials = false;
    onerror: ((e: Event) => void) | null = null;
    onopen: ((e: Event) => void) | null = null;
    closed = false;

    static instances: FakeEventSource[] = [];

    constructor(url: string) {
        super();
        this.url = url;
        FakeEventSource.instances.push(this);
    }

    close() {
        this.readyState = FakeEventSource.CLOSED;
        this.closed = true;
    }

    emitOpen() {
        this.readyState = FakeEventSource.OPEN;
        this.onopen?.(new Event('open'));
    }

    emitError() {
        this.onerror?.(new Event('error'));
    }

    emitHistory(entries: LogEntry[]) {
        const evt = Object.assign(new Event('history'), { data: JSON.stringify(entries) });
        this.dispatchEvent(evt);
    }

    emitLogEntry(entry: LogEntry) {
        const evt = Object.assign(new Event('log-entry'), { data: JSON.stringify(entry) });
        this.dispatchEvent(evt);
    }

    emitHeartbeat() {
        this.dispatchEvent(new Event('heartbeat'));
    }

    static latest(): FakeEventSource {
        return FakeEventSource.instances[FakeEventSource.instances.length - 1];
    }
}

// ── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as any).EventSource = FakeEventSource;
    location.hash = '';
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<LogEntry> & { msg: string }): LogEntry {
    return { ts: BASE_TS, level: 'info', ...overrides };
}

function getRows() {
    return document.querySelectorAll('[data-testid="log-row"]');
}

function getFooterText(): string {
    return document.querySelector('[data-testid="logs-view"] > div:last-child')?.textContent ?? '';
}

// ── SSE connection lifecycle ───────────────────────────────────────────────

describe('LogsView — SSE connection lifecycle', () => {
    it('opens EventSource on mount', () => {
        render(<LogsView />);
        expect(FakeEventSource.instances).toHaveLength(1);
    });

    it('connects to /api/logs/stream', () => {
        render(<LogsView />);
        expect(FakeEventSource.latest().url).toBe('/api/logs/stream');
    });

    it('closes EventSource on unmount', () => {
        const { unmount } = render(<LogsView />);
        const es = FakeEventSource.latest();
        expect(es.closed).toBe(false);
        unmount();
        expect(es.closed).toBe(true);
    });
});

// ── Incoming log events ────────────────────────────────────────────────────

describe('LogsView — incoming log events', () => {
    it('appends entries from history event', () => {
        render(<LogsView />);
        act(() => {
            FakeEventSource.latest().emitHistory([
                makeEntry({ msg: 'first' }),
                makeEntry({ msg: 'second' }),
            ]);
        });
        expect(getRows()).toHaveLength(2);
    });

    it('appends single entry from log-entry event', () => {
        render(<LogsView />);
        act(() => FakeEventSource.latest().emitLogEntry(makeEntry({ msg: 'live entry' })));
        const rows = getRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('live entry');
    });

    it('preserves order across multiple events', () => {
        render(<LogsView />);
        const es = FakeEventSource.latest();
        act(() => es.emitLogEntry(makeEntry({ msg: 'alpha' })));
        act(() => es.emitLogEntry(makeEntry({ msg: 'beta' })));
        act(() => es.emitLogEntry(makeEntry({ msg: 'gamma' })));
        const rows = getRows();
        expect(rows).toHaveLength(3);
        expect(rows[0].textContent).toContain('alpha');
        expect(rows[1].textContent).toContain('beta');
        expect(rows[2].textContent).toContain('gamma');
    });

    it('caps entries at 2000', () => {
        render(<LogsView />);
        const batch: LogEntry[] = Array.from({ length: 2100 }, (_, i) =>
            makeEntry({ msg: `e${i}` }),
        );
        act(() => FakeEventSource.latest().emitHistory(batch));
        const rows = getRows();
        expect(rows).toHaveLength(2000);
        // oldest 100 entries should be dropped
        expect(rows[0].textContent).toContain('e100');
        expect(rows[rows.length - 1].textContent).toContain('e2099');
    });

    it('combines history and live entries', () => {
        render(<LogsView />);
        const es = FakeEventSource.latest();
        act(() => es.emitHistory([makeEntry({ msg: 'hist' })]));
        act(() => es.emitLogEntry(makeEntry({ msg: 'live' })));
        const rows = getRows();
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('hist');
        expect(rows[1].textContent).toContain('live');
    });
});

// ── Level filter ───────────────────────────────────────────────────────────

describe('LogsView — level filter', () => {
    function seedAllLevels() {
        render(<LogsView />);
        act(() => {
            FakeEventSource.latest().emitHistory([
                makeEntry({ msg: 'trace-msg', level: 'trace' }),
                makeEntry({ msg: 'debug-msg', level: 'debug' }),
                makeEntry({ msg: 'info-msg', level: 'info' }),
                makeEntry({ msg: 'warn-msg', level: 'warn' }),
                makeEntry({ msg: 'error-msg', level: 'error' }),
            ]);
        });
    }

    it('shows all levels by default', () => {
        seedAllLevels();
        expect(getRows()).toHaveLength(5);
    });

    it('filters to debug+ (excludes trace)', () => {
        seedAllLevels();
        fireEvent.click(document.querySelector('[data-testid="level-filter-debug"]')!);
        const rows = getRows();
        expect(rows).toHaveLength(4);
        for (const row of rows) {
            expect(row.textContent).not.toContain('trace-msg');
        }
    });

    it('filters to info+', () => {
        seedAllLevels();
        fireEvent.click(document.querySelector('[data-testid="level-filter-info"]')!);
        const rows = getRows();
        expect(rows).toHaveLength(3);
        expect(rows[0].textContent).toContain('info-msg');
        expect(rows[1].textContent).toContain('warn-msg');
        expect(rows[2].textContent).toContain('error-msg');
    });

    it('filters to warn+', () => {
        seedAllLevels();
        fireEvent.click(document.querySelector('[data-testid="level-filter-warn"]')!);
        const rows = getRows();
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('warn-msg');
        expect(rows[1].textContent).toContain('error-msg');
    });

    it('filters to error+', () => {
        seedAllLevels();
        fireEvent.click(document.querySelector('[data-testid="level-filter-error"]')!);
        const rows = getRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('error-msg');
    });

    it('returns to all when All clicked after filtering', () => {
        seedAllLevels();
        fireEvent.click(document.querySelector('[data-testid="level-filter-error"]')!);
        expect(getRows()).toHaveLength(1);
        fireEvent.click(document.querySelector('[data-testid="level-filter-all"]')!);
        expect(getRows()).toHaveLength(5);
    });

    it('highlights active filter button', () => {
        seedAllLevels();
        const warnBtn = document.querySelector('[data-testid="level-filter-warn"]') as HTMLElement;
        fireEvent.click(warnBtn);
        expect(warnBtn.className).toContain('bg-[#0078d4]');
    });
});

// ── Search filter ──────────────────────────────────────────────────────────

describe('LogsView — search filter', () => {
    function seedAndSearch(query: string) {
        render(<LogsView />);
        act(() => {
            FakeEventSource.latest().emitHistory([
                makeEntry({ msg: 'server started', component: 'http' }),
                makeEntry({ msg: 'database connected', component: 'db' }),
                makeEntry({ msg: 'request handled', component: 'http' }),
            ]);
        });
        fireEvent.change(document.querySelector('[data-testid="log-search"]')!, {
            target: { value: query },
        });
    }

    it('filters by message text', () => {
        seedAndSearch('database');
        const rows = getRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('database connected');
    });

    it('filters by component text', () => {
        seedAndSearch('db');
        const rows = getRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('database connected');
    });

    it('is case-insensitive', () => {
        seedAndSearch('DATABASE');
        expect(getRows()).toHaveLength(1);
    });

    it('matches partial text', () => {
        seedAndSearch('server');
        const rows = getRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('server started');
    });

    it('shows all when search is cleared', () => {
        seedAndSearch('database');
        expect(getRows()).toHaveLength(1);
        fireEvent.change(document.querySelector('[data-testid="log-search"]')!, {
            target: { value: '' },
        });
        expect(getRows()).toHaveLength(3);
    });

    it('shows filter-empty message when no matches', () => {
        seedAndSearch('zzz-no-match');
        expect(getRows()).toHaveLength(0);
        const emptyState = document.querySelector('[data-testid="log-empty-state"]');
        expect(emptyState).not.toBeNull();
        expect(emptyState!.textContent).toContain('No entries match');
    });
});

// ── Clear ──────────────────────────────────────────────────────────────────

describe('LogsView — clear', () => {
    it('removes all entries', () => {
        render(<LogsView />);
        act(() => FakeEventSource.latest().emitHistory([makeEntry({ msg: 'hello' })]));
        expect(getRows()).toHaveLength(1);
        fireEvent.click(document.querySelector('[data-testid="clear-btn"]')!);
        expect(getRows()).toHaveLength(0);
    });

    it('does not close SSE connection', () => {
        render(<LogsView />);
        const es = FakeEventSource.latest();
        act(() => es.emitHistory([makeEntry({ msg: 'hello' })]));
        fireEvent.click(document.querySelector('[data-testid="clear-btn"]')!);
        expect(es.closed).toBe(false);
    });

    it('still receives new entries after clear', () => {
        render(<LogsView />);
        const es = FakeEventSource.latest();
        act(() => es.emitHistory([makeEntry({ msg: 'old' })]));
        fireEvent.click(document.querySelector('[data-testid="clear-btn"]')!);
        act(() => es.emitLogEntry(makeEntry({ msg: 'new' })));
        const rows = getRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('new');
    });
});

// ── Pause / Resume ─────────────────────────────────────────────────────────

describe('LogsView — pause/resume', () => {
    it('shows Pause button initially', () => {
        render(<LogsView />);
        const btn = document.querySelector('[data-testid="pause-btn"]')!;
        expect(btn.textContent).toContain('Pause');
    });

    it('toggles to Resume on click', () => {
        render(<LogsView />);
        const btn = document.querySelector('[data-testid="pause-btn"]')!;
        fireEvent.click(btn);
        expect(btn.textContent).toContain('Resume');
    });

    it('toggles back to Pause on second click', () => {
        render(<LogsView />);
        const btn = document.querySelector('[data-testid="pause-btn"]')!;
        fireEvent.click(btn);
        fireEvent.click(btn);
        expect(btn.textContent).toContain('Pause');
    });

    it('paused button has active styling', () => {
        render(<LogsView />);
        const btn = document.querySelector('[data-testid="pause-btn"]') as HTMLElement;
        fireEvent.click(btn);
        expect(btn.className).toContain('bg-[#0078d4]');
    });

    it('still appends entries when paused (auto-scroll stops, not ingestion)', () => {
        render(<LogsView />);
        fireEvent.click(document.querySelector('[data-testid="pause-btn"]')!);
        act(() => FakeEventSource.latest().emitLogEntry(makeEntry({ msg: 'while-paused' })));
        const rows = getRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('while-paused');
    });
});

// ── SSE connection status ──────────────────────────────────────────────────

describe('LogsView — SSE connection status', () => {
    it('shows Connecting on mount', () => {
        render(<LogsView />);
        const status = document.querySelector('[data-testid="sse-status"]')!;
        expect(status.textContent).toContain('Connecting');
    });

    it('shows Live after onopen fires', () => {
        render(<LogsView />);
        act(() => FakeEventSource.latest().emitOpen());
        const status = document.querySelector('[data-testid="sse-status"]')!;
        expect(status.textContent).toContain('Live');
    });

    it('shows Live after history event', () => {
        render(<LogsView />);
        act(() => FakeEventSource.latest().emitHistory([makeEntry({ msg: 'x' })]));
        const status = document.querySelector('[data-testid="sse-status"]')!;
        expect(status.textContent).toContain('Live');
    });

    it('shows Live after heartbeat', () => {
        render(<LogsView />);
        act(() => FakeEventSource.latest().emitHeartbeat());
        const status = document.querySelector('[data-testid="sse-status"]')!;
        expect(status.textContent).toContain('Live');
    });

    it('shows Disconnected after error', () => {
        vi.useFakeTimers();
        render(<LogsView />);
        act(() => FakeEventSource.latest().emitError());
        const status = document.querySelector('[data-testid="sse-status"]')!;
        expect(status.textContent).toContain('Disconnected');
    });

    it('reconnects 3 s after error', () => {
        vi.useFakeTimers();
        render(<LogsView />);
        const firstEs = FakeEventSource.latest();
        act(() => firstEs.emitError());
        expect(firstEs.closed).toBe(true);
        expect(FakeEventSource.instances).toHaveLength(1);

        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(FakeEventSource.instances).toHaveLength(2);
        expect(FakeEventSource.instances[1].closed).toBe(false);
    });

    it('new events work after reconnect', () => {
        vi.useFakeTimers();
        render(<LogsView />);
        act(() => FakeEventSource.latest().emitError());
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        const newEs = FakeEventSource.latest();
        act(() => newEs.emitLogEntry(makeEntry({ msg: 'post-reconnect' })));
        const rows = getRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('post-reconnect');
    });
});

// ── Entry count footer ─────────────────────────────────────────────────────

describe('LogsView — entry count footer', () => {
    it('shows entry count', () => {
        render(<LogsView />);
        act(() =>
            FakeEventSource.latest().emitHistory([
                makeEntry({ msg: 'a' }),
                makeEntry({ msg: 'b' }),
            ]),
        );
        expect(getFooterText()).toContain('2 entries shown');
    });

    it('uses singular "entry" for one entry', () => {
        render(<LogsView />);
        act(() => FakeEventSource.latest().emitLogEntry(makeEntry({ msg: 'only' })));
        expect(getFooterText()).toContain('1 entry shown');
    });

    it('shows total when filtered', () => {
        render(<LogsView />);
        act(() =>
            FakeEventSource.latest().emitHistory([
                makeEntry({ msg: 'info-msg', level: 'info' }),
                makeEntry({ msg: 'warn-msg', level: 'warn' }),
                makeEntry({ msg: 'error-msg', level: 'error' }),
            ]),
        );
        fireEvent.click(document.querySelector('[data-testid="level-filter-error"]')!);
        const footer = getFooterText();
        expect(footer).toContain('1 entry shown');
        expect(footer).toContain('3 total');
    });
});

// ── Session filter ─────────────────────────────────────────────────────────

describe('LogsView — session filter', () => {
    it('passes sessionId query param to SSE URL', () => {
        location.hash = '#logs?sessionId=abc123';
        render(<LogsView />);
        expect(FakeEventSource.latest().url).toContain('sessionId=abc123');
    });

    it('shows session filter chip when sessionId present', () => {
        location.hash = '#logs?sessionId=sess-xyz';
        render(<LogsView />);
        const chip = document.querySelector('[data-testid="session-filter-chip"]');
        expect(chip).not.toBeNull();
        expect(chip!.textContent).toContain('sess-xyz');
    });

    it('does not show chip when no sessionId', () => {
        location.hash = '#logs';
        render(<LogsView />);
        expect(document.querySelector('[data-testid="session-filter-chip"]')).toBeNull();
    });

    it('omits query param when no sessionId', () => {
        location.hash = '#logs';
        render(<LogsView />);
        expect(FakeEventSource.latest().url).toBe('/api/logs/stream');
    });
});

// ── Empty state ────────────────────────────────────────────────────────────

describe('LogsView — empty state', () => {
    it('shows no-entries message when no events received', () => {
        render(<LogsView />);
        const emptyState = document.querySelector('[data-testid="log-empty-state"]');
        expect(emptyState).not.toBeNull();
        expect(emptyState!.textContent).toContain('No log entries yet');
    });

    it('empty state disappears after receiving entries', () => {
        render(<LogsView />);
        expect(document.querySelector('[data-testid="log-empty-state"]')).not.toBeNull();
        act(() => FakeEventSource.latest().emitLogEntry(makeEntry({ msg: 'hello' })));
        expect(document.querySelector('[data-testid="log-empty-state"]')).toBeNull();
    });
});

// ── Combined filters ───────────────────────────────────────────────────────

describe('LogsView — combined filters', () => {
    it('applies both level and search filters simultaneously', () => {
        render(<LogsView />);
        act(() => {
            FakeEventSource.latest().emitHistory([
                makeEntry({ msg: 'trace request', level: 'trace' }),
                makeEntry({ msg: 'info request', level: 'info' }),
                makeEntry({ msg: 'warn request', level: 'warn' }),
                makeEntry({ msg: 'warn database', level: 'warn' }),
            ]);
        });
        fireEvent.click(document.querySelector('[data-testid="level-filter-warn"]')!);
        fireEvent.change(document.querySelector('[data-testid="log-search"]')!, {
            target: { value: 'request' },
        });
        const rows = getRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('warn request');
    });

    it('shows correct footer when both filters active', () => {
        render(<LogsView />);
        act(() => {
            FakeEventSource.latest().emitHistory([
                makeEntry({ msg: 'debug x', level: 'debug' }),
                makeEntry({ msg: 'info x', level: 'info' }),
                makeEntry({ msg: 'info y', level: 'info' }),
                makeEntry({ msg: 'error x', level: 'error' }),
            ]);
        });
        fireEvent.click(document.querySelector('[data-testid="level-filter-info"]')!);
        fireEvent.change(document.querySelector('[data-testid="log-search"]')!, {
            target: { value: 'x' },
        });
        const footer = getFooterText();
        // 2 entries match: "info x" and "error x" (both ≥ info level and contain "x")
        expect(footer).toContain('2 entries shown');
        expect(footer).toContain('4 total');
    });
});
