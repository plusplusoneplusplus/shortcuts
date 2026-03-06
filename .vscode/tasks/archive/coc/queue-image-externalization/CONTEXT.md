# Context: Queue Image Externalization

## User Story
Queue persistence files (`~/.coc/queues/repo-<hash>.json`) grow to 20+ MB because task payloads embed base64 images inline. The user wants to externalize these images to separate files so the queue JSON stays small, while still allowing the dashboard to display images on demand.

## Goal
Strip base64 images from queue persistence payloads and store them in external blob files, with lazy-loading in the SPA dashboard via a new API endpoint.

## Commit Sequence
1. Image blob store infrastructure (`ImageBlobStore` utility)
2. Sanitize payloads on persist + externalize images
3. API endpoint for externalized images (`GET /api/queue/:id/images`)
4. Dashboard lazy-loads externalized images
5. Data lifecycle support (wipe, export, import for blobs)

## Key Decisions
- Follow `OutputFileManager` pattern — static utility class, atomic writes, graceful error handling
- Storage at `~/.coc/blobs/<taskId>.images.json` — one file per task, JSON array of data-URL strings
- `serializeTask()` strips inline images from API responses; clients use the images endpoint
- `save()` becomes async in both persistence classes; debounce handles `.catch()` gracefully
- Backward compatible — old persisted files without `imagesFilePath` just show no images

## Conventions
- Atomic writes (temp file + rename) for all file I/O
- Static utility classes for file-based stores (no instance state)
- React components use source-string rendering pattern for tests
- Dependency flow: 1 → 2, 1 → 3, 3 → 4, 2 → 5
