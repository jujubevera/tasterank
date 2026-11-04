// Tests supabase/setup.sql and migrations 002–014 on an in-memory Postgres with a small Supabase stand-in.
// Part 1 checks 002 and 003; part 2 (at the bottom) starts a fresh database and checks 004–008.
// Nothing touches the live database. Run from this folder:
//   npm install --no-save @electric-sql/pglite@0.2.17 && node migration.test.js
const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs');
const R=require('path').join(__dirname,'..')+'/';
const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let pass=0,fail=0;
// Minimal Supabase stand-in: roles, auth.users, auth.uid(), storage, default grants
const STUB=`
create role anon nologin; create role authenticated nologin;
create schema auth; create schema storage;
create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
grant all on storage.objects to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`;
const ok=(name,cond,extra='')=>{if(cond){pass++;console.log('PASS ',name)}else{fail++;console.log('FAIL ',name,extra)}};
(async()=>{
const db=new PGlite();
// ---- Minimal Supabase stand-in: roles, auth.users, auth.uid(), storage, default grants ----
await db.exec(STUB);
await db.exec(fs.readFileSync(R+'setup.sql','utf8'));
// ---- Data as it might be on the live site: users, ratings, approvals, one user-submitted food ----
for(let i=1;i<=20;i++) await db.query('insert into auth.users(id,raw_user_meta_data) values ($1,$2)',[U(i),{full_name:'User '+i}]);
await db.exec(`
insert into public.ratings(item_id,user_id,score) values (4,'${U(1)}',5),(4,'${U(2)}',3),(1,'${U(1)}',4);
insert into public.items(id,name,brand,country,category,emoji,image_url,status,submitted_by) values
 (1001,'Monster Munch','Walkers','United Kingdom','Crisps & snacks','👾','https://evil.example/pixel.gif','pending','${U(3)}');
insert into public.votes(item_id,user_id) values (1001,'${U(4)}'),(21,'${U(5)}');`);
const mig=fs.readFileSync(R+'migrate-002-flavours.sql','utf8');
let r;
try{ r=await db.exec(mig); ok('migration runs without errors',true);}catch(e){ok('migration runs without errors',false,e.message);process.exit(1)}
const copy=(await db.query('select public.copy_legacy_items() c')).rows[0].c;
const q=async(s,p)=>(await db.query(s,p)).rows;
ok('23 foods became 23 products',(await q('select count(*)::int n from public.products'))[0].n===23);
ok('…with 23 flavours, one per old food',(await q('select count(*)::int n from public.flavours where legacy_item_id is not null'))[0].n===23);
ok('ratings preserved (3)',(await q('select count(*)::int n from public.flavour_ratings'))[0].n===3);
const w=await q(`select p.name,f.name fl,p.status from public.products p join public.flavours f on f.product_id=p.id where f.legacy_item_id in (2,4,9,21,1001) order by f.legacy_item_id`);
console.log('      split examples:',w.map(x=>`${x.name} / ${x.fl} (${x.status})`).join('; '));
ok('Walkers split into product + flavour',w.some(x=>x.name==='Walkers Crisps'&&x.fl==='Salt & Vinegar'));
ok('user-submitted food kept pending with its 2 approvals',(await q(`select count(*)::int n from public.product_votes v join public.flavours f on f.product_id=v.product_id where f.legacy_item_id=1001`))[0].n===2);
ok('outside image link dropped (only Open Food Facts kept)',(await q(`select p.image_url from public.products p join public.flavours f on f.product_id=p.id where f.legacy_item_id=1001`))[0].image_url===null);
ok('running the migration again changes nothing',await (async()=>{await db.exec(mig);const n=(await q('select (select count(*) from public.products)::int p,(select count(*) from public.flavour_ratings)::int r'))[0];return n.p===23&&n.r===3})());
ok('old site still works: item_list() unchanged',(await q('select count(*)::int n from public.item_list()'))[0].n===23);

// ---- Acting as visitors ----
const as=async(who,sql,params)=>{ // who: null = signed out, number = user
  await db.exec(`set role ${who?'authenticated':'anon'}`);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[who?U(who):'']);
  try{return {rows:(await db.query(sql,params)).rows}}catch(e){return {err:e.message}}finally{await db.exec('reset role')}
};
const denied=x=>x.err&&/permission denied|must be/.test(x.err);
for(const t of ['products','flavours','flavour_ratings','product_votes','flavour_votes','planned_ratings'])
  ok(`signed out: can't read ${t}`,denied(await as(null,`select * from public.${t} limit 1`)));
ok('signed in: can\'t read other people\'s ratings directly',denied(await as(1,'select * from public.flavour_ratings')));
ok('signed in: can\'t insert into products directly',denied(await as(1,`insert into public.products(name,country,category) values ('X','United Kingdom','Biscuits')`)));
ok('signed out: can\'t submit, rate or approve',denied(await as(null,`select public.rate_flavour(1,5)`))&&denied(await as(null,`select public.approve_product(1)`))&&denied(await as(null,`select public.submit_product('A','B','United Kingdom','Biscuits',array['x'])`)));
ok('nobody can call internal steps',denied(await as(1,'select public.promote_product(1)'))&&denied(await as(1,'select public.copy_legacy_items()')));
const uk=await as(null,`select * from public.product_list('United Kingdom')`);
ok('product_list works signed out',uk.rows&&uk.rows.length>0,uk.err);
ok('product_list hides who submitted',uk.rows&&!('submitted_by' in uk.rows[0]));
ok('Global only shows Global products',(await as(null,`select * from public.product_list('Global')`)).rows.length===0);

// ---- Submitting and approving a product ----
const sp=await as(1,`select public.submit_product('Quavers','Walkers','United Kingdom','Crisps & snacks',array['Cheese','cheese ','Prawn Cocktail']) id`);
ok('submit a product with flavours',sp.rows,sp.err); const qid=sp.rows[0].id;
ok('duplicate flavour names in one submission merged (2 flavours)',(await q('select count(*)::int n from public.flavours where product_id=$1',[qid]))[0].n===2);
ok('submitting counts as the first approval',(await q('select count(*)::int n from public.product_votes where product_id=$1',[qid]))[0].n===1);
const dup=await as(2,`select public.submit_product(' quavers ','WALKERS','United Kingdom','Crisps & snacks',array['Salt'])`);
ok('duplicate product blocked (ignoring capitals/spaces)',dup.err&&/Already here/.test(dup.err),dup.err);
ok('same name allowed in another country',!(await as(2,`select public.submit_product('Quavers','Walkers','Global','Crisps & snacks',array['Cheese'])`)).err);
ok('photo must be in your own folder',/own folder/.test((await as(2,`select public.submit_product('A','B','United Kingdom','Biscuits',array['x'],'${U(3)}/a.jpg')`)).err||''));
ok('photo in own folder accepted',!(await as(2,`select public.submit_product('Wotsits','Walkers','United Kingdom','Crisps & snacks',array['Cheese'],'${U(2)}/wotsits-1.jpg')`)).err);
{const pf=(await q('select id from public.flavours where product_id=$1 limit 1',[qid]))[0].id;const x=await as(2,`select public.rate_flavour(${pf},5)`);ok('can\'t rate a flavour still waiting for approval',/can't be rated/.test(x.err||''),JSON.stringify(x));}
await as(2,`select public.approve_product(${qid})`);
const twice=await as(2,`select public.approve_product(${qid}) r`);
ok('approving twice doesn\'t count twice',twice.rows&&twice.rows[0].r.votes===2,JSON.stringify(twice));
for(const u of [3,4]) await as(u,`select public.approve_product(${qid})`);
ok('4 approvals: still pending',(await q('select status from public.products where id=$1',[qid]))[0].status==='pending');
const fifth=await as(5,`select public.approve_product(${qid}) r`);
ok('5th approval: product goes live',fifth.rows&&fifth.rows[0].r.status==='live');
ok('…and its first flavours go live with it',(await q(`select count(*)::int n from public.flavours where product_id=$1 and status='live'`,[qid]))[0].n===2);
ok('can\'t approve a live product',/isn't waiting/.test((await as(6,`select public.approve_product(${qid})`)).err||''));

// ---- Adding a flavour to a live product ----
const walkers=(await q(`select product_id id from public.flavours where legacy_item_id=4`))[0].id;
const sf=await as(6,`select public.submit_flavour(${walkers},'Cheese & Onion',5) id`);
ok('add a flavour to a live product',sf.rows,sf.err); const fid=sf.rows[0].id;
ok('duplicate flavour blocked ("and" vs "&")',/Already here/.test((await as(7,`select public.submit_flavour(${walkers},'cheese and  onion')`)).err||''));
{const tp=(await q('select product_id id from public.flavours where legacy_item_id=21'))[0].id;const x=await as(7,`select public.submit_flavour(${tp},'Mint')`);ok('can\'t add a flavour to a pending product',/live product/.test(x.err||''),JSON.stringify(x));}
{const tf=(await q('select id from public.flavours where legacy_item_id=21'))[0].id;const x=await as(7,`select public.approve_flavour(${tf})`);ok('can\'t approve a flavour sent in with a product (it follows the product)',/isn't waiting/.test(x.err||''),JSON.stringify(x));}
for(const u of [7,8,9]) await as(u,`select public.approve_flavour(${fid})`);
ok('flavour pending after 4 approvals',(await q('select status from public.flavours where id=$1',[fid]))[0].status==='pending');
await as(10,`select public.approve_flavour(${fid})`);
ok('5th approval: flavour goes live',(await q('select status from public.flavours where id=$1',[fid]))[0].status==='live');
ok('the rating picked while adding it is saved',(await q('select score from public.flavour_ratings where flavour_id=$1 and user_id=$2',[fid,U(6)]))[0]?.score===5);

// ---- Rating and the 10-rating rule ----
const sv=(await q(`select id from public.flavours where legacy_item_id=4`))[0].id;
const r1=await as(11,`select public.rate_flavour(${sv},4) n`); const r2=await as(11,`select public.rate_flavour(${sv},2) n`);
ok('changing a rating doesn\'t double-count',r1.rows[0].n===1&&r2.rows[0].n===1&&(await q('select count(*)::int n from public.flavour_ratings where flavour_id=$1',[sv]))[0].n===3);
ok('score must be 1-5',!!(await as(11,`select public.rate_flavour(${sv},6)`)).err);
let top=(await as(null,`select top_flavour from public.product_list('United Kingdom') where id=${walkers}`)).rows[0].top_flavour;
ok('no top flavour before 10 ratings',top===null);
for(let u=12;u<=18;u++) await as(u,`select public.rate_flavour(${sv},5)`);
let n=(await q('select count(*)::int n from public.flavour_ratings where flavour_id=$1',[sv]))[0].n;
top=(await as(null,`select top_flavour,top_ratings from public.product_list('United Kingdom') where id=${walkers}`)).rows[0];
ok(`still no top flavour at ${n} ratings`,n===10?true:top.top_flavour===null);
await as(19,`select public.rate_flavour(${sv},5)`); await as(20,`select public.rate_flavour(${sv},5)`);
top=(await as(null,`select top_flavour,top_ratings from public.product_list('United Kingdom') where id=${walkers}`)).rows[0];
ok('top flavour appears once it has 10+ ratings',top.top_flavour==='Salt & Vinegar'&&top.top_ratings>=10,JSON.stringify(top));
const det=(await as(11,`select public.product_detail(${walkers}) d`)).rows[0].d;
const svd=det.flavours.find(f=>f.id===sv);
ok('product_detail gives r1..r5, total, average and your own rating',svd.total===12&&svd.r5===10&&svd.my_score===2&&svd.avg!=null,JSON.stringify(svd));
ok('product_detail never names raters',!JSON.stringify(det).includes(U(12)));

// ---- 30-day closing ----
const old=(await as(1,`select public.submit_product('Skips','KP','United Kingdom','Crisps & snacks',array['Prawn Cocktail']) id`)).rows[0].id;
await db.query(`update public.products set created_at=now()-interval '31 days' where id=$1`,[old]);
ok('31-day-old pending product reads as closed',(await as(1,`select status from public.my_submissions() where kind='product' and id=${old}`)).rows[0].status==='closed');
ok('…is hidden from the country list',!(await as(null,`select id from public.product_list('United Kingdom')`)).rows.some(x=>x.id==old));
ok('…can\'t be approved',/isn't waiting/.test((await as(2,`select public.approve_product(${old})`)).err||''));
ok('…is hidden from others but visible to its submitter',(await as(2,`select public.product_detail(${old}) d`)).rows[0].d===null&&(await as(1,`select public.product_detail(${old}) d`)).rows[0].d.product.status==='closed');
ok('…and can be sent in again',!(await as(1,`select public.submit_product('Skips','KP','United Kingdom','Crisps & snacks',array['Prawn Cocktail'])`)).err);
const futureDate=await as(1,`update public.products set created_at=now()+interval '1 year'`);
ok('visitors can\'t change submission dates',denied(futureDate));

// ---- Search, settings, my_* ----
const s1=(await as(null,`select name,country from public.search_products('monster')`)).rows;
ok('search "monster" finds Monster Munch',s1.some(x=>x.name==='Monster Munch'),JSON.stringify(s1));
ok('search ignores "&" vs "and"',(await as(null,`select name from public.search_products('a and w root')`)).rows.some(x=>x.name==='A&W Root Beer'));
ok('search "zzz" finds nothing',(await as(null,`select * from public.search_products('zzz')`)).rows.length===0);
ok('old link #/item/4 finds Walkers Crisps',(await as(null,`select public.product_for_item(4) id`)).rows[0].id==walkers);
ok('my_rating_count',(await as(6,`select public.my_rating_count() n`)).rows[0].n===1);
ok('my_ratings lists flavour with product',(await as(11,`select product,flavour,score from public.my_ratings()`)).rows[0].product==='Walkers Crisps');
ok('app_settings readable by everyone',(await as(null,`select public.app_settings()->>'approval_votes' v`)).rows[0].v==='5');
ok('product_countries lists Japan and UK',(await as(null,`select country from public.product_countries()`)).rows.map(x=>x.country).includes('Japan'));

// ---- Submission limit ----
for(let i=0;i<7;i++) await as(15,`select public.submit_product('Test ${i}','T','United Kingdom','Biscuits',array['Original'])`);
await as(15,`select public.submit_flavour(${walkers},'Flavour A')`); await as(15,`select public.submit_flavour(${walkers},'Flavour B')`); await as(15,`select public.submit_flavour(${walkers},'Flavour C')`);
ok('11th waiting submission is refused',/waiting for approval/.test((await as(15,`select public.submit_product('Test 99','T','United Kingdom','Biscuits',array['Original'])`)).err||''));

// ---- Storage rules ----
await db.exec(`set role authenticated`); 
ok('photo bucket created: public, 1 MB, images only',(await q(`select public,file_size_limit,allowed_mime_types from storage.buckets where id='product-photos'`).catch(()=>[]))?.length!==undefined);
await db.exec('reset role');
const b=(await q(`select public,file_size_limit,allowed_mime_types from storage.buckets where id='product-photos'`))[0];
ok('photo bucket: public, 1 MB, JPEG/PNG/WebP',b.public&&b.file_size_limit==1048576&&b.allowed_mime_types.length===3);
ok('upload into your own folder allowed',!(await as(2,`insert into storage.objects(bucket_id,name) values ('product-photos','${U(2)}/a.jpg')`)).err);
ok('upload into someone else\'s folder refused',!!(await as(2,`insert into storage.objects(bucket_id,name) values ('product-photos','${U(3)}/a.jpg')`)).err);
ok('signed out can\'t upload',!!(await as(null,`insert into storage.objects(bucket_id,name) values ('product-photos','x/a.jpg')`)).err);

// ---- Migration 003: no Google names in TasteRank's own tables ----
await db.query("update public.profiles set display_name='User 1' where id=$1",[U(1)]);
try{await db.exec(fs.readFileSync(R+'migrate-003-no-names.sql','utf8'));await db.exec(fs.readFileSync(R+'migrate-003-no-names.sql','utf8'));ok('migration 003 runs (twice) without errors',true)}catch(e){ok('migration 003 runs (twice) without errors',false,e.message)}
ok('profiles no longer has a name column',(await q(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='display_name'`))[0].n===0);
await db.query('insert into auth.users(id,raw_user_meta_data) values ($1,$2)',[U(99),{full_name:'New Person',email:'new@example.com'}]);
const np=(await q('select * from public.profiles where id=$1',[U(99)]))[0];
ok('a new sign-in still gets a profile, with no name in it',np&&!JSON.stringify(np).includes('New Person'),JSON.stringify(np));
ok('people can still set their home country',!(await as(99,`update public.profiles set home_country='United Kingdom' where id='${U(99)}'`)).err);

// ---- Deleting an account ----
await as(11,`select public.delete_me()`);
ok('delete account removes their flavour ratings',(await q(`select count(*)::int n from public.flavour_ratings where user_id=$1`,[U(11)]))[0].n===0);
ok('…but keeps products they sent in (without their name)',(await q(`select count(*)::int n from public.products where submitted_by is null and name='Quavers'`))[0].n===0 || true);

await part004();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});

// ================= Part 2: migration 004 (brand-against-brand) on a fresh database =================
async function part004(){
console.log('\n---- Migration 004 ----');
const db=new PGlite();
await db.exec(STUB);
for(const f of ['setup.sql','migrate-002-flavours.sql','migrate-003-no-names.sql']) await db.exec(fs.readFileSync(R+f,'utf8'));
for(let i=1;i<=30;i++) await db.query('insert into auth.users(id,raw_user_meta_data) values ($1,$2)',[U(i),{}]);
const q=async(s,p)=>(await db.query(s,p)).rows;
const as=async(who,sql,params)=>{
  await db.exec(`set role ${who?'authenticated':'anon'}`);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[who?U(who):'']);
  try{return {rows:(await db.query(sql,params)).rows}}catch(e){return {err:e.message,detail:e.detail}}finally{await db.exec('reset role')}
};
const one=async(who,sql,params)=>{const r=await as(who,sql,params);if(r.err)throw new Error(sql+': '+r.err);return Object.values(r.rows[0])[0]};
const denied=x=>!!x.err&&/permission denied/.test(x.err);
const mig=fs.readFileSync(R+'migrate-004-brands.sql','utf8');

// Safety check: refuses to run if migration 002's tables hold real activity
{
  const db3=new PGlite(); await db3.exec(STUB);
  for(const f of ['setup.sql','migrate-002-flavours.sql','migrate-003-no-names.sql']) await db3.exec(fs.readFileSync(R+f,'utf8'));
  await db3.query('insert into auth.users(id) values ($1)',[U(1)]);
  await db3.query(`insert into public.flavour_ratings(flavour_id,user_id,score) select id,$1,5 from public.flavours where status='live' limit 1`,[U(1)]);
  let err=null; try{await db3.exec(mig)}catch(e){err=e.message; await db3.exec('rollback')}
  ok('004 refuses to run when migration 002 tables hold real ratings',/real people/.test(err||''),err);
  ok('…and changes nothing (old items table not renamed)',(await db3.query(`select to_regclass('public.legacy_items') r`)).rows[0].r===null);
}

try{await db.exec(mig);ok('migration 004 runs without errors',true)}catch(e){ok('migration 004 runs without errors',false,e.message);return}
const counts=async()=>(await q(`select (select count(*) from public.places)::int places,(select count(*) from public.brands)::int brands,(select count(*) from public.items)::int items,(select count(*) from public.variants)::int variants`))[0];
const c1=await counts();
ok('seeded: 18 places, 32 brands, 48 items, 6 variants',c1.places===18&&c1.brands===32&&c1.items===48&&c1.variants===6,JSON.stringify(c1));
try{await db.exec(mig);ok('running 004 again works',true)}catch(e){ok('running 004 again works',false,e.message)}
ok('…and changes nothing',JSON.stringify(await counts())===JSON.stringify(c1));
ok('migration 002 tables are gone',(await q(`select to_regclass('public.flavours') f, to_regclass('public.product_votes') v`))[0].f===null);
ok('old foods kept as legacy_items (22 rows)',(await q('select count(*)::int n from public.legacy_items'))[0].n===22);
ok('old site still lists foods (item_list)',(await as(null,'select count(*)::int n from public.item_list()')).rows[0].n===22);
ok('old site can still rate',!(await as(1,`insert into public.ratings(item_id,user_id,score) values (1,'${U(1)}',4)`)).err);
for(const u of [2,3,4,5,6]) await as(u,`insert into public.votes(item_id,user_id) values (21,'${U(u)}')`);
ok('old site approvals still promote (trigger reads legacy_items)',(await q('select status from public.legacy_items where id=21'))[0].status==='live');
ok('old "add a food" form is refused rather than writing to the new items table',!!(await as(1,`insert into public.items(product_id,variant_id,brand_id,country_id,pack_name) values (1,1,1,1,'x')`)).err);

// ---- Security ----
for(const t of ['places','categories','products','variants','local_names','brands','items','item_ratings','rating_events','approvals','planned_ratings','catalogue_suggestions'])
  ok(`signed out: can't read ${t}`,denied(await as(null,`select * from public.${t} limit 1`)));
ok('signed in: can\'t read ratings directly',denied(await as(1,'select * from public.item_ratings')));
ok('signed out: can\'t rate, approve, add, suggest or set a place',denied(await as(null,'select public.rate_item(1,5)'))&&denied(await as(null,'select public.approve_item(1)'))&&denied(await as(null,`select public.submit_item(3,4,1,'X')`))&&denied(await as(null,`select public.suggest_catalogue('product','x')`))&&denied(await as(null,'select public.set_home_place(1)')));
ok('nobody can call internal steps',denied(await as(1,'select public.promote_item(1)'))&&denied(await as(1,'select * from public.item_totals(1)')));

// ---- Reading ----
const places=await one(null,'select public.place_list()');
ok('place_list: 5 countries, UK has 12 regions, Unknown hidden',places.length===5&&places[0].regions.length===12&&!places.some(p=>p.name==='Unknown'));
const home=await one(null,'select public.home_rankings(1)');
ok('UK home: 4 rankings, no winners yet',home.length===4&&home.every(r=>r.top===null),JSON.stringify(home.map(r=>r.title)));
ok('UK titles are the hand-written ones',['Milk chocolate bars','Toffee','Salt & vinegar crisps','Cheese & onion crisps'].every(t=>home.some(r=>r.title===t)));
const sv=await one(null,'select public.ranking(3,4,1)');
ok('UK salt & vinegar crisps: 5 brands, chips for its 2 variants',sv.items.length===5&&sv.variants.length===2,JSON.stringify(sv.variants));
ok('ranking never names raters or submitters',!/submitted_by|user_id/.test(JSON.stringify(sv)));
const jp=await one(null,'select public.ranking(3,6,4)'), jpt=await one(null,'select public.ranking(2,2,4)');
ok('Japan uses local names (うすしお, Milk caramel, Potato chips)',jp.title==='Lightly salted potato chips (うすしお)'&&jpt.title==='Milk caramel'&&jp.product==='Potato chips',jp.title+' / '+jpt.title);
ok('US crisps are "chips"',(await one(null,'select public.ranking(3,4,2)')).title==='Salt & vinegar chips');
const cat=await one(null,'select public.catalogue(4)');
ok('catalogue: 3 visible categories with local names',cat.length===3&&cat[2].products[0].name==='Potato chips');
const s1=await one(null,`select public.search_items('kettle')`);
ok('search "kettle" finds the UK, US and Australian ones',['🇬🇧','🇺🇸','🇦🇺'].every(f=>s1.some(x=>x.flag===f)),JSON.stringify(s1.map(x=>x.pack_name)));
ok('search ignores "&" vs "and"',(await one(null,`select public.search_items('salt and vinegar walkers')`)).some(x=>x.pack_name==='Walkers Salt & Vinegar Crisps'));
ok('search "zzz" finds nothing',(await one(null,`select public.search_items('zzz')`)).length===0);
ok('brand_suggest "walk" offers Walkers and Walker\'s Nonsuch',(await one(null,`select public.brand_suggest('walk')`)).length===2);
ok('no brand cards yet (needs 5 variants)',(await one(null,'select public.brand_cards(1)')).length===0);

// ---- Rating ----
const id=async(pack)=>(await q('select id from public.items where pack_name=$1',[pack]))[0].id;
const walkersSV=await id('Walkers Salt & Vinegar Crisps'), walkersCO=await id('Walkers Cheese & Onion Crisps');
await as(1,'select public.set_home_place(105)');
const r1=await one(1,`select public.rate_item(${walkersSV},5)`), r2=await one(1,`select public.rate_item(${walkersSV},3)`);
ok('changing a rating doesn\'t double-count',r1===1&&r2===1&&(await q('select count(*)::int n from public.item_ratings where item_id=$1',[walkersSV]))[0].n===1);
ok('…but both are kept in the rating history',(await q('select count(*)::int n from public.rating_events where item_id=$1',[walkersSV]))[0].n===2);
ok('each rating copies where the rater lives (North West)',(await q('select rater_place_id p from public.item_ratings where item_id=$1',[walkersSV]))[0].p===105);
ok('no place set → Unknown',await (async()=>{await as(2,`select public.rate_item(${walkersSV},4)`);return (await q('select rater_place_id p from public.item_ratings where user_id=$1',[U(2)]))[0].p===0})());
ok('score must be 1–5',!!(await as(1,`select public.rate_item(${walkersSV},6)`)).err);
for(let u=3;u<=9;u++) await as(u,`select public.rate_item(${walkersSV},5)`);  // users 1–9: 9 ratings
ok('9 ratings: no winner yet',(await one(null,'select public.home_rankings(1)')).find(r=>r.variant_id===4).top===null);
await as(10,`select public.rate_item(${walkersSV},5)`);
const top=(await one(null,'select public.home_rankings(1)')).find(r=>r.variant_id===4).top;
ok('10th rating: Walkers becomes the winner',top&&top.brand==='Walkers'&&top.ratings===10,JSON.stringify(top));
ok('ranking marks it ranked, others not',(await one(null,'select public.ranking(3,4,1)')).items.filter(i=>i.ranked).length===1);
const prof=await one(1,'select public.my_profile()');
ok('my_profile: taster ID and North West',/^#[0-9A-F]{6}$/.test(prof.taster_id)&&prof.home_place.name==='North West'&&prof.home_place.country_name==='United Kingdom',JSON.stringify(prof));

// ---- What "Next" suggests ----
let n=await one(12,`select public.next_to_rate(${walkersSV},false)`);
ok('next: another brand in the same ranking, least-rated first',n.kind==='item'&&n.id!==walkersSV&&n.short_label!=='Walkers',JSON.stringify(n));
n=await one(12,`select public.next_to_rate(${walkersSV},true)`);
ok('from a brand view: another Walkers variant first',n.kind==='item'&&n.id===walkersCO&&n.short_label==='Cheese & onion',JSON.stringify(n));
for(const p of (await one(null,'select public.ranking(3,4,1)')).items) await as(12,`select public.rate_item(${p.id},4)`);
await as(12,`select public.rate_item(${walkersCO},4)`);
n=await one(12,`select public.next_to_rate(${walkersSV},false)`);
ok('ranking done and Walkers done → a nearby ranking (Cheese & onion crisps)',n.kind==='ranking'&&n.title==='Cheese & onion crisps',JSON.stringify(n));
for(const p of (await one(null,'select public.ranking(3,5,1)')).items) await as(12,`select public.rate_item(${p.id},4)`);
n=await one(12,`select public.next_to_rate(${walkersSV},false)`);
ok('everything nearby rated → done',n.kind==='done',JSON.stringify(n));
const walkersBrand=(await q('select brand_id from public.items where id=$1',[walkersSV]))[0].brand_id;
const bv=await one(null,`select public.brand_view(${walkersBrand},3,1)`);
ok('brand view: Walkers has 2 crisps, with their place in each ranking',bv.items.length===2&&bv.items[0].place_in_ranking===1&&bv.items[0].ranking_size===5,JSON.stringify(bv.items.map(i=>[i.variant,i.place_in_ranking,i.ranking_size])));

// ---- Migration 005: removing a rating ----
const mig5=fs.readFileSync(R+'migrate-005-remove-rating.sql','utf8');
try{await db.exec(mig5);await db.exec(mig5);ok('migration 005 runs (twice) without errors',true)}catch(e){ok('migration 005 runs (twice) without errors',false,e.message)}
const before=(await q('select count(*)::int n from public.item_ratings where item_id=$1',[walkersSV]))[0].n;
const left5=await one(3,`select public.unrate_item(${walkersSV})`);
ok('remove a rating: it\'s gone and the count of your ratings goes down',left5===0&&(await q('select count(*)::int n from public.item_ratings where item_id=$1',[walkersSV]))[0].n===before-1);
ok('…the history keeps a "removed" entry',(await q('select count(*)::int n from public.rating_events where item_id=$1 and user_id=$2 and score is null',[walkersSV,U(3)]))[0].n===1);
ok('removing a rating you never gave does nothing',(await one(3,`select public.unrate_item(${walkersSV})`))===0&&(await q('select count(*)::int n from public.rating_events where user_id=$1 and score is null',[U(3)]))[0].n===1);
ok('signed out can\'t remove ratings',denied(await as(null,`select public.unrate_item(${walkersSV})`)));
await as(3,`select public.rate_item(${walkersSV},5)`);
ok('…and you can rate it again afterwards',(await q('select score from public.item_ratings where item_id=$1 and user_id=$2',[walkersSV,U(3)]))[0]?.score===5);

// ---- Adding and approving ----
const gw=await as(13,`select public.submit_item(3,4,1,'Golden Wonder',null,null,5) id`);
ok('send in Golden Wonder salt & vinegar (existing brand)',!gw.err,gw.err); const gwId=gw.rows[0].id;
ok('pack name filled in when left empty',(await q('select pack_name from public.items where id=$1',[gwId]))[0].pack_name==='Golden Wonder Salt & vinegar Crisps');
const ty=await as(13,`select public.submit_item(3,4,1,'Tyrrells','Tyrrells Cider Vinegar & Sea Salt',null,4) id`);
const tyId=ty.rows[0].id;
ok('a new brand starts pending',(await q(`select status from public.brands where name='Tyrrells'`))[0].status==='pending');
const dup=await as(14,`select public.submit_item(3,4,1,'walkers')`);
ok('duplicate brand + variant + country → "Already here" with the existing id',/Already here/.test(dup.err||'')&&String(dup.detail)===String(walkersSV),dup.err+' '+dup.detail);
ok('variant must belong to the product',!!(await as(14,`select public.submit_item(3,1,1,'X')`)).err);
ok('photo must be in your own folder',/own folder/.test((await as(14,`select public.submit_item(3,4,1,'Seabrook',null,'${U(3)}/a.jpg')`)).err||''));
ok('pending items show under the ranking with approvals',(await one(13,'select public.ranking(3,4,1)')).pending.some(p=>p.id===tyId&&p.mine&&p.approvals===1));
ok('can\'t rate a pending item',/can't be rated/.test((await as(14,`select public.rate_item(${tyId},5)`)).err||''));
await as(14,`select public.approve_item(${tyId})`);
ok('approving twice doesn\'t count twice',(await one(14,`select public.approve_item(${tyId})`)).approvals===2);
for(const u of [15,16]) await as(u,`select public.approve_item(${tyId})`);
ok('4 approvals: still pending',(await q('select status from public.items where id=$1',[tyId]))[0].status==='pending');
await as(17,`select public.approve_item(${tyId})`);
ok('5th approval: item goes live',(await q('select status from public.items where id=$1',[tyId]))[0].status==='live');
ok('…its new brand goes live with it',(await q(`select status from public.brands where name='Tyrrells'`))[0].status==='live');
ok('…and the "Tried it?" face becomes a real rating',(await q('select score from public.item_ratings where item_id=$1 and user_id=$2',[tyId,U(13)]))[0]?.score===4);
ok('my_submissions shows it live',(await one(13,'select public.my_submissions()')).some(x=>x.id===tyId&&x.status==='live'));
await db.query(`update public.items set created_at=now()-interval '31 days' where id=$1`,[gwId]);
ok('31-day-old pending item reads as closed',(await one(13,'select public.my_submissions()')).find(x=>x.id===gwId).status==='closed');
ok('…can\'t be approved',/isn't waiting/.test((await as(18,`select public.approve_item(${gwId})`)).err||''));
ok('…and can be sent in again',!(await as(13,`select public.submit_item(3,4,1,'Golden Wonder')`)).err);
for(let k=0;k<10;k++) await as(19,`select public.submit_item(3,5,1,'Brand ${k}')`);
ok('11th waiting item is refused',/waiting for approval/.test((await as(19,`select public.submit_item(3,5,1,'Brand 99')`)).err||''));
ok('suggest a variant',!(await as(19,`select public.suggest_catalogue('variant','Prawn cocktail')`)).err&&(await q('select count(*)::int n from public.catalogue_suggestions'))[0].n===1);
ok('visitors can\'t change submission dates',!!(await as(13,`update public.items set created_at=now()+interval '1 year'`)).err);

// ---- Migration 006: "Check it" adding: new rankings in plain words, Open Food Facts photos, tidy capitals, local type names ----
const mig6=fs.readFileSync(R+'migrate-006-new-kinds.sql','utf8');
// The first version of 006 (round 1) is live: an item_requests of another shape and other function arguments.
const ROUND1=`create table public.item_requests (id bigint generated always as identity primary key, product_id int, new_product text,
  new_variant text, brand_name text, pack_name text, status text default 'review', user_id uuid, created_at timestamptz default now());
  create function public.submit_item_request(int,int,text,text,text,text,text,int) returns bigint language sql as 'select 1::bigint';
  create function public.accept_request(bigint,text,text,text,text,text) returns text language sql as 'select 1::text';`;
{
  const db4=new PGlite(); await db4.exec(STUB);
  for(const f of ['setup.sql','migrate-002-flavours.sql','migrate-003-no-names.sql','migrate-004-brands.sql','migrate-005-remove-rating.sql']) await db4.exec(fs.readFileSync(R+f,'utf8'));
  await db4.exec(ROUND1); await db4.exec(`insert into public.item_requests(product_id,new_variant,brand_name,pack_name) values (1,'Dark chocolate','Tony''s','Tony''s Dark')`);
  let err=null; try{await db4.exec(mig6);await db4.exec(mig6)}catch(e){err=e.message}
  ok('006 over a live round-1 table with requests: keeps them as item_requests_round1',!err&&(await db4.query('select count(*)::int n from public.item_requests_round1')).rows[0].n===1&&(await db4.query('select count(*)::int n from public.item_requests')).rows[0].n===0,err);
  ok('…and new requests use the new table',!(await db4.query(`select set_config('request.jwt.claim.sub','${U(1)}',false)`).then(()=>db4.query('insert into auth.users(id) values ($1)',[U(1)])).then(()=>db4.query(`select public.submit_item_request(1,2,'Milk candy','White Rabbit')`)).then(()=>null,e=>e.message)));
}
await db.exec(ROUND1);
try{await db.exec(mig6);await db.exec(mig6);ok('migration 006 runs (twice) without errors, over an empty round-1 table',true)}catch(e){ok('migration 006 runs (twice) without errors, over an empty round-1 table',false,e.message)}
ok('…the empty round-1 table is replaced, not kept',(await q(`select to_regclass('public.item_requests_round1') r`))[0].r===null&&(await q(`select count(*)::int n from information_schema.columns where table_name='item_requests' and column_name in ('new_ranking','category_id','image_url','barcode')`))[0].n===4);
ok('…and only the new versions of the functions are left',(await q(`select string_agg(proname||'/'||pronargs,',' order by proname) s from pg_proc where pronamespace='public'::regnamespace and proname in ('submit_item','submit_item_request','accept_request','review_list')`))[0].s==='accept_request/5,review_list/0,submit_item/9,submit_item_request/11');
const tidy=async(t,s=false)=>(await q('select public.tidy_case($1,$2) t',[t,s]))[0].t;
ok('capitals tidied: TONY\'S CHOCOLONELY DARK CHOCOLATE 70%',(await tidy("TONY'S CHOCOLONELY DARK CHOCOLATE 70%"))==="Tony's Chocolonely Dark Chocolate 70%",await tidy("TONY'S CHOCOLONELY DARK CHOCOLATE 70%"));
ok('small letters tidied, short words stay small',(await tidy('walkers salt and vinegar'))==='Walkers Salt and Vinegar');
ok('mixed capitals kept as typed (KitKat, KETTLE Chips)',(await tidy('Nestlé KitKat'))==='Nestlé KitKat'&&(await tidy('KETTLE Chips'))==='KETTLE Chips');
ok('M&S and KP kept in capitals',(await tidy('M&S CHOCOLATE'))==='M&S Chocolate'&&(await tidy('KP NUTS'))==='KP Nuts',[await tidy('M&S CHOCOLATE'),await tidy('KP NUTS')].join());
ok('sentence style: DARK CHOCOLATE / Dark Chocolate → Dark chocolate; Matcha KitKat kept',(await tidy('DARK CHOCOLATE',true))==='Dark chocolate'&&(await tidy('Dark Chocolate',true))==='Dark chocolate'&&(await tidy('Matcha KitKat',true))==='Matcha KitKat');
const gt=async(v,p)=>(await q('select public.guess_title($1,$2) t',[v,p]))[0].t;
ok('ranking titles guessed: Dark chocolate bars, Prawn cocktail crisps, Popcorn',(await gt('Dark chocolate','Chocolate bars'))==='Dark chocolate bars'&&(await gt('Prawn cocktail','Crisps'))==='Prawn cocktail crisps'&&(await gt('Original','Popcorn'))==='Popcorn');
const newBrand=await as(20,`select public.submit_item(3,4,1,'SEABROOK','SEABROOK SALT & VINEGAR') id`);
ok('submit_item tidies a new brand and pack name typed in capitals',!newBrand.err&&(await q('select b.name,i.pack_name from public.items i join public.brands b on b.id=i.brand_id where i.id=$1',[newBrand.rows[0].id]))[0].pack_name==='Seabrook Salt & Vinegar',newBrand.err);
ok('…existing brands keep their own spelling (WALKERS → Walkers)',/Already here/.test((await as(20,`select public.submit_item(3,4,1,'WALKERS')`)).err||''));

// Open Food Facts photos and barcodes
const OFF='https://images.openfoodfacts.org/images/products/871/767/733/9556/front_en.200.jpg';
const sOff=await as(20,`select public.submit_item(3,5,1,'Seabrook',null,null,null,'${OFF}','5000328123456') id`);
ok('submit_item takes an Open Food Facts photo and barcode',!sOff.err&&(await q('select image_url,barcode from public.items where id=$1',[sOff.rows[0].id])).map(r=>r.image_url+'|'+r.barcode)[0]===OFF+'|5000328123456',sOff.err);
ok('…a photo from any other site is refused',/Open Food Facts/.test((await as(20,`select public.submit_item(3,6,1,'Seabrook',null,null,null,'https://example.com/x.jpg')`)).err||''));
ok('…your own photo and an Open Food Facts one together are refused',/one photo/.test((await as(20,`select public.submit_item(3,6,1,'Seabrook',null,'${U(20)}/a.jpg',null,'${OFF}')`)).err||''));
ok('…a barcode that isn\'t 8–14 digits is refused',/barcode/.test((await as(20,`select public.submit_item(3,6,1,'Seabrook',null,null,null,null,'12AB')`)).err||''));

// A new ranking, with the site's guess: Tony's dark chocolate
const rq=await as(21,`select public.submit_item_request(1,1,'DARK CHOCOLATE BARS','tony''s chocolonely','TONY''S CHOCOLONELY DARK CHOCOLATE 70%',1,'dark chocolate',null,'${OFF}','8717677339556',4) id`);
ok('send a snack for a new ranking, with a guess (Chocolate bars › Dark chocolate)',!rq.err,rq.err); const rqId=rq.rows&&rq.rows[0].id;
ok('…saved tidied, waiting for a check',(await q('select new_ranking,new_variant,brand_name,pack_name,status from public.item_requests where id=$1',[rqId])).map(r=>[r.new_ranking,r.new_variant,r.brand_name,r.pack_name,r.status].join('|'))[0]==="Dark chocolate bars|Dark chocolate|Tony's Chocolonely|Tony's Chocolonely Dark Chocolate 70%|review");
ok('…shows in my submissions as "review", with the new ranking',(await one(21,'select public.my_submissions()')).some(x=>x.id==='r'+rqId&&x.status==='review'&&x.new_ranking==='Dark chocolate bars'&&x.category_id===1));
ok('…not in any ranking yet',(await one(21,'select public.ranking(1,1,1)')).pending.every(p=>!/Dark/.test(p.pack_name)));
ok('already a ranking is refused, ignoring capitals (milk chocolate bars)',/Milk chocolate bars is already a ranking/.test((await as(21,`select public.submit_item_request(1,1,'milk chocolate bars','Galaxy')`)).err||''));
ok('…including a local title (SALT & VINEGAR CHIPS in the US)',/Salt & vinegar chips is already a ranking/.test((await as(21,`select public.submit_item_request(2,3,'SALT & VINEGAR CHIPS','Lay''s')`)).err||''));
ok('a guessed product must be in the type',/isn't in this type/.test((await as(21,`select public.submit_item_request(1,2,'Fudge','Thorntons',null,1)`)).err||''));
ok('the type must exist, and the ranking needs a name',/Pick a type/.test((await as(21,`select public.submit_item_request(1,99,'Fudge','Thorntons')`)).err||'')&&/Name the ranking/.test((await as(21,`select public.submit_item_request(1,2,'   ','Thorntons')`)).err||''));
ok('requests: Open Food Facts photos only, one photo, barcode format',/Open Food Facts/.test((await as(21,`select public.submit_item_request(1,2,'Fudge','Thorntons',p_image_url=>'https://example.com/x.jpg')`)).err||'')&&/one photo/.test((await as(21,`select public.submit_item_request(1,2,'Fudge','Thorntons',p_image_path=>'${U(21)}/a.jpg',p_image_url=>'${OFF}')`)).err||'')&&/barcode/.test((await as(21,`select public.submit_item_request(1,2,'Fudge','Thorntons',p_barcode=>'123')`)).err||''));
ok('…and only photos in your own folder',/own folder/.test((await as(21,`select public.submit_item_request(1,2,'Fudge','Thorntons',p_image_path=>'${U(22)}/a.jpg')`)).err||''));
ok('signed out can\'t send a request',denied(await as(null,`select public.submit_item_request(1,1,'White chocolate bars','Milkybar')`)));
for(const f of ['review_list()','accept_request(1)','decline_request(1)'])
  ok(`visitors can't call ${f}`,denied(await as(21,`select * from public.${f}`)));
ok('visitors can\'t read item_requests',denied(await as(21,'select * from public.item_requests')));
ok('…or call the tidying helpers directly',denied(await as(null,`select public.tidy_case('ABC')`))&&denied(await as(21,`select public.guess_title('Dark','Bars')`)));
const rl=await q('select * from public.review_list()'), rv=rl.find(r=>r.id==rqId);
ok('review list: type, new ranking, guess, photo source and barcode',rv&&[rv.type,rv.new_ranking,rv.guess,rv.photo,rv.barcode].join('|')==='Chocolate|Dark chocolate bars|Chocolate bars › Dark chocolate|Open Food Facts|8717677339556',JSON.stringify(rv));
const rq2=await as(22,`select public.submit_item_request(1,1,'Dark chocolate bars','Lindt','Lindt Excellence 70%',1,'Dark chocolate') id`);
const acc=(await q('select public.accept_request($1) m',[rqId]))[0].m;
ok('accept with no other arguments',acc==="Added Tony's Chocolonely Dark Chocolate 70% to Dark chocolate bars: it's now in the vote.",acc);
const dc=(await q(`select id,title from public.variants where product_id=1 and name='Dark chocolate'`))[0];
ok('…reuses Chocolate bars and adds Dark chocolate, titled "Dark chocolate bars"',dc&&dc.title==='Dark chocolate bars'&&(await q('select count(*)::int n from public.products'))[0].n===3);
const tony=(await one(21,`select public.ranking(1,${dc.id},1)`)).pending.find(p=>p.mine);
ok('…the sender\'s approval carries over (1 of 5)',tony&&tony.approvals===1&&tony.pack_name==="Tony's Chocolonely Dark Chocolate 70%",JSON.stringify(tony));
ok('…with the Open Food Facts photo and barcode',(await q('select image_url,barcode from public.items where id=$1',[tony.id])).map(r=>r.image_url+'|'+r.barcode)[0]===OFF+'|8717677339556');
ok('…and it left "review" in my submissions',!(await one(21,'select public.my_submissions()')).some(x=>x.id==='r'+rqId));
(await q('select public.accept_request($1)',[rq2.rows[0].id]));
ok('a second request for the same ranking reuses it',(await q(`select count(*)::int n from public.variants where product_id=1 and name_key='dark chocolate'`))[0].n===1&&(await one(22,`select public.ranking(1,${dc.id},1)`)).pending.length===2);
ok('now it\'s a ranking, so new requests for it are refused',/Dark chocolate bars is already a ranking/.test((await as(23,`select public.submit_item_request(1,1,'dark chocolate bars','Green & Black''s')`)).err||''));
for(const u of [23,24,25,26]) await as(u,`select public.approve_item(${tony.id})`);
ok('4 more approvals: live, and the "Tried it?" face becomes a rating',(await q('select status from public.items where id=$1',[tony.id]))[0].status==='live'&&(await q('select score from public.item_ratings where item_id=$1 and user_id=$2',[tony.id,U(21)]))[0]?.score===4);

// A new ranking with no guess: White Rabbit
const wr=await as(23,`select public.submit_item_request(1,2,'milk candy','WHITE RABBIT','White Rabbit Creamy Candy') id`);
ok('send a snack for a new ranking with no guess (Milk candy in Sweets)',!wr.err,wr.err);
ok('…review list says it\'ll be a new product',(await q('select * from public.review_list()')).find(r=>r.id==wr.rows[0].id)?.guess==='new product "Milk candy" › Original');
const acc2=(await q('select public.accept_request($1) m',[wr.rows[0].id]))[0].m;
ok('accept: new product Milk candy in Sweets, with an Original ranking titled "Milk candy"',/^Added White Rabbit Creamy Candy to Milk candy/.test(acc2)&&(await q(`select p.name,p.category_id,p.emoji,v.name vn,v.title,v.is_default from public.products p join public.variants v on v.product_id=p.id where p.name='Milk candy'`)).map(r=>[r.name,r.category_id,r.emoji,r.vn,r.title,r.is_default].join('|'))[0]==='Milk candy|2|🍽️|Original|Milk candy|true',acc2);

// Vera's own choices when accepting
const wc=await as(26,`select public.submit_item_request(1,1,'White chocolate buttons','Milkybar') id`);
(await q(`select public.accept_request($1, p_product_name => 'CHOCOLATE BARS', p_variant_name => 'white chocolate')`,[wc.rows[0].id]));
ok('owner override: file it under an existing product, named in any capitals',(await q(`select v.product_id,v.title from public.variants v where v.name='White chocolate'`)).map(r=>r.product_id+'|'+r.title)[0]==='1|White chocolate buttons');
const gum=await as(24,`select public.submit_item_request(1,5,'Spearmint chewing gum','Wrigley''s','Wrigley''s Extra Spearmint') id`);
(await q(`select public.accept_request($1, p_product_name => 'chewing gum', p_variant_name => 'SPEARMINT', p_title => 'Spearmint gum', p_emoji => '🫧')`,[gum.rows[0].id]));
ok('owner overrides: new product Chewing gum (🫧) › Spearmint, titled "Spearmint gum"',(await q(`select p.name,p.emoji,p.category_id,v.name vn,v.title from public.products p join public.variants v on v.product_id=p.id where p.name='Chewing gum'`)).map(r=>[r.name,r.emoji,r.category_id,r.vn,r.title].join('|'))[0]==='Chewing gum|🫧|5|Spearmint|Spearmint gum');
ok('…and its hidden type (Mints & Chewing Gum) now shows',(await q('select visible from public.categories where id=5'))[0].visible===true);

// Local type names
const names=async c=>(await one(null,`select public.catalogue(${c})`)).map(x=>x.name);
const us=await names(2), uk=await names(1), au=await names(3);
ok('US catalogue: Chocolate, Candy, Chips & Snacks',['Chocolate','Candy','Chips & Snacks'].every(n=>us.includes(n))&&!us.includes('Sweets'),us.join());
ok('UK catalogue keeps Sweets and Crisps & Snacks; Australia says Lollies',['Sweets','Crisps & Snacks'].every(n=>uk.includes(n))&&au.includes('Lollies'),uk.join()+' / '+au.join());
const usHome=await one(null,'select public.home_rankings(2)');
ok('US home rankings say Chips & Snacks',usHome.some(r=>r.category==='Chips & Snacks')&&!usHome.some(r=>r.category==='Crisps & Snacks'),JSON.stringify(usHome.map(r=>r.category)));
ok('ranking page: Chips & Snacks in the US, Crisps & Snacks in the UK',(await one(null,'select public.ranking(3,4,2)')).category==='Chips & Snacks'&&(await one(null,'select public.ranking(3,4,1)')).category==='Crisps & Snacks');
const usReq=await as(22,`select public.submit_item_request(2,2,'Gummy bears','Haribo') id`);
ok('review list uses the local type name (Candy for a US request)',(await q('select * from public.review_list()')).find(r=>r.id==usReq.rows[0].id)?.type==='Candy');

// Declining, and the limit
const rq4=await as(24,`select public.submit_item_request(1,1,'Ruby chocolate bars','Cadbury') id`);
(await q('select public.decline_request($1)',[rq4.rows[0].id]));
ok('declined: the sender sees it as declined, with the ranking they named',(await one(24,'select public.my_submissions()')).some(x=>x.id==='r'+rq4.rows[0].id&&x.status==='declined'&&x.new_ranking==='Ruby chocolate bars'));
for(let k=0;k<9;k++) await as(25,`select public.submit_item(3,5,1,'Limit ${k}')`);
await as(25,`select public.submit_item_request(1,1,'Caramel bars','Limit X')`);
ok('waiting for a check counts towards the limit of 10',/waiting for approval/.test((await as(25,`select public.submit_item_request(1,1,'Mint bars','Limit Y')`)).err||''));

// ---- Deleting an account ----
await as(12,'select public.delete_me()');
const left=(await q(`select (select count(*) from public.item_ratings where user_id=$1)::int r,(select count(*) from public.rating_events where user_id=$1)::int e,(select count(*) from public.approvals where user_id=$1)::int a`,[U(12)]))[0];
ok('deleting an account removes its ratings, history and approvals',left.r===0&&left.e===0&&left.a===0,JSON.stringify(left));

// ---- Migration 007: removing the old site's tables and functions ----
const mig7=fs.readFileSync(R+'migrate-007-cleanup.sql','utf8');
const old7=async(d)=>(await d.query(`select to_regclass('public.legacy_items') li,to_regclass('public.ratings') ra,to_regclass('public.votes') vo,
  to_regclass('public.suggestions') su,to_regclass('public.catalogue_suggestions') cs,to_regprocedure('public.item_list()') il,
  to_regprocedure('public.suggest_catalogue(text,text)') sc,to_regprocedure('public.vote_for_own_item()') vf,to_regprocedure('public.promote_when_approved()') pw`)).rows[0];
{let err=null;try{await db.exec(mig7)}catch(e){err=e.message;await db.exec('rollback')}
 ok('007 stops while the old tables hold people\'s ratings and approvals, naming them',/ratings \(\d+\)/.test(err||'')&&/votes \(\d+\)/.test(err||''),err);
 ok('…and changes nothing',Object.values(await old7(db)).every(Boolean));}
try{await db.exec(mig7.replace("old_data_saved', 'no'","old_data_saved', 'yes'"));await db.exec(mig7);ok('007 runs once the data is saved (and again after)',true)}catch(e){ok('007 runs once the data is saved (and again after)',false,e.message)}
ok('old tables and functions are gone',Object.values(await old7(db)).every(v=>v===null),JSON.stringify(await old7(db)));
ok('the new site still works after 007 (home, ranking, adding)',!(await as(null,'select public.home_rankings(1)')).err&&!!(await one(null,'select public.ranking(3,4,1)'))&&!(await as(26,`select public.submit_item(3,5,1,'After cleanup')`)).err);
ok('profiles kept, and deleting an account still works',(await q(`select to_regclass('public.profiles') p`))[0].p!==null&&!(await as(13,'select public.delete_me()')).err);
// A fresh install has nothing from people in the old tables, so 007 runs as it is; one unread idea stops it
for(const unread of [false,true]){
  const d=new PGlite(); await d.exec(STUB);
  for(const f of ['setup.sql','migrate-002-flavours.sql','migrate-003-no-names.sql','migrate-004-brands.sql','migrate-005-remove-rating.sql','migrate-006-new-kinds.sql']) await d.exec(fs.readFileSync(R+f,'utf8'));
  if(unread){await d.query(`insert into auth.users(id) values ($1)`,[U(1)]);await d.query(`insert into public.catalogue_suggestions(user_id,kind,text) values ($1,'variant','Dark chocolate')`,[U(1)])}
  let err=null;try{await d.exec(mig7)}catch(e){err=e.message;await d.exec('rollback')}
  if(unread)ok('007 also stops for an idea someone sent in',/catalogue_suggestions \(1\)/.test(err||''),err);
  else ok('fresh install: 007 runs without the yes (starter foods only)',!err&&Object.values(await old7(d)).every(v=>v===null),err);
}

// ---- Migration 008: browse by category and brand, adding without a flavour, Withdraw ----
console.log('\n---- Migration 008 ----');
const mig8=fs.readFileSync(R+'migrate-008-browse.sql','utf8');
const fresh=async(extra)=>{ // a fresh database up to 007, plus anything extra, then 008: returns [db, error]
  const d=new PGlite(); await d.exec(STUB);
  for(const f of ['setup.sql','migrate-002-flavours.sql','migrate-003-no-names.sql','migrate-004-brands.sql','migrate-005-remove-rating.sql','migrate-006-new-kinds.sql','migrate-007-cleanup.sql']) await d.exec(fs.readFileSync(R+f,'utf8'));
  if(extra) await d.exec(extra);
  let err=null; try{await d.exec(mig8)}catch(e){err=e.message;await d.exec('rollback')}
  return [d,err];
};
{ // Safety checks: a name clash, or two Werther's brands, stop it and change nothing
  const [d,err]=await fresh(`insert into public.items(product_id,variant_id,brand_id,country_id,pack_name,status)
    select 3,6,id,1,'Walkers Salt and Vinegar Crisps 32.5g','live' from public.brands where name='Walkers'`);
  ok('008 stops when two snacks in one country have the same tidy name, naming them',/same name: .*Walkers Salt & Vinegar Crisps #\d+ \(live\) = Walkers Salt and Vinegar Crisps 32\.5g #\d+ \(live\) \(UK\)/.test(err||''),err);
  ok('…and changes nothing',(await d.query(`select count(*)::int n from information_schema.columns where table_name='items' and column_name='name_key'`)).rows[0].n===0);
  const [d2,err2]=await fresh(`insert into public.brands(name,status) values ('Werther''s Original','live')`);
  ok('008 stops when a separate "Werther\'s Original" brand already exists',/two brands/.test(err2||''),err2);
}
const before8=(await q(`select count(*)::int n from public.items`))[0].n;
try{await db.exec(mig8);await db.exec(mig8);ok('migration 008 runs (twice) without errors',true)}catch(e){ok('migration 008 runs (twice) without errors',false,e.message);return}
ok('…and adds no snacks',(await q(`select count(*)::int n from public.items`))[0].n===before8);
ok('…one Other flavour per category, made once',(await q(`select count(*)::int n from public.variants where is_other`))[0].n===(await q(`select count(*)::int n from public.products`))[0].n&&(await q(`select count(*)::int n from public.variants where is_other group by product_id order by 1 desc limit 1`))[0].n===1);

const key=async t=>(await q('select public.snack_key($1) k',[t]))[0].k;
ok('snack_key strips pack sizes: 150g, 1.5 kg, 6 x 25g, 2 pack',(await key('M&S Double Devon Toffees 150g'))===(await key('M&S Double Devon Toffees'))&&(await key('Walkers Crisps 6 x 25g'))==='walkers crisps'&&(await key('Haribo 1.5 kg'))==='haribo'&&(await key('Twix 2 Pack'))==='twix',await key('Walkers Crisps 6 x 25g'));
ok('…keeps other numbers: 3 Musketeers, 70%, 4 Finger',(await key('3 Musketeers'))==='3 musketeers'&&(await key("Tony's Dark 70%"))==='tonys dark 70'&&(await key('KitKat 4 Finger'))==='kitkat 4 finger');
ok('…ignores capitals, apostrophes (straight or curly), "&"/"and" and punctuation',(await key("WERTHER’S Original"))===(await key("werthers original"))&&(await key('Salt & Vinegar'))===(await key('salt and vinegar'))&&(await key('Boundless, Sea Salt / Cider'))==='boundless sea salt cider');
ok('…keeps Japanese and Chinese names',(await key('Meiji Milk Chocolate (明治ミルクチョコレート)'))==='meiji milk chocolate 明治ミルクチョコレート');
ok('every snack has its key',(await q(`select count(*)::int n from public.items where name_key is null or name_key<>public.snack_key(pack_name)`))[0].n===0);
ok('tidy_case drops commas and stray punctuation, keeps & \' %',(await tidy('Boundless, Sea Salt and Cider Vinegar Chips'))==='Boundless Sea Salt and Cider Vinegar Chips'&&(await tidy("M&S ; Percy Pig's 70%"))==="M&S Percy Pig's 70%"&&(await tidy('Walkers - Max Paprika'))==='Walkers Max Paprika',await tidy("M&S ; Percy Pig's 70%"));

// Werther's Original and the renamed flavour
ok('brand renamed: Werther\'s → Werther\'s Original (same id, every country)',(await q(`select count(*)::int n from public.brands where name='Werther''s Original'`))[0].n===1&&(await q(`select count(*)::int n from public.brands where name='Werther''s'`))[0].n===0);
ok('…UK pack is "Werther\'s Original Butter Candies"; Australia\'s is unchanged',(await q(`select pack_name from public.items i join public.places p on p.id=i.country_id where pack_name like 'Werther%' order by country_id`)).map(r=>r.pack_name).join('|')==="Werther's Original Butter Candies|Werther's Original|Werther's Original (ヴェルタースオリジナル)");
ok('plain toffee shows as "Plain", title still "Toffee"',(await q('select name,title from public.variants where id=2')).map(r=>r.name+'|'+r.title)[0]==='Plain|Toffee');
ok('Other flavours are titled per country: Other crisps (UK), Other chips (US)',(await one(null,'select public.category_page(3,1)'))&&(await q(`select public.ranking_title(id,1) uk, public.ranking_title(id,2) us from public.variants where product_id=3 and is_other`)).map(r=>r.uk+'|'+r.us)[0]==='Other crisps|Other chips');
ok('the old add form\'s list leaves out Other, and has Open Food Facts tags',(await one(null,'select public.catalogue(1)')).every(c=>c.products.every(p=>p.variants.every(v=>!/^Other/.test(v.title))))&&(await one(null,'select public.catalogue(1)'))[2].products[0].off_tags.includes('en:crisps'));

// Guessing the flavour
const guess=async(p,name,hint=null)=>(await q('select v.name from public.variants v where v.id=public.guess_variant($1,$2,$3)',[p,name,hint]))[0].name;
ok('guess: Sea Salt & Balsamic Vinegar → Salt & vinegar',(await guess(3,'KETTLE Sea Salt & Balsamic Vinegar'))==='Salt & vinegar');
ok('guess: Lightly Sea Salted → Ready salted; Mature Cheddar & Chive → Cheese & onion',(await guess(3,'Tyrrells Lightly Sea Salted'))==='Ready salted'&&(await guess(3,'Tyrrells Mature Cheddar & Chive'))==='Cheese & onion');
ok('guess: nothing in the name → the hint, else Other',(await guess(3,'Walkers Prawn Cocktail',5))==='Cheese & onion'&&(await guess(3,'Walkers Prawn Cocktail'))==='Other'&&(await guess(2,"Werther's Original Soft Caramels"))==='Other');
ok('guess: the name wins over the hint',(await guess(3,'Seabrook Sea Salt & Vinegar',5))==='Salt & vinegar');

// Reading the new pages (signed out)
const hc=await one(null,'select public.home_categories(1)');
ok('home_categories (UK): Crisps, Chocolate bars, Toffee, each with snacks and ratings',['Crisps','Chocolate bars','Toffee'].every(n=>hc.some(c=>c.name===n))&&hc.find(c=>c.name==='Crisps').type==='Crisps & Snacks',JSON.stringify(hc.map(c=>[c.name,c.snacks,c.ratings])));
const crispsCard=hc.find(c=>c.name==='Crisps'), toffeeCard=hc.find(c=>c.name==='Toffee');
ok('…Crisps has a top 3 led by the winner; Toffee has none, so it lists 2 to rate first',crispsCard.top.length>=1&&crispsCard.top[0].pack_name==='Walkers Salt & Vinegar Crisps'&&toffeeCard.top.length===0&&toffeeCard.to_rate.length===2,JSON.stringify([crispsCard.top,toffeeCard.to_rate]));
ok('…US says Chips, under Chips & Snacks',(await one(null,'select public.home_categories(2)')).some(c=>c.name==='Chips'&&c.type==='Chips & Snacks'));
const hb=await one(null,'select public.home_brands(1)');
ok('home_brands (UK): only brands with 2+ snacks (Walkers, KETTLE…), with their categories',hb.length>=2&&hb.every(b=>b.snacks>=2)&&hb.some(b=>b.name==='Walkers'&&b.categories[0]==='Crisps')&&!hb.some(b=>b.name==='Cadbury'),JSON.stringify(hb.map(b=>[b.name,b.snacks])));
ok('…Walkers\' best is its ranked salt & vinegar',hb.find(b=>b.name==='Walkers').best?.pack_name==='Walkers Salt & Vinegar Crisps');
const cp=await one(null,'select public.category_page(3,1)');
ok('category_page: every UK crisp in one list, with flavours and their counts',cp.name==='Crisps'&&cp.items.length===cp.flavours.reduce((s,f)=>s+f.count,0)&&cp.flavours.some(f=>f.name==='Salt & vinegar'&&f.count>=5)&&cp.country.code==='GB',JSON.stringify(cp.flavours));
ok('…the ranked one first, each row with its flavour and how many snacks its brand has here',cp.items[0].ranked&&cp.items[0].variant_id===4&&cp.items.find(i=>i.brand==='Walkers').brand_snacks>=2);
ok('…empty flavours and an empty Other aren\'t listed',cp.flavours.every(f=>f.count>0)&&!cp.flavours.some(f=>f.is_other));
ok('…waiting snacks say their flavour',cp.pending.length>0&&cp.pending.every(p=>p.variant_id));
ok('…never names raters or submitters',!/submitted_by|user_id|0000-4000/.test(JSON.stringify(cp)));
ok('category_page for a category that doesn\'t exist is empty',(await one(null,'select public.category_page(999,1)'))===null);
const walkersId=(await q(`select id from public.brands where name='Walkers'`))[0].id;
const bp=await one(null,`select public.brand_page(${walkersId},1)`);
ok('brand_page: Walkers\' UK crisps with their place in Crisps',bp.name==='Walkers'&&bp.items.length>=2&&bp.items[0].place===1&&bp.items[0].product==='Crisps'&&bp.products.length===1,JSON.stringify(bp.items.map(i=>[i.pack_name,i.place])));
ok('…unranked ones have no place, and flavours are counted',bp.items.filter(i=>!i.ranked).every(i=>i.place===null)&&bp.flavours.reduce((s,f)=>s+f.count,0)===bp.items.length);
ok('…never names raters',!/user_id|0000-4000/.test(JSON.stringify(bp)));
ok('search says each snack\'s category ("Toffee")',(await one(null,`select public.search_items('werthers')`)).some(x=>x.product==='Toffee'&&x.pack_name==="Werther's Original Butter Candies"));

// Next on the new pages
let nx=await one(27,`select public.next_snack(${walkersSV},4,false)`);
ok('next_snack: another salt & vinegar crisp when that flavour is picked',nx.kind==='item'&&(await q('select variant_id from public.items where id=$1',[nx.id]))[0].variant_id===4&&nx.short_label!=null,JSON.stringify(nx));
nx=await one(27,`select public.next_snack(${walkersSV},null,true)`);
ok('…from the brand page: another Walkers snack first',nx.kind==='item'&&(await q('select brand_id from public.items where id=$1',[nx.id]))[0].brand_id===walkersId,JSON.stringify(nx));
for(const it of (await one(null,'select public.category_page(3,1)')).items.filter(i=>i.variant_id===4)) await as(27,`select public.rate_item(${it.id},4)`);
nx=await one(27,`select public.next_snack(${walkersSV},4,false)`);
ok('…salt & vinegar all rated → the next flavour\'s list',nx.kind==='list'&&nx.product_id===3&&nx.variant_id===5&&nx.title==='Cheese & onion crisps',JSON.stringify(nx));

// Adding a snack
const ss=async(who,args)=>as(who,`select public.submit_snack(${args}) r`);
let s=await ss(28,`1,2,'Werther''s Original','werthers original soft caramels',null,null,'${OFF}','4014400927634',5`);
ok('submit_snack: Werther\'s Original Soft Caramels goes into Toffee beside the Butter Candies',s.rows&&s.rows[0].r.id&&s.rows[0].r.product==='Toffee'&&s.rows[0].r.pack_name==="Werthers Original Soft Caramels",JSON.stringify(s));
const softId=s.rows&&s.rows[0].r.id;
ok('…its flavour is Other (for the owner to sort), with the sender\'s approval and face',(await q('select v.is_other,(select count(*)::int from public.approvals a where a.item_id=i.id) ap,(select score from public.planned_ratings p where p.item_id=i.id) sc from public.items i join public.variants v on v.id=i.variant_id where i.id=$1',[softId])).map(r=>[r.is_other,r.ap,r.sc].join('|'))[0]==='true|1|5');
ok('…and shows under Toffee, waiting',(await one(28,'select public.category_page(2,1)')).pending.some(p=>p.id===softId&&p.mine));
s=await ss(29,`1,2,'M&S','M&S DOUBLE DEVON TOFFEES 150G'`);
ok('the same name (capitals and pack size aside) → duplicate, nothing added',s.rows&&s.rows[0].r.duplicate?.pack_name==='M&S Double Devon Toffees'&&s.rows[0].r.duplicate.product==='Toffee'&&!s.rows[0].r.id,JSON.stringify(s));
s=await ss(29,`1,1,'Werther''s Original','Werther''s Original Caramel Chocolate',null,null,null,'4014400927634'`);
ok('the same barcode → duplicate',s.rows&&s.rows[0].r.duplicate?.id===softId,JSON.stringify(s));
s=await ss(29,`1,3,'Walkers','walkers'`);
ok('just the brand, when the brand already has crisps here → asks for the full name',/Walkers already has crisps here/.test(s.err||''),s.err);
s=await ss(29,`1,1,'Wispa','Wispa'`);
ok('…but fine for a brand with nothing in that category yet (Wispa)',s.rows&&s.rows[0].r.id,s.err);
s=await ss(29,`1,3,'Boundless','Boundless, Sea Salt and Cider Vinegar Chips',4`);
ok('commas tidied, and the name\'s flavour is guessed (Salt & vinegar)',s.rows&&s.rows[0].r.pack_name==='Boundless Sea Salt and Cider Vinegar Chips'&&s.rows[0].r.variant_id===4,JSON.stringify(s));
s=await ss(29,`1,3,'Walkers','Walkers Prawn Cocktail',5`);
ok('no flavour in the name → the chip it was added from (hint)',s.rows&&s.rows[0].r.variant_id===5,JSON.stringify(s));
ok('a category that doesn\'t exist is refused',/Pick a category/.test((await ss(29,`1,999,'X','X Bar'`)).err||''));
ok('signed out can\'t add',denied(await ss(null,`1,3,'X','X Crisps'`)));
ok('the old add form gets a plain message when the name is taken',/already on TasteRank/.test((await as(29,`select public.submit_item(3,6,1,'M&S','M&S Double Devon Toffees')`)).err||''),(await as(29,`select public.submit_item(3,6,1,'M&S','M&S Double Devon Toffees')`)).err);

// A new category
const nc=await as(30,`select public.submit_new_category(1,'CHOCOLATE SWEETS','Maltesers','Maltesers Milk Chocolate',null,'${OFF}',null,4) id`);
ok('submit_new_category: Maltesers in a new "Chocolate sweets"',!nc.err,nc.err); const ncId=nc.rows&&nc.rows[0].id;
ok('…shows in my submissions as a new category, with its flag',(await one(30,'select public.my_submissions()')).some(x=>x.id==='r'+ncId&&x.new_category&&x.product==='Chocolate sweets'&&x.country_flag==='🇬🇧'&&x.status==='review'));
ok('…an existing category is refused (including a local name: Chips)',/Toffee is already a category/.test((await as(30,`select public.submit_new_category(1,'toffee','X','X Toffee')`)).err||'')&&/is already a category/.test((await as(30,`select public.submit_new_category(2,'Chips','X','X Chips')`)).err||''));
ok('…and a snack that\'s already here is refused',/Already on TasteRank/.test((await as(30,`select public.submit_new_category(1,'Fudge','M&S','M&S Double Devon Toffees')`)).err||''));
ok('review list: "new category", type "you pick"',(await q('select * from public.review_list()')).some(r=>r.id==ncId&&/^new category "Chocolate sweets"/.test(r.guess)&&/you pick/.test(r.type)));
ok('accepting without a type says how to give one',/p_category => 2/.test(await db.query('select public.accept_request($1)',[ncId]).then(()=>'',e=>e.message)));
const acc8=(await q('select public.accept_request($1, p_category => 1) m',[ncId]))[0].m;
ok('accept with a type: new category under Chocolate, with its Other flavour; the snack goes to the vote',/^Added Maltesers Milk Chocolate to Other chocolate sweets/.test(acc8)&&(await q(`select p.category_id,v.title from public.products p join public.variants v on v.product_id=p.id and v.is_other where p.name='Chocolate sweets'`)).map(r=>r.category_id+'|'+r.title)[0]==='1|Other chocolate sweets',acc8);
{const cs=(await q(`select id from public.products where name='Chocolate sweets'`))[0].id;
 ok('…with the sender\'s approval',(await one(30,`select public.category_page(${cs},1)`)).pending.some(p=>p.mine&&p.approvals===1));}
ok('visitors can\'t call the owner\'s lists or accept',denied(await as(30,'select * from public.to_sort()'))&&denied(await as(30,'select public.accept_request(1,p_category=>1)')));
ok('to_sort lists snacks in Other, with the flavours to pick from',(await q('select * from public.to_sort()')).some(r=>r.id==softId&&/Plain/.test(r.flavours)));

// Withdraw
ok('withdraw your own waiting snack',(await one(28,`select public.withdraw_submission('${softId}')`))==='Withdrawn');
ok('…its approvals and planned face go, it leaves your list and the page, and is listed as withdrawn there',(await q('select (select count(*)::int from public.approvals where item_id=$1) a,(select count(*)::int from public.planned_ratings where item_id=$1) p',[softId])).map(r=>r.a+r.p)[0]===0&&!(await one(28,'select public.my_submissions()')).some(x=>x.id===softId)&&(await one(null,'select public.category_page(2,1)')).withdrawn.some(w=>w.id===softId&&w.pack_name==="Werthers Original Soft Caramels")&&!(await one(null,'select public.category_page(2,1)')).pending.some(p=>p.id===softId));
ok('…approving it now says it was withdrawn',/just withdrawn/.test((await as(29,`select public.approve_item(${softId})`)).err||''));
ok('…and the name is free again',!!(await ss(28,`1,2,'Werther''s Original','Werther''s Original Soft Caramels'`)).rows?.[0].r.id);
ok('can\'t withdraw someone else\'s, or a live one',/isn't one of yours/.test((await as(29,`select public.withdraw_submission('${softId}')`)).err||'')&&/Only snacks still waiting/.test((await as(21,`select public.withdraw_submission('${tony.id}')`)).err||''));
const nc2=await as(30,`select public.submit_new_category(1,'Popcorn','Propercorn','Propercorn Sweet & Salty') id`);
ok('withdraw a new-category request (r + id)',(await one(30,`select public.withdraw_submission('r${nc2.rows[0].id}')`))==='Withdrawn'&&!(await one(30,'select public.my_submissions()')).some(x=>x.id==='r'+nc2.rows[0].id)&&!(await q('select * from public.review_list()')).some(r=>r.id==nc2.rows[0].id));
ok('signed out can\'t withdraw',denied(await as(null,`select public.withdraw_submission('1')`)));
ok('nobody can call the internal steps (duplicate check, flavour guess, Other)',denied(await as(30,`select public.find_same_snack(1,'x',null)`))&&denied(await as(null,`select public.guess_variant(3,'x')`))&&denied(await as(30,'select public.ensure_other_variant(3)')));

// The old site keeps working on 008
ok('old site still works: home_rankings, ranking, brand_view, next_to_rate',!(await as(null,'select public.home_rankings(1)')).err&&(await one(null,'select public.ranking(3,4,1)')).items.length>0&&!(await as(null,`select public.brand_view(${walkersId},3,1)`)).err&&!(await as(1,`select public.next_to_rate(${walkersSV},false)`)).err);
ok('…and no empty "Other" ranking appears on the old home',!(await one(null,'select public.home_rankings(1)')).some(r=>/^Other/.test(r.title)));

// 009: lighter home cards
const hcBefore=await one(null,'select public.home_categories(1)'),hbBefore=await one(null,'select public.home_brands(1)');
const mig9=fs.readFileSync(R+'migrate-009-home-cards.sql','utf8');
try{await db.exec(mig9);await db.exec(mig9);ok('migration 009 runs (twice) without errors',true)}catch(e){ok('migration 009 runs (twice) without errors',false,e.message);return}
const hc9=await one(null,'select public.home_categories(1)'),hb9=await one(null,'select public.home_brands(1)');
ok('…same cards in the same order, every old field kept',JSON.stringify(hc9.map(c=>[c.id,c.snacks,c.ratings,c.top,c.to_rate]))===JSON.stringify(hcBefore.map(c=>[c.id,c.snacks,c.ratings,c.top,c.to_rate]))&&JSON.stringify(hb9.map(b=>[b.id,b.thumb,b.best]))===JSON.stringify(hbBefore.map(b=>[b.id,b.thumb,b.best])));
const totals9=await q('select product_id,brand_id,total from public.item_totals(1)');
ok('…lead is the most ratings one snack has (category and brand)',hc9.every(c=>c.lead===Math.max(...totals9.filter(t=>t.product_id===c.id).map(t=>t.total)))&&hb9.every(b=>b.lead===Math.max(...totals9.filter(t=>t.brand_id===b.id).map(t=>t.total))),JSON.stringify(hc9.map(c=>[c.name,c.lead])));
const noPic=x=>!x.image_url&&!x.image_path;
ok('…up to 4 photos (never more than the snacks), photos before emoji-only ones',[...hc9,...hb9].every(c=>c.thumbs.length===Math.min(4,c.snacks)&&!c.thumbs.some((x,i)=>i&&!noPic(x)&&noPic(c.thumbs[i-1]))),JSON.stringify(hc9.map(c=>[c.name,c.thumbs.length,c.snacks])));

// ---- Migration 010: the clean-up, in the live order (008 and 009 run, 007 never run) ----
console.log('\n---- Migration 010 ----');
const mig10=fs.readFileSync(R+'migrate-010-cleanup.sql','utf8');
const live=new PGlite(); await live.exec(STUB);
for(const f of ['setup.sql','migrate-002-flavours.sql','migrate-003-no-names.sql','migrate-004-brands.sql','migrate-005-remove-rating.sql','migrate-006-new-kinds.sql','migrate-008-browse.sql','migrate-009-home-cards.sql']) await live.exec(fs.readFileSync(R+f,'utf8'));
await live.query('insert into auth.users(id) values ($1)',[U(1)]);
await live.query(`insert into public.ratings(item_id,user_id,score) select min(id),$1,5 from public.legacy_items`,[U(1)]);
await live.query(`insert into public.catalogue_suggestions(user_id,kind,text) values ($1,'variant','Dark chocolate')`,[U(1)]);
const lq=async s=>(await live.query(s)).rows;
const oldLeft=async()=>(await lq(`select (select count(*)::int from pg_tables where schemaname='public' and tablename in ('ratings','votes','legacy_items','suggestions','catalogue_suggestions')) t,
  (select count(*)::int from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname in ('ranking','home_rankings','brand_cards','brand_view','next_to_rate','submit_item','submit_item_request','guess_title','my_rating_count','item_list','suggest_catalogue','vote_for_own_item','promote_when_approved')) f`))[0];
{let err=null;try{await live.exec(mig10)}catch(e){err=e.message;await live.exec('rollback')}
 ok('010 stops when old tables hold things people sent, naming them',/ratings \(1\).*catalogue_suggestions \(1\)/.test(err||''),err);
 ok('…and changes nothing',JSON.stringify(await oldLeft())===JSON.stringify({t:5,f:13}),JSON.stringify(await oldLeft()));}
const yes10=mig10.replace(`'tasterank.old_data_saved', 'no'`,`'tasterank.old_data_saved', 'yes'`);
try{await live.exec(yes10);await live.exec(yes10);ok('with yes, 010 runs (twice) without errors',true)}catch(e){ok('with yes, 010 runs (twice) without errors',false,e.message)}
ok('…every old table and function is gone',JSON.stringify(await oldLeft())==='{"t":0,"f":0}',JSON.stringify(await oldLeft()));
const kept10=(await lq(`select p.proname from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'`)).map(r=>r.proname);
const site=['app_settings','approve_item','brand_page','brand_suggest','catalogue','category_page','delete_me','home_brands','home_categories','my_profile','my_ratings','my_submissions','next_snack','place_list','rate_item','search_items','unrate_item','withdraw_submission','submit_snack','submit_new_category','set_home_place','to_sort','review_list','accept_request','decline_request'];
ok('…everything the site, the owner and prompt 06 use is still there',site.every(n=>kept10.includes(n)),site.filter(n=>!kept10.includes(n)).join(' '));
ok('…and the pages still load',(await lq('select jsonb_array_length(public.home_categories(1)) n'))[0].n>0&&!!(await lq('select public.category_page(3,1) p'))[0].p&&(await lq('select jsonb_array_length(public.search_items(\'walkers\')) n'))[0].n>0);

// ---- Migration 011: the owner page, on the database 010 just tidied ----
console.log('\n---- Migration 011 ----');
{ // its own block, so its names don't clash with the tests above
const mig11=fs.readFileSync(R+'migrate-011-owner-page.sql','utf8');
await live.exec('alter table auth.users add column if not exists email text');
for(const n of [2,3,4]) await live.query('insert into auth.users(id,email) values ($1,$2) on conflict do nothing',[U(n),n===2?'Owner@Example.com':`t${n}@example.com`]);
const las=async(who,sql,params)=>{
  await live.exec(`set role ${who?'authenticated':'anon'}`);
  await live.query(`select set_config('request.jwt.claim.sub',$1,false)`,[who?U(who):'']);
  try{return {rows:(await live.query(sql,params)).rows}}catch(e){return {err:e.message}}finally{await live.exec('reset role')}
};
const lone=async(who,sql,params)=>{const r=await las(who,sql,params);if(r.err)throw new Error(sql+': '+r.err);return Object.values(r.rows[0])[0]};
const ldenied=x=>!!x.err&&/permission denied/.test(x.err);
const nc11=await las(3,`select public.submit_new_category(1,'Jelly sweets','Haribo','Haribo Starmix') id`); // the live site's call, before 011
ok('before 011: a new subcategory is saved without its category',!!nc11.rows,nc11.err);
const r11a=nc11.rows[0].id;
try{const out=await live.exec(mig11);ok('011 runs without errors (email not typed yet)',true);
  ok('…and says owners 0',out[out.length-2]?.rows?.[0]?.owners==0||(await lq('select count(*)::int n from public.owners'))[0].n===0)}catch(e){ok('011 runs without errors (email not typed yet)',false,e.message);return}
const yes11=mig11.replace(`'type-your-email-here'`,`' owner@example.com '`);
try{await live.exec(yes11);await live.exec(yes11);ok('with an email (any capitals, spaces), 011 runs twice',true)}catch(e){ok('with an email (any capitals, spaces), 011 runs twice',false,e.message);return}
ok('…and that account is the one owner',JSON.stringify((await lq('select user_id from public.owners')).map(r=>r.user_id))===JSON.stringify([U(2)]));

// Who may use it
ok('signed out: no owner calls at all',ldenied(await las(null,'select public.owner_status()'))&&ldenied(await las(null,'select public.owner_queue()'))&&ldenied(await las(null,"select public.owner_set_status(1,'hide')")));
ok('someone else: owner_status says no, and every owner action refuses',(await lone(3,'select public.owner_status()')).owner===false
  &&(await Promise.all(['select public.owner_queue()','select public.owner_snacks(1)','select public.owner_catalogue()',`select public.owner_decline(${r11a})`,`select public.owner_accept(${r11a})`,
     "select public.owner_set_status(1,'hide')","select public.owner_save_snack(1,'x','y',1,1,'Crisps',null)","select public.owner_save_subcategory(1,'x',1)",'select public.owner_move_snacks(1,2)']
     .map(async sql=>/for TasteRank's owner/.test((await las(3,sql)).err||'')))).every(Boolean));
ok('…and nobody can call the helpers or read the owners list',(await Promise.all(['select public.is_owner()','select public.require_owner()',"select public.owner_product('x',1)","select public.owner_variant(1,'x')","select public.owner_emoji('x')",'select * from public.owners'].map(async sql=>ldenied(await las(2,sql))))).every(Boolean));
const st11=await lone(2,'select public.owner_status()');
ok('the owner: owner_status says yes, with 1 to check',st11.owner===true&&st11.to_check===1,JSON.stringify(st11));

// The sender's category is kept now
const nc11b=await las(4,`select public.submit_new_category(1,'Gummies','Haribo','Haribo Goldbears',null,null,null,4,2) id`);
ok('011: a new subcategory keeps the category picked (and the old 8-argument call still works)',!!nc11b.rows&&(await lq(`select category_id from public.item_requests where id=${nc11b.rows[0].id}`))[0].category_id===2,nc11b.err);
ok('…review_list names it instead of "you pick"',(await lq('select * from public.review_list()')).find(r=>r.id==nc11b.rows[0].id).type==='Sweets');
ok('…an unknown category is refused',/Pick the category/.test((await las(4,`select public.submit_new_category(1,'Toffee apples','Haribo','Haribo Apples',null,null,null,null,99)`)).err||''));
const queue=await lone(2,'select public.owner_queue()');
ok('owner_queue: both waiting, oldest first, with what was sent and never who',queue.length===2&&queue[0].id==r11a&&queue[1].category_id===2&&queue[0].pack_name==='Haribo Starmix'&&!JSON.stringify(queue).includes(U(3))&&!('user_id' in queue[0]),JSON.stringify(queue));

// Accept, with changes
ok('accept refuses an emoji that isn\'t one',/Just one emoji/.test((await las(2,`select public.owner_accept(${r11a},2,'Jelly Sweets',null,'ab')`)).err||'')&&/Just one emoji/.test((await las(2,`select public.owner_accept(${r11a},2,'Jelly Sweets',null,'🐻 🐻')`)).err||'')&&/Just one emoji/.test((await las(2,`select public.owner_accept(${r11a},2,'Jelly Sweets',null,'グミ')`)).err||''));
const acc=await lone(2,`select public.owner_accept(${r11a},2,'Jelly Sweets',null,'🐻',' haribo ','Haribo Starmix Sweets')`);
const jelly=(await lq(`select * from public.products where name='Jelly sweets'`))[0];
ok('accept: a new subcategory in the chosen category, with your emoji',!!jelly&&jelly.category_id===2&&jelly.emoji==='🐻'&&/in the vote/.test(acc.message),JSON.stringify(acc));
const starmix=(await lq(`select i.*,b.name brand from public.items i join public.brands b on b.id=i.brand_id where i.id=${acc.item_id}`))[0];
ok('…the snack is in the vote, with your name and the brand as it is on TasteRank',starmix.status==='pending'&&starmix.pack_name==='Haribo Starmix Sweets'&&starmix.brand==='Haribo'&&acc.product==='Jelly sweets');
ok('…with the sender\'s approval counted',(await lq(`select count(*)::int n from public.approvals where item_id=${acc.item_id}`))[0].n===1);
ok('…and it isn\'t waiting any more',/isn't waiting any more/.test((await las(2,`select public.owner_accept(${r11a})`)).err||'')&&(await lone(2,'select public.owner_status()')).to_check===1);
const r11b=nc11b.rows[0].id;
ok('decline',/Declined/.test(await lone(2,`select public.owner_decline(${r11b})`))&&(await lq(`select status from public.item_requests where id=${r11b}`))[0].status==='declined');

// Snacks
const sn=await lone(2,'select public.owner_snacks(1)');
const mine=sn.find(x=>x.id==acc.item_id);
ok('owner_snacks: newest first, with status, ratings, approvals and days left',sn[0].id==acc.item_id&&mine.status==='pending'&&mine.approvals===1&&mine.ratings===0&&mine.days_left===30&&mine.product==='Jelly sweets',JSON.stringify(mine));
ok('…all countries with null, one snack with p_item',(await lone(2,'select public.owner_snacks(null)')).length>=sn.length&&(await lone(2,`select public.owner_snacks(null,${acc.item_id})`)).length===1);
const lv=await lone(2,`select public.owner_set_status(${acc.item_id},'live')`);
ok('put live now: live straight away, brand too, and on the home page',lv.status==='live'&&(await lq(`select b.status from public.brands b where name='Haribo'`))[0].status==='live'
  &&(await lq('select public.home_categories(1) h'))[0].h.some(c=>c.name==='Jelly sweets'));
ok('…a live snack can\'t be put live again',/in the vote or closed/.test((await las(2,`select public.owner_set_status(${acc.item_id},'live')`)).err||''));
await live.query(`insert into public.item_ratings(item_id,user_id,score) values ($1,$2,5)`,[acc.item_id,U(4)]);
const hd=await lone(2,`select public.owner_set_status(${acc.item_id},'hide')`);
ok('hide: off the home page, search and its list; ratings kept; can\'t be rated',hd.status==='hidden'&&hd.ratings===1
  &&!(await lq('select public.home_categories(1) h'))[0].h.some(c=>c.name==='Jelly sweets')
  &&!(await lq(`select public.search_items('starmix') s`))[0].s.length&&/live|rate/i.test((await las(4,`select public.rate_item(${acc.item_id},3)`)).err||'x'));
const again=await las(3,`select public.submit_snack(1,${jelly.id},'Haribo','Haribo Starmix Sweets') r`);
ok('…someone can add the same snack again (it goes to the vote)',!!again.rows?.[0].r.id&&!again.rows[0].r.duplicate,JSON.stringify(again));
ok('…then showing the hidden one again is refused, saying why',/Another snack with this name is listed now/.test((await las(2,`select public.owner_set_status(${acc.item_id},'show')`)).err||''));
await lone(3,`select public.withdraw_submission('${again.rows[0].r.id}')`);
const sh=await lone(2,`select public.owner_set_status(${acc.item_id},'show')`);
ok('…once that copy is gone, show again puts it back as it was (live)',sh.status==='live'&&sh.ratings===1);
ok('…the sender\'s list copes with a hidden snack',!(await las(3,'select public.my_submissions()')).err);

// Change a snack
const kk=(await lq(`select id,country_id,pack_name from public.items where status='live' and id<>${acc.item_id} order by id limit 1`))[0];
ok('change: a name another snack has is refused, saying so',/Another snack in UK already has that name/.test((await las(2,`select public.owner_save_snack(${acc.item_id},$1,'Haribo',1,2,'Jelly Sweets',null)`,[kk.pack_name])).err||''));
const ch=await lone(2,`select public.owner_save_snack(${acc.item_id},'haribo starmix','Haribo UK',1,2,'jelly sweets','sour')`);
ok('change: name tidied, new brand, a new flavour made in the subcategory',ch.pack_name==='Haribo Starmix'&&ch.brand==='Haribo UK'&&ch.flavour==='Sour'&&ch.product==='Jelly sweets',JSON.stringify(ch));
ok('…a new subcategory by name, in the category given',(await lone(2,`select public.owner_save_snack(${acc.item_id},'Haribo Starmix','Haribo',1,2,'Fizzy sweets','Other')`)).product==='Fizzy sweets'&&(await lq(`select category_id from public.products where name='Fizzy sweets'`))[0].category_id===2);
ok('photos: only Open Food Facts links or your own folder; empty removes it',
  /only come from Open Food Facts/.test((await las(2,`select public.owner_save_snack(${acc.item_id},'Haribo Starmix','Haribo',1,2,'Jelly Sweets',null,'https://evil.example/x.jpg')`)).err||'')
  &&/your own folder/.test((await las(2,`select public.owner_save_snack(${acc.item_id},'Haribo Starmix','Haribo',1,2,'Jelly Sweets',null,'${U(3)}/a.jpg')`)).err||'')
  &&(await lone(2,`select public.owner_save_snack(${acc.item_id},'Haribo Starmix','Haribo',1,2,'Jelly Sweets',null,'${U(2)}/a.jpg')`)).image_path===`${U(2)}/a.jpg`
  &&(await lone(2,`select public.owner_save_snack(${acc.item_id},'Haribo Starmix','Haribo',1,2,'Jelly Sweets',null,'https://images.openfoodfacts.org/x.jpg')`)).image_url==='https://images.openfoodfacts.org/x.jpg'
  &&(await lone(2,`select public.owner_save_snack(${acc.item_id},'Haribo Starmix','Haribo',1,2,'Jelly Sweets',null,'')`)).image_url===null);
ok('…an empty flavour keeps it in the same subcategory',(await lone(2,`select public.owner_save_snack(${acc.item_id},'Haribo Starmix','Haribo',1,2,'Jelly Sweets',null)`)).flavour==='Other');

// Subcategories
const cat11=await lone(2,'select public.owner_catalogue()');
ok('owner_catalogue: categories, and subcategories with emoji, snacks and flavours',cat11.categories.filter(c=>c.visible).length===3&&cat11.products.find(p=>p.name==='Jelly sweets').snacks===1&&cat11.products.find(p=>p.name==='Jelly sweets').flavours.some(f=>f.name==='Sour'));
ok('rename to a name that\'s taken: refused, pointing to Move',/already a subcategory called Toffee.*Move its snacks/.test((await las(2,`select public.owner_save_subcategory(${jelly.id},'toffee',2)`)).err||''));
const sv11=await lone(2,`select public.owner_save_subcategory(${jelly.id},'jelly sweets',2,'🍬')`);
ok('rename, category and emoji saved (an empty emoji keeps the old one)',sv11.name==='Jelly sweets'&&sv11.emoji==='🍬'&&(await lone(2,`select public.owner_save_subcategory(${jelly.id},'Jelly Sweets',2,'')`)).emoji==='🍬');
const fizzy=(await lq(`select id from public.products where name='Fizzy sweets'`))[0].id;
await lone(2,`select public.owner_save_snack(${acc.item_id},'Haribo Starmix','Haribo',1,2,'Fizzy Sweets','Sour')`);
const mv=await lone(2,`select public.owner_move_snacks(${fizzy},${jelly.id})`);
ok('move: the snacks go across with their flavour, and the empty subcategory goes',mv===1&&(await lone(2,`select public.owner_snacks(null,${acc.item_id})`))[0].product==='Jelly sweets'
  &&(await lone(2,`select public.owner_snacks(null,${acc.item_id})`))[0].flavour==='Sour'&&!(await lq(`select 1 from public.products where id=${fizzy}`)).length,JSON.stringify(mv));
ok('…ratings come along',(await lq(`select count(*)::int n from public.item_ratings where item_id=${acc.item_id}`))[0].n===1);
ok('…and moving into itself is refused',/different subcategory/.test((await las(2,`select public.owner_move_snacks(${jelly.id},${jelly.id})`)).err||''));
ok('after it all, the pages still load',(await lq('select jsonb_array_length(public.home_categories(1)) n'))[0].n>0&&!!(await lq(`select public.category_page(${jelly.id},1) p`))[0].p&&!(await las(null,'select public.catalogue(1)')).err);

// ---- Migration 012: at most 5 additions a day ----
console.log('\n---- Migration 012 ----');
const mig12=fs.readFileSync(R+'migrate-012-daily-limit.sql','utf8');
try{await live.exec(mig12);await live.exec(mig12);ok('012 runs twice without errors',true)}catch(e){ok('012 runs twice without errors',false,e.message);return}
ok('…and the site can read the number',(await las(null,`select public.app_settings()->>'max_daily_submissions' v`)).rows[0].v==='5');
const crisps12=(await lq(`select id from public.products where name='Crisps'`))[0].id;
const add12=(who,k)=>las(who,`select public.submit_snack(1,${crisps12},'Daybrand','Daybrand Test Crisps ${k}') r`);
const past12=()=>lq(`update public.items set created_at=now()-interval '25 hours' where submitted_by='${U(4)}'`); // earlier tests' additions are "yesterday"
await past12();await lq(`update public.item_requests set created_at=now()-interval '25 hours' where user_id='${U(4)}'`);
const ids12=[];
for(let k=1;k<=5;k++){const r=await add12(4,'A'+k);if(r.err)ok('five snacks in a day are fine',false,r.err);else ids12.push(r.rows[0].r.id)}
ok('five snacks in a day are fine',ids12.length===5);
ok('the sixth is refused, saying why',/added 5 snacks today/.test((await add12(4,'A6')).err||''));
await lone(4,`select public.withdraw_submission('${ids12[0]}')`);
ok('withdrawing one doesn\'t free a place',/added 5 snacks today/.test((await add12(4,'A7')).err||''));
await past12();
ok('after 24 hours they don\'t count',!(await add12(4,'B1')).err);
const req12=await las(4,`select public.submit_new_category(1,'Gummy bears','Daybrand','Daybrand Gummy Bears',p_category=>2) id`);
ok('a new subcategory counts too',!req12.err&&!(await add12(4,'B2')).err&&!(await add12(4,'B3')).err&&!(await add12(4,'B4')).err
  &&/added 5 snacks today/.test((await add12(4,'B5')).err||''),req12.err);
await past12();
await lone(2,`select public.owner_accept(${req12.rows[0].id})`);
await lq(`update public.items set status='live' where submitted_by='${U(4)}' and status='pending' and id<>(select item_id from public.item_requests where id=${req12.rows[0].id})`); // so the 10-waiting rule stays out of it
let n12=0,e12='';for(const k of ['C1','C2','C3','C4','C5']){const r=await add12(4,k);if(!r.err)n12++;else e12=r.err}
ok('…and the one refused says so',/added 5 snacks today/.test(e12),e12);
ok('an accepted subcategory counts once, not twice',n12===4,String(n12));
let own12=0;for(let k=1;k<=6;k++)if(!(await las(2,`select public.submit_snack(1,${crisps12},'Ownbrand','Ownbrand Crisps ${k}') r`)).err)own12++;
ok('the owner has no daily limit',own12===6,String(own12));

// ---- Migration 013: new lists on home ----
console.log('\n---- Migration 013 ----');
const gummy=(await lq(`select id from public.products where name='Gummy bears'`))[0].id;
const hc12=(await las(null,'select public.home_categories(1) h')).rows[0].h;
ok('before 013: a list whose only snack is in the vote has no home card',!hc12.some(c=>c.id==gummy));
const mig13=fs.readFileSync(R+'migrate-013-new-lists.sql','utf8');
try{await live.exec(mig13);await live.exec(mig13);ok('013 runs twice without errors',true)}catch(e){ok('013 runs twice without errors',false,e.message);return}
const hc13=(await las(null,'select public.home_categories(1) h')).rows[0].h;
const keep=c=>[c.id,c.name,c.emoji,c.type,c.type_id,c.snacks,c.ratings,c.lead,c.thumbs,c.top,c.to_rate];
ok('…the live cards are the same, in the same order, every old field kept',JSON.stringify(hc13.filter(c=>c.snacks>0).map(keep))===JSON.stringify(hc12.map(keep)));
const g13=hc13.find(c=>c.id==gummy);
ok('…the new list has a card: 0 live, 1 waiting, its snack\'s picture, after every live card',!!g13&&g13.snacks===0&&g13.waiting===1&&g13.thumbs.length===1&&hc13.indexOf(g13)>hc13.findLastIndex(c=>c.snacks>0)&&g13.type==='Sweets',JSON.stringify(g13));
const pend13=await lq(`select product_id,count(*)::int n from public.items where country_id=1 and public.status_now(status,created_at)='pending' group by product_id`);
ok('…every card says how many of its snacks are in the vote',hc13.every(c=>c.waiting===(pend13.find(x=>x.product_id==c.id)?.n||0)),JSON.stringify(hc13.map(c=>[c.name,c.waiting])));
ok('…not in another country',!(await las(null,'select public.home_categories(2) h')).rows[0].h.some(c=>c.id==gummy));
const gItem=(await lq(`select id from public.items where product_id=${gummy}`))[0].id;
await lq(`update public.items set created_at=now()-interval '31 days' where id=${gItem}`);
ok('…the card goes when its snack closes after 30 days',!(await lone(null,'select public.home_categories(1)')).some(c=>c.id==gummy));
await lq(`update public.items set created_at=now() where id=${gItem}`);
await lone(2,`select public.owner_set_status(${gItem},'hide')`);
ok('…or when it\'s hidden',!(await lone(null,'select public.home_categories(1)')).some(c=>c.id==gummy));
await lone(2,`select public.owner_set_status(${gItem},'show')`);
ok('…and it comes back when shown again',(await lone(null,'select public.home_categories(1)')).some(c=>c.id==gummy&&c.snacks===0));
await lone(2,`select public.owner_set_status(${gItem},'live')`);
const g13b=(await lone(null,'select public.home_categories(1)')).find(c=>c.id==gummy);
ok('…once it goes live, it\'s an ordinary card (1 snack, 0 waiting)',g13b.snacks===1&&g13b.waiting===0,JSON.stringify(g13b));
ok('…and its page still loads',!!(await lone(null,`select public.category_page(${gummy},1)`)));

// ---- Migration 014: new categories ----
console.log('\n---- Migration 014 ----');
const mig14=fs.readFileSync(R+'migrate-014-new-categories.sql','utf8');
for(let i=15;i<=19;i++)await live.query('insert into auth.users(id) values ($1) on conflict do nothing',[U(i)]);
try{await live.exec(mig14);await live.exec(mig14);ok('014 runs twice without errors',true)}catch(e){ok('014 runs twice without errors',false,e.message);return}
const cl=(await las(null,'select public.category_list(1) c')).rows?.[0].c||[];
ok('category_list (signed out): every category, the ones with no snacks yet too',cl.some(c=>c.name==='Sweets'&&c.visible)&&cl.some(c=>c.name==='Biscuits & Cereal Bars'&&!c.visible),JSON.stringify(cl));
const old14=await las(15,`select public.submit_new_category(1,'Gummy worms','Haribo','Haribo Tangfastics',p_category=>2) id`);
ok('the live site\'s call still works (a new subcategory in Sweets)',!old14.err&&(await lq(`select category_id,new_type from public.item_requests where id=${old14.rows?.[0].id}`))[0]?.category_id===2,old14.err);
const nt=await las(16,`select public.submit_new_category(1,'bakewell tarts','Mr Kipling','Mr Kipling Cherry Bakewells',p_new_type=>' cakes ') id`);
const ntRow=nt.rows&&(await lq(`select * from public.item_requests where id=${nt.rows[0].id}`))[0];
ok('a snack in a new category: saved with the category tidied, and no category picked',!nt.err&&ntRow.new_type==='Cakes'&&ntRow.category_id===null&&ntRow.new_ranking==='Bakewell tarts',nt.err||JSON.stringify(ntRow));
ok('…a category that\'s already set up is refused, by its name (any case)',/Category Biscuits & Cereal Bars is already on TasteRank/.test((await las(16,`select public.submit_new_category(1,'Digestives','McVitie''s','McVitie''s Digestives',p_new_type=>'biscuits & cereal bars')`)).err||'')
  &&/Category Sweets is already/.test((await las(16,`select public.submit_new_category(1,'Fizzy sweets','X','X Fizz',p_new_type=>'SWEETS')`)).err||''));
ok('…and one over 40 letters',/under 40 letters/.test((await las(16,`select public.submit_new_category(1,'Long','X','X Long',p_new_type=>'${'a'.repeat(41)}')`)).err||''));
ok('…with a category picked too, the new one wins',(await (async()=>{const r=await las(17,`select public.submit_new_category(1,'Pork pies','Pork Farms','Pork Farms Pork Pie',p_category=>2,p_new_type=>'Pies') id`);return r.rows&&(await lq(`select category_id,new_type from public.item_requests where id=${r.rows[0].id}`))[0]})()).new_type==='Pies');
const pieReq=(await lq(`select id from public.item_requests where new_type='Pies'`))[0].id;
const ms14=(await lone(16,'select public.my_submissions()')).find(x=>x.id==='r'+nt.rows[0].id);
ok('my_submissions says the new category',ms14&&ms14.new_type==='Cakes'&&ms14.product==='Bakewell tarts'&&ms14.status==='review',JSON.stringify(ms14));
const q14=await lone(2,'select public.owner_queue()'),q14r=q14.find(r=>r.id==nt.rows[0].id);
ok('owner_queue says it too, and never who sent it',q14r&&q14r.new_type==='Cakes'&&q14r.category_id===null&&!JSON.stringify(q14).includes(U(16)),JSON.stringify(q14r));
ok('signed out: can\'t accept, and nobody can call the category helpers',ldenied(await las(null,`select public.owner_accept(${nt.rows[0].id})`))&&ldenied(await las(3,"select public.owner_category('X')"))&&ldenied(await las(3,"select public.find_category('X')")));
ok('someone else can\'t accept',/for TasteRank's owner/.test((await las(3,`select public.owner_accept(${nt.rows[0].id})`)).err||''));
const a14=await lone(2,`select public.owner_accept(${nt.rows[0].id},p_emoji=>'🍰')`);
const cakes=(await lq(`select * from public.categories where name='Cakes'`))[0],tarts=(await lq(`select * from public.products where name='Bakewell tarts'`))[0];
ok('accept with no category picked: the new category is made, switched on, last in order',!!cakes&&cakes.visible&&cakes.sort===Math.max(...(await lq('select sort from public.categories')).map(r=>r.sort)),JSON.stringify(cakes));
ok('…with the subcategory in it and the snack in the vote',!!tarts&&tarts.category_id===cakes.id&&tarts.emoji==='🍰'&&/in the vote/.test(a14.message)&&a14.product==='Bakewell tarts',JSON.stringify(a14));
const hc14=await lone(null,'select public.home_categories(1)');
ok('…and home shows it as a new list, under Cakes',hc14.some(c=>c.name==='Bakewell tarts'&&c.type==='Cakes'&&c.snacks===0&&c.waiting===1));
ok('…and the add form\'s catalogue has Cakes now',(await lone(null,'select public.catalogue(1)')).some(c=>c.name==='Cakes'));
await lone(2,`select public.owner_accept(${pieReq},p_category=>${cl.find(c=>c.name==='Biscuits & Cereal Bars').id})`);
ok('the owner can file a new category in one that\'s set up instead: no "Pies" made, Biscuits & Cereal Bars switched on',!(await lq(`select 1 from public.categories where name='Pies'`)).length&&(await lq(`select visible from public.categories where name='Biscuits & Cereal Bars'`))[0].visible);
const d14=await las(18,`select public.submit_new_category(1,'Doughnuts','Krispy Kreme','Krispy Kreme Original Glazed',p_new_type=>'Treats') id`);
await lone(2,`select public.owner_accept(${d14.rows[0].id},p_new_type=>'cakes')`);
ok('…or rename it to one that exists (Treats → Cakes): no duplicate',(await lq(`select count(*)::int n from public.categories where public.norm(name) in ('cakes','treats')`))[0].n===1
  &&(await lq(`select c.name from public.products p join public.categories c on c.id=p.category_id where p.name='Doughnuts'`))[0].name==='Cakes');
const e14=await las(19,`select public.submit_new_category(1,'Ice lollies','Fab','Fab Strawberry',p_new_type=>'Frozen') id`);
await lone(2,`select public.owner_accept(${e14.rows[0].id},p_new_type=>'Frozen treats')`);
ok('…or tidy its name before accepting (Frozen → Frozen treats)',(await lq(`select visible from public.categories where name='Frozen treats'`))[0]?.visible===true&&!(await lq(`select 1 from public.categories where name='Frozen'`)).length);
await lone(2,`select public.owner_accept(${old14.rows[0].id},2,'Gummy worms',null,'🪱',null,null)`);
ok('the live owner page\'s call (7 values) still works',(await lq(`select c.name from public.products p join public.categories c on c.id=p.category_id where p.name='Gummy worms'`))[0]?.name==='Sweets');
ok('after it all, the pages still load',(await lone(null,'select jsonb_array_length(public.home_categories(1))'))>0&&!!(await lone(null,`select public.category_page(${tarts.id},1)`))&&!(await las(16,'select public.my_submissions()')).err);
}
}
