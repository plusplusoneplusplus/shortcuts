/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useMermaid', () => ({
    useMermaid: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/ExcalidrawPreview', () => ({
    ExcalidrawPreview: () => null,
}));

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
