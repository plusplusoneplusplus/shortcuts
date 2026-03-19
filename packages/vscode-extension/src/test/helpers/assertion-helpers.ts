import * as assert from 'assert';
import { LogicalGroup, LogicalGroupItem, ShortcutsConfig } from '../../shortcuts/types';

/**
 * Assert that a group exists with the given name
 */
export function assertGroupExists(config: ShortcutsConfig, groupName: string): LogicalGroup {
    const group = findGroup(config.logicalGroups, groupName);
    assert.ok(group, `Group "${groupName}" should exist`);
    return group!;
}

/**
 * Assert that a group does not exist
 */
export function assertGroupDoesNotExist(config: ShortcutsConfig, groupName: string): void {
    const group = findGroup(config.logicalGroups, groupName);
    assert.strictEqual(group, undefined, `Group "${groupName}" should not exist`);
}

/**
 * Assert that a group has a specific number of items
 */
export function assertGroupItemCount(group: LogicalGroup, expectedCount: number): void {
    assert.strictEqual(
        group.items.length,
        expectedCount,
        `Group "${group.name}" should have ${expectedCount} items, but has ${group.items.length}`
    );
}

/**
 * Assert that a group contains a specific item
 */
export function assertGroupContainsItem(
    group: LogicalGroup,
    itemName: string,
    itemType?: 'file' | 'folder'
): LogicalGroupItem {
    const item = group.items.find(i => i.name === itemName);
    assert.ok(item, `Group "${group.name}" should contain item "${itemName}"`);

    if (itemType) {
        assert.strictEqual(
            item!.type,
            itemType,
            `Item "${itemName}" should be of type "${itemType}"`
        );
    }

    return item!;
}

/**
 * Assert that a group does not contain a specific item
 */
export function assertGroupDoesNotContainItem(group: LogicalGroup, itemName: string): void {
    const item = group.items.find(i => i.name === itemName);
    assert.strictEqual(
        item,
        undefined,
        `Group "${group.name}" should not contain item "${itemName}"`
    );
}

/**
 * Assert that a group has a specific description
 */
export function assertGroupDescription(group: LogicalGroup, expectedDescription: string): void {
    assert.strictEqual(
        group.description,
        expectedDescription,
        `Group "${group.name}" should have description "${expectedDescription}"`
    );
}

/**
 * Assert that a nested group exists within a parent
 */
export function assertNestedGroupExists(
    parentGroup: LogicalGroup,
    nestedGroupName: string
): LogicalGroup {
    assert.ok(parentGroup.groups, `Parent group "${parentGroup.name}" should have nested groups`);
    const nestedGroup = parentGroup.groups!.find(g => g.name === nestedGroupName);
    assert.ok(
        nestedGroup,
        `Nested group "${nestedGroupName}" should exist in parent "${parentGroup.name}"`
    );
    return nestedGroup!;
}

/**
 * Assert that configuration has a specific number of groups
 */
export function assertGroupCount(config: ShortcutsConfig, expectedCount: number): void {
    assert.strictEqual(
        config.logicalGroups.length,
        expectedCount,
        `Configuration should have ${expectedCount} groups, but has ${config.logicalGroups.length}`
    );
}

/**
 * Assert that a base path alias exists
 */
export function assertBasePathExists(config: ShortcutsConfig, alias: string): void {
    assert.ok(config.basePaths, 'Configuration should have basePaths');
    const basePath = config.basePaths!.find(bp => bp.alias === alias);
    assert.ok(basePath, `Base path with alias "${alias}" should exist`);
}

/**
 * Assert that an item uses a specific alias
 */
export function assertItemUsesAlias(item: LogicalGroupItem, alias: string): void {
    assert.ok(
        item.path && item.path.startsWith(alias + '/'),
        `Item "${item.name}" should use alias "${alias}", but path is "${item.path}"`
    );
}

/**
 * Find a group by name (searches recursively through nested groups)
 */
function findGroup(groups: LogicalGroup[], groupName: string): LogicalGroup | undefined {
    for (const group of groups) {
        if (group.name === groupName) {
            return group;
        }

        // Search nested groups
        if (group.groups) {
            const nested = findGroup(group.groups, groupName);
            if (nested) {
                return nested;
            }
        }
    }

    return undefined;
}

/**
 * Find a group by path (e.g., "Parent/Child/Grandchild")
 */
export function findGroupByPath(
    config: ShortcutsConfig,
    groupPath: string
): LogicalGroup | undefined {
    const parts = groupPath.split('/');
    let currentGroups = config.logicalGroups;
    let currentGroup: LogicalGroup | undefined;

    for (const part of parts) {
        currentGroup = currentGroups.find(g => g.name === part);
        if (!currentGroup) {
            return undefined;
        }
        currentGroups = currentGroup.groups || [];
    }

    return currentGroup;
}

/**
 * Assert that a group exists at a specific path
 */
export function assertGroupExistsAtPath(config: ShortcutsConfig, groupPath: string): LogicalGroup {
    const group = findGroupByPath(config, groupPath);
    assert.ok(group, `Group at path "${groupPath}" should exist`);
    return group!;
}

