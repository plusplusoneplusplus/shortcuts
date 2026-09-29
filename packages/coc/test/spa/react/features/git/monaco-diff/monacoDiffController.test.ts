/**
 * Tests for monacoDiffController — async attach, state replay, diff readiness,
 * stale callbacks and exactly-once disposal (AC-03), against an owned adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import { createMonacoDiffController } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffController';
import { buildDiffEditorOptions, buildDiffModels } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffOptions';
import type { DiffLineChange } from '../../../../../../src/server/spa/client/react/features/git/diff/diffCoords';
import { createFakeDiffEditor, deferred, flush } from './fakeDiffEditorAdapter';

const change = (o1: number, o2: number, m1: number, m2: number): DiffLineChange => ({
    originalStartLineNumber: o1, originalEndLineNumber: o2, modifiedStartLineNumber: m1, modifiedEndLineNumber: m2,
});
const fileA = buildDiffModels({ workspaceId: 'ws', relativePath: 'a.ts', stage: 'unstaged', original: 'a\n', modified: 'A\n' });
const fileB = buildDiffModels({ workspaceId: 'ws', relativePath: 'b.ts', stage: 'unstaged', original: 'b\n', modified: 'B\n' });

describe('createMonacoDiffController — attach', () => {
    it('replays the latest models, options, theme and size when the adapter arrives', async () => {
        const fake = createFakeDiffEditor();
        const pending = deferred<typeof fake.adapter>();
        const onAttach = vi.fn();
        const controller = createMonacoDiffController(() => pending.promise, { onAttach });
        controller.setModels(fileA);
        controller.setModels(fileB);
        controller.setOptions(buildDiffEditorOptions('unified'));
        controller.setOptions(buildDiffEditorOptions('split'));
        controller.setTheme('vs-dark');
        controller.layout({ width: 300, height: 200 });
        expect(controller.isAttached()).toBe(false);

        pending.resolve(fake.adapter);
        await flush();

        expect(controller.isAttached()).toBe(true);
        expect(onAttach).toHaveBeenCalledTimes(1);
        expect(fake.models).toEqual([fileB]);
        expect(fake.options.map(o => o.renderSideBySide)).toEqual([true]);
        expect(fake.adapter.setTheme).toHaveBeenCalledWith('vs-dark');
        expect(fake.adapter.layout).toHaveBeenCalledWith({ width: 300, height: 200 });
    });

    it('a hunk request made before the editor exists survives the attach (regression)', async () => {
        const fake = createFakeDiffEditor();
        const pending = deferred<typeof fake.adapter>();
        const controller = createMonacoDiffController(() => pending.promise);
        controller.setModels(fileA);
        controller.navigate({ kind: 'last' });
        pending.resolve(fake.adapter);
        await flush();
        fake.finishDiff([change(1, 1, 1, 1), change(4, 4, 4, 4)]);
        expect(controller.getCurrentHunkIndex()).toBe(1);
        expect(fake.adapter.revealModifiedLine).toHaveBeenCalledWith(4);
    });

    it('an adapter that arrives after dispose is disposed and never used', async () => {
        const fake = createFakeDiffEditor();
        const pending = deferred<typeof fake.adapter>();
        const onAttach = vi.fn();
        const controller = createMonacoDiffController(() => pending.promise, { onAttach });
        controller.setModels(fileA);
        controller.dispose();
        pending.resolve(fake.adapter);
        await flush();
        expect(fake.disposals).toBe(1);
        expect(fake.models).toEqual([]);
        expect(fake.adapter.onDidUpdateDiff).not.toHaveBeenCalled();
        expect(onAttach).not.toHaveBeenCalled();
    });

    it('reports creation failure unless already disposed', async () => {
        const onError = vi.fn();
        createMonacoDiffController(() => Promise.reject(new Error('boom')), { onError });
        await flush();
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));

        const late = vi.fn();
        const pending = deferred<never>();
        createMonacoDiffController(() => pending.promise, { onError: late }).dispose();
        pending.reject(new Error('late'));
        await flush();
        expect(late).not.toHaveBeenCalled();
    });
});

async function attached() {
    const fake = createFakeDiffEditor();
    const onLineChanges = vi.fn();
    const controller = createMonacoDiffController(async () => fake.adapter, { onLineChanges });
    await flush();
    return { fake, controller, onLineChanges };
}

describe('createMonacoDiffController — diff readiness', () => {
    it('is not ready until onDidUpdateDiff delivers line changes', async () => {
        const { fake, controller, onLineChanges } = await attached();
        controller.setModels(fileA);
        expect(controller.isHunkNavigationReady()).toBe(false);
        expect(controller.getHunkCount()).toBe(0);

        fake.fireDiff(); // event with no result yet (still computing)
        expect(controller.isHunkNavigationReady()).toBe(false);
        expect(onLineChanges).not.toHaveBeenCalled();

        fake.finishDiff([change(1, 1, 1, 1)]);
        expect(controller.isHunkNavigationReady()).toBe(true);
        expect(controller.getHunkCount()).toBe(1);
        expect(onLineChanges).toHaveBeenCalledWith([change(1, 1, 1, 1)], fileA);
    });

    it('navigation requested before readiness reveals once the diff is ready', async () => {
        const { fake, controller } = await attached();
        controller.setModels(fileA);
        controller.navigate({ kind: 'last' });
        expect(fake.adapter.revealModifiedLine).not.toHaveBeenCalled();
        fake.finishDiff([change(1, 1, 1, 1), change(5, 0, 6, 7)]);
        expect(fake.adapter.revealModifiedLine).toHaveBeenCalledWith(6);
        expect(controller.getCurrentHunkIndex()).toBe(1);
    });

    it('a model swap resets readiness and the hunk cursor', async () => {
        const { fake, controller } = await attached();
        controller.setModels(fileA);
        fake.finishDiff([change(1, 1, 1, 1)]);
        controller.navigate({ kind: 'next' });
        expect(controller.getCurrentHunkIndex()).toBe(0);

        controller.setModels(fileB);
        expect(controller.isHunkNavigationReady()).toBe(false);
        expect(controller.getCurrentHunkIndex()).toBe(-1);
        expect(controller.getHunkCount()).toBe(0);
    });

    it('re-setting identical models is a no-op (no reset, no second setModels)', async () => {
        const { fake, controller } = await attached();
        controller.setModels(fileA);
        fake.finishDiff([change(1, 1, 1, 1)]);
        controller.navigate({ kind: 'next' });
        controller.setModels(buildDiffModels({ workspaceId: 'ws', relativePath: 'a.ts', stage: 'unstaged', original: 'a\n', modified: 'A\n' }));
        expect(fake.models).toHaveLength(1);
        expect(controller.getCurrentHunkIndex()).toBe(0);
    });

    it('diff events after dispose reach neither the navigator nor the callback', async () => {
        const { fake, controller, onLineChanges } = await attached();
        controller.setModels(fileA);
        const listener = [...fake.listeners][0];
        controller.dispose();
        (fake.adapter.getLineChanges as ReturnType<typeof vi.fn>).mockReturnValue([change(1, 1, 1, 1)]);
        listener(); // a late event Monaco had already queued
        expect(onLineChanges).not.toHaveBeenCalled();
        expect(controller.getHunkCount()).toBe(0);
    });

    it('ignores every call after dispose', async () => {
        const { fake, controller } = await attached();
        controller.dispose();
        controller.setModels(fileA);
        controller.setOptions(buildDiffEditorOptions('split'));
        controller.setTheme('vs');
        controller.layout({ width: 1, height: 1 });
        controller.navigate({ kind: 'next' });
        expect(fake.adapter.setModels).not.toHaveBeenCalled();
        expect(fake.adapter.updateOptions).not.toHaveBeenCalled();
        expect(fake.adapter.setTheme).not.toHaveBeenCalled();
        expect(fake.adapter.layout).not.toHaveBeenCalled();
        expect(controller.isAttached()).toBe(false);
    });
});

describe('createMonacoDiffController — comment overlays', () => {
    it('exposes the editor only while attached and reports each applied model pair', async () => {
        const fake = createFakeDiffEditor();
        const pending = deferred<typeof fake.adapter>();
        const onModelsApplied = vi.fn();
        const controller = createMonacoDiffController(() => pending.promise, { onModelsApplied });
        const first = buildDiffModels({ workspaceId: 'ws', relativePath: 'a.ts', stage: 'unstaged', original: 'a', modified: 'b' });
        controller.setModels(first);
        expect(controller.getEditor()).toBeNull();
        expect(onModelsApplied).not.toHaveBeenCalled();
        pending.resolve(fake.adapter);
        await flush();
        expect(controller.getEditor()).toBe(fake.adapter);
        expect(onModelsApplied).toHaveBeenCalledWith(first);
        controller.setModels(first);
        expect(onModelsApplied).toHaveBeenCalledTimes(1);
        controller.setModels({ ...first, modified: { ...first.modified, text: 'c' } });
        expect(onModelsApplied).toHaveBeenCalledTimes(2);
        controller.dispose();
        expect(controller.getEditor()).toBeNull();
    });
});

describe('createMonacoDiffController — disposal', () => {
    it('disposes the adapter and its diff listener exactly once', async () => {
        const { fake, controller } = await attached();
        controller.setModels(fileA);
        controller.dispose();
        controller.dispose();
        expect(fake.disposals).toBe(1);
        expect(fake.listenerDisposals).toBe(1);
        expect(fake.listeners.size).toBe(0);
        expect(controller.isDisposed()).toBe(true);
    });
});
