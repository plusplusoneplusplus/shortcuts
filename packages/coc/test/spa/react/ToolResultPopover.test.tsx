/**
 * Tests for ToolResultPopover component.
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolResultPopover } from '../../../src/server/spa/client/react/processes/ToolResultPopover';

function makeAnchorRect(overrides: Partial<DOMRect> = {}): DOMRect {
    return {
        top: 100,
        left: 50,
        bottom: 120,
        right: 250,
        width: 200,
        height: 20,
        x: 50,
        y: 100,
        toJSON: () => ({}),
        ...overrides,
    } as DOMRect;
}

describe('ToolResultPopover', () => {
    it('renders result text in a portal on document.body', () => {
        const onMouseEnter = () => {};
        const onMouseLeave = () => {};
        render(
            <ToolResultPopover
                result="Hello from the task agent"
                anchorRect={makeAnchorRect()}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Hello from the task agent');
        expect(popover!.textContent).toContain('Result Preview');
    });

    it('truncates text longer than 2000 chars', () => {
        const longText = 'a'.repeat(2500);
        render(
            <ToolResultPopover
                result={longText}
                anchorRect={makeAnchorRect()}
                onMouseEnter={() => {}}
                onMouseLeave={() => {}}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('… (truncated — click to see full)');
    });

    it('does not truncate text under 2000 chars', () => {
        const shortText = 'b'.repeat(1999);
        render(
            <ToolResultPopover
                result={shortText}
                anchorRect={makeAnchorRect()}
                onMouseEnter={() => {}}
                onMouseLeave={() => {}}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).not.toContain('truncated');
    });

    it('calls onMouseEnter when hovering the popover', () => {
        let entered = false;
        render(
            <ToolResultPopover
                result="test"
                anchorRect={makeAnchorRect()}
                onMouseEnter={() => { entered = true; }}
                onMouseLeave={() => {}}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]')!;
        fireEvent.mouseEnter(popover);
        expect(entered).toBe(true);
    });

    it('calls onMouseLeave when leaving the popover', () => {
        let left = false;
        render(
            <ToolResultPopover
                result="test"
                anchorRect={makeAnchorRect()}
                onMouseEnter={() => {}}
                onMouseLeave={() => { left = true; }}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]')!;
        fireEvent.mouseLeave(popover);
        expect(left).toBe(true);
    });
});
