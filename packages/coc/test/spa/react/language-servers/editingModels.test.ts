import { afterEach, describe, expect, it } from 'vitest';
import { allowEditingModelTarget, editingModelTarget, registerEditingModel, resolveEditingTarget } from '../../../../src/server/spa/client/react/features/language-servers/editingModels';

const releases: (() => void)[] = [];
afterEach(() => { for (const release of releases.splice(0)) release(); });
function register(scope: string, path: string, text = 'unsaved text') {
    const model = { uri: { toString: () => `inmemory://${scope}/${path}` }, setValue(value: string) { text = value; }, getValue: () => text };
    releases.push(registerEditingModel({ scope, workspaceId: 'ws', path, model }));
    return model;
}
const canonical = async (_value: string) => 'src/Mixed.ts';
const signal = () => new AbortController().signal;

describe('Peek editing model identity', () => {
    it('returns the live dirty model; a split view receives the same object', async () => {
        const live = register('clone-a/chat-a', 'src/Mixed.ts');
        const target = await resolveEditingTarget('clone-a/chat-a', 'src/mixed.ts', canonical, signal());
        expect(target.entry?.model).toBe(live);
        expect(target.entry?.model.getValue?.()).toBe('unsaved text');
        const split = target.entry!.model;
        split.setValue('edit from split');
        expect(live.getValue()).toBe('edit from split');
    });

    it('does not share a model with another clone or chat session', async () => {
        register('clone-a/chat-a', 'src/Mixed.ts');
        expect((await resolveEditingTarget('clone-b/chat-a', 'src/mixed.ts', canonical, signal())).entry).toBeUndefined();
        expect((await resolveEditingTarget('clone-a/chat-b', 'src/mixed.ts', canonical, signal())).entry).toBeUndefined();
    });

    it('stops for pre-existing aliases without changing either dirty model', async () => {
        const a = register('same', 'src/Mixed.ts', 'edit A');
        const b = register('same', 'src/mixed.ts', 'edit B');
        await expect(resolveEditingTarget('same', 'src/mixed.ts', canonical, signal())).rejects.toThrow('Multiple open buffers');
        expect(a.getValue()).toBe('edit A');
        expect(b.getValue()).toBe('edit B');
    });

    it('rechecks panes which mount during resolution', async () => {
        let live: ReturnType<typeof register>;
        let first = true;
        const target = await resolveEditingTarget('same', 'src/mixed.ts', async path => {
            if (first) { first = false; live = register('same', 'src/Mixed.ts'); }
            return canonical(path);
        }, signal());
        expect(target.entry?.model).toBe(live!);
    });

    it('grants navigation to a verified cross-member model only for its initiating editor', async () => {
        const source = register('member-a/chat-a', 'source.ts');
        const otherSource = register('member-a/chat-b', 'source.ts');
        const target = await resolveEditingTarget('member-b/chat-a', 'src/mixed.ts', canonical, signal());
        expect(target.entry).toBeUndefined();
        const live = register('member-b/chat-a', 'src/Mixed.ts');
        const verified = await resolveEditingTarget('member-b/chat-a', 'src/mixed.ts', canonical, signal());
        allowEditingModelTarget(source, verified.entry!);
        expect(editingModelTarget(source, live.uri.toString())).toEqual({ workspaceId: 'ws', path: 'src/Mixed.ts' });
        expect(editingModelTarget(otherSource, live.uri.toString())).toBeNull();
        allowEditingModelTarget(source, verified.entry!, true);
        expect(editingModelTarget(source, live.uri.toString())).toMatchObject({ symbolCandidate: true });
        allowEditingModelTarget(source, verified.entry!);
        expect(editingModelTarget(source, live.uri.toString())).not.toHaveProperty('symbolCandidate');
        releases.pop()!();
        expect(editingModelTarget(source, live.uri.toString())).toBeNull();
    });
});
