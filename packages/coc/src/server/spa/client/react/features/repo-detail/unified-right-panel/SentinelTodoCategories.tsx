import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { CocClient, SentinelTodoCategory, SentinelTodoCategorySet, SentinelTodoCategoryUsage } from '@plusplusoneplusplus/coc-client';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isFeatureEnabled } from '../../../utils/config';
import type { SentinelTodoOwner } from './sentinelTodoPanelModel';

function subscribeConfig(listener: () => void) {
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
    return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
}
const categoriesEnabled = () => isFeatureEnabled('sentinelTodoCategoriesEnabled');

/** The caller pins the client and remounts when its owner or transport changes. */
export function useSentinelTodoCategories(owner: SentinelTodoOwner, client: CocClient, unavailable: boolean) {
    const enabled = useSyncExternalStore(subscribeConfig, categoriesEnabled, categoriesEnabled);
    const [categorySet, setCategorySet] = useState<SentinelTodoCategorySet>();
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const sequence = useRef(0);
    const apply = useCallback((next: SentinelTodoCategorySet) => {
        setCategorySet(current => !current || next.revision >= current.revision ? next : current);
    }, []);
    const reload = useCallback(async () => {
        if (!enabled) return;
        const ticket = ++sequence.current;
        if (unavailable) {
            setError('Owning server is not connected.');
            return;
        }
        setLoading(true);
        try {
            const next = await client.sentinelTodos.getCategories(owner.ownerWorkspaceId, owner.processId);
            if (ticket !== sequence.current) return;
            apply(next);
            setError(null);
        } catch (failure) {
            if (ticket === sequence.current) setError(failure instanceof Error ? failure.message : 'Could not load categories.');
        } finally {
            if (ticket === sequence.current) setLoading(false);
        }
    }, [enabled, unavailable, client, owner.ownerWorkspaceId, owner.processId, apply]);
    useEffect(() => {
        setCategorySet(undefined);
        setError(null);
        setLoading(false);
        void reload();
        return () => { sequence.current++; };
    }, [reload]);
    return { enabled, categorySet, loading, error, reload, apply };
}

type CategoryState = ReturnType<typeof useSentinelTodoCategories>;

export function SentinelTodoCategoryToolbar({ state, owner, client, onLedgerChange }: {
    state: CategoryState; owner: SentinelTodoOwner; client: CocClient; onLedgerChange: () => Promise<void>;
}) {
    const [manage, setManage] = useState(false);
    if (!state.enabled) return null;
    return <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Button size="sm" variant="secondary" disabled={!state.categorySet} onClick={() => setManage(true)}>Manage categories</Button>
        {state.categorySet && <span className="text-[11px] text-[#848484]">{state.categorySet.categories.length} categor{state.categorySet.categories.length === 1 ? 'y' : 'ies'}</span>}
        {state.error && <span role="alert" className="text-[11px] text-[#c72e2e] dark:text-[#f48771]">Could not load categories: {state.error}</span>}
        {!state.categorySet && !state.error && <span role="status">Loading categories...</span>}
        {(state.error || !state.categorySet) && <Button size="sm" variant="secondary" disabled={state.loading}
            onClick={() => { void state.reload(); }}>Retry categories</Button>}
        {manage && state.categorySet && <CategoryManager categorySet={state.categorySet} owner={owner} client={client}
            apply={state.apply} reload={state.reload} onLedgerChange={onLedgerChange} onClose={() => setManage(false)} />}
    </div>;
}

const INPUT = 'w-full rounded border border-[#e0e0e0] bg-white px-2 py-1 text-xs dark:border-[#3c3c3c] dark:bg-[#1e1e1e]';

function CategoryManager({ categorySet, owner, client, apply, reload, onLedgerChange, onClose }: {
    categorySet: SentinelTodoCategorySet; owner: SentinelTodoOwner; client: CocClient;
    apply: CategoryState['apply']; reload: CategoryState['reload']; onLedgerChange: () => Promise<void>; onClose: () => void;
}) {
    const id = useId();
    const [editor, setEditor] = useState<SentinelTodoCategory | 'new' | null>(null);
    const [name, setName] = useState('');
    const [editorRevision, setEditorRevision] = useState(categorySet.revision);
    const [deleting, setDeleting] = useState<{ category: SentinelTodoCategory; revision: number; usage: SentinelTodoCategoryUsage } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pending = useRef(false);
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const run = async (action: () => Promise<void>) => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError(null);
        try {
            await action();
        } catch (failure) {
            if (!mounted.current) return;
            const conflict = typeof failure === 'object' && failure !== null && 'status' in failure && failure.status === 409;
            setError(conflict ? 'Categories changed. Review the refreshed list and save again; your draft is kept.'
                : `Could not save categories: ${failure instanceof Error ? failure.message : 'Unknown error'}. Your draft is kept.`);
            if (conflict) {
                setDeleting(null);
                await reload();
            }
        } finally {
            pending.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    const edit = (category: SentinelTodoCategory | 'new') => {
        setDeleting(null);
        setEditor(category);
        setEditorRevision(categorySet.revision);
        setName(category === 'new' ? '' : category.name);
        setError(null);
    };
    const args = [owner.ownerWorkspaceId, owner.processId] as const;
    const save = () => run(async () => {
        if (!editor) return;
        const request = { expectedRevision: editorRevision, name: name.trim() };
        const next = editor === 'new' ? await client.sentinelTodos.createCategory(...args, request)
            : await client.sentinelTodos.updateCategory(...args, editor.id, request);
        if (!mounted.current) return;
        apply(next);
        setEditor(null);
    });
    const move = (index: number, direction: number) => run(async () => {
        const categoryIds = categorySet.categories.map(category => category.id);
        [categoryIds[index], categoryIds[index + direction]] = [categoryIds[index + direction], categoryIds[index]];
        const next = await client.sentinelTodos.reorderCategories(...args, { expectedRevision: categorySet.revision, categoryIds });
        if (mounted.current) apply(next);
    });
    const previewDelete = (category: SentinelTodoCategory) => run(async () => {
        setEditor(null);
        setDeleting(null);
        const usage = await client.sentinelTodos.getCategoryUsage(...args, category.id);
        if (mounted.current) setDeleting({ category, revision: categorySet.revision, usage });
    });
    return <Dialog open trapFocus title="Manage categories" disableClose={busy} onClose={() => { if (!pending.current) onClose(); }}>
        <p className="text-xs">Categories are shared by every Sentinel chat in this workspace. Add up to 12 categories.</p>
        {error && <p role="alert" className="text-xs text-[#c72e2e] dark:text-[#f48771]">{error}</p>}
        <ul className="flex min-h-0 flex-col gap-1 overflow-auto" aria-label="Workspace categories">
            {categorySet.categories.map((category, index) => <li key={category.id} className="flex flex-wrap items-center gap-1 rounded border border-[#848484]/30 p-1">
                <span className="min-w-0 flex-1 break-words text-xs">{category.name}</span>
                <Button size="sm" variant="ghost" aria-label={`Move ${category.name} up`} disabled={busy || index === 0} onClick={() => { void move(index, -1); }}>↑</Button>
                <Button size="sm" variant="ghost" aria-label={`Move ${category.name} down`} disabled={busy || index === categorySet.categories.length - 1} onClick={() => { void move(index, 1); }}>↓</Button>
                <Button size="sm" variant="secondary" disabled={busy} aria-label={`Rename ${category.name}`} onClick={() => edit(category)}>Rename</Button>
                <Button size="sm" variant="ghost" disabled={busy} aria-label={`Delete ${category.name}`} onClick={() => { void previewDelete(category); }}>Delete</Button>
            </li>)}
        </ul>
        {categorySet.categories.length === 0 && <p className="text-xs">No categories yet.</p>}
        <Button size="sm" variant="secondary" disabled={busy || categorySet.categories.length >= 12} onClick={() => edit('new')}>Add category</Button>
        {editor && <form aria-label={editor === 'new' ? 'Add category' : 'Rename category'} className="flex flex-col gap-2"
            onSubmit={event => { event.preventDefault(); void save(); }}>
            <label className="text-xs" htmlFor={`${id}-name`}>Category name</label>
            <input id={`${id}-name`} className={INPUT} value={name} maxLength={40} required disabled={busy}
                onChange={event => setName(event.target.value)} />
            {editor !== 'new' && !categorySet.categories.some(category => category.id === editor.id)
                && <p role="status">This category was deleted. Cancel and choose another category.</p>}
            {editorRevision !== categorySet.revision && <div role="status" className="text-xs">
                Categories changed. Your draft is kept.
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditorRevision(categorySet.revision)}>Use current category revision</Button>
            </div>}
            <div className="flex gap-1">
                <Button size="sm" type="submit" disabled={busy || !name.trim() || editorRevision !== categorySet.revision || (editor !== 'new' && !categorySet.categories.some(category => category.id === editor.id))}>Save category</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditor(null)}>Cancel category edit</Button>
            </div>
        </form>}
        {deleting && <div role="group" aria-label="Confirm category deletion" className="flex flex-col gap-2 text-xs">
            <p>Delete {deleting.category.name}? {deleting.usage.itemCount} item{deleting.usage.itemCount === 1 ? '' : 's'} in {deleting.usage.chatCount} chat{deleting.usage.chatCount === 1 ? '' : 's'} will move to Uncategorized.</p>
            {deleting.revision !== categorySet.revision && <p role="status">Categories changed. Cancel and preview deletion again.</p>}
            <div className="flex gap-1">
                <Button size="sm" disabled={busy || deleting.revision !== categorySet.revision} onClick={() => { void run(async () => {
                    const result = await client.sentinelTodos.deleteCategory(...args, deleting.category.id, { expectedRevision: deleting.revision, confirmed: true });
                    if (!mounted.current) return;
                    apply(result.categorySet);
                    setDeleting(null);
                    await onLedgerChange();
                }); }}>Confirm delete category</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep category</Button>
            </div>
        </div>}
        <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Close categories</Button>
    </Dialog>;
}
