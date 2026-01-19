import * as vscode from 'vscode';
import { BaseTreeDataProvider } from './base-tree-data-provider';

/**
 * Base class for tree data providers that support filtering/searching.
 * Extends BaseTreeDataProvider with filter management capabilities.
 */
export abstract class FilterableTreeDataProvider<T extends vscode.TreeItem> 
    extends BaseTreeDataProvider<T> {
    
    private filterText: string = '';
    
    /**
     * Sets the filter text and refreshes the tree.
     * Filter is stored in lowercase for case-insensitive matching.
     */
    setFilter(text: string): void {
        this.filterText = text.toLowerCase();
        this.refresh();
    }
    
    /**
     * Clears the filter and refreshes the tree.
     */
    clearFilter(): void {
        this.filterText = '';
        this.refresh();
    }
    
    /**
     * Gets the current filter text.
     */
    getFilter(): string {
        return this.filterText;
    }
    
    /**
     * Checks if a filter is currently active.
     */
    protected get hasFilter(): boolean {
        return this.filterText.length > 0;
    }
    
    /**
     * Checks if any of the provided fields match the current filter.
     * @param fields Variable number of string fields to check (undefined fields are skipped)
     * @returns true if no filter is active or any field matches
     */
    protected matchesFilter(...fields: (string | undefined)[]): boolean {
        if (!this.hasFilter) {
            return true;
        }
        
        return fields.some(field => 
            field?.toLowerCase().includes(this.filterText)
        );
    }
}
