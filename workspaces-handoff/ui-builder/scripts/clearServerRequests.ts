//? used when running npm run dev
//? in dev mode we dont need the production apis and syncs so we clear them to avoid it erroring when e.g. changing file names

import fs from "fs";

let apiMap = "export const apis: Record<string, { auth: any, main: any }> = { };\n";
let syncMap = "export const syncs: Record<string, { main: any, auth: Record<string, any> }> | any = { };\n";
let functionsMap = "export const functions: Record<string, any> = { };";

const output = `${apiMap}\n${syncMap}\n${functionsMap}`;

fs.writeFileSync("./server/prod/generatedApis.ts", output);
// console.log("✅ server/prod/generatedApis.ts Cleared");
