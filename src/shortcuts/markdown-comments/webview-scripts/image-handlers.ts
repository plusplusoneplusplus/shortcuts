/**
 * Image handling for the webview
 */

import { escapeHtml } from '../webview-logic/markdown-renderer';
import { resolveImagePath as requestResolveImagePath } from './vscode-bridge';

/**
 * Setup handlers for image interactions
 */
export function setupImageHandlers(): void {
    // Click on image to open full view modal
    document.querySelectorAll('.md-image-preview').forEach(img => {
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            const imgEl = img as HTMLImageElement;
            openImageModal(imgEl.src, imgEl.alt);
        });
    });
}

/**
 * Open image in a full-screen modal
 */
function openImageModal(src: string, alt: string): void {
    const modal = document.createElement('div');
    modal.className = 'md-image-modal';
    modal.innerHTML = 
        '<button class="md-image-modal-close">&times;</button>' +
        '<img src="' + src + '" alt="' + escapeHtml(alt || 'Image') + '">';
    
    modal.addEventListener('click', () => modal.remove());
    modal.querySelector('.md-image-modal-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        modal.remove();
    });
    
    document.body.appendChild(modal);
    
    // Close on escape
    const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

/**
 * Resolve image paths to proper URIs
 */
export function resolveImagePaths(): void {
    document.querySelectorAll('.md-image-preview').forEach(img => {
        const imgEl = img as HTMLImageElement;
        const src = imgEl.getAttribute('src');
        if (src && src.startsWith('IMG_PATH:')) {
            const relativePath = src.substring(9); // Remove 'IMG_PATH:' prefix
            
            // Generate a unique ID for this image
            const imgId = imgEl.dataset.imgId || Math.random().toString(36).substr(2, 9);
            imgEl.dataset.imgId = imgId;
            imgEl.dataset.pendingPath = relativePath;
            imgEl.src = ''; // Clear src while waiting
            imgEl.alt = 'Loading: ' + relativePath;
            
            // Request the extension to resolve the path
            requestResolveImagePath(relativePath, imgId);
        }
    });
}

/**
 * Update an image with a resolved URI (called when extension responds)
 */
export function updateResolvedImage(
    imgId: string, 
    uri?: string, 
    alt?: string, 
    error?: string
): void {
    const img = document.querySelector('.md-image-preview[data-img-id="' + imgId + '"]') as HTMLImageElement;
    if (img) {
        if (uri) {
            img.src = uri;
            img.alt = alt || 'Image';
        } else {
            // Image not found
            img.style.display = 'none';
            const errorSpan = img.nextElementSibling as HTMLElement;
            if (errorSpan && errorSpan.classList.contains('md-image-error')) {
                errorSpan.style.display = 'inline';
                errorSpan.textContent = '⚠️ ' + (error || 'Image not found: ' + img.dataset.pendingPath);
            }
        }
    }
}

