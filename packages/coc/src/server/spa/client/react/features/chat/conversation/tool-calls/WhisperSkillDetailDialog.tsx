import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import ReactDOM from 'react-dom';
import { cn } from '../../../../ui';
import type { SkillInfo } from '../../../../shared';
import { getCocClientForWorkspace } from '../../../../repos/cloneRegistry';

export type SkillDetailState =
    | { status: 'loading' }
    | { status: 'loaded'; skill: SkillInfo }
    | { status: 'not-found' };

interface SkillDetailDialogRequest {
    name: string;
    workspaceId?: string;
    returnFocusTo?: HTMLElement | null;
    fallbackFocusTo?: HTMLElement | null;
}

interface OpenSkillDetailDialog extends SkillDetailDialogRequest {
    cacheKey: string;
}

interface BoundaryRect {
    top: number;
    left: number;
    width: number;
    height: number;
}

interface WhisperSkillDetailDialogContextValue {
    isOpen: boolean;
    openSkillDetail: (request: SkillDetailDialogRequest) => void;
    closeSkillDetail: () => void;
}

const WhisperSkillDetailDialogContext = createContext<WhisperSkillDetailDialogContextValue | null>(null);

const SKILL_DETAIL_WIDTH = 520;
const SKILL_DETAIL_HEIGHT = 360;

function skillCacheKey(workspaceId: string | undefined, name: string): string {
    return `${workspaceId ?? 'global'}\u0000${name}`;
}

function focusElement(element: HTMLElement | null | undefined): boolean {
    if (!element || !document.contains(element)) {
        return false;
    }
    element.focus();
    return true;
}

function readBoundaryRect(boundary: HTMLElement | null): BoundaryRect {
    const rect = boundary?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
        return {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
        };
    }
    return {
        top: 0,
        left: 0,
        width: window.innerWidth || 1,
        height: window.innerHeight || 1,
    };
}

/**
 * Fetch a single skill's detail, remote-clone-safe. Tries the workspace-scoped
 * endpoint first (when a workspace id is known), then falls back to the global
 * endpoint on the same clone-routed client.
 */
async function fetchSkillDetail(workspaceId: string | undefined, name: string): Promise<SkillInfo | null> {
    const client = getCocClientForWorkspace(workspaceId);
    if (workspaceId) {
        try {
            const res = await client.skills.detailWorkspace(workspaceId, name);
            if (res?.skill) return res.skill;
        } catch {
            // Fall through to the global endpoint.
        }
    }
    try {
        const res = await client.skills.detailGlobal(name);
        return res?.skill ?? null;
    } catch {
        return null;
    }
}

/** Best-available "source location" line for a skill (endpoints vary in fields). */
function skillSourceLocation(skill: SkillInfo): string | undefined {
    return skill.folderLabel || skill.folderPath || skill.relativePath || skill.source;
}

export interface WhisperSkillDetailDialogProviderProps {
    children: ReactNode;
    boundaryRef: React.RefObject<HTMLElement | null>;
    scopeKey?: string;
}

export function WhisperSkillDetailDialogProvider({ children, boundaryRef, scopeKey }: WhisperSkillDetailDialogProviderProps) {
    const [active, setActive] = useState<OpenSkillDetailDialog | null>(null);
    const [states, setStates] = useState<Record<string, SkillDetailState>>({});
    const [boundaryRect, setBoundaryRect] = useState<BoundaryRect>(() => readBoundaryRect(null));
    const requestedRef = useRef<Set<string>>(new Set());

    const requestDetail = useCallback((request: OpenSkillDetailDialog) => {
        if (requestedRef.current.has(request.cacheKey)) return;
        requestedRef.current.add(request.cacheKey);
        setStates(prev => ({ ...prev, [request.cacheKey]: { status: 'loading' } }));
        fetchSkillDetail(request.workspaceId, request.name)
            .then(skill => {
                setStates(prev => ({
                    ...prev,
                    [request.cacheKey]: skill ? { status: 'loaded', skill } : { status: 'not-found' },
                }));
            })
            .catch(() => {
                setStates(prev => ({ ...prev, [request.cacheKey]: { status: 'not-found' } }));
            });
    }, []);

    const restoreFocus = useCallback((request: OpenSkillDetailDialog | null) => {
        if (!request) return;
        window.setTimeout(() => {
            if (focusElement(request.returnFocusTo)) return;
            focusElement(request.fallbackFocusTo);
        }, 0);
    }, []);

    const closeSkillDetail = useCallback(() => {
        setActive(prev => {
            restoreFocus(prev);
            return null;
        });
    }, [restoreFocus]);

    const openSkillDetail = useCallback((request: SkillDetailDialogRequest) => {
        const next = {
            ...request,
            cacheKey: skillCacheKey(request.workspaceId, request.name),
        };
        setBoundaryRect(readBoundaryRect(boundaryRef.current));
        setActive(next);
        requestDetail(next);
    }, [boundaryRef, requestDetail]);

    useEffect(() => {
        setActive(null);
    }, [scopeKey]);

    useEffect(() => {
        if (!active) return;
        const update = () => setBoundaryRect(readBoundaryRect(boundaryRef.current));
        update();
        const boundary = boundaryRef.current;
        const resizeObserver = typeof ResizeObserver !== 'undefined' && boundary
            ? new ResizeObserver(update)
            : null;
        resizeObserver?.observe(boundary);
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [active, boundaryRef]);

    const value = useMemo<WhisperSkillDetailDialogContextValue>(() => ({
        isOpen: active !== null,
        openSkillDetail,
        closeSkillDetail,
    }), [active, openSkillDetail, closeSkillDetail]);

    return (
        <WhisperSkillDetailDialogContext.Provider value={value}>
            {children}
            {active && (
                <SkillDetailDialog
                    request={active}
                    state={states[active.cacheKey]}
                    boundaryRect={boundaryRect}
                    onClose={closeSkillDetail}
                />
            )}
        </WhisperSkillDetailDialogContext.Provider>
    );
}

export function useWhisperSkillDetailDialog(): WhisperSkillDetailDialogContextValue | null {
    return useContext(WhisperSkillDetailDialogContext);
}

interface SkillDetailDialogProps {
    request: OpenSkillDetailDialog;
    state: SkillDetailState | undefined;
    boundaryRect: BoundaryRect;
    onClose: () => void;
}

function SkillDetailDialog({ request, state, boundaryRect, onClose }: SkillDetailDialogProps) {
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const titleId = `skill-detail-dialog-title-${request.cacheKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const status = state?.status ?? 'loading';
    const skill = state?.status === 'loaded' ? state.skill : undefined;
    const source = skill ? skillSourceLocation(skill) : undefined;

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            closeButtonRef.current?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [request.cacheKey]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
                ),
            ).filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
            if (focusable.length === 0) {
                event.preventDefault();
                dialogRef.current.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const current = document.activeElement;
            if (event.shiftKey && current === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && current === last) {
                event.preventDefault();
                first.focus();
            }
        };
        const handleFocusIn = (event: FocusEvent) => {
            const target = event.target as Node | null;
            if (target && dialogRef.current?.contains(target)) return;
            closeButtonRef.current?.focus();
        };
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('focusin', handleFocusIn);
        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('focusin', handleFocusIn);
        };
    }, [onClose]);

    return ReactDOM.createPortal(
        <div
            className="fixed z-[10000]"
            style={{
                top: boundaryRect.top,
                left: boundaryRect.left,
                width: boundaryRect.width,
                height: boundaryRect.height,
            }}
            data-testid="skill-detail-panel-overlay"
            data-boundary-top={String(boundaryRect.top)}
            data-boundary-left={String(boundaryRect.left)}
            data-boundary-width={String(boundaryRect.width)}
            data-boundary-height={String(boundaryRect.height)}
            onWheel={event => event.stopPropagation()}
        >
            <div
                className="absolute inset-0 bg-black/10 dark:bg-black/30"
                data-testid="skill-detail-backdrop"
                onClick={onClose}
            />
            <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
                <div
                    ref={dialogRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    tabIndex={-1}
                    className="pointer-events-auto rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-xl p-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden"
                    style={{
                        width: `min(${SKILL_DETAIL_WIDTH}px, 100%)`,
                        height: `min(${SKILL_DETAIL_HEIGHT}px, 100%)`,
                    }}
                    data-testid="skill-detail-popover"
                    onClick={event => event.stopPropagation()}
                    onMouseDown={event => event.stopPropagation()}
                >
                    <div className="flex items-center gap-2">
                        <span className="shrink-0" aria-hidden="true">🛠</span>
                        <span id={titleId} className="text-xs font-medium text-[#1e1e1e] dark:text-[#ccc] truncate min-w-0 flex-1" data-testid="skill-detail-name">
                            {request.name}
                        </span>
                        {skill?.version && (
                            <span className="shrink-0 text-[10px] bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#1a73e8] dark:text-[#8ab4f8] px-1.5 py-0.5 rounded" data-testid="skill-detail-version">
                                v{skill.version}
                            </span>
                        )}
                        <button
                            ref={closeButtonRef}
                            type="button"
                            className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]"
                            onClick={onClose}
                            aria-label="Close skill details"
                            title="Close"
                            data-testid="skill-detail-close"
                        >
                            ×
                        </button>
                    </div>

                    {status === 'loading' && (
                        <div className="text-xs text-[#848484]" data-testid="skill-detail-loading">Loading…</div>
                    )}
                    {status === 'not-found' && (
                        <div className="text-xs text-[#848484] italic" data-testid="skill-detail-not-found">Skill not found</div>
                    )}
                    {skill && (
                        <>
                            {skill.description && (
                                <div className="text-xs text-[#1e1e1e] dark:text-[#ccc]" data-testid="skill-detail-description">
                                    {skill.description}
                                </div>
                            )}
                            {source && (
                                <div className="text-[10px] text-[#848484] font-mono break-all" data-testid="skill-detail-source">
                                    {source}
                                </div>
                            )}
                            {skill.promptBody && (
                                <pre
                                    className={cn(
                                        'm-0 flex-1 min-h-0 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5',
                                        'text-[#1e1e1e] dark:text-[#cccccc] font-mono bg-[#f9f9f9] dark:bg-[#1e1e1e]',
                                        'border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-2',
                                    )}
                                    data-testid="skill-detail-body"
                                >
                                    {skill.promptBody}
                                </pre>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
