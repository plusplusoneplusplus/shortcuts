import { useState } from 'react';
import { cn } from './cn';
import { ImageLightbox } from './ImageLightbox';
import type { ChatAttachment } from '../types/attachments';
import { getAttachmentIcon, formatFileSize } from '../types/attachments';

export interface AttachmentPreviewsProps {
    /** Attachments to show as previews */
    attachments: ChatAttachment[];
    /** Called with the attachment id to remove */
    onRemove: (id: string) => void;
    /** Optional additional className on the outer container */
    className?: string;
    /** data-testid for testing */
    'data-testid'?: string;
}

/**
 * Unified preview strip for all attachment types.
 * Shows thumbnails for images, file-type icons + filename for non-image files.
 */
export function AttachmentPreviews({ attachments, onRemove, className, ...props }: AttachmentPreviewsProps) {
    const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

    if (attachments.length === 0) return null;

    return (
        <>
            <div className={cn('flex flex-wrap gap-2 mt-2', className)} data-testid={props['data-testid'] ?? 'attachment-previews'}>
                {attachments.map((attachment) => (
                    attachment.category === 'image' ? (
                        <div
                            key={attachment.id}
                            className="group relative w-12 h-12 rounded overflow-hidden border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#2d2d2d]"
                            data-testid="attachment-preview-image"
                        >
                            <img
                                src={attachment.dataUrl}
                                alt={attachment.name}
                                className="w-full h-full object-cover cursor-zoom-in"
                                onClick={() => setLightboxSrc(attachment.dataUrl)}
                            />
                            <button
                                onClick={(e) => { e.stopPropagation(); onRemove(attachment.id); }}
                                title={`Remove ${attachment.name}`}
                                data-testid={`remove-attachment-${attachment.id}`}
                                className="absolute top-0 right-0 w-6 h-6 rounded-bl-md bg-black/60 text-white text-xs flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity cursor-pointer border-none"
                            >
                                ×
                            </button>
                        </div>
                    ) : (
                        <div
                            key={attachment.id}
                            className="group relative flex items-center gap-1.5 px-2 py-1 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#2d2d2d] max-w-[180px]"
                            data-testid="attachment-preview-file"
                            title={`${attachment.name} (${formatFileSize(attachment.size)})`}
                        >
                            <span className="text-sm shrink-0">{getAttachmentIcon(attachment.category)}</span>
                            <span className="text-xs text-[#1e1e1e] dark:text-[#cccccc] truncate">{attachment.name}</span>
                            <span className="text-[10px] text-[#a0a0a0] dark:text-[#666] shrink-0">{formatFileSize(attachment.size)}</span>
                            <button
                                onClick={(e) => { e.stopPropagation(); onRemove(attachment.id); }}
                                title={`Remove ${attachment.name}`}
                                data-testid={`remove-attachment-${attachment.id}`}
                                className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-[#a0a0a0] hover:text-[#f14c4c] text-xs cursor-pointer border-none bg-transparent opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                            >
                                ×
                            </button>
                        </div>
                    )
                ))}
            </div>
            <ImageLightbox
                src={lightboxSrc}
                alt="Attachment preview"
                onClose={() => setLightboxSrc(null)}
            />
        </>
    );
}
