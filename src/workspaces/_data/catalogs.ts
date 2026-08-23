//? Static pipeline catalogs. The patterns and keys are machine contracts; all labels,
//? categories, descriptions and feed text resolve through the pipeline locale section.

export interface HookCatalogEntry {
  key: string;
  labelKey: string;
  categoryKey: string;
  matcher: string;
  feedsKey: string;
  descKey: string;
  required?: true;
}

export const HOOK_CATALOG: HookCatalogEntry[] = [
  { key: 'Stop', labelKey: 'workspaces.pipeline.catalog.hooks.stop.label', categoryKey: 'workspaces.pipeline.catalog.categories.events', matcher: 'stage-AI finished', feedsKey: 'workspaces.pipeline.catalog.hooks.stop.feeds', descKey: 'workspaces.pipeline.catalog.hooks.stop.desc', required: true },
  { key: 'PostToolUse', labelKey: 'workspaces.pipeline.catalog.hooks.postToolUse.label', categoryKey: 'workspaces.pipeline.catalog.categories.events', matcher: 'every tool call', feedsKey: 'workspaces.pipeline.catalog.hooks.postToolUse.feeds', descKey: 'workspaces.pipeline.catalog.hooks.postToolUse.desc' },
  { key: 'PreCompact', labelKey: 'workspaces.pipeline.catalog.hooks.preCompact.label', categoryKey: 'workspaces.pipeline.catalog.categories.lifecycle', matcher: 'about to auto-compact', feedsKey: 'workspaces.pipeline.catalog.hooks.preCompact.feeds', descKey: 'workspaces.pipeline.catalog.hooks.preCompact.desc' },
];

export const HOOK_KEYS = HOOK_CATALOG.map((h) => h.key);

interface CommandCatalogEntry { pattern: string; labelKey: string; descKey: string }
interface CommandCatalogGroup { categoryKey: string; commands: CommandCatalogEntry[] }

const command = (pattern: string, id: string): CommandCatalogEntry => ({ pattern, labelKey: `workspaces.pipeline.catalog.commands.${id}.label`, descKey: `workspaces.pipeline.catalog.commands.${id}.desc` });

export const COMMAND_CATALOG: CommandCatalogGroup[] = [
  { categoryKey: 'workspaces.pipeline.catalog.categories.packageManagers', commands: [
    command('Bash(npm install)', 'npmInstall'), command('Bash(npm ci)', 'npmCi'), command('Bash(pnpm install)', 'pnpmInstall'), command('Bash(yarn install)', 'yarnInstall'), command('Bash(dotnet restore)', 'dotnetRestore'), command('Bash(go mod download)', 'goModDownload'), command('Bash(pip install:*)', 'pipInstall'),
  ] },
  { categoryKey: 'workspaces.pipeline.catalog.categories.buildRun', commands: [
    command('Bash(npm run build)', 'npmRunBuild'), command('Bash(npm run *)', 'npmRunAny'), command('Bash(dotnet build)', 'dotnetBuild'), command('Bash(go build:*)', 'goBuild'), command('Bash(make:*)', 'make'),
  ] },
  { categoryKey: 'workspaces.pipeline.catalog.categories.testing', commands: [
    command('Bash(npm run test:*)', 'npmRunTest'), command('Bash(npm run coverage)', 'npmCoverage'), command('Bash(dotnet test)', 'dotnetTest'), command('Bash(go test ./...)', 'goTest'),
  ] },
  { categoryKey: 'workspaces.pipeline.catalog.categories.versionControl', commands: [
    command('Bash(git add:*)', 'gitAdd'), command('Bash(git commit:*)', 'gitCommit'), command('Bash(git checkout:*)', 'gitCheckout'), command('Bash(git push:*)', 'gitPush'), command('Bash(git rebase:*)', 'gitRebase'),
  ] },
  { categoryKey: 'workspaces.pipeline.catalog.categories.filesystem', commands: [
    command('Edit(*)', 'editFiles'), command('Write(*)', 'writeFiles'), command('Bash(mkdir:*)', 'mkdir'), command('Bash(rm:*)', 'rm'),
  ] },
  { categoryKey: 'workspaces.pipeline.catalog.categories.containers', commands: [
    command('Bash(docker:*)', 'docker'), command('Bash(docker compose:*)', 'dockerCompose'), command('Bash(kubectl:*)', 'kubectl'),
  ] },
  { categoryKey: 'workspaces.pipeline.catalog.categories.database', commands: [
    command('Bash(psql:*)', 'psql'), command('Bash(mysql:*)', 'mysql'), command('Bash(redis-cli:*)', 'redisCli'), command('Bash(mongosh:*)', 'mongosh'),
  ] },
  { categoryKey: 'workspaces.pipeline.catalog.categories.network', commands: [
    command('Bash(curl:*)', 'curl'), command('Bash(npm publish)', 'npmPublish'), command('Bash(sudo:*)', 'sudo'), command('Bash(rm -rf:*)', 'rmRf'),
  ] },
];

interface NetworkCatalogEntry { key: string; labelKey: string; descKey: string }
export const NETWORK_CATEGORIES: NetworkCatalogEntry[] = [
  { key: 'package-registries', labelKey: 'workspaces.pipeline.catalog.network.packageRegistries.label', descKey: 'workspaces.pipeline.catalog.network.packageRegistries.desc' },
  { key: 'source-hosts', labelKey: 'workspaces.pipeline.catalog.network.sourceHosts.label', descKey: 'workspaces.pipeline.catalog.network.sourceHosts.desc' },
  { key: 'ai-apis', labelKey: 'workspaces.pipeline.catalog.network.aiApis.label', descKey: 'workspaces.pipeline.catalog.network.aiApis.desc' },
  { key: 'cdns', labelKey: 'workspaces.pipeline.catalog.network.cdns.label', descKey: 'workspaces.pipeline.catalog.network.cdns.desc' },
  { key: 'cloud', labelKey: 'workspaces.pipeline.catalog.network.cloud.label', descKey: 'workspaces.pipeline.catalog.network.cloud.desc' },
  { key: 'social', labelKey: 'workspaces.pipeline.catalog.network.social.label', descKey: 'workspaces.pipeline.catalog.network.social.desc' },
  { key: 'trackers', labelKey: 'workspaces.pipeline.catalog.network.trackers.label', descKey: 'workspaces.pipeline.catalog.network.trackers.desc' },
];
