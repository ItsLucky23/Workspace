//? Stop-hook capture (claude-cli provider). The Claude CLI pipes the Stop-hook payload
//? — which carries `last_assistant_message` (P0.5 spike, row B4) — to this script on
//? stdin at turn end. We persist the raw JSON so the provider can read the final message
//? without standing up an HTTP endpoint per call. argv[2] = output file. Best-effort:
//? never throw back into the CLI.
import { writeFileSync } from 'node:fs';

let data = '';
process.stdin.on('data', (chunk) => { data += chunk; });
process.stdin.on('end', () => {
  try { writeFileSync(process.argv[2], data); } catch { /* best-effort — the provider times out if this fails */ }
  process.exit(0);
});
