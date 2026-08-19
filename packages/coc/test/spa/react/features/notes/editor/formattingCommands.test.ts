/**
 * Tests for the toolbar formatting command descriptors.
 *
 * The descriptors are the public shape of the formatting half of the toolbar:
 * labels double as `title`/`aria-label`, grouping drives the separator layout,
 * and `activeName`/`activeAttrs` drive the pressed state. Asserting on them
 * directly means the toolbar can be re-laid-out without silently renaming a
 * control or dropping its active-state wiring.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import {
    ALIGN_OPTIONS,
    FORMATTING_GROUPS,
    FORMATTING_COMMANDS,
    activeAlignOption,
    isCommandActive,
    toggleLink,
    type ToolbarCommandDescriptor,
    type ToolbarSlot,
} from '../../../../../../src/server/spa/client/react/features/notes/editor/toolbar/formattingCommands';

/**
 * Editor double that records the chained calls a descriptor makes, so a
 * descriptor's `run` can be asserted on without a real ProseMirror instance.
 */
function makeEditor(isActive: (name: string) => boolean = () => false) {
    const calls: { name: string; args: unknown[] }[] = [];
    const run = vi.fn();
    const chainTarget: Record<string, unknown> = {};
    const chainProxy: unknown = new Proxy(chainTarget, {
        get: (_t, prop: string) => {
            if (prop === 'run') return run;
            return (...args: unknown[]) => {
                calls.push({ name: prop, args });
                return chainProxy;
            };
        },
    });
    const focus = vi.fn(() => chainProxy);
    return {
        editor: {
            isActive: vi.fn((name: string) => isActive(name)),
            chain: vi.fn(() => ({ focus })),
        } as unknown as Editor,
        calls,
        run,
        focus,
    };
}

function byId(id: string): ToolbarCommandDescriptor {
    const found = FORMATTING_COMMANDS.find((c) => c.id === id);
    if (!found) throw new Error(`no descriptor with id "${id}"`);
    return found;
}

const slotIds = (): ToolbarSlot[] =>
    FORMATTING_GROUPS.flat().flatMap((i) => (i.kind === 'slot' ? [i.slot] : []));

describe('formatting command descriptors — inventory', () => {
    it('gives every command a unique id', () => {
        const ids = FORMATTING_COMMANDS.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('gives every command a non-empty label and icon', () => {
        for (const command of FORMATTING_COMMANDS) {
            expect(command.label, command.id).toBeTruthy();
            expect(command.icon, command.id).toBeTruthy();
        }
    });

    it('keeps the labels stable — they are the accessible names of the buttons', () => {
        expect(FORMATTING_COMMANDS.map((c) => c.label)).toEqual([
            'Bold',
            'Italic',
            'Strikethrough',
            'Superscript',
            'Subscript',
            'Blockquote',
            'Code',
            'Code block',
            'Link',
            'Horizontal rule',
            'Increase indent',
            'Decrease indent',
        ]);
    });

    it('keeps every stateful control in the group list as a slot', () => {
        expect(slotIds()).toEqual([
            'fontSize',
            'color',
            'fontFamily',
            'heading',
            'list',
            'tableInsert',
            'insertPdf',
            'align',
            'find',
        ]);
    });

    it('never leaves a group empty, which would render a stray separator', () => {
        for (const group of FORMATTING_GROUPS) {
            expect(group.length).toBeGreaterThan(0);
        }
    });

    it('orders the groups: marks, heading, list, blocks, misc, insert, align, indent, find', () => {
        const order = FORMATTING_GROUPS.map((group) =>
            group.map((i) => (i.kind === 'command' ? i.command.id : i.slot)));
        expect(order).toEqual([
            ['fontSize', 'bold', 'italic', 'strike', 'superscript', 'subscript', 'color'],
            ['fontFamily', 'heading'],
            ['list'],
            ['blockquote', 'code', 'codeBlock'],
            ['link', 'horizontalRule'],
            ['tableInsert', 'insertPdf'],
            ['align'],
            ['increaseIndent', 'decreaseIndent'],
            ['find'],
        ]);
    });
});

describe('formatting command descriptors — active state', () => {
    it.each([
        ['bold', 'bold'],
        ['italic', 'italic'],
        ['strike', 'strike'],
        ['superscript', 'superscript'],
        ['subscript', 'subscript'],
        ['blockquote', 'blockquote'],
        ['code', 'code'],
        ['codeBlock', 'codeBlock'],
        ['link', 'link'],
    ])('%s reports active from isActive("%s")', (id, nodeName) => {
        const { editor } = makeEditor((name) => name === nodeName);
        expect(isCommandActive(editor, byId(id))).toBe(true);
    });

    it('reports commands without an active node as never pressed', () => {
        // A horizontal rule or an indent step is an action, not a state.
        for (const id of ['horizontalRule', 'increaseIndent', 'decreaseIndent']) {
            const { editor } = makeEditor(() => true);
            expect(isCommandActive(editor, byId(id)), id).toBe(false);
            expect(editor.isActive).not.toHaveBeenCalled();
        }
    });
});

describe('formatting command descriptors — commands', () => {
    it.each([
        ['bold', 'toggleBold'],
        ['italic', 'toggleItalic'],
        ['strike', 'toggleStrike'],
        ['superscript', 'toggleSuperscript'],
        ['subscript', 'toggleSubscript'],
        ['blockquote', 'toggleBlockquote'],
        ['code', 'toggleCode'],
        ['codeBlock', 'toggleCodeBlock'],
        ['horizontalRule', 'setHorizontalRule'],
        ['increaseIndent', 'increaseIndent'],
        ['decreaseIndent', 'decreaseIndent'],
    ])('%s runs %s', (id, method) => {
        const { editor, calls, run } = makeEditor();
        byId(id).run(editor);
        expect(calls.map((c) => c.name)).toEqual([method]);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('focuses the editor before every command, so the caret survives the click', () => {
        for (const command of FORMATTING_COMMANDS) {
            if (command.id === 'link') continue; // covered separately — it prompts
            const { editor, focus } = makeEditor();
            command.run(editor);
            expect(focus, command.id).toHaveBeenCalled();
        }
    });
});

describe('alignment options', () => {
    /** `isActive` called with attributes only, the way `activeAlignOption` calls it. */
    function makeAlignEditor(current: string | null) {
        const isActive = vi.fn((attrs: unknown) =>
            (attrs as { textAlign?: string }).textAlign === current);
        return { isActive } as unknown as Editor & { isActive: typeof isActive };
    }

    it('keeps all four alignments, in menu order, with unique ids and test ids', () => {
        expect(ALIGN_OPTIONS.map((o) => o.id)).toEqual([
            'alignLeft', 'alignCenter', 'alignRight', 'alignJustify',
        ]);
        expect(ALIGN_OPTIONS.map((o) => o.label)).toEqual([
            'Align left', 'Align center', 'Align right', 'Justify',
        ]);
        expect(ALIGN_OPTIONS.map((o) => o.value)).toEqual(['left', 'center', 'right', 'justify']);
        expect(new Set(ALIGN_OPTIONS.map((o) => o.testId)).size).toBe(ALIGN_OPTIONS.length);
    });

    it('carries no glyph — the icon is drawn by AlignIcon off the value', () => {
        for (const option of ALIGN_OPTIONS) {
            expect(option).not.toHaveProperty('icon');
        }
    });

    it('is no longer wired through the command descriptors', () => {
        expect(FORMATTING_COMMANDS.some((c) => c.id.startsWith('align'))).toBe(false);
    });

    it.each(['left', 'center', 'right', 'justify'])(
        'reports %s active from the textAlign attribute alone',
        (value) => {
            const editor = makeAlignEditor(value);
            expect(activeAlignOption(editor)?.value).toBe(value);
            // Not `isActive('textStyle', { textAlign })` — the attribute lives
            // on the paragraph/heading node, so that form never matches.
            expect(editor.isActive).toHaveBeenCalledWith({ textAlign: value });
        },
    );

    it('reports no alignment when nothing matches', () => {
        expect(activeAlignOption(makeAlignEditor(null))).toBeNull();
    });
});

describe('toggleLink', () => {
    const originalPrompt = globalThis.prompt;
    afterEach(() => {
        globalThis.prompt = originalPrompt;
    });

    it('removes an active link without prompting', () => {
        globalThis.prompt = vi.fn() as never;
        const { editor, calls } = makeEditor((name) => name === 'link');

        toggleLink(editor);

        expect(globalThis.prompt).not.toHaveBeenCalled();
        expect(calls.map((c) => c.name)).toEqual(['unsetLink']);
    });

    it('prompts for a URL and sets the link when there is none', () => {
        globalThis.prompt = vi.fn(() => 'https://example.com') as never;
        const { editor, calls, run } = makeEditor();

        toggleLink(editor);

        expect(calls).toEqual([{ name: 'setLink', args: [{ href: 'https://example.com' }] }]);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a cancelled prompt', null],
        ['an empty URL', ''],
    ])('leaves the document untouched on %s', (_label, answer) => {
        globalThis.prompt = vi.fn(() => answer) as never;
        const { editor, calls } = makeEditor();

        toggleLink(editor);

        expect(calls).toEqual([]);
    });
});
