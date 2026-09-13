import { runDeliveryWatchdog } from '@plusplusoneplusplus/forge';

const configFile = process.argv[2];

if (!configFile) {
    process.exitCode = 2;
} else {
    runDeliveryWatchdog(configFile).catch(() => {
        process.exitCode = 1;
    });
}
