import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const { browserPageScript } = createRequire(import.meta.url)('./e2e/browser-engine-page.cjs') as { browserPageScript: string };

function pageFixture(cookieAuthenticated?: boolean) {
    const reports: Record<string, unknown>[] = [];
    const events = new Map<string, () => void>();
    let poll!: () => Promise<void>;
    let command = '';
    const input = { value: '/', focus: vi.fn(() => { document.activeElement = input; }) };
    const document = {
        cookie: '', title: 'Home', activeElement: null as unknown,
        hasFocus: () => true,
        getElementById: () => input,
        addEventListener: (event: string, handler: () => void) => events.set(event, handler),
    };
    runInNewContext(browserPageScript, {
        URL, document,
        location: { href: 'http://localhost/?tab=main' },
        localStorage: { getItem: () => null },
        window: { cookieAuthenticated, addEventListener: (event: string, handler: () => void) => events.set(event, handler) },
        setInterval: (handler: () => Promise<void>) => { poll = handler; },
        fetch: async (_url: string, options?: { body: string }) => {
            if (options) reports.push(JSON.parse(options.body));
            return { text: async () => command };
        },
    });
    return {
        reports, events, document, input,
        async focusInput() { command = 'focus-input'; await poll(); },
        async updateTitle() { command = 'title'; await poll(); },
    };
}

describe('Live browser page focus reports', () => {
    it.each([true, false, undefined])('reports cookie authentication %s while retaining actual focus state', async cookieAuthenticated => {
        const page = pageFixture(cookieAuthenticated);
        expect(page.reports.at(-1)).toMatchObject({ authenticated: cookieAuthenticated === true, inputFocused: false });
        await page.focusInput();
        page.events.get('focus')!();
        expect(page.reports.at(-1)).toMatchObject({ authenticated: cookieAuthenticated === true, inputFocused: true, focusEvent: true });
    });

    it('reports history title changes while preserving authentication and input focus', async () => {
        const page = pageFixture(true);
        await page.focusInput();
        await page.updateTitle();
        expect(page.document.title).toBe('Updated page');
        expect(page.reports.at(-1)).toMatchObject({ title: 'Updated page', authenticated: true, inputFocused: true });
    });

    it('retains actual input focus when a window focus report overwrites the command report', async () => {
        const page = pageFixture();
        await page.focusInput();
        expect(page.reports.at(-1)).toMatchObject({ inputFocused: true });
        page.events.get('focus')!();
        expect(page.reports.at(-1)).toMatchObject({ focused: true, inputFocused: true, focusEvent: true });
        page.events.get('input')!();
        expect(page.reports.at(-1)).toMatchObject({ inputFocused: true, input: '/' });
    });

    it('reports loss of input focus instead of keeping a stale acknowledgement', async () => {
        const page = pageFixture();
        await page.focusInput();
        page.document.activeElement = {};
        page.events.get('focus')!();
        expect(page.reports.at(-1)).toMatchObject({ focused: true, inputFocused: false });
    });

    it('does not acknowledge a focus command that fails to focus the input', async () => {
        const page = pageFixture();
        page.input.focus.mockImplementation(() => {});
        await page.focusInput();
        expect(page.reports.at(-1)).toMatchObject({ inputFocused: false });
    });
});
