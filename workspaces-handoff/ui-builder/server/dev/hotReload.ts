import chokidar from "chokidar";
import { initializeApis, initializeFunctions, initializeSyncs } from "./loader";

// ----------------------------
// Watcher for Hot Reload
// ----------------------------
export const setupWatchers = () => {
  if (process.env.NODE_ENV !== "development") return;

  const handleChange = (path: string) => {
    const normalizedPath = path.replace(/\\/g, '/');

    if (normalizedPath.includes('api/')) {
      console.log(`[Watcher] Reloading API due to change in: ${normalizedPath}`);
      initializeApis();
    } else if (normalizedPath.includes('sync/')) {
      console.log(`[Watcher] Reloading Sync due to change in: ${normalizedPath}`);
      initializeSyncs();
    }
  };

  const handleFunctionChange = (path: string) => {
    console.log(`[Watcher] Reloading Function due to change in: ${path.replace(/\\/g, '/')}`);
    initializeFunctions();
  };

  // Watch the main source folders
  chokidar.watch('src', { ignoreInitial: true })
    .on('add', handleChange)
    .on('change', handleChange);

  // Watch functions separately
  chokidar.watch('server/functions', { ignoreInitial: true })
    .on('add', handleFunctionChange)
    .on('change', handleFunctionChange);
};