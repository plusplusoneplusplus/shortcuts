import { useDisplaySettings } from '../preferences/useDisplaySettings';

export function usePullRequestsEnabled(): boolean {
    return useDisplaySettings().pullRequestsEnabled;
}
