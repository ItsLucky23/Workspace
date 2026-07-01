import servicesConfig, { ServicesConfig, ServiceDefinition, PresetDefinition } from '../../services.config';
import deployConfig, { DeployConfig, EnvironmentDefinition, ResourceDefinition } from '../../deploy.config';

export interface ResolvedConfig {
  services: ServicesConfig;
  deploy: DeployConfig;
}

const SYSTEM_SERVICE_KEY = 'system';
const RESERVED_SYSTEM_FOLDER = 'src/system';

export const loadResolvedConfig = (): ResolvedConfig => {
  return { services: servicesConfig, deploy: deployConfig };
};

// Retained for backwards compatibility with existing callers.
export const loadBuildConfig = (): ResolvedConfig => loadResolvedConfig();

const validateServiceDefinitions = (services: Record<string, ServiceDefinition>): void => {
  const loose = services as Record<string, ServiceDefinition | undefined>;
  const systemService = loose[SYSTEM_SERVICE_KEY];
  if (systemService !== undefined && systemService.source !== 'root') {
    throw new Error(`[presetLoader] The 'system' service is reserved and must have source 'root'. Got '${systemService.source}'.`);
  }

  for (const [serviceName, serviceDef] of Object.entries(services)) {
    if (serviceDef.source === RESERVED_SYSTEM_FOLDER) {
      throw new Error(`[presetLoader] Service '${serviceName}' uses reserved source '${RESERVED_SYSTEM_FOLDER}'. src/system is not a valid service folder.`);
    }
  }
};

const validatePresets = (services: Record<string, ServiceDefinition>, presets: Record<string, PresetDefinition>): void => {
  if (Object.keys(presets).length === 0) {
    throw new Error(`[presetLoader] No presets defined in services.config.ts`);
  }

  const looseServices = services as Record<string, ServiceDefinition | undefined>;
  const serviceToPresetMap = new Map<string, string>();

  for (const [presetName, presetDef] of Object.entries(presets)) {
    for (const serviceName of presetDef.services) {
      if (looseServices[serviceName] === undefined) {
        throw new Error(`[presetLoader] Preset '${presetName}' references service '${serviceName}' which is not defined in services.config.ts`);
      }

      const existingPreset = serviceToPresetMap.get(serviceName);
      if (existingPreset) {
        throw new Error(`[presetLoader] Service '${serviceName}' is assigned to multiple presets: '${existingPreset}' and '${presetName}'. A service may belong to only one preset.`);
      }

      serviceToPresetMap.set(serviceName, presetName);
    }
  }
};

const validateResourceReferences = (
  resources: Record<string, ResourceDefinition>,
  environments: Record<string, EnvironmentDefinition>,
): void => {
  if (Object.keys(resources).length === 0) {
    throw new Error(`[presetLoader] No resources defined in deploy.config.ts`);
  }

  const looseResources = resources as Record<string, ResourceDefinition | undefined>;

  for (const [resourceKey, resource] of Object.entries(resources)) {
    if (!resource.urlEnvKey) {
      throw new Error(`[presetLoader] Resource '${resourceKey}' must declare a non-empty urlEnvKey.`);
    }
  }

  for (const [envName, env] of Object.entries(environments)) {
    const redisResource = looseResources[env.redis];
    if (redisResource === undefined) {
      throw new Error(`[presetLoader] Environment '${envName}' references unknown redis resource '${env.redis}'.`);
    }
    if (redisResource.type !== 'redis') {
      throw new Error(`[presetLoader] Environment '${envName}' references '${env.redis}' as redis, but it is declared as '${redisResource.type}'.`);
    }

    const mongoResource = looseResources[env.mongo];
    if (mongoResource === undefined) {
      throw new Error(`[presetLoader] Environment '${envName}' references unknown mongo resource '${env.mongo}'.`);
    }
    if (mongoResource.type !== 'mongo') {
      throw new Error(`[presetLoader] Environment '${envName}' references '${env.mongo}' as mongo, but it is declared as '${mongoResource.type}'.`);
    }
  }
};

const validateFallbackChain = (
  environments: Record<string, EnvironmentDefinition>,
): void => {
  const looseEnvs = environments as Record<string, EnvironmentDefinition | undefined>;

  for (const [envName, env] of Object.entries(environments)) {
    if (!env.fallback) continue;

    const target = looseEnvs[env.fallback];
    if (target === undefined) {
      throw new Error(`[presetLoader] Environment '${envName}' declares fallback '${env.fallback}' which is not a defined environment.`);
    }

    if (env.redis !== target.redis) {
      throw new Error(`[presetLoader] Environment '${envName}' falls back to '${env.fallback}' but they reference different redis resources ('${env.redis}' vs '${target.redis}'). Fallback requires a shared redis resource.`);
    }

    if (env.mongo !== target.mongo) {
      throw new Error(`[presetLoader] Environment '${envName}' falls back to '${env.fallback}' but they reference different mongo resources ('${env.mongo}' vs '${target.mongo}'). Fallback requires a shared mongo resource.`);
    }

    // Walk the chain to detect cycles.
    const seen = new Set<string>([envName]);
    let cursor: string | undefined = env.fallback;
    while (cursor) {
      if (seen.has(cursor)) {
        throw new Error(`[presetLoader] Fallback cycle detected involving environment '${envName}'.`);
      }
      seen.add(cursor);
      cursor = looseEnvs[cursor]?.fallback;
    }
  }
};

const validateServiceBindings = (
  services: Record<string, ServiceDefinition>,
  environments: Record<string, EnvironmentDefinition>,
): void => {
  const knownServices = new Set(Object.keys(services));
  for (const [envName, env] of Object.entries(environments)) {
    for (const boundService of Object.keys(env.bindings)) {
      if (!knownServices.has(boundService)) {
        throw new Error(`[presetLoader] Environment '${envName}' binds URL for unknown service '${boundService}'. Add it to services.config.ts or remove the binding.`);
      }
    }
  }
};

export const validateResolvedConfig = (config: ResolvedConfig): void => {
  const { services, deploy } = config;
  validateServiceDefinitions(services.services);
  validatePresets(services.services, services.presets);
  validateResourceReferences(deploy.resources, deploy.environments);
  validateFallbackChain(deploy.environments);
  validateServiceBindings(services.services, deploy.environments);
};

// Backwards-compatible alias used by the build script.
export const validatePresetsAndServices = (config: ResolvedConfig): void => {
  validateResolvedConfig(config);
};

export const getServicesForPreset = (presetName: string, config: ResolvedConfig): string[] => {
  const loose = config.services.presets as Record<string, PresetDefinition | undefined>;
  const preset = loose[presetName];
  if (preset === undefined) {
    throw new Error(`[presetLoader] Preset '${presetName}' not found in services.config.ts`);
  }
  return preset.services;
};

export const getAllServiceNames = (config: ResolvedConfig): string[] => {
  return Object.keys(config.services.services);
};

export const resolveRequestedPresets = (requested: string[], config: ResolvedConfig): string[] => {
  const availablePresets = Object.keys(config.services.presets);
  if (requested.length === 0) {
    return availablePresets;
  }

  for (const presetName of requested) {
    if (!availablePresets.includes(presetName)) {
      throw new Error(`[presetLoader] Requested preset '${presetName}' is not defined in services.config.ts`);
    }
  }

  return requested;
};
