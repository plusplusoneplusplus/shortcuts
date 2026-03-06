# Context: CoC Chat Image Rendering

## User Story
After implementing image paste-to-attach support, images are sent to the AI backend but disappear from the conversation UI. The user wants attached images to be visible in the chat conversation bubbles — both user-attached images in user messages and image data URLs in tool results. Additionally, image thumbnails in the Generate Task dialog and other input areas should be clickable to view the full-size image.

## Goal
Render user-attached images inline in chat conversation bubbles, detect/display image data URLs in tool call results, and provide click-to-view-full-image lightbox for all image thumbnails across the SPA and VS Code webview.

## Commit Sequence
1. Add image fields to ConversationTurn types + isImageDataUrl utility
2. Backend: persist user-attached images (base64 data URLs) in conversation turns
3. Frontend: render images in chat bubbles (ImageGallery component, lightbox)
4. SPA: click-to-view ImageLightbox for input thumbnails (ImagePreviews + GenerateTaskDialog)
5. VS Code webview: click-to-view lightbox for AI Task dialog thumbnails

## Key Decisions
- Store base64 data URLs directly on `ConversationTurn.images` — same format as frontend sends, directly renderable in `<img src="">`
- Server-side cap of 5 images per turn (matches client-side `DEFAULT_MAX_IMAGES`)
- SSE requires no changes — `conversation-snapshot` already JSON-stringifies full turn objects
- New `ImageGallery` component is read-only (no remove buttons); separate from the existing `ImagePreviews` input component
- Inline `isImageDataUrl` helper in ToolCallView to avoid coupling SPA bundle to server code
- Standalone `ImageLightbox` shared component (reusable by both input thumbnails and read-only galleries)
- VS Code webview lightbox is self-contained inline CSS/JS (matching existing ai-task-dialog.ts pattern)
- Lightbox z-index 10003 (SPA) / 10000 (webview) renders above dialogs

## Conventions
- `images?: string[]` field is optional on all types — backward compatible with existing persisted data
- Thumbnails: 64×64px, `object-cover`, matching existing Tailwind theme patterns
- Image detection via regex: `data:image/(png|jpeg|jpg|gif|webp|svg+xml);base64,`
- Lightbox: dark overlay (80-85% opacity), max 95vw/90vh image, close via Escape/backdrop/button
