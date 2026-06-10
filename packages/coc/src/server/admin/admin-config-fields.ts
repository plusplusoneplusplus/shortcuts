/**
 * Admin Config Field Registry — derived from the unified setting definitions.
 *
 * The single source of truth for admin-editable settings lives in
 * `config/admin-setting-definitions.ts`. This module derives the
 * validate/apply field specs consumed by the PUT /api/admin/config handler
 * and the RuntimeConfigService. Do not add fields here — add ONE definition
 * entry in admin-setting-definitions.ts instead.
 */

import type { CLIConfig } from '../../config';
import {
    ADMIN_SETTING_DEFINITIONS,
    applyAdminSettingValue,
    validateAdminSettingValue,
    type AdminConfigFieldRuntime,
} from '../../config/admin-setting-definitions';

export type { AdminConfigFieldRuntime };

export interface AdminConfigFieldSpec {
    /** Flat key used in the PUT /api/admin/config request body, e.g. 'loops.enabled' */
    key: string;
    /** Runtime behavior: 'live' (immediate), 'reloadable', or 'restartRequired' */
    runtime: AdminConfigFieldRuntime;
    /** Return an error message string if invalid, undefined if valid */
    validate: (value: unknown) => string | undefined;
    /** Write the (already-validated) value into the CLIConfig that will be persisted */
    apply: (config: CLIConfig, value: unknown) => void;
}

/**
 * All admin-editable config fields.
 * The admin handler derives editableKeys, validation, and merge entirely from this list.
 */
export const ADMIN_CONFIG_FIELDS: readonly AdminConfigFieldSpec[] = ADMIN_SETTING_DEFINITIONS.map(def => ({
    key: def.key,
    runtime: def.runtime,
    validate: (value: unknown) => validateAdminSettingValue(def, value),
    apply: (config: CLIConfig, value: unknown) => applyAdminSettingValue(config, def, value),
}));

/** Flat keys accepted by PUT /api/admin/config — derived from the registry. */
export const ADMIN_EDITABLE_KEYS: readonly string[] = ADMIN_CONFIG_FIELDS.map(f => f.key);

/** Build a key→metadata map for API responses. */
export function getAdminFieldMetadata(): Record<string, { runtime: AdminConfigFieldRuntime }> {
    const meta: Record<string, { runtime: AdminConfigFieldRuntime }> = {};
    for (const field of ADMIN_CONFIG_FIELDS) {
        meta[field.key] = { runtime: field.runtime };
    }
    return meta;
}
