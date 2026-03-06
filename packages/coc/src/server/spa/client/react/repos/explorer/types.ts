/** Re-export tree types for use by explorer components. */
export interface TreeEntry {
    name: string;
    type: 'file' | 'dir';
    size?: number;
    path: string;
}
