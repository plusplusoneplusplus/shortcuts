import { describe, expect, it } from 'vitest';
import { translateBackgroundInput } from '../src/electron-background-input';

describe('background Electron input translation', () => {
    it('maps CDP mouse presses, releases and moves to guest mouse events with modifiers', () => {
        expect(translateBackgroundInput('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10.6, y: 20.2, button: 'left', clickCount: 1, modifiers: 10 })).toEqual([
            { kind: 'event', event: { type: 'mouseDown', x: 11, y: 20, button: 'left', clickCount: 1, modifiers: ['control', 'shift'] } },
        ]);
        expect(translateBackgroundInput('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 2, button: 'right', clickCount: 1 })[0])
            .toMatchObject({ event: { type: 'mouseUp', button: 'right' } });
        expect(translateBackgroundInput('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 2 })[0])
            .toMatchObject({ event: { type: 'mouseMove', button: 'left', clickCount: undefined } });
    });

    it('inverts wheel deltas to Chromium wheel direction', () => {
        expect(translateBackgroundInput('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 5, y: 6, deltaX: -600, deltaY: 600 })).toEqual([
            { kind: 'event', event: { type: 'mouseWheel', x: 5, y: 6, deltaX: 600, deltaY: -600, canScroll: true, modifiers: [] } },
        ]);
    });

    it('maps text insertion, printable keys, named keys and macOS select-all', () => {
        expect(translateBackgroundInput('Input.insertText', { text: 'hello' })).toEqual([{ kind: 'insertText', text: 'hello' }]);
        expect(translateBackgroundInput('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', text: 'a' }).map(step => step.kind === 'event' && step.event.type))
            .toEqual(['keyDown', 'char']);
        expect(translateBackgroundInput('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown' })).toEqual([
            { kind: 'event', event: { type: 'keyDown', keyCode: 'Down', modifiers: [] } },
        ]);
        expect(translateBackgroundInput('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', text: ' ' })[1])
            .toMatchObject({ event: { type: 'char', keyCode: 'Space' } });
        expect(translateBackgroundInput('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', modifiers: 1 })).toEqual([
            { kind: 'event', event: { type: 'keyUp', keyCode: 'Enter', modifiers: ['alt'] } },
        ]);
        expect(translateBackgroundInput('Input.dispatchKeyEvent', { type: 'char', text: 'x' })).toEqual([
            { kind: 'event', event: { type: 'char', keyCode: 'x', modifiers: [] } },
        ]);
        expect(translateBackgroundInput('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 4, commands: ['selectAll'] }).map(step => step.kind))
            .toEqual(['event', 'selectAll']);
    });

    it('needs the foreground for frame sessions, unknown events and unsupported methods', () => {
        expect(() => translateBackgroundInput('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1 }, 'frame-session')).toThrow('foreground-required');
        expect(() => translateBackgroundInput('Input.dispatchMouseEvent', { type: 'mouseDragged', x: 1, y: 1 })).toThrow('foreground-required');
        expect(() => translateBackgroundInput('Input.dispatchTouchEvent', {})).toThrow('foreground-required');
        expect(() => translateBackgroundInput('Input.dispatchMouseEvent', { type: 'mousePressed', x: 'x', y: 1 })).toThrow('coordinate');
    });
});
