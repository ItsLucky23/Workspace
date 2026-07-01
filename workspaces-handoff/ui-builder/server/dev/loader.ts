import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { tryCatch } from "../functions/tryCatch";

// ----------------------------
// Storage for loaded modules
// ----------------------------
export const devApis: Record<string, any> = {};
export const devSyncs: Record<string, any> = {};
export const devFunctions: Record<string, any> = {};

// ----------------------------
// Unified Initialization
// ----------------------------
export const initializeAll = async () => {
  await Promise.all([initializeApis(), initializeSyncs(), initializeFunctions()]);
  console.log(devApis)
  console.log(devSyncs)
  console.log("DEV modules initialized.");
  // console.log(devFunctions)
};

// ----------------------------
// Helper: convert absolute path to proper file URL for import
// ----------------------------
const importFile = async (absolutePath: string) => {
  const url = pathToFileURL(absolutePath).href;
  return import(`${url}?update=${Date.now()}`);
};

// ----------------------------
// API Loader
// ----------------------------
export const initializeApis = async () => {
  Object.keys(devApis).forEach(k => delete devApis[k]);
  const srcFolder = fs.readdirSync(path.resolve("./src"));

  for (const file of srcFolder) {
    await scanApiFolder(file);
  }
};

const scanApiFolder = async (file: string, basePath = "") => {
  const fullPath = path.join("./src", basePath, file);
  if (!fs.statSync(fullPath).isDirectory()) return;

  if (file.toLowerCase().endsWith("api")) {
    const files = fs.readdirSync(fullPath);
    for (const f of files) {
      if (!f.endsWith(".ts")) continue;

      const modulePath = path.join(fullPath, f);
      const [err, module] = await tryCatch(async () => importFile(modulePath));
      if (err) continue;

      const { auth = {}, main } = module;
      if (!main || typeof main !== "function") continue;

      // const pageLocation = modulePath.split(`/${file}/`)[0].replace(/^src[\/\\]/, "");
      let pageLocation = path
        .join(basePath, file)
        .replace(/^src[\/\\]/, '')
        .replace(/\\/g, '/')
        .split("/api")[0];

      const lastSlash = pageLocation.lastIndexOf('/');
      if (lastSlash !== -1) {
        pageLocation = pageLocation.substring(0, lastSlash);
      }

      devApis[`api/${pageLocation}/${f.replace(".ts", "")}`] = {
        main,
        auth: {
          login: auth.login || false,
          additional: auth.additional || [],
        },
      };
    }
  } else {
    const subFolders = fs.readdirSync(fullPath);
    for (const sub of subFolders) {
      await scanApiFolder(sub, path.join(basePath, file));
    }
  }
};

// ----------------------------
// Sync Loader
// ----------------------------
export const initializeSyncs = async () => {
  Object.keys(devSyncs).forEach(k => delete devSyncs[k]);
  const srcFolder = fs.readdirSync(path.resolve("./src"));

  for (const file of srcFolder) {
    await scanSyncFolder(file);
  }
};

const scanSyncFolder = async (file: string, basePath = "") => {
  const fullPath = path.join("./src", basePath, file);
  if (!fs.statSync(fullPath).isDirectory()) return;

  if (file.toLowerCase().endsWith("sync")) {
    const files = fs.readdirSync(fullPath);
    for (const f of files) {
      if (!f.endsWith("_client.ts") && !f.endsWith("_server.ts")) { continue; }

      const filePath = path.join(fullPath, f);
      const [fileError, fileResult] = await tryCatch(async () => importFile(filePath));

      if (fileError) { continue; }

      // build the route key similar to API routes
      let pageLocation = path
        .join(basePath, file)
        .replace(/^src[\/\\]/, '')
        .replace(/\\/g, '/')
        .split('/sync')[0];

      // remove last segment
      const lastSlash = pageLocation.lastIndexOf('/');
      if (lastSlash !== -1) {
        pageLocation = pageLocation.substring(0, lastSlash);
      }

      if (f.endsWith("_server.ts")) {
        devSyncs[`sync/${pageLocation}/${f.replace(".ts", "")}`] = { 
          main: fileResult.main, 
          auth: fileResult.auth || {} 
        };
      } else {
        devSyncs[`sync/${pageLocation}/${f.replace(".ts", "")}`] = fileResult.main;
      }

      // // optional _server.ts
      // const serverFile = f.replace("_client.ts", "_server.ts");
      // const serverPath = path.join(fullPath, serverFile);

      // if (fs.existsSync(serverPath)) {
      //   const [errServer, serverModule] = await tryCatch(async () => importFile(serverPath));
      //   if (!errServer && typeof serverModule.main === "function") {
      //     // final key style: sync/games/boerZoektVrouw/getCards
      //     devSyncs[`sync/${pageLocation}/${f.replace("_client.ts", "_server")}`] = { main: serverModule.main, auth: serverModule.auth || {} };
      //   }
      // }


    }
  } else {
    const subFolders = fs.readdirSync(fullPath);
    for (const sub of subFolders) {
      await scanSyncFolder(sub, path.join(basePath, file));
    }
  }
};

// ----------------------------
// Functions Loader
// ----------------------------
export const initializeFunctions = async () => {
  Object.keys(devFunctions).forEach(k => delete devFunctions[k]);
  const functionsFolder = fs.readdirSync(path.resolve("./server/functions"));

  for (const file of functionsFolder) {
    const filePath = path.join("./server/functions", file);
    if (!fs.statSync(filePath).isFile() || !file.endsWith(".ts")) continue;

    const [err, module] = await tryCatch(async () => importFile(filePath));
    if (err) continue;


    Object.assign(devFunctions, module);
  }
};