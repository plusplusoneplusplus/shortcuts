/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useMermaid', () => ({
    useMermaid: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/ExcalidrawPreview', () => ({
    ExcalidrawPreview: () => null,
}));

import { screen } from '@testing-library/react';
import { MarkdownView } from '../../../../../src/server/spa/client/react/shared/MarkdownView';

function clickLink(name: string): MouseEvent {
    const link = screen.getByRole('link', { name });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    return event;
}

describe('MarkdownView process deep-links', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/');
    });

    afterEach(() => {
        cleanup();
        window.history.replaceState(null, '', '/');
    });

    it.each([
        ['#/process/queue_123', 'Process chat'],
        ['#/session/session_456', 'Session chat'],
        ['#/processes/process_789', 'Processes chat'],
    ])('intercepts %s and updates the current hash', (href, label) => {
        render(<MarkdownView html={`<p><a href="${href}">${label}</a></p>`} />);

        const event = clickLink(label);

        expect(event.defaultPrevented).toBe(true);
        expect(window.location.hash).toBe(href);
    });

    it('prevents default but does not rewrite the hash when the target is already current', () => {
        window.location.hash = '#/process/current';
        render(<MarkdownView html='<p><a href="#/process/current">Current chat</a></p>' />);

        const event = clickLink('Current chat');

        expect(event.defaultPrevented).toBe(true);
        expect(window.location.hash).toBe('#/process/current');
    });

    it.each([
        ['#/wiki/page-1', 'Wiki page'],
        ['#/process', 'Missing process id'],
        ['https://example.com/process/abc', 'External link'],
    ])('leaves non-process links alone: %s', (href, label) => {
        render(<MarkdownView html={`<p><a href="${href}">${label}</a></p>`} />);

        const event = clickLink(label);

        expect(event.defaultPrevented).toBe(false);
        expect(window.location.hash).toBe('');
    });
});

// Helper: build the HTML that chatMarkdownToHtml emits for an svg fence.
function svgFenceHtml(svgSource: string): string {
    const escaped = svgSource.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return (
        '<div class="md-svg-fence" data-fence-id="md-svg-1">' +
        '<pre class="md-svg-source" style="display:none"><code>' +
        escaped +
        '</code></pre></div>'
    );
}

describe('MarkdownView SVG fence hydration (AC-04)', () => {
    afterEach(() => {
        cleanup();
    });

    it('mounts a sanitized SVG inside a shadow root for a valid svg fence', () => {
        const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="blue"/></svg>';
        const { container } = render(<MarkdownView html={svgFenceHtml(source)} />);

        const fence = container.querySelector('.md-svg-fence');
        expect(fence).toBeTruthy();
        expect(fence?.getAttribute('data-svg-ready')).toBe('1');

        const host = fence?.querySelector('.md-svg-fence-host') as Element | null;
        expect(host).toBeTruthy();
        expect(host?.shadowRoot?.querySelector('svg')).toBeTruthy();
    });

    it('strips <script> from the rendered SVG inside the shadow root', () => {
        const source = '<svg xmlns="http://www.w3.org/2000/svg"><script>steal()</script><rect width="10" height="10"/></svg>';
        const { container } = render(<MarkdownView html={svgFenceHtml(source)} />);

        const host = container.querySelector('.md-svg-fence-host') as HTMLElement | null;
        expect(host?.shadowRoot?.querySelector('script')).toBeNull();
        expect(host?.shadowRoot?.querySelector('svg')).toBeTruthy();
    });

    it('strips onload event handlers from the rendered SVG', () => {
        const source = '<svg xmlns="http://www.w3.org/2000/svg" onload="steal()"><rect onclick="steal()" width="10" height="10"/></svg>';
        const { container } = render(<MarkdownView html={svgFenceHtml(source)} />);

        const svgEl = container.querySelector('.md-svg-fence-host')?.shadowRoot?.querySelector('svg');
        expect(svgEl?.hasAttribute('onload')).toBe(false);
    });

    it('shows an inline error and escaped source fallback for malformed SVG (AC-06)', () => {
        const badSource = 'not svg at all <<<';
        const { container } = render(<MarkdownView html={svgFenceHtml(badSource)} />);

        const shadow = container.querySelector('.md-svg-fence-host')?.shadowRoot;
        expect(shadow?.querySelector('.md-svg-error')?.textContent).toContain('Invalid SVG');
        expect(shadow?.querySelector('.md-svg-source-fallback')?.textContent).toBe(badSource);
        expect(shadow?.querySelector('svg')).toBeNull();
    });

    it('does not hydrate elements without the md-svg-fence class', () => {
        const { container } = render(<MarkdownView html='<div class="other-fence"><pre class="md-svg-source" style="display:none"><code>&lt;svg&gt;&lt;/svg&gt;</code></pre></div>' />);

        const other = container.querySelector('.other-fence') as HTMLElement | null;
        expect(other?.querySelector('.md-svg-fence-host')).toBeNull();
    });
});
