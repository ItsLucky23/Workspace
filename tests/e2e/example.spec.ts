import { test, expect } from '@playwright/test';

//? Deterministic CI complement: after agent-browser confirms a flow interactively,
//? capture it here as a committed @playwright/test spec (no LLM in the CI loop).
//? Start the dev server first (npm run server + npm run client). Remove this file
//? if you don't want the @playwright/test layer.
test('home page loads', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  await expect(page).toHaveTitle(/.+/);
});
