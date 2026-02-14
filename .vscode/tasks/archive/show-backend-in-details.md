# Show AI Backend in Process Details

## Problem
When viewing AI process details in the AI Process panel (clicking "View Details"), users cannot see which AI backend was used for that process (SDK, CLI, or Claude/Clipboard).

## Proposed Solution
Add a "Backend" section to the process details view that displays the backend type used for the AI process.

## Implementation

### Files to Modify

1. **`src/shortcuts/ai-service/ai-process-document-provider.ts`**
   - In `formatSingleProcess()` method, add a new section after "Status" to show the backend type
   - Display user-friendly labels: "Copilot SDK", "Copilot CLI", "Clipboard"
   - Handle the case where `process.backend` is undefined (show "Unknown" or skip section)

### Code Changes

Location: `formatSingleProcess()` method (~line 140)

After the Status section, add:
```typescript
// Backend section
if (process.backend) {
    lines.push(`${h} Backend`);
    lines.push(`**${this.formatBackendLabel(process.backend)}**`);
    lines.push('');
}
```

Add helper method:
```typescript
private formatBackendLabel(backend: string): string {
    switch (backend) {
        case 'copilot-sdk': return 'Copilot SDK';
        case 'copilot-cli': return 'Copilot CLI';
        case 'clipboard': return 'Clipboard';
        default: return backend;
    }
}
```

## Work Plan

- [x] Add `formatBackendLabel()` helper method to `AIProcessDocumentProvider`
- [x] Add Backend section in `formatSingleProcess()` after Status section
- [x] Test the changes by viewing AI process details
- [x] Ensure backward compatibility for processes without backend info

## Notes

- The `backend` field already exists on `AIProcess` type (optional field)
- Backend is attached via `attachSessionMetadata()` when the process runs
- Some older/persisted processes may not have backend info - handle gracefully
