import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/** A secondary review action: an icon button in wide panes, an overflow menu item in narrower ones. */
export interface GitReviewToolbarAction {
    id: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    pressed?: boolean;
    disabled?: boolean;
    count?: number;
    testId?: string;
}

/** Context-specific parts of the single-row review toolbar. */
export interface GitReviewHeader {
    /** Shrinking identity area, e.g. the commit title disclosure and SHA copy. */
    identity?: ReactNode;
    /** Primary review action group, e.g. the Classify split button. */
    classify?: ReactNode;
    actions?: GitReviewToolbarAction[];
    /** Actions that always live in the overflow menu. */
    menuActions?: GitReviewToolbarAction[];
    /** Details, errors and filters rendered under the toolbar. */
    below?: ReactNode;
}

/** One nonwrapping toolbar row; `git-file-review.css` container queries compact labels and move actions to overflow. */
export function GitReviewToolbar({ header, progress, children }: {
    header?: GitReviewHeader;
    progress?: { viewed: number; total: number };
    children?: ReactNode;
}) {
    const actions = header?.actions ?? [];
    const menuActions = header?.menuActions ?? [];
    const [menuOpen, setMenuOpen] = useState(false);
    const menuId = useId();
    const moreRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuPosition, setMenuPosition] = useState({ width: 0, left: 0, top: 0 });
    useLayoutEffect(() => {
        if (!menuOpen) return;
        const button = moreRef.current;
        const review = button?.closest('.git-file-review');
        if (!button || !review) return;
        const update = () => {
            const anchor = button.getBoundingClientRect();
            const menu = menuRef.current?.getBoundingClientRect();
            if (!menu) return;
            setMenuPosition({
                // Retain the source pane's container-query tiers outside its clipping ancestors.
                width: review.getBoundingClientRect().width,
                left: Math.max(8, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 8)),
                top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - menu.height - 8)),
            });
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(review);
        if (menuRef.current) observer.observe(menuRef.current);
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [menuOpen]);
    // Wide panes hide collapsible items with CSS; keyboard focus skips them.
    const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^=menuitem]:not(:disabled)') ?? [])
        .filter(item => getComputedStyle(item).display !== 'none');
    useEffect(() => {
        if (!menuOpen) return;
        menuItems()[0]?.focus();
        const close = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node) && !moreRef.current?.contains(event.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [menuOpen]);
    function closeMenu() { setMenuOpen(false); moreRef.current?.focus(); }
    function menuItem(action: GitReviewToolbarAction, collapsible: boolean) {
        return <button type="button" key={action.id} role={action.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={action.pressed} disabled={action.disabled}
            className={`git-review-menu-item${collapsible ? ' git-review-collapsible' : ''}`}
            data-testid={action.testId ? `${action.testId}-menu-item` : undefined}
            onClick={() => { closeMenu(); action.onClick(); }}>
            {action.icon}<span>{action.label}</span>{!!action.count && <span className="git-review-muted">{action.count}</span>}
        </button>;
    }
    const hasMenu = actions.length > 0 || menuActions.length > 0;
    const pct = progress && progress.total > 0 ? Math.min(100, progress.viewed / progress.total * 100) : 0;
    return <div className="git-review-header" data-testid="git-review-header">
        <div className="git-review-tools" role="group" aria-label="Review toolbar" data-testid="git-review-toolbar">
            {header?.identity && <div className="git-review-identity">{header.identity}</div>}
            {header?.classify && <><span aria-hidden="true" className="git-review-sep" />{header.classify}</>}
            {(header?.identity || header?.classify) && <span aria-hidden="true" className="git-review-sep" />}
            {children}
            {actions.length > 0 && <span aria-hidden="true" className="git-review-sep git-review-wide" />}
            {actions.map(action => <button type="button" key={action.id} className="git-review-icon git-review-wide"
                onClick={action.onClick} disabled={action.disabled} aria-pressed={action.pressed}
                aria-label={action.label} title={action.label} data-testid={action.testId}>
                {action.icon}{!!action.count && <span>{action.count}</span>}
            </button>)}
            {hasMenu && <button type="button" ref={moreRef} className={`git-review-icon git-review-more${menuActions.length ? '' : ' git-review-collapsible'}`}
                aria-label="More review actions" title="More review actions" aria-haspopup="menu" aria-expanded={menuOpen}
                aria-controls={menuOpen ? menuId : undefined} onClick={() => {
                    const width = moreRef.current?.closest('.git-file-review')?.getBoundingClientRect().width ?? 0;
                    setMenuPosition(position => ({ ...position, width }));
                    setMenuOpen(open => !open);
                }} data-testid="git-review-more">
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></svg>
            </button>}
            {menuOpen && createPortal(<div className="git-file-review git-review-menu-layer" style={{ width: menuPosition.width }}>
                <div ref={menuRef} id={menuId} role="menu" aria-label="More review actions" className="git-review-menu" data-testid="git-review-menu"
                style={{ left: menuPosition.left, top: menuPosition.top }}
                onMouseDown={event => event.stopPropagation()}
                onKeyDown={event => {
                    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                    const items = menuItems();
                    const index = items.indexOf(document.activeElement as HTMLElement);
                    event.preventDefault();
                    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
                }}>
                {actions.map(action => menuItem(action, true))}
                {menuActions.map(action => menuItem(action, false))}
                </div>
            </div>, document.body)}
            {/* Decorative: the reviewed count and the navigator's progress element carry the value. */}
            {progress && progress.total > 0 && <div className="git-review-progress-line" aria-hidden="true" data-testid="git-review-progress-line">
                <span style={{ width: `${pct}%` }} />
            </div>}
        </div>
        {header?.below}
    </div>;
}
