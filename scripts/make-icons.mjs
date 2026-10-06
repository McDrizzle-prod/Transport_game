// Renders the PNG app icons from client/public/icons/icon.svg (run: node scripts/make-icons.mjs).
// Needs Chromium; set CHROMIUM_PATH if Playwright's browser is not installed.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const dir = new URL('../client/public/icons/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', dir), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();

async function render(file, size, { maskable = false } = {}) {
  // Maskable icons need a full-bleed background with the artwork inside the 80% safe zone.
  const art = maskable ? svg.replace('rx="112"', 'rx="0"') : svg;
  const inner = maskable ? `<div style="width:80%;height:80%;margin:10%">${svg.replace(/<rect[^>]*\/>/, '')}</div>` : art;
  const bg = maskable ? 'linear-gradient(135deg,#ffd54a,#fb8c00)' : 'transparent';
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;background:${bg}">${inner}</div></body></html>`,
  );
  await page.locator('div').first().screenshot({ path: new URL(file, dir).pathname, omitBackground: true });
}

await render('icon-192.png', 192);
await render('icon-512.png', 512);
await render('icon-maskable-512.png', 512, { maskable: true });
await render('apple-touch-icon.png', 180, { maskable: true });
await browser.close();
console.log('icons written');
