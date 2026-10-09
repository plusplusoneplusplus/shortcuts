import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React, { createRef } from 'react';
import { UnifiedDiffViewer, VIRTUALIZE_THRESHOLD, type UnifiedDiffViewerHandle } from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';

const flags = vi.hoisted(() => ({ SHOW_DIFF_FILE_PICKER: false }));
vi.mock('../../../src/server/spa/client/react/featureFlags', async importOriginal => ({
    ...await importOriginal<typeof import('../../../src/server/spa/client/react/featureFlags')>(),
    get SHOW_DIFF_FILE_PICKER() { return flags.SHOW_DIFF_FILE_PICKER; },
}));

const PATHS = ['src/first.ts', 'assets/image.png', 'src/deleted.ts', 'src/renamed.ts'];

function comparison(bodyLines = 2) {
    return [
        `diff --git a/${PATHS[0]} b/${PATHS[0]}`,
        `--- a/${PATHS[0]}`, `+++ b/${PATHS[0]}`,
        `@@ -1,${bodyLines} +1,${bodyLines} @@`,
        ...Array.from({ length: bodyLines }, (_, i) => ` context ${i}`),
        `diff --git a/${PATHS[1]} b/${PATHS[1]}`,
        `Binary files a/${PATHS[1]} and b/${PATHS[1]} differ`,
        `diff --git a/${PATHS[2]} b/${PATHS[2]}`,
        'deleted file mode 100644', `--- a/${PATHS[2]}`, '+++ /dev/null',
        '@@ -1 +0,0 @@', '-deleted',
        `diff --git a/src/old.ts b/${PATHS[3]}`,
        'similarity index 100%', 'rename from src/old.ts', `rename to ${PATHS[3]}`,
    ].join('\n');
}

const VIEWERS = [
    { name: 'unified', Viewer: UnifiedDiffViewer },
    { name: 'split', Viewer: SideBySideDiffViewer },
] as const;

it('ships the changed-file picker disabled by default', async () => {
    const actual = await vi.importActual<typeof import('../../../src/server/spa/client/react/featureFlags')>(
        '../../../src/server/spa/client/react/featureFlags',
    );
    expect(actual.SHOW_DIFF_FILE_PICKER).toBe(false);
});

describe.each(VIEWERS)('changed-file picker integration — $name', ({ Viewer }) => {
    let rowTops: Record<string, number>;
    const descriptors = new Map<string, PropertyDescriptor | undefined>();

    beforeEach(() => {
        flags.SHOW_DIFF_FILE_PICKER = true;
        rowTops = Object.fromEntries(PATHS.map((path, i) => [path, 100 + i * 200]));
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const path = this.getAttribute('data-file-path');
            const top = this.getAttribute('data-testid') === 'diff-file-banner-pinned'
                ? 100 : path ? rowTops[path] ?? 100 : 100;
            return { top, left: 0, right: 800, bottom: top + 24, width: 800, height: 24, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
        });
        for (const [key, value] of [['clientHeight', 600], ['offsetHeight', 600], ['offsetWidth', 800]] as const) {
            descriptors.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
            Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
        }
    });

    afterEach(() => {
        flags.SHOW_DIFF_FILE_PICKER = false;
        vi.restoreAllMocks();
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
            else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
        }
        descriptors.clear();
    });

    function mount(diff: string, props: Record<string, unknown> = {}) {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const navigation = vi.fn();
        const view = render(
            <div data-testid="scroller" style={{ overflowY: 'scroll', height: 600 }}>
                <Viewer ref={ref} diff={diff} showFileBanners onFileNavigate={navigation} {...props} />
            </div>,
        );
        const scroller = screen.getByTestId('scroller');
        const scrollTo = vi.fn();
        scroller.scrollTo = scrollTo;
        return { ...view, ref, navigation, scroller, scrollTo };
    }

    function open(banner: HTMLElement) {
        fireEvent.click(within(banner).getByRole('button', { name: `Jump to file: ${PATHS[0]}` }));
        return screen.getByRole('dialog', { name: 'Jump to changed file' });
    }

    it.each(['ordinary', 'docked', 'virtualized', 'virtualized docked'])('navigates all changed files through the existing %s scroll path without opening a tab', mode => {
        const virtualized = mode.includes('virtualized');
        const view = mount(comparison(virtualized ? VIRTUALIZE_THRESHOLD + 50 : 2));
        const openTab = vi.spyOn(window, 'open').mockImplementation(() => null);
        if (mode.includes('docked')) {
            rowTops[PATHS[0]] = 50;
            act(() => {
                view.scroller.scrollTop = virtualized ? 2000 : 50;
                fireEvent.scroll(view.scroller);
            });
        }
        const banner = view.container.querySelector<HTMLElement>(
            `[data-testid="${mode.includes('docked') ? 'diff-file-banner-pinned' : 'diff-file-banner'}"]`,
        )!;
        expect(banner).not.toBeNull();
        if (virtualized) {
            expect(view.container.querySelector(`[data-file-path="${PATHS[3]}"]`)).toBeNull();
        }
        const dialog = open(banner);
        expect(view.container.contains(dialog)).toBe(false);
        const options = within(dialog).getAllByRole('option');
        expect(options.map(option => option.getAttribute('title'))).toEqual(PATHS);
        expect(options[0].getAttribute('aria-selected')).toBe('true');
        expect(within(dialog).queryByText('src/old.ts')).toBeNull();

        for (const path of PATHS.slice(1)) {
            // Compare picker scrolling with the viewer's public navigation contract.
            view.scrollTo.mockClear();
            act(() => view.ref.current!.scrollToFile(path));
            const expectedScroll = view.scrollTo.mock.calls.at(-1);
            view.scrollTo.mockClear();
            fireEvent.change(screen.getByRole('combobox', { name: 'Search changed files' }), { target: { value: path } });
            fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
            expect(view.navigation).toHaveBeenLastCalledWith(path);
            expect(expectedScroll).toBeDefined();
            expect(view.scrollTo.mock.calls.at(-1)).toEqual(expectedScroll);
            expect(screen.queryByRole('dialog', { name: 'Jump to changed file' })).toBeNull();
            expect(openTab).not.toHaveBeenCalled();
            if (path !== PATHS.at(-1)) open(banner);
        }
        expect(view.navigation).toHaveBeenCalledTimes(3);
    });

    it('scrolls without requiring a navigation callback', () => {
        const view = mount(comparison(), { onFileNavigate: undefined });
        open(view.container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!);
        fireEvent.click(screen.getByRole('option', { name: /image\.png/ }));
        expect(view.scrollTo).toHaveBeenCalledWith({ top: 200, behavior: 'smooth' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    if (Viewer === UnifiedDiffViewer) {
        it('navigates to an offscreen Git-quoted filename using its banner row index', () => {
            const firstFile = comparison(VIRTUALIZE_THRESHOLD + 50).split(`diff --git a/${PATHS[1]}`)[0];
            const control = mount(firstFile + [
                'diff --git a/src/target.ts b/src/target.ts',
                '--- a/src/target.ts', '+++ b/src/target.ts',
                '@@ -1 +1 @@', '-before', '+after',
            ].join('\n'));
            Object.defineProperty(control.scroller, 'scrollHeight', { configurable: true, value: 100000 });
            act(() => control.ref.current!.scrollToFile('src/target.ts'));
            const expectedScroll = control.scrollTo.mock.calls.at(-1);
            expect(expectedScroll).toBeDefined();
            expect(expectedScroll![0].top).toBeGreaterThan(600);
            control.unmount();

            const quotedPath = String.raw`"b/src/caf\303\251.ts"`;
            const view = mount(firstFile + [
                String.raw`diff --git "a/src/caf\303\251.ts" "b/src/caf\303\251.ts"`,
                String.raw`--- "a/src/caf\303\251.ts"`,
                `+++ ${quotedPath}`,
                '@@ -1 +1 @@', '-before', '+after',
            ].join('\n'));
            Object.defineProperty(view.scroller, 'scrollHeight', { configurable: true, value: 100000 });
            expect(view.container.querySelectorAll('[data-testid="diff-file-banner"]')).toHaveLength(1);
            open(view.container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!);
            const option = screen.getAllByRole('option').find(candidate => candidate.getAttribute('title') === quotedPath);
            expect(option).toBeDefined();
            fireEvent.click(option!);
            expect(view.navigation).toHaveBeenCalledExactlyOnceWith(quotedPath);
            expect(view.scrollTo.mock.calls.at(-1)).toEqual(expectedScroll);
            expect(screen.queryByRole('dialog', { name: 'Jump to changed file' })).toBeNull();
        });
    }

    it('selecting the current docked file scrolls to its in-flow banner rather than the overlay', () => {
        const view = mount(comparison());
        rowTops[PATHS[0]] = 50;
        act(() => {
            view.scroller.scrollTop = 50;
            fireEvent.scroll(view.scroller);
        });
        const pinned = view.container.querySelector<HTMLElement>('[data-testid="diff-file-banner-pinned"]')!;
        const inFlow = view.container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!;
        expect(pinned.getBoundingClientRect().top).toBe(100);
        expect(inFlow.getBoundingClientRect().top).toBe(50);
        open(pinned);
        fireEvent.click(screen.getByRole('option', { name: /first\.ts/ }));
        expect(view.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: 'smooth' });
        expect(view.navigation).toHaveBeenCalledExactlyOnceWith(PATHS[0]);
        expect(screen.queryByRole('dialog', { name: 'Jump to changed file' })).toBeNull();
    });

    it.each(['comparison', 'workspace', 'source'])('closes a stale picker when the %s changes', kind => {
        const diff = comparison();
        const scope = { workspaceId: 'workspace-a', ref: { type: 'commit' as const, commitHash: 'first' } };
        const view = mount(diff, { diffSelectionDragSource: scope });
        open(view.container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'deleted' } });
        const nextDiff = kind === 'comparison' ? diff.replaceAll('src/deleted.ts', 'src/replacement.ts') : diff;
        const nextScope = kind === 'workspace' ? { ...scope, workspaceId: 'workspace-b' }
            : kind === 'source' ? { ...scope, ref: { type: 'commit' as const, commitHash: 'second' } } : scope;
        view.rerender(
            <div data-testid="scroller" style={{ overflowY: 'scroll', height: 600 }}>
                <Viewer diff={nextDiff} showFileBanners diffSelectionDragSource={nextScope} />
            </div>,
        );
        expect(screen.queryByRole('dialog')).toBeNull();
        const dialog = open(view.container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!);
        expect((within(dialog).getByRole('combobox') as HTMLInputElement).value).toBe('');
        expect(within(dialog).getAllByRole('option')).toHaveLength(4);
        if (kind === 'comparison') {
            expect(within(dialog).queryByRole('option', { name: /deleted\.ts/ })).toBeNull();
            expect(within(dialog).getByRole('option', { name: /replacement\.ts/ })).toBeTruthy();
        }
    });

    it.each([false, true])('closes a docked picker on comparison changes (virtualized: %s)', virtualized => {
        const diff = comparison(virtualized ? VIRTUALIZE_THRESHOLD + 50 : 2);
        const view = mount(diff);
        rowTops[PATHS[0]] = 50;
        act(() => {
            view.scroller.scrollTop = virtualized ? 2000 : 50;
            fireEvent.scroll(view.scroller);
        });
        open(view.container.querySelector<HTMLElement>('[data-testid="diff-file-banner-pinned"]')!);
        view.rerender(
            <div data-testid="scroller" style={{ overflowY: 'scroll', height: 600 }}>
                <Viewer diff={diff.replaceAll('src/deleted.ts', 'src/replacement.ts')} showFileBanners />
            </div>,
        );
        expect(screen.queryByRole('dialog', { name: 'Jump to changed file' })).toBeNull();
        expect(view.navigation).not.toHaveBeenCalled();
    });

    it('retains noninteractive file paths when the feature flag is off', () => {
        flags.SHOW_DIFF_FILE_PICKER = false;
        const view = mount(comparison());
        const path = within(view.container.querySelector<HTMLElement>('[data-testid="diff-file-banner"]')!).getByTestId('diff-file-banner-path');
        expect(path.tagName).toBe('SPAN');
        fireEvent.click(path);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(view.navigation).not.toHaveBeenCalled();
        expect(view.scrollTo).not.toHaveBeenCalled();
    });
});
