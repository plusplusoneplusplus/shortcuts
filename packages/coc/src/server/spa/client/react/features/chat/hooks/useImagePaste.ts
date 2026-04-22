import { useState, useCallback } from 'react';

export interface UseImagePasteResult {
    /** Current list of base64 data URL strings */
    images: string[];
    /** Paste event handler — attach to textarea's onPaste */
    addFromPaste: (e: React.ClipboardEvent) => void;
    /** Remove an image by index */
    removeImage: (index: number) => void;
    /** Clear all images */
    clearImages: () => void;
}

const DEFAULT_MAX_IMAGES = 5;

export function useImagePaste(maxImages: number = DEFAULT_MAX_IMAGES): UseImagePasteResult {
    const [images, setImages] = useState<string[]>([]);

    const addFromPaste = useCallback((e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        let hasImage = false;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                if (!hasImage) {
                    hasImage = true;
                    e.preventDefault();
                }
                const file = item.getAsFile();
                if (!file) continue;
                const reader = new FileReader();
                reader.onload = (event) => {
                    const dataUrl = event.target!.result as string;
                    setImages(prev => {
                        if (prev.length >= maxImages) return prev;
                        return [...prev, dataUrl];
                    });
                };
                reader.readAsDataURL(file);
            }
        }
    }, [maxImages]);

    const removeImage = useCallback((index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    }, []);

    const clearImages = useCallback(() => {
        setImages([]);
    }, []);

    return { images, addFromPaste, removeImage, clearImages };
}
