import { useEffect, useState, useSyncExternalStore } from 'react';
import type { BrowserNavigationAnswer } from '@plusplusoneplusplus/coc-client';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { lookupCloneBaseUrl } from '../../repos/cloneRegistry';
import {
    getBrowserNavigationPrompts, hostBrowserNavigationPrompts, isBrowserNavigationPromptHosted,
    subscribeBrowserNavigationPrompts, type BrowserNavigationPromptEntry,
} from './browser-navigation-prompts';

const usePrompts = () => useSyncExternalStore(subscribeBrowserNavigationPrompts, getBrowserNavigationPrompts, getBrowserNavigationPrompts);

/** Asks whether the agent may open a page on a root domain this conversation has not approved. */
export function BrowserNavigationApprovalCard({ prompt }: { prompt: BrowserNavigationPromptEntry }) {
    const [answered, setAnswered] = useState(false);
    const answer = (value: BrowserNavigationAnswer) => {
        setAnswered(true);
        prompt.answer(value);
    };
    const button = 'rounded px-2 py-0.5 text-xs disabled:opacity-50';
    return <div role="alert" data-testid="browser-navigation-approval"
        className="rounded-md border border-amber-300 bg-amber-50/80 p-3 text-sm text-[#1f2328] dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-[#cccccc]">
        <div>AI browser control wants to open a page on <strong data-testid="browser-navigation-site">{prompt.site}</strong>.</div>
        <div className="mt-1 break-all font-mono text-[12px] text-[#57606a] dark:text-[#9d9d9d]" data-testid="browser-navigation-url">{prompt.url}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" data-testid="browser-navigation-allow-once" disabled={answered} onClick={() => answer('once')}
                className={`${button} bg-[#0969da] text-white hover:bg-[#0860c4]`}>Allow once</button>
            <button type="button" data-testid="browser-navigation-allow-always" disabled={answered} onClick={() => answer('always')}
                className={`${button} border border-[#e0e0e0] dark:border-[#3c3c3c] hover:bg-black/5 dark:hover:bg-white/5`}>Always allow {prompt.site}</button>
            <button type="button" data-testid="browser-navigation-deny" disabled={answered} onClick={() => answer('deny')}
                className={`${button} border border-[#e0e0e0] dark:border-[#3c3c3c] text-[#cf222e] hover:bg-black/5 dark:hover:bg-white/5`}>Deny</button>
        </div>
    </div>;
}

/** The conversation's waiting navigation prompts, shown inline in its chat. */
export function BrowserNavigationPrompts({ workspaceId, processId, sourceBaseUrl }: { workspaceId?: string; processId?: string; sourceBaseUrl?: string }) {
    const prompts = usePrompts();
    const clone = workspaceId ? parseRemoteCloneKey(workspaceId) : null;
    const rawWorkspace = clone?.workspaceId ?? workspaceId;
    const baseUrl = sourceBaseUrl ?? (clone ? lookupCloneBaseUrl(workspaceId!) : undefined);
    useEffect(() => rawWorkspace && processId ? hostBrowserNavigationPrompts(baseUrl, rawWorkspace, processId) : undefined,
        [baseUrl, rawWorkspace, processId]);
    const mine = prompts.filter(prompt => prompt.processId === processId && prompt.workspaceId === rawWorkspace
        && (prompt.sourceBaseUrl ?? undefined) === baseUrl);
    if (!mine.length) return null;
    return <div className="flex flex-col gap-2" data-testid="browser-navigation-prompts">
        {mine.map(prompt => <BrowserNavigationApprovalCard key={prompt.key} prompt={prompt} />)}
    </div>;
}

/** Prompts of conversations whose chat is not on screen, so a waiting turn is never invisible. */
export function FloatingBrowserNavigationPrompts() {
    const prompts = usePrompts().filter(prompt => !isBrowserNavigationPromptHosted(prompt));
    if (!prompts.length) return null;
    return <div className="fixed bottom-4 left-4 z-[60] flex flex-col gap-2 max-w-sm shadow-lg">
        {prompts.map(prompt => <BrowserNavigationApprovalCard key={prompt.key} prompt={prompt} />)}
    </div>;
}
