import { useState, useEffect } from 'react';

/**
 * Returns the height (in px) that the virtual keyboard currently
 * occupies — i.e. the difference between `window.innerHeight` and
 * `visualViewport.height`.  Returns 0 on desktop / when the keyboard
 * is closed.
 */
export function useVisualViewport(): number {
    const [keyboardHeight, setKeyboardHeight] = useState(0);

    useEffect(() => {
        const vv = typeof window !== 'undefined' ? window.visualViewport : null;
        if (!vv) return;

        const handler = () => setKeyboardHeight(window.innerHeight - vv.height);
        vv.addEventListener('resize', handler);
        return () => vv.removeEventListener('resize', handler);
    }, []);

    return keyboardHeight;
}
