/**
 * Utility class for filter matching operations in tree data providers.
 */
export class FilterMatcher {
    private readonly filterLower: string;
    
    constructor(filterText: string) {
        this.filterLower = filterText.toLowerCase();
    }
    
    /**
     * Checks if any of the provided fields match the filter (case-insensitive).
     * @param fields Variable number of string fields to check
     * @returns true if any field matches
     */
    matches(...fields: (string | undefined)[]): boolean {
        return fields.some(field => 
            field?.toLowerCase().includes(this.filterLower)
        );
    }
    
    /**
     * Checks if any property values of an object match the filter.
     * @param obj Object to check
     * @param keys Property keys to check
     * @returns true if any property value matches
     */
    matchesObject<T>(obj: T, ...keys: (keyof T)[]): boolean {
        return keys.some(key => {
            const value = obj[key];
            return typeof value === 'string' && 
                   value.toLowerCase().includes(this.filterLower);
        });
    }
    
    /**
     * Gets the filter text in lowercase.
     */
    getFilterText(): string {
        return this.filterLower;
    }
}
