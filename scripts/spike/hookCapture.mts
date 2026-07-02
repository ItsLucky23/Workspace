//? P0.5 spike — the `type:http` hook capture endpoint (Spike B/D, P0_CLI_SPIKE.md §2/§4).
//?
//? A standalone, dependency-free HTTP server that the spike's rendered
//? `.claude/settings.json` points every lifecycle hook at. It logs each POST with a
//? timestamp + the event name (from the URL path `/hook/<EventName>`) and the raw
//? body, and on exit prints WHICH events fired + whether any payload carried a usage
//? field (Spike D1). This is the artifact that lets the operator fill the Spike B/D
//? rows of SPIKE_RESULTS.md. Token-gated (X-WS-Hook-Token) so nothing else can post.
//?
//? NOT part of the app — a manual verification harness (P0_CLI_SPIKE.md: "no new
//? verbs, no persistence"). Run it yourself: `npx tsx scripts/spike/hookCapture.mts`.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = Number(process.env.WS_SPIKE_HOOK_PORT ?? '8790');
const TOKEN = process.env.WS_SPIKE_HOOK_TOKEN ?? 'spike-dev-token';

const seen = new Map<string, number>();
let usageSeen = false;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += String(chunk); });
    req.on('end', () => { resolve(data); });
  });
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    const url = req.url ?? '/';
    const event = url.replace(/^\/hook\//, '').replace(/[/?].*$/, '') || 'unknown';
    const token = req.headers['x-ws-hook-token'];
    if (token !== TOKEN) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'bad-token' }));
      console.warn(`[hook] REJECTED (bad token) for ${event}`);
      return;
    }
    const body = await readBody(req);
    seen.set(event, (seen.get(event) ?? 0) + 1);
    //? Spike D1: does any interactive hook payload carry a usage/tokens field?
    if (/"(usage|tokens|input_tokens|output_tokens)"/.test(body)) usageSeen = true;
    const stamp = new Date().toISOString();
    console.log(`[hook] ${stamp}  ${event}  (${String(body.length)} bytes)`);
    if (body.length > 0) console.log(`       ${body.slice(0, 600)}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  })();
});

server.listen(PORT, () => {
  console.log(`[spike] hook-capture listening on http://127.0.0.1:${String(PORT)}/hook/<EventName>`);
  console.log(`[spike] token = ${TOKEN}  (set WS_SPIKE_HOOK_TOKEN to override)`);
  console.log('[spike] point .claude/settings.json type:http hooks here, then run claude. Ctrl+C for a summary.');
});

function summary(): void {
  console.log('\n[spike] ===== hook summary (fill Spike B/D rows of SPIKE_RESULTS.md) =====');
  if (seen.size === 0) {
    console.log('[spike] NO hooks received — Spike B1 candidate RED-ESCALATE (type:http hooks did not fire interactively).');
  } else {
    for (const [event, count] of seen) console.log(`[spike]   ${event}: ${String(count)}`);
    console.log(`[spike] usage/tokens field seen in a payload: ${usageSeen ? 'YES (Spike D1 GREEN)' : 'NO (Spike D → char-count estimate)'}`);
  }
  process.exit(0);
}

process.on('SIGINT', summary);
process.on('SIGTERM', summary);
