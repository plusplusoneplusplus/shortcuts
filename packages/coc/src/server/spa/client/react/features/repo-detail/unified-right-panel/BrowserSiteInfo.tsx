import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DESKTOP_BROWSER_PREFERENCES_HASH, type BrowserSiteInfo, type BrowserSiteInfoResult } from '../../../shared/file-path/browser-bridge';
import { NativeViewIcon, nativeViewIconButton } from './NativeViewTab';

/** Where site information comes from: an owned desktop view, a local preview, or nowhere. */
export type BrowserSiteInfoSource =
    | { kind: 'web'; load(): Promise<BrowserSiteInfoResult> }
    | { kind: 'local-file'; path: string }
    | { kind: 'unavailable'; message: string };

type Content =
    | { status: 'loading' }
    | { status: 'ready'; info: BrowserSiteInfo }
    | { status: 'local-file'; path: string }
    | { status: 'error'; message: string };

const icons = {
    sliders: <><path d="M2.5 5h5M11 5h2.5M2.5 11h2M8.5 11h5" /><circle cx="9.25" cy="5" r="1.75" /><circle cx="6.25" cy="11" r="1.75" /></>,
    close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
    lock: <><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>,
    warning: <><path d="M8 2.5 14 13.5H2Z" /><path d="M8 6.5v3M8 11.5h.01" /></>,
    info: <><circle cx="8" cy="8" r="5.5" /><path d="M8 7.5v3.5M8 5h.01" /></>,
    cookie: <><circle cx="8" cy="8" r="5.5" /><path d="M6 6.5h.01M9.5 9.5h.01M6.5 10.5h.01M10 6h.01" /></>,
    settings: <><circle cx="8" cy="8" r="2.25" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></>,
    file: <><path d="M4 1.5h5l3 3v10H4Z" /><path d="M9 1.5v3h3" /></>,
};

const toneClass = { neutral: 'text-[#424242] dark:text-[#c5c5c5]', warning: 'text-[#9a6700] dark:text-[#d7ba7d]', danger: 'text-[#a1260d] dark:text-[#f48771]' };

interface Row { id: string; icon: ReactNode; tone?: keyof typeof toneClass; title: string; details: ReactNode[] }

const localFileRow: Row = { id: 'connection', icon: icons.file, title: 'Local file', details: ['Read from disk. Not a network connection.'] };

const engineName = (engine: BrowserSiteInfo['engine']) => engine === 'webview2' ? 'WebView2' : 'Electron';
const formatDate = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function connectionRow(info: BrowserSiteInfo): Row {
    const row = (icon: ReactNode, tone: Row['tone'], title: string, ...details: ReactNode[]): Row => ({ id: 'connection', icon, tone, title, details });
    switch (info.connection) {
        case 'secure': return row(icons.lock, 'neutral', 'Connection is secure',
            `${engineName(info.engine)} verified this site's certificate when the page loaded.`,
            ...(info.certificate ? [`Issued to ${info.certificate.subject} by ${info.certificate.issuer}, valid until ${formatDate(info.certificate.validExpiry)}.`] : []),
            'Mixed content is not checked.');
        case 'https-unverified': return row(icons.info, 'neutral', 'Connection uses HTTPS',
            `${engineName(info.engine)} does not share certificate details with CoC, so the certificate is not confirmed here.`);
        case 'insecure': return row(icons.warning, 'warning', 'Connection is not secure',
            'This site uses HTTP. Information sent or received can be read or changed in transit.');
        case 'certificate-error': return row(icons.warning, 'danger', 'Certificate error',
            'The page did not load because its certificate could not be verified.');
        case 'failed': return row(icons.warning, 'neutral', 'Page did not load', 'No connection details are available.');
        case 'loading': return row(icons.info, 'neutral', 'Page is loading', 'Connection details appear after the page loads.');
        case 'local-file': return localFileRow;
        default: return row(icons.info, 'neutral', 'Connection details unavailable', 'No loaded page to describe.');
    }
}

function cookieDetails(cookies: BrowserSiteInfo['cookies']): string[] {
    if (!cookies.available) {
        if (cookies.reason === 'unsupported') return ['This desktop version cannot read cookies.'];
        if (cookies.reason === 'failed') return ['Cookies could not be read.'];
        return ['Available after a page loads.'];
    }
    const { count } = cookies;
    return [count === 0 ? 'No cookies are sent to this page.' : `${count} ${count === 1 ? 'cookie is' : 'cookies are'} sent to this page.`,
        'Values are not shown. Other site storage is not inspected.'];
}

function rows(content: Extract<Content, { status: 'ready' | 'local-file' }>): Row[] {
    if (content.status === 'local-file' || content.info.connection === 'local-file') return [
        localFileRow,
        { id: 'cookies', icon: icons.cookie, title: 'Cookies and site data', details: ['Runs in an isolated in-memory session, separate from your browser profile.'] },
        { id: 'settings', icon: icons.settings, title: 'Site settings', details: ['CoC has no site settings for local previews.'] },
    ];
    const { info } = content;
    return [
        connectionRow(info),
        { id: 'cookies', icon: icons.cookie, title: 'Cookies and site data', details: cookieDetails(info.cookies) },
        { id: 'settings', icon: icons.settings, title: 'Site settings', details: [
            'Camera, microphone, location, notifications and other permission requests are blocked for every site. CoC has no per-site exceptions.',
            <a key="preferences" className="text-[#005fb8] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc] dark:text-[#4daafc]"
                href={DESKTOP_BROWSER_PREFERENCES_HASH} data-site-info-dismiss>Desktop Preferences</a>,
        ] },
    ];
}

function failureMessage(result: Extract<BrowserSiteInfoResult, { ok: false }>): string {
    if (result.reason === 'busy' && result.message) return result.message;
    if (result.reason === 'not-found' || result.reason === 'bad-session') return 'This page is no longer open here.';
    return 'Site information is unavailable.';
}

/**
 * The leading "View site information" control of an address field and its popover. `scopeKey`
 * names the owner, view and document it describes: any change closes the popover and drops late replies.
 */
export function BrowserSiteInfoButton({ source, scopeKey, enabled }: {
    source: BrowserSiteInfoSource;
    scopeKey: string;
    enabled: boolean;
}) {
    const id = useId();
    const titleId = `${id}-title`;
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [content, setContent] = useState<Content>({ status: 'loading' });
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 0 });
    const request = useRef(0);
    const sourceRef = useRef(source);
    sourceRef.current = source;

    const close = (restoreFocus: boolean) => {
        request.current++;
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    };

    useEffect(() => {
        // Navigation, view or owner changes invalidate what is shown.
        const hadFocus = Boolean(panelRef.current?.contains(document.activeElement));
        close(hadFocus);
    }, [scopeKey, enabled]);

    const show = () => {
        const current = ++request.current;
        const from = sourceRef.current;
        setOpen(true);
        if (from.kind === 'local-file') { setContent({ status: 'local-file', path: from.path }); return; }
        if (from.kind === 'unavailable') { setContent({ status: 'error', message: from.message }); return; }
        setContent({ status: 'loading' });
        void from.load().then(result => {
            if (current !== request.current) return;
            setContent(result.ok ? { status: 'ready', info: result.info } : { status: 'error', message: failureMessage(result) });
        }).catch(() => {
            if (current === request.current) setContent({ status: 'error', message: 'Site information is unavailable.' });
        });
    };

    useLayoutEffect(() => {
        if (!open) return;
        const update = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.max(0, Math.min(300, window.innerWidth - 8));
            const left = Math.max(4, Math.min(rect.left - 4, window.innerWidth - width - 4));
            const top = rect.bottom + 6;
            setPosition({ top, left, width, maxHeight: Math.max(0, window.innerHeight - top - 4) });
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        panelRef.current?.focus();
        const outside = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close(false);
        };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open]);

    const title = content.status === 'ready' ? content.info.host || 'Site information'
        : content.status === 'local-file' ? content.path.split(/[\\/]/).pop() || content.path : 'Site information';

    return <>
        <button
            ref={triggerRef}
            type="button"
            className={nativeViewIconButton}
            aria-label="View site information"
            title="View site information"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onClick={() => open ? close(false) : show()}
            onKeyDown={event => {
                if (event.key === 'Escape' && open) {
                    event.preventDefault();
                    event.stopPropagation();
                    close(true);
                }
            }}
            data-testid="site-info-button"
        >
            <NativeViewIcon>{icons.sliders}</NativeViewIcon>
        </button>
        {open && createPortal(
            <div
                ref={panelRef}
                id={id}
                role="dialog"
                aria-modal="false"
                aria-labelledby={titleId}
                aria-busy={content.status === 'loading'}
                tabIndex={-1}
                data-native-view-overlay
                style={position}
                className="fixed z-50 overflow-auto rounded-xl border border-[#e0e0e0] bg-white p-1 text-xs text-[#1f1f1f] shadow-[0_8px_24px_rgba(0,0,0,0.12)] outline-none dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc] dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
                onBlur={event => {
                    const next = event.relatedTarget as Node | null;
                    if (next && !event.currentTarget.contains(next) && !triggerRef.current?.contains(next)) close(false);
                }}
                onKeyDown={event => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    event.stopPropagation();
                    close(true);
                }}
                onClick={event => { if ((event.target as Element).closest('[data-site-info-dismiss]')) close(false); }}
                data-testid="site-info-popover"
            >
                <div className="flex items-center gap-2 py-1 pl-3 pr-1">
                    <h2 id={titleId} className="min-w-0 flex-1 truncate text-[13px] font-semibold"
                        title={content.status === 'local-file' ? content.path : title}>{title}</h2>
                    <button type="button" className={nativeViewIconButton} aria-label="Close site information" title="Close"
                        onClick={() => close(true)}>
                        <NativeViewIcon>{icons.close}</NativeViewIcon>
                    </button>
                </div>
                {content.status === 'loading' && <p role="status" className="px-3 pb-2 pt-1 text-[#616161] dark:text-[#9d9d9d]">Loading site information…</p>}
                {content.status === 'error' && <p role="status" className="px-3 pb-2 pt-1 text-[#616161] dark:text-[#9d9d9d]" data-testid="site-info-unavailable">{content.message}</p>}
                {(content.status === 'ready' || content.status === 'local-file') && (
                    <ul className="flex flex-col pb-1">
                        {rows(content).map(row => (
                            <li key={row.id} className="flex gap-2.5 rounded-lg px-3 py-2" data-testid={`site-info-${row.id}`}>
                                <span className={`mt-px flex-shrink-0 ${toneClass[row.tone ?? 'neutral']}`}><NativeViewIcon>{row.icon}</NativeViewIcon></span>
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium">{row.title}</div>
                                    {row.details.map((detail, index) => (
                                        <p key={index} className="mt-0.5 break-words text-[#616161] dark:text-[#9d9d9d]">{detail}</p>
                                    ))}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>, document.body)}
    </>;
}
