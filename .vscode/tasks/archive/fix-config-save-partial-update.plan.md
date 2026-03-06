# Fix: Config Save Should Not Require Model When Unchanged

## Problem

On the CoC dashboard Configuration page, when a user only changes **Parallelism** (or any other field) and clicks **Save**, the operation fails with:

> **"Model must be non-empty"**

The Model field is rendered as a blank text input (because the user hasn't set a model in `config.yaml`). The frontend validation unconditionally requires `model` to be non-empty before sending the request, blocking saves for any other field.

## Root Cause

**File:** `packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx`

```ts
const handleSaveConfig = useCallback(async () => {
    const errors: string[] = [];
    if (!configForm.model?.trim()) errors.push('Model must be non-empty');
    // ...
    if (errors.length) {
        addToast(errors.join('; '), 'error');
        return; // ← blocks save entirely
    }
    const payload = { model: configForm.model, parallel, output: configForm.output, ... };
    await fetch('.../admin/config', { method: 'PUT', body: JSON.stringify(payload) });
```

The validation and payload always include `model`, even when the user never touched it.

**File:** `packages/coc-server/src/admin-handler.ts`

```ts
if ('model' in body) {
    if (typeof body.model !== 'string' || body.model.length === 0) {
        errors.push('model must be a non-empty string');
    }
}
```

The backend correctly uses `'model' in body` to only validate when the field is present — so the backend already supports partial updates. Only the frontend is broken.

## Proposed Fix

### Frontend (`AdminPanel.tsx`)

1. **Remove the unconditional model validation.**  
   Only validate model if the user has actually typed something in the field.

2. **Omit empty fields from the save payload.**  
   If `configForm.model` is blank, do not include `model` in the PUT body.  
   The backend will then leave the existing `config.yaml` value untouched.

```ts
// NEW validation
if (configForm.model?.trim()) {
    // model is present — it's valid as long as it's non-empty (already satisfied)
} 
// no error if model is blank — just don't send it

// NEW payload construction
const payload: Record<string, unknown> = {};
if (configForm.model?.trim()) payload.model = configForm.model.trim();
payload.parallel = parallel;
payload.output = configForm.output;
if (timeoutValue !== undefined) payload.timeout = timeoutValue;
// include other non-empty fields similarly
```

### No backend changes needed

The backend `admin-handler.ts` already conditionally validates and applies only the fields present in the request body.

## Scope

- **Changed file:** `packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx`
- **Unchanged:** backend handler, config loader, YAML write logic

## Edge Cases

| Scenario | Expected behavior |
|---|---|
| Model blank, change parallelism → Save | Saves; model in `config.yaml` unchanged |
| Model set, clear it → Save | Should **warn** or prevent clearing (optional: show warning but allow save without `model` key, reverting to default) |
| Model blank on a fresh install (no config.yaml) | Save succeeds; no model written to config |
| All fields at default, click Save | Save succeeds with empty payload; server returns current config |

## Open Question

Should clearing an existing model value (typing then deleting) be allowed to save (effectively removing `model` from config), or should it be blocked? The simplest safe behavior: treat an empty model field as "no change" — don't send it, don't clear it.
