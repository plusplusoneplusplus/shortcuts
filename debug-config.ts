import { ConfigurationManager } from './src/shortcuts/configuration-manager';

// This should show what TypeScript thinks the constructor signature is
const manager: ConfigurationManager = new ConfigurationManager('/tmp');

// This should show what methods are available
type ConfigMethods = keyof ConfigurationManager;

// Let's see what the constructor expects
const ctor = ConfigurationManager;
console.log('Constructor:', ctor.length); // Number of parameters