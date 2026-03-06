# Hoverable File Paths in Queue Task Detail

## Problem

In the CoC SPA dashboard's Queue tab, the **Plan File**, **Prompt File**, and **Working Directory** fields display file paths as plain text (`MetaRow` component). The Chat/conversation view already supports hoverable file paths via the `.file-path-link` CSS class + `file-path-preview.ts` delegation system (hover shows a tooltip with file preview, click opens the file). The task detail panel should use the same treatment.

## Approach

Modify `QueueTaskDetail.tsx` to render file-path values using the existing `.file-path-link` span markup instead of plain text, so they automatically pick up the hover-preview and click-to-open behavior from `file-path-preview.ts`.

### What already exists

- **CSS**: `.file-path-link` in `tailwind.css` — monospace, blue, dashed underline, hover background
- **Hover/click delegation**: `file-path-preview.ts` — global `mouseover`/`click` listeners on any `.file-path-link` element; fetches file preview via API, shows tooltip, click dispatches `coc-open-markdown-review`
- **Path utilities**: `toForwardSlashes` and `shortenFilePath` from `pipeline-core`

### Changes required

**File: `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx`**

1. Create a small `FilePathValue` component (or extend `MetaRow`) that renders the path as:
   ```tsx
   <span className="file-path-link break-all" data-full-path={normalizedPath} title={normalizedPath}>
       {shortenedPath}
   </span>
   ```
2. Replace the three file-path `MetaRow` usages:
   - `<MetaRow label="Working Directory" value={workingDir} breakAll />` → use `FilePathValue`
   - `<MetaRow label="Prompt File" value={payload.promptFilePath} breakAll />` → use `FilePathValue`
   - `<MetaRow label="Plan File" value={payload.planFilePath} breakAll />` → use `FilePathValue`
3. Import `toForwardSlashes` and `shortenFilePath` from pipeline-core (already available as a dependency).

No backend changes needed — the hover/click delegation and file preview API already exist.

## Todos

| ID | Task | Description |
|----|------|-------------|
| `file-path-component` | Create `FilePathValue` helper | Add a small inline component in `QueueTaskDetail.tsx` that renders a path as a `.file-path-link` span with `data-full-path`, using `toForwardSlashes` + `shortenFilePath` |
| `replace-meta-rows` | Use `FilePathValue` for path fields | Replace the three `MetaRow` calls for Working Directory, Prompt File, and Plan File with the new component |
| `verify-hover` | Verify hover/click works | Build the SPA (`npm run build`) and confirm the paths are hoverable with preview tooltip and clickable |
