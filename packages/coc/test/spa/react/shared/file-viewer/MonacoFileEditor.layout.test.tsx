// @vitest-environment jsdom
/**
 * MonacoFileEditor — who is allowed to size the editor.
 *
 * Regression cover for the Peek Definition preview collapsing to a strip. The
 * preview is an `EmbeddedCodeEditorWidget`, and Monaco builds those from
 * `parentEditor.getRawOptions()`; with `automaticLayout` on, the inherited size
 * observer fought the Peek widget's own `layout()` call over the same element
 * and won, leaving the preview shorter than the widget body with the revealed
 * definition scrolled out of sight.
 *
 * So the option must stay explicitly off — omitting it is not the same thing,
 * because `@monaco-editor/react` supplies `automaticLayout: true` itself — and
 * this editor must hand its own measurement to Monaco, since the library only
 * writes the width/height props onto its wrapper and never calls `layout()`.
 *
 * jsdom has no layout engine, so the wrapper's size is stubbed and the
 * ResizeObserver is driven by hand.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import {
    MonacoFileEditor,
    EXPLORER_EDITOR_OPTIONS,
} from '../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor';

const stub = vi.hoisted(() => ({
    options: undefined as Record<string, unknown> | undefined,
    editor: {
        layout: vi.fn(),
        getModel: () => null,
        onDidChangeModel: () => ({ dispose: () => {} }),
        createDecorationsCollection: vi.fn(() => ({ set: vi.fn(), clear: vi.fn() })),
        revealLineInCenter: vi.fn(),
        setPosition: vi.fn(),
        setSelection: vi.fn(),
        addAction: vi.fn(),
    },
    monaco: { editor: { setModelMarkers: vi.fn() }, KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } },
}));

vi.mock('@monaco-editor/react', () => ({
    default: ({ onMount, options }: any) => {
        stub.options = options;
        const mounted = (globalThis as any).__layoutMounted;
        if (!mounted) {
            (globalThis as any).__layoutMounted = true;
            queueMicrotask(() => onMount?.(stub.editor, stub.monaco));
        }
        return <div data-testid="fake-monaco" />;
    },
}));

vi.mock('../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

/** The size the stubbed wrapper reports, and the hook to re-report it. */
let wrapperSize = { width: 0, height: 0 };
let notifyResize: (() => void) | null = null;
let originalResizeObserver: typeof ResizeObserver;
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__layoutMounted = false;
    stub.options = undefined;
    wrapperSize = { width: 800, height: 600 };
    notifyResize = null;

    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
        constructor(private cb: () => void) {}
        observe() { notifyResize = () => this.cb(); }
        unobserve() {}
        disconnect() { notifyResize = null; }
    } as unknown as typeof ResizeObserver;

    Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
        return this.getAttribute('data-testid') === 'monaco-editor-wrapper'
            ? { ...wrapperSize, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
            : originalGetBoundingClientRect.call(this);
    };
});

afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

async function flushMount() {
    await act(async () => { await Promise.resolve(); });
}

describe('MonacoFileEditor — layout ownership', () => {
    it('keeps automaticLayout explicitly off so embedded editors do not inherit it', () => {
        // Stated, not omitted: `@monaco-editor/react` defaults it to true.
        expect(EXPLORER_EDITOR_OPTIONS.automaticLayout).toBe(false);
        expect('automaticLayout' in EXPLORER_EDITOR_OPTIONS).toBe(true);
    });

    it.each([
        ['editable', false],
        ['read-only', true],
    ])('passes automaticLayout: false to Monaco in the %s branch', async (_label, readOnly) => {
        render(<MonacoFileEditor value="a" language="typescript" readOnly={readOnly} />);
        await flushMount();

        expect(stub.options?.automaticLayout).toBe(false);
        expect(stub.options?.readOnly).toBe(readOnly);
    });

    it('lays the editor out from its own measurement once mounted', async () => {
        render(<MonacoFileEditor value="a" language="typescript" />);
        await flushMount();

        expect(stub.editor.layout).toHaveBeenCalledWith({ width: 800, height: 600 });
    });

    it('re-lays out when the wrapper resizes, which nothing else would do', async () => {
        render(<MonacoFileEditor value="a" language="typescript" />);
        await flushMount();
        stub.editor.layout.mockClear();

        wrapperSize = { width: 500, height: 320 };
        await act(async () => { notifyResize?.(); });

        expect(stub.editor.layout).toHaveBeenCalledWith({ width: 500, height: 320 });
    });

    it('does not re-lay out when a resize reports the same size', async () => {
        render(<MonacoFileEditor value="a" language="typescript" />);
        await flushMount();
        stub.editor.layout.mockClear();

        await act(async () => { notifyResize?.(); });

        expect(stub.editor.layout).not.toHaveBeenCalled();
    });
});
