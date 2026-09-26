export const TREE_BASE_INDENT_PX = 6;
export const TREE_DEPTH_INDENT_PX = 8;

export function getTreeNodePaddingLeft(depth: number): number {
    return TREE_BASE_INDENT_PX + depth * TREE_DEPTH_INDENT_PX;
}
