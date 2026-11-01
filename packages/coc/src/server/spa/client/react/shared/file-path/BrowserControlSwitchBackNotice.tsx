import { useState, useSyncExternalStore } from 'react';
import { useAppOptional } from '../../contexts/AppContext';
import { useReposOptional } from '../../contexts/ReposContext';
import { getBrowserControlNotices, subscribeBrowserControlNotices, type BrowserControlNotice } from './browser-control-notice';

/** One notice per background browser-control turn whose actions need its tab on screen. */
export function BrowserControlSwitchBackNotices() {
    const notices = useSyncExternalStore(subscribeBrowserControlNotices, getBrowserControlNotices, getBrowserControlNotices);
    if (!notices.length) return null;
    return <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
        {notices.map(notice => <NoticeCard key={notice.key} notice={notice} />)}
    </div>;
}

function NoticeCard({ notice }: { notice: BrowserControlNotice }) {
    const repos = useReposOptional()?.repos ?? [];
    const processes: any[] = useAppOptional()?.state.processes ?? [];
    const [stopping, setStopping] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const repo = repos.find(r => r.workspace?.id === notice.routingRef) ?? repos.find(r => r.workspace?.id === notice.workspaceId);
    const workspaceName = repo?.workspace?.name ?? notice.workspaceId;
    const chatTitle = processes.find(p => p?.id === notice.processId)?.title;
    const stop = async () => {
        setStopping(true);
        setError(null);
        try { await notice.stop(); }
        catch { setError('Could not stop browser control. Try again.'); }
        finally { setStopping(false); }
    };
    return <div role="alert" data-testid="browser-control-notice"
        className="rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow-lg p-3 text-sm text-[#1f2328] dark:text-[#cccccc]">
        <div>
            AI browser control in <strong>{workspaceName}</strong>{chatTitle ? <> · <strong>{chatTitle}</strong></> : null} needs
            its browser tab on screen to run <strong>{notice.actions.join(', ')}</strong>.
        </div>
        <div className="mt-2 flex items-center gap-2">
            <button type="button" data-testid="browser-control-switch-back" onClick={notice.switchBack}
                className="rounded bg-[#0969da] text-white px-2 py-0.5 text-xs hover:bg-[#0860c4]">Switch back</button>
            <button type="button" data-testid="browser-control-notice-stop" onClick={() => { void stop(); }} disabled={stopping}
                className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] px-2 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/5">
                {stopping ? 'Stopping…' : 'Stop'}
            </button>
            {error && <span className="text-xs text-[#cf222e]">{error}</span>}
        </div>
    </div>;
}
