/**
 * Unit tests for the Help → "Report an Issue…" modal.
 *
 * Everything here is electron-free: the URL/body builders are pure, and the
 * interaction logic (`wireReportIssueModal`) is driven against a tiny fake DOM to
 * prove Submit/Cancel behaviour — Submit sends the trimmed title and description
 * body, an empty title disables Submit, Cancel/Escape cancel. The overflow path
 * is asserted to return the bare `issues/new` URL plus the full body, never a
 * truncated one.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    buildEnvironmentBlock,
    buildIssueBody,
    buildIssueUrl,
    renderReportIssueHtml,
    reportIssueDataUrl,
    wireReportIssueModal,
    REPORT_ISSUE_NEW_URL,
    REPORT_ISSUE_URL_MAX,
    REPORT_ISSUE_DESCRIPTION_MAX,
    REPORT_ISSUE_SCREENSHOT_PLACEHOLDER,
    REPORT_ISSUE_PUBLIC_NOTICE,
    REPORT_ISSUE_TITLE_ID,
    REPORT_ISSUE_DESCRIPTION_ID,
    REPORT_ISSUE_COUNTER_ID,
    REPORT_ISSUE_SUBMIT_ID,
    REPORT_ISSUE_CANCEL_ID,
    type ReportIssueDocument,
    type ReportIssueEnvironment,
    type ReportIssueEvent,
} from '../src/report-issue';

const ENV: ReportIssueEnvironment = {
    appVersion: '1.2.3',
    electronVersion: '31.0.0',
    nodeVersion: '20.11.1',
    platform: 'linux',
    release: '6.8.0-generic',
    arch: 'x64',
};

/** A minimal fake DOM element that records listeners and lets tests fire them. */
class FakeElement {
    value = '';
    disabled = false;
    textContent: string | null = null;
    focused = false;
    private listeners = new Map<string, Array<(event: ReportIssueEvent) => void>>();

    addEventListener(type: string, listener: (event: ReportIssueEvent) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
    }

    focus(): void {
        this.focused = true;
    }

    fire(type: string, event: ReportIssueEvent = {}): void {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
        }
    }
}

/** A fake `document` exposing the modal's elements by id. */
function makeDom(): {
    doc: ReportIssueDocument;
    title: FakeElement;
    description: FakeElement;
    counter: FakeElement;
    submit: FakeElement;
    cancel: FakeElement;
    fireDocument: (type: string, event?: ReportIssueEvent) => void;
} {
    const title = new FakeElement();
    const description = new FakeElement();
    const counter = new FakeElement();
    const submit = new FakeElement();
    const cancel = new FakeElement();
    const docListeners = new Map<string, Array<(event: ReportIssueEvent) => void>>();
    const byId: Record<string, FakeElement> = {
        [REPORT_ISSUE_TITLE_ID]: title,
        [REPORT_ISSUE_DESCRIPTION_ID]: description,
        [REPORT_ISSUE_COUNTER_ID]: counter,
        [REPORT_ISSUE_SUBMIT_ID]: submit,
        [REPORT_ISSUE_CANCEL_ID]: cancel,
    };
    const doc: ReportIssueDocument = {
        getElementById: (id: string) => byId[id] ?? null,
        addEventListener: (type, listener) => {
            const list = docListeners.get(type) ?? [];
            list.push(listener);
            docListeners.set(type, list);
        },
    };
    return {
        doc,
        title,
        description,
        counter,
        submit,
        cancel,
        fireDocument: (type, event = {}) => {
            for (const listener of docListeners.get(type) ?? []) {
                listener(event);
            }
        },
    };
}

function makeBridge() {
    return { submit: vi.fn(), cancel: vi.fn() };
}

describe('buildEnvironmentBlock', () => {
    it('lists exactly the injected versions, platform, release and arch', () => {
        const block = buildEnvironmentBlock(ENV);
        expect(block).toContain('### Environment');
        expect(block).toContain('- App version: 1.2.3');
        expect(block).toContain('- Electron: 31.0.0');
        expect(block).toContain('- Node: 20.11.1');
        expect(block).toContain('- OS: linux 6.8.0-generic');
        expect(block).toContain('- Arch: x64');
    });

    it('carries no paths, workspace names, or log text', () => {
        const block = buildEnvironmentBlock(ENV);
        expect(block).not.toMatch(/\/home\//);
        expect(block.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(5);
    });
});

describe('buildIssueBody', () => {
    it('includes the description, the screenshot placeholder, and the environment block', () => {
        const body = buildIssueBody('  it crashed on save  ', ENV);
        expect(body).toContain('it crashed on save');
        expect(body).toContain('### Screenshot');
        expect(body).toContain(REPORT_ISSUE_SCREENSHOT_PLACEHOLDER);
        expect(body).toContain('### Environment');
        expect(body).toContain('- App version: 1.2.3');
        // Description is trimmed, and the screenshot section comes before the
        // environment block.
        expect(body.indexOf('### Screenshot')).toBeLessThan(body.indexOf('### Environment'));
    });
});

describe('buildIssueUrl', () => {
    it('builds the prefilled new-issue URL with encoded title and body', () => {
        const result = buildIssueUrl({
            title: '  Crash on save  ',
            description: 'Steps & notes',
            environment: ENV,
        });
        expect(result.overflow).toBe(false);
        expect(result.url.startsWith(`${REPORT_ISSUE_NEW_URL}?`)).toBe(true);

        const parsed = new URL(result.url);
        expect(parsed.origin + parsed.pathname).toBe(REPORT_ISSUE_NEW_URL);
        expect(parsed.searchParams.get('title')).toBe('Crash on save');
        expect(parsed.searchParams.get('body')).toBe(result.body);
        expect(result.body).toContain('Steps & notes');
        // The raw query string is percent-encoded, not raw.
        expect(parsed.search).toContain('%23');
        expect(parsed.search).not.toContain('### Environment');
    });

    it('keeps a description at the soft cap inline (no overflow)', () => {
        const result = buildIssueUrl({
            title: 'Long but fine',
            description: 'a'.repeat(REPORT_ISSUE_DESCRIPTION_MAX),
            environment: ENV,
        });
        expect(result.overflow).toBe(false);
        expect(result.url.length).toBeLessThanOrEqual(REPORT_ISSUE_URL_MAX);
        expect(result.url).toContain('title=Long');
    });

    it('falls back to the bare issues/new URL and full body when the URL overflows', () => {
        const description = 'x'.repeat(9000);
        const result = buildIssueUrl({ title: 'Huge', description, environment: ENV });
        expect(result.overflow).toBe(true);
        expect(result.url).toBe(REPORT_ISSUE_NEW_URL);
        // Nothing is silently truncated — the clipboard payload is the full body.
        expect(result.body).toContain(description);
        expect(result.body).toContain('### Environment');
    });
});

describe('wireReportIssueModal', () => {
    it('disables Submit while the title is empty and enables it once typed', () => {
        const dom = makeDom();
        wireReportIssueModal(dom.doc, makeBridge());
        expect(dom.submit.disabled).toBe(true);

        dom.title.value = '   ';
        dom.title.fire('input');
        expect(dom.submit.disabled).toBe(true);

        dom.title.value = 'Crash';
        dom.title.fire('input');
        expect(dom.submit.disabled).toBe(false);
    });

    it('submits the trimmed title and description body on click', () => {
        const dom = makeDom();
        const bridge = makeBridge();
        wireReportIssueModal(dom.doc, bridge);

        dom.title.value = '  Crash on save  ';
        dom.description.value = '  it happens every time  ';
        dom.title.fire('input');
        dom.submit.fire('click');

        expect(bridge.submit).toHaveBeenCalledWith('Crash on save', 'it happens every time');
        expect(bridge.cancel).not.toHaveBeenCalled();
    });

    it('never submits while the title is empty', () => {
        const dom = makeDom();
        const bridge = makeBridge();
        wireReportIssueModal(dom.doc, bridge);

        dom.description.value = 'lots of detail';
        dom.submit.fire('click');
        expect(bridge.submit).not.toHaveBeenCalled();
    });

    it('allows an empty description', () => {
        const dom = makeDom();
        const bridge = makeBridge();
        wireReportIssueModal(dom.doc, bridge);

        dom.title.value = 'Only a title';
        dom.title.fire('input');
        dom.submit.fire('click');
        expect(bridge.submit).toHaveBeenCalledWith('Only a title', '');
    });

    it('submits on Enter in the title field but not in the description field', () => {
        const dom = makeDom();
        const bridge = makeBridge();
        wireReportIssueModal(dom.doc, bridge);

        dom.title.value = 'Enter submits';
        dom.title.fire('input');
        const preventDefault = vi.fn();
        dom.title.fire('keydown', { key: 'Enter', preventDefault });
        expect(preventDefault).toHaveBeenCalled();
        expect(bridge.submit).toHaveBeenCalledTimes(1);

        dom.description.fire('keydown', { key: 'Enter' });
        expect(bridge.submit).toHaveBeenCalledTimes(1);
    });

    it('cancels on the Cancel button and on Escape from either field', () => {
        const dom = makeDom();
        const bridge = makeBridge();
        wireReportIssueModal(dom.doc, bridge);

        dom.cancel.fire('click');
        expect(bridge.cancel).toHaveBeenCalledTimes(1);

        dom.title.fire('keydown', { key: 'Escape' });
        expect(bridge.cancel).toHaveBeenCalledTimes(2);

        dom.description.fire('keydown', { key: 'Escape' });
        expect(bridge.cancel).toHaveBeenCalledTimes(3);

        dom.fireDocument('keydown', { key: 'Escape' });
        expect(bridge.cancel).toHaveBeenCalledTimes(4);
        expect(bridge.submit).not.toHaveBeenCalled();
    });

    it('keeps the character counter in sync with the description', () => {
        const dom = makeDom();
        wireReportIssueModal(dom.doc, makeBridge());
        expect(dom.counter.textContent).toBe(`0 / ${REPORT_ISSUE_DESCRIPTION_MAX}`);

        dom.description.value = 'hello';
        dom.description.fire('input');
        expect(dom.counter.textContent).toBe(`5 / ${REPORT_ISSUE_DESCRIPTION_MAX}`);
    });

    it('focuses the title field and no-ops without a bridge', () => {
        const dom = makeDom();
        wireReportIssueModal(dom.doc, makeBridge());
        expect(dom.title.focused).toBe(true);

        const bare = makeDom();
        expect(() => wireReportIssueModal(bare.doc, null)).not.toThrow();
        expect(bare.title.focused).toBe(false);
    });
});

describe('renderReportIssueHtml', () => {
    it('renders the fields, the read-only environment preview, and the public notice', () => {
        const html = renderReportIssueHtml({ environment: ENV });
        expect(html).toContain(`id="${REPORT_ISSUE_TITLE_ID}"`);
        expect(html).toContain(`id="${REPORT_ISSUE_DESCRIPTION_ID}"`);
        expect(html).toContain(`id="${REPORT_ISSUE_COUNTER_ID}"`);
        expect(html).toContain(`id="${REPORT_ISSUE_SUBMIT_ID}"`);
        expect(html).toContain(`id="${REPORT_ISSUE_CANCEL_ID}"`);
        expect(html).toContain('- App version: 1.2.3');
        expect(html).toContain(REPORT_ISSUE_PUBLIC_NOTICE);
        // The wiring function is embedded verbatim — one source of truth.
        expect(html).toContain('wireReportIssueModal(document, bridge)');
        expect(html).toContain('window.cocDesktop.reportIssue');
    });

    it('HTML-escapes injected environment values', () => {
        const html = renderReportIssueHtml({
            environment: { ...ENV, release: '<script>alert(1)</script>' },
        });
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
});

describe('reportIssueDataUrl', () => {
    it('wraps the document in a loadable data: URL', () => {
        const url = reportIssueDataUrl({ environment: ENV });
        expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
        expect(decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length))).toBe(
            renderReportIssueHtml({ environment: ENV }),
        );
    });
});
