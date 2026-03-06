---
status: pending
commit: "006"
title: "coc dashboard: add Templates sub-tab with list/detail UI"
depends_on: ["005"]
files_modified:
  - packages/coc/src/server/spa/client/react/types/dashboard.ts
  - packages/coc/src/server/spa/client/react/layout/Router.tsx
  - packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx
files_created:
  - packages/coc/src/server/spa/client/react/repos/RepoTemplatesTab.tsx
---

# 006 — coc dashboard: add Templates sub-tab with list/detail UI

## Overview

Add a full dashboard UI for the Templates feature as a new "Templates" sub-tab in the repo detail view. The tab follows the existing `RepoSchedulesTab` split-panel pattern exactly: left panel with a scrollable template list, right panel with detail view and inline forms, WebSocket-driven live updates.

**Assumed prior state (from commit 005):** Server has template CRUD routes (`GET/POST /api/workspaces/:id/templates`, `GET/DELETE /api/workspaces/:id/templates/:name`, `POST /api/workspaces/:id/templates/:name/replicate`), watcher broadcasting `templates-changed` events via WebSocket, and `GET /api/workspaces/:id/git/commits/:hash` for commit validation.

---

## 1. Type Changes — `types/dashboard.ts`

### 1.1 Extend `RepoSubTab` union

**Current:**
```ts
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'git' | 'wiki' | 'copilot' | 'workflow';
```

**After:**
```ts
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'templates' | 'chat' | 'git' | 'wiki' | 'copilot' | 'workflow';
```

Place `'templates'` adjacent to `'schedules'` since they are conceptually related (automation features).

---

## 2. Router Changes — `Router.tsx`

### 2.1 Add to `VALID_REPO_SUB_TABS`

Add `'templates'` to the `VALID_REPO_SUB_TABS` Set so hash-based deep linking works:

```ts
export const VALID_REPO_SUB_TABS: Set<string> = new Set([
  'info', 'git', 'pipelines', 'tasks', 'queue', 'schedules', 'templates', 'chat', 'wiki', 'copilot', 'workflow'
]);
```

No additional deep-link parse block is needed — the generic handler at lines 207–208 already covers any tab in the Set:
```ts
if (parts.length >= 3 && VALID_REPO_SUB_TABS.has(parts[2])) {
    dispatch({ type: 'SET_REPO_SUB_TAB', tab: parts[2] as RepoSubTab });
}
```

---

## 3. RepoDetail Changes — `RepoDetail.tsx`

### 3.1 Add import

```ts
import { RepoTemplatesTab } from './RepoTemplatesTab';
```

### 3.2 Add to `SUB_TABS` array

Insert after `schedules` entry:

```ts
export const SUB_TABS: { key: RepoSubTab; label: string }[] = [
    { key: 'info',      label: 'Info' },
    { key: 'git',       label: 'Git' },
    { key: 'tasks',     label: 'Tasks' },
    { key: 'chat',      label: 'Chats' },
    { key: 'queue',     label: 'Queue' },
    { key: 'pipelines', label: 'Workflows' },
    { key: 'schedules', label: 'Schedules' },
    { key: 'templates', label: 'Templates' },   // ← NEW
    { key: 'copilot',   label: 'Copilot' },
];
```

### 3.3 Add render case

Inside the sub-tab content `<div>` (alongside the other `&&` short-circuit renders):

```tsx
{activeSubTab === 'templates' && <RepoTemplatesTab workspaceId={ws.id} />}
```

Place it after the `schedules` line. The outer `<div>` should use `overflow-hidden` for this tab (same as `schedules` and `queue`) since the component manages its own scroll internally via the split-panel layout.

---

## 4. New File — `RepoTemplatesTab.tsx`

This is the main deliverable. Follow the `RepoSchedulesTab` pattern exactly.

### 4.1 Component Hierarchy

```
RepoTemplatesTab (root)
├── Left Panel (template list)
│   ├── Header (title + count + [+] button)
│   ├── Empty state
│   └── Scrollable <ul> of TemplateListItem
│       └── TemplateListItem (click to select, context menu)
├── Right Panel (detail / form / empty)
│   ├── Empty state ("Select a template to view details")
│   ├── TemplateDetail (when template selected, not in create/edit mode)
│   │   ├── Action buttons (Edit, Replicate, Delete)
│   │   ├── Metadata display (kind, commit, description, hints, files)
│   │   └── ReplicateDialog (modal overlay)
│   └── CreateTemplateForm (inline in right panel, create or edit mode)
└── AddTemplateDialog — REMOVED in favor of inline form (per schedules pattern)
```

> **Design decision:** Following the schedules pattern, the "Add" and "Edit" forms render **inline in the right panel** (replacing detail view), NOT as modal dialogs. The only modal is the `ReplicateDialog` since it's an action triggered from the detail view and doesn't replace it.

### 4.2 Imports

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Button, cn, Dialog } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { formatRelativeTime } from '../utils/format';
```

### 4.3 Local Types

```tsx
interface Template {
    name: string;
    kind: 'commit';                     // extensible to other kinds later
    commitHash: string;
    description?: string;
    hints?: string[];
    createdAt: string;
    updatedAt?: string;
}

interface TemplateDetail extends Template {
    changedFiles?: ChangedFile[];       // populated by GET /templates/:name
}

interface ChangedFile {
    path: string;
    status: string;                     // 'added' | 'modified' | 'deleted' | 'renamed'
    additions?: number;
    deletions?: number;
}
```

### 4.4 Props Interface

```tsx
interface RepoTemplatesTabProps {
    workspaceId: string;
}
```

### 4.5 State Management

```tsx
export function RepoTemplatesTab({ workspaceId }: RepoTemplatesTabProps) {
    // List state
    const [templates, setTemplates]         = useState<Template[]>([]);
    const [loading, setLoading]             = useState(true);
    const [selectedName, setSelectedName]   = useState<string | null>(null);

    // Detail state (fetched on selection)
    const [detail, setDetail]               = useState<TemplateDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // Form state
    const [showCreate, setShowCreate]       = useState(false);
    const [editingName, setEditingName]     = useState<string | null>(null);

    // Replicate dialog
    const [replicateTarget, setReplicateTarget] = useState<Template | null>(null);
}
```

### 4.6 API Calls

#### 4.6.1 Fetch template list

```tsx
const fetchTemplates = useCallback(async () => {
    const data = await fetchApi(
        `/workspaces/${encodeURIComponent(workspaceId)}/templates`
    );
    setTemplates(data?.templates || []);
    setLoading(false);
}, [workspaceId]);
```

**Endpoint:** `GET /api/workspaces/:id/templates`
**Response:** `{ templates: Template[] }`

#### 4.6.2 Fetch template detail

```tsx
useEffect(() => {
    if (!selectedName) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    fetchApi(
        `/workspaces/${encodeURIComponent(workspaceId)}/templates/${encodeURIComponent(selectedName)}`
    ).then(data => {
        if (!cancelled) { setDetail(data); setDetailLoading(false); }
    }).catch(() => {
        if (!cancelled) { setDetail(null); setDetailLoading(false); }
    });
    return () => { cancelled = true; };
}, [workspaceId, selectedName]);
```

**Endpoint:** `GET /api/workspaces/:id/templates/:name`
**Response:** `TemplateDetail` (includes `changedFiles` from the commit)

#### 4.6.3 Create template

Inside `CreateTemplateForm`:

```tsx
const res = await fetch(
    getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/templates`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name, kind, commitHash, description,
            hints: hintsText.split('\n').filter(Boolean)
        })
    }
);
if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed: ${res.status}`);
}
```

**Endpoint:** `POST /api/workspaces/:id/templates`
**Body:** `{ name, kind, commitHash, description?, hints? }`

#### 4.6.4 Update template (edit mode)

```tsx
const res = await fetch(
    getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/templates/${encodeURIComponent(editingName)}`,
    {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, hints })
    }
);
```

**Endpoint:** `PATCH /api/workspaces/:id/templates/:name`
**Body:** `{ description?, hints? }` (name, kind, commitHash immutable after creation)

#### 4.6.5 Delete template

```tsx
const handleDelete = async (name: string) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    await fetch(
        getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/templates/${encodeURIComponent(name)}`,
        { method: 'DELETE' }
    );
    if (selectedName === name) setSelectedName(null);
    fetchTemplates();
};
```

**Endpoint:** `DELETE /api/workspaces/:id/templates/:name`

#### 4.6.6 Replicate template

Inside `ReplicateDialog`:

```tsx
const res = await fetch(
    getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/templates/${encodeURIComponent(template.name)}/replicate`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, model: model || undefined })
    }
);
const data = await res.json();
// data.taskId → optionally navigate to queue tab
```

**Endpoint:** `POST /api/workspaces/:id/templates/:name/replicate`
**Body:** `{ instruction: string, model?: string }`
**Response:** `{ taskId: string }`

#### 4.6.7 Validate commit hash (on blur in create form)

```tsx
const validateCommit = async (hash: string) => {
    try {
        const data = await fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${encodeURIComponent(hash)}`
        );
        setCommitValid(true);
        setCommitInfo(data);  // store subject line for display
    } catch {
        setCommitValid(false);
        setCommitInfo(null);
    }
};
```

**Endpoint:** `GET /api/workspaces/:id/git/commits/:hash`

### 4.7 WebSocket Event Handling

```tsx
useEffect(() => {
    const wsHandler = () => fetchTemplates();
    window.addEventListener('templates-changed', wsHandler);
    return () => window.removeEventListener('templates-changed', wsHandler);
}, [workspaceId, fetchTemplates]);
```

Follow the exact same pattern as schedules. The `App.tsx` WS message dispatcher will need a case for `templates-changed` → `window.dispatchEvent(new CustomEvent('templates-changed'))`. (This may already be wired from commit 005; if not, add it.)

### 4.8 Mount & Refresh Effects

```tsx
// Initial fetch
useEffect(() => {
    setLoading(true);
    fetchTemplates();
}, [workspaceId, fetchTemplates]);

// Reset selection when workspace changes
useEffect(() => {
    setSelectedName(null);
    setShowCreate(false);
    setEditingName(null);
}, [workspaceId]);
```

### 4.9 Layout — Root Component JSX

```tsx
return (
    <div className="flex h-full overflow-hidden">
        {/* ── LEFT PANEL ── */}
        <div className="w-72 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#2d2d2d] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0e0e0] dark:border-[#2d2d2d]">
                <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                    Templates
                    {templates.length > 0 && (
                        <span className="ml-1.5 text-xs text-[#6e6e6e] dark:text-[#888]">
                            ({templates.length})
                        </span>
                    )}
                </span>
                <Button size="sm" onClick={() => { setShowCreate(true); setEditingName(null); }}>
                    + New
                </Button>
            </div>

            {/* Empty state */}
            {!loading && templates.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-center px-4">
                    <div>
                        <div className="text-2xl mb-2">📋</div>
                        <div className="text-sm text-[#6e6e6e] dark:text-[#888]">
                            No templates yet
                        </div>
                        <div className="text-xs text-[#999] dark:text-[#666] mt-1">
                            Create a template from a commit to replicate patterns
                        </div>
                    </div>
                </div>
            )}

            {/* Scrollable list */}
            {templates.length > 0 && (
                <ul className="flex-1 overflow-y-auto">
                    {templates.map(t => (
                        <TemplateListItem
                            key={t.name}
                            template={t}
                            isSelected={selectedName === t.name}
                            onSelect={() => {
                                setSelectedName(t.name);
                                setShowCreate(false);
                                setEditingName(null);
                            }}
                            onEdit={() => { setEditingName(t.name); setShowCreate(false); }}
                            onReplicate={() => setReplicateTarget(t)}
                            onDelete={() => handleDelete(t.name)}
                        />
                    ))}
                </ul>
            )}
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="flex-1 min-w-0 overflow-y-auto">
            {showCreate || editingName ? (
                <CreateTemplateForm
                    workspaceId={workspaceId}
                    editingTemplate={editingName ? templates.find(t => t.name === editingName) : undefined}
                    onClose={() => { setShowCreate(false); setEditingName(null); }}
                    onSaved={() => {
                        setShowCreate(false);
                        setEditingName(null);
                        fetchTemplates();
                    }}
                />
            ) : selectedName && detail ? (
                <TemplateDetailView
                    template={detail}
                    loading={detailLoading}
                    onEdit={() => setEditingName(detail.name)}
                    onReplicate={() => setReplicateTarget(detail)}
                    onDelete={() => handleDelete(detail.name)}
                />
            ) : (
                <div className="h-full flex items-center justify-center text-[#6e6e6e] dark:text-[#888] text-sm">
                    Select a template to view details
                </div>
            )}
        </div>

        {/* ── REPLICATE DIALOG (modal) ── */}
        {replicateTarget && (
            <ReplicateDialog
                workspaceId={workspaceId}
                template={replicateTarget}
                onClose={() => setReplicateTarget(null)}
            />
        )}
    </div>
);
```

### 4.10 Sub-Component: `TemplateListItem`

```tsx
interface TemplateListItemProps {
    template: Template;
    isSelected: boolean;
    onSelect: () => void;
    onEdit: () => void;
    onReplicate: () => void;
    onDelete: () => void;
}

function TemplateListItem({ template, isSelected, onSelect, onEdit, onReplicate, onDelete }: TemplateListItemProps) {
    const [showContextMenu, setShowContextMenu] = useState(false);
    const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

    return (
        <li
            className={cn(
                "px-4 py-2.5 cursor-pointer border-b border-[#f0f0f0] dark:border-[#2a2a2a] text-sm",
                "hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a]",
                isSelected && "bg-[#e8f0fe] dark:bg-[#1a3a5c] border-l-2 border-l-[#0078d4]"
            )}
            onClick={onSelect}
            onContextMenu={(e) => {
                e.preventDefault();
                setMenuPos({ x: e.clientX, y: e.clientY });
                setShowContextMenu(true);
            }}
        >
            <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                {template.name}
            </div>
            <div className="text-xs text-[#6e6e6e] dark:text-[#888] mt-0.5 truncate">
                {template.kind} · {template.commitHash.slice(0, 8)}
            </div>

            {/* Context menu (positioned absolute via portal or fixed) */}
            {showContextMenu && (
                <ContextMenu
                    x={menuPos.x}
                    y={menuPos.y}
                    onClose={() => setShowContextMenu(false)}
                    items={[
                        { label: 'Replicate…', onClick: onReplicate },
                        { label: 'Edit', onClick: onEdit },
                        { label: 'Delete', onClick: onDelete, danger: true },
                    ]}
                />
            )}
        </li>
    );
}
```

**Context menu implementation:** Use a simple fixed-position `<div>` with `z-[10003]` and a backdrop click handler to close. Follow any existing context menu pattern in the codebase; if none exists, implement a minimal one:

```tsx
function ContextMenu({ x, y, items, onClose }: {
    x: number; y: number;
    items: { label: string; onClick: () => void; danger?: boolean }[];
    onClose: () => void;
}) {
    useEffect(() => {
        const handler = () => onClose();
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, [onClose]);

    return ReactDOM.createPortal(
        <div
            className="fixed bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1 z-[10003]"
            style={{ left: x, top: y }}
        >
            {items.map(item => (
                <button
                    key={item.label}
                    className={cn(
                        "block w-full text-left px-4 py-1.5 text-sm hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e]",
                        item.danger ? "text-red-500" : "text-[#1e1e1e] dark:text-[#cccccc]"
                    )}
                    onClick={(e) => { e.stopPropagation(); item.onClick(); onClose(); }}
                >
                    {item.label}
                </button>
            ))}
        </div>,
        document.body
    );
}
```

### 4.11 Sub-Component: `TemplateDetailView`

Renders in the right panel when a template is selected.

```tsx
interface TemplateDetailViewProps {
    template: TemplateDetail;
    loading: boolean;
    onEdit: () => void;
    onReplicate: () => void;
    onDelete: () => void;
}

function TemplateDetailView({ template, loading, onEdit, onReplicate, onDelete }: TemplateDetailViewProps) {
    if (loading) return <LoadingSpinner />;

    return (
        <div className="p-6">
            {/* Header with action buttons */}
            <div className="flex items-start justify-between mb-6">
                <div>
                    <h2 className="text-lg font-semibold text-[#1e1e1e] dark:text-[#e0e0e0]">
                        {template.name}
                    </h2>
                    <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#0078d4]">
                        {template.kind}
                    </span>
                </div>
                <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={onReplicate}>
                        Replicate…
                    </Button>
                    <Button size="sm" onClick={onEdit}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
                </div>
            </div>

            {/* Commit hash */}
            <div className="mb-4">
                <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">
                    Commit
                </label>
                <div className="mt-1 flex items-center gap-2">
                    <code className="text-sm font-mono bg-[#f5f5f5] dark:bg-[#1e1e1e] px-2 py-1 rounded">
                        {template.commitHash}
                    </code>
                    <button
                        className="text-xs text-[#0078d4] hover:underline"
                        onClick={() => navigator.clipboard.writeText(template.commitHash)}
                    >
                        Copy
                    </button>
                </div>
            </div>

            {/* Description */}
            {template.description && (
                <div className="mb-4">
                    <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">
                        Description
                    </label>
                    <p className="mt-1 text-sm text-[#1e1e1e] dark:text-[#cccccc] whitespace-pre-wrap">
                        {template.description}
                    </p>
                </div>
            )}

            {/* Hints */}
            {template.hints && template.hints.length > 0 && (
                <div className="mb-4">
                    <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">
                        Hints
                    </label>
                    <ul className="mt-1 list-disc list-inside text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                        {template.hints.map((h, i) => <li key={i}>{h}</li>)}
                    </ul>
                </div>
            )}

            {/* Changed files */}
            {template.changedFiles && template.changedFiles.length > 0 && (
                <div className="mb-4">
                    <label className="text-xs font-medium text-[#6e6e6e] dark:text-[#888] uppercase tracking-wide">
                        Changed Files ({template.changedFiles.length})
                    </label>
                    <div className="mt-1 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded overflow-hidden">
                        {template.changedFiles.map((f, i) => (
                            <div
                                key={i}
                                className={cn(
                                    "flex items-center justify-between px-3 py-1.5 text-sm font-mono",
                                    i > 0 && "border-t border-[#f0f0f0] dark:border-[#2a2a2a]"
                                )}
                            >
                                <span className="text-[#1e1e1e] dark:text-[#cccccc] truncate">
                                    {f.path}
                                </span>
                                <span className={cn("text-xs ml-2 flex-shrink-0", statusColor(f.status))}>
                                    {f.status}
                                    {f.additions != null && (
                                        <span className="text-green-600 dark:text-green-400 ml-1">+{f.additions}</span>
                                    )}
                                    {f.deletions != null && (
                                        <span className="text-red-500 ml-1">-{f.deletions}</span>
                                    )}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Timestamps */}
            <div className="text-xs text-[#999] dark:text-[#666] mt-6">
                Created {formatRelativeTime(template.createdAt)}
                {template.updatedAt && ` · Updated ${formatRelativeTime(template.updatedAt)}`}
            </div>
        </div>
    );
}
```

**Helper for file status colors:**
```tsx
function statusColor(status: string): string {
    switch (status) {
        case 'added':    return 'text-green-600 dark:text-green-400';
        case 'deleted':  return 'text-red-500 dark:text-red-400';
        case 'renamed':  return 'text-yellow-600 dark:text-yellow-400';
        default:         return 'text-[#6e6e6e] dark:text-[#888]';
    }
}
```

### 4.12 Sub-Component: `CreateTemplateForm`

Inline form in the right panel (not a modal). Shared for both create and edit modes.

```tsx
interface CreateTemplateFormProps {
    workspaceId: string;
    editingTemplate?: Template;
    onClose: () => void;
    onSaved: () => void;
}

function CreateTemplateForm({ workspaceId, editingTemplate, onClose, onSaved }: CreateTemplateFormProps) {
    const isEdit = !!editingTemplate;

    // Form state
    const [name, setName]               = useState(editingTemplate?.name || '');
    const [kind, setKind]               = useState<'commit'>(editingTemplate?.kind || 'commit');
    const [commitHash, setCommitHash]   = useState(editingTemplate?.commitHash || '');
    const [description, setDescription] = useState(editingTemplate?.description || '');
    const [hintsText, setHintsText]     = useState((editingTemplate?.hints || []).join('\n'));

    // Validation state
    const [commitValid, setCommitValid]   = useState<boolean | null>(isEdit ? true : null);
    const [commitInfo, setCommitInfo]     = useState<string | null>(null);
    const [nameError, setNameError]       = useState<string | null>(null);
    const [submitting, setSubmitting]     = useState(false);
    const [error, setError]              = useState<string | null>(null);
}
```

**Form field layout:**

```
┌──────────────────────────────────────────────┐
│ [← Back]  Create Template  /  Edit Template  │
├──────────────────────────────────────────────┤
│ Name*        [________________] (kebab-case)  │
│              ↳ error: "Must be kebab-case"    │
│ Kind         [commit ▾]                       │
│ Commit Hash* [________________] [Validate]    │
│              ↳ ✓ "fix: update parser logic"   │
│              ↳ ✗ "Commit not found"           │
│ Description  [________________________]       │
│              [________________________]       │
│ Hints        [________________________]       │
│ (one/line)   [________________________]       │
│                                               │
│              [Cancel]  [Create / Save]        │
└──────────────────────────────────────────────┘
```

**Validation rules:**

| Field | Rule | Timing |
|-------|------|--------|
| `name` | Required, kebab-case (`/^[a-z0-9]+(-[a-z0-9]+)*$/`), max 64 chars | On change + on submit |
| `commitHash` | Required, validated via API | On blur + on submit |
| `kind` | Required, currently always `'commit'` | N/A (dropdown) |
| `description` | Optional | N/A |
| `hints` | Optional, split by newline | N/A |

**Name validation:**
```tsx
const validateName = (v: string) => {
    if (!v) return 'Name is required';
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) return 'Must be kebab-case (e.g., fix-parser)';
    if (v.length > 64) return 'Max 64 characters';
    return null;
};
```

**Commit validation on blur:**
```tsx
const handleCommitBlur = async () => {
    if (!commitHash.trim()) { setCommitValid(null); return; }
    try {
        const data = await fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${encodeURIComponent(commitHash.trim())}`
        );
        setCommitValid(true);
        setCommitInfo(data.subject || data.message?.split('\n')[0] || 'Valid commit');
    } catch {
        setCommitValid(false);
        setCommitInfo('Commit not found or not reachable');
    }
};
```

**Submit handler:**
```tsx
const handleSubmit = async () => {
    const nameErr = isEdit ? null : validateName(name);
    if (nameErr) { setNameError(nameErr); return; }
    if (!isEdit && !commitValid) { setError('Please validate the commit hash first'); return; }

    setSubmitting(true);
    setError(null);
    try {
        if (isEdit) {
            await fetch(
                getApiBase() + `/workspaces/${enc(workspaceId)}/templates/${enc(editingTemplate!.name)}`,
                { method: 'PATCH', headers: CT_JSON, body: JSON.stringify({ description, hints: parseHints(hintsText) }) }
            );
        } else {
            const res = await fetch(
                getApiBase() + `/workspaces/${enc(workspaceId)}/templates`,
                { method: 'POST', headers: CT_JSON, body: JSON.stringify({ name, kind, commitHash: commitHash.trim(), description, hints: parseHints(hintsText) }) }
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed: ${res.status}`);
            }
        }
        onSaved();
    } catch (e: any) {
        setError(e.message);
    } finally {
        setSubmitting(false);
    }
};
```

**Edit mode restrictions:**
- `name`, `kind`, and `commitHash` fields are **read-only** (rendered as plain text, not inputs)
- Only `description` and `hints` are editable

### 4.13 Sub-Component: `ReplicateDialog`

This is the only **modal dialog** — uses the shared `<Dialog>` component.

```tsx
interface ReplicateDialogProps {
    workspaceId: string;
    template: Template;
    onClose: () => void;
}

function ReplicateDialog({ workspaceId, template, onClose }: ReplicateDialogProps) {
    const [instruction, setInstruction] = useState('');
    const [model, setModel]             = useState('');
    const [submitting, setSubmitting]   = useState(false);
    const [error, setError]             = useState<string | null>(null);

    const handleSubmit = async () => {
        if (!instruction.trim()) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(
                getApiBase() + `/workspaces/${enc(workspaceId)}/templates/${enc(template.name)}/replicate`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        instruction: instruction.trim(),
                        model: model || undefined
                    })
                }
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed: ${res.status}`);
            }
            const data = await res.json();
            // data.taskId — could dispatch navigation to queue tab here
            onClose();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog
            open
            onClose={onClose}
            title={`Replicate: ${template.name}`}
            footer={
                <div className="flex justify-end gap-2">
                    <Button onClick={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={submitting || !instruction.trim()}
                    >
                        {submitting ? 'Replicating…' : 'Replicate'}
                    </Button>
                </div>
            }
        >
            {/* Read-only template info */}
            <div className="mb-4 text-sm">
                <div className="text-[#6e6e6e] dark:text-[#888]">Template</div>
                <div className="font-medium">{template.name}</div>
                <code className="text-xs font-mono text-[#6e6e6e]">{template.commitHash.slice(0, 12)}</code>
            </div>

            {/* Instruction textarea */}
            <div className="mb-4">
                <label className="block text-sm font-medium mb-1">
                    What should change? <span className="text-red-500">*</span>
                </label>
                <textarea
                    className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded resize-y"
                    rows={4}
                    value={instruction}
                    onChange={e => setInstruction(e.target.value)}
                    placeholder="Describe what should be different in the replicated commit…"
                    autoFocus
                />
            </div>

            {/* Optional model override */}
            <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Model (optional)</label>
                <input
                    className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder="e.g., claude-sonnet-4-20250514 (leave blank for default)"
                />
            </div>

            {/* Error display */}
            {error && (
                <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1.5">
                    {error}
                </div>
            )}
        </Dialog>
    );
}
```

---

## 5. WebSocket Event Dispatch

Verify/add in `App.tsx` (or wherever WS messages are dispatched to `window` events):

```tsx
case 'templates-changed':
    window.dispatchEvent(new CustomEvent('templates-changed'));
    break;
```

If commit 005 already wired this, no change needed. If not, add it alongside the existing `schedule-changed` case.

---

## 6. Overflow Handling in RepoDetail

The templates tab manages its own scrolling (split panel with `overflow-hidden` root, each panel scrolls independently). Ensure the outer wrapper in `RepoDetail.tsx` uses `overflow-hidden` for the templates sub-tab, matching the queue and schedules behavior:

```tsx
<div className={cn("h-full min-w-0",
    activeSubTab === 'queue' || activeSubTab === 'schedules' || activeSubTab === 'templates'
        ? "overflow-hidden"
        : "overflow-y-auto"
)}>
```

If the existing code uses a simpler conditional, add `'templates'` to the list of tabs that get `overflow-hidden`.

---

## 7. Acceptance Criteria

### 7.1 Tab Navigation
- [ ] "Templates" tab appears in the sub-tab bar between "Schedules" and "Copilot"
- [ ] Clicking the tab switches to the templates view
- [ ] Deep-link `#repo/<name>/templates` navigates directly to the tab
- [ ] Browser back/forward works correctly

### 7.2 Left Panel — Template List
- [ ] Shows loading state on initial fetch
- [ ] Shows empty state with icon and helper text when no templates exist
- [ ] Lists all templates by name with kind + truncated commit hash subtitle
- [ ] Clicking a template selects it (highlighted with blue left border)
- [ ] Count badge in header updates on changes
- [ ] [+ New] button opens the create form in the right panel

### 7.3 Right Panel — Empty State
- [ ] Shows "Select a template to view details" when nothing selected

### 7.4 Right Panel — Template Detail
- [ ] Shows template name as heading
- [ ] Shows kind as a styled badge
- [ ] Shows full commit hash in monospace with "Copy" button
- [ ] Copy button writes to clipboard via `navigator.clipboard.writeText`
- [ ] Shows description if present (preserves whitespace/newlines)
- [ ] Shows hints as bullet list if present
- [ ] Shows changed files list with path, status, and +/- line counts
- [ ] File statuses are color-coded (green=added, red=deleted, yellow=renamed)
- [ ] Shows relative timestamps for created/updated

### 7.5 Right Panel — Create Form
- [ ] Opens when [+ New] is clicked
- [ ] Name field validates kebab-case on change
- [ ] Name field shows inline error for invalid input
- [ ] Kind dropdown defaults to "commit" (only option for now)
- [ ] Commit hash field validates via API on blur
- [ ] Shows commit subject line on successful validation (green check)
- [ ] Shows "Commit not found" on failed validation (red x)
- [ ] Description textarea is optional
- [ ] Hints textarea accepts one hint per line
- [ ] Cancel button returns to previous state (detail or empty)
- [ ] Submit button is disabled while submitting
- [ ] On successful create: closes form, refreshes list, selects new template
- [ ] On error: shows error message inline (red box below form)

### 7.6 Right Panel — Edit Form
- [ ] Opens when "Edit" action is triggered (button or context menu)
- [ ] Name, kind, and commit hash are read-only (displayed as text, not inputs)
- [ ] Description and hints are editable
- [ ] On save: PATCH request, close form, refresh list

### 7.7 Context Menu
- [ ] Right-clicking a template in the list shows context menu
- [ ] Menu items: "Replicate…", "Edit", "Delete"
- [ ] "Delete" is styled in red
- [ ] Clicking outside closes the menu
- [ ] Menu is positioned at cursor coordinates
- [ ] Menu renders in a portal to avoid overflow clipping

### 7.8 Replicate Dialog
- [ ] Opens as a modal overlay (uses shared `<Dialog>`)
- [ ] Shows template name and truncated commit hash (read-only)
- [ ] "What should change?" textarea is required and auto-focused
- [ ] Model field is optional
- [ ] Submit button disabled when instruction is empty or while submitting
- [ ] On success: closes dialog (optionally navigates to queue tab)
- [ ] On error: shows error inline in the dialog
- [ ] Esc key or backdrop click closes the dialog

### 7.9 Delete Confirmation
- [ ] Shows native `confirm()` dialog with template name
- [ ] On confirm: sends DELETE request, deselects if deleted was selected, refreshes list
- [ ] On cancel: no action

### 7.10 Real-Time Updates
- [ ] Component listens for `templates-changed` CustomEvent on `window`
- [ ] Template list refreshes automatically when event fires
- [ ] If another user/tab creates or deletes a template, list updates without manual refresh
- [ ] Event listener is cleaned up on unmount

### 7.11 Dark Theme Compatibility
- [ ] All text colors use `dark:` variant classes
- [ ] All background colors use `dark:` variant classes
- [ ] All border colors use `dark:` variant classes
- [ ] Kind badge, file status colors, error boxes all work in dark theme

### 7.12 Edge Cases
- [ ] Selecting a template that was deleted server-side shows graceful error / clears selection
- [ ] Rapid workspace switching resets state correctly (no stale data)
- [ ] Very long template names truncate with ellipsis in list panel
- [ ] Templates with no description or hints render detail view without blank sections
- [ ] Commit hash copy works in HTTPS context (clipboard API requires secure context)
- [ ] Form doesn't double-submit (button disabled during request)

---

## 8. File Summary

| File | Action | Lines (est.) |
|------|--------|-------------|
| `types/dashboard.ts` | Modify | +1 word |
| `layout/Router.tsx` | Modify | +1 entry |
| `repos/RepoDetail.tsx` | Modify | +3 lines (import, tab, render) |
| `repos/RepoTemplatesTab.tsx` | **Create** | ~550–700 |

Total estimated new/changed: ~600 lines (mostly the new component file).
