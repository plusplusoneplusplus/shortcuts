import { describe, expect, it, vi } from 'vitest';
import {
    installNoDefinitionFeedback,
    noDefinitionMessage,
} from '../../../../../../src/server/spa/client/react/features/git/diff/diffDefinitionFeedback';

const position = { lineNumber: 3, column: 5 };

function setup(platform = 'Linux x86_64', found: boolean | Error = false) {
    let listener: (event: unknown) => void = () => {};
    const subscription = { dispose: vi.fn() };
    const editor = { onMouseUp: vi.fn((next: (event: unknown) => void) => { listener = next; return subscription; }) };
    const model = { getWordAtPosition: vi.fn(() => ({ word: 'parse', startColumn: 3, endColumn: 8 })) };
    const resolve = vi.fn(async (_position: unknown, _signal: AbortSignal) => {
        if (found instanceof Error) throw found;
        return found;
    });
    const onNoDefinition = vi.fn();
    const feedback = installNoDefinitionFeedback({ editor: editor as any, model, resolve, onNoDefinition, platform });
    const click = (mouse: Partial<{ leftButton: boolean; ctrlKey: boolean; metaKey: boolean }> = {}, type = 6, at: unknown = position) =>
        listener({ event: { leftButton: true, ctrlKey: true, metaKey: false, ...mouse }, target: { type, position: at } });
    return { editor, model, resolve, onNoDefinition, feedback, click, subscription };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('diff "No definition found" feedback', () => {
    it('reports a Ctrl+Click on a word with no definition', async () => {
        const s = setup();
        s.click();
        await settle();
        expect(s.resolve).toHaveBeenCalledWith(position, expect.any(AbortSignal));
        expect(s.onNoDefinition).toHaveBeenCalledWith('parse');
        expect(noDefinitionMessage('parse')).toBe("No definition found for 'parse'");
    });

    it('stays quiet when the word resolves', async () => {
        const s = setup('Linux x86_64', true);
        s.click();
        await settle();
        expect(s.resolve).toHaveBeenCalledOnce();
        expect(s.onNoDefinition).not.toHaveBeenCalled();
    });

    it('treats a failed lookup as no definition rather than a silent no-op', async () => {
        const s = setup('Linux x86_64', new Error('offline'));
        s.click();
        await settle();
        expect(s.onNoDefinition).toHaveBeenCalledWith('parse');
    });

    it('uses Cmd on macOS and Ctrl elsewhere', async () => {
        const mac = setup('MacIntel');
        mac.click({ ctrlKey: true, metaKey: false });
        mac.click({ ctrlKey: false, metaKey: true });
        await settle();
        expect(mac.resolve).toHaveBeenCalledOnce();
        expect(mac.onNoDefinition).toHaveBeenCalledOnce();
    });

    it.each([
        ['plain click', { ctrlKey: false }, 6, position],
        ['right button', { leftButton: false }, 6, position],
        ['gutter', {}, 2, position],
        ['no position', {}, 6, null],
    ])('ignores a %s', async (_name, mouse, type, at) => {
        const s = setup();
        s.click(mouse, type, at);
        await settle();
        expect(s.resolve).not.toHaveBeenCalled();
    });

    it('ignores whitespace', async () => {
        const s = setup();
        s.model.getWordAtPosition.mockReturnValueOnce(null as any);
        s.click();
        await settle();
        expect(s.resolve).not.toHaveBeenCalled();
    });

    it('reports only the latest click and nothing after disposal', async () => {
        const s = setup();
        s.click();
        s.click();
        await settle();
        expect(s.resolve.mock.calls[0]![1].aborted).toBe(true);
        expect(s.onNoDefinition).toHaveBeenCalledOnce();

        s.click();
        s.feedback.dispose();
        s.feedback.dispose();
        await settle();
        expect(s.onNoDefinition).toHaveBeenCalledOnce();
        expect(s.subscription.dispose).toHaveBeenCalledOnce();
    });

    it('is inert without a reporter or a mouse-up event', () => {
        const editor = { onMouseUp: vi.fn() };
        const model = { getWordAtPosition: vi.fn() };
        installNoDefinitionFeedback({ editor: editor as any, model, resolve: vi.fn() }).dispose();
        expect(editor.onMouseUp).not.toHaveBeenCalled();
        expect(() => installNoDefinitionFeedback({ editor: {}, model, resolve: vi.fn(), onNoDefinition: vi.fn() }).dispose()).not.toThrow();
    });
});
