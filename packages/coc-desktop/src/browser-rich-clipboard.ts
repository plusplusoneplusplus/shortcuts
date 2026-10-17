export interface RichClipboard {
    availableFormats(): string[];
    write(data: { html: string; text: string }): void;
}

/** One desktop-process barrier across all owners, engines and workspace queues. */
let tail: Promise<void> = Promise.resolve();

export async function withRichClipboard<T>(
    clipboard: RichClipboard, html: string, text: string, replace: boolean, signal: AbortSignal,
    operation: (write: () => void) => Promise<T>,
): Promise<T> {
    const execution = tail.then(async () => {
        signal.throwIfAborted();
        if (!replace && clipboard.availableFormats().length) {
            throw new Error('Clipboard is not empty; authorize replaceClipboard to replace it. Existing contents are not restored.');
        }
        return operation(() => {
            signal.throwIfAborted();
            if (!replace && clipboard.availableFormats().length) throw new Error('Clipboard changed before paste; nothing was written');
            clipboard.write({ html, text });
        });
    });
    tail = execution.then(() => {}, () => {});
    return execution;
}
