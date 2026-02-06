#!/usr/bin/env node

/**
 * Build-time validation script for AI model references.
 *
 * Validates that model enum values in package.json match the central model
 * registry defined in packages/pipeline-core/src/ai/model-registry.ts.
 *
 * Usage:
 *   node scripts/validate-model-registry.js
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - Validation errors found
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ============================================================================
// Load package.json model enums
// ============================================================================

function loadPackageJsonModels() {
    const packageJsonPath = path.join(ROOT, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    const config = packageJson.contributes?.configuration?.properties || {};

    const results = {};

    // workspaceShortcuts.aiService.model
    const aiServiceModel = config['workspaceShortcuts.aiService.model'];
    if (aiServiceModel?.enum) {
        // Filter out empty string (the "use default" option)
        results.aiServiceModel = aiServiceModel.enum.filter(v => v !== '');
    }

    // workspaceShortcuts.followPrompt.defaultModel
    const followPromptModel = config['workspaceShortcuts.followPrompt.defaultModel'];
    if (followPromptModel?.enum) {
        results.followPromptModel = followPromptModel.enum;
    }

    return results;
}

// ============================================================================
// Load model registry IDs from source
// ============================================================================

function loadRegistryModelIds() {
    const registryPath = path.join(ROOT, 'packages', 'pipeline-core', 'src', 'ai', 'model-registry.ts');
    const content = fs.readFileSync(registryPath, 'utf-8');

    // Extract model IDs from the MODEL_DEFINITIONS array
    const idRegex = /id:\s*'([^']+)'/g;
    const ids = [];
    let match;
    while ((match = idRegex.exec(content)) !== null) {
        ids.push(match[1]);
    }

    return ids;
}

// ============================================================================
// Load bundled pipeline YAML model references
// ============================================================================

function loadBundledPipelineModels() {
    const pipelinesDir = path.join(ROOT, 'resources', 'bundled-pipelines');
    if (!fs.existsSync(pipelinesDir)) {
        return [];
    }

    const models = [];
    const yamlFiles = findFiles(pipelinesDir, '.yaml').concat(findFiles(pipelinesDir, '.yml'));

    for (const file of yamlFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        // Match model: "value" or model: 'value' or model: value (but not in comments or template variables)
        const modelRegex = /^\s*model:\s*["']?([^"'\s#{}]+)["']?\s*(?:#.*)?$/gm;
        let match;
        while ((match = modelRegex.exec(content)) !== null) {
            const modelId = match[1];
            // Skip template variables like {{model}}
            if (!modelId.startsWith('{{')) {
                models.push({ file: path.relative(ROOT, file), model: modelId });
            }
        }
    }

    return models;
}

function findFiles(dir, ext) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findFiles(fullPath, ext));
        } else if (entry.name.endsWith(ext)) {
            results.push(fullPath);
        }
    }
    return results;
}

// ============================================================================
// Validation
// ============================================================================

function validate() {
    const errors = [];
    const warnings = [];

    // Load data
    const registryIds = loadRegistryModelIds();
    const packageJsonModels = loadPackageJsonModels();
    const pipelineModels = loadBundledPipelineModels();

    console.log('Model Registry Validation');
    console.log('========================');
    console.log(`Registry models: [${registryIds.join(', ')}]`);
    console.log();

    // 1. Validate package.json aiService.model enum
    if (packageJsonModels.aiServiceModel) {
        const pkgModels = packageJsonModels.aiServiceModel;
        console.log(`package.json aiService.model enum: [${pkgModels.join(', ')}]`);

        // Check for models in package.json but not in registry
        for (const model of pkgModels) {
            if (!registryIds.includes(model)) {
                errors.push(`package.json 'aiService.model' contains '${model}' which is not in model registry`);
            }
        }

        // Check for models in registry but not in package.json
        for (const model of registryIds) {
            if (!pkgModels.includes(model)) {
                errors.push(`Model '${model}' is in registry but missing from package.json 'aiService.model' enum`);
            }
        }

        // Check order matches
        if (pkgModels.length === registryIds.length) {
            for (let i = 0; i < pkgModels.length; i++) {
                if (pkgModels[i] !== registryIds[i]) {
                    warnings.push(`package.json 'aiService.model' order differs from registry at index ${i}: '${pkgModels[i]}' vs '${registryIds[i]}'`);
                    break;
                }
            }
        }
    }

    // 2. Validate package.json followPrompt.defaultModel enum
    if (packageJsonModels.followPromptModel) {
        const fpModels = packageJsonModels.followPromptModel;
        console.log(`package.json followPrompt.defaultModel enum: [${fpModels.join(', ')}]`);

        for (const model of fpModels) {
            if (!registryIds.includes(model)) {
                errors.push(`package.json 'followPrompt.defaultModel' contains '${model}' which is not in model registry`);
            }
        }

        for (const model of registryIds) {
            if (!fpModels.includes(model)) {
                errors.push(`Model '${model}' is in registry but missing from package.json 'followPrompt.defaultModel' enum`);
            }
        }
    }

    // 3. Validate bundled pipeline YAML models
    if (pipelineModels.length > 0) {
        console.log(`\nBundled pipeline model references:`);
        for (const { file, model } of pipelineModels) {
            console.log(`  ${file}: ${model}`);
            if (!registryIds.includes(model)) {
                warnings.push(`Bundled pipeline '${file}' references model '${model}' which is not in model registry`);
            }
        }
    }

    // Report results
    console.log();

    if (warnings.length > 0) {
        console.log(`⚠  Warnings (${warnings.length}):`);
        for (const w of warnings) {
            console.log(`   ${w}`);
        }
        console.log();
    }

    if (errors.length > 0) {
        console.log(`✗  Errors (${errors.length}):`);
        for (const e of errors) {
            console.log(`   ${e}`);
        }
        console.log();
        console.log('Validation FAILED. Please ensure package.json model enums match the registry.');
        console.log('Registry location: packages/pipeline-core/src/ai/model-registry.ts');
        process.exit(1);
    }

    console.log('✓  All model references are consistent with the registry.');
    process.exit(0);
}

validate();
