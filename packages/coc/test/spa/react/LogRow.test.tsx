/**
 * Tests for LogRow — structured-field rendering in the Logs panel.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

import { LogsView } from '../../../src/server/spa/client/react/views/logs/LogsView';

afterEach(cleanup);

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

// ── Minimal EventSource stub ───────────────────────────────────────────────

class FakeEventSource extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    readyState = FakeEventSource.OPEN;
    url: string;
    withCredentials = false;
    onerror: ((e: Event) => void) | null = null;
    onopen: ((e: Event) => void) | null = null;

    constructor(url: string) {
        super();
        this.url = url;
        (globalThis as any).__lastFakeEventSource = this;
    }
    close() { this.readyState = FakeEventSource.CLOSED; }
}

beforeAll(() => {
    (globalThis as any).EventSource = FakeEventSource;
});

// ── Helper: inject history entries via the captured EventSource ───────────

function fireHistory(entries: LogEntry[]) {
    act(() => {
        const es = (globalThis as any).__lastFakeEventSource as FakeEventSource | undefined;
        if (!es) throw new Error('No FakeEventSource captured');
        const evt = Object.assign(new Event('history'), { data: JSON.stringify(entries) });
        es.dispatchEvent(evt);
    });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('LogRow — baseline (no extra fields)', () => {
    it('renders timestamp, level, component, and msg', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', component: 'server', msg: 'started' }]);

        const row = document.querySelector('[data-testid="log-row"]')!;
        expect(row).not.toBeNull();
        expect(row.textContent).toContain('started');
        expect(row.textContent).toContain('server');
        expect(row.textContent).toContain('info');
    });

    it('does not render any extra-field spans when entry has no extra fields', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'debug', msg: 'hello' }]);

        const row = document.querySelector('[data-testid="log-row"]')!;
        expect(row.querySelector('[data-testid="log-field-method"]')).toBeNull();
        expect(row.querySelector('[data-testid="log-field-path"]')).toBeNull();
        expect(row.querySelector('[data-testid="log-field-status"]')).toBeNull();
        expect(row.querySelector('[data-testid="log-field-duration"]')).toBeNull();
        expect(row.querySelector('[data-testid="log-expand-toggle"]')).toBeNull();
    });
});

describe('LogRow — request entries', () => {
    it('renders method badge', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'request', method: 'GET', path: '/api/processes', status: 200, durationMs: 14 }]);

        const el = document.querySelector('[data-testid="log-field-method"]');
        expect(el).not.toBeNull();
        expect(el!.textContent).toBe('GET');
    });

    it('renders path', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'request', method: 'GET', path: '/api/processes', status: 200, durationMs: 14 }]);

        const el = document.querySelector('[data-testid="log-field-path"]');
        expect(el).not.toBeNull();
        expect(el!.textContent).toBe('/api/processes');
    });

    it('renders status code', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'request', method: 'GET', path: '/api/x', status: 200, durationMs: 5 }]);

        const el = document.querySelector('[data-testid="log-field-status"]');
        expect(el).not.toBeNull();
        expect(el!.textContent).toBe('200');
    });

    it('renders durationMs as "Xms"', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'request', method: 'POST', path: '/api/run', status: 201, durationMs: 42 }]);

        const el = document.querySelector('[data-testid="log-field-duration"]');
        expect(el).not.toBeNull();
        expect(el!.textContent).toBe('42ms');
    });

    it('does not render expand toggle when entry has only known fields', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'request', method: 'GET', path: '/api/x', status: 200, durationMs: 3 }]);

        expect(document.querySelector('[data-testid="log-expand-toggle"]')).toBeNull();
    });
});

describe('LogRow — API mutation entries', () => {
    it('renders method badge', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'API mutation', method: 'DELETE', resource: 'process', id: 'abc123' }]);

        const el = document.querySelector('[data-testid="log-field-method"]');
        expect(el).not.toBeNull();
        expect(el!.textContent).toBe('DELETE');
    });

    it('renders resource', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'API mutation', method: 'POST', resource: 'process', id: 'xyz' }]);

        const el = document.querySelector('[data-testid="log-field-resource"]');
        expect(el).not.toBeNull();
        expect(el!.textContent).toBe('process');
    });

    it('renders id', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'API mutation', method: 'PATCH', resource: 'process', id: 'pid-99' }]);

        const el = document.querySelector('[data-testid="log-field-id"]');
        expect(el).not.toBeNull();
        expect(el!.textContent).toBe('pid-99');
    });

    it('skips id span when id is absent', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'API mutation', method: 'POST', resource: 'run' }]);

        expect(document.querySelector('[data-testid="log-field-id"]')).toBeNull();
    });
});

describe('LogRow — expand/collapse for unknown fields', () => {
    it('shows expand toggle when entry has unknown extra fields', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'warn', msg: 'something', customField: 'hello' }]);

        expect(document.querySelector('[data-testid="log-expand-toggle"]')).not.toBeNull();
    });

    it('detail sub-row is hidden before expanding', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'warn', msg: 'something', customField: 'hello' }]);

        expect(document.querySelector('[data-testid="log-row-details"]')).toBeNull();
    });

    it('clicking toggle shows detail sub-row with key and value', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'warn', msg: 'something', customField: 'hello' }]);

        fireEvent.click(document.querySelector('[data-testid="log-expand-toggle"]')!);
        const details = document.querySelector('[data-testid="log-row-details"]');
        expect(details).not.toBeNull();
        expect(details!.textContent).toContain('customField');
        expect(details!.textContent).toContain('"hello"');
    });

    it('clicking toggle again collapses detail sub-row', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'warn', msg: 'something', customField: 'hello' }]);

        const toggle = document.querySelector('[data-testid="log-expand-toggle"]')!;
        fireEvent.click(toggle);
        expect(document.querySelector('[data-testid="log-row-details"]')).not.toBeNull();

        fireEvent.click(toggle);
        expect(document.querySelector('[data-testid="log-row-details"]')).toBeNull();
    });

    it('known fields do not appear in the detail sub-row', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'request', method: 'GET', path: '/x', status: 200, durationMs: 1, extra: 'boom' }]);

        fireEvent.click(document.querySelector('[data-testid="log-expand-toggle"]')!);
        const details = document.querySelector('[data-testid="log-row-details"]')!;
        expect(details.textContent).toContain('extra');
        expect(details.textContent).not.toContain('method');
        expect(details.textContent).not.toContain('path');
        expect(details.textContent).not.toContain('status');
        expect(details.textContent).not.toContain('durationMs');
    });
});

describe('LogRow — status color coding', () => {
    it('2xx status gets green class', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'request', method: 'GET', path: '/x', status: 200, durationMs: 1 }]);

        const el = document.querySelector('[data-testid="log-field-status"]') as HTMLElement;
        expect(el.className).toContain('text-[#16825d]');
    });

    it('4xx status gets amber class', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'warn', msg: 'request', method: 'GET', path: '/x', status: 404, durationMs: 2 }]);

        const el = document.querySelector('[data-testid="log-field-status"]') as HTMLElement;
        expect(el.className).toContain('text-[#a07500]');
    });

    it('5xx status gets red class', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'error', msg: 'request', method: 'POST', path: '/y', status: 500, durationMs: 3 }]);

        const el = document.querySelector('[data-testid="log-field-status"]') as HTMLElement;
        expect(el.className).toContain('text-[#f14c4c]');
    });
});

describe('LogRow — method badge color coding', () => {
    it('GET uses blue badge', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'request', method: 'GET', path: '/a', status: 200, durationMs: 1 }]);

        const el = document.querySelector('[data-testid="log-field-method"]') as HTMLElement;
        expect(el.className).toContain('text-[#0078d4]');
    });

    it('POST uses green badge', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'API mutation', method: 'POST', resource: 'run' }]);

        const el = document.querySelector('[data-testid="log-field-method"]') as HTMLElement;
        expect(el.className).toContain('text-[#16825d]');
    });

    it('DELETE uses red badge', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'API mutation', method: 'DELETE', resource: 'proc', id: '1' }]);

        const el = document.querySelector('[data-testid="log-field-method"]') as HTMLElement;
        expect(el.className).toContain('text-[#f14c4c]');
    });

    it('PATCH uses amber badge', () => {
        render(<LogsView />);
        fireHistory([{ ts: BASE_TS, level: 'info', msg: 'API mutation', method: 'PATCH', resource: 'x' }]);

        const el = document.querySelector('[data-testid="log-field-method"]') as HTMLElement;
        expect(el.className).toContain('text-[#a07500]');
    });
});
