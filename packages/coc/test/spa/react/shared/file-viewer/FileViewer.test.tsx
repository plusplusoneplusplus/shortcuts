/**
 * Tests for the shared `FileViewer` — the branch it picks for a given blob.
 *
 * The host-facing behaviour of each branch is already covered by the two
 * panels' own suites (PreviewPane.*, SourceCanvasBody). What is only visible
 * here is the routing itself, and in particular that `markdown` defaults to
 * `'off'` — the default is what keeps the Explorer rendering `.md` in Monaco.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { FileViewer, formatFileSize } from '../../../../../src/server/spa/client/react/shared/file-viewer';

// jsdom cannot run Monaco; stand in an element that records the props.
vi.mock(
    '../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor',
    () => ({
        MonacoFileEditor: ({ value, language, readOnly }: any) => (
            <div
                data-testid="mock-monaco-editor"
                data-language={language}
                data-value={value}
                data-read-only={String(!!readOnly)}
            />
        ),
        getMonacoLanguage: (name: string) => (name.endsWith('.md') ? 'markdown' : 'plaintext'),
    }),
);

const text = (content: string) => ({ content, encoding: 'utf-8' as const, mimeType: 'text/plain' });

describe('FileViewer', () => {
    it('renders markdown in Monaco when the host does not opt in (the default)', () => {
        const { queryByTestId, getByTestId } = render(
            <FileViewer blob={text('# hi')} fileName="README.md" />,
        );
        expect(queryByTestId('source-canvas-markdown-view')).toBeNull();
        expect(getByTestId('mock-monaco-editor').getAttribute('data-language')).toBe('markdown');
    });

    it('renders markdown formatted when the host opts in', () => {
        const { getByTestId } = render(
            <FileViewer blob={text('# hi')} fileName="README.md" markdown="toggle" readOnly />,
        );
        expect(getByTestId('source-canvas-markdown-view')).toBeTruthy();
    });

    it('treats a server language hint of markdown as markdown', () => {
        const { getByTestId } = render(
            <FileViewer blob={text('# hi')} fileName="notes.txt" language="markdown" markdown="toggle" />,
        );
        expect(getByTestId('source-canvas-markdown-view')).toBeTruthy();
    });

    it('renders a base64 image blob as an img', () => {
        const { getByTestId } = render(
            <FileViewer
                blob={{ content: 'AAA', encoding: 'base64', mimeType: 'image/png' }}
                fileName="logo.png"
            />,
        );
        const img = getByTestId('preview-image').querySelector('img')!;
        expect(img.getAttribute('src')).toBe('data:image/png;base64,AAA');
        expect(img.getAttribute('alt')).toBe('logo.png');
    });

    it('renders a non-image base64 blob as the binary placeholder', () => {
        const { getByTestId } = render(
            <FileViewer
                blob={{ content: 'x'.repeat(2048), encoding: 'base64', mimeType: 'application/octet-stream' }}
                fileName="a.bin"
            />,
        );
        expect(getByTestId('preview-binary').textContent).toContain('2.0 KB');
    });

    it('puts the host-supplied test id on the Monaco container', () => {
        const { getByTestId } = render(
            <FileViewer blob={text('hi')} fileName="a.txt" codeTestId="monaco-container" />,
        );
        expect(getByTestId('monaco-container').querySelector('[data-testid="mock-monaco-editor"]')).toBeTruthy();
    });

    it('formats byte counts by magnitude', () => {
        expect(formatFileSize(512)).toBe('512 bytes');
        expect(formatFileSize(1536)).toBe('1.5 KB');
        expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
    });
});
