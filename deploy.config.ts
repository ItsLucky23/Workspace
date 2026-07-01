//? Deploy-time topology — added by `npx luckystack add router`. Single-instance
//? projects can leave `environments` empty — only `resources` is consumed by the
//? framework's synchronizedEnvHashes check. `environments` / `routing` /
//? `development` are read by `@luckystack/router` for split/multi-instance
//? deployments; populate them (per-service URL bindings, the router listen port
//? via `routing.defaultRouterPort`, an optional `fallback` env) when you scale out.

import { registerDeployConfig } from '@luckystack/core';

export type ResourceType = 'redis' | 'mongo';

export interface ResourceDefinition {
  type: ResourceType;
  /**
   * Name of the env var that identifies this resource instance. For Mongo this
   * is typically the full connection string (DATABASE_URL); for Redis this can
   * be REDIS_HOST when host+port+password are split across several env vars.
   */
  urlEnvKey: string;
  /**
   * Env keys whose values MUST match across every environment that references
   * this resource (used by the router's boot handshake).
   */
  synchronizedEnvKeys?: string[];
}

export interface EnvironmentDefinition<TEnvKey extends string = string> {
  /** Resource key from `resources` above. */
  redis: string;
  /** Resource key from `resources` above. */
  mongo: string;
  /** Optional fallback environment key. Must be a valid key of `environments`. */
  fallback?: TEnvKey;
  /** Per-service URL bindings for this environment. */
  bindings: Record<string, string>;
}

export interface DeployConfig<TEnvKey extends string = string> {
  resources: Record<string, ResourceDefinition>;
  environments: Record<TEnvKey, EnvironmentDefinition<TEnvKey>>;
  routing?: {
    onMissingService?: 'hard-error' | 'proxy-fallback';
    missingServiceErrorCode?: string;
    enableUnhealthyFallback?: boolean;
    strictBootHandshake?: boolean;
    /** TCP port the router listens on (default 4000). Also overridable via ROUTER_PORT env. */
    defaultRouterPort?: number;
  };
  development?: {
    enableFallbackRouting?: boolean;
    healthPollMs?: number;
    switchNewTrafficToLocalWhenHealthy?: boolean;
  };
}

const deployConfig: DeployConfig = {
  resources: {
    redisShared: {
      type: 'redis',
      urlEnvKey: 'REDIS_HOST',
      synchronizedEnvKeys: ['PROJECT_NAME'],
    },
    mongoShared: {
      type: 'mongo',
      urlEnvKey: 'DATABASE_URL',
    },
  },
  //? Single-instance default: no cross-environment routing. Add entries here
  //? (development / staging / production with their resource + per-service URL
  //? bindings) once you run the app behind `npm run router`. Example:
  //?
  //?   environments: {
  //?     development: {
  //?       redis: 'redisShared', mongo: 'mongoShared',
  //?       bindings: { system: 'http://localhost:4100' },
  //?     },
  //?   },
  //?   routing: { defaultRouterPort: 4000 },
  environments: {},
};

registerDeployConfig(deployConfig);

export default deployConfig;
