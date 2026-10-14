import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { CocClient, SentinelTodoItem, SentinelTodoTag, SentinelTodoTagLibrary } from '@plusplusoneplusplus/coc-client';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isFeatureEnabled } from '../../../utils/config';
import { sentinelTodoOwnerKey, type SentinelTodoOwner } from './sentinelTodoPanelModel';
import './sentinelTodoTags.css';

function subscribeConfig(listener: () => void) {
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
    return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
}
const tagsEnabled = () => isFeatureEnabled('sentinelTodoTagsEnabled');
export function useSentinelTodoTagsEnabled() {
    return useSyncExternalStore(subscribeConfig, tagsEnabled, tagsEnabled);
}

export function sentinelTodoMatchesTag(item: SentinelTodoItem, filter: string, library?: SentinelTodoTagLibrary): boolean {
    const ids = item.tagIds?.filter(id => library?.tags.some(tag => tag.id === id)) ?? [];
    return filter === '' || (filter === 'untagged' ? ids.length === 0 : ids.includes(filter));
}

export function SentinelTodoTagChips({ item, library }: { item: SentinelTodoItem; library: SentinelTodoTagLibrary }) {
    return <span className="sentinel-tags-chips" aria-label="Tags">
        {library.tags.filter(tag => item.tagIds?.includes(tag.id)).map(tag =>
            <span key={tag.id} className="sentinel-tag-chip" data-color={tag.color} title={tag.description}>{tag.name}</span>)}
    </span>;
}

type TagScope = {
    owner: SentinelTodoOwner;
    client: CocClient;
    library: SentinelTodoTagLibrary;
    onLedgerChange: () => Promise<void>;
};

/** Tag actions never own or reset the item's text/status editor. */
function useTagAction(scope: TagScope) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pending = useRef(false);
    const generation = useRef(0);
    const key = sentinelTodoOwnerKey(scope.owner);
    useEffect(() => {
        generation.current++;
        return () => { generation.current++; };
    }, [key, scope.client]);
    const run = async (action: () => Promise<unknown>, done: () => void) => {
        if (pending.current) return;
        pending.current = true;
        const current = generation.current;
        const live = () => generation.current === current;
        setBusy(true);
        setError(null);
        try {
            await action();
            if (!live()) return;
            await scope.onLedgerChange();
            if (live()) done();
        } catch (failure) {
            if (!live()) return;
            const conflict = typeof failure === 'object' && failure !== null && 'status' in failure && failure.status === 409;
            setError(conflict
                ? 'Tags changed. Review the refreshed list and save again; your draft is kept.'
                : `Could not save tags: ${failure instanceof Error ? failure.message : 'Unknown error'}. Your draft is kept.`);
            if (conflict) await scope.onLedgerChange();
        } finally {
            pending.current = false;
            if (live()) setBusy(false);
        }
    };
    return { busy, error, run };
}

export function SentinelTodoTagToolbar({ filter, onFilter, multiple, onMultiple, library, ...scope }: Omit<TagScope, 'library'> & {
    library?: SentinelTodoTagLibrary;
    filter: string; onFilter: (filter: string) => void;
    multiple: boolean; onMultiple: (multiple: boolean) => void;
}) {
    const id = useId();
    const [manage, setManage] = useState(false);
    return <div className="sentinel-tags-toolbar">
        <label htmlFor={`${id}-filter`}>Tag</label>
        <select id={`${id}-filter`} value={filter} onChange={event => onFilter(event.target.value)} disabled={!library}>
            <option value="">All tags</option>
            <option value="untagged">Untagged</option>
            {library?.tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
        <Button size="sm" variant="secondary" disabled={!library} onClick={() => setManage(true)}>Manage tags</Button>
        <label className="sentinel-tags-multiple">
            <input type="checkbox" checked={multiple} disabled={!library} onChange={event => onMultiple(event.target.checked)} />
            Match multiple tags
        </label>
        {!library && <span role="status" className="sentinel-tags-muted">Tags unavailable for this ledger.</span>}
        {manage && library && <TagManager {...scope} library={library} onClose={() => setManage(false)} />}
    </div>;
}

function TagManager({ onClose, ...scope }: TagScope & { onClose: () => void }) {
    const { library, client, owner } = scope;
    const id = useId();
    const [editor, setEditor] = useState<SentinelTodoTag | 'new' | null>(null);
    const [editorRevision, setEditorRevision] = useState(library.revision);
    const [name, setName] = useState('');
    const [color, setColor] = useState<SentinelTodoTag['color']>('gray');
    const [description, setDescription] = useState('');
    const [deleting, setDeleting] = useState<{ tag: SentinelTodoTag; revision: number } | null>(null);
    const { busy, error, run } = useTagAction(scope);
    const edit = (tag: SentinelTodoTag | 'new') => {
        setDeleting(null);
        setEditor(tag);
        setEditorRevision(library.revision);
        setName(tag === 'new' ? '' : tag.name);
        setColor(tag === 'new' ? 'gray' : tag.color);
        setDescription(tag === 'new' ? '' : tag.description ?? '');
    };
    return <Dialog open trapFocus disableClose={busy} title="Manage tags" onClose={() => { if (!busy) onClose(); }}>
        <div className="sentinel-tags-manager">
            <p className="sentinel-tags-muted">Tags belong to this Sentinel's list. They never change item status or tracking authority.</p>
            {error && <p role="alert" className="sentinel-tags-error">{error}</p>}
            <ul aria-label="Tag library">
                {library.tags.map(tag => <li key={tag.id} className="sentinel-tags-library-row">
                    <span className="sentinel-tag-chip" data-color={tag.color} title={tag.description}>{tag.name}</span>
                    <Button size="sm" variant="ghost" disabled={busy} aria-label={`Edit tag ${tag.name}`} onClick={() => edit(tag)}>Edit</Button>
                    <Button size="sm" variant="ghost" disabled={busy} aria-label={`Delete tag ${tag.name}`} onClick={() => { setEditor(null); setDeleting({ tag, revision: library.revision }); }}>Delete</Button>
                </li>)}
            </ul>
            {!library.tags.length && <p className="sentinel-tags-muted">No tags yet. Add a named tag to start.</p>}
            {deleting && <div className="sentinel-tags-confirm" role="group" aria-label="Confirm tag deletion">
                <p>Delete "{deleting.tag.name}"? This removes it from every item in this list. Items and statuses are kept.</p>
                {deleting.revision !== library.revision && <p role="status">The tag library changed. Cancel deletion and select the current tag again.</p>}
                <div className="sentinel-tags-actions">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>Cancel deletion</Button>
                    <Button size="sm" disabled={busy || deleting.revision !== library.revision} onClick={() => { void run(() =>
                        client.sentinelTodos.deleteTag(owner.ownerWorkspaceId, owner.processId, deleting.tag.id,
                            { expectedRevision: deleting.revision, confirmed: true }), () => setDeleting(null)); }}>Confirm delete</Button>
                </div>
            </div>}
            {editor ? <form className="sentinel-tags-editor" aria-label={editor === 'new' ? 'Add tag' : 'Edit tag'} onSubmit={event => {
                event.preventDefault();
                if (!name.trim()) return;
                const request = { expectedRevision: editorRevision, name: name.trim(), color, description: description.trim() };
                void run(() => editor === 'new'
                    ? client.sentinelTodos.createTag(owner.ownerWorkspaceId, owner.processId, request)
                    : client.sentinelTodos.updateTag(owner.ownerWorkspaceId, owner.processId, editor.id, request), () => setEditor(null));
            }}>
                <label htmlFor={`${id}-name`}>Tag name</label>
                <input id={`${id}-name`} value={name} required maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} />
                <label htmlFor={`${id}-color`}>Tag color</label>
                <select id={`${id}-color`} value={color} disabled={busy} onChange={event => setColor(event.target.value as SentinelTodoTag['color'])}>
                    {(['gray', 'blue', 'violet', 'teal', 'amber'] as const).map(value => <option key={value} value={value}>{value}</option>)}
                </select>
                <label htmlFor={`${id}-description`}>Matching description (optional)</label>
                <textarea id={`${id}-description`} value={description} maxLength={1000} disabled={busy} onChange={event => setDescription(event.target.value)} />
                {editorRevision !== library.revision && <div role="status">
                    The tag library changed. Review the current tags before replacing your edit.
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditorRevision(library.revision)}>Use current library revision</Button>
                </div>}
                <div className="sentinel-tags-actions">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditor(null)}>Cancel tag edit</Button>
                    <Button size="sm" type="submit" disabled={busy || !name.trim()}>Save tag</Button>
                </div>
            </form> : <Button size="sm" variant="secondary" disabled={busy} onClick={() => edit('new')}>Add tag</Button>}
            <div className="sentinel-tags-actions"><Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Close tags</Button></div>
        </div>
    </Dialog>;
}

export function SentinelTodoTagPicker({ item, multiple, ...scope }: TagScope & { item: SentinelTodoItem; multiple: boolean }) {
    const { library, client, owner } = scope;
    const [draft, setDraft] = useState<{ ids: string[]; revision: number; tagRevision: number } | null>(null);
    const [confirm, setConfirm] = useState<{ revision: number; tagRevision: number } | null>(null);
    const { busy, error, run } = useTagAction(scope);
    const missingSelections = draft?.ids.some(id => !library.tags.some(tag => tag.id === id)) === true;
    const suggest = (confirmed = false) => {
        if (item.tagOrigin === 'manual' && !confirmed) {
            setConfirm({ revision: item.revision, tagRevision: item.tagRevision ?? 0 });
            return;
        }
        void run(() => client.sentinelTodos.suggestTags(owner.ownerWorkspaceId, owner.processId, item.id,
            { expectedRevision: confirmed && confirm ? confirm.revision : item.revision,
                expectedTagRevision: confirmed && confirm ? confirm.tagRevision : item.tagRevision ?? 0,
                multiple, ...(confirmed ? { confirmed: true } : {}) }), () => setConfirm(null));
    };
    const matchLabel = item.tagMatch?.state === 'failed' ? 'Tag suggestion failed'
        : item.tagMatch?.state === 'unavailable' ? 'Tag suggestions unavailable'
            : item.tagMatch?.state === 'no_match' ? 'No matching tag' : null;
    return <section className="sentinel-tags-detail" aria-label="Item tags" aria-busy={busy}>
        <div className="sentinel-tags-summary">
            <strong>Tags</strong>
            <SentinelTodoTagChips item={item} library={library} />
            {!(item.tagIds?.some(id => library.tags.some(tag => tag.id === id))) && <span className="sentinel-tags-muted">Untagged</span>}
            {item.tagOrigin && <span className="sentinel-tags-muted">{item.tagOrigin === 'manual' ? 'Manual tags' : 'Suggested tags'}</span>}
        </div>
        {matchLabel && <p role="status" className="sentinel-tags-muted">{matchLabel}{item.tagMatch?.message ? `: ${item.tagMatch.message}` : ''}</p>}
        {error && <p role="alert" className="sentinel-tags-error">{error}</p>}
        {draft ? <form className="sentinel-tags-editor" aria-label="Edit item tags" onSubmit={event => {
            event.preventDefault();
            void run(() => client.sentinelTodos.update(owner.ownerWorkspaceId, owner.processId, item.id,
                { expectedRevision: draft.revision, expectedTagRevision: draft.tagRevision, tagIds: draft.ids }), () => setDraft(null));
        }}>
            <fieldset disabled={busy}>
                <legend>Choose tags (manual override)</legend>
                {library.tags.map(tag => <label key={tag.id} className="sentinel-tags-choice">
                    <input type="checkbox" checked={draft.ids.includes(tag.id)} onChange={event => setDraft({
                        ...draft, ids: event.target.checked ? [...draft.ids, tag.id] : draft.ids.filter(id => id !== tag.id),
                    })} /><span className="sentinel-tag-chip" data-color={tag.color} title={tag.description}>{tag.name}</span>
                </label>)}
                {!library.tags.length && <span className="sentinel-tags-muted">Add tags in Manage tags first.</span>}
            </fieldset>
            {missingSelections && <div role="status">
                A selected tag was deleted. Remove unavailable selections before saving.
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDraft({
                    ...draft, ids: draft.ids.filter(id => library.tags.some(tag => tag.id === id)),
                })}>Remove deleted selections</Button>
            </div>}
            <div className="sentinel-tags-actions">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDraft({ ...draft, ids: [] })}>Clear tags</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel tag selection</Button>
                <Button size="sm" type="submit" disabled={busy || missingSelections}>Save tags</Button>
            </div>
            {(draft.revision !== item.revision || draft.tagRevision !== (item.tagRevision ?? 0)) && <div role="status">
                This item or its tags changed. Your tag selection is kept.
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDraft({
                    ...draft, revision: item.revision, tagRevision: item.tagRevision ?? 0,
                })}>Use current revision for tags</Button>
            </div>}
        </form> : <div className="sentinel-tags-actions">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
                setConfirm(null); setDraft({ ids: [...(item.tagIds ?? [])], revision: item.revision, tagRevision: item.tagRevision ?? 0 });
            }}>Edit tags</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => suggest()}>Re-suggest tags</Button>
        </div>}
        {confirm && <div className="sentinel-tags-confirm" role="group" aria-label="Replace manual tags">
            <p>Replace your manual tag selection with a new suggestion? This includes tags you explicitly cleared. Matching may return no tags.</p>
            {(confirm.revision !== item.revision || confirm.tagRevision !== (item.tagRevision ?? 0))
                && <p role="status">The item or its tags changed. Keep manual tags and request a new suggestion to review again.</p>}
            <div className="sentinel-tags-actions">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>Keep manual tags</Button>
                <Button size="sm" disabled={busy || confirm.revision !== item.revision || confirm.tagRevision !== (item.tagRevision ?? 0)}
                    onClick={() => suggest(true)}>Confirm re-suggest</Button>
            </div>
        </div>}
    </section>;
}
