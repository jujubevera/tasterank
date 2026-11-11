#!/usr/bin/env node
/* Builds the published site into _site/: the app's own files, plus one pre-built page for every list, flavour and brand
   that has live snacks, so each one has a real address that Google can read (its own title, description and the ranking
   as plain HTML). The app takes over as soon as it loads. Also writes sitemap.xml and 404.html (a copy of the app, so a
   list made since the last build still opens).

   Run by .github/workflows/pages.yml on every push to main and once a day, so new snacks and ratings reach the pages.
   Try it locally:  node tools/build-pages.mjs  then  node tools/serve.mjs  and open http://localhost:8000
   Needs Node 20 or newer; no packages. Reads only public data, with the same publishable key as the site. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '_site');
const SITE = 'https://tasterank.app';
const PUBLIC = ['index.html', 'privacy.html', 'app.css', 'app.js', 'assets', 'robots.txt', 'CNAME']; // what visitors may load
const RESERVED = ['brands', 'me', 'owner', 'assets']; // first words the app keeps for itself

// ---------- Words in addresses: keep in step with slug() and word() in app.js ----------
const slug = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '')
  .replace(/([a-z0-9])&([a-z0-9])/g, '$1$2').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const word = (name, id, list = false) => { const s = slug(name); return !s || /^\d+$/.test(s) || (list && RESERVED.includes(s)) ? String(id) : s; };
const ccPath = code => (code.toLowerCase() === 'gb' ? 'uk' : code.toLowerCase());
const inPlace = c => (/^[A-Z]{2,3}$/.test(c.short_name) ? 'the ' + c.short_name : c.short_name); // the UK, Japan
const listTitle = (title, c) => `Best ${title.toLowerCase()} in ${inPlace(c)}, ranked by votes | TasteRank`;
const brandTitle = (name, c) => `${name}: every snack ranked in ${inPlace(c)} | TasteRank`;

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
const plural = (n, w) => `${n.toLocaleString('en-GB')} ${w}${n === 1 ? '' : 's'}`;
const score1 = n => (Math.round(n * 10) / 10).toFixed(1);
const listOf = names => (names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names.at(-1));
// "A, B and 3 more" (or "A and B" when that's all of them)
const some = (names, k = 2) => (names.length <= k ? listOf(names) : `${names.slice(0, k).join(', ')} and ${names.length - k} more`);

// ---------- Data, from the same public functions the site calls ----------
const app = await fs.readFile(path.join(ROOT, 'app.js'), 'utf8');
const URL_ = (app.match(/SUPABASE_URL:'([^']+)'/) || [])[1], KEY = (app.match(/SUPABASE_ANON_KEY:'([^']+)'/) || [])[1];
if (!URL_ || !KEY) throw new Error('No Supabase address or key in app.js CONFIG');
async function rpc(name, args = {}) {
  for (let tries = 1; ; tries++) {
    try {
      const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {method: 'POST', headers: {apikey: KEY, 'Content-Type': 'application/json'}, body: JSON.stringify(args)});
      if (!r.ok) throw new Error(`${name}: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return await r.json();
    } catch (e) { if (tries >= 3) throw e; await new Promise(ok => setTimeout(ok, 1500 * tries)); }
  }
}

const [places, settings] = await Promise.all([rpc('place_list'), rpc('app_settings')]);
const need = settings.rank_after_ratings;
const pages = []; // {path, title, description, view, ids, body, jsonld}
const homeLinks = []; // for the home page's own pre-built list of links

for (const c of places) {
  const cc = c.code.toLowerCase(), cp = ccPath(cc);
  const catalogue = await rpc('catalogue', {p_country: c.id});
  const brands = new Map(); // id → name, brands with 2+ snacks (the ones the list rows link to)
  const lists = [];
  for (const t of catalogue) for (const p of t.products) {
    const d = await rpc('category_page', {p_product: p.id, p_country: c.id});
    if (!d || !d.items || !d.items.length) continue; // only lists with live snacks: the rest open from 404.html
    lists.push({p, d, w: word(d.name, p.id, true)});
    for (const i of d.items) if (i.brand_snacks >= 2) brands.set(i.brand_id, i.brand);
  }
  const brandPath = new Map([...brands].map(([id, name]) => [id, `/${cp}/brands/${word(name, id)}/`]));

  for (const {p, d, w} of lists) {
    const base = `/${cp}/${w}/`, fls = d.flavours.length >= 2 ? d.flavours : [];
    const vpath = f => `${base}${word(f.name, f.id)}/`;
    const flavourOf = id => (d.flavours.find(f => f.id === id) || {}).name || '';
    homeLinks.push({c, href: base, text: d.name, n: d.items.length});
    const one = (f) => {
      const items = f ? d.items.filter(i => i.variant_id === f.id) : d.items;
      if (!items.length) return;
      const title = f ? f.title : d.name, path_ = f ? vpath(f) : base, total = items.reduce((s, i) => s + i.total, 0);
      const ranked = items.filter(i => i.ranked).slice(0, 3);
      const description = ranked.length
        ? `${c.adjective || c.short_name} snack fans' favourite ${title.toLowerCase()}: ${ranked.map((i, k) => `${k + 1}. ${i.pack_name} (${score1(i.avg)}/5)`).join(', ')}. Rate the ones you've tried on TasteRank.`
        : `${title} sold in ${inPlace(c)}, ranked by the people who eat them. Rate ${some(items.map(i => i.pack_name))}, and see which one wins.`;
      const chips = fls.length ? `<nav class="chips counted" aria-label="Flavours"><a class="chip${f ? '' : ' on'}" href="${base}">All <span class="n">${d.items.length}</span></a>${
        fls.filter(x => d.items.some(i => i.variant_id === x.id)).map(x => `<a class="chip${f && f.id === x.id ? ' on' : ''}" href="${vpath(x)}">${esc(x.name)} <span class="n">${d.items.filter(i => i.variant_id === x.id).length}</span></a>`).join('')}</nav>` : '';
      const rows = items.map((it, k) => {
        const b = brandPath.has(it.brand_id) ? `<a class="bl" href="${brandPath.get(it.brand_id)}">${esc(it.brand)}</a>` : esc(it.brand);
        return row(it, k, b + (fls.length && !f ? ` · ${esc(flavourOf(it.variant_id))}` : ''));
      }).join('');
      pages.push({
        path: path_, title: listTitle(title, c), description, view: 'category',
        ids: {v: 'category', cc, product: p.id, variant: f ? f.id : null},
        body: `<div class="lp"><div class="lp-side"><a class="crumb" href="/">← ${esc(c.short_name)} <span>· ${esc(d.type)}</span></a>
<h1 class="page-title">${esc(title)}: which one wins?</h1>
<div class="meta">${c.flag} ${esc(c.name)} · ${plural(items.length, 'snack')}${total ? ' · ' + plural(total, 'rating') : ''}</div>
${chips}</div><div class="lp-main"><h2 class="lp-head">${rankedHead(items.length, title.toLowerCase())}</h2><div class="list">${rows}</div>
<p class="meta">Snacks are ranked once they have ${need} ratings. Sign in to rate the ones you've tried.</p></div></div>`,
        jsonld: itemList(title, c, items, path_),
      });
    };
    one(null);
    for (const f of fls) if (!f.is_other) one(f); // "Other" is a catch-all, not a flavour anyone searches for: it opens from 404.html
  }

  for (const [id] of brands) {
    const d = await rpc('brand_page', {p_brand: id, p_country: c.id});
    if (!d || !d.items || !d.items.length) continue;
    const listPath = new Map(lists.map(l => [l.p.id, `/${cp}/${l.w}/`]));
    const total = d.items.reduce((s, i) => s + i.total, 0), path_ = brandPath.get(id);
    const lists_ = listOf(d.products.map(p => p.name.toLowerCase()));
    pages.push({
      path: path_, title: brandTitle(d.name, c), view: 'brand',
      description: `Every ${d.name} snack sold in ${inPlace(c)} (${lists_}), ranked by the people who eat them: ${some(d.items.map(i => i.pack_name))}.`,
      ids: {v: 'brand', cc, brand: id, product: null, variant: null},
      body: `<div class="lp"><div class="lp-side"><a class="crumb" href="/brands/">← ${esc(c.short_name)} <span>· Brands</span></a>
<h1 class="page-title">${esc(d.name)}: which one wins?</h1>
<div class="meta">${c.flag} ${esc(c.name)} · ${plural(d.items.length, 'snack')}${total ? ' · ' + plural(total, 'rating') : ''}</div>
</div><div class="lp-main"><h2 class="lp-head">${rankedHead(d.items.length, `${d.name} snacks`)}</h2><div class="list">${d.items.map((it, k) => row(it, k, (listPath.has(it.product_id) ? `<a class="bl" href="${listPath.get(it.product_id)}">${esc(it.product)}</a>` : esc(it.product)) + ` · ${esc(it.flavour)}`)).join('')}</div></div></div>`,
      jsonld: itemList(`${d.name} snacks`, c, d.items, path_),
    });
  }
}

// "All 6 salt & vinegar crisps, ranked" over the list on wide screens: the same as rankedHead() in app.js
function rankedHead(n, what) { return n >= 2 ? `All ${n} ${esc(what)}, ranked` : 'Ranked so far'; }

// One ranking row, with the same classes as listRow() in app.js so the page doesn't jump when the app takes over
function row(it, k, sub) {
  const rank = it.ranked ? k + 1 : null, pct = it.ranked ? Math.round(it.avg / 5 * 100) : Math.min(100, Math.round(it.total / need * 100));
  return `<div class="ir${it.ranked && k < 3 ? ' top3' : ''}${it.ranked ? '' : ' unranked'}"><span class="rk">${rank || '–'}</span>`
    + thumb(it) + `<span class="in"><span class="nm"><span class="nm-t">${esc(it.pack_name)}</span></span><span class="sb">${sub}</span>`
    + `<span class="track" aria-hidden="true"><span class="fill" style="width:${pct}%"></span></span></span>`
    + `<span class="sc">${it.ranked ? `${score1(it.avg)}<small>${plural(it.total, 'rating')}</small>` : `<span class="nr">${it.total} of ${need}<small>ratings</small></span>`}</span></div>`;
}
// The snack's photo, as thumb() in app.js draws it (its emoji when there's none)
function thumb(it) {
  const e = esc(it.emoji || '🍽️'), u = it.image_url || (it.image_path ? `${URL_}/storage/v1/object/public/product-photos/${it.image_path}` : null);
  return `<span class="thumb sm" aria-hidden="true">${u ? `<img src="${esc(u)}" alt="" loading="lazy" data-e="${e}" onerror="this.replaceWith(this.dataset.e)">` : e}</span>`;
}
// The ranking for search engines (schema.org ItemList), in the order shown
function itemList(title, c, items, path_) {
  return {
    '@context': 'https://schema.org', '@type': 'ItemList', name: `${title} in ${inPlace(c)}`, url: SITE + path_, numberOfItems: items.length,
    itemListElement: items.slice(0, 20).map((it, k) => ({'@type': 'ListItem', position: k + 1, name: it.pack_name})),
  };
}

// ---------- Write the site ----------
const template = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
const swap = (html, re, to) => { if (!re.test(html)) throw new Error('index.html changed: no match for ' + re); return html.replace(re, to); };
function render(pg) {
  let h = template;
  const t = esc(pg.title), d = esc(pg.description), u = SITE + pg.path, short = esc(pg.title.replace(/ \| TasteRank$/, ''));
  h = swap(h, /<title>[^<]*<\/title>/, `<title>${t}</title>`);
  h = swap(h, /(<meta name="description" content=")[^"]*/, `$1${d}`);
  h = swap(h, /(<link rel="canonical" href=")[^"]*/, `$1${u}`);
  h = swap(h, /(<meta property="og:url" content=")[^"]*/, `$1${u}`);
  h = swap(h, /(<meta property="og:title" content=")[^"]*/, `$1${short}`);
  h = swap(h, /(<meta property="og:description" content=")[^"]*/, `$1${d}`);
  h = swap(h, /(<meta name="twitter:title" content=")[^"]*/, `$1${short}`);
  h = swap(h, /(<meta name="twitter:description" content=")[^"]*/, `$1${d}`);
  if (pg.robots) h = swap(h, /(<meta name="viewport"[^>]*>)/, `$1\n<meta name="robots" content="${pg.robots}">`);
  if (pg.jsonld) h = swap(h, /(<meta name="theme-color")/, `<script type="application/ld+json">${JSON.stringify(pg.jsonld).replace(/</g, '\\u003c')}</script>\n$1`);
  if (pg.ids) h = swap(h, /(<script src="\/app\.js)/, `<script>window.TR_PAGE=${JSON.stringify({path: pg.path, ...pg.ids})}</script>\n$1`);
  if (pg.body) {
    h = swap(h, /<section id="v-home">/, '<section id="v-home" hidden>');
    h = swap(h, new RegExp(`<section id="v-${pg.view}" hidden></section>`), `<section id="v-${pg.view}"><div class="prebuilt">\n${pg.body}\n</div></section>`);
  }
  return h;
}

await fs.rm(OUT, {recursive: true, force: true});
await fs.mkdir(OUT, {recursive: true});
for (const f of PUBLIC) await fs.cp(path.join(ROOT, f), path.join(OUT, f), {recursive: true}).catch(e => { if (e.code !== 'ENOENT') throw e; });

// Home: the same page, with links to every list in place of "Loading…", so search engines can find them
const byCountry = places.map(c => ({c, links: homeLinks.filter(l => l.c === c)})).filter(x => x.links.length);
const homeHtml = swap(template, /<div class="cards" id="cards"><div class="card empty">Loading…<\/div><\/div>/,
  `<div class="cards" id="cards"><div class="card empty js-only">Loading…</div><div class="prebuilt card empty no-js">${byCountry.map(({c, links}) =>
    `<p><b>${c.flag} ${esc(c.short_name)}:</b> ${links.map(l => `<a href="${l.href}">${esc(l.text)}</a>`).join(' · ')}</p>`).join('')}</div></div>`);
await fs.writeFile(path.join(OUT, 'index.html'), homeHtml);
await fs.writeFile(path.join(OUT, '404.html'), render({path: '/404.html', title: 'TasteRank: which snack wins?', description: 'Which snack wins? Rate snacks sold in your country on TasteRank.', robots: 'noindex'}).replace(/<link rel="canonical"[^>]*>\n/, ''));
// Pages only the signed-in app shows: real addresses so a reload works, kept out of search results
// About: the words from index.html's <template id="about-tpl">, the same ones the app shows
const aboutTpl = (template.match(/<template id="about-tpl">([\s\S]*?)<\/template>/) || [])[1];
if (!aboutTpl) throw new Error('index.html changed: no about-tpl template');
pages.push({path: '/about/', view: 'about', title: 'About TasteRank: how the snack rankings work',
  description: `How TasteRank ranks snacks: real tasters sign in and rate once, a snack is ranked after ${need} ratings, and new snacks go live with ${settings.approval_votes} approvals.`,
  body: aboutTpl.replaceAll('{{rank}}', need).replaceAll('{{approve}}', settings.approval_votes).trim()});
for (const [p, title] of [['/me/', 'Your profile | TasteRank'], ['/owner/', 'Owner page | TasteRank'], ['/brands/', 'Snack brands, ranked by votes | TasteRank']])
  pages.push({path: p, title, description: 'Which snack wins? Rate snacks sold in your country on TasteRank.', robots: p === '/brands/' ? null : 'noindex'});

const seen = new Set();
for (const pg of pages) {
  if (seen.has(pg.path)) { console.warn('Two pages want ' + pg.path + ': kept the first'); continue; }
  seen.add(pg.path);
  const dir = path.join(OUT, pg.path);
  await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(dir, 'index.html'), render(pg));
}

const today = new Date().toISOString().slice(0, 10);
const indexed = ['/', ...pages.filter(p => !p.robots && p.body).map(p => p.path)];
await fs.writeFile(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<!-- Written by tools/build-pages.mjs on each build -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...indexed, '/privacy.html'].map(p => `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
await fs.writeFile(path.join(OUT, '.nojekyll'), ''); // serve the files as they are
console.log(`Built ${seen.size} pages (${indexed.length - 1} lists, flavours and brands in the sitemap) into _site/`);
for (const p of indexed) console.log('  ' + p);
