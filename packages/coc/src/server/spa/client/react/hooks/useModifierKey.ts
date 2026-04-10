import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

export function useModifierKey(targetRef?: RefObject<HTMLElement | null>): boolean {
    const [held, setHeld] = useState(false);
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') {
                if (targetRef?.current && !targetRef.current.contains(document.activeElement)) return;
                setHeld(true);
            }
        };
        const up = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') setHeld(false);
        };
        const blur = () => setHeld(false);
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', blur);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('blur', blur);
        };
    }, []);
    return held;
}
