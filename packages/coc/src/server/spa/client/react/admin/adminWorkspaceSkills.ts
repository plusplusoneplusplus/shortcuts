import type { CocClient, SkillInfo } from '@plusplusoneplusplus/coc-client';

export async function loadEnabledAdminWorkspaceSkills(client: CocClient, workspaceId: string): Promise<SkillInfo[]> {
    const { workspaces } = await client.workspaces.list();
    if (!workspaces.some(workspace => workspace.id === workspaceId && !workspace.virtual && workspace.rootPath?.trim())) {
        throw new Error('Select a registered local execution workspace on the configured machine.');
    }
    const [skills, workspaceConfig, globalConfig] = await Promise.all([
        client.skills.listWorkspace(workspaceId),
        client.skills.getWorkspaceConfig(workspaceId),
        client.skills.getGlobalConfig(),
    ]);
    const disabled = new Set([...workspaceConfig.disabledSkills, ...globalConfig.globalDisabledSkills]);
    return skills.filter(skill => !disabled.has(skill.name)).sort((a, b) => a.name.localeCompare(b.name));
}
