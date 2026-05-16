/**
 * LoopIcon — shared SVG glyph for loop/repeat indicators.
 *
 * Uses `stroke="currentColor"` so the rendered color follows the wrapping
 * element's `text-…` class. This avoids the cross-platform color-emoji
 * problem where 🔁 ignores CSS `color` on most operating systems.
 */
import React from 'react';

export interface LoopIconProps {
    className?: string;
    title?: string;
    'aria-hidden'?: boolean | 'true' | 'false';
}

export function LoopIcon({ className, title, ...rest }: LoopIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            role={title ? 'img' : undefined}
            aria-hidden={title ? undefined : true}
            data-testid="loop-icon"
            {...rest}
        >
            {title ? <title>{title}</title> : null}
            {/* Lucide rotate-cw — single circular arrow, reads cleanly at small sizes */}
            <path d="M21 12a9 9 0 1 1-3.51-7.14" />
            <polyline points="21 4 21 10 15 10" />
        </svg>
    );
}
