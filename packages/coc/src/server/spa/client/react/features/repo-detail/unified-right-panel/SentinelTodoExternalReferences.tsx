import { useSyncExternalStore } from 'react';
import type { SentinelTodoExternalReference, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { parsePullRequestUrl } from '@plusplusoneplusplus/coc-client';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isFeatureEnabled } from '../../../utils/config';
import { requestPanelBrowserTab } from '../../../shared/file-path/browser-bridge';
import { Button } from '../../../ui/Button';

function subscribeConfig(listener: () => void) {
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
    return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
}
const enabled = () => isFeatureEnabled('sentinelTodoExternalReferencesEnabled');
export function useSentinelTodoExternalReferencesEnabled() {
    return useSyncExternalStore(subscribeConfig, enabled, enabled);
}

export function externalReferences(item: SentinelTodoItem): SentinelTodoExternalReference[] {
    return item.references?.filter((reference): reference is SentinelTodoExternalReference =>
        reference.kind === 'pr' || reference.kind === 'email' || reference.kind === 'link') ?? [];
}

function safeUrl(reference: SentinelTodoExternalReference): URL | null {
    try {
        const url = new URL(reference.url);
        return url.protocol === 'https:' || url.protocol === 'http:'
            || (reference.kind === 'email' && url.protocol === 'mailto:') ? url : null;
    } catch {
        return null;
    }
}

function referenceLabel(reference: SentinelTodoExternalReference, url: URL): string {
    if (reference.kind === 'pr') {
        const parsed = parsePullRequestUrl(reference.url);
        if (parsed) return `${parsed.provider === 'github' ? 'GitHub' : 'Azure DevOps'} · ${parsed.repoPath} #${parsed.number}`;
    }
    return reference.title?.trim() || (url.protocol === 'mailto:' ? url.pathname : `${url.host}${url.pathname === '/' ? '' : url.pathname}`);
}

export function SentinelTodoExternalReferences({ item }: { item: SentinelTodoItem }) {
    const show = useSentinelTodoExternalReferencesEnabled();
    if (!show) return null;
    const references = externalReferences(item).flatMap(reference => {
        const url = safeUrl(reference);
        return url ? [{ reference, url }] : [];
    });
    if (!references.length) return null;
    return <ul aria-label={`External references for ${item.title}`} className="flex flex-wrap gap-x-2 gap-y-1 px-2 pb-1.5 text-[11px]">
        {references.map(({ reference, url }, index) => <li key={`${reference.kind}:${reference.url}:${index}`} className="min-w-0 max-w-full">
            <a href={reference.url} target="_blank" rel="noopener noreferrer" draggable={false}
                title={reference.title ? `${reference.title}\n${reference.url}` : reference.url}
                className="inline-flex max-w-full items-baseline gap-1 rounded text-[#0078d4] hover:underline focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:text-[#3794ff]"
                onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => {
                    event.stopPropagation();
                    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
                        && url.protocol !== 'mailto:' && requestPanelBrowserTab(reference.url)) event.preventDefault();
                }}>
                <span className="shrink-0 font-medium">{reference.kind === 'pr' ? 'PR' : reference.kind === 'email' ? 'Email' : 'Link'}</span>{' '}
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">{referenceLabel(reference, url)}</span>
            </a>
        </li>)}
    </ul>;
}

export function SentinelTodoExternalReferenceEditor({ value, onChange, idPrefix, inputClass }: {
    value: SentinelTodoExternalReference[];
    onChange: (references: SentinelTodoExternalReference[]) => void;
    idPrefix: string;
    inputClass: string;
}) {
    const change = (index: number, patch: Partial<SentinelTodoExternalReference>) =>
        onChange(value.map((reference, at) => at === index ? { ...reference, ...patch } : reference));
    return <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="text-[11px] font-medium">External references</legend>
        {value.map((reference, index) => <div key={index} className="flex min-w-0 flex-col gap-1 rounded border border-[#e0e0e0] p-1 dark:border-[#3c3c3c]">
            <label htmlFor={`${idPrefix}-ref-${index}-kind`}>Reference {index + 1} type</label>
            <select id={`${idPrefix}-ref-${index}-kind`} className={inputClass} value={reference.kind}
                onChange={event => change(index, { kind: event.target.value as SentinelTodoExternalReference['kind'] })}>
                <option value="pr">Pull request</option><option value="email">Email</option><option value="link">Link</option>
            </select>
            <label htmlFor={`${idPrefix}-ref-${index}-url`}>Reference {index + 1} URL</label>
            <input id={`${idPrefix}-ref-${index}-url`} className={inputClass} value={reference.url} required maxLength={2000}
                onChange={event => change(index, { url: event.target.value })} />
            <label htmlFor={`${idPrefix}-ref-${index}-title`}>Reference {index + 1} title (optional)</label>
            <input id={`${idPrefix}-ref-${index}-title`} className={inputClass} value={reference.title ?? ''} maxLength={200}
                onChange={event => change(index, { title: event.target.value || undefined })} />
            <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, at) => at !== index))}>Remove reference {index + 1}</Button>
        </div>)}
        <Button size="sm" variant="secondary" disabled={value.length >= 20}
            onClick={() => onChange([...value, { kind: 'link', url: '' }])}>Add reference</Button>
    </fieldset>;
}
