/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import {
  getInputTypeFromFile,
  getSyncClientDataType,
  API_VERSION_TOKEN_REGEX,
  SYNC_VERSION_TOKEN_REGEX,
  assertNoDuplicateNormalizedRouteKeys,
  assertValidRouteNaming,
} from '@luckystack/devkit';
import { ROOT_DIR, getSrcDir, getServerDir } from '@luckystack/core';

const normalizePath = (p: string) => p.split(path.sep).join("/");

const mapApiPagePath = (pagePath?: string): string => {
  return pagePath && pagePath.length > 0 ? pagePath : 'system';
};

const extractServiceFromPath = (workspaceRelativePath: string): string => {
  // path starts with src/
  // Either src/_api/... (system) or src/vehicles/_api/... (vehicles)
  const segments = workspaceRelativePath.split('/');
  if (segments.length > 1 && (segments[1] === '_api' || segments[1] === '_sync')) {
    return 'system';
  }
  return segments[1] || 'system';
};

// Recursively walk dirs to collect _api and _sync files
const walkSrcFiles = (dir: string, results: string[] = []) => {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      //? `src/playground/**` is a DEV-ONLY fixture tree (unauthenticated demo +
      //? resource-amplifying stream endpoints). Never bake it into the PRODUCTION
      //? route maps — dev still serves it via the live devkit loader. Keeping it
      //? out here is the structural gate so a forgotten manual deletion can't ship
      //? the playground to prod.
      if (file === 'playground') continue;
      walkSrcFiles(fullPath, results);
    } else if (file.endsWith(".ts") && !file.endsWith(".tests.ts") && (fullPath.includes("_api") || fullPath.includes("_sync"))) {
      results.push(fullPath);
    }
  }
  return results;
};

// Collect function files recursively
const walkFunctionFiles = (dir: string, results: string[] = []) => {
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      walkFunctionFiles(fullPath, results);
    } else if (entry.endsWith(".ts")) {
      results.push(normalizePath(fullPath));
    }
  }

  return results;
};

// --------------------
// Preset plan
// --------------------
//? WITH the router topology — `services.config.ts` + `deploy.config.ts` +
//? `server/config/presetLoader.ts`, all added by `npx luckystack add router` — we
//? emit one bundle per preset, each filtered to that preset's services.
//?
//? WITHOUT the router (a base install) none of those files exist. We then emit a
//? SINGLE bundle named `default` containing every service — matching the runtime
//? fallback in `@luckystack/server` (`resolvePresets()` falls back to `['default']`
//? when no preset is requested). So a bare `npm run server` in prod loads
//? `generatedApis.default.ts`.
interface PresetPlan {
  /** Preset names to emit a bundle for. */
  presets: string[];
  /** Services allowed in a preset, or `null` to include EVERY service (base install). */
  servicesForPreset: (preset: string) => string[] | null;
}

const DEFAULT_PRESET_NAME = 'default';

const loadPresetPlan = async (): Promise<PresetPlan> => {
  const servicesConfigPath = path.join(process.cwd(), 'services.config.ts');
  const presetLoaderPath = path.join(process.cwd(), 'server', 'config', 'presetLoader.ts');
  const hasRouterConfig = fs.existsSync(servicesConfigPath) && fs.existsSync(presetLoaderPath);

  if (!hasRouterConfig) {
    return { presets: [DEFAULT_PRESET_NAME], servicesForPreset: () => null };
  }

  //? Non-literal specifier so `tsc` doesn't try to resolve `presetLoader` (which
  //? is absent in a base, no-router install). At runtime tsx resolves it fine
  //? because the file exists in this branch.
  const loaderSpecifier = ['..', 'server', 'config', 'presetLoader'].join('/');
  const loader = (await import(loaderSpecifier)) as {
    loadBuildConfig: () => unknown;
    validatePresetsAndServices: (config: unknown) => void;
    resolveRequestedPresets: (requested: string[], config: unknown) => string[];
    getServicesForPreset: (presetName: string, config: unknown) => string[];
  };

  const buildConfig = loader.loadBuildConfig();
  loader.validatePresetsAndServices(buildConfig);
  const requestedArgs = process.argv.slice(2);
  const presets = loader.resolveRequestedPresets(requestedArgs, buildConfig);
  return {
    presets,
    servicesForPreset: (presetName: string) => loader.getServicesForPreset(presetName, buildConfig),
  };
};

// --------------------
// Build
// --------------------
const run = async () => {
  const plan = await loadPresetPlan();

  const srcDir = getSrcDir();
  assertValidRouteNaming({
    srcDir,
    context: 'generating server request maps for build',
  });
  assertNoDuplicateNormalizedRouteKeys({
    srcDir,
    context: 'generating server request maps for build',
  });

  const rawSrcFiles = walkSrcFiles(srcDir).map(normalizePath).sort();

  // Collect functions: project-level functions/ overrides server/functions/ by module name.
  // This establishes the merge contract for Phase 1 (full registry, no pruning).
  const serverFunctionFiles = walkFunctionFiles("./server/functions");
  const projectFunctionFiles = walkFunctionFiles("./functions");

  const functionFilesByName = new Map<string, string>();
  for (const filePath of serverFunctionFiles) {
    functionFilesByName.set(path.basename(filePath, ".ts"), filePath);
  }
  // Project functions win on name collision — same key replaces the server default.
  for (const filePath of projectFunctionFiles) {
    functionFilesByName.set(path.basename(filePath, ".ts"), filePath);
  }
  const functionFiles = Array.from(functionFilesByName.values()).sort();

  // --------------------
  // Iterate over each preset and build maps
  // --------------------
  for (const presetName of plan.presets) {
    //? `null` = base install → include EVERY service (no preset filtering).
    const allowedServices = plan.servicesForPreset(presetName);

    const apiImports: string[] = [];
    const syncImports: string[] = [];
    const functionImports: string[] = [];

    //? Generated route maps use `unknown` because each consumer's API/sync
    //? handler signature is unique — the framework dispatcher narrows at the
    //? call site after auth + input validation. `auth` is loosely typed because
    //? consumers can extend `AuthProps` via module augmentation.
    let apiMap = "export const apis: Record<string, { auth: Record<string, unknown>, main: (...args: unknown[]) => unknown, rateLimit?: number | false, httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE', inputType?: string, inputTypeFilePath?: string, validation?: 'strict' | 'relaxed' | { input: 'skip' | 'strict' }, errorFormatter?: (...args: unknown[]) => unknown }> = {\n";
    let syncMap = "export const syncs: Record<string, { main: (...args: unknown[]) => unknown, auth: Record<string, unknown>, inputType?: string, inputTypeFilePath?: string, validation?: 'strict' | 'relaxed' | { input: 'skip' | 'strict' }, errorFormatter?: (...args: unknown[]) => unknown }> = {\n";
    let functionsMap = "export const functions: Record<string, Record<string, unknown>> = {\n";

    let apiCount = 0;
    let syncCount = 0;
    let fnCount = 0;

    // Process API + Sync
    rawSrcFiles.forEach((normalized) => {
      const workspaceRelativePath = normalizePath(path.relative(ROOT_DIR, normalized));
      const serviceName = extractServiceFromPath(workspaceRelativePath);

      if (allowedServices !== null && !allowedServices.includes(serviceName)) return;

      const importPath = "../../" + workspaceRelativePath.replace(/\.ts$/, "");

      // API
      if (normalized.includes("_api/")) {
        const varName = `api${apiCount++}`;
        apiImports.push(`import * as ${varName} from '${importPath}';`);

        const match = normalized.match(/src\/(?:(.+?)\/)?_api\/(.+)\.ts$/i);
        if (!match) return;
        const [_, pagePath, apiNameWithVersion] = match;
        const versionMatch = apiNameWithVersion.match(API_VERSION_TOKEN_REGEX);
        if (!versionMatch) return;

        const version = `v${versionMatch[1]}`;
        const apiName = apiNameWithVersion.replace(API_VERSION_TOKEN_REGEX, '');
        const routeKey = `api/${mapApiPagePath(pagePath)}/${apiName}/${version}`;

        apiMap += `  "${routeKey}": (() => {\n    const mod = ${varName} as Record<string, unknown>;\n    return {\n      auth: ("auth" in mod ? mod.auth : {}) as Record<string, unknown>,\n      main: mod.main as (...args: unknown[]) => unknown,\n      rateLimit: mod.rateLimit as number | false | undefined,\n      httpMethod: mod.httpMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined,\n      inputType: ${JSON.stringify(getInputTypeFromFile(normalized))},\n      inputTypeFilePath: ${JSON.stringify(workspaceRelativePath)},\n      validation: mod.validation as 'strict' | 'relaxed' | { input: 'skip' | 'strict' } | undefined,\n      errorFormatter: mod.errorFormatter as ((...args: unknown[]) => unknown) | undefined,\n    };\n  })(),\n`;
      }

      // Sync
      if (normalized.includes("_sync/")) {
        const match = normalized.match(/src\/(?:(.+?)\/)?_sync\/(.+)\.ts$/i);
        if (!match) return;
        const [_, pagePath, syncNameWithVersion] = match;
        const syncMatch = syncNameWithVersion.match(SYNC_VERSION_TOKEN_REGEX);
        if (!syncMatch) return;

        const kind = syncMatch[1];
        const version = `v${syncMatch[2]}`;
        const syncName = syncNameWithVersion.replace(SYNC_VERSION_TOKEN_REGEX, '');
        const routeKey = pagePath ? `sync/${pagePath}/${syncName}/${version}` : `sync/${syncName}/${version}`;

        if (kind === 'client') {
          const varName = `syncClient${syncCount++}`;
          syncImports.push(`import * as ${varName} from '${importPath}';`);
          syncMap += `  "${routeKey}_client": ${varName}.main,\n`;
        }

        if (kind === 'server') {
          const varName = `syncServer${syncCount++}`;
          syncImports.push(`import * as ${varName} from '${importPath}';`);
          const inputType = getSyncClientDataType(normalized);
          syncMap += `  "${routeKey}_server": (() => {\n    const mod = ${varName} as Record<string, unknown>;\n    return {\n      auth: (("auth" in mod ? mod.auth : {}) as Record<string, unknown>),\n      main: mod.main as (...args: unknown[]) => unknown,\n      inputType: ${JSON.stringify(inputType)},\n      inputTypeFilePath: ${JSON.stringify(workspaceRelativePath)},\n      validation: mod.validation as 'strict' | 'relaxed' | { input: 'skip' | 'strict' } | undefined,\n      errorFormatter: mod.errorFormatter as ((...args: unknown[]) => unknown) | undefined,\n    };\n  })(),\n`;
        }
      }
    });

    // Process Functions (Phase 1: all functions are included regardless of service)
    functionFiles.forEach((filePath) => {
      const importPath = "../../" + filePath.replace(/\.ts$/, "");
      const varName = `fn${fnCount++}`;
      const fileName = path.basename(filePath, ".ts");
      functionImports.push(`import * as ${varName} from '${importPath}';`);
      functionsMap += `  ${JSON.stringify(fileName)}: (() => {\n`;
      functionsMap += `    const { default: _default, ...named } = ${varName} as Record<string, unknown>;\n`;
      functionsMap += `    const cleaned = Object.fromEntries(Object.entries(named).filter(([key]) => key !== '__esModule'));\n`;
      functionsMap += `    if (Object.keys(cleaned).length > 0) return cleaned;\n`;
      functionsMap += `    return _default !== undefined ? { ${JSON.stringify(fileName)}: _default } : {};\n`;
      functionsMap += `  })(),\n`;
    });

    apiMap += "};\n";
    syncMap += "};\n";
    functionsMap += "};";

    const importStatements = [
      ...apiImports,
      "",
      ...syncImports,
      "",
      ...functionImports,
    ].join("\n");

    const output = `${importStatements}\n\n${apiMap}\n${syncMap}\n${functionsMap}`;

    const outFileName = `generatedApis.${presetName}.ts`;
    const outDir = path.join(getServerDir(), 'prod');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, outFileName), output);
    console.log(`✅ server/prod/${outFileName} created for preset '${presetName}'`);
  }
};

run()
  .then(() => {
    // Explicit exit: loading `@luckystack/{core,devkit}` transitively connects to
    // Redis on import. Without an explicit exit the dangling ioredis handle keeps
    // the event loop alive and the script hangs.
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
