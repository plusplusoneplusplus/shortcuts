/**
 * Tests for SourceCanvasPanel — the docked read-only viewer chrome (AC-02).
 * Covers the header (file name + full path), close (X), copy-path, and
 * reveal-in-explorer actions.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const { revealMock, writeTextMock } = vi.hoisted(() => ({
    revealMock: vi.fn(() => Promise.resolve()),
    writeTextMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ explorer: { reveal: revealMock } }),
}));

import { SourceCanvasPanel } from '../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasPanel';

beforeEach(() => {
    revealMock.mockClear();
    writeTextMock.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: writeTextMock },
    });
});

describe('SourceCanvasPanel', () => {
    const fileRef = { fullPath: '/home/u/proj/src/foo.ts', line: 42 };

    it('renders the file name and full path in the header', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={() => {}} />,
        );
        expect(getByTestId('source-canvas-filename').textContent).toBe('foo.ts');
        expect(getByTestId('source-canvas-path').textContent).toBe('/home/u/proj/src/foo.ts');
    });

    it('prefers displayPath when provided', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel
                fileRef={{ fullPath: '/abs/proj/src/foo.ts', displayPath: 'src/foo.ts' }}
                wsId="ws1"
                onClose={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-filename').textContent).toBe('foo.ts');
        expect(getByTestId('source-canvas-path').textContent).toBe('src/foo.ts');
    });

    it('close button invokes onClose', () => {
        const onClose = vi.fn();
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={onClose} />,
        );
        fireEvent.click(getByTestId('source-canvas-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('copy button writes the bare full path to the clipboard', async () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={() => {}} />,
        );
        fireEvent.click(getByTestId('source-canvas-copy-btn'));
        await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith('/home/u/proj/src/foo.ts'));
    });

    it('reveal button calls explorer.reveal with workspace id and bare path', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={() => {}} />,
        );
        fireEvent.click(getByTestId('source-canvas-reveal-btn'));
        expect(revealMock).toHaveBeenCalledWith('ws1', '/home/u/proj/src/foo.ts');
    });

    it('reveal button is disabled (and no-ops) without a workspace id', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId={null} onClose={() => {}} />,
        );
        const btn = getByTestId('source-canvas-reveal-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        fireEvent.click(btn);
        expect(revealMock).not.toHaveBeenCalled();
    });

    // --- AC-06: body load/error/success states ---

    it('shows the loading state when no content is provided', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel fileRef={fileRef} wsId="ws1" onClose={() => {}} />,
        );
        expect(getByTestId('source-canvas-loading')).toBeTruthy();
    });

    it('shows the loading state for content status "loading"', () => {
        const { getByTestId } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                content={{ status: 'loading', content: '', language: '', resolvedPath: '', error: '' }}
                onClose={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-loading')).toBeTruthy();
    });

    it('renders an error with the attempted path and reason', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                content={{
                    status: 'error',
                    content: '',
                    language: '',
                    resolvedPath: '/home/u/proj/src/foo.ts',
                    error: 'No workspace available',
                }}
                onClose={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-error-msg').textContent).toBe(
            "Couldn't load /home/u/proj/src/foo.ts",
        );
        expect(getByTestId('source-canvas-error').textContent).toContain('No workspace available');
        expect(queryByTestId('source-canvas-loading')).toBeNull();
        expect(queryByTestId('source-canvas-source')).toBeNull();
    });

    it('renders the loaded source content on success', () => {
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasPanel
                fileRef={fileRef}
                wsId="ws1"
                content={{
                    status: 'success',
                    content: 'const x = 1;\n',
                    language: 'typescript',
                    resolvedPath: '/home/u/proj/src/foo.ts',
                    error: '',
                }}
                onClose={() => {}}
            />,
        );
        expect(getByTestId('source-canvas-source').textContent).toBe('const x = 1;\n');
        expect(queryByTestId('source-canvas-loading')).toBeNull();
        expect(queryByTestId('source-canvas-error')).toBeNull();
    });
});
