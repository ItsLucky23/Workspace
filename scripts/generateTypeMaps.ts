import { generateTypeMapFile } from "@luckystack/devkit";
import { execSync } from "child_process";

const run = async () => {
  await generateTypeMapFile();
  try {
    execSync('npx prettier --write "src/_sockets/apiTypes.generated.ts" --ignore-path .prettierignore', { stdio: 'inherit' });
  } catch (err) {
    console.error('[TypeMapGenerator] Failed to format with prettier:', err);
  }
};

// Explicit exit: loading `@luckystack/devkit` transitively loads `@luckystack/core`,
// whose barrel connects to Redis on import. Without an explicit exit the dangling
// ioredis handle keeps the event loop alive and the script hangs.
run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[TypeMapGenerator] Generation failed:', error);
    process.exit(1);
  });
