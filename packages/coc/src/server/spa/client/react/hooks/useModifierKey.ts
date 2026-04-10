import { useEffect, useState } from 'react';

export function useModifierKey(): boolean {
    const [held, setHeld] = useState(false);
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') setHeld(true);
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
