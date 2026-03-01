import { useState, useEffect } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export interface BreakpointState {
    isMobile: boolean;
    isTablet: boolean;
    isDesktop: boolean;
    breakpoint: Breakpoint;
}

const MOBILE_QUERY = '(max-width: 767px)';
const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)';

function getBreakpoint(isMobile: boolean, isTablet: boolean): Breakpoint {
    if (isMobile) return 'mobile';
    if (isTablet) return 'tablet';
    return 'desktop';
}

function computeState(mobileMatches: boolean, tabletMatches: boolean): BreakpointState {
    const isDesktop = !mobileMatches && !tabletMatches;
    return {
        isMobile: mobileMatches,
        isTablet: tabletMatches,
        isDesktop,
        breakpoint: getBreakpoint(mobileMatches, tabletMatches),
    };
}

const DEFAULT_STATE: BreakpointState = {
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    breakpoint: 'desktop',
};

export function useBreakpoint(): BreakpointState {
    const [state, setState] = useState<BreakpointState>(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return DEFAULT_STATE;
        }
        const mobileMql = window.matchMedia(MOBILE_QUERY);
        const tabletMql = window.matchMedia(TABLET_QUERY);
        return computeState(mobileMql.matches, tabletMql.matches);
    });

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return;
        }

        const mobileMql = window.matchMedia(MOBILE_QUERY);
        const tabletMql = window.matchMedia(TABLET_QUERY);

        const update = () => {
            setState(computeState(mobileMql.matches, tabletMql.matches));
        };

        mobileMql.addEventListener('change', update);
        tabletMql.addEventListener('change', update);

        return () => {
            mobileMql.removeEventListener('change', update);
            tabletMql.removeEventListener('change', update);
        };
    }, []);

    return state;
}
