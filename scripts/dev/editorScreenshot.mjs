//? Dev tool — browser-proof that the per-container editor RENDERS via the real Caddy subdomain.
//? Launches headless Chrome via Playwright with `ignoreHTTPSErrors` (Caddy's internal *.localhost
//? CA isn't machine-trusted in dev, so we skip cert verification for this one capture instead of
//? installing the CA), navigates the editor URL, waits for the VS Code workbench, and screenshots.
//?
//?   1) npm run caddy:launch                       # Caddy on :443
//?   2) WS_DEV_EDITOR=1 npm run server             # backend with the dev-launch route
//?   3) curl -X POST .../api/workspaces/devLaunchEditor/v1   # → { url: https://vscode-...  }
//?   4) node scripts/dev/editorScreenshot.mjs "<url>" out.png
//?
//? Verified 2026-07-03: workbench + activitybar + statusbar render, title "… - OpenVSCode Server".

import { chromium } from 'playwright';

const url = process.argv[2];
const out = process.argv[3] ?? 'editor.png';
if (!url) { console.error('usage: node editorScreenshot.mjs <editor-url> [out.png]'); process.exit(1); }

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors', '--no-sandbox'],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('.monaco-workbench', { timeout: 40000 })
  .then(() => console.log('WORKBENCH FOUND'))
  .catch((e) => console.log('no workbench:', e.message.slice(0, 60)));
await page.waitForTimeout(6000);
const info = await page.evaluate(() => ({
  workbench: !!document.querySelector('.monaco-workbench'),
  activitybar: !!document.querySelector('[class*=activitybar]'),
  statusbar: !!document.querySelector('[class*=statusbar]'),
  title: document.title,
}));
console.log('INFO', JSON.stringify(info));
await page.screenshot({ path: out });
await browser.close();
