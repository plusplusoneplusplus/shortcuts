import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    handleNoteZoomKey,
    type NoteZoomKeyActions,
    type NoteZoomKeyEvent,
} from '../../../../../src/server/spa/client/react/features/notes/editor/noteZoomKeyboard';

/**
 * AC-04 — Cmd/Ctrl `=`/`-`/`0` zoom shortcuts.
 *
 * The behaviour lives in the pure `handleNoteZoomKey` helper (unit-tested here),
 * which `NoteEditor` wires onto its note-editor container so the shortcuts only
 * fire while the note editor is focused. A source-mirror check confirms that
 * wiring (the full `NoteEditor` is too heavy to render in this suite).
 */

function makeActions(): NoteZoomKeyActions & {
    zoomIn: ReturnType<typeof vi.fn>;
    zoomOut: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
} {
    return { zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn() };
}

function evt(partial: Partial<NoteZoomKeyEvent>): NoteZoomKeyEvent & { preventDefault: ReturnType<typeof vi.fn> } {
    return {
        key: '',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        preventDefault: vi.fn(),
        ...partial,
    };
}

describe('handleNoteZoomKey (AC-04)', () => {
    for (const mod of ['metaKey', 'ctrlKey'] as const) {
        describe(`with ${mod}`, () => {
            it('zooms in on `=` and `+`, preventing the browser page-zoom', () => {
                for (const key of ['=', '+']) {
                    const actions = makeActions();
                    const e = evt({ key, [mod]: true });
                    expect(handleNoteZoomKey(e, actions)).toBe(true);
                    expect(actions.zoomIn).toHaveBeenCalledTimes(1);
                    expect(e.preventDefault).toHaveBeenCalledTimes(1);
                    expect(actions.zoomOut).not.toHaveBeenCalled();
                    expect(actions.reset).not.toHaveBeenCalled();
                }
            });

            it('zooms out on `-` and `_`, preventing the browser page-zoom', () => {
                for (const key of ['-', '_']) {
                    const actions = makeActions();
                    const e = evt({ key, [mod]: true });
                    expect(handleNoteZoomKey(e, actions)).toBe(true);
                    expect(actions.zoomOut).toHaveBeenCalledTimes(1);
                    expect(e.preventDefault).toHaveBeenCalledTimes(1);
                }
            });

            it('resets on `0`, preventing the browser page-zoom', () => {
                const actions = makeActions();
                const e = evt({ key: '0', [mod]: true });
                expect(handleNoteZoomKey(e, actions)).toBe(true);
                expect(actions.reset).toHaveBeenCalledTimes(1);
                expect(e.preventDefault).toHaveBeenCalledTimes(1);
            });
        });
    }

    it('ignores keys without Cmd/Ctrl (no interception, no preventDefault)', () => {
        for (const key of ['=', '-', '0', '+']) {
            const actions = makeActions();
            const e = evt({ key });
            expect(handleNoteZoomKey(e, actions)).toBe(false);
            expect(e.preventDefault).not.toHaveBeenCalled();
            expect(actions.zoomIn).not.toHaveBeenCalled();
            expect(actions.zoomOut).not.toHaveBeenCalled();
            expect(actions.reset).not.toHaveBeenCalled();
        }
    });

    it('ignores Alt-combos and unrelated keys', () => {
        const altActions = makeActions();
        const altEvt = evt({ key: '=', ctrlKey: true, altKey: true });
        expect(handleNoteZoomKey(altEvt, altActions)).toBe(false);
        expect(altEvt.preventDefault).not.toHaveBeenCalled();

        const otherActions = makeActions();
        const otherEvt = evt({ key: 'a', metaKey: true });
        expect(handleNoteZoomKey(otherEvt, otherActions)).toBe(false);
        expect(otherEvt.preventDefault).not.toHaveBeenCalled();
    });
});

describe('NoteEditor keyboard-zoom wiring (AC-04)', () => {
    const editorSrc = readFileSync(
        resolve(__dirname, '../../../../../src/server/spa/client/react/features/notes/editor/NoteEditor.tsx'),
        'utf8',
    );

    it('routes key events through the shared handler', () => {
        expect(editorSrc).toContain("import { handleNoteZoomKey } from './noteZoomKeyboard'");
        expect(editorSrc).toContain('handleNoteZoomKey(e, {');
    });

    it('scopes the handler to the note-editor container (not window-global)', () => {
        // The onKeyDown lives on the outer note-editor div — focus scoping is the guard.
        const idx = editorSrc.indexOf('className="note-editor');
        expect(idx).toBeGreaterThan(-1);
        const tag = editorSrc.slice(idx, editorSrc.indexOf('>', idx));
        expect(tag).toContain('onKeyDown={handleZoomKeyDown}');
        // Not registered globally on window.
        expect(editorSrc).not.toContain("window.addEventListener('keydown'");
    });
});
