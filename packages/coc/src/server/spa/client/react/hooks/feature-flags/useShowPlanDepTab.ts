import { useDisplaySettings } from '../preferences/useDisplaySettings';

export function useShowPlanDepTab(): boolean {
    return useDisplaySettings().showPlanDepTab;
}
