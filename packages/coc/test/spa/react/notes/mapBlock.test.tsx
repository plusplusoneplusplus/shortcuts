import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@tiptap/core', () => ({
    Node: { create: (config: unknown) => config },
}));

vi.mock('@tiptap/react', () => ({
    NodeViewWrapper: ({
        children,
        ...props
    }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
    ReactNodeViewRenderer: (component: unknown) => component,
}));

import { MapBlock } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/mapBlock';

const mapUrl = 'https://www.google.com/maps/embed?pb=!1m18!1m12';

type ExtensionConfig = {
    parseHTML(): Array<{ tag: string; getAttrs: (el: HTMLElement) => false | { url: string; label: string } }>;
    renderHTML(args: { node: { attrs: { url: string; label: string; indent?: number } } }): unknown[];
};

type NodeViewConfig = ExtensionConfig & {
    addNodeView(): React.FC<any>;
};

const config = MapBlock as unknown as ExtensionConfig;
const nodeViewConfig = MapBlock as unknown as NodeViewConfig;
const MapBlockView = nodeViewConfig.addNodeView() as React.FC<any>;

function makeProps(url = mapUrl, label = 'Lake Chelan', updateAttributes = vi.fn()) {
    return { node: { attrs: { url, label } }, updateAttributes } as any;
}

describe('MapBlock parseHTML', () => {
    it('matches allowlisted map placeholders and extracts attrs', () => {
        const div = document.createElement('div');
        div.className = 'md-map-embed';
        div.setAttribute('data-map-url', mapUrl);
        div.setAttribute('data-map-label', 'Lake Chelan');

        const [rule] = config.parseHTML();
        expect(rule.tag).toBe('div.md-map-embed');
        expect(rule.getAttrs(div)).toEqual({ url: mapUrl, label: 'Lake Chelan' });
    });

    it('rejects non-allowlisted map placeholders', () => {
        const div = document.createElement('div');
        div.className = 'md-map-embed';
        div.setAttribute('data-map-url', 'https://maps.app.goo.gl/example');

        const [rule] = config.parseHTML();
        expect(rule.getAttrs(div)).toBe(false);
    });
});

describe('MapBlock renderHTML', () => {
    it('round-trips to the markdown renderer placeholder structure (no data-indent at level 0)', () => {
        const result = config.renderHTML({ node: { attrs: { url: mapUrl, label: 'Lake Chelan' } } });
        expect(result).toEqual([
            'div',
            {
                class: 'md-map-embed',
                'data-map-url': mapUrl,
                'data-map-label': 'Lake Chelan',
            },
        ]);
    });

    it('adds data-indent to the placeholder for an indented map', () => {
        const result = config.renderHTML({ node: { attrs: { url: mapUrl, label: 'Lake Chelan', indent: 4 } } });
        expect(result).toEqual([
            'div',
            {
                class: 'md-map-embed',
                'data-map-url': mapUrl,
                'data-map-label': 'Lake Chelan',
                'data-indent': '4',
            },
        ]);
    });
});

describe('MapBlockView', () => {
    beforeEach(() => {
        vi.stubGlobal('open', vi.fn());
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('renders a sandboxed map iframe in preview mode', () => {
        render(<MapBlockView {...makeProps()} />);

        const iframe = document.querySelector('iframe')!;
        expect(iframe).toBeTruthy();
        expect(iframe.getAttribute('src')).toBe(mapUrl);
        expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
        expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer-when-downgrade');
    });

    it('opens the current URL from the toolbar button', () => {
        render(<MapBlockView {...makeProps()} />);

        screen.getByRole('button', { name: 'Open' }).click();

        expect(window.open).toHaveBeenCalledWith(mapUrl, '_blank', 'noopener,noreferrer');
    });

    it('toggles to source mode and updates the URL attr', () => {
        const updateAttributes = vi.fn();
        render(<MapBlockView {...makeProps(mapUrl, 'Lake Chelan', updateAttributes)} />);

        fireEvent.click(screen.getByRole('button', { name: 'Source' }));
        const input = screen.getByLabelText('Google Maps embed URL') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'https://maps.google.com/maps?q=Leavenworth&output=embed' } });

        expect(updateAttributes).toHaveBeenCalledWith({
            url: 'https://maps.google.com/maps?q=Leavenworth&output=embed',
        });
    });

    it('shows an error instead of an iframe for invalid source URLs', () => {
        render(<MapBlockView {...makeProps('https://maps.app.goo.gl/example')} />);

        expect(document.querySelector('iframe')).toBeNull();
        expect(screen.getByText('Unsupported Google Maps embed URL')).toBeTruthy();
    });
});
