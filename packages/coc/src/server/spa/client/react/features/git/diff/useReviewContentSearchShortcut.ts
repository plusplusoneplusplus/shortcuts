import { useEffect, useRef, type RefObject } from 'react';
import { contentSearchShortcut } from '../../repo-detail/content-search/contentSearchShortcut';

export const REVIEW_SEARCH_OPEN_EVENT = 'review-content-search-open';
export const REVIEW_SEARCH_STEP_EVENT = 'review-content-search-step';

export function reviewContentSearchOwner(target: EventTarget | null): Element | null {
    return target instanceof Element ? target.closest('[data-review-content-search="true"]') : null;
}

/** Capture before Monaco, and let the innermost enabled review own its keys. */
export function useReviewContentSearchShortcut(rootRef: RefObject<HTMLElement | null>, enabled: boolean, onOpen: () => void): void {
    const latest = useRef({ enabled, onOpen });
    latest.current = { enabled, onOpen };
    useEffect(() => {
        const handle = (event: KeyboardEvent) => {
            const root = rootRef.current;
            if (!latest.current.enabled || !root || event.defaultPrevented || event.isComposing
                || reviewContentSearchOwner(event.target) !== root) return;
            if (contentSearchShortcut(event)) {
                event.preventDefault(); event.stopPropagation();
                latest.current.onOpen();
            } else if (event.key === 'F3' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                const step = new CustomEvent(REVIEW_SEARCH_STEP_EVENT, { detail: event.shiftKey, cancelable: true });
                if (!root.dispatchEvent(step)) { event.preventDefault(); event.stopPropagation(); }
            }
        };
        document.addEventListener('keydown', handle, true);
        return () => document.removeEventListener('keydown', handle, true);
    }, [rootRef]);
}
