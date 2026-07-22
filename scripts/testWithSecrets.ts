/// <reference types="node" />

//? Compatibility entrypoint retained for the existing npm script. Since @luckystack/test-runner 0.7.4,
//? `runAllTests` owns env loading + optional secret-manager resolution through testAll's lazy
//? `loadProjectConfig`; resolving pointers here as well would duplicate that boot sequence.
await import('./testAll.ts');
