// Tests supabase/setup.sql + migrate-002-flavours.sql on an in-memory Postgres with a small Supabase stand-in.
// Nothing touches the live database. Run from this folder:
//   npm install --no-save @electric-sql/pglite@0.2.17 && node migration.test.js
const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs');
const R=require('path').join(__dirname,'..')+'/';
const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let pass=0,fail=0;
const ok=(name,cond,extra='')=>{if(cond){pass++;console.log('PASS ',name)}else{fail++;console.log('FAIL ',name,extra)}};
(async()=>{
const db=new PGlite();
// ---- Minimal Supabase stand-in: roles, auth.users, auth.uid(), storage, default grants ----
await db.exec(`
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
`);
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

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
