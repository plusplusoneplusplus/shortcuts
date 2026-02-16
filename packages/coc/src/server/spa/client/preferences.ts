/**
 * Client-side preferences — fetches and persists user UI preferences
 * (e.g. last-selected AI model) via the /api/preferences REST endpoint.
 *
 * On load, the saved model is applied to all model <select> elements.
 * On change, the selection is persisted back to the server.
 */

import { getApiBase } from './config';

// ============================================================================
// State
// ============================================================================

/** Last known model preference (empty string = "Default"). */
let savedModel = '';

/** Whether initial preferences have been loaded. */
let loaded = false;

// ============================================================================
// API Helpers
// ============================================================================

/**
 * Fetch preferences from the server and apply saved model to all selects.
 * Called once on SPA init.
 */
export async function loadPreferences(): Promise<void> {
    try {
        const res = await fetch(getApiBase() + '/preferences');
        if (!res.ok) return;
        const prefs = await res.json();
        if (typeof prefs.lastModel === 'string') {
            savedModel = prefs.lastModel;
        }
        loaded = true;
        applyModelToAllSelects();
    } catch {
        // Silently ignore — preferences are optional
    }
}

/**
 * Persist the current model preference to the server.
 */
export async function saveModelPreference(model: string): Promise<void> {
    savedModel = model;
    try {
        await fetch(getApiBase() + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastModel: model }),
        });
    } catch {
        // Fire-and-forget — don't block UI on save failure
    }
}

// ============================================================================
// DOM Helpers
// ============================================================================

/** Well-known model select element IDs used across the SPA. */
const MODEL_SELECT_IDS = [
    'enqueue-model',     // Enqueue dialog
    'fp-model',          // Follow Prompt dialog
    'update-doc-model',  // Update Document dialog
];

/**
 * Apply the saved model value to all known model <select> elements.
 * If the saved value doesn't exist as an <option>, falls back to "".
 */
export function applyModelToAllSelects(): void {
    for (const id of MODEL_SELECT_IDS) {
        applyModelToSelect(id);
    }
}

/**
 * Apply the saved model to a single <select> element by ID.
 * Useful when a dialog dynamically creates/populates a model select.
 */
export function applyModelToSelect(selectId: string): void {
    if (!loaded) return;
    const sel = document.getElementById(selectId) as HTMLSelectElement | null;
    if (!sel) return;
    // Only set if the option exists in the select
    const optionExists = Array.from(sel.options).some(opt => opt.value === savedModel);
    if (optionExists) {
        sel.value = savedModel;
    }
}

/**
 * Get the currently saved model preference.
 */
export function getSavedModel(): string {
    return savedModel;
}

/**
 * Attach a change listener to a model <select> element so that
 * selecting a model automatically persists the choice.
 */
export function watchModelSelect(selectId: string): void {
    const sel = document.getElementById(selectId) as HTMLSelectElement | null;
    if (!sel) return;
    sel.addEventListener('change', () => {
        saveModelPreference(sel.value);
    });
}

/**
 * Initialize model persistence for statically rendered selects.
 * Should be called once during SPA bootstrap, after the DOM is ready.
 */
export function initModelPersistence(): void {
    // Attach change watchers to the main enqueue-model select
    watchModelSelect('enqueue-model');
}
