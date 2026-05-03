import { useState } from 'react';
import type { ParsedNoteFrontMatter } from './noteFrontMatter';
import { getFrontMatterFieldCount } from './noteFrontMatter';

interface NoteMetadataPanelProps {
    frontMatter: ParsedNoteFrontMatter;
}

function humanizeKey(key: string): string {
    return key
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim()
        .replace(/^./, (char) => char.toUpperCase());
}

function isScalar(value: unknown): value is string | number | boolean {
    return ['string', 'number', 'boolean'].includes(typeof value);
}

function scalarLabel(value: string | number | boolean): string {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}

function formatMetadataValue(value: unknown): { label: string; empty: boolean } {
    if (value === null || value === undefined || value === '') {
        return { label: 'Empty', empty: true };
    }
    if (isScalar(value)) {
        return { label: scalarLabel(value), empty: false };
    }
    if (value instanceof Date) {
        return { label: Number.isNaN(value.getTime()) ? 'Empty' : value.toISOString().slice(0, 10), empty: Number.isNaN(value.getTime()) };
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return { label: 'Empty', empty: true };
        if (value.every(isScalar)) {
            return { label: value.map(scalarLabel).join(', '), empty: false };
        }
    }
    return { label: JSON.stringify(value) ?? String(value), empty: false };
}

function metadataChipValues(frontMatter: ParsedNoteFrontMatter): string[] {
    const chips: string[] = [];
    const status = frontMatter.data.status;
    if (isScalar(status)) chips.push(scalarLabel(status));

    const tags = frontMatter.data.tags;
    if (Array.isArray(tags)) {
        for (const tag of tags) {
            if (isScalar(tag)) chips.push(String(tag));
        }
    } else if (isScalar(tags)) {
        chips.push(String(tags));
    }

    return chips.slice(0, 6);
}

export function NoteMetadataPanel({ frontMatter }: NoteMetadataPanelProps) {
    const [expanded, setExpanded] = useState(false);
    const fields = Object.entries(frontMatter.data);
    const fieldCount = getFrontMatterFieldCount(frontMatter);
    const chips = metadataChipValues(frontMatter);

    return (
        <section
            className="mx-4 mt-4 mb-1 rounded-md border border-[#d0d7de] bg-[#f6f8fa] text-[#24292f] dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#d4d4d4]"
            aria-label="Metadata"
            data-testid="note-metadata-panel"
        >
            <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                title="Stored as YAML front matter. Edit in MD mode."
                aria-expanded={expanded}
                aria-controls="note-metadata-fields"
                data-testid="note-metadata-toggle"
                onClick={() => setExpanded((value) => !value)}
            >
                <span aria-hidden="true" className="text-[#57606a] dark:text-[#9a9a9a]">
                    {expanded ? '▾' : '▸'}
                </span>
                {chips.map((chip) => (
                    <span
                        key={chip}
                        className="rounded-full border border-[#d0d7de] bg-white px-2 py-0.5 text-[11px] text-[#57606a] dark:border-[#505050] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
                    >
                        {chip}
                    </span>
                ))}
                <span className="font-medium">Metadata</span>
                <span className="text-[#57606a] dark:text-[#9a9a9a]">· {fieldCount} {fieldCount === 1 ? 'field' : 'fields'}</span>
            </button>

            {expanded && (
                <dl
                    id="note-metadata-fields"
                    className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-[#d0d7de] px-3 py-3 text-xs dark:border-[#3c3c3c]"
                    data-testid="note-metadata-fields"
                >
                    {fields.length === 0 && (
                        <>
                            <dt className="font-medium text-[#57606a] dark:text-[#9a9a9a]">Fields</dt>
                            <dd className="min-w-0 text-[#57606a] dark:text-[#9a9a9a]">Empty</dd>
                        </>
                    )}
                    {fields.map(([key, value]) => {
                        const formatted = formatMetadataValue(value);
                        return (
                            <div className="contents" key={key}>
                                <dt className="font-medium text-[#57606a] dark:text-[#9a9a9a]">{humanizeKey(key)}</dt>
                                <dd
                                    className={`min-w-0 break-words ${formatted.empty ? 'italic text-[#8c959f] dark:text-[#8f8f8f]' : ''}`}
                                    data-testid={`note-metadata-value-${key}`}
                                >
                                    {formatted.label}
                                </dd>
                            </div>
                        );
                    })}
                </dl>
            )}
        </section>
    );
}
