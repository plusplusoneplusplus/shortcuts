/**
 * An owned `DiffEditorAdapter` for tests. It records calls and lets the test
 * decide when a diff "finishes computing"; it does not imitate Monaco's
 * rendering or diff algorithm — line changes are supplied by the test.
 */

import { vi } from 'vitest';
import type { DiffEditorAdapter } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffController';
import type { DiffLineChange } from '../../../../../../src/server/spa/client/react/features/git/diff/diffCoords';
import type { DiffEditorOptions, DiffModelsInput } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffOptions';

export interface FakeDiffEditor {
    adapter: DiffEditorAdapter;
    /** Models passed to setModels, in order. */
    models: DiffModelsInput[];
    options: DiffEditorOptions[];
    listeners: Set<() => void>;
    listenerDisposals: number;
    disposals: number;
    /** Make the current diff available and fire onDidUpdateDiff. */
    finishDiff(changes: DiffLineChange[]): void;
    /** Fire onDidUpdateDiff without changing the result. */
    fireDiff(): void;
}

export function createFakeDiffEditor(initialOptions?: DiffEditorOptions): FakeDiffEditor {
    let lineChanges: DiffLineChange[] | null = null;
    const fake: FakeDiffEditor = {
        models: [],
        options: initialOptions ? [initialOptions] : [],
        listeners: new Set(),
        listenerDisposals: 0,
        disposals: 0,
        finishDiff(changes) {
            lineChanges = changes;
            fake.fireDiff();
        },
        fireDiff() {
            for (const listener of [...fake.listeners]) listener();
        },
        adapter: {
            setModels: vi.fn((models: DiffModelsInput) => {
                fake.models.push(models);
                lineChanges = null; // a new pair starts computing
            }),
            updateOptions: vi.fn((options: DiffEditorOptions) => { fake.options.push(options); }),
            setTheme: vi.fn(),
            layout: vi.fn(),
            getLineChanges: vi.fn(() => lineChanges),
            onDidUpdateDiff: vi.fn((listener: () => void) => {
                fake.listeners.add(listener);
                return {
                    dispose: () => {
                        fake.listenerDisposals++;
                        fake.listeners.delete(listener);
                    },
                };
            }),
            revealModifiedLine: vi.fn(),
            dispose: vi.fn(() => { fake.disposals++; }),
        },
    };
    return fake;
}

/** A promise with its resolver exposed, to control adapter arrival. */
export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

export const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
