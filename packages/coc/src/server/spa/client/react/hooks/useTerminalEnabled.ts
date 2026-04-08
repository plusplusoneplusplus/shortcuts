import { useDisplaySettings } from './useDisplaySettings';

export function useTerminalEnabled(): boolean {
    return useDisplaySettings().terminalEnabled;
}
