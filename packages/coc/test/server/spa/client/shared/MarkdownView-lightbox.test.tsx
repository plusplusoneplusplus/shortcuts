/**
 * @vitest-environment jsdom
 *
 * AC-02: clicking an inline conversation image inside markdown-rendered
 * assistant content opens the shared ImageLightbox. Broken (`--error`) images
 * are ignored, and a linked image zooms rather than following its link.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useMermaid', () => ({
    useMermaid: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/ExcalidrawPreview', () => ({
    ExcalidrawPreview: () => null,
}));

import { MarkdownView } from '../../../../../src/server/spa/client/react/shared/MarkdownView';

const IMG_SRC = 'data:image/png;base64,aaaa';

afterEach(() => {
    cleanup();
});

describe('MarkdownView inline-image lightbox (AC-02)', () => {
    it('opens the lightbox with the image src when an inline image is clicked', () => {
        const { container } = render(
            <MarkdownView html={`<p><img src="${IMG_SRC}" class="chat-inline-image" alt="pic"></p>`} />,
        );
        expect(screen.queryByTestId('image-lightbox')).toBeNull();

        const img = container.querySelector('img.chat-inline-image') as HTMLImageElement;
        fireEvent.click(img);

        const lightbox = screen.getByTestId('image-lightbox');
        const lbImg = lightbox.querySelector('img') as HTMLImageElement;
        expect(lbImg.getAttribute('src')).toBe(IMG_SRC);
    });

    it('ignores a broken (--error) inline image click', () => {
        const { container } = render(
            <MarkdownView html={`<p><img class="chat-inline-image chat-inline-image--error" alt="broken"></p>`} />,
        );

        const img = container.querySelector('img.chat-inline-image') as HTMLImageElement;
        fireEvent.click(img);

        expect(screen.queryByTestId('image-lightbox')).toBeNull();
    });

    it('opens the lightbox (not the link) when a linked inline image is clicked', () => {
        const { container } = render(
            <MarkdownView
                html={`<p><a href="https://example.com/"><img src="${IMG_SRC}" class="chat-inline-image" alt="pic"></a></p>`}
            />,
        );

        const img = container.querySelector('img.chat-inline-image') as HTMLImageElement;
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        fireEvent(img, event);

        expect(event.defaultPrevented).toBe(true);
        expect(screen.getByTestId('image-lightbox')).toBeTruthy();
    });

    it('leaves a plain (non-inline) markdown image alone', () => {
        const { container } = render(
            <MarkdownView html={`<p><img src="${IMG_SRC}" class="some-other-image" alt="pic"></p>`} />,
        );

        const img = container.querySelector('img') as HTMLImageElement;
        fireEvent.click(img);

        expect(screen.queryByTestId('image-lightbox')).toBeNull();
    });
});
