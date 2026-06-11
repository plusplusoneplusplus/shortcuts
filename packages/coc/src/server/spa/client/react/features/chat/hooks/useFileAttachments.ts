import { useState, useCallback, useRef } from 'react';
import type { ChatAttachment, AttachmentPayload } from '../../../types/attachments';
import { MAX_FILE_SIZE, MAX_ATTACHMENTS, MAX_FILE_SIZE_LABEL, getAttachmentCategory } from '../../../types/attachments';
import { canCompressChatImageForLlm, compressChatImageForLlm } from '../utils/chatImageCompression';

export interface UseFileAttachmentsResult {
    /** Current list of attachments */
    attachments: ChatAttachment[];
    /** Backward-compatible: image data URLs only (filtered from attachments) */
    images: string[];
    /** Paste event handler — attach to textarea's onPaste */
    addFromPaste: (e: React.ClipboardEvent) => void;
    /** Add files from a file input element */
    addFromFileInput: (files: FileList | File[]) => void;
    /** Remove an attachment by id */
    removeAttachment: (id: string) => void;
    /** Clear all attachments */
    clearAttachments: () => void;
    /** Current validation error (file too large, too many, etc.) */
    error: string | null;
    /** Clear the current error */
    clearError: () => void;
    /** Convert attachments to wire format for API calls */
    toPayload: () => AttachmentPayload[];
}

/**
 * Unified file attachment hook for chat input.
 * Replaces `useImagePaste` with support for arbitrary file types.
 * Backward-compatible: exposes `images` (data URLs) for existing consumers.
 */
export function useFileAttachments(maxAttachments: number = MAX_ATTACHMENTS): UseFileAttachmentsResult {
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [error, setError] = useState<string | null>(null);
    const countRef = useRef(0);

    const clearError = useCallback(() => setError(null), []);

    const addAttachment = useCallback((attachment: ChatAttachment) => {
        setAttachments(current => {
            if (current.length >= maxAttachments) return current;
            if (current.some(a => a.name === attachment.name && a.size === attachment.size)) return current;
            const next = [...current, attachment];
            countRef.current = next.length;
            return next;
        });
    }, [maxAttachments]);

    const addFiles = useCallback((files: File[]) => {
        if (files.length === 0) return;

        const remaining = maxAttachments - countRef.current;
        if (remaining <= 0) {
            setError(`Maximum ${maxAttachments} attachments allowed.`);
            return;
        }

        const toAdd = files.slice(0, remaining);
        if (files.length > remaining) {
            setError(`Only ${remaining} more attachment${remaining === 1 ? '' : 's'} allowed. ${files.length - remaining} file${files.length - remaining === 1 ? '' : 's'} skipped.`);
        }

        const oversized = toAdd.filter(f => f.size > MAX_FILE_SIZE);
        if (oversized.length > 0) {
            setError(`${oversized.map(f => f.name).join(', ')} exceed${oversized.length === 1 ? 's' : ''} the ${MAX_FILE_SIZE_LABEL} limit.`);
        }

        const valid = toAdd.filter(f => f.size <= MAX_FILE_SIZE);
        if (valid.length === 0) return;

        for (const file of valid) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target!.result as string;
                const mimeType = file.type || 'application/octet-stream';
                const category = getAttachmentCategory(mimeType, file.name);
                const baseAttachment: ChatAttachment = {
                    id: crypto.randomUUID(),
                    name: file.name,
                    mimeType,
                    size: file.size,
                    dataUrl,
                    category,
                };

                const compressionInput = {
                    name: baseAttachment.name,
                    mimeType: baseAttachment.mimeType,
                    size: baseAttachment.size,
                    dataUrl: baseAttachment.dataUrl,
                };

                if (category !== 'image' || !canCompressChatImageForLlm(compressionInput)) {
                    addAttachment(baseAttachment);
                    return;
                }

                void compressChatImageForLlm(compressionInput).then((compressed) => {
                    addAttachment({
                        ...baseAttachment,
                        name: compressed.name,
                        mimeType: compressed.mimeType,
                        size: compressed.size,
                        dataUrl: compressed.dataUrl,
                    });
                });
            };
            reader.readAsDataURL(file);
        }
    }, [addAttachment, maxAttachments]);

    const addFromPaste = useCallback((e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) files.push(file);
            }
        }

        if (files.length > 0) {
            e.preventDefault();
            addFiles(files);
        }
    }, [addFiles]);

    const addFromFileInput = useCallback((files: FileList | File[]) => {
        addFiles(Array.from(files));
    }, [addFiles]);

    const removeAttachment = useCallback((id: string) => {
        setAttachments(prev => {
            const next = prev.filter(a => a.id !== id);
            countRef.current = next.length;
            return next;
        });
        setError(null);
    }, []);

    const clearAttachments = useCallback(() => {
        setAttachments([]);
        countRef.current = 0;
        setError(null);
    }, []);

    // Backward-compatible: extract image data URLs
    const images = attachments
        .filter(a => a.category === 'image')
        .map(a => a.dataUrl);

    const toPayload = useCallback((): AttachmentPayload[] => {
        return attachments.map(a => ({
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
            dataUrl: a.dataUrl,
        }));
    }, [attachments]);

    return {
        attachments,
        images,
        addFromPaste,
        addFromFileInput,
        removeAttachment,
        clearAttachments,
        error,
        clearError,
        toPayload,
    };
}
