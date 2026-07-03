//? Dev tool — browser-verify the editor edge-auth matrix (Track B5) via Playwright headless Chrome
//? with ignoreHTTPSErrors (Caddy's internal *.localhost CA isn't machine-trusted in dev). Two
//? cases against the same vscode-<slug> subdomain:
//?   1) NO session cookie  → forward_auth blocks (no VS Code workbench renders).
//?   2) MEMBER session cookie → forward_auth allows → the real VS Code workbench renders (shot).
//? Args: <editor-url> <member-session-token> [out.png]. The session cookie is injected scoped to
//? `localhost` so Chrome sends it to the subdomain (mirrors WS_COOKIE_DOMAIN=localhost in prod).

import { chromium } from 'playwright';

const url = process.argv[2];
const memberToken = process.argv[3];
const out = process.argv[4] ?? 'editor-auth.png';
if (!url || !memberToken) { console.error('usage: node editorAuthMatrix.mjs <url> <memberToken> [out.png]'); process.exit(1); }
const cookieHost = new URL(url).hostname;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors', '--no-sandbox'],
});

async function probe(label, cookie) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  if (cookie) await ctx.addCookies([{ name: 'token', value: cookie, domain: cookieHost, path: '/' }]);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForSelector('.monaco-workbench', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(9000);
  const info = await page.evaluate(() => ({
    workbench: !!document.querySelector('.monaco-workbench'),
    body: document.body.innerText.slice(0, 40).replace(/\n/g, ' '),
  }));
  console.log(`[${label}] workbench=${info.workbench} body="${info.body}"`);
  await ctx.close();
  return info;
}

console.log('=== case 1: NO session → must be BLOCKED ===');
await probe('no-session', null);

console.log('=== case 2: MEMBER session → must RENDER the editor ===');
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'token', value: memberToken, domain: cookieHost, path: '/' }]);
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
await page.waitForSelector('.monaco-workbench', { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(9000);
const info = await page.evaluate(() => ({
  workbench: !!document.querySelector('.monaco-workbench'),
  activitybar: !!document.querySelector('[class*=activitybar]'),
  title: document.title,
  body: document.body.innerText.slice(0, 50).replace(/\n/g, ' '),
}));
console.log(`[member] workbench=${info.workbench} activitybar=${info.activitybar} title="${info.title}" body="${info.body}"`);
await page.screenshot({ path: out });
console.log('screenshot ->', out);
await ctx.close();
await browser.close();
