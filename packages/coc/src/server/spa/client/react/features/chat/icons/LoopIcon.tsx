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
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            role={title ? 'img' : undefined}
            aria-hidden={title ? undefined : true}
            data-testid="loop-icon"
            {...rest}
        >
            {title ? <title>{title}</title> : null}
            {/* Heroicons arrow-path */}
            <path d="M16.023 9.348h4.992V4.355M2.985 19.644l4.992-4.993M2.985 14.65a8.25 8.25 0 0 0 14.503 4.992m3.527-4.992A8.25 8.25 0 0 0 6.512 9.348" />
        </svg>
    );
}
