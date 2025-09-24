import { ConfigurationManager } from './src/shortcuts/configuration-manager';

const manager = new ConfigurationManager('/tmp');
console.log('ConfigurationManager created successfully');
console.log('Methods available:', Object.getOwnPropertyNames(Object.getPrototypeOf(manager)));