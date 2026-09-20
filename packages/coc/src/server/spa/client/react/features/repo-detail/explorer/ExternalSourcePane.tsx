/**
 * ExternalSourcePane — the read-only view of a definition that lives outside
 * every workspace (a libstdc++ header, a dependency source).
 *
 * There is no file path here and no file API behind it. The host issued a
 * capability with the definition response, the language attachment read the
 * source through it, and the content was handed to this pane. So the pane is a
 * plain read-only editor over text it was given: no save, no dirty state, no
 * language-server document, nothing the repository tree can reveal.
 */

import { useEffect, useMemo, useState } from 'react';
import {
    MonacoFileEditor,
    getMonacoLanguage,
} from '../../../shared/file-viewer/MonacoFileEditor';
import { mountNonEditableModel } from '../../../shared/file-viewer/nonEditableMonacoModel';
import { EXTERNAL_SOURCE_LABEL, externalSourceLanguageId } from '../../language-servers/externalSource';
import {
    readExternalSourceRecord,
    retainExternalSource,
} from '../../language-servers/externalSourceStore';

export interface ExternalSourcePaneProps {
    /** Opaque capability id issued by the host that produced the definition. */
    resourceId: string;
    /** Safe basename shown in the header. */
    name: string;
    /** One-based line to reveal once the editor is ready. */
    revealLine?: number;
    /** One-based column within `revealLine`. */
    revealColumn?: number;
    /** Omitted on mobile, where the tab strip owns closing. */
    onClose?: () => void;
}

export function ExternalSourcePane({ resourceId, name, revealLine, revealColumn, onClose }: ExternalSourcePaneProps) {
    // Retaining on mount is what keeps the record alive across the unmount of
    // the pane whose attachment owned the capability.
    const [record, setRecord] = useState(() => readExternalSourceRecord(resourceId));
    useEffect(() => {
        const release = retainExternalSource(resourceId);
        setRecord(readExternalSourceRecord(resourceId));
        return release;
    }, [resourceId]);

    const language = useMemo(
        () => (record ? externalSourceLanguageId(record, getMonacoLanguage) : 'plaintext'),
        [record],
    );

    return (
        <div className="flex flex-col w-full h-full" data-testid="external-source-pane">
            <div className="flex items-center gap-2 h-9 px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] flex-shrink-0">
                <span className="text-xs text-[#616161] dark:text-[#cccccc] truncate" title={name}>
                    {name}
                </span>
                <span
                    className="text-[10px] px-1.5 py-0.5 rounded bg-[#e4e6f1] dark:bg-[#37373d] text-[#616161] dark:text-[#cccccc] flex-shrink-0"
                    title="This file is outside the workspace and cannot be edited."
                    data-testid="external-source-badge"
                >
                    {EXTERNAL_SOURCE_LABEL}
                </span>
                <span className="flex-1" />
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        title="Close"
                        aria-label="Close external source"
                        className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] bg-transparent border-none cursor-pointer"
                        data-testid="external-source-close"
                    >
                        ✕
                    </button>
                )}
            </div>
            <div className="flex-1 min-h-0">
                {record
                    ? (
                        <MonacoFileEditor
                            value={record.content}
                            language={language}
                            onModelMount={mountNonEditableModel}
                            revealLine={revealLine}
                            revealColumn={revealColumn}
                        />
                    )
                    : (
                        <p
                            className="px-3 py-2 m-0 text-xs text-[#848484]"
                            data-testid="external-source-unavailable"
                        >
                            Definition source unavailable.
                        </p>
                    )}
            </div>
        </div>
    );
}
