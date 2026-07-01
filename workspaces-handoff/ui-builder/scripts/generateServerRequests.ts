import fs from "fs";
import path from "path";

const normalizePath = (p: string) => p.split(path.sep).join("/");

// Recursively walk dirs to collect _api and _sync files
const walkSrcFiles = (dir: string, results: string[] = []) => {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      walkSrcFiles(fullPath, results);
    } else if (file.endsWith(".ts") && (fullPath.includes("_api") || fullPath.includes("_sync"))) {
      // if (file.endsWith("_client.ts")) continue; // skip client stubs
      results.push(fullPath);
    }
  }
  return results;
};

// Collect server function files
const walkFunctionFiles = (dir: string) => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => normalizePath(path.join(dir, file)));
};

// --------------------
// Collect files
// --------------------
const rawSrcFiles = walkSrcFiles("./src").map(normalizePath).sort();
const functionFiles = walkFunctionFiles("./server/functions").sort();

// --------------------
// Buckets
// --------------------
const apiImports: string[] = [];
const syncImports: string[] = [];
const functionImports: string[] = [];

let apiMap = "export const apis: Record<string, { auth: any, main: any }> = {\n";
let syncMap = "export const syncs: Record<string, { main: any, auth: Record<string, any> }> | any = {\n";
let functionsMap = "export const functions: Record<string, any> = {\n";

let apiCount = 0;
let syncCount = 0;
let fnCount = 0;

// --------------------
// Process API + Sync
// --------------------
rawSrcFiles.forEach((normalized) => {
  const importPath = "../../" + normalized.replace(/\.ts$/, "");

  // API
  if (normalized.includes("_api/")) {
    const varName = `api${apiCount++}`;
    apiImports.push(`import * as ${varName} from '${importPath}';`);

    // capture "games/boerZoektVrouw" and "getGameData"
    const match = normalized.match(/src\/(.+?)\/_api\/(.+)\.ts$/i);
    if (!match) return;
    const [_, pagePath, apiName] = match;
    const routeKey = `api/${pagePath}/${apiName}`; // clean route-like key

    apiMap += `  "${routeKey}": {\n    auth: "auth" in ${varName} ? ${varName}.auth : {},\n    main: ${varName}.main,\n  },\n`;
  }

  // Sync
  if (normalized.includes("_sync/")) {
    const match = normalized.match(/src\/(.+?)\/_sync\/(.+)\.ts$/i);
    if (!match) return;
    const [_, pagePath, syncName] = match;
    const routeKey = `sync/${pagePath}/${syncName}`;
  
    console.log(syncName)
    if (syncName.endsWith("_client")) {
      const varName = `syncClient${syncCount++}`;
      syncImports.push(`import * as ${varName} from '${importPath}';`);
      syncMap += `  "${routeKey}": ${varName}.main,\n`;
    }
  
    if (syncName.endsWith("_server")) {
      const varName = `syncServer${syncCount++}`;
      syncImports.push(`import * as ${varName} from '${importPath}';`);
      syncMap += `  "${routeKey}": { auth: "auth" in ${varName} ? ${varName}.auth : {}, main: ${varName}.main },\n`;
    }
  }
});

// --------------------
// Process Functions
// --------------------
functionFiles.forEach((filePath) => {
  const importPath = "../../" + filePath.replace(/\.ts$/, "");
  const varName = `fn${fnCount++}`;
  functionImports.push(`import * as ${varName} from '${importPath}';`);
  functionsMap += `  ...${varName},\n`;
});

// --------------------
// Close Maps
// --------------------
apiMap += "};\n";
syncMap += "};\n";
functionsMap += "};";

// --------------------
// Final Output
// --------------------
const importStatements = [
  ...apiImports,
  "",
  ...syncImports,
  "",
  ...functionImports,
].join("\n");

const output = `${importStatements}\n\n${apiMap}\n${syncMap}\n${functionsMap}`;

fs.writeFileSync("./server/prod/generatedApis.ts", output);
console.log("✅ server/prod/generatedApis.ts created");
