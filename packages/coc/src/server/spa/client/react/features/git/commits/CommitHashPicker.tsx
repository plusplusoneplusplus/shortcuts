import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { CommitDetailIcon } from './CommitDetailIcon';
import type { GitCommitItem } from './commitListTypes';

/** Abbreviated (7+) or full hex SHA, matching the Git tab's direct lookup. */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/;
const RECENT_LIMIT = 20;

/** A non-commit view of the same repository the picker can switch to (branch changes, uncommitted changes). */
export interface CommitPickerView {
    id: string;
    label: string;
    detail?: string;
    onSelect: () => void;
}

/** Host-owned commit switching for the review header; every call stays on the owning workspace/server. */
export interface CommitPickerOptions {
    /** Recently loaded commits of the owning workspace. */
    commits: GitCommitItem[];
    loading?: boolean;
    /** Re-read the owning repository through the host's refresh flow. */
    onRefresh?: () => void;
    error?: string | null;
    /** Server lookup for a SHA outside `commits`; absent when direct lookup is off. */
    lookup?: (sha: string) => Promise<GitCommitItem>;
    /** Opens the commit in the same review surface. */
    onSelect: (commit: GitCommitItem) => void;
    /** Other views of the same repository, listed above the recent commits. */
    views?: readonly CommitPickerView[];
}

type LookupState = { status: 'idle' | 'busy' } | { status: 'error'; message: string };

/** Short-hash trigger with a recent-commit list and a SHA field; the copy action stays a separate control. */
export function CommitHashPicker({ hash, picker }: { hash: string; picker: CommitPickerOptions }) {
    const [open, setOpen] = useState(false);
    const [sha, setSha] = useState('');
    const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
    const [position, setPosition] = useState({ width: 0, left: 0, top: 0 });
    const id = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const generationRef = useRef(0);
    const recent = picker.commits.slice(0, RECENT_LIMIT);

    // A late lookup must not navigate after the picker closed or unmounted.
    useEffect(() => () => { generationRef.current += 1; }, []);
    useEffect(() => {
        if (!open) return;
        inputRef.current?.focus();
        const close = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) dismiss(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);
    // Portaled outside the clipped identity area; clamped to the viewport for narrow panes.
    useLayoutEffect(() => {
        if (!open) return;
        const update = () => {
            const anchor = triggerRef.current?.getBoundingClientRect();
            const panel = panelRef.current?.getBoundingClientRect();
            if (!anchor || !panel) return;
            setPosition({
                width: triggerRef.current?.closest('.git-file-review')?.getBoundingClientRect().width ?? 0,
                left: Math.max(8, Math.min(anchor.left, window.innerWidth - panel.width - 8)),
                top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - panel.height - 8)),
            });
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
    }, [open]);

    function dismiss(returnFocus: boolean) {
        generationRef.current += 1;
        setOpen(false);
        setSha('');
        setLookup({ status: 'idle' });
        if (returnFocus) triggerRef.current?.focus();
    }
    function choose(commit: GitCommitItem) {
        dismiss(true);
        if (commit.hash !== hash) picker.onSelect(commit);
    }
    function chooseView(view: CommitPickerView) {
        dismiss(true);
        view.onSelect();
    }
    function submit() {
        const value = sha.trim().toLowerCase();
        if (!SHA_PATTERN.test(value)) {
            setLookup({ status: 'error', message: 'Enter 7–40 hex characters of a commit SHA' });
            return;
        }
        const matches = picker.commits.filter(c => c.hash.toLowerCase().startsWith(value));
        if (matches.length === 1) { choose(matches[0]); return; }
        if (!picker.lookup) {
            setLookup({ status: 'error', message: matches.length > 1 ? 'Ambiguous SHA: add more characters' : 'No recent commit matches this SHA' });
            return;
        }
        const generation = generationRef.current += 1;
        setLookup({ status: 'busy' });
        picker.lookup(value).then(
            commit => { if (generationRef.current === generation) choose(commit); },
            error => {
                if (generationRef.current !== generation) return;
                setLookup({ status: 'error', message: error instanceof CocApiError && error.status === 404
                    ? 'Commit not found or ambiguous SHA'
                    : `Could not look up commit: ${error?.message || 'unknown error'}` });
            });
    }
    function onPanelKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); return; }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const items = [inputRef.current, ...Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-commit-option]') ?? [])]
            .filter((item): item is HTMLElement => !!item);
        const index = items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }

    const short = hash.slice(0, 8);
    const busy = lookup.status === 'busy';
    let listState: ReactNode = null;
    if (picker.loading) {
        listState = <p role="status" className="git-review-muted px-1 py-1">Loading recent commits…</p>;
    } else if (picker.error) {
        listState = <p role="alert" className="px-1 py-1 text-red-600 dark:text-red-400">Could not load recent commits: {picker.error}</p>;
    } else if (recent.length === 0) {
        listState = <p className="git-review-muted px-1 py-1">No recent commits</p>;
    }

    return <>
        <button type="button" ref={triggerRef} className="git-review-hash-trigger" onClick={() => open ? dismiss(false) : setOpen(true)}
            aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
            aria-label={`Commit ${short}: switch commit`} title={`Switch commit · ${hash}`} data-testid="commit-hash-picker-trigger">
            {/* Narrow panes keep a chevron-only trigger; the hash stays in its accessible name. */}
            <span className="git-review-hash git-review-md">{short}</span>
            <CommitDetailIcon name={open ? 'up' : 'down'} />
        </button>
        {open && createPortal(<div className="git-file-review git-review-menu-layer" style={{ width: position.width }}>
            <div ref={panelRef} id={id} role="dialog" aria-label="Switch commit" className="git-review-menu git-review-commit-picker"
                style={{ left: position.left, top: position.top }} onKeyDown={onPanelKeyDown} data-testid="commit-hash-picker">
                <form onSubmit={event => { event.preventDefault(); submit(); }} className="git-review-commit-picker-form">
                    <input ref={inputRef} type="text" value={sha} disabled={busy} spellCheck={false} autoComplete="off"
                        placeholder="Commit SHA" aria-label="Commit SHA" aria-invalid={lookup.status === 'error'}
                        aria-describedby={lookup.status === 'idle' ? undefined : `${id}-lookup`}
                        onChange={event => { setSha(event.target.value); if (lookup.status === 'error') setLookup({ status: 'idle' }); }}
                        data-testid="commit-hash-picker-input" />
                    <button type="submit" disabled={busy || !sha.trim()} data-testid="commit-hash-picker-submit">Open</button>
                </form>
                {busy && <p id={`${id}-lookup`} role="status" className="git-review-muted px-1 py-1">Looking up commit…</p>}
                {lookup.status === 'error' && <p id={`${id}-lookup`} role="alert" className="px-1 py-1 text-red-600 dark:text-red-400"
                    data-testid="commit-hash-picker-error">{lookup.message}</p>}
                {picker.views && picker.views.length > 0 && <ul aria-label="Other changes" className="git-review-commit-picker-list">
                    {picker.views.map(view => <li key={view.id}>
                        <button type="button" data-commit-option disabled={busy} className="git-review-menu-item"
                            onClick={() => chooseView(view)} title={view.detail ? `${view.label} · ${view.detail}` : view.label}
                            data-testid={`commit-hash-picker-view-${view.id}`}>
                            <span className="git-review-commit-picker-check" />
                            <span className="git-review-commit-picker-subject">{view.label}</span>
                            {view.detail && <span className="git-review-muted">{view.detail}</span>}
                        </button>
                    </li>)}
                </ul>}
                {picker.onRefresh && <button type="button" className="git-review-menu-item"
                    onClick={picker.onRefresh} disabled={picker.loading || busy}
                    aria-label="Refresh recent commits" title="Refresh recent commits">
                    Refresh recent commits
                </button>}
                {listState}
                {recent.length > 0 && <ul aria-label="Recent commits" className="git-review-commit-picker-list">
                    {recent.map(commit => {
                        const current = commit.hash === hash;
                        return <li key={commit.hash}>
                            <button type="button" data-commit-option aria-current={current ? 'true' : undefined} disabled={busy}
                                className="git-review-menu-item" onClick={() => choose(commit)} title={commit.subject}
                                data-testid={`commit-hash-picker-option-${commit.hash}`}>
                                <span className="git-review-commit-picker-check">{current && <CommitDetailIcon name="check" />}</span>
                                <span className="git-review-hash">{commit.shortHash || commit.hash.slice(0, 7)}</span>
                                <span className="git-review-commit-picker-subject">{commit.subject}</span>
                            </button>
                        </li>;
                    })}
                </ul>}
            </div>
        </div>, document.body)}
    </>;
}
