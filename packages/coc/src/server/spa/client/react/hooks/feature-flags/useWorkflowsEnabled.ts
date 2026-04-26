import { useDisplaySettings } from '../preferences/useDisplaySettings';

export function useWorkflowsEnabled(): boolean {
    return useDisplaySettings().workflowsEnabled;
}
