/**
 * Unified set of tool names that write or create files.
 * Shared between conversationScan.ts (References panel) and
 * scratchpadUtils.ts (Scratchpad auto-open) so both surfaces
 * recognise the same tools.
 */
export const FILE_WRITE_TOOLS = new Set([
    // Generic create / write
    'create',
    'write_file',
    'create_file',
    // Patch-based create/edit
    'apply_patch',
    // Editor / replacement tools
    'edit_file',
    'edit',
    'str_replace_editor',
    'str_replace_based_edit_tool',
]);
