/**
 * Rule Splitter
 *
 * Splits input by rules for rule-based processing.
 * Designed for code review and similar rule-based workflows.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { Splitter, WorkItem } from '../types';

/**
 * A rule definition
 */
export interface Rule {
    /** Unique identifier for the rule */
    id: string;
    /** Rule filename */
    filename: string;
    /** Full path to the rule file */
    path: string;
    /** Rule content (the rule definition text) */
    content: string;
    /** Optional parsed front matter metadata */
    frontMatter?: Record<string, unknown>;
}

/**
 * Input for rule splitter
 */
export interface RuleInput {
    /** Array of rules to process */
    rules: Rule[];
    /** The content to review against rules (e.g., diff) */
    targetContent: string;
    /** Additional context to include with each work item */
    context?: Record<string, unknown>;
}

/**
 * Work item data for rule processing
 */
export interface RuleWorkItemData {
    /** The rule being applied */
    rule: Rule;
    /** The content to review against this rule */
    targetContent: string;
    /** Common context from input */
    context?: Record<string, unknown>;
}

/**
 * Options for rule splitter
 */
export interface RuleSplitterOptions {
    /**
     * Function to generate work item ID from rule
     * Default: uses rule id or filename
     */
    generateId?: (rule: Rule, index: number) => string;

    /**
     * Filter function to exclude certain rules
     */
    filter?: (rule: Rule) => boolean;

    /**
     * Function to validate a rule before including it
     * Returns true if valid, false to skip
     */
    validate?: (rule: Rule) => boolean;

    /**
     * Sort function for rules (determines processing order)
     */
    sort?: (a: Rule, b: Rule) => number;
}

/**
 * Splitter that creates a work item for each rule
 */
export class RuleSplitter implements Splitter<RuleInput, RuleWorkItemData> {
    constructor(private options: RuleSplitterOptions = {}) {}

    split(input: RuleInput): WorkItem<RuleWorkItemData>[] {
        const { rules, targetContent, context } = input;
        const { generateId, filter, validate, sort } = this.options;

        // Filter rules
        let processedRules = filter
            ? rules.filter(filter)
            : [...rules];

        // Validate rules
        if (validate) {
            processedRules = processedRules.filter(validate);
        }

        // Sort rules
        if (sort) {
            processedRules.sort(sort);
        }

        // Generate work items
        return processedRules.map((rule, index) => {
            const id = generateId
                ? generateId(rule, index)
                : `rule-${rule.id || this.sanitizeFilename(rule.filename)}`;

            return {
                id,
                data: {
                    rule,
                    targetContent,
                    context
                },
                metadata: {
                    ruleId: rule.id,
                    ruleFilename: rule.filename,
                    rulePath: rule.path,
                    index,
                    totalRules: processedRules.length,
                    frontMatter: rule.frontMatter
                }
            };
        });
    }

    /**
     * Sanitize filename for use in ID
     */
    private sanitizeFilename(filename: string): string {
        return filename
            .replace(/\.[^/.]+$/, '') // Remove extension
            .replace(/[^a-zA-Z0-9-_]/g, '-') // Replace special chars
            .toLowerCase();
    }
}

/**
 * Factory function to create a rule splitter
 */
export function createRuleSplitter(options?: RuleSplitterOptions): RuleSplitter {
    return new RuleSplitter(options);
}

/**
 * Create a rule splitter with alphabetical sorting
 */
export function createAlphabeticRuleSplitter(options?: Omit<RuleSplitterOptions, 'sort'>): RuleSplitter {
    return new RuleSplitter({
        ...options,
        sort: (a, b) => a.filename.localeCompare(b.filename)
    });
}

/**
 * Create a rule splitter with priority-based sorting
 * Rules with lower priority numbers are processed first
 */
export function createPriorityRuleSplitter(
    getPriority: (rule: Rule) => number,
    options?: Omit<RuleSplitterOptions, 'sort'>
): RuleSplitter {
    return new RuleSplitter({
        ...options,
        sort: (a, b) => getPriority(a) - getPriority(b)
    });
}

/**
 * Create a rule splitter that filters by file patterns
 * Only includes rules that apply to the given file extensions
 */
export function createPatternFilteredRuleSplitter(
    fileExtensions: string[],
    options?: Omit<RuleSplitterOptions, 'filter'>
): RuleSplitter {
    const normalizedExtensions = new Set(
        fileExtensions.map(ext =>
            ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
        )
    );

    return new RuleSplitter({
        ...options,
        filter: (rule) => {
            // Check if rule has appliesTo in front matter
            const appliesTo = rule.frontMatter?.['applies-to'] as string[] | undefined;
            if (!appliesTo || !Array.isArray(appliesTo)) {
                return true; // Include rules without pattern restrictions
            }

            // Check if any pattern matches our extensions
            for (const pattern of appliesTo) {
                // Handle glob patterns like *.ts, *.js
                if (pattern.startsWith('*.')) {
                    const ext = pattern.slice(1).toLowerCase();
                    if (normalizedExtensions.has(ext)) {
                        return true;
                    }
                }
            }

            return false;
        }
    });
}

/**
 * Batch rule splitter that groups multiple rules into single work items
 */
export interface BatchedRuleWorkItemData {
    /** Array of rules in this batch */
    rules: Rule[];
    /** The content to review against these rules */
    targetContent: string;
    /** Common context from input */
    context?: Record<string, unknown>;
    /** Batch index */
    batchIndex: number;
}

/**
 * Splitter that creates work items with batches of rules
 */
export class BatchedRuleSplitter implements Splitter<RuleInput, BatchedRuleWorkItemData> {
    constructor(
        private batchSize: number = 3,
        private options: Omit<RuleSplitterOptions, 'generateId'> = {}
    ) {}

    split(input: RuleInput): WorkItem<BatchedRuleWorkItemData>[] {
        const { rules, targetContent, context } = input;
        const { filter, validate, sort } = this.options;

        // Filter and validate rules
        let processedRules = filter
            ? rules.filter(filter)
            : [...rules];

        if (validate) {
            processedRules = processedRules.filter(validate);
        }

        if (sort) {
            processedRules.sort(sort);
        }

        const workItems: WorkItem<BatchedRuleWorkItemData>[] = [];
        const totalBatches = Math.ceil(processedRules.length / this.batchSize);

        for (let i = 0; i < processedRules.length; i += this.batchSize) {
            const batch = processedRules.slice(i, i + this.batchSize);
            const batchIndex = Math.floor(i / this.batchSize);

            workItems.push({
                id: `rule-batch-${batchIndex}`,
                data: {
                    rules: batch,
                    targetContent,
                    context,
                    batchIndex
                },
                metadata: {
                    batchIndex,
                    totalBatches,
                    rulesInBatch: batch.length,
                    totalRules: processedRules.length,
                    ruleFilenames: batch.map(r => r.filename)
                }
            });
        }

        return workItems;
    }
}

/**
 * Factory function to create a batched rule splitter
 */
export function createBatchedRuleSplitter(
    batchSize: number,
    options?: Omit<RuleSplitterOptions, 'generateId'>
): BatchedRuleSplitter {
    return new BatchedRuleSplitter(batchSize, options);
}
