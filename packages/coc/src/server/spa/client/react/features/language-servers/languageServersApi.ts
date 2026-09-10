/**
 * Workspace-scoped language-server configuration for the SPA.
 *
 * Every call routes through `getCocClientForWorkspace`, so configuration is
 * read from and written to the host that owns the files — not the host whose
 * page happens to be on screen, and not a repo group's virtual workspace.
 */

import type {
    LanguageServerConfigRejection,
    LanguageServerConfigResponse,
    LanguageServerConfigUpdate,
} from '@plusplusoneplusplus/coc-client';
import { parseLanguageServerRejection } from '@plusplusoneplusplus/coc-client';
import { getCocClientForWorkspace } from '../../repos/cloneRegistry';

export const languageServersApi = {
    get(workspaceId: string): Promise<LanguageServerConfigResponse> {
        return getCocClientForWorkspace(workspaceId).languageServers.get(workspaceId);
    },

    /** Replace the config. Omitted fields fall back to the disabled default. */
    replace(workspaceId: string, config: LanguageServerConfigUpdate): Promise<LanguageServerConfigResponse> {
        return getCocClientForWorkspace(workspaceId).languageServers.replace(workspaceId, config);
    },

    /** Merge into the stored config. Omitted fields keep their stored values. */
    update(workspaceId: string, config: LanguageServerConfigUpdate): Promise<LanguageServerConfigResponse> {
        return getCocClientForWorkspace(workspaceId).languageServers.update(workspaceId, config);
    },
};

export type { LanguageServerConfigRejection };

/**
 * Field-level errors from a rejected write, or `null` when the failure was
 * something else. A settings form anchors messages on `errors[].field` and
 * restores `config` as the last valid state.
 */
export { parseLanguageServerRejection };
