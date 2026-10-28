/* TasteRank behaviour. Loaded by index.html after the Supabase library. */
/* ============================================================
   SETTINGS: paste your keys here (see SETUP.md). The page itself is index.html; styles are in app.css.
   All of these are safe to be public; none of them is a password.
   Leave SUPABASE ones empty to run in demo mode (data saved on this device only).
   ============================================================ */
const CONFIG={
  SUPABASE_URL:'https://odhqfbfgxdvpsdoykafy.supabase.co',
  SUPABASE_ANON_KEY:'sb_publishable_DgUNWQ4tsRpyaOrvPq-YcQ_jUr4bDm-',   // publishable key: safe to be public
  WEB3FORMS_KEY:'4637aa3c-88ac-43ec-9392-3527b640dc82',   // web3forms.com: feedback is emailed to the address this key was made for; it never appears on the site
  GOATCOUNTER_CODE:'tasterank'   // stats at https://tasterank.goatcounter.com
};

/* ---------- Constants ---------- */
const FACES=[
  {v:5,e:'😍',l:'Love it'},{v:4,e:'😊',l:'Like it'},{v:3,e:'😐',l:"It's okay"},
  {v:2,e:'😕',l:'Not for me'},{v:1,e:'🤢',l:'Yuck'}
];
const DEFAULT_COUNTRY='GB';
const BUBBLE_UNTIL=3; // Crispy's speech bubble on home shows until someone has rated this many items

/* ---------- Small helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const faceFor=a=>FACES.find(f=>f.v===Math.round(Math.round(a*10)/10))||FACES[2]; // matches the score shown (4.47 shows as 4.5 → 😍)
const fmt=n=>Number(n||0).toLocaleString('en-GB');
const plural=(n,w)=>`${fmt(n)} ${w}${n===1?'':'s'}`;
const score1=a=>Number(a).toFixed(1);
/* Saved settings. Pass session=true for data that should last only until the tab closes.
   Wrapped in try because some browsers block storage (e.g. private windows). */
const store={
  get(k,session){try{return JSON.parse((session?sessionStorage:localStorage).getItem(k))}catch(e){return null}},
  set(k,v,session){try{(session?sessionStorage:localStorage).setItem(k,JSON.stringify(v))}catch(e){}},
  del(k,session){try{(session?sessionStorage:localStorage).removeItem(k)}catch(e){}}
};
const photoUrl=it=>it.image_url||(it.image_path&&CONFIG.SUPABASE_URL?`${CONFIG.SUPABASE_URL}/storage/v1/object/public/product-photos/${it.image_path}`:null);
function thumb(it,cls=''){
  const e=esc(it.emoji||'🍽️'),u=photoUrl(it);
  const inner=u?`<img src="${esc(u)}" alt="" loading="lazy" data-e="${e}" onerror="this.replaceWith(this.dataset.e)">`:e;
  return `<span class="thumb${cls?' '+cls:''}" aria-hidden="true">${inner}</span>`;
}
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,2600)}
function oops(e){console.error(e);toast('Something went wrong. Please try again.')}
function withTimeout(p,ms){return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))])}

/* ============================================================
   DATA LAYER: everything goes through rpc(name, args), which calls the database functions
   from supabase/migrate-004-brands.sql. Demo mode answers the same calls from sample data
   in this browser, using the same rules, so the screens can't tell the difference.
   ============================================================ */
const LIVE=!!(CONFIG.SUPABASE_URL&&CONFIG.SUPABASE_ANON_KEY&&window.supabase);
const sb=LIVE?window.supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_ANON_KEY,{auth:{flowType:'pkce'}}):null;
/* People are known only by their random user ID: TasteRank never shows or saves their Google name, email or photo */
const userFrom=s=>s?{id:s.user.id}:null;
const must=({data,error})=>{if(error)throw error;return data};

const liveApi={
  async session(){return userFrom(must(await sb.auth.getSession()).session)},
  async signIn(){must(await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}}))},
  async signOut(){await sb.auth.signOut()},
  async deleteAccount(){must(await sb.rpc('delete_me'));await sb.auth.signOut()},
  async rpc(name,args){return must(await sb.rpc(name,args||{}))}
};

/* ---------- Demo mode: the UK seed list plus one Japanese ranking, with sample ratings ---------- */
const OFF='https://images.openfoodfacts.org/images/products/';
const DEMO={
  settings:{approval_votes:5,rank_after_ratings:10,close_after_days:30,max_open_submissions:10,brand_card_variants:5,group_min_ratings:10},
  places:[
    {id:1,name:'United Kingdom',short_name:'UK',adjective:'British',code:'GB',flag:'🇬🇧',regions:['Scotland','Wales','Northern Ireland','North East','North West','Yorkshire & the Humber','East Midlands','West Midlands','East of England','London','South East','South West'].map((name,k)=>({id:101+k,name}))},
    {id:2,name:'United States',short_name:'US',adjective:'American',code:'US',flag:'🇺🇸',regions:[]},
    {id:3,name:'Australia',short_name:'Australia',adjective:'Australian',code:'AU',flag:'🇦🇺',regions:[]},
    {id:4,name:'Japan',short_name:'Japan',adjective:'Japanese',code:'JP',flag:'🇯🇵',regions:[]},
    {id:5,name:'China',short_name:'China',adjective:'Chinese',code:'CN',flag:'🇨🇳',regions:[]}],
  categories:[{id:1,name:'Chocolate'},{id:2,name:'Sweets'},{id:3,name:'Crisps & Snacks'}],
  products:[{id:1,category_id:1,name:'Chocolate bars',emoji:'🍫'},{id:2,category_id:2,name:'Toffee',emoji:'🍬'},{id:3,category_id:3,name:'Crisps',emoji:'🥔'}],
  variants:[{id:1,product_id:1,name:'Milk chocolate',title:'Milk chocolate bars'},{id:2,product_id:2,name:'Original',title:'Toffee'},
    {id:3,product_id:2,name:'Chocolate-covered',title:'Chocolate-covered toffee'},{id:4,product_id:3,name:'Salt & vinegar',title:'Salt & vinegar crisps'},
    {id:5,product_id:3,name:'Cheese & onion',title:'Cheese & onion crisps'},{id:6,product_id:3,name:'Ready salted',title:'Ready salted crisps'}],
  local:{'product:3:4':'Potato chips','variant:6:4':'Lightly salted (うすしお)','title:6:4':'Lightly salted potato chips (うすしお)'},
  /* r = sample ratings for faces [1,2,3,4,5]; demo numbers are allowed only here */
  items:[
    {id:1,c:1,p:1,v:1,b:'Cadbury',pack:'Cadbury Dairy Milk Chocolate Bar',img:OFF+'762/221/049/7383/front.7.400.jpg',r:[0,1,2,4,7]},
    {id:2,c:1,p:1,v:1,b:'KitKat',pack:'KitKat Finger Milk Chocolate Bar',r:[0,1,3,4,3]},
    {id:3,c:1,p:1,v:1,b:"Tony's Chocolonely",pack:"Tony's Chocolonely Milk Chocolate 32%",r:[0,0,1,3,4]},
    {id:4,c:1,p:2,v:2,b:"Werther's",pack:"Werther's Original",img:OFF+'401/440/091/8953/front_en.3.400.jpg',r:[0,1,2,2,1]},
    {id:5,c:1,p:2,v:2,b:'M&S',pack:'M&S Double Devon Toffees',r:[0,0,1,2,1]},
    {id:6,c:1,p:2,v:2,b:"Walker's Nonsuch",pack:"Walker's Nonsuch Original Creamy Toffee",r:[0,0,1,1,0]},
    {id:7,c:1,p:2,v:2,b:'Thorntons',pack:'Thorntons Special Toffee',img:OFF+'501/634/614/2729/front_en.5.400.jpg',r:[0,0,0,2,1]},
    {id:8,c:1,p:3,v:4,b:'Walkers',pack:'Walkers Salt & Vinegar Crisps',img:OFF+'57522241/front_en.12.400.jpg',r:[1,1,3,10,30]},
    {id:9,c:1,p:3,v:4,b:'Hula Hoops',pack:'Hula Hoops Salt & Vinegar',img:OFF+'500/023/713/9523/front_en.3.400.jpg',r:[1,2,5,10,6]},
    {id:10,c:1,p:3,v:4,b:'KETTLE',pack:'KETTLE Chips Sea Salt & Balsamic Vinegar of Modena',img:OFF+'501/776/443/0092/front_en.3.400.jpg',r:[1,1,3,8,20]},
    {id:11,c:1,p:3,v:4,b:"Jacob's",pack:"Jacob's Crinklys Salt & Vinegar 30% Less Fat",r:[0,1,2,2,1]},
    {id:12,c:1,p:3,v:4,b:'Pringles',pack:'Pringles Salt & Vinegar',img:OFF+'505/399/015/8362/front_en.3.400.jpg',r:[2,3,6,8,6]},
    {id:13,c:1,p:3,v:5,b:'Walkers',pack:'Walkers Cheese & Onion Crisps',img:OFF+'13917821/front_en.14.400.jpg',r:[0,0,1,3,4]},
    {id:14,c:1,p:3,v:5,b:'Golden Wonder',pack:'Golden Wonder Cheese & Onion Crisps',r:[0,0,1,2,2]},
    {id:15,c:1,p:3,v:5,b:'KETTLE',pack:'KETTLE Chips Mature Cheddar & Red Onion',img:OFF+'501/776/412/8142/front_en.11.400.jpg',r:[0,0,0,2,3]},
    {id:21,c:4,p:3,v:6,b:'Calbee',pack:'Calbee Potato Chips Usushio (うすしお味)',r:[0,1,1,5,6]},
    {id:22,c:4,p:3,v:6,b:'Pringles',pack:'Pringles Original',r:[0,0,2,2,1]},
    {id:901,c:1,p:3,v:4,b:'Tyrrells',pack:'Tyrrells Cider Vinegar & Sea Salt',r:[0,0,0,0,0],pending:true,approvals:3,days_left:21}
  ]
};
const DEMO_KEY='tasterank-demo-v3';
const demoState=()=>Object.assign({user:null,ratings:{},approvals:[],home:0},store.get(DEMO_KEY)||{});
const demoSave=d=>store.set(DEMO_KEY,d);
store.del('tasterank-demo-v2'); // demo data from the earlier foods version
const demoApi={
  async session(){return demoState().user},
  async signIn(){const d=demoState();d.user={id:'demo'};demoSave(d)},
  async signOut(){const d=demoState();d.user=null;demoSave(d)},
  async deleteAccount(){store.del(DEMO_KEY)},
  async rpc(name,args){const f=DEMO_RPC[name];if(!f)throw new Error('Demo mode has no '+name);return f(args||{},demoState())}
};
/* The same rules as the database functions, worked out from the sample data */
const D={
  brandId:name=>[...new Set(DEMO.items.map(i=>i.b))].indexOf(name)+1,
  local:(kind,id,c)=>DEMO.local[`${kind}:${id}:${c}`],
  product:(id,c)=>D.local('product',id,c)||DEMO.products.find(p=>p.id===id).name,
  variant:(id,c)=>D.local('variant',id,c)||DEMO.variants.find(v=>v.id===id).name,
  title:(id,c)=>D.local('title',id,c)||DEMO.variants.find(v=>v.id===id).title,
  approvals:(it,st)=>it.approvals+(st.approvals.includes(it.id)?1:0),
  live:(it,st)=>!it.pending||D.approvals(it,st)>=DEMO.settings.approval_votes,
  totals(c,st){
    return DEMO.items.filter(i=>i.c===c&&D.live(i,st)).map(i=>{
      const r=[...i.r],mine=st.user?st.ratings[i.id]:null;if(mine)r[mine-1]++;
      const total=r.reduce((a,b)=>a+b,0);
      return {id:i.id,product_id:i.p,variant_id:i.v,brand_id:D.brandId(i.b),brand:i.b,pack_name:i.pack,image_url:i.img||null,image_path:null,
        emoji:DEMO.products.find(p=>p.id===i.p).emoji,r1:r[0],r2:r[1],r3:r[2],r4:r[3],r5:r[4],total,
        avg:total?Math.round(r.reduce((s,n,k)=>s+n*(k+1),0)/total*100)/100:null,ranked:total>=DEMO.settings.rank_after_ratings,my_score:mine||null};
    });
  },
  order:(a,b)=>(b.ranked-a.ranked)||(a.ranked?b.avg-a.avg:0)||b.total-a.total||a.id-b.id
};
const DEMO_RPC={
  app_settings:()=>DEMO.settings,
  place_list:()=>DEMO.places,
  home_rankings({p_country},st){
    const t=D.totals(p_country,st);
    return DEMO.variants.filter(v=>t.some(x=>x.variant_id===v.id)).map(v=>{
      const mine=t.filter(x=>x.variant_id===v.id),p=DEMO.products.find(p=>p.id===v.product_id),ranked=mine.filter(x=>x.ranked).sort(D.order)[0];
      return {product_id:p.id,variant_id:v.id,title:D.title(v.id,p_country),category_id:p.category_id,category:DEMO.categories.find(c=>c.id===p.category_id).name,
        brands:mine.length,ratings:mine.reduce((s,x)=>s+x.total,0),top:ranked?{item_id:ranked.id,brand:ranked.brand,pack_name:ranked.pack_name,avg:ranked.avg,ratings:ranked.total}:null,
        photos:mine.sort((a,b)=>b.total-a.total).slice(0,3).map(x=>({image_url:x.image_url,image_path:null,emoji:x.emoji}))};
    }).sort((a,b)=>b.ratings-a.ratings||a.product_id-b.product_id||a.variant_id-b.variant_id);
  },
  brand_cards:()=>[],
  ranking({p_product,p_variant,p_country},st){
    const t=D.totals(p_country,st),pl=DEMO.places.find(x=>x.id===p_country),p=DEMO.products.find(x=>x.id===p_product);
    return {title:D.title(p_variant,p_country),category:DEMO.categories.find(c=>c.id===p.category_id).name,product:D.product(p_product,p_country),
      variant:D.variant(p_variant,p_country),country:{id:pl.id,name:pl.name,short_name:pl.short_name,flag:pl.flag},
      variants:DEMO.variants.filter(v=>v.product_id===p_product&&t.some(x=>x.variant_id===v.id)).map(v=>({id:v.id,name:D.variant(v.id,p_country),title:D.title(v.id,p_country)})),
      items:t.filter(x=>x.product_id===p_product&&x.variant_id===p_variant).map(x=>({...x,brand_variants:t.filter(y=>y.brand_id===x.brand_id&&y.product_id===p_product).length})).sort(D.order),
      pending:DEMO.items.filter(i=>i.pending&&!D.live(i,st)&&i.c===p_country&&i.p===p_product&&i.v===p_variant).map(i=>({id:i.id,brand:i.b,pack_name:i.pack,image_url:i.img||null,image_path:null,
        emoji:p.emoji,approvals:D.approvals(i,st),approved:st.approvals.includes(i.id),mine:false,days_left:i.days_left}))};
  },
  brand_view({p_brand,p_product,p_country},st){
    const t=D.totals(p_country,st).filter(x=>x.product_id===p_product),pl=DEMO.places.find(x=>x.id===p_country);
    const items=t.filter(x=>x.brand_id===p_brand).map(x=>{
      const peers=t.filter(y=>y.variant_id===x.variant_id),ranked=peers.filter(y=>y.ranked).sort(D.order);
      return {...x,variant:D.variant(x.variant_id,p_country),ranking_title:D.title(x.variant_id,p_country),place_in_ranking:x.ranked?ranked.findIndex(y=>y.id===x.id)+1:null,ranking_size:peers.length};
    }).sort(D.order);
    return {brand:DEMO.items.find(i=>D.brandId(i.b)===p_brand).b,product:D.product(p_product,p_country),country:{id:pl.id,short_name:pl.short_name,flag:pl.flag},items};
  },
  next_to_rate({p_item,p_from_brand_view},st){
    const it=DEMO.items.find(i=>i.id===p_item);if(!it)return {kind:'done'};
    const t=D.totals(it.c,st),unrated=t.filter(x=>!x.my_score&&x.id!==p_item);
    const same=unrated.filter(x=>x.product_id===it.p&&x.variant_id===it.v).sort((a,b)=>(b.total<10)-(a.total<10)||a.total-b.total||a.id-b.id)[0];
    const brand=unrated.filter(x=>x.product_id===it.p&&x.brand_id===D.brandId(it.b)&&x.variant_id!==it.v).sort((a,b)=>a.total-b.total||a.id-b.id)[0];
    const asItem=(x,label)=>x&&{kind:'item',id:x.id,short_label:label};
    const order=p_from_brand_view?[asItem(brand,brand&&D.variant(brand.variant_id,it.c)),asItem(same,same&&same.brand)]:[asItem(same,same&&same.brand),asItem(brand,brand&&D.variant(brand.variant_id,it.c))];
    const first=order.find(Boolean);if(first)return first;
    const cat=DEMO.products.find(p=>p.id===it.p).category_id;
    const near=unrated.filter(x=>!(x.product_id===it.p&&x.variant_id===it.v)&&DEMO.products.find(p=>p.id===x.product_id).category_id===cat)
      .sort((a,b)=>(b.product_id===it.p)-(a.product_id===it.p)||a.product_id-b.product_id||a.variant_id-b.variant_id)[0];
    return near?{kind:'ranking',product_id:near.product_id,variant_id:near.variant_id,title:D.title(near.variant_id,it.c)}:{kind:'done'};
  },
  rate_item({p_item,p_score},st){st.ratings[p_item]=p_score;demoSave(st);return Object.keys(st.ratings).length},
  approve_item({p_item},st){
    const it=DEMO.items.find(i=>i.id===p_item);
    if(!st.approvals.includes(p_item)){st.approvals.push(p_item);demoSave(st)}
    return {approvals:D.approvals(it,st),status:D.live(it,st)?'live':'pending'};
  },
  my_profile(_,st){return st.user?{taster_id:'#DEMO00',home_place:{id:0,level:'unknown',name:'Unknown'},rated:Object.keys(st.ratings).length,
    rankings_helped:new Set(Object.keys(st.ratings).map(id=>{const i=DEMO.items.find(x=>x.id==id);return i&&`${i.p}-${i.v}-${i.c}`})).size}:null},
  my_ratings(_,st){return Object.entries(st.ratings).map(([id,score])=>{const i=DEMO.items.find(x=>x.id==id);if(!i)return null;
    const pl=DEMO.places.find(p=>p.id===i.c);return {item_id:i.id,pack_name:i.pack,brand:i.b,product_id:i.p,variant_id:i.v,country_id:i.c,flag:pl.flag,
      ranking_title:D.title(i.v,i.c),score,image_url:i.img||null,image_path:null,emoji:DEMO.products.find(p=>p.id===i.p).emoji}}).filter(Boolean)},
  my_rating_count(_,st){return Object.keys(st.ratings).length}
};
const api=LIVE?liveApi:demoApi;
const rpc=(name,args)=>api.rpc(name,args);

/* ---------- App state ---------- */
let me=null, profile=null, places=[], settings=DEMO.settings, detected=null;
let view='home', page=null, sheet=null, currentUrl=location.href;
const prefs=Object.assign({country:null,cat:'all'},store.get('tasterank-prefs-v2')||{});
const savePrefs=()=>store.set('tasterank-prefs-v2',prefs);
['tasterank-prefs','tasterank-proto-v1'].forEach(k=>store.del(k)); // settings from earlier versions
const placeBy=(key,val)=>places.find(p=>String(p[key]).toLowerCase()===String(val).toLowerCase());

/* ---------- Visitor statistics (GoatCounter) ---------- */
let lastTracked=null;
function track(path,event){
  try{
    if(!window.goatcounter||!window.goatcounter.count)return;
    if(!event){if(path===lastTracked)return;lastTracked=path}
    window.goatcounter.count({path,event:!!event});
  }catch(e){}
}
const pagePath=()=>'/'+(location.hash.replace(/^#\/?/,'')||'');
if(CONFIG.GOATCOUNTER_CODE){
  window.goatcounter={no_onload:true};
  const s=document.createElement('script');
  s.async=true;s.src='https://gc.zgo.at/count.js';
  s.dataset.goatcounter=`https://${CONFIG.GOATCOUNTER_CODE}.goatcounter.com/count`;
  s.onload=()=>track(pagePath());
  document.head.appendChild(s);
}

/* ---------- Pop-ups: focus moves inside, Tab stays inside, Esc and the Back button close them ---------- */
let openId=null, lastFocus=null;
function openM(id){
  if(openId&&openId!==id)$('#'+openId).hidden=true;
  else if(!openId)lastFocus=document.activeElement;
  openId=id;
  const m=$('#'+id);m.hidden=false;
  const first=m.querySelector('.face-btn,input:not([type=checkbox]),textarea,select,.btn-primary,button:not(.x)');
  (first||m.querySelector('button')).focus();
}
function closeM(){
  if(!openId)return;
  $('#'+openId).hidden=true;openId=null;sheet=null;
  if(lastFocus&&document.contains(lastFocus))lastFocus.focus();
  lastFocus=null;
}
document.querySelectorAll('.modal-bg').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeM()}));
document.addEventListener('keydown',e=>{
  if(!openId)return;
  if(e.key==='Escape')return closeM();
  if(e.key!=='Tab')return;
  const els=[...$('#'+openId).querySelectorAll('button,input:not([tabindex="-1"]),select,textarea,a[href]')].filter(el=>!el.disabled&&el.offsetParent!==null);
  if(!els.length)return;
  const first=els[0],last=els[els.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});

/* ---------- Navigation: #/ home · #/r/gb/3/4 ranking · #/b/gb/12/3 brand view · #/me profile ---------- */
const VIEWS=['home','ranking','brand','profile'];
function parseHash(){
  let m;
  if((m=location.hash.match(/^#\/r\/([a-z]{2})\/(\d+)\/(\d+)$/i)))return {v:'ranking',cc:m[1],product:+m[2],variant:+m[3]};
  if((m=location.hash.match(/^#\/b\/([a-z]{2})\/(\d+)\/(\d+)$/i)))return {v:'brand',cc:m[1],brand:+m[2],product:+m[3]};
  if(location.hash==='#/me')return {v:'profile'};
  return {v:'home'}; // includes old #/item/5 links: those foods aren't in the new structure
}
const hashFor=r=>r.v==='ranking'?`#/r/${r.cc.toLowerCase()}/${r.product}/${r.variant}`:r.v==='brand'?`#/b/${r.cc.toLowerCase()}/${r.brand}/${r.product}`:r.v==='profile'?'#/me':'';
async function show(r){
  view=r.v;
  VIEWS.forEach(x=>$('#v-'+x).hidden=x!==r.v);
  setFab();
  if(r.v==='home')await renderHome();
  if(r.v==='ranking')await renderRanking(r);
  if(r.v==='brand')await renderBrand(r);
  if(r.v==='profile')await renderProfile();
  currentUrl=location.href;
  track(pagePath());
}
function go(r){
  const h=hashFor(r);
  if(location.hash!==h)history.pushState(null,'',h||location.pathname);
  window.scrollTo(0,0);return show(r);
}
const route=()=>{const r=parseHash();if(r.v==='profile'&&!me)r.v='home';return show(r)};
window.addEventListener('popstate',()=>{
  if(openId){closeM();history.pushState(null,'',currentUrl);return} // Back closes the pop-up instead of leaving the page
  route();
});
const refresh=()=>show(view==='home'?{v:'home'}:parseHash());

/* ---------- Clicks: every button says what it does with data-act ---------- */
const ACT={
  home:()=>go({v:'home'}),
  me:()=>needUser({name:'profile'}),
  cat:d=>{prefs.cat=d.cat;savePrefs();renderHomeCards()},
  ranking:d=>go({v:'ranking',cc:d.cc,product:+d.product,variant:+d.variant}),
  brand:d=>go({v:'brand',cc:d.cc,brand:+d.brand,product:+d.product}),
  rate:d=>needUser({name:'rate',item:+d.id,from:view}),
  face:d=>saveRating(+d.v),
  'edit-rating':()=>{sheet.editing=true;renderSheet()},
  next:nextStep,
  'sheet-second':sheetSecond,
  approve:d=>needUser({name:'approve',item:+d.id}),
  'share-ranking':()=>page&&share(`Which ${page.title.toLowerCase()} wins? Vote on TasteRank`),
  share:()=>share(),
  add:openAdd,
  close:closeM,
  'sign-in':signIn,
  'sign-out':signOut,
  'delete-account':deleteAccount,
  'reset-demo':resetDemo,
  feedback:()=>{showSettings(false);track('feedback-open',true);openM('m-feedback')},
  privacy:()=>{showSettings(false);openM('m-privacy')},
  about:()=>{showSettings(false);toast('About Crispy is coming soon')},
  settings:()=>showSettings($('#settings-pop').hidden),
  'set-theme':d=>setTheme(d.theme)
};
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');
  if(!el||el.disabled)return;
  const f=ACT[el.dataset.act];if(!f)return;
  e.preventDefault();f(el.dataset);
});
$('#country').addEventListener('change',e=>{prefs.country=e.target.value;prefs.cat='all';savePrefs();renderHome()});
$('#f-feedback').addEventListener('submit',sendFeedback);

/* ---------- Sign-in: some actions need an account; we come back to them afterwards ---------- */
const AFTER={
  profile:()=>go({v:'profile'}),
  rate:a=>openRate(a.item,a.from),
  approve:a=>doApprove(a.item)
};
function needUser(a){
  if(me)return AFTER[a.name](a);
  store.set('tasterank-after',{...a,hash:location.hash},true); // survives the trip to Google and back
  openM('m-signin');
}
async function signIn(){
  track('sign-in',true);
  try{await api.signIn()}catch(e){return oops(e)}
  if(!LIVE)await afterSignIn(); // live mode leaves for Google and comes back to start()
}
async function afterSignIn(){
  me=await api.session();
  const next=store.get('tasterank-after',true);store.del('tasterank-after',true);
  closeM();
  if(me)await loadProfile();
  renderHeader();
  if(next&&next.hash&&next.hash!==location.hash)history.replaceState(null,'',next.hash);
  await route();
  if(me&&next&&AFTER[next.name])AFTER[next.name](next);
}
async function loadProfile(){try{profile=me?await rpc('my_profile'):null}catch(e){profile=null}}
function renderHeader(){
  const b=$('#me-btn');
  b.innerHTML=me?'👤<span class="hide-sm">Profile</span>':'Sign in';
  b.classList.toggle('me',!!me);
  if(me)b.setAttribute('aria-label','Profile');else b.removeAttribute('aria-label');
}

/* ---------- The floating + (adding arrives in the next update) ---------- */
function setFab(){
  const f=$('#add-fab');
  f.hidden=view==='profile';
  f.setAttribute('aria-label',view==='ranking'&&page?`Add a brand to ${page.title}`:'Add a snack');
}
function openAdd(){
  track('add-open',true);
  $('#soon-text').textContent=view==='ranking'&&page
    ?`Soon you'll be able to add a brand to ${page.title} here. For now, tell us what's missing with Send feedback in the menu.`
    :'For now, rate the ones already here. Missing a brand? Tell us with Send feedback in the menu.';
  openM('m-soon');
}

/* ---------- Starting country: last choice, else where you are (from your internet address), else UK ---------- */
async function detectCountry(){
  try{const r=await withTimeout(fetch('https://api.country.is/'),1500);detected=(await r.json()).country||null}catch(e){}
  if(!detected){const m=(navigator.language||'').match(/-([A-Za-z]{2})$/);detected=m?m[1].toUpperCase():null}
}
const homeCountry=()=>placeBy('code',prefs.country)||placeBy('code',detected)||placeBy('code',DEFAULT_COUNTRY)||places[0];

/* ---------- Home ---------- */
let homeData=null;
async function renderHome(){
  const c=homeCountry();
  $('#country').innerHTML=places.map(p=>`<option value="${esc(p.code)}"${p===c?' selected':''}>${p.flag} ${esc(p.name)}</option>`).join('');
  $('#bubble').hidden=!!(profile&&profile.rated>=BUBBLE_UNTIL);
  if(!homeData||homeData.country!==c.id){
    $('#cards').innerHTML='<div class="card empty">Loading…</div>';
    try{homeData={country:c.id,rankings:await rpc('home_rankings',{p_country:c.id}),brands:await rpc('brand_cards',{p_country:c.id})}}
    catch(e){console.error(e);$('#cards').innerHTML='<div class="card empty">Couldn\'t load snacks. Check your connection and refresh.</div>';return}
  }
  renderHomeCards();
}
function renderHomeCards(){
  if(!homeData)return;
  const c=places.find(p=>p.id===homeData.country);
  const cats=[...new Map(homeData.rankings.map(r=>[r.category_id,r.category])).entries()].sort((a,b)=>a[0]-b[0]);
  if(prefs.cat!=='all'&&!cats.some(([id])=>String(id)===String(prefs.cat)))prefs.cat='all';
  $('#cats').innerHTML=[['all','All'],...cats].map(([id,name])=>`<button class="chip${String(id)===String(prefs.cat)?' on':''}" data-act="cat" data-cat="${id}" aria-pressed="${String(id)===String(prefs.cat)}">${esc(name)}</button>`).join('');
  const list=homeData.rankings.filter(r=>prefs.cat==='all'||String(r.category_id)===String(prefs.cat));
  const need=settings.rank_after_ratings;
  const cards=list.map(r=>`<button class="rcard" data-act="ranking" data-cc="${c.code}" data-product="${r.product_id}" data-variant="${r.variant_id}">
      <span class="stack">${r.photos.map(p=>thumb(p,'sm')).join('')}</span>
      <span class="rinfo"><span class="rk-title">${esc(r.title)}</span>
        <span class="meta">${prefs.cat==='all'?esc(r.category)+' · ':''}${plural(r.brands,'brand')}${r.ratings?' · '+plural(r.ratings,'rating'):''}</span>
        ${r.top?`<span class="top1"><span class="badge">#1</span><span class="fl">${esc(r.top.brand)}</span><span class="score">${faceFor(r.top.avg).e} ${score1(r.top.avg)}</span></span>`
          :`<span class="nowin"><b>No winner yet</b> · each brand needs ${need} ratings</span>`}</span>
    </button>`).join('');
  const brands=homeData.brands.filter(()=>prefs.cat==='all').map(b=>`<button class="rcard" data-act="brand" data-cc="${c.code}" data-brand="${b.brand_id}" data-product="${b.product_id}">
      <span class="stack"><span class="thumb sm" aria-hidden="true">⭐</span></span>
      <span class="rinfo"><span class="rk-title">${esc(b.brand)} ${esc(c.short_name)}</span><span class="meta">Brand view · ${plural(b.variants,'variant')}</span></span></button>`).join('');
  $('#cards').innerHTML=cards+brands||`<div class="card empty">No snacks here yet. Know one? Tap + to suggest it.</div>`;
}

/* ---------- Ranking page ---------- */
async function renderRanking(r){
  const c=placeBy('code',r.cc);if(!c)return go({v:'home'});
  const el=$('#v-ranking');
  if(!page||page.key!==hashFor(r))el.innerHTML='<div class="card empty">Loading…</div>';
  let d;try{d=await rpc('ranking',{p_product:r.product,p_variant:r.variant,p_country:c.id})}catch(e){oops(e);return}
  if(!d)return go({v:'home'});
  page={...d,key:hashFor(r),kind:'ranking',route:r,cc:c.code};
  setFab();
  track('open-ranking',true);
  const need=settings.rank_after_ratings,ranked=d.items.filter(i=>i.ranked),win=ranked[0];
  const rows=d.items.map((it,k)=>{
    const rank=it.ranked?k+1:'–',me_=it.my_score?FACES.find(f=>f.v===it.my_score):null;
    const pct=it.ranked?Math.round(it.avg/5*100):Math.min(100,Math.round(it.total/need*100));
    return `<button class="ir${it.ranked&&k<3?' top3':''}${it.ranked?'':' unranked'}" data-act="rate" data-id="${it.id}">
      <span class="rk">${rank}</span>${thumb(it,'sm')}
      <span class="in"><span class="bn">${esc(it.brand)}${me_?` <span class="mine">· You ${me_.e}</span>`:''}</span><span class="pk">${esc(it.pack_name)}</span>
        <span class="track"><span class="fill" style="width:${pct}%"></span></span></span>
      <span class="sc">${it.ranked?`${faceFor(it.avg).e} ${score1(it.avg)}<small>${fmt(it.total)}</small>`:`<span class="nr">${it.total} of ${need}<small>ratings</small></span>`}</span>
    </button>`}).join('');
  const total=d.items.reduce((s,i)=>s+i.total,0);
  el.innerHTML=`
    <button class="crumb" data-act="home">← ${esc(d.country.short_name)} <span>· ${esc(d.category)} › ${esc(d.product)}</span></button>
    <h1 class="page-title">${esc(d.title)}</h1>
    <div class="meta">${d.country.flag} ${esc(d.country.name)} · ${plural(d.items.length,'brand')}${total?' · '+plural(total,'rating'):''}</div>
    ${d.variants.length>1?`<div class="chips vch" role="group" aria-label="Variant"><span class="vlab">Variant</span>${d.variants.map(v=>`<button class="chip${v.id===r.variant?' on':''}" aria-pressed="${v.id===r.variant}" data-act="ranking" data-cc="${c.code}" data-product="${r.product}" data-variant="${v.id}">${esc(v.name)}</button>`).join('')}</div>`:''}
    ${win?`<div class="winner"><span class="lbl">The winner so far</span>
      <span class="row"><span class="face">${faceFor(win.avg).e}</span><span class="nm">${esc(win.brand)}</span><span class="num">${score1(win.avg)}</span></span>
      <span class="cnt">${esc(win.pack_name)} · ${plural(win.total,'rating')} · ${Math.round(win.r5/win.total*100)}% love it</span></div>`
      :`<div class="early"><b>No winner yet</b>Each brand needs ${need} ratings before it's ranked. Know one? Your rating moves it closer.</div>`}
    ${d.items.length?`<div class="list">${rows}</div>`:''}
    ${d.items.length<3?`<div class="alert"><b>Only ${d.items.length===1?'one':'two'} so far</b><span>Know another ${esc(d.title.toLowerCase())} sold in ${esc(d.country.name)}? Tap + to add it. It goes live once ${settings.approval_votes} people approve.</span></div>`:''}
    ${d.pending.length?`<h2>Waiting for approval</h2><div class="pend-list">${d.pending.map(pendCard).join('')}</div>`:''}
    <button class="btn share-btn" data-act="share-ranking">Share this ranking</button>`;
}
function pendCard(p){
  const n=settings.approval_votes,w=Math.min(100,Math.round(p.approvals/n*100));
  return `<div class="pend${p.mine?' mine':''}">${thumb(p,'sm')}
    <div class="in"><div class="bn">${esc(p.brand)}${p.mine?' <span class="mine">· added by you</span>':''}</div><div class="pk">${esc(p.pack_name)}</div>
      <div class="meta">${p.approvals} of ${n} approvals${p.mine?` · closes in ${p.days_left} days`:''}</div><div class="prog"><i style="width:${w}%"></i></div></div>
    ${p.mine?'<button class="btn" data-act="share-ranking">Share</button>'
      :p.approved?'<button class="btn" disabled>Approved ✓</button>':`<button class="btn btn-primary" data-act="approve" data-id="${p.id}">Approve</button>`}
  </div>`;
}
async function doApprove(id){
  try{const r=await rpc('approve_item',{p_item:id});track('approve-item',true);
    toast(r.status==='live'?'🎉 It\'s live!':`Thanks! ${r.approvals} of ${settings.approval_votes} approvals`)}catch(e){return oops(e)}
  homeData=null;refresh();
}

/* ---------- Brand view ---------- */
async function renderBrand(r){
  const c=placeBy('code',r.cc);if(!c)return go({v:'home'});
  const el=$('#v-brand');
  if(!page||page.key!==hashFor(r))el.innerHTML='<div class="card empty">Loading…</div>';
  let d;try{d=await rpc('brand_view',{p_brand:r.brand,p_product:r.product,p_country:c.id})}catch(e){oops(e);return}
  if(!d||!d.items.length)return go({v:'home'});
  page={...d,key:hashFor(r),kind:'brand',route:r,cc:c.code,title:`${d.brand} ${d.product.toLowerCase()}`};
  setFab();
  track('open-brand-view',true);
  const need=settings.rank_after_ratings,best=d.items.find(i=>i.ranked);
  const back=sheetBack;
  el.innerHTML=`
    <button class="crumb" data-act="${back?'ranking':'home'}"${back?` data-cc="${back.cc}" data-product="${back.product}" data-variant="${back.variant}"`:''}>← ${esc(back?back.title:d.country.short_name)}</button>
    <h1 class="page-title">${esc(d.brand)} ${esc(d.product.toLowerCase())}: which one wins?</h1>
    <div class="meta">${d.country.flag} ${esc(d.country.short_name)} · ${plural(d.items.length,'variant')} · ${plural(d.items.reduce((s,i)=>s+i.total,0),'rating')}</div>
    ${best?`<div class="winner"><span class="lbl">${esc(d.brand)}'s best so far</span>
      <span class="row"><span class="face">${faceFor(best.avg).e}</span><span class="nm">${esc(best.variant)}</span><span class="num">${score1(best.avg)}</span></span>
      <span class="cnt">${esc(best.pack_name)} · ${plural(best.total,'rating')}</span></div>`
      :`<div class="early"><b>No winner yet</b>Each needs ${need} ratings before it's ranked.</div>`}
    <div class="list">${d.items.map((it,k)=>{const me_=it.my_score?FACES.find(f=>f.v===it.my_score):null;
      return `<button class="ir${it.ranked&&k<3?' top3':''}${it.ranked?'':' unranked'}" data-act="rate" data-id="${it.id}">
        <span class="rk">${it.ranked?k+1:'–'}</span>${thumb(it,'sm')}
        <span class="in"><span class="bn">${esc(it.variant)}${me_?` <span class="mine">· You ${me_.e}</span>`:''}</span>
          <span class="pk">${it.place_in_ranking?`#${it.place_in_ranking} of ${it.ranking_size} ${esc(it.ranking_title.toLowerCase())}`:`Not ranked yet · ${it.total} of ${need} ratings`}</span>
          <span class="track"><span class="fill" style="width:${it.ranked?Math.round(it.avg/5*100):Math.min(100,Math.round(it.total/need*100))}%"></span></span></span>
        <span class="sc">${it.ranked?`${faceFor(it.avg).e} ${score1(it.avg)}<small>${fmt(it.total)}</small>`:`<span class="nr">${it.total} of ${need}<small>ratings</small></span>`}</span>
      </button>`}).join('')}</div>`;
}
let sheetBack=null; // the ranking the brand view was opened from, for its back link

/* ---------- Rating sheet: tapping a face saves straight away; "Next" suggests what to rate next ---------- */
function itemFromPage(id){
  if(!page)return null;
  const it=page.items.find(i=>i.id===id);if(!it)return null;
  if(page.kind==='ranking')return {...it,product_id:page.route.product,variant_id:page.route.variant,title:page.title,cc:page.cc,country:page.country};
  return {...it,brand:page.brand,brand_id:page.route.brand,product_id:page.route.product,title:it.ranking_title,cc:page.cc,country:page.country,brand_variants:page.items.length};
}
async function openRate(id,from){
  let it=itemFromPage(id);
  if(!it)return;
  sheet={it,from:from==='brand'?'brand':'ranking',editing:!it.my_score,next:null};
  if(it.my_score)loadNext();
  renderSheet();openM('m-rate');
}
function renderSheet(){
  if(!sheet)return;
  const it=sheet.it,home=profile&&profile.home_place,homeCountryId=home&&(home.country_id||null);
  $('#rate-thumb').outerHTML=thumb(it).replace('class="thumb"','class="thumb" id="rate-thumb"');
  // country first, then the ranking, then the brand: "🇬🇧 UK · Milk chocolate bars · Cadbury"
  $('#rate-meta').innerHTML=`${it.country.flag} ${esc(it.country.short_name)} · ${esc(it.title)} · ${esc(it.brand)}${homeCountryId&&homeCountryId!==it.country.id?` <span class="ver">${esc(placeBy('id',it.country.id)?.adjective||it.country.short_name)} version</span>`:''}`;
  $('#rate-title').textContent=it.pack_name;
  const body=$('#rate-body');
  if(sheet.editing){
    body.innerHTML=`<div class="faces">${FACES.map(f=>`<button class="face-btn${it.my_score===f.v?' on':''}" data-act="face" data-v="${f.v}" aria-pressed="${it.my_score===f.v}"><span aria-hidden="true">${f.e}</span>${f.l}</button>`).join('')}</div>
      <div class="help">Tap a face. It saves straight away.</div>`;
    return;
  }
  const f=FACES.find(x=>x.v===it.my_score),n=sheet.next;
  const second=sheet.from==='brand'?`Back to ${page.title}`:(it.brand_variants>=2?`See every ${it.brand} variant`:`Back to ${it.title}`);
  let main='';
  if(!n)main='<button class="btn btn-primary btn-block" disabled>Finding what\'s next…</button>';
  else if(n.kind==='done')main=`<div class="crispy-done"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-joy"/></svg><div><b>You've rated them all!</b><div class="meta">Know one we're missing? Add it and I'll put it to the vote.</div></div></div>
      <button class="btn btn-primary btn-block" data-act="close">Back to ${esc(page.kind==='brand'?page.title:it.title)}</button>
      <button class="btn btn-block" data-act="add">＋ Add one we're missing</button>
      ${sheet.from!=='brand'&&it.brand_variants>=2?`<button class="btn btn-block" data-act="sheet-second">See every ${esc(it.brand)} variant</button>`:''}`;
  else{
    const label=n.kind==='item'?n.short_label:n.title, text=`Next: ${label} →`;
    main=`${n.kind==='ranking'?`<div class="done-line">That's every ${esc(it.title.toLowerCase())} here rated. 🎉</div>`:''}<button class="btn btn-primary btn-block" data-act="next">${esc(text.length>32?'Rate the next one →':text)}</button>`;
  }
  body.innerHTML=`<div class="saved"><span>✓ Saved · You rated <b>${f.e} ${f.l}</b></span><button class="link" data-act="edit-rating">Edit</button></div>
    ${main}${n&&n.kind==='done'?'':`<button class="btn btn-block" data-act="sheet-second">${esc(second)}</button>`}`;
  // keep keyboard focus inside the sheet when its buttons are replaced
  if(!$('#m-rate').contains(document.activeElement)||document.activeElement===document.body)($('#rate-body .btn-primary:not([disabled])')||$('#rate-body [data-act="edit-rating"]')).focus();
}
async function loadNext(){
  const id=sheet.it.id;
  try{const n=await rpc('next_to_rate',{p_item:id,p_from_brand_view:sheet.from==='brand'});if(sheet&&sheet.it.id===id){sheet.next=n;renderSheet()}}
  catch(e){console.error(e);if(sheet){sheet.next={kind:'done'};renderSheet()}}
}
async function saveRating(v){
  if(!sheet||!me)return;
  const it=sheet.it,first=!it.my_score;
  try{const n=await rpc('rate_item',{p_item:it.id,p_score:v});if(profile)profile.rated=n}catch(e){return oops(e)}
  track('rate-item',true);
  it.my_score=v;sheet.editing=false;sheet.next=null;renderSheet();
  homeData=null;
  await refresh();                      // the page behind updates its counts, "You" tag and winner
  const fresh=itemFromPage(it.id);if(fresh&&sheet&&sheet.it.id===it.id)sheet.it={...fresh,my_score:v};
  if(sheet)await loadNext();
  if(first&&!profile&&me)await loadProfile();
}
async function nextStep(){
  const n=sheet&&sheet.next;if(!n)return;
  if(n.kind==='ranking'){track('next-ranking',true);const cc=sheet.it.cc;closeM();return go({v:'ranking',cc,product:n.product_id,variant:n.variant_id})}
  track('next-item',true);
  let it=itemFromPage(n.id);
  if(!it){ // it's in another ranking: move the page behind there too, so "Back" and the counts match the sheet
    it=await findItem(n.id,sheet.it);
    if(!it)return closeM();
    const from=sheet.from;
    await go({v:'ranking',cc:it.cc,product:it.product_id,variant:it.variant_id});
    it=itemFromPage(n.id)||it;
    if(!sheet)sheet={from};
  }
  sheet={it,from:sheet.from,editing:!it.my_score,next:null};
  if(it.my_score)loadNext();
  renderSheet();$('#m-rate .face-btn')?.focus();
}
/* The next item may be in another ranking (a brand's other variant, or the ranking of an item reached that way):
   look in the current item's ranking, then in its brand view. */
async function findItem(id,cur){
  try{
    const r=await rpc('ranking',{p_product:cur.product_id,p_variant:cur.variant_id,p_country:cur.country.id});
    const x=r&&r.items.find(i=>i.id===id);
    if(x)return {...x,product_id:cur.product_id,variant_id:cur.variant_id,title:r.title,cc:cur.cc,country:cur.country};
    const bv=await rpc('brand_view',{p_brand:cur.brand_id,p_product:cur.product_id,p_country:cur.country.id});
    const y=bv.items.find(i=>i.id===id);
    if(y)return {...y,brand:bv.brand,brand_id:cur.brand_id,product_id:cur.product_id,title:y.ranking_title,cc:cur.cc,country:cur.country,brand_variants:bv.items.length};
  }catch(e){oops(e)}
  return null;
}
function sheetSecond(){
  const it=sheet&&sheet.it;if(!it)return closeM();
  if(sheet.from!=='brand'&&it.brand_variants>=2){
    sheetBack={cc:it.cc,product:it.product_id,variant:it.variant_id||page.route.variant,title:it.title};
    closeM();return go({v:'brand',cc:it.cc,brand:it.brand_id,product:it.product_id});
  }
  closeM();
}

/* ---------- Feedback ---------- */
async function sendFeedback(e){
  e.preventDefault();
  const message=$('#fb-msg').value.trim();if(!message)return;
  const btn=e.target.querySelector('[type=submit]');btn.disabled=true;
  try{
    const r=await fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({access_key:CONFIG.WEB3FORMS_KEY,subject:'TasteRank feedback',from_name:'TasteRank',
        message,email:$('#fb-email').value.trim()||undefined,page:location.href,
        signed_in:me?'yes':'no',botcheck:$('#fb-bot').checked})});
    const j=await r.json();if(!j.success)throw new Error(j.message||'Feedback not sent');
  }catch(err){btn.disabled=false;return oops(err)}
  btn.disabled=false;track('feedback-sent',true);
  e.target.reset();closeM();toast('Thank you! Your feedback has been sent.');
}

/* ---------- Profile ---------- */
async function renderProfile(){
  if(!me)return go({v:'home'});
  const el=$('#v-profile');
  let mine=[];try{await loadProfile();mine=await rpc('my_ratings')}catch(e){oops(e)}
  const p=profile||{taster_id:'',rated:0,rankings_helped:0};
  el.innerHTML=`
    <button class="crumb" data-act="home">← Back</button>
    <div class="card profile">
      <div class="p-head"><span class="thumb big" aria-hidden="true">😋</span><div><h1 class="page-title">Your profile</h1><div class="meta">Taster ID ${esc(p.taster_id)}</div></div></div>
      <div class="stats">
        <div class="stat"><b>${fmt(p.rated)}</b><span>snacks rated</span></div>
        <div class="stat"><b>${fmt(p.rankings_helped)}</b><span>rankings helped</span></div>
      </div>
      <button class="btn" data-act="share">Share TasteRank</button>
    </div>
    <h2>Your ratings</h2>
    ${mine.length?`<div class="list">${mine.map(r=>{const f=FACES.find(x=>x.v===r.score),cc=placeBy('id',r.country_id)?.code||DEFAULT_COUNTRY;
      return `<button class="ir" data-act="ranking" data-cc="${cc}" data-product="${r.product_id}" data-variant="${r.variant_id}">
        <span class="rk" aria-label="${f.l}">${f.e}</span>${thumb(r,'sm')}
        <span class="in"><span class="bn">${esc(r.pack_name)}</span><span class="pk">${esc(r.ranking_title)} · ${r.flag}</span></span><span></span></button>`}).join('')}</div>`
      :`<div class="card empty">You haven't rated anything yet. <button class="link" data-act="home">Find something to rate</button></div>`}
    <div class="profile-foot">
      <button class="btn" data-act="sign-out">Sign out</button>
      ${LIVE?'<button class="link btn-danger" data-act="delete-account">Delete my account</button>':'<button class="link" style="color:var(--muted)" data-act="reset-demo">Reset demo data</button>'}
    </div>`;
}
async function share(text){
  const data={title:'TasteRank',text:text||'Which snack wins? Snack brands from every country, rated like for like.',url:location.href};
  try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(location.href);toast('Link copied')}}catch(e){}
}
async function signedOut(msg){
  me=null;profile=null;homeData=null;
  renderHeader();await go({v:'home'});toast(msg);
}
async function signOut(){try{await api.signOut()}catch(e){}signedOut('Signed out')}
async function deleteAccount(){
  if(!confirm("Delete your account, ratings and approvals? This can't be undone."))return;
  try{await api.deleteAccount()}catch(e){return oops(e)}
  signedOut('Your account has been deleted');
}
async function resetDemo(){if(confirm('Reset all demo data in this browser?')){await api.deleteAccount();signedOut('Demo data reset')}}

/* ---------- Light / dark switch (light is the default; the choice is saved on this device) ---------- */
function renderTheme(){
  const dark=document.documentElement.dataset.theme==='dark';
  document.querySelectorAll('[data-act="set-theme"]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.theme===(dark?'dark':'light')));
  $('#theme-color').content=dark?'#1C1416':'#FEF6E4';
}
function setTheme(t){
  if((document.documentElement.dataset.theme||'light')===t)return;
  if(t==='dark')document.documentElement.dataset.theme='dark';else delete document.documentElement.dataset.theme;
  store.set('tasterank-theme',t);track('theme-'+t,true);renderTheme();
}
/* Menu under the gear: closes on a click elsewhere or Escape */
function showSettings(open){
  $('#settings-pop').hidden=!open;
  $('#settings-btn').setAttribute('aria-expanded',open);
  if(open)$('#settings-pop [aria-pressed="true"]').focus();
}
document.addEventListener('click',e=>{if(!$('#settings-pop').hidden&&!e.target.closest('#settings-pop,#settings-btn'))showSettings(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#settings-pop').hidden){showSettings(false);$('#settings-btn').focus()}});

/* ---------- Start ---------- */
async function start(){
  renderTheme();
  $('#demo-bar').hidden=LIVE;
  if(!LIVE)$('#signin-fine').textContent='Demo mode: no real account is created.';
  if(CONFIG.SUPABASE_URL&&!window.supabase)toast("Couldn't reach the TasteRank server. Showing demo data.");
  const geo=detectCountry();
  const params=new URLSearchParams(location.search);
  try{
    if(params.has('error_description'))toast('Sign-in was cancelled or failed. Please try again.');
    me=await api.session();
    if(params.has('code')||params.has('error'))history.replaceState(null,'',location.pathname+location.hash); // tidy the address bar after Google sign-in
    [settings,places]=await Promise.all([rpc('app_settings'),rpc('place_list'),me?loadProfile():null]);
  }catch(e){console.error(e);$('#cards').innerHTML='<div class="card empty">Couldn\'t load snacks. Check your connection and refresh.</div>';return}
  if(!prefs.country)await geo; // only wait for the guess when it decides what to show
  renderHeader();
  if(me&&store.get('tasterank-after',true))await afterSignIn();
  else await route();
  if(LIVE)sb.auth.onAuthStateChange((event,session)=>setTimeout(async()=>{ // e.g. signed out in another tab
    const u=userFrom(session);
    if((u&&u.id)===(me&&me.id))return;
    if(!u)return signedOut('Signed out');
    me=u;await loadProfile();homeData=null;renderHeader();refresh();
  },0));
}
start();
