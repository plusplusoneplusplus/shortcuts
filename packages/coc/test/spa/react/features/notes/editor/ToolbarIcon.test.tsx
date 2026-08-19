/**
 * Tests for the formatting toolbar's drawn command icons.
 *
 * The toolbar row is read as a set: if one button falls back to a text glyph or
 * an emoji while its neighbours are stroked drawings, that button is the one
 * that looks broken. So these assert both that every command in the toolbar has
 * a drawing and that the drawings are stroked the same way — plus that the
 * buttons actually render them instead of the old characters.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
    ToolbarIcon,
    hasToolbarIcon,
} from '../../../../../../src/server/spa/client/react/features/notes/editor/toolbar/ToolbarIcon';
import { TB } from '../../../../../../src/server/spa/client/react/features/notes/editor/toolbar/FormattingToolbar';
import { FORMATTING_COMMANDS } from '../../../../../../src/server/spa/client/react/features/notes/editor/toolbar/formattingCommands';

afterEach(cleanup);

/** A stand-in editor: the button only ever asks it for the pressed state. */
const editorStub = { isActive: () => false } as never;

describe('ToolbarIcon', () => {
    it('draws an icon for every formatting command in the toolbar', () => {
        for (const command of FORMATTING_COMMANDS) {
            expect(hasToolbarIcon(command.id), `missing icon for ${command.id}`).toBe(true);
        }
    });

    it('draws the two buttons that are not command descriptors', () => {
        // Find and Insert PDF sit in the same row and used to be emoji.
        expect(hasToolbarIcon('find')).toBe(true);
        expect(hasToolbarIcon('insertPdf')).toBe(true);
    });

    it('strokes every icon on the same grid at the same weight', () => {
        for (const command of FORMATTING_COMMANDS) {
            render(<ToolbarIcon name={command.id} />);
            const svg = screen.getByTestId(`toolbar-icon-${command.id}`);
            expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
            expect(svg.getAttribute('stroke')).toBe('currentColor');
            expect(svg.getAttribute('stroke-width')).toBe('2');
            // Stroked, not filled — a stray fill paints the counters solid.
            expect(svg.getAttribute('fill')).toBe('none');
            cleanup();
        }
    });

    it('has at least one drawn shape per icon', () => {
        for (const command of FORMATTING_COMMANDS) {
            render(<ToolbarIcon name={command.id} />);
            const svg = screen.getByTestId(`toolbar-icon-${command.id}`);
            expect(svg.querySelectorAll('path, rect, circle, line').length).toBeGreaterThan(0);
            cleanup();
        }
    });

    it('hides itself from the accessibility tree, since buttons carry the label', () => {
        render(<ToolbarIcon name="bold" />);
        const svg = screen.getByTestId('toolbar-icon-bold');
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.getAttribute('focusable')).toBe('false');
    });

    it('passes extra classes through to the svg', () => {
        render(<ToolbarIcon name="italic" className="opacity-50" />);
        expect(screen.getByTestId('toolbar-icon-italic').getAttribute('class')).toContain('opacity-50');
    });

    it('renders nothing for an unknown name rather than an empty box', () => {
        const { container } = render(<ToolbarIcon name="nope" />);
        expect(container.querySelector('svg')).toBeNull();
    });
});

describe('TB icon rendering', () => {
    it('draws the icon for a command that has one', () => {
        render(<TB editor={editorStub} label="Bold" icon="B" iconId="bold" command={() => {}} />);
        const button = screen.getByLabelText('Bold');
        expect(button.querySelector('svg[data-testid="toolbar-icon-bold"]')).not.toBeNull();
        // The letter it replaced must be gone, or both would show.
        expect(button.textContent).toBe('');
    });

    it('falls back to the text glyph when the command has no drawing', () => {
        render(<TB editor={editorStub} label="Mystery" icon="?" iconId="mystery" command={() => {}} />);
        const button = screen.getByLabelText('Mystery');
        expect(button.querySelector('svg')).toBeNull();
        expect(button.textContent).toBe('?');
    });

    it('falls back to the text glyph when no id is given at all', () => {
        render(<TB editor={editorStub} label="Bold" icon="B" command={() => {}} />);
        expect(screen.getByLabelText('Bold').textContent).toBe('B');
    });
});
