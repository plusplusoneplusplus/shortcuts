// Minimal test to isolate the ConfigurationManager issue
import { ConfigurationManager } from './src/shortcuts/configuration-manager';

// Try to create an instance
const manager = new ConfigurationManager('/tmp');

// Try to call a method
manager.loadConfiguration().then(config => {
    console.log('Config loaded:', config);
}).catch(err => {
    console.error('Error:', err);
});