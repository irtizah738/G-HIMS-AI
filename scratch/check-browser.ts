import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (msg) => {
    console.log(`[BROWSER CONSOLE ${msg.type()}]:`, msg.text());
  });

  page.on('pageerror', (err) => {
    console.log('[BROWSER UNCAUGHT ERROR]:', err.message, err.stack);
  });

  page.on('requestfailed', (req) => {
    console.log('[BROWSER REQUEST FAILED]:', req.url(), req.failure()?.errorText);
  });

  console.log('Navigating to http://localhost:3000 ...');
  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 15000 });
  } catch (e: any) {
    console.log('Navigation ended/timed out:', e.message);
  }

  // Wait 3 seconds to observe any loops or state changes
  await page.waitForTimeout(3000);

  const url = page.url();
  console.log('Final URL:', url);

  const text = await page.evaluate(() => document.body.innerText);
  console.log('Page text snippet:\n', text.slice(0, 500));

  await browser.close();
}

main().catch(console.error);
