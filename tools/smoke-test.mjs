#!/usr/bin/env node
/* A quick check that the built site still works, in headless Chrome, before it's published.
   Run by .github/workflows/pages.yml after tools/build-pages.mjs; if a step fails, the site isn't published.
   It never touches the live database: it tests two copies of _site/ made in a temporary folder:
     1. Demo mode (all CONFIG keys blank, so nothing is sent anywhere): home shows cards; searching a list leaves the matching
        snacks; rating a snack without signing in (as a guest) says "Saved" and offers Next; "Haven't tried it" skips to
        another snack and Undo comes back; the guest's profile counts the rating and has no Sign out; the + asks a guest to
        sign in, then opens the add form; after signing in the profile still counts the rating; no JavaScript errors.
     2. Database unreachable (the Supabase address points nowhere): a list page says it couldn't load the latest ratings.
   Try it locally:  node tools/build-pages.mjs
                    npm install --no-save --no-package-lock playwright-core@1.48.2
                    node tools/smoke-test.mjs
   Uses the Google Chrome already installed (on GitHub's machines too), so there's no browser to download. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, '_site');
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json'};

let failed = 0;
const pass = msg => console.log('PASS  ' + msg);
const fail = (msg, extra = '') => { failed++; console.log('FAIL  ' + msg + (extra ? '\n      ' + extra : '')); };
const step = async (msg, fn) => { try { await fn(); pass(msg); } catch (e) { fail(msg, String(e.message || e).split('\n')[0]); } };

// A copy of _site/ with app.js's CONFIG changed
async function copySite(name, config) {
  const dir = path.join(os.tmpdir(), `tasterank-smoke-${name}-${process.pid}`);
  await fs.rm(dir, {recursive: true, force: true});
  await fs.cp(SITE, dir, {recursive: true});
  let js = await fs.readFile(path.join(dir, 'app.js'), 'utf8');
  for (const [k, v] of Object.entries(config)) {
    const re = new RegExp(`(${k}:')[^']*(')`);
    if (!re.test(js)) throw new Error(`app.js CONFIG has no ${k}`);
    js = js.replace(re, (m, a, b) => a + v + b);
  }
  await fs.writeFile(path.join(dir, 'app.js'), js);
  return dir;
}
// Serves a folder the way GitHub Pages does (as tools/serve.mjs does for _site/)
function serve(dir) {
  return new Promise(ok => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x'), rel = decodeURIComponent(url.pathname), file = path.join(dir, rel);
      const send = async (f, status = 200) => { res.writeHead(status, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream'}); res.end(await fs.readFile(f)); };
      if (!file.startsWith(dir)) { res.writeHead(400); return res.end(); }
      try {
        const st = await fs.stat(file);
        if (st.isDirectory()) {
          if (!rel.endsWith('/')) { res.writeHead(301, {Location: rel + '/'}); return res.end(); }
          return await send(path.join(file, 'index.html'));
        }
        return await send(file);
      } catch { return send(path.join(dir, '404.html'), 404).catch(() => { res.writeHead(404); res.end(); }); }
    }).listen(0, '127.0.0.1', () => ok({server, base: `http://127.0.0.1:${server.address().port}`}));
  });
}

await fs.access(path.join(SITE, 'index.html')).catch(() => { console.error('No _site/: run node tools/build-pages.mjs first'); process.exit(1); });
const blank = {SUPABASE_URL: '', SUPABASE_ANON_KEY: '', WEB3FORMS_KEY: '', GOATCOUNTER_CODE: '', TURNSTILE_SITE_KEY: ''};
const demoDir = await copySite('demo', blank);
const downDir = await copySite('down', {SUPABASE_URL: 'http://127.0.0.1:9', WEB3FORMS_KEY: '', GOATCOUNTER_CODE: ''});
const demo = await serve(demoDir), down = await serve(downDir);
const browser = await chromium.launch({channel: 'chrome', headless: true});
// Every visitor here is in the UK, wherever the test runs (GitHub's machines are in the US, where the demo has no snacks)
const ukVisitor = async ctx => { await ctx.route('https://api.country.is/', r => r.fulfill({contentType: 'application/json', body: '{"country":"GB"}'})); return ctx; };

try {
  // ---------- 1. Demo mode: the main journey ----------
  console.log('Demo mode');
  const ctx = await ukVisitor(await browser.newContext({viewport: {width: 390, height: 844}}));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.setDefaultTimeout(10000);

  await step('home shows the category cards', async () => {
    await page.goto(demo.base + '/');
    await page.locator('#cards .lc').first().waitFor();
  });
  await step('a list page draws its ranking', async () => {
    await page.goto(demo.base + '/uk/crisps/');
    await page.locator('#v-category button.nm').first().waitFor();
  });
  await step('searching the list for "cheddar" leaves 3 snacks', async () => {
    await page.locator('#v-category .ls-q').fill('cheddar');
    const rows = await page.locator('#v-category .list .ir:visible').count();
    const said = (await page.locator('#v-category .ls-count').innerText()).trim();
    if (rows !== 3 || said !== '3 of 13 match') throw new Error(`${rows} rows, and it says "${said}"`);
    await page.locator('#v-category .ls-q').press('Escape');
    if (await page.locator('#v-category .list .ir:visible').count() !== 13) throw new Error('Escape did not bring the whole list back');
  });
  await step('rating a snack without signing in says "Saved" and offers the next one', async () => {
    await page.goto(demo.base + '/uk/crisps/');
    if (!(await page.getByRole('button', {name: 'Sign in', exact: true}).isVisible())) throw new Error('the visitor is already signed in');
    await page.locator('#v-category button.nm').first().click();
    if (await page.locator('#m-signin').isVisible()) throw new Error('it asked to sign in');
    await page.locator('#rate-body').getByRole('button', {name: 'Love it'}).click();
    await page.locator('#rate-body .saved', {hasText: 'Saved'}).waitFor();
    const next = await page.locator('#rate-body [data-act="next"]').innerText();
    if (!/^Next/.test(next.trim())) throw new Error(`the button says "${next.trim()}"`);
  });
  await step('"Haven\'t tried it" moves on to another snack, and Undo comes back', async () => {
    await page.keyboard.press('Escape');
    await page.locator('#v-category button.nm').nth(1).click();
    const title = page.locator('#rate-title'), first = (await title.innerText()).trim();
    await page.locator('#rate-body').getByRole('button', {name: /Haven't tried it/}).click();
    await page.locator('#rate-body .skipped', {hasText: first}).waitFor();
    const second = (await title.innerText()).trim();
    if (second === first) throw new Error(`it stayed on "${first}"`);
    await page.locator('#rate-body .skipped').getByRole('button', {name: /Undo/}).click();
    await page.locator('#rate-title', {hasText: first}).waitFor();
  });
  await step('a guest\'s profile counts the rating, with no Sign out', async () => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name: 'Profile'}).click();
    await page.locator('#v-profile .guest-note').waitFor();
    const stat = await page.locator('.stat').first().innerText();
    if (!/^1\s+snack rated/.test(stat.trim())) throw new Error(`it says "${stat.replace(/\s+/g, ' ')}"`);
    if (await page.locator('#v-profile [data-act="sign-out"]').count()) throw new Error('a guest has Sign out');
  });
  await step('the + asks a guest to sign in, then opens "Add to Crisps"', async () => {
    await page.goto(demo.base + '/uk/crisps/');
    await page.locator('#add-fab').click();
    await page.locator('#m-signin').getByRole('button', {name: /Continue with Google/}).click();
    await page.getByRole('dialog').filter({hasText: 'Add to Crisps'}).waitFor();
  });
  await step('after signing in, the profile still counts the rating', async () => {
    await page.goto(demo.base + '/me/');
    const stat = await page.locator('.stat').first().innerText();
    if (!/^1\s+snack rated/.test(stat.trim())) throw new Error(`it says "${stat.replace(/\s+/g, ' ')}"`);
  });
  if (errors.length) fail('no JavaScript errors', errors.slice(0, 3).join(' | ')); else pass('no JavaScript errors');
  await ctx.close();

  // ---------- 2. Database unreachable ----------
  console.log('Database unreachable');
  const ctx2 = await ukVisitor(await browser.newContext({viewport: {width: 390, height: 844}}));
  const page2 = await ctx2.newPage();
  page2.setDefaultTimeout(15000);
  await step('a list page says it couldn\'t load the latest ratings', async () => {
    await page2.goto(down.base + '/uk/crisps/');
    await page2.getByRole('alert').filter({hasText: "Couldn't load the latest ratings"}).waitFor();
  });
  await step('home says it couldn\'t load', async () => {
    await page2.goto(down.base + '/');
    await page2.locator('#cards', {hasText: "Couldn't load snacks"}).waitFor();
  });
  await ctx2.close();
} finally {
  await browser.close();
  demo.server.close(); down.server.close();
  await fs.rm(demoDir, {recursive: true, force: true});
  await fs.rm(downDir, {recursive: true, force: true});
}
console.log(failed ? `\n${failed} check(s) failed: the site won't be published.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
