/**
 * Tool-call rendering variant.
 *
 * - 'card'         : default — full ToolCallView card / standard ToolCallGroupView.
 * - 'whisper-row'  : flat compact rows used inside a WhisperCollapsedGroup
 *                    expanded body. Each tool call renders as a single
 *                    `kind` pill + path/summary + metric row, and groups
 *                    use the surface-colored "Show/Hide" toggle styling.
 */
import React, { createContext, useContext } from 'react';

export type ToolCallVariant = 'card' | 'whisper-row';

const ToolCallVariantContext = createContext<ToolCallVariant>('card');

export const ToolCallVariantProvider: React.Provider<ToolCallVariant> =
    ToolCallVariantContext.Provider;

export function useToolCallVariant(): ToolCallVariant {
    return useContext(ToolCallVariantContext);
}
