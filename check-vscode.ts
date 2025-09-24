import * as vscode from 'vscode';

// Check if there's a ConfigurationManager in vscode namespace
console.log('vscode keys:', Object.keys(vscode).filter(k => k.includes('Configuration')));

// Check if there's a ConfigurationManager class
const hasConfigManager = 'ConfigurationManager' in vscode;
console.log('Has ConfigurationManager:', hasConfigManager);

if (hasConfigManager) {
    console.log('ConfigurationManager type:', typeof (vscode as any).ConfigurationManager);
}