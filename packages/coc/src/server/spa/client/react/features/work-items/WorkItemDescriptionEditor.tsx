/**
 * WorkItemDescriptionEditor — always-editable description surface with a
 * per-field Preview/Source toggle.
 *
 * Mirrors the plan editor pattern: edits flow up via `onChange` into the
 * parent's unified dirty batch and are persisted only by the parent's Ctrl+S
 * save. There is no instant standalone save here. The Source mode reuses the
 * shared `SourceEditor`; Preview renders the markdown via `useMarkdownPreview`.
 */

import { useRef, useState } from 'react';
import { SourceEditor } from '../../shared/SourceEditor';
import { ModeToggleToolbar } from '../../ui/ModeToggleToolbar';
import type { ModeOption } from '../../ui/ModeToggleToolbar';
import { useMarkdownPreview } from '../../hooks/ui/useMarkdownPreview';

type DescriptionViewMode = 'preview' | 'source';

const DESCRIPTION_MODE_OPTIONS: readonly ModeOption<DescriptionViewMode>[] = [
    { value: 'preview', label: 'Preview', testId: 'wi-description-mode-preview' },
    { value: 'source', label: 'Source', testId: 'wi-description-mode-source' },
] as const;

export interface WorkItemDescriptionEditorProps {
    value: string;
    onChange: (content: string) => void;
    /** When true, shows a dirty indicator on the active mode button. */
    dirty?: boolean;
    disabled?: boolean;
    /** Controlled view mode (lifted to parent so the toggle can live in the panel header). */
    viewMode?: DescriptionViewMode;
    /** Callback when the view mode changes (required when viewMode is controlled). */
    onViewModeChange?: (mode: DescriptionViewMode) => void;
}

/** Expose mode options so the parent can render the toggle in the panel header. */
export { DESCRIPTION_MODE_OPTIONS };
export type { DescriptionViewMode };

export function WorkItemDescriptionEditor({ value, onChange, dirty = false, disabled, viewMode: controlledMode, onViewModeChange }: WorkItemDescriptionEditorProps) {
    const [internalMode, setInternalMode] = useState<DescriptionViewMode>('source');
    const viewMode = controlledMode ?? internalMode;
    const setViewMode = onViewModeChange ?? setInternalMode;

    const previewRef = useRef<HTMLDivElement>(null);
    const { html } = useMarkdownPreview({
        content: value,
        containerRef: previewRef,
        viewMode: viewMode === 'source' ? 'source' : 'review',
    });

    return (
        <div>
            {viewMode === 'source' ? (
                <SourceEditor
                    content={value}
                    onChange={onChange}
                    readOnly={disabled}
                    className="w-full min-h-[80px] text-sm p-2 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] resize-y focus:outline-none focus:ring-1 focus:ring-[#0969da]"
                />
            ) : (
                <div
                    ref={previewRef}
                    className="markdown-body text-sm rounded border max-h-72 overflow-y-auto p-3 bg-[#fafafa] dark:bg-[#1e1e1e] border-[#c8c8c8] dark:border-[#555]"
                    data-testid="wi-description-preview"
                    dangerouslySetInnerHTML={{ __html: html || `<span class="italic text-[#848484]">No description. Switch to Source to write one.</span>` }}
                />
            )}
        </div>
    );
}
