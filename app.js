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
// in the order shown, wherever you rate: Yuck on the left, Love it on the right
const FACES=[
  {v:1,e:'🤢',l:'Yuck'},{v:2,e:'😕',l:'Not for me'},{v:3,e:'😐',l:"It's okay"},
  {v:4,e:'😊',l:'Like it'},{v:5,e:'😍',l:'Love it'}
];
const DEFAULT_COUNTRY='GB';
const BUBBLE_UNTIL=3; // Crispy's speech bubble on home shows on the first visit only, and goes sooner once someone has rated this many items

/* ---------- Small helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const faceFor=a=>FACES.find(f=>f.v===Math.round(Math.round(a*10)/10))||FACES[2]; // matches the score shown (4.47 shows as 4.5 → 😍)
const fmt=n=>Number(n||0).toLocaleString('en-GB');
const plural=(n,w)=>`${fmt(n)} ${w}${n===1?'':'s'}`;
const score1=a=>Number(a).toFixed(1);
/* Names compared the way the database does: ignoring capitals, curly apostrophes, "&" vs "and" and extra spaces */
const norm=t=>String(t||'').toLowerCase().replace(/[\u2018\u2019]/g,"'").replace(/&/g,' and ').replace(/\s+/g,' ').trim();
/* snack_key() from the database: the name with capitals, apostrophes, punctuation and pack sizes ("150g", "6 x 25g") left out,
   so "Werthers" finds Werther's and "M&S Double Devon Toffees 150g" is the same snack as M&S Double Devon Toffees */
const snackKey=t=>String(t||'').toLowerCase().replace(/[\u2019\u2018`\u00b4]/g,"'").replace(/'/g,'').replace(/&/g,' and ')
  .replace(/(^|[^a-z0-9.,])[0-9]+([.,][0-9]+)?\s*[x\u00d7]\s*[0-9]+([.,][0-9]+)?\s*(g|kg|ml|cl|l)(?![a-z])/g,'$1 ')
  .replace(/(^|[^a-z0-9.,])[0-9]+([.,][0-9]+)?\s*(g|gr|grams?|kg|ml|cl|l|litres?|liters?|oz|packs?|pk|multipack)(?![a-z])/g,'$1 ')
  .replace(/[\][!"#$%()*+,./:;<=>?@^_{|}~\u201c\u201d\u00ab\u00bb\u2013\u2014\u2026\u00b7\u3001\u3002\uff08\uff09\u300c\u300d\u3010\u3011\u30fb\\-]/g,' ').replace(/\s+/g,' ').trim();
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
function toast(msg,btn){ // btn: {label, act, id}: a button in the note (kept up longer, so there's time to tap it)
  const t=$('#toast');t.innerHTML=esc(msg)+(btn?` <button class="link" data-act="${esc(btn.act)}" data-id="${esc(btn.id)}">${esc(btn.label)}</button>`:'');
  t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,btn?6000:2600);
}
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

/* ---------- Demo mode: the UK seed list plus Japanese crisps, with sample ratings ---------- */
const OFF='https://images.openfoodfacts.org/images/products/';
const DEMO={
  settings:{approval_votes:5,rank_after_ratings:10,close_after_days:30,max_open_submissions:10,max_daily_submissions:5,brand_card_variants:5,group_min_ratings:10},
  places:[
    {id:1,name:'United Kingdom',short_name:'UK',adjective:'British',code:'GB',flag:'🇬🇧',regions:['Scotland','Wales','Northern Ireland','North East','North West','Yorkshire & the Humber','East Midlands','West Midlands','East of England','London','South East','South West'].map((name,k)=>({id:101+k,name}))},
    {id:2,name:'United States',short_name:'US',adjective:'American',code:'US',flag:'🇺🇸',regions:[]},
    {id:3,name:'Australia',short_name:'Australia',adjective:'Australian',code:'AU',flag:'🇦🇺',regions:[]},
    {id:4,name:'Japan',short_name:'Japan',adjective:'Japanese',code:'JP',flag:'🇯🇵',regions:[]},
    {id:5,name:'China',short_name:'China',adjective:'Chinese',code:'CN',flag:'🇨🇳',regions:[]}],
  categories:[{id:1,name:'Chocolate',visible:true},{id:2,name:'Sweets',visible:true},{id:3,name:'Crisps & Snacks',visible:true}, // set up with no snacks yet, as on the live site:
    {id:4,name:'Biscuits & Cereal Bars',visible:false},{id:5,name:'Mints & Chewing Gum',visible:false},{id:6,name:'Nuts & Seeds',visible:false},{id:7,name:'Crackers & Crispbreads',visible:false}],
  products:[{id:1,category_id:1,name:'Chocolate bars',emoji:'🍫',off_tags:['en:chocolate-bars','en:milk-chocolate-bars','en:dark-chocolate-bars']},
    {id:2,category_id:2,name:'Toffee',emoji:'🍮',off_tags:['en:caramels','en:toffees','en:toffee']},
    {id:3,category_id:3,name:'Crisps',emoji:'🥔',off_tags:['en:crisps','en:potato-crisps']},
    {id:4,category_id:2,name:'Jelly sweets',emoji:'🍓',off_tags:['en:gummies','en:jelly-sweets']}], // a new list: its only snack is in the vote
  /* flavours, in sort order; each category's "Other" holds what the owner hasn't sorted yet */
  variants:[{id:1,product_id:1,name:'Milk chocolate',title:'Milk chocolate bars',keywords:['milk'],off_tags:['en:milk-chocolate-bars']},
    {id:2,product_id:2,name:'Plain',title:'Toffee',keywords:[]},
    {id:3,product_id:2,name:'Chocolate-covered',title:'Chocolate-covered toffee',keywords:['chocolate covered','chocolate toffee']},
    {id:4,product_id:3,name:'Salt & vinegar',title:'Salt & vinegar crisps',keywords:['vinegar'],off_tags:['en:salt-and-vinegar-crisps']},
    {id:5,product_id:3,name:'Cheese & onion',title:'Cheese & onion crisps',keywords:['cheese','cheddar'],off_tags:['en:cheese-and-onion-crisps']},
    {id:6,product_id:3,name:'Ready salted',title:'Ready salted crisps',keywords:['ready salted','lightly salted','lightly sea salted','sea salt','sea salted']},
    {id:7,product_id:1,name:'Other',title:'Other chocolate bars',is_other:true,keywords:[]},
    {id:8,product_id:2,name:'Other',title:'Other toffee',is_other:true,keywords:[]},
    {id:9,product_id:3,name:'Other',title:'Other crisps',is_other:true,keywords:[]},
    {id:10,product_id:4,name:'Other',title:'Other jelly sweets',is_other:true,keywords:[]}],
  local:{'type:2:2':'Candy','type:3:2':'Chips & Snacks','type:2:3':'Lollies','type:3:3':'Chips & Snacks','type:2:4':'Candy','type:3:4':'Chips & Snacks',
    'type:2:5':'Candy','type:3:5':'Chips & Snacks','product:3:4':'Potato chips','variant:6:4':'Lightly salted (うすしお)','title:6:4':'Lightly salted potato chips (うすしお)','title:9:4':'Other potato chips'},
  /* r = sample ratings for faces [1,2,3,4,5]; demo numbers are allowed only here */
  items:[
    {id:1,c:1,p:1,v:1,b:'Cadbury',pack:'Cadbury Dairy Milk Chocolate Bar',img:OFF+'762/221/049/7383/front.7.400.jpg',r:[0,1,2,4,7]},
    {id:2,c:1,p:1,v:1,b:'KitKat',pack:'KitKat Finger Milk Chocolate Bar',r:[0,1,3,4,3]},
    {id:3,c:1,p:1,v:1,b:"Tony's Chocolonely",pack:"Tony's Chocolonely Milk Chocolate 32%",r:[0,0,1,3,4]},
    {id:4,c:1,p:2,v:2,b:"Werther's Original",pack:"Werther's Original Butter Candies",img:OFF+'401/440/091/8953/front_en.3.400.jpg',r:[0,1,2,2,1]},
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
    {id:16,c:1,p:3,v:6,b:'Walkers',pack:'Walkers Ready Salted Crisps',r:[0,0,1,3,3]},
    {id:17,c:1,p:3,v:9,b:'Walkers',pack:'Walkers Prawn Cocktail Crisps',r:[0,0,1,1,1]},
    {id:18,c:1,p:1,v:1,b:'M&S',pack:'M&S Swiss Milk Chocolate',r:[0,1,2,5,3]},
    {id:19,c:1,p:3,v:4,b:'M&S',pack:'M&S Sea Salt & Cider Vinegar Crisps',r:[0,0,2,3,3]},
    {id:20,c:1,p:3,v:5,b:'Tyrrells',pack:'Tyrrells Mature Cheddar & Chive',r:[0,1,2,8,7]},
    {id:23,c:1,p:3,v:5,b:'M&S',pack:'M&S Mature Cheddar & Red Onion Crisps',r:[0,0,1,2,2]},
    {id:21,c:4,p:3,v:6,b:'Calbee',pack:'Calbee Potato Chips Usushio (うすしお味)',r:[0,1,1,5,6]},
    {id:22,c:4,p:3,v:6,b:'Pringles',pack:'Pringles Original',r:[0,0,2,2,1]},
    {id:901,c:1,p:3,v:4,b:'Tyrrells',pack:'Tyrrells Cider Vinegar & Sea Salt',r:[0,0,0,0,0],pending:true,approvals:3,days_left:21},
    {id:902,c:1,p:2,v:2,b:"Werther's Original",pack:"Werther's Original Chewy Toffees",r:[0,0,0,0,0],pending:true,approvals:2,days_left:26},
    {id:903,c:1,p:4,v:10,b:'Haribo',pack:'Haribo Starmix',r:[0,0,0,0,0],pending:true,approvals:1,days_left:28}
  ],
  // "Not right?" reports from other people, so the owner page has one to show (migration 015)
  reports:[{item:902,reason:'wrong_list',note:'These are chewy, not hard toffees. Maybe a list of their own?'}]
};
const DEMO_KEY='tasterank-demo-v3';
const demoState=()=>Object.assign({user:null,ratings:{},approvals:[],home:0,added:[],extra:{},planned:{}},store.get(DEMO_KEY)||{});
const demoSave=d=>store.set(DEMO_KEY,d);
store.del('tasterank-demo-v2'); // demo data from the earlier foods version
const demoApi={
  async session(){return demoState().user},
  async signIn(){const d=demoState();d.user={id:'demo'};demoSave(d)},
  async signOut(){const d=demoState();d.user=null;demoSave(d)},
  async deleteAccount(){store.del(DEMO_KEY)},
  async rpc(name,args){const f=DEMO_RPC[name];if(!f)throw new Error('Demo mode has no '+name);const st=demoState();ownDemoApply(st);return f(args||{},st)}
};
/* The same rules as the database functions, worked out from the sample data */
const D={
  all:()=>{const st=demoState(),o=(st.own||{}).items||{};   // the sample items plus anything added on this device, with the owner's changes
    return [...DEMO.items,...(st.added||[])].map(i=>o[i.id]?{...i,...o[i.id]}:i)},
  brandId:name=>[...new Set(D.all().map(i=>i.b))].indexOf(name)+1,
  brandName:id=>[...new Set(D.all().map(i=>i.b))][id-1],
  local:(kind,id,c)=>DEMO.local[`${kind}:${id}:${c}`],
  product:(id,c)=>D.local('product',id,c)||DEMO.products.find(p=>p.id===id).name,
  variant:(id,c)=>D.local('variant',id,c)||DEMO.variants.find(v=>v.id===id).name,
  title:(id,c)=>D.local('title',id,c)||DEMO.variants.find(v=>v.id===id).title,
  type:id=>DEMO.categories.find(c=>c.id===DEMO.products.find(p=>p.id===id).category_id),
  dayLimit:st=>{ // migration 012: 5 additions a day (here everyone is the demo owner, so the limit applies to all)
    const day=Date.now()-864e5,n=st.added.filter(x=>x.id>day).length+(st.requests||[]).filter(r=>Date.parse(r.sent)>day).length;
    if(n>=DEMO.settings.max_daily_submissions)throw new Error(`You've added ${n} snacks today, the most for one day. Thanks! You can add more tomorrow.`);
  },
  typeName:(id,c)=>D.local('type',id,c)||DEMO.categories.find(x=>x.id===id).name, // a category's local name: Candy in the US
  typeOn:c=>c.visible!==false||DEMO.products.some(p=>p.category_id===c.id), // switched on once a subcategory is in it
  findType:(name,c)=>DEMO.categories.find(x=>norm(x.name)===norm(name)||norm(D.typeName(x.id,c))===norm(name)),
  emoji:id=>DEMO.products.find(p=>p.id===id).emoji,
  country:id=>{const pl=DEMO.places.find(x=>x.id===id);return pl&&{id:pl.id,name:pl.name,short_name:pl.short_name,flag:pl.flag,code:pl.code}},
  vsort:(a,b)=>!!a.is_other-!!b.is_other||a.id-b.id,
  pic:x=>({image_url:x.image_url,image_path:null,emoji:x.emoji}),
  pics:l=>[...l].sort((a,b)=>!a.image_url-!b.image_url||b.total-a.total||a.id-b.id).slice(0,4).map(D.pic), // a card's photos: ones with a photo first, then most rated
  sum:l=>l.reduce((s,x)=>s+x.total,0),
  approvals:(it,st)=>it.approvals+(st.approvals.includes(it.id)?1:0)+(st.extra[it.id]||0),
  live:(it,st)=>!it.withdrawn&&!it.hidden&&(!it.pending||D.approvals(it,st)>=DEMO.settings.approval_votes),
  waiting:(it,st)=>it.pending&&!it.closed&&!it.withdrawn&&!it.hidden&&!D.live(it,st),
  totals(c,st){
    return D.all().filter(i=>i.c===c&&D.live(i,st)).map(i=>{
      const r=[...i.r],mine=st.user?st.ratings[i.id]:null;if(mine)r[mine-1]++;
      const total=r.reduce((a,b)=>a+b,0);
      return {id:i.id,product_id:i.p,variant_id:i.v,brand_id:D.brandId(i.b),brand:i.b,pack_name:i.pack,image_url:i.img||null,image_path:null,
        emoji:D.emoji(i.p),r1:r[0],r2:r[1],r3:r[2],r4:r[3],r5:r[4],total,
        avg:total?Math.round(r.reduce((s,n,k)=>s+n*(k+1),0)/total*100)/100:null,ranked:total>=DEMO.settings.rank_after_ratings,my_score:mine||null};
    });
  },
  order:(a,b)=>(b.ranked-a.ranked)||(a.ranked?b.avg-a.avg:0)||b.total-a.total||a.id-b.id,
  // guess_variant(): the first flavour with a keyword in the name, else the hint, else Other
  guessVariant(p,name,hint){
    const k=` ${snackKey(name)} `,vs=DEMO.variants.filter(v=>v.product_id===p).sort(D.vsort);
    return (vs.find(v=>!v.is_other&&v.keywords.some(w=>k.includes(` ${snackKey(w)} `)))||vs.find(v=>v.id===hint&&!v.is_other)||vs.find(v=>v.is_other)).id;
  },
  same:(c,pack,barcode,st)=>D.all().filter(i=>i.c===c&&(D.live(i,st)||D.waiting(i,st))).find(i=>snackKey(i.pack)===snackKey(pack)||(barcode&&i.barcode===barcode))
};
const DEMO_RPC={
  app_settings:()=>DEMO.settings,
  place_list:()=>DEMO.places,
  home_categories({p_country},st){
    const t=D.totals(p_country,st),w=D.all().filter(i=>D.waiting(i,st)&&i.c===p_country); // 013: also lists whose only snacks are in the vote
    return DEMO.products.filter(p=>t.some(x=>x.product_id===p.id)||w.some(i=>i.p===p.id)).map(p=>{
      const mine=t.filter(x=>x.product_id===p.id).sort(D.order),ranked=mine.filter(x=>x.ranked),wait=w.filter(i=>i.p===p.id);
      return {id:p.id,name:D.product(p.id,p_country),emoji:p.emoji,type:D.typeName(p.category_id,p_country),type_id:p.category_id,snacks:mine.length,waiting:wait.length,ratings:D.sum(mine),
        lead:Math.max(0,...mine.map(x=>x.total)),
        thumbs:mine.length?D.pics(mine):wait.sort((a,b)=>!a.img-!b.img||D.approvals(b,st)-D.approvals(a,st)||a.id-b.id).slice(0,4).map(i=>({image_url:i.img||null,image_path:null,emoji:p.emoji})),top:ranked.slice(0,3).map(x=>({item_id:x.id,pack_name:x.pack_name,brand:x.brand,avg:x.avg,total:x.total})),
        to_rate:ranked.length?[]:mine.slice(0,2).map(x=>({item_id:x.id,pack_name:x.pack_name,total:x.total}))};
    }).sort((a,b)=>!a.snacks-!b.snacks||b.ratings-a.ratings||a.type_id-b.type_id||a.id-b.id);
  },
  home_brands({p_country},st){
    const t=D.totals(p_country,st);
    return [...new Set(t.map(x=>x.brand_id))].map(id=>{
      const mine=t.filter(x=>x.brand_id===id).sort(D.order);if(mine.length<2)return null;
      const ps=DEMO.products.map(p=>({p,n:mine.filter(x=>x.product_id===p.id).length})).filter(x=>x.n).sort((a,b)=>b.n-a.n||a.p.id-b.p.id),best=mine.find(x=>x.ranked);
      return {id,name:mine[0].brand,snacks:mine.length,ratings:D.sum(mine),lead:Math.max(0,...mine.map(x=>x.total)),thumbs:D.pics(mine),categories:ps.map(x=>D.product(x.p.id,p_country)),type_ids:[...new Set(ps.map(x=>x.p.category_id))],
        thumb:D.pic([...mine].sort((a,b)=>!a.image_url-!b.image_url||b.total-a.total||a.id-b.id)[0]),
        best:best?{item_id:best.id,pack_name:best.pack_name,avg:best.avg,total:best.total}:null};
    }).filter(Boolean).sort((a,b)=>b.ratings-a.ratings||a.name.localeCompare(b.name));
  },
  category_page({p_product,p_country},st){
    const p=DEMO.products.find(x=>x.id===p_product),country=D.country(p_country);if(!p||!country)return null;
    const t=D.totals(p_country,st),live=t.filter(x=>x.product_id===p_product).map(x=>({...x,brand_snacks:t.filter(y=>y.brand_id===x.brand_id).length})).sort(D.order);
    return {id:p.id,name:D.product(p.id,p_country),emoji:p.emoji,type:D.typeName(p.category_id,p_country),type_id:p.category_id,country,
      flavours:DEMO.variants.filter(v=>v.product_id===p_product&&live.some(x=>x.variant_id===v.id)).sort(D.vsort)
        .map(v=>({id:v.id,name:D.variant(v.id,p_country),title:D.title(v.id,p_country),is_other:!!v.is_other,count:live.filter(x=>x.variant_id===v.id).length})),
      items:live,
      // demo: Approve stays clickable, and each extra click counts as another person, so the live moment can be tried alone
      pending:D.all().filter(i=>D.waiting(i,st)&&i.c===p_country&&i.p===p_product).map(i=>({id:i.id,brand_id:D.brandId(i.b),brand:i.b,pack_name:i.pack,variant_id:i.v,
        image_url:i.img||null,image_path:null,emoji:p.emoji,approvals:D.approvals(i,st),approved:false,mine:!!i.mine,days_left:i.days_left}))
        .sort((a,b)=>b.mine-a.mine||b.approvals-a.approvals||a.id-b.id),
      withdrawn:D.all().filter(i=>i.withdrawn&&i.c===p_country&&i.p===p_product).map(i=>({id:i.id,pack_name:i.pack}))};
  },
  brand_page({p_brand,p_country},st){
    const name=D.brandName(p_brand),country=D.country(p_country);if(!name||!country)return null;
    const t=D.totals(p_country,st),mine=t.filter(x=>x.brand_id===p_brand);
    const count=(k,v)=>mine.filter(x=>x[k]===v).length;
    return {id:p_brand,name,country,
      items:mine.map(x=>({...x,product:D.product(x.product_id,p_country),flavour:D.variant(x.variant_id,p_country),flavour_title:D.title(x.variant_id,p_country),
        place:x.ranked?t.filter(y=>y.product_id===x.product_id&&y.ranked).sort(D.order).findIndex(y=>y.id===x.id)+1:null})).sort(D.order),
      products:DEMO.products.filter(p=>count('product_id',p.id)).map(p=>({id:p.id,name:D.product(p.id,p_country),count:count('product_id',p.id)})).sort((a,b)=>b.count-a.count||a.id-b.id),
      flavours:DEMO.variants.filter(v=>count('variant_id',v.id)).sort(D.vsort)
        .map(v=>({id:v.id,product_id:v.product_id,name:D.variant(v.id,p_country),title:D.title(v.id,p_country),is_other:!!v.is_other,count:count('variant_id',v.id)}))};
  },
  next_snack({p_item,p_variant,p_brand},st){
    const it=D.all().find(i=>i.id===p_item);if(!it)return {kind:'done'};
    const need=DEMO.settings.rank_after_ratings,open=D.totals(it.c,st).filter(x=>x.id!==p_item&&!x.my_score);
    const first=l=>l.sort((a,b)=>(b.total<need)-(a.total<need)||a.total-b.total||a.id-b.id)[0],asItem=x=>({kind:'item',id:x.id,short_label:x.pack_name});
    const b=p_brand&&first(open.filter(x=>x.brand_id===D.brandId(it.b)));if(b)return asItem(b);
    const s=first(open.filter(x=>x.product_id===it.p&&(p_variant==null||x.variant_id===p_variant)));if(s)return asItem(s);
    const v=p_variant!=null&&DEMO.variants.filter(v=>v.product_id===it.p&&v.id!==p_variant&&open.some(x=>x.variant_id===v.id)).sort(D.vsort)[0];
    if(v)return {kind:'list',product_id:it.p,variant_id:v.id,title:D.title(v.id,it.c)};
    const p=DEMO.products.find(p=>p.id!==it.p&&p.category_id===D.type(it.p).id&&open.some(x=>x.product_id===p.id));
    return p?{kind:'list',product_id:p.id,variant_id:null,title:D.product(p.id,it.c)}:{kind:'done'};
  },
  rate_item({p_item,p_score},st){st.ratings[p_item]=p_score;demoSave(st);return Object.keys(st.ratings).length},
  unrate_item({p_item},st){delete st.ratings[p_item];demoSave(st);return Object.keys(st.ratings).length},
  approve_item({p_item},st){
    const it=D.all().find(i=>i.id===p_item);
    if(it.withdrawn)throw new Error("It was just withdrawn, so there's nothing to approve.");
    if(!st.approvals.includes(p_item)&&!it.mine)st.approvals.push(p_item);else st.extra[p_item]=(st.extra[p_item]||0)+1;
    if(D.live(it,st)&&st.planned[p_item]&&!st.ratings[p_item]){st.ratings[p_item]=st.planned[p_item];delete st.planned[p_item]} // "Tried it?" becomes a real rating
    demoSave(st);
    return {approvals:D.approvals(it,st),status:D.live(it,st)?'live':'pending'};
  },
  search_items({q},st){
    const words=snackKey(q).split(' ').filter(Boolean);if(norm(q).length<2||!words.length)return [];
    return D.all().filter(i=>D.live(i,st)||D.waiting(i,st)).filter(i=>{const k=snackKey(`${i.b} ${i.pack} ${D.product(i.p,i.c)} ${D.variant(i.v,i.c)} ${D.title(i.v,i.c)}`);return words.every(w=>k.includes(w))}).slice(0,20).map(i=>{
      const pl=DEMO.places.find(x=>x.id===i.c);
      return {id:i.id,pack_name:i.pack,brand:i.b,brand_id:D.brandId(i.b),status:D.live(i,st)?'live':'pending',product_id:i.p,product:D.product(i.p,i.c),variant_id:i.v,
        country_id:i.c,country:pl.short_name,flag:pl.flag,barcode:i.barcode||null,ranking_title:D.title(i.v,i.c),ratings:i.r.reduce((a,b)=>a+b,0)+(st.ratings[i.id]?1:0),
        image_url:i.img||null,image_path:null,emoji:D.emoji(i.p)};
    }).sort((a,b)=>(b.status==='live')-(a.status==='live')||a.pack_name.localeCompare(b.pack_name));
  },
  category_list({p_country}){return DEMO.categories.map(c=>({id:c.id,name:D.typeName(c.id,p_country),visible:D.typeOn(c)}))},
  catalogue({p_country}){return DEMO.categories.filter(D.typeOn).map(c=>({id:c.id,name:D.typeName(c.id,p_country),products:DEMO.products.filter(p=>p.category_id===c.id).map(p=>({id:p.id,name:D.product(p.id,p_country),emoji:p.emoji,off_tags:p.off_tags,
    variants:DEMO.variants.filter(v=>v.product_id===p.id&&!v.is_other).map(v=>({id:v.id,name:D.variant(v.id,p_country),title:D.title(v.id,p_country),off_tags:v.off_tags||null}))}))}))},
  brand_suggest({q},st){const k=norm(q);return [...new Set(D.all().filter(i=>D.live(i,st)).map(i=>i.b))].filter(b=>k&&norm(b).includes(k)).sort((a,b)=>norm(b).startsWith(k)-norm(a).startsWith(k)||a.localeCompare(b)).slice(0,8).map(b=>({id:D.brandId(b),name:b}))},
  // Adding: a snack in a category (the flavour is guessed), one snack per name per country; or a snack in a new category
  submit_snack({p_country,p_product,p_brand_name,p_pack_name,p_variant_hint,p_image_url,p_barcode,p_score,p_demo_image},st){
    D.dayLimit(st);
    const pack=tidyCase(p_pack_name),pname=D.product(p_product,p_country);
    if(!pack)throw new Error('Type the name on the pack');
    const dup=D.same(p_country,pack,p_barcode,st);
    if(dup)return {duplicate:{id:dup.id,pack_name:dup.pack,product_id:dup.p,product:D.product(dup.p,dup.c),status:D.live(dup,st)?'live':'pending',ratings:dup.r.reduce((a,b)=>a+b,0)}};
    const known=D.all().map(i=>i.b).find(b=>norm(b)===norm(p_brand_name)),brand=known||tidyCase(p_brand_name);
    if(known&&snackKey(pack)===snackKey(known)&&D.all().some(i=>i.b===known&&i.p===p_product&&i.c===p_country&&(D.live(i,st)||D.waiting(i,st))))
      throw new Error(`${known} already has ${pname.toLowerCase()} here. Type the full name on the pack.`);
    const id=Date.now(),v=D.guessVariant(p_product,pack,p_variant_hint);
    st.added.push({id,c:p_country,p:p_product,v,b:brand,pack,barcode:p_barcode||null,img:p_demo_image||p_image_url||null,r:[0,0,0,0,0],pending:true,approvals:1,days_left:30,mine:true});
    if(p_score)st.planned[id]=p_score;
    demoSave(st);return {id,pack_name:pack,product_id:p_product,product:pname,variant_id:v,status:'pending'};
  },
  submit_new_category({p_country,p_new_category,p_brand_name,p_pack_name,p_category,p_new_type},st){
    D.dayLimit(st);
    const nc=tidyCase(p_new_category,true),pack=tidyCase(p_pack_name),nt=p_new_type?tidyCase(p_new_type,true):null;
    if(nt&&nt.length>40)throw new Error('Keep the category under 40 letters');
    const takenType=nt&&D.findType(nt,p_country);
    if(takenType)throw new Error(`Category ${D.typeName(takenType.id,p_country)} is already on TasteRank. Pick it from the list.`);
    const found=DEMO.products.find(p=>norm(p.name)===norm(nc)||Object.entries(DEMO.local).some(([k,n])=>k.startsWith(`product:${p.id}:`)&&norm(n)===norm(nc)));
    if(found)throw new Error(`${D.product(found.id,p_country)} is already a category. Pick it from the list.`);
    const dup=D.same(p_country,pack,null,st);
    if(dup)throw Object.assign(new Error(`Already on TasteRank: ${dup.pack} is in ${D.product(dup.p,dup.c)}.`),{code:'23505'});
    const n=Date.now();
    (st.requests=st.requests||[]).push({id:'r'+n,kind:'category',country_id:p_country,category_id:nt?null:p_category||null,new_type:nt,sent:new Date().toISOString(),new_ranking:nc,brand:D.all().map(i=>i.b).find(b=>norm(b)===norm(p_brand_name))||tidyCase(p_brand_name),pack_name:pack,status:'review'});
    demoSave(st);return n;
  },
  withdraw_submission({p_id},st){
    const id=String(p_id),r=(st.requests||[]).find(x=>x.id===id),i=st.added.find(x=>String(x.id)===id);
    if(r){if(r.status!=='review')throw new Error('Only snacks still waiting can be withdrawn.');r.status='withdrawn'}
    else if(i){if(!D.waiting(i,st))throw new Error('Only snacks still waiting can be withdrawn.');i.withdrawn=true;delete st.planned[i.id];delete st.extra[i.id];st.approvals=st.approvals.filter(x=>x!==i.id)}
    else throw new Error("That isn't one of yours");
    demoSave(st);return 'Withdrawn';
  },
  my_submissions(_,st){return [...(st.added||[]).filter(i=>!i.withdrawn).map(i=>({id:i.id,pack_name:i.pack,brand:i.b,product_id:i.p,variant_id:i.v,country_id:i.c,
    product:D.product(i.p,i.c),country_flag:(D.country(i.c)||{}).flag,status:i.hidden?'hidden':i.closed?'closed':D.live(i,st)?'live':'pending',approvals:D.approvals(i,st)})),
    ...(st.requests||[]).filter(r=>!['withdrawn','accepted'].includes(r.status)).map(r=>({...r,new_category:r.kind==='category',product:r.new_ranking,country_flag:(D.country(r.country_id)||{}).flag,approvals:0}))]},
  my_profile(_,st){return st.user?{taster_id:'#DEMO00',home_place:{id:0,level:'unknown',name:'Unknown'},rated:Object.keys(st.ratings).length,
    rankings_helped:new Set(Object.keys(st.ratings).map(id=>{const i=D.all().find(x=>x.id==id);return i&&`${i.p}-${i.v}-${i.c}`})).size}:null},
  my_ratings(_,st){return Object.entries(st.ratings).map(([id,score])=>{const i=D.all().find(x=>x.id==id);if(!i)return null;
    const pl=DEMO.places.find(p=>p.id===i.c);return {item_id:i.id,pack_name:i.pack,brand:i.b,product_id:i.p,variant_id:i.v,country_id:i.c,flag:pl.flag,
      ranking_title:D.title(i.v,i.c),score,image_url:i.img||null,image_path:null,emoji:D.emoji(i.p)}}).filter(Boolean)},
  my_rating_count(_,st){return Object.keys(st.ratings).length},
  // The owner page: in demo mode you're the owner, and two sample additions wait for a check
  owner_status(_,st){return st.user?{owner:true,to_check:ownDemoQueue(st).length,reports:DEMO_RPC.owner_reports(_,st).length}:{owner:false}},
  // Migration 015: the snacks in the vote for home, closest to going live first, then closing soonest; yours last
  home_waiting({p_country},st){
    return D.all().filter(i=>D.waiting(i,st)&&i.c===p_country).map(i=>({id:i.id,pack_name:i.pack,brand:i.b,product_id:i.p,product:D.product(i.p,i.c),
      type_id:DEMO.products.find(p=>p.id===i.p).category_id,emoji:D.emoji(i.p),variant_id:i.v,approvals:D.approvals(i,st),days_left:i.days_left??30,
      approved:false,reported:!!(st.user&&(st.reports||{})[i.id]),mine:!!i.mine})) // demo: Approve stays clickable, as on the list page
      .sort((a,b)=>a.mine-b.mine||b.approvals-a.approvals||a.days_left-b.days_left||a.id-b.id);
  },
  report_item({p_item,p_reason,p_note},st){
    const it=D.all().find(i=>i.id===p_item),note=String(p_note||'').trim()||null;
    if(!['not_sold','wrong_list','wrong_name','duplicate','other'].includes(p_reason))throw new Error("Pick what's not right");
    if(note&&note.length>200)throw new Error('Please keep the note under 200 letters');
    if(!it||!D.waiting(it,st))throw new Error("This snack isn't waiting for approval any more");
    if(it.mine)throw new Error('You added this one. You can withdraw it from your profile.');
    (st.reports=st.reports||{})[p_item]={reason:p_reason,note,at:Date.now()};delete (st.cleared||{})[p_item];demoSave(st);
    return {ok:true,pack_name:it.pack};
  },
  owner_reports(_,st){
    const all=[...DEMO.reports.map(r=>({...r,at:1})),...Object.entries(st.reports||{}).map(([id,r])=>({item:+id,...r}))].filter(r=>!(st.cleared||{})[r.item]);
    return [...new Set(all.map(r=>r.item))].map(id=>{
      const i=D.all().find(x=>x.id===id),rs=all.filter(r=>r.item===id);if(!i||i.withdrawn||i.hidden)return null;
      const reasons={};rs.forEach(r=>reasons[r.reason]=(reasons[r.reason]||0)+1);
      return {item_id:id,pack_name:i.pack,brand:i.b,product_id:i.p,product:D.product(i.p,i.c),emoji:D.emoji(i.p),country_id:i.c,
        status:D.live(i,st)?'live':i.closed?'closed':'pending',approvals:D.approvals(i,st),reports:rs.length,reasons,
        notes:rs.filter(r=>r.note).sort((a,b)=>b.at-a.at).map(r=>r.note),last_at:new Date(Math.max(...rs.map(r=>r.at))).toISOString()};
    }).filter(Boolean).sort((a,b)=>b.last_at.localeCompare(a.last_at));
  },
  owner_resolve_report({p_item,p_action},st){
    if(!['clear','hide'].includes(p_action))throw new Error('Unknown action '+p_action);
    if(p_action==='hide')DEMO_RPC.owner_set_status({p_item,p_action:'hide'},st);
    const s2=demoState();(s2.cleared=s2.cleared||{})[p_item]=true;if(s2.reports)delete s2.reports[p_item];demoSave(s2);return {ok:true};
  },
  owner_queue(_,st){return ownDemoQueue(st)},
  owner_snacks({p_country,p_item},st){
    const n=DEMO.settings.approval_votes;
    return D.all().filter(i=>!i.withdrawn&&(p_country==null||i.c===p_country)&&(p_item==null||i.id===p_item)).map(i=>{
      const p=DEMO.products.find(x=>x.id===i.p),v=DEMO.variants.find(x=>x.id===i.v),r=[...i.r];if(st.ratings[i.id])r[st.ratings[i.id]-1]++;
      const total=r.reduce((a,b)=>a+b,0),approvals=D.approvals(i,st);
      return {id:i.id,pack_name:i.pack,brand:i.b,brand_id:D.brandId(i.b),product_id:i.p,product:p.name,category_id:p.category_id,emoji:p.emoji,variant_id:i.v,flavour:v.name,is_other:!!v.is_other,
        country_id:i.c,status:i.hidden?'hidden':i.closed?'closed':approvals>=n||!i.pending?'live':'pending',hidden_from:i.hidden_from||null,ratings:total,
        avg:total?Math.round(r.reduce((s,x,k)=>s+x*(k+1),0)/total*100)/100:null,approvals,days_left:i.days_left??30,image_url:i.img||null,image_path:null};
    }).sort((a,b)=>b.id-a.id);
  },
  owner_catalogue(_,st){
    const all=D.all().filter(i=>!i.withdrawn&&!i.closed);
    return {categories:DEMO.categories.map(c=>({id:c.id,name:c.name,visible:D.typeOn(c)})),products:DEMO.products.map(p=>({id:p.id,name:p.name,emoji:p.emoji,category_id:p.category_id,
      snacks:all.filter(i=>i.p===p.id).length,ratings:all.filter(i=>i.p===p.id).reduce((s,i)=>s+i.r.reduce((a,b)=>a+b,0)+(st.ratings[i.id]?1:0),0),
      flavours:DEMO.variants.filter(v=>v.product_id===p.id).sort(D.vsort).map(v=>({id:v.id,name:v.name,is_other:!!v.is_other}))}))};
  },
  owner_accept({p_request,p_category,p_subcategory,p_flavour,p_emoji,p_brand_name,p_pack_name,p_new_type},st){
    const r=ownDemoQueue(st).find(x=>String(x.id)===String(p_request));if(!r)throw new Error("That one isn't waiting any more");
    const cat=p_category||r.category_id||(p_new_type||r.new_type?ownDemoCategory(st,p_new_type||r.new_type):null),pack=tidyCase(p_pack_name||r.pack_name),brand=D.all().map(i=>i.b).find(b=>norm(b)===norm(p_brand_name||r.brand_name))||tidyCase(p_brand_name||r.brand_name);
    const pid=ownDemoProduct(st,p_subcategory||r.product||r.new_ranking,cat,p_emoji);
    const v=p_flavour?ownDemoVariant(st,pid,p_flavour):D.guessVariant(pid,pack,null);
    (st.reviewed=st.reviewed||{})[r.id]='accepted';const mine=(st.requests||[]).find(x=>x.id===r.id);if(mine)mine.status='accepted';
    const dup=D.same(r.country_id,pack,null,st);
    if(dup){demoSave(st);return {message:`That snack was already there (${dup.pack}), so nothing new was sent to the vote.`,item_id:dup.id,pack_name:pack,product:DEMO.products.find(x=>x.id===dup.p).name}}
    const id=Date.now();st.added.push({id,c:r.country_id,p:pid,v,b:brand,pack,r:[0,0,0,0,0],pending:true,approvals:1,days_left:30});
    demoSave(st);return {message:'in the vote',item_id:id,pack_name:pack,product:DEMO.products.find(x=>x.id===pid).name};
  },
  owner_decline({p_request},st){
    (st.reviewed=st.reviewed||{})[p_request]='declined';const mine=(st.requests||[]).find(x=>x.id===p_request);if(mine)mine.status='declined';
    demoSave(st);return 'Declined. The sender will see "Not this time".';
  },
  owner_save_snack({p_item,p_pack_name,p_brand_name,p_country,p_category,p_subcategory,p_flavour,p_photo},st){
    const it=D.all().find(i=>i.id===p_item),pack=tidyCase(p_pack_name);
    if(!pack)throw new Error('Type the name on the pack');if(!norm(p_brand_name))throw new Error('Add the brand');
    if(D.all().some(i=>i.id!==p_item&&i.c===p_country&&!i.hidden&&(D.live(i,st)||D.waiting(i,st))&&snackKey(i.pack)===snackKey(pack)))
      throw new Error(`Another snack in ${D.country(p_country).short_name} already has that name. Change one of them, or hide the extra one.`);
    const pid=ownDemoProduct(st,p_subcategory,p_category),v=p_flavour?ownDemoVariant(st,pid,p_flavour):pid===it.p?it.v:D.guessVariant(pid,pack,null);
    const o={pack,b:D.all().map(i=>i.b).find(b=>norm(b)===norm(p_brand_name))||tidyCase(p_brand_name),c:p_country,p:pid,v};
    if(p_photo!=null)o.img=p_photo||null;
    ownDemoItem(st,p_item,o);return DEMO_RPC.owner_snacks({p_item},st)[0];
  },
  owner_set_status({p_item,p_action},st){
    const s=DEMO_RPC.owner_snacks({p_item},st)[0];
    if(p_action==='hide')ownDemoItem(st,p_item,{hidden:true,hidden_from:s.status});
    if(p_action==='show'){
      const it=D.all().find(i=>i.id===p_item);
      if(D.all().some(i=>i.id!==p_item&&i.c===it.c&&(D.live(i,st)||D.waiting(i,st))&&snackKey(i.pack)===snackKey(it.pack)))throw new Error('Another snack with this name is listed now. Hide that one first.');
      ownDemoItem(st,p_item,{hidden:false,hidden_from:null});
    }
    if(p_action==='live'){if(!['pending','closed'].includes(s.status))throw new Error('Only a snack in the vote or closed can be put live');ownDemoItem(st,p_item,{pending:false,closed:false})}
    return DEMO_RPC.owner_snacks({p_item},demoState())[0];
  },
  owner_save_subcategory({p_product,p_name,p_category,p_emoji},st){
    const name=tidyCase(p_name,true),other=DEMO.products.find(p=>p.id!==p_product&&norm(p.name)===norm(name));
    if(!name)throw new Error('Name the subcategory');
    if(other)throw new Error(`There's already a subcategory called ${other.name}. To join them, use "Move its snacks into…".`);
    const p={...DEMO.products.find(x=>x.id===p_product),name,category_id:p_category,emoji:p_emoji||DEMO.products.find(x=>x.id===p_product).emoji};
    ownDemoKeep(st,'products',p);demoSave(st);ownDemoApply(st);return p;
  },
  owner_move_snacks({p_from,p_into},st){
    if(p_from===p_into)throw new Error('Pick a different subcategory');
    const moved=D.all().filter(i=>i.p===p_from);
    for(const i of moved){const v=DEMO.variants.find(x=>x.id===i.v);ownDemoItem(st,i.id,{p:p_into,v:v.is_other?ownDemoVariant(st,p_into,'Other'):ownDemoVariant(st,p_into,v.name)})}
    const o=st.own;o.removed=[...(o.removed||[]),p_from];demoSave(st);ownDemoApply(st);return moved.length;
  }
};
// Demo owner changes are kept in the demo data (own: products, variants, items, removed) and laid over the sample data before each call
DEMO.requests=[
  {id:'d1',kind:'category',country_id:1,category_id:2,new_ranking:'Jelly sweets',brand_name:'Haribo',pack_name:'Haribo Starmix',sent:'2026-11-03T09:00:00Z'},
  {id:'d2',kind:'ranking',country_id:1,category_id:2,product_id:2,new_ranking:'Salted caramel',new_variant:'Salted Caramel',brand_name:"Werther's Original",pack_name:"Werther's Original Salted Caramel",sent:'2026-11-02T09:00:00Z'}];
function ownDemoQueue(st){
  const done=st.reviewed||{};
  return [...DEMO.requests,...(st.requests||[]).filter(r=>r.status==='review').map(r=>({...r,brand_name:r.brand,sent:r.sent||new Date().toISOString()}))]
    .filter(r=>!done[r.id]).map(r=>({...r,product:r.product_id?DEMO.products.find(p=>p.id===r.product_id)?.name:null}))
    .sort((a,b)=>String(a.sent).localeCompare(String(b.sent)));
}
function ownDemoKeep(st,kind,x){const o=st.own=st.own||{};o[kind]=(o[kind]||[]).filter(y=>y.id!==x.id).concat([x])}
function ownDemoItem(st,id,change){const o=st.own=st.own||{};o.items=o.items||{};o.items[id]={...(o.items[id]||{}),...change};demoSave(st)}
function ownDemoApply(st){
  const o=st.own||{};
  for(const c of o.categories||[])if(!DEMO.categories.some(x=>x.id===c.id))DEMO.categories.push({...c});
  for(const p of o.products||[]){const i=DEMO.products.findIndex(x=>x.id===p.id);if(i<0)DEMO.products.push({...p});else Object.assign(DEMO.products[i],p)}
  for(const v of o.variants||[])if(!DEMO.variants.some(x=>x.id===v.id))DEMO.variants.push({...v});
  for(const id of o.removed||[]){const i=DEMO.products.findIndex(x=>x.id===id);if(i>=0)DEMO.products.splice(i,1)}
}
function ownDemoCategory(st,name){ // a new category by name, or the one with that name
  const n=tidyCase(name||'',true);if(!n)throw new Error('Name the new category');
  const found=D.findType(n,1);if(found)return found.id;
  const id=Math.max(...DEMO.categories.map(c=>c.id))+1;
  ownDemoKeep(st,'categories',{id,name:n,visible:false});ownDemoApply(st);return id;
}
function ownDemoProduct(st,name,cat,emoji){
  const n=tidyCase(name||'',true);if(!n)throw new Error('Name the subcategory');
  const found=DEMO.products.find(p=>norm(p.name)===norm(n));if(found)return found.id;
  if(!cat)throw new Error('Pick the category');
  const id=Math.max(...DEMO.products.map(p=>p.id),...((st.own||{}).removed||[]))+1;
  ownDemoKeep(st,'products',{id,category_id:cat,name:n,emoji:emoji||'🍽️',off_tags:[]});ownDemoApply(st);ownDemoVariant(st,id,'Other');return id;
}
function ownDemoVariant(st,pid,name){
  const n=tidyCase(name,true),p=DEMO.products.find(x=>x.id===pid),other=norm(n)==='other';
  const found=DEMO.variants.find(v=>v.product_id===pid&&(other?v.is_other:norm(v.name)===norm(n)));if(found)return found.id;
  const v={id:Math.max(...DEMO.variants.map(x=>x.id))+1,product_id:pid,name:other?'Other':n,title:other?'Other '+p.name.toLowerCase():`${n} ${p.name.toLowerCase()}`,is_other:other,keywords:other?[]:[snackKey(n)]};
  const o=st.own=st.own||{};o.variants=[...(o.variants||[]),v];DEMO.variants.push(v);demoSave(st);return v.id;
}
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
  openId=id;$('#tip7').hidden=true;
  const m=$('#'+id);m.hidden=false;
  const first=m.querySelector('[data-autofocus]')||m.querySelector('.face-btn,input:not([type=checkbox]),textarea,select,.btn-primary,button:not(.x)');
  (first||m.querySelector('button')).focus();
}
function closeM(){
  if(!openId)return;
  $('#'+openId).hidden=true;openId=null;sheet=null;
  if(tipNow&&!tipNow.n)tipNow=null;setTimeout(updateTips,0); // after a page change this runs, so no tip is picked for the page being left
  if(lastFocus&&document.contains(lastFocus))lastFocus.focus();
  lastFocus=null;
}
// Tapping outside closes it, but only a press that starts and ends outside the card: selecting text and letting go outside keeps it open
document.querySelectorAll('.modal-bg').forEach(m=>{
  let outside=false;
  m.addEventListener('pointerdown',e=>{outside=e.target===m});
  m.addEventListener('pointerup',e=>{if(outside&&e.target===m)closeM();outside=false});
});
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

/* ---------- Navigation: #/ home · #/brands home by brand · #/p/gb/3[/4] category (and flavour; ?snack=57 scrolls to a waiting snack)
   · #/b/gb/12[/3[/4]] brand (and category, flavour) · #/me profile · #/owner the owner page. Old #/r/gb/3/4 ranking links open #/p/gb/3/4. ---------- */
const VIEWS=['home','category','brand','profile','owner'];
function parseHash(){
  const h=location.hash;let m;
  if((m=h.match(/^#\/p\/([a-z]{2})\/(\d+)(?:\/(\d+))?(?:\?snack=(\d+))?$/i)))return {v:'category',cc:m[1],product:+m[2],variant:m[3]?+m[3]:null,snack:m[4]?+m[4]:null};
  if((m=h.match(/^#\/b\/([a-z]{2})\/(\d+)(?:\/(\d+)(?:\/(\d+))?)?$/i)))return {v:'brand',cc:m[1],brand:+m[2],product:m[3]?+m[3]:null,variant:m[4]?+m[4]:null};
  if((m=h.match(/^#\/r\/([a-z]{2})\/(\d+)\/(\d+)$/i))){const r={v:'category',cc:m[1],product:+m[2],variant:+m[3]};history.replaceState(null,'',hashFor(r));return r}
  if(h==='#/brands')return {v:'home',by:'brands'};
  if(h==='#/me')return {v:'profile'};
  if(h==='#/owner')return {v:'owner'};
  return {v:'home'}; // includes old #/item/5 links: those foods aren't in the new structure
}
const hashFor=r=>{const cc=String(r.cc||'').toLowerCase();
  return r.v==='category'?`#/p/${cc}/${r.product}${r.variant?'/'+r.variant:''}${r.snack?'?snack='+r.snack:''}`
    :r.v==='brand'?`#/b/${cc}/${r.brand}${r.product?`/${r.product}${r.variant?'/'+r.variant:''}`:''}`
    :r.v==='profile'?'#/me':r.v==='owner'?'#/owner':r.by==='brands'?'#/brands':''};
async function show(r){
  view=r.v;tipReady=false;
  VIEWS.forEach(x=>$('#v-'+x).hidden=x!==r.v);
  setFab();
  if(r.v==='home')await renderHome(r);
  if(r.v==='category')await renderCategory(r);
  if(r.v==='brand')await renderBrandPage(r);
  if(r.v==='profile')await renderProfile();
  if(r.v==='owner')await renderOwner();
  setFab(); // its label names the list now showing
  tipReady=true;updateTips();
  currentUrl=location.href;
  track(pagePath());
}
function go(r){
  const h=hashFor(r);
  if(location.hash!==h)history.pushState(null,'',h||location.pathname);
  window.scrollTo(0,0);return show(r);
}
// a chip changes the address without a new step in the history, so sharing shares the filtered list and Back skips chips
function setRoute(r){const h=hashFor(r);if(location.hash!==h)history.replaceState(null,'',h||location.pathname);currentUrl=location.href;track(pagePath())}
// an unknown or emptied list (an old link, or the last snack withdrawn)
function gone(){history.replaceState(null,'',location.pathname);toast("That list isn't here any more.");return show({v:'home'})}
const route=()=>{const r=parseHash();if(r.v==='profile'&&!me)r.v='home';return show(r)};
window.addEventListener('popstate',()=>{
  if(openId){closeM();history.pushState(null,'',currentUrl);return} // Back closes the pop-up instead of leaving the page
  route();
});
const refresh=()=>show(view==='home'?{v:'home',by:homeBy}:parseHash());

/* ---------- Clicks: every button says what it does with data-act ---------- */
const ACT={
  home:()=>go({v:'home'}),
  'home-by':d=>{if(d.by===(homeBy||'categories'))return;track('home-'+d.by,true);go({v:'home',by:d.by==='brands'?'brands':null})}, // the switch
  'home-brands':d=>{prefs.country=d.cc;savePrefs();go({v:'home',by:'brands'})}, // the crumb on a brand page
  'home-type':d=>{prefs.country=d.cc;prefs.cat=d.type;savePrefs();go({v:'home'})}, // the crumb on a category page: home, with its type picked
  me:()=>needUser({name:'profile'}),
  cat:d=>{prefs.cat=d.cat;savePrefs();renderHomeCards()},
  category:d=>go({v:'category',cc:d.cc,product:+d.product,variant:d.variant?+d.variant:null}),
  brand:d=>go({v:'brand',cc:d.cc,brand:+d.brand,product:d.product?+d.product:null}),
  flavour:d=>pickFlavour(d.id?+d.id:null),
  'bp-cat':d=>pickBrandChip(d.id?+d.id:null,null,'pick-category'),
  'bp-flavour':d=>pickBrandChip(page.route.product,d.id?+d.id:null,'pick-flavour'),
  rate:d=>{tipAct(2);needUser({name:'rate',item:+d.id,from:view})},
  face:d=>saveRating(+d.v),
  'edit-rating':()=>{sheet.editing=true;renderSheet()},
  unrate:removeRating,
  next:nextStep,
  'sheet-second':sheetSecond,
  approve:d=>{tipAct(5);needUser({name:'approve',item:+d.id,brand:d.brand,mine:d.mine==='1'})},
  report:d=>needUser({name:'report',item:+d.id}),
  'wait-all':openWaitAll,
  'open-snack':d=>{closeM();go({v:'category',cc:d.cc,product:+d.product,variant:null,snack:+d.id})},
  'share-list':()=>{if(!page)return;tipAct(6);track('share-list',true);share(`${page.title}: which one wins? Vote on TasteRank`)},
  share:()=>share(),
  'share-snack':d=>{const p=page.pending.find(x=>x.id===+d.id);if(p)share(`Know ${p.pack_name}? Help it onto TasteRank: approve it in ${page.name}.`,snackLink({cc:page.cc,product:page.id,id:p.id}))},
  add:openAdd,
  close:closeM,
  'sign-in':signIn,
  'sign-out':signOut,
  'delete-account':deleteAccount,
  'reset-demo':resetDemo,
  feedback:()=>{showSettings(false);track('feedback-open',true);openM('m-feedback')},
  privacy:()=>{showSettings(false);openM('m-privacy')},
  about:()=>{showSettings(false);toast('The About page is coming soon')},
  settings:()=>showSettings($('#settings-pop').hidden),
  'set-theme':d=>setTheme(d.theme),
  'set-tips':d=>setTips(!!d.on),
  'tips-info':()=>{const p=$('#tips-info'),b=$('[data-act="tips-info"]');p.hidden=!p.hidden;b.setAttribute('aria-expanded',!p.hidden)},
  how:()=>{showSettings(false);openHow()},
  'tip-ok':d=>tipClose(+d.n,'dismissed'),
  owner:()=>{showSettings(false);go({v:'owner'})}
};
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');
  if(!el||el.disabled)return;
  if(el.tagName==='A'&&(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button))return; // a link opened in a new tab
  const f=ACT[el.dataset.act]||ADD_ACT[el.dataset.act]||OWN_ACT[el.dataset.act];if(!f)return;
  e.preventDefault();f(el.dataset);
});
$('#country').addEventListener('change',e=>{prefs.country=e.target.value;prefs.cat='all';savePrefs();renderHome({by:homeBy})});
$('#f-feedback').addEventListener('submit',sendFeedback);

/* ---------- Sign-in: some actions need an account; we come back to them afterwards ---------- */
const AFTER={
  profile:()=>go({v:'profile'}),
  rate:a=>openRate(a.item),
  approve:a=>doApprove(a.item,a.brand,a.mine),
  report:a=>openReport(a.item),
  add:a=>startAdd(),
  owner:()=>go({v:'owner'})
};
function needUser(a){
  if(me)return AFTER[a.name](a);
  store.set('tasterank-after',{...a,hash:location.hash},true); // survives the trip to Google and back
  signInFor(a);openM('m-signin');
}
// Crispy's tip 3: rating or approving signed out, the pop-up names the snack, shows the faces that come next (greyed) and says why
function signInFor(a){
  const it=a.name==='rate'?itemFromPage(a.item):null,p=a.name==='approve'||a.name==='report'?findWaiting(a.item):null,rep=a.name==='report';
  const name=it?it.pack_name:p?p.pack_name:null;
  $('#signin-title').textContent=name?(rep?`Something not right with ${name}?`:`${it?'Rate':'Approve'} ${name}`):'Join TasteRank';
  const m=$('#signin-meta');m.hidden=!it;if(it)m.textContent=`${it.country.flag} ${it.country.short_name} · ${it.where}`;
  const f=$('#signin-faces');f.hidden=!it;if(it)f.innerHTML=FACES.map(x=>`<span class="face-btn"><span>${x.e}</span>${x.l}</span>`).join('');
  $('#signin-why').textContent=name?(rep?'Sign in first, so each person tells us once. Only TasteRank\'s owner sees what you send, and never your name.'
      :`Sign in first, so everyone ${it?'rates':'approves'} each snack once. Other people only see totals, never your name.`)
    :'Sign in to rate snacks and approve new ones.';
  const b=$('#signin-back');b.hidden=!name;
  if(name)b.innerHTML=`You'll come straight back here to ${it?'pick a face':rep?'tell us':'approve it'}. <button class="link" data-act="privacy">Privacy</button>`;
  $('#signin-fine').hidden=!!name&&LIVE; // its privacy line would repeat the one above; the demo note stays
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
  if(me)await Promise.all([loadProfile(),loadOwner()]);
  renderHeader();
  if(next&&next.hash&&next.hash!==location.hash)history.replaceState(null,'',next.hash);
  await route();
  if(me&&next&&AFTER[next.name])AFTER[next.name](next);
  else checkMoments();
}
async function loadProfile(){try{profile=me?await rpc('my_profile'):null}catch(e){profile=null}}
function renderHeader(){
  const b=$('#me-btn');
  b.innerHTML=me?'<svg aria-hidden="true"><use href="#crisp-yum"/></svg><span class="hide-sm">Profile</span>':'Sign in';
  b.classList.toggle('me',!!me);b.classList.toggle('btn-primary',!me); // signed in: a white button like the gear, with Crispy's smile and a drop of drool (design/mockups/profile-icon.html)
  if(me){b.setAttribute('aria-label','Profile');b.title='Your profile'}else{b.removeAttribute('aria-label');b.removeAttribute('title')} // Crispy alone doesn't say "profile": a hover label on computers
}

/* ---------- The floating +: add a snack. Its label says where it adds to. ---------- */
const onCategory=()=>view==='category'&&page&&page.kind==='category'?page:null;
const onBrandPage=()=>view==='brand'&&page&&page.kind==='brandpage'?page:null;
function setFab(){
  const f=$('#add-fab'),c=onCategory(),b=onBrandPage();
  f.hidden=view==='profile'||view==='owner';
  f.setAttribute('aria-label',c?`Add a snack to ${c.name}`:b?`Add a ${b.name} snack`:'Add a snack');
}
function openAdd(){tipAct(7);needUser({name:'add'})}  // a declaration, so the click map above can use it

/* ---------- Adding, in two steps: 1 "What snack is it?" searches TasteRank and Open Food Facts as you type;
   2 "Check it" shows what we filled in, every part of it editable (design/mockups/add.html, A1–A12).
   Where you start only decides what's filled in. Visitors see Category, Brand and Snack: never "ranking", "product" or "variant",
   and the flavour is never asked (the database guesses it and the owner corrects it). ---------- */
let add=null, searchTimer=null, offTimer=null, brandTimer=null, pending=null;
const catalogues={};
const NEW_TAG=' <span class="newtag sm">new</span>';
// The same rules as tidy_case() in the database: commas and stray punctuation between words become spaces
// ("Boundless, Sea Salt" → "Boundless Sea Salt"; "&", apostrophes and "%" stay); then text typed ALL IN CAPITALS or all small
// gets a capital at the start of each word ("TONY'S" → "Tony's"), and mixed capitals ("KitKat") are kept.
// sentence: "Chocolate sweets" style, for category names.
function tidyCase(t,sentence){
  const c=String(t||'').replace(/\s*[,;|*]+\s*/g,' ').replace(/\s+[-–—:]+\s+/g,' ').replace(/\s+/g,' ').trim().replace(/^[ ,;:\-–—]+|[ ,;:\-–—]+$/g,'');
  const mixed=c!==c.toUpperCase()&&c!==c.toLowerCase(),caps=c===c.toUpperCase();
  if(!c||(mixed&&!sentence))return c;
  return c.split(' ').map((w,i)=>{
    const l=w.toLowerCase();
    if(mixed)return i&&/^\p{Lu}[\p{Ll}']+$/u.test(w)?l:w;
    if(/[0-9&]/.test(w)||(caps&&w.length<=2&&!['of','in','on','a','to','n'].includes(l)))return w; // 70%, M&S, KP
    if(i&&(sentence||['and','of','the','with','in','on','a','n','to'].includes(l)))return l;
    return l.replace(/\p{L}/u,ch=>ch.toUpperCase());
  }).join(' ');
}
async function loadCatalogue(c){return catalogues[c]||(catalogues[c]=await rpc('catalogue',{p_country:c}))}
// Every category, including ones set up with no snacks yet (migration 014), so the Category box finds them instead of
// offering a second biscuit category. Before 014 it's the catalogue's own (the visible ones).
const allTypes={};
async function loadTypes(c){
  if(allTypes[c])return allTypes[c];
  try{allTypes[c]=await rpc('category_list',{p_country:c})}catch(e){if(e.code!=='PGRST202')console.error(e);return (catalogues[c]||[]).map(t=>({id:t.id,name:t.name,visible:true}))}
  return allTypes[c];
}
// Every category in a country (Crisps, Toffee), with its type, flavours and Open Food Facts tags
const categoriesIn=c=>(catalogues[c]||[]).flatMap(t=>t.products.map(p=>({...p,type:t.id})));
const categoryBy=(c,id)=>categoriesIn(c).find(p=>p.id===id)||null;
// Visitors call the top level the category (Chocolate, Sweets) and the lists in it subcategories (Toffee); the database calls them
// categories and products. In the add form, add.type is the category and add.product the subcategory.
const typeOf=id=>(categoryBy(add.country,id)||{}).type||null;
const typeName=id=>((catalogues[add.country]||[]).find(t=>t.id===id)||(allTypes[add.country]||[]).find(t=>t.id===id)||{}).name||'';
const hasType=()=>!!(add.type||add.newType),typeLabel=()=>add.newType||typeName(add.type);
const oneType=ids=>{const t=[...new Set(ids.map(typeOf).filter(Boolean))];return t.length===1?t[0]:null};
const bkey=t=>norm(t).replace(/'/g,''); // brands are compared ignoring apostrophes too, so Tyrrell's is Tyrrells
// Live brands that could start these names, looked up by the first few letters of the first word, so "werthers" finds Werther's Original
const brandProbe=t=>String(t||'').replace(/[‘’]/g,"'").trim().split(/\s+/)[0].split("'")[0].slice(0,5);
async function knownBrands(qs){
  const out=new Set();
  for(const q of new Set(qs.map(brandProbe).filter(Boolean)))try{(await rpc('brand_suggest',{q})).forEach(b=>out.add(b.name))}catch(e){}
  return [...out];
}
function editDistance(a,b){ // letters to add, drop or change to turn one into the other
  let prev=[...Array(b.length+1).keys()];
  for(let i=1;i<=a.length;i++){const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur}
  return prev[b.length];
}
// The brand: the longest known brand the name starts with; else Open Food Facts' brand, if the name starts with it (it often lists
// the maker instead: Mars for Maltesers); else the first word.
// A known brand close to the start of the name ("werthers orignal") is offered as "Did you mean Werther's Original" (A8).
function guessBrand(name,known,offB){
  const k=bkey(name),hit=known.filter(b=>k===bkey(b)||k.startsWith(bkey(b)+' ')).sort((a,b)=>b.length-a.length)[0];
  if(hit)return {brand:hit,brandState:'known',brandNear:null};
  offB=offB&&k.startsWith(bkey(offB))?offB:'';
  const ok=offB&&known.find(b=>bkey(b)===bkey(offB));
  if(ok)return {brand:ok,brandState:'known',brandNear:null};
  const brand=offB?tidyCase(offB):tidyCase(String(name||'').trim().split(/\s+/)[0]||'');
  return {brand,brandState:brand?'new':null,brandNear:nearStart(name,brand,known)};
}
function nearStart(name,brand,known){ // a known brand that's nearly how the name starts, and how many of its words it replaces
  const w=bkey(name).split(' ');
  for(const b of known){
    const bk=bkey(b),n=bk.split(' ').length,start=w.slice(0,n).join(' ');
    if(bk===bkey(brand))continue;
    if(start.length>=4&&editDistance(start,bk)<=Math.max(1,Math.floor(bk.length/6)))return {name:b,words:n};
    if(bk.startsWith(bkey(brand)+' '))return {name:b,words:bkey(brand).split(' ').length};
  }
  return null;
}

/* ---------- Open Food Facts, the free food database: packs that aren't on TasteRank yet.
   One request at a time and at most 8 a minute (they allow 10 per visitor), 4 s timeout; any failure just hides the section.
   Their search often answers "busy" (503) at once, so that's tried once more after a moment. ---------- */
const OFF_COUNTRY={GB:'en:united-kingdom',US:'en:united-states',AU:'en:australia',JP:'en:japan',CN:'en:china'};
const offLog=[]; let offBusy=false, offNext=null;
async function offSearch(q,again){
  const now=Date.now();while(offLog.length&&now-offLog[0]>60000)offLog.shift();
  if(offLog.length>=8)return null;
  offLog.push(now);
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),4000);
  try{
    const r=await fetch('https://world.openfoodfacts.org/cgi/search.pl?'+new URLSearchParams({search_terms:q,json:1,page_size:10,
      fields:'code,product_name,brands,categories_tags,countries_tags,quantity,image_front_small_url,image_front_url'}),{signal:ctl.signal});
    if(r.status===503&&!again){clearTimeout(timer);await new Promise(w=>setTimeout(w,800));return offSearch(q,true)}
    if(!r.ok)return null;
    return ((await r.json()).products||[]).filter(p=>String(p.product_name||'').trim());
  }catch(e){return null}finally{clearTimeout(timer)}
}
function offLookup(q,done){ // a newer search waits for the one in flight; older waiting ones are dropped
  if(offBusy){offNext=[q,done];return}
  offBusy=true;
  offSearch(q).then(r=>{offBusy=false;done(r);if(offNext){const [nq,nd]=offNext;offNext=null;offLookup(nq,nd)}});
}
// Open Food Facts lists brands with commas, sometimes the maker or importer first ("Storck", "Conaxess Trade Norway"):
// the brand is the one the name starts with, else the first
const offBrands=p=>String(p.brands||'').split(',').map(b=>b.replace(/[‘’]/g,"'").trim()).filter(Boolean);
const offBrand=p=>{const k=bkey(p.product_name);return offBrands(p).find(b=>k.startsWith(bkey(b)))||offBrands(p)[0]||''};
// The name as on the pack. Open Food Facts often leaves the brand out ("Soft Caramels" by Werther's Original), so it goes in front,
// unless the name already starts with a brand: one listed, or the first word typed in the search
const offName=p=>{const n=tidyCase(String(p.product_name||'').replace(/\s+\d+(?:[.,]\d+)?\s?(?:g|kg|ml|cl|l|oz)\.?\s*$/i,'')),k=bkey(n),b=offBrand(p),typed=bkey(String(add&&add.q||'').trim().split(/\s+/)[0]);
  return !b||k.startsWith(bkey(b))||(typed.length>=3&&k.startsWith(typed))?n:`${tidyCase(b)} ${n}`};
const offImg=u=>/^https:\/\/images\.openfoodfacts\.org\//.test(String(u||''))&&String(u).length<=500?String(u):null;
const offBarcode=p=>p&&/^\d{8,14}$/.test(String(p.code||''))?String(p.code):null;
const offSoldHere=p=>(p.countries_tags||[]).includes(OFF_COUNTRY[(placeBy('id',add.country)||{}).code]);
const offPlace=p=>offSoldHere(p)?placeBy('id',add.country):places.find(pl=>(p.countries_tags||[]).includes(OFF_COUNTRY[pl.code]))||null;
const offPic=p=>{const u=offImg(p.image_front_small_url);
  return `<span class="thumb">${u?`<img src="${esc(u)}" alt="Pack photo: ${esc(p.product_name)}" loading="lazy" onerror="this.remove()">`:'<span aria-hidden="true">🍽️</span>'}</span>`};
// Our categories that file a pack the way Open Food Facts does (en:toffees → Toffee)
const offCategories=p=>{const t=new Set((p&&p.categories_tags)||[]);return categoriesIn(add.country).filter(c=>(c.off_tags||[]).some(x=>t.has(x)))};
// Open Food Facts disagrees with a category when it files the pack somewhere specific (en:chocolate-candies for Maltesers)
// that isn't that category; the broad tags every snack has (en:snacks, en:confectioneries…) don't count
const OFF_BROAD=/^en:(snacks|sweet-snacks|salty-snacks|sugary-snacks|cocoa-and-its-products|confectioneries|frozen-foods|plant-based-foods|plant-based-foods-and-beverages|appetizers|chips-and-fries|snacks-and-desserts)$/;
const offDisagrees=(p,id)=>{const t=((p&&p.categories_tags)||[]).filter(x=>/^en:/.test(x)),mine=(categoryBy(add.country,id)||{}).off_tags||[];
  return t.some(x=>!OFF_BROAD.test(x))&&!t.some(x=>mine.includes(x))};

/* ---------- Starting ---------- */
const freshAdd=o=>Object.assign({from:'home',where:'',step:'find',country:null,ctxProduct:null,ctxVariant:null,ctxBrand:null,ctxBrandProducts:[],ctxType:null,
  q:'',results:null,off:null,offFor:null,sent:null},checkState(),o);
const checkState=()=>({pack:'',offPick:null,offBrand:'',barcode:null,brand:'',brandState:null,brandNear:null,brandSet:false,brandOpen:false,brandSnacks:null,brandFor:null,
  type:null,typeOpen:false,newType:null,typeFind:'',typeError:null,product:null,newCat:null,catAsk:null,catOpen:false,catFind:'',catRefused:null,catError:null,nudge:null,
  dup:null,dupTracked:null,whichForced:false,whichTracked:false,checking:false,checkSeq:0,checkPromise:null,
  touched:false,photo:null,photoUrl:null,ownPhoto:false,score:null,error:null,sending:false});
const whereNow=()=>{const c=onCategory(),b=onBrandPage();return c?`c${c.id}/${c.country.id}`:b?`b${b.id}/${b.country.id}`:'home'};
async function startAdd(again){
  // a saved copy of the old page can be paired with this newer code for a few minutes after an update: reload once to match
  if(!$('#add-body')){if(!store.get('tasterank-reloaded',true)){store.set('tasterank-reloaded',1,true);toast('TasteRank was just updated. Reloading…');setTimeout(()=>location.reload(),900)}else oops(new Error('Add pop-up missing'));return}
  if(add&&!again&&add.step!=='sent'&&add.where===whereNow()){openM('m-add');renderAdd();focusAdd();return} // closed: carry on where they left off
  const cat=again?null:onCategory(),br=again?null:onBrandPage(),from=again?'again':cat?'category':br?'brand':'home';
  add=freshAdd({from,where:whereNow(),country:again?again.country:cat||br?page.country.id:homeCountry().id,q:again?again.pack:''});
  track(again?'add-again':'add-open-'+from,true);
  try{await loadCatalogue(add.country);await loadTypes(add.country)}catch(e){add=null;return oops(e)}
  if(cat)Object.assign(add,{ctxProduct:cat.id,ctxVariant:cat.route.variant||null});
  if(br)Object.assign(add,{ctxBrand:br.name,ctxBrandProducts:br.products.map(p=>p.id),q:br.name+' '});
  if(from==='home'&&prefs.cat!=='all')add.ctxType=+prefs.cat; // the type chip on home: its categories are suggested first
  if(again){openM('m-add');return startCheck({again})}
  renderAdd();openM('m-add');focusAdd();
  if(br)runTyped(); // the brand's snacks straight away (A9)
}
async function startCheck(src){ // step 1 → step 2, with what we could fill in
  const off=src.off||null,again=src.again||null;
  Object.assign(add,checkState(),{step:'check',pack:tidyCase(again?again.pack:off?offName(off):add.q),offPick:off,offBrand:off?offBrand(off):'',
    barcode:offBarcode(off),photoUrl:off?offImg(off.image_front_url):null});
  // The category: where you came from, else Open Food Facts, else the name ("…Crisps"); asked when the page and Open Food Facts
  // disagree (A5), and otherwise once the brand is known (below)
  const fromPage=add.ctxProduct||(add.ctxBrandProducts.length===1?add.ctxBrandProducts[0]:null),offCats=off?offCategories(off):[];
  if(again)add.product=categoryBy(add.country,again.product)?again.product:null;
  else if(fromPage&&off&&offDisagrees(off,fromPage))add.catAsk=fromPage;
  else add.product=fromPage||(offCats[0]||{}).id||(nameCategory(add.pack)||{}).id||null;
  if(!add.product)add.catOpen=!add.catAsk;
  add.type=typeOf(add.product||add.catAsk)||add.ctxType||oneType(add.ctxBrandProducts); // else asked first
  if(again)Object.assign(add,{brand:again.brand,brandState:'new',brandSet:true});
  renderAdd();
  await checkName();
  if(!add||add.step!=='check')return;
  categoryFromBrand();
  if(!add.type)track('add-category-asked',true);
  if(add.catAsk||add.catOpen)track('add-subcategory-asked',true);
  renderMid();focusAdd();
}
function focusAdd(){ // the search box; else the first open question; else the step's heading. Never Send: it would show a focus ring.
  setTimeout(()=>{
    if(!add)return;
    if(add.step==='find'){const q=$('#add-q');if(q){q.focus();q.setSelectionRange(q.value.length,q.value.length)}return}
    const el=add.step==='check'&&openQuestion();
    (el||$('#add-title'))?.focus();
  },0);
}

/* ---------- Checking the name: its brand (unless chosen by hand), whether it's already here (A10), and the brand's other
   snacks, for "Which Tyrrells crisps?" (A7). Send waits for this ("Checking…"). ---------- */
function checkName(){
  const my=++add.checkSeq,name=add.pack;add.checking=true;renderMid();
  add.checkPromise=(async()=>{
    try{
      const [known,found]=await Promise.all([knownBrands([name,add.brand,add.offBrand]),norm(name).length>=2?rpc('search_items',{q:name}).catch(()=>[]):[]]);
      if(!add||add.checkSeq!==my)return;
      if(add.brandSet){const k=known.find(b=>bkey(b)===bkey(add.brand));Object.assign(add,{brand:k||add.brand,brandState:add.brand?(k?'known':'new'):null})}
      else Object.assign(add,guessBrand(name,known,add.offBrand));
      if(add.brandState==='known')brandSpelling();
      add.dup=sameSnack(found)||null;
      await loadBrandSnacks();
    }finally{if(add&&add.checkSeq===my){add.checking=false;renderMid()}}
  })();
  return add.checkPromise;
}
// A name that starts with a known brand starts with it as it's spelt on TasteRank: Werthers Original → Werther's Original
function brandSpelling(){
  const w=add.pack.split(' '),n=add.brand.split(' ').length,start=w.slice(0,n).join(' ');
  if(start===add.brand||bkey(start)!==bkey(add.brand))return;
  const el=$('#add-pack'),typing=el&&el.value!==add.pack;
  add.pack=[add.brand,...w.slice(n)].join(' ');if(el&&!typing){el.value=add.pack;fitPack()}
}
// One snack per name per country: the same name (snack_key) or the same Open Food Facts barcode
const sameSnack=l=>(l||[]).find(x=>x.country_id===add.country&&(snackKey(x.pack_name)===snackKey(add.pack)||(add.barcode&&x.barcode===add.barcode)));
async function loadBrandSnacks(){
  const key=`${bkey(add.brand)}|${add.country}`;if(add.brandFor===key)return;
  add.brandFor=key;add.brandSnacks=[];
  if(add.brandState!=='known')return;
  try{const l=await rpc('search_items',{q:add.brand});if(add&&add.brandFor===key)add.brandSnacks=l.filter(x=>bkey(x.brand)===bkey(add.brand)&&x.country_id===add.country)}catch(e){}
}
// Just the brand as the name, when the brand already has a snack in this category here: the name has to say which (A7)
function whichSnack(){
  if(add.dup||!add.product||add.newCat||!add.pack||snackKey(add.pack)!==snackKey(add.brand))return null;
  const here=(add.brandSnacks||[]).filter(x=>x.product_id===add.product);
  return here.length||add.whichForced?here:null;
}
// A category the name says outright: "Walkers Prawn Cocktail Crisps" is Crisps (every word of its name, plural or not)
const stem=w=>w.replace(/(\p{L}{3})s$/u,'$1'); // toffees → toffee, crisps → crisp
function nameCategory(name){
  const w=new Set(snackKey(name).split(' ').map(stem));
  return categoriesIn(add.country).filter(c=>snackKey(c.name).split(' ').every(x=>w.has(stem(x)))).sort((a,b)=>b.name.length-a.name.length)[0]||null;
}
// Still no subcategory, and nothing typed for it: a known brand whose snacks here are all in one is a good guess,
// but only a guess (Tyrrells makes popcorn too), so it's asked: "Does it belong in Toffee?". Never outside the category chosen.
function categoryFromBrand(){
  const cats=[...new Set((add.brandSnacks||[]).map(x=>x.product_id))];
  if(!add.newType&&add.catOpen&&!add.catFind&&!add.catRefused&&cats.length===1&&categoryBy(add.country,cats[0])&&(!add.type||typeOf(cats[0])===add.type))
    Object.assign(add,{catAsk:cats[0],catOpen:false,type:typeOf(cats[0])});
}
const catName=()=>add.newCat||(categoryBy(add.country,add.product)||{}).name||'';
// What still needs an answer before Send, in the order shown: the element to take them to
function openQuestion(){
  if(!add.pack||whichSnack())return $('#add-pack');
  if(add.brandOpen||!add.brandState)return $('#add-brand');
  if(add.typeOpen||!hasType())return $('#row-type .chip.on')||$('#row-type .chip')||$('#add-type');
  if(add.catAsk)return $('#row-cat .chip');
  if(add.catOpen||(!add.product&&!add.newCat))return $('#row-cat .chips .chip')||$('#add-cat'); // a chip, not the box: the keyboard would cover the chips
  return null;
}
const hasQuestion=()=>!add.pack||!!whichSnack()||add.brandOpen||!add.brandState||add.typeOpen||!hasType()||!!add.catAsk||add.catOpen||(!add.product&&!add.newCat);

/* ---------- Answers ---------- */
// Typed answers are saved when the box is left, a moment later, so a tap on a chip beside it still counts
function later(fn){clearPending();pending={fn,t:setTimeout(()=>{const f=pending.fn;pending=null;if(add)f()},250)}}
function clearPending(){if(pending){clearTimeout(pending.t);pending=null}}
async function flushPending(){if(pending){const f=pending.fn;clearPending();await f()}}
function commitPack(v){ // the name, tidied as it will be saved; the tidied text shows in the box
  const t=tidyCase(v),el=$('#add-pack');if(el&&el.value!==t){el.value=t;fitPack()}
  if(t===add.pack)return;
  Object.assign(add,{pack:t,touched:true,whichForced:false});
  return checkName();
}
async function answerBrand(name){
  clearPending();
  const v=tidyCase(name);if(!v)return;
  const k=(await knownBrands([v])).find(b=>bkey(b)===bkey(v));if(!add)return;
  Object.assign(add,{brand:k||v,brandState:k?'known':'new',brandNear:null,brandSet:true,brandOpen:false,touched:true});
  renderMid();await loadBrandSnacks();categoryFromBrand();renderMid();focusAdd();
}
function answerType(id){ // a subcategory that isn't in the new category is asked again; a new one moves with it
  clearPending();
  const ok=x=>x&&typeOf(x)===id;
  Object.assign(add,{type:id,newType:null,typeOpen:false,typeFind:'',typeError:null,nudge:null,touched:true});
  if(add.product&&!ok(add.product))Object.assign(add,{product:null,catOpen:true});
  if(add.catAsk&&!ok(add.catAsk))Object.assign(add,{catAsk:null,catOpen:true});
  if(add.catRefused&&!ok(add.catRefused))add.catRefused=null;
  renderMid();focusAdd();
}
// A category that isn't here yet: its subcategory has to be new too ("Cakes is new, so name its first subcategory")
function answerNewType(name){
  clearPending();
  Object.assign(add,{type:null,newType:name,typeOpen:false,typeFind:'',typeError:null,nudge:null,touched:true,catAsk:null,catRefused:null});
  if(add.product)add.product=null;
  if(!add.newCat)add.catOpen=true;
  track('add-new-category',true);
  renderMid();focusAdd();
}
function answerCategory(id,newName){ // picking a subcategory from another category moves the category too
  clearPending();
  Object.assign(add,{product:newName?null:id,type:newName?add.type:typeOf(id)||add.type,newType:newName?add.newType:null,newCat:newName||null,catAsk:null,catOpen:false,catFind:'',catError:null,nudge:null,touched:true});
  if(newName)track('add-new-subcategory',true);
  renderMid();focusAdd();
}
async function setCountry(c){ // the category stays if it's sold there too; the name is checked again for that country
  add.country=c;try{await loadCatalogue(c);await loadTypes(c)}catch(e){return oops(e)}
  if(add.product&&!categoryBy(c,add.product))Object.assign(add,{product:null,catOpen:true});
  if(add.type&&!(allTypes[c]||catalogues[c]||[]).some(t=>t.id===add.type))add.type=null;
  add.touched=true;add.countryOpen=false;add.brandFor=null;
  renderMid();await checkName();focusAdd();
}
// Subcategory words that start with what's typed: "choc" finds Chocolate bars, in this category first, then any
function catMatches(t){
  const tw=snackKey(t).split(' ').filter(Boolean);if(!tw.length)return [];
  return categoriesIn(add.country).filter(c=>tw.every(x=>snackKey(c.name).split(' ').some(y=>y.startsWith(x))))
    .sort((a,b)=>(snackKey(b.name)===snackKey(t))-(snackKey(a.name)===snackKey(t))||(a.type!==add.type)-(b.type!==add.type)||a.name.length-b.name.length).slice(0,4);
}
function catSuggestions(){ // the chips: this category's subcategories, the brand's own and where you came from first, then the home order
  const mine=new Set([...add.ctxBrandProducts,...(add.brandSnacks||[]).map(x=>x.product_id)]);
  const h=new Map(homeCats(add.country).map(c=>[c.id,c])),r=c=>(h.get(c.id)||{}).ratings||0,n=c=>(h.get(c.id)||{}).snacks||0;
  const rank=c=>mine.has(c.id)?0:c.id===add.ctxProduct?1:2;
  return categoriesIn(add.country).filter(c=>c.type===add.type) // the one turned down stays, so a wrong tap on "Something else" is one tap to undo
    .sort((a,b)=>rank(a)-rank(b)||r(b)-r(a)||n(b)-n(a)||a.name.localeCompare(b.name)).slice(0,6);
}
// The box's example is a subcategory that isn't here yet, so it never repeats a chip (category ids: 1 Chocolate, 2 Sweets, 3 Crisps & Snacks)
const SUB_EXAMPLES={1:['Chocolate buttons','Chocolate eggs','Truffles'],2:['Jelly sweets','Liquorice','Marshmallows','Mints'],3:['Popcorn','Pretzels','Nuts','Tortilla chips']};
function catExample(){const have=new Set(categoriesIn(add.country).map(c=>snackKey(c.name)));return (SUB_EXAMPLES[add.type]||[]).find(x=>!have.has(snackKey(x)))||''}

/* ---------- Drawing it ---------- */
const stepBar=n=>`<div class="flow-top"><button class="link" data-act="${n===1?'add-cancel':'add-back'}">${n===1?'Cancel':'← Back'}</button><div class="steps" aria-label="Step ${n} of 2">${[1,2].map(k=>`<i${k<=n?' class="on"':''}></i>`).join('')}<span aria-hidden="true">${n} of 2</span></div></div>`;
function searchExample(){ // "Brand or name, e.g. Walkers crisps", from the list you're on or the categories on home
  const c=onCategory();if(c&&c.items.length)return `Brand or name, e.g. ${c.items[0].brand} ${c.name.toLowerCase()}`;
  const cs=homeCats(add.country).filter(c=>!add.ctxType||c.type_id===add.ctxType),top=cs.find(c=>c.top.length);
  return top?`Brand or name, e.g. ${top.top[0].brand} ${top.name.toLowerCase()}`:cs[0]?`Brand or name, e.g. ${cs[0].name.toLowerCase()}`:'Brand or name, e.g. Walkers salt';
}
function renderAdd(){
  const b=$('#add-body'),cp=placeBy('id',add.country)||{flag:'',name:'',short_name:''};
  if(add.step==='find'){
    const head=add.from==='category'?`Add to ${esc((categoryBy(add.country,add.ctxProduct)||{}).name||page.name)}`:add.from==='brand'?`Add a ${esc(add.ctxBrand)} snack`:'What snack is it?';
    b.innerHTML=`${stepBar(1)}<h3 id="add-title" tabindex="-1">${head}</h3>
      <p class="meta add-sub">${add.from==='category'||add.from==='brand'?`${cp.flag} ${esc(cp.short_name)} · `:''}Type what's on the pack.</p>
      <div class="field"><input id="add-q" type="search" placeholder="${esc(searchExample())}" aria-label="What's on the pack" autocomplete="off" maxlength="120" value="${esc(add.q)}"></div>
      <div id="add-results"></div>`;
    renderResults();return;
  }
  if(add.step==='check'){
    b.innerHTML=`${stepBar(2)}<h3 id="add-title" class="sr-only" tabindex="-1">Check it</h3><div id="add-crispy"></div>
      <label class="lab flab" for="add-pack">Name on the pack</label>
      <textarea id="add-pack" class="row-input pack-input" rows="1" maxlength="120" autocomplete="off" spellcheck="false">${esc(add.pack)}</textarea>
      <div id="add-mid"></div>`;
    fitPack();renderMid();return;
  }
  const s=add.sent,left=settings.approval_votes-1;
  b.innerHTML=`<div class="thanks"><div class="party" aria-hidden="true">🥳</div>
    <h3 id="add-title" tabindex="-1">${s.newCat?"Thanks! It's waiting for a check":"Thanks! It's waiting for approval"}</h3>
    <p class="meta sent-what">${esc(s.name)}, in ${s.typeName?`<span class="up">${esc(s.typeName)}</span> › `:''}${esc(s.category)}</p>
    <p class="sent-next">${s.newType?`We'll check the new category ${esc(s.typeName)} first, then it goes to the vote.`:s.newCat?`We'll check ${esc(s.category)} first, then it goes to the vote.`:`It needs ${left} more approval${left===1?'':'s'}. Friends can approve it from the link.`}</p>
    ${s.newCat?'':'<button class="btn btn-primary btn-block" data-act="add-share">Share the link</button>'}
    <button class="btn btn-block${s.newCat?' btn-primary':''}" data-act="add-done">${s.newCat?'Back home':`Back to ${esc(s.category)}`}</button></div>`;
}
// The name box grows to show a long name in full (Enter saves it rather than starting a new line)
function fitPack(){const t=$('#add-pack');if(t){t.style.height='auto';t.style.height=t.scrollHeight+2+'px'}}
// Step 1: TasteRank's own matches (Rate), then Open Food Facts packs that aren't on TasteRank yet (Add)
function trList(){ // this country first; from a list, its own matches first
  const mine=x=>add.ctxProduct?x.product_id===add.ctxProduct:add.ctxBrand?bkey(x.brand)===bkey(add.ctxBrand):true;
  const rank=x=>(x.country_id===add.country?0:2)+(mine(x)?0:1);
  return [...add.results].sort((a,b)=>rank(a)-rank(b)).slice(0,5);
}
function offList(){ // leaving out packs that are on TasteRank: the same barcode, or the same tidy name
  const tr=add.results||[],codes=new Set(tr.map(x=>x.barcode).filter(Boolean)),keys=new Set(tr.map(x=>snackKey(x.pack_name)));
  const l=(add.off||[]).filter(p=>!codes.has(offBarcode(p))&&!keys.has(snackKey(offName(p))));
  return [...l.filter(offSoldHere),...l.filter(p=>!offSoldHere(p))].slice(0,tr.length?3:4);
}
const matchRow=(x,act='add-open-match')=>{const pl=placeBy('id',x.country_id)||{},live=x.status==='live';
  return `<div class="offr">${thumb(x)}<div><div class="nm">${esc(x.pack_name)}</div><div class="meta">${esc(x.product)}${x.country_id!==add.country?` · ${pl.flag} ${esc(pl.short_name)}`:''} · ${live?plural(x.ratings,'rating'):'waiting for approval'}</div></div>
    <button class="btn${live?' btn-primary':''}" data-act="${act}" data-id="${x.id}" data-cc="${esc(pl.code||'')}" data-product="${x.product_id}" data-live="${live?1:''}" aria-label="${live?'Rate':'See'} ${esc(x.pack_name)}">${live?'Rate':'See it'}</button></div>`};
function renderResults(){
  const el=$('#add-results');if(!el)return;
  const q=add.q.trim();
  if(norm(q).length<2){el.innerHTML=`<p class="hint">Search first, so nothing gets added twice.</p>`;return}
  if(!add.results){el.innerHTML='<p class="hint">Searching…</p>';return}
  const tr=trList(),offDone=norm(q).length<3||add.offFor===q,off=offDone?offList():[];
  const addTyped=`<button class="btn btn-primary btn-block" data-act="add-new">Add "${esc(tidyCase(q))}" →</button>`;
  if(!tr.length&&!off.length){ // nothing here; Open Food Facts is still looking, or found nothing too (A1b)
    el.innerHTML=offDone?`<div class="mini"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-confused"/></svg><span>Nothing called that yet. You can be the first to add it!</span></div>${addTyped}`
      :`<p class="hint">Not on TasteRank yet. Looking on Open Food Facts…</p>${addTyped}`;
    return;
  }
  let h='';
  if(tr.length)h+=`<h4 class="lab res-h">On TasteRank</h4>`+tr.map(x=>matchRow(x)).join('');
  if(off.length)h+=`<h4 class="lab res-h">Not on TasteRank yet</h4>`+off.map((p,i)=>{const pl=offPlace(p);
      return `<div class="offr">${offPic(p)}<div><div class="nm">${esc(offName(p))}</div>
        <div class="meta">${[pl?`${pl.flag} ${esc(pl.short_name)}`:'',esc(p.quantity||'')].filter(Boolean).join(' · ')}</div></div>
        <button class="btn" data-act="add-off-pick" data-i="${i}" aria-label="Add ${esc(offName(p))}">Add</button></div>`}).join('')
    +'<p class="src">From Open Food Facts</p>';
  el.innerHTML=h+'<button class="btn btn-block addme" data-act="add-new">None of these: add it myself →</button>';
}
// Step 2: everything below the name box. Redrawn on its own, so typing in the box is never interrupted.
function renderMid(){
  const el=$('#add-mid');if(!el||add.step!=='check')return;
  const a=document.activeElement,keep=a&&el.contains(a)?{id:a.id,act:a.dataset.act,row:a.dataset.row,v:a.tagName==='INPUT'?a.value:null,s:a.selectionStart,e:a.selectionEnd}:null;
  drawMid(el);
  if(!keep)return;
  const n=keep.id?document.getElementById(keep.id):keep.act&&el.querySelector(`[data-act="${keep.act}"]${keep.row?`[data-row="${keep.row}"]`:''}`);
  if(!n)return;
  if(keep.v!==null&&n.tagName==='INPUT'&&n.type!=='file'){n.value=keep.v;try{n.setSelectionRange(keep.s,keep.e)}catch(x){}}
  n.focus();
}
function drawMid(el){
  const cr=$('#add-crispy'),d=add.dup,which=whichSnack();
  cr.innerHTML=!add.touched&&!add.checking&&!d&&!add.brandNear&&!hasQuestion()
    ?`<div class="crispy-line"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-joy"/></svg><span>Found it all. Check it, then send.</span></div>`:'';
  if(d){ // A10: already here, so no Send
    if(add.dupTracked!==d.id){add.dupTracked=d.id;track('add-duplicate',true)}
    const live=d.status==='live',cp=placeBy('id',add.country)||{};
    el.innerHTML=`<div class="alert" role="status"><b>Already on TasteRank</b><span>It's in ${esc(d.product)}.</span></div>
      <div class="match">${thumb({...d,emoji:d.emoji||(categoryBy(add.country,d.product_id)||{}).emoji||'🍽️'},'sm')}<div><div class="nm">${esc(d.pack_name)}</div><div class="meta">${esc(d.product)} · ${live?plural(d.ratings||0,'rating'):'waiting for approval'}</div></div>
        <button class="btn btn-primary" data-act="add-open-match" data-id="${d.id}" data-cc="${esc(cp.code||'')}" data-product="${d.product_id}" data-live="${live?1:''}">${live?'Rate it':'See it'}</button></div>
      <p class="hint">A different snack? Change the name to what's on your pack.</p>`;
    return;
  }
  if(which){ // A7: the name has to say which one
    if(!add.whichTracked){add.whichTracked=true;track('add-which-snack',true)}
    const ex=which.find(x=>snackKey(x.pack_name)!==snackKey(add.brand)),cat=catName().toLowerCase();
    el.innerHTML=`<div class="mustq" role="status"><p class="q">Which ${esc(add.brand)} ${esc(cat)}?</p><span class="hint">Type the full name on the pack${ex?`, like "${esc(ex.pack_name)}"`:''}.</span></div>
      ${which.length?`<h4 class="lab res-h">${esc(add.brand)} on TasteRank</h4>${which.slice(0,4).map(x=>matchRow(x)).join('')}`:''}
      ${sendHtml()}`;
    return;
  }
  const q=hasQuestion(),n=settings.approval_votes;
  const tried=`<div class="field tried"><span class="lab">Tried it? <span class="optional">(optional)</span></span><div class="faces sm">${FACES.map(f=>
    `<button class="face-btn${add.score===f.v?' on':''}" aria-pressed="${add.score===f.v}" aria-label="${f.l}" data-act="add-face" data-v="${f.v}"><span aria-hidden="true">${f.e}</span></button>`).join('')}</div></div>`;
  const photo=add.photoUrl&&!add.ownPhoto
    ?`<div class="photo-row"><span class="thumb big"><img src="${esc(add.photoUrl)}" alt="Pack photo: ${esc(add.pack)}"></span><div><span class="src">Photo from Open Food Facts</span><br><button class="link" data-act="add-own-photo">Use my own photo</button></div></div>${tried}`
    :`<div class="photo-tried"><label class="upload${add.photo?' has-photo':''}">${add.photo?`<img src="${add.photo.url}" alt="Your photo"><span class="change">Change</span>`:'<span class="cam" aria-hidden="true">📷</span>Add photo<span class="optional">optional</span>'}
        <input type="file" id="add-photo" accept="image/*" class="sr-only"></label>${tried}</div>`;
  el.innerHTML=`<div class="rows">${brandRow()}${typeRow()}${catRow()}${countryRow()}</div>
    ${q?'':photo+`<p class="rule">${add.newCat?`We check ${add.newType?'new categories':'new subcategories'} first. Then it needs ${n} approvals.`:`It needs ${n} approvals to go live, and yours counts as the first.`}</p>`}
    ${sendHtml()}`;
  if(add.brandOpen)renderBrandHelp();
}
function sendHtml(){
  return `<div id="add-error">${add.error?`<div class="sheet-error" role="alert"><b>It didn't send.</b> Please try again.<small>${esc(add.error)}</small></div>`:''}</div>
    <button class="btn btn-primary btn-block" id="add-send" data-act="add-send"${add.sending?' disabled':''}>${add.sending?'Sending…':add.checking?'Checking…':hasQuestion()?'Next':add.newCat?'Send for a check':'Send for approval'}</button>`;
}
const answered=(row,label,val,sub)=>`<div class="row" role="group" aria-labelledby="rl-${row}" id="row-${row}"><span class="lab" id="rl-${row}">${label}</span>
  <button class="link" data-act="add-change" data-row="${row}" aria-label="Change ${label.toLowerCase()}">Change</button><span class="val">${val}</span>${sub?`<span class="sub">${sub}</span>`:''}</div>`;
function brandRow(){
  if(!add.brandOpen&&add.brandState)return answered('brand','Brand',`${esc(add.brand)}${add.brandState==='known'?' <span class="ok">✓ on TasteRank</span>':NEW_TAG}`,
    add.brandNear?`Did you mean <button class="chip sm" data-act="add-brand-near">${esc(add.brandNear.name)}</button>`:'');
  return `<div class="row ask" role="group" aria-labelledby="rl-brand" id="row-brand"><label class="lab" id="rl-brand" for="add-brand">Brand</label>
    <input id="add-brand" class="row-input" value="${esc(add.brand)}" maxlength="60" autocomplete="off" placeholder="Who makes it?" aria-describedby="brand-help"><div id="brand-help" class="hint"></div></div>`;
}
// What Next needs goes in a line that's already there (the question, or the box's label), never a new line or box
const nudged=row=>add.nudge?.row===`row-${row}`,nudge=(row,text)=>nudged(row)?esc(add.nudge.text||text):'',alertIf=on=>on?' role="alert"':'';
const waitRow=(row,label,text)=>`<div class="row wait" id="row-${row}"><span class="lab">${label}</span><span class="val hint">${text}</span></div>`;
function typeRow(){ // the category: chips for the most used, then a box that finds the rest or adds a new one, like the subcategory
  if(add.checking&&!add.touched&&!hasType())return waitRow('type','Category','Checking…');
  if(hasType()&&!add.typeOpen)return answered('type','Category',`${esc(typeLabel())}${add.newType?NEW_TAG:''}`);
  const q=!hasType(),said=add.nudge?.row==='row-type'&&add.nudge.text,ex=typeExample();
  return `<div class="row ask" role="group" aria-labelledby="rl-type${q?' type-q':''}" id="row-type"><span class="lab" id="rl-type">Category</span>
    ${q?`<div class="q" id="type-q"${alertIf(nudged('type')&&!said)}>Which category is it?${said?'':nudge('type',' Pick one to go on.')}</div>`:''}
    <div class="chips wrap">${typesInOrder(add.country).slice(0,6).map(t=>`<button class="chip${t.id===add.type?' on':''}" aria-pressed="${t.id===add.type}" data-act="add-type" data-id="${t.id}">${esc(t.name)}</button>`).join('')}</div>
    <label class="hint add-it" for="add-type"${alertIf(said)}>${said?esc(said):'Not listed? Add it:'}</label>
    <input id="add-type" class="row-input" type="search" maxlength="40" autocomplete="off" value="${esc(add.typeFind)}"${ex?` placeholder="e.g. ${esc(ex)}"`:''} aria-describedby="type-find">
    <div id="type-find" aria-live="polite">${typeFindHtml()}</div>
    ${add.typeError?`<p class="sheet-error" role="alert">${esc(add.typeError)}</p>`:''}</div>`;
}
// Category words that start with what's typed, from every category (those with no snacks yet too)
function typeMatches(t){
  const tw=snackKey(t).split(' ').filter(Boolean);if(!tw.length)return [];
  return (allTypes[add.country]||catalogues[add.country]||[]).filter(c=>tw.every(x=>snackKey(c.name).split(' ').some(y=>y.startsWith(x))))
    .sort((a,b)=>(snackKey(b.name)===snackKey(t))-(snackKey(a.name)===snackKey(t))||a.name.length-b.name.length).slice(0,4);
}
function typeFindHtml(){ // under the box, once something's typed: matching categories, else "＋ New category"
  const t=tidyCase(add.typeFind,true);if(!norm(t).length)return '';
  const ms=typeMatches(t),chips=ms.map(c=>`<button class="chip${c.id===add.type?' on':''}" aria-pressed="${c.id===add.type}" data-act="add-type" data-id="${c.id}">${esc(c.name)}</button>`);
  if(norm(t).length>=2&&!ms.length){const n=!!add.newType&&norm(add.newType)===norm(t);
    chips.push(`<button class="chip chip-new${n?' on':''}" aria-pressed="${n}" data-act="add-type-new">＋ New category: ${esc(t)}</button>`)}
  return `${chips.length?`<div class="chips wrap">${chips.join('')}</div>`:''}
    <div class="hint">A whole type of snack, like Biscuits or Nuts, not one kind.</div>`;
}
// The box's example is a category that isn't set up yet
const TYPE_EXAMPLES=['Cakes','Dried fruit','Pastries'];
function typeExample(){const have=new Set((allTypes[add.country]||catalogues[add.country]||[]).map(c=>snackKey(c.name)));return TYPE_EXAMPLES.find(x=>!have.has(snackKey(x)))||''}
function catRow(){ // the subcategory: tap one of the category's own; type only one that isn't there
  if(add.catAsk){
    const p=categoryBy(add.country,add.catAsk)||{name:''};
    return `<div class="row ask" role="group" aria-labelledby="rl-cat cat-q" id="row-cat"><span class="lab" id="rl-cat">Subcategory</span>
      <div class="q" id="cat-q"${alertIf(nudged('cat'))}>Does it belong in ${esc(p.name)}?${nudge('cat',' Tap Yes or Something else.')}</div>
      <div class="chips wrap"><button class="chip" data-act="add-cat-yes">Yes</button><button class="chip" data-act="add-cat-else">Something else</button></div></div>`;
  }
  if(add.checking&&!add.touched&&add.catOpen)return waitRow('cat','Subcategory','Checking…');
  if(!hasType()&&!add.product)return waitRow('cat','Subcategory','Pick the category first');
  if(add.catOpen||(!add.product&&!add.newCat)){
    const sug=catSuggestions(),ex=catExample(),n=nudge('cat',sug.length?'Pick one above, or add a new one:':'Type the kind of snack to go on:');
    const first=!sug.length&&hasType()?(add.newType?`${add.newType} is new, so name its first subcategory:`:`Nothing's in ${typeName(add.type)} yet, so name its first subcategory:`):''; // an empty category
    return `<div class="row ask" role="group" aria-labelledby="rl-cat" id="row-cat">${sug.length?'<span class="lab" id="rl-cat">Subcategory</span>':'<label class="lab" id="rl-cat" for="add-cat">Subcategory</label>'}
      ${sug.length?`<div class="chips wrap">${sug.map(c=>catChip(c,'list')).join('')}</div><label class="hint add-it" for="add-cat"${alertIf(n)}>${n||'Not listed? Add it:'}</label>`:n?`<label class="hint add-it" for="add-cat" role="alert">${n}</label>`:first?`<span class="hint add-it" id="cat-first">${esc(first)}</span>`:''}
      <input id="add-cat" class="row-input" type="search" maxlength="60" autocomplete="off" value="${esc(add.catFind)}"${ex?` placeholder="e.g. ${esc(ex)}"`:''} aria-describedby="${first&&!n?'cat-first ':''}cat-find">
      <div id="cat-find" aria-live="polite">${catFindHtml()}</div>
      ${add.catError?`<p class="sheet-error" role="alert">${esc(add.catError)}</p>`:''}</div>`;
  }
  return answered('cat','Subcategory',`${esc(catName())}${add.newCat?NEW_TAG:''}`);
}
const catChip=(c,src)=>{const on=c.id===add.product;
  return `<button class="chip${on?' on':''}" aria-pressed="${on}" data-act="add-cat-pick" data-id="${c.id}" data-src="${src}">${esc(c.name)}${c.type!==add.type?` <span class="in">in ${esc(typeName(c.type))}</span>`:''}</button>`};
function catFindHtml(){ // under the box, once something's typed: matches (one in another category says where), else "＋ New subcategory"
  const t=tidyCase(add.catFind,true);if(!norm(t).length)return '';
  const ms=catMatches(t),chips=ms.map(c=>catChip(c,'typed'));
  if(norm(t).length>=2&&!ms.length){const n=!!add.newCat&&norm(add.newCat)===norm(t);
    chips.push(`<button class="chip chip-new${n?' on':''}" aria-pressed="${n}" data-act="add-cat-new">＋ New subcategory: ${esc(t)}</button>`)}
  return `${chips.length?`<div class="chips wrap">${chips.join('')}</div>`:''}
    <div class="hint">Name the kind of snack, not the brand or flavour.</div>`;
}
function countryRow(){
  const cp=placeBy('id',add.country)||{flag:'',name:''};
  if(!add.countryOpen)return answered('country','Sold in',`${cp.flag} ${esc(cp.name)}`);
  return `<div class="row ask" role="group" aria-labelledby="rl-country" id="row-country"><label class="lab" id="rl-country" for="add-country">Sold in</label>
    <select id="add-country" class="row-input">${places.map(p=>`<option value="${p.id}"${p.id===add.country?' selected':''}>${p.flag} ${esc(p.name)}</option>`).join('')}</select></div>`;
}
async function renderBrandHelp(){ // under the brand box: ✓ on TasteRank, or "＋ New brand", plus known brands that match
  const help=$('#brand-help'),inp=$('#add-brand');if(!help||!inp)return;
  const v=tidyCase(inp.value),k=bkey(v);
  if(!k){help.innerHTML='';return}
  const sugg=(await knownBrands([v])).filter(s=>bkey(s).includes(k)||k.includes(bkey(s)));
  if(!$('#add-brand')||bkey(tidyCase($('#add-brand').value))!==k)return; // typing moved on
  const exact=sugg.find(s=>bkey(s)===k);
  $('#brand-help').innerHTML=(exact?`<span class="ok">✓ on TasteRank</span>`:`<span class="newtag">＋ New brand: ${esc(v)}</span>`)
    +sugg.filter(s=>bkey(s)!==k).slice(0,4).map(s=>`<button class="chip" data-act="add-brand-pick" data-name="${esc(s)}">${esc(s)}</button>`).join('');
}
async function shrinkPhoto(file){ // max 800 px on the long side, JPEG, never over 1 MB
  const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('Couldn\'t read that photo. Try another one.'));i.src=URL.createObjectURL(file)});
  const k=Math.min(1,800/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');
  c.width=Math.round(img.naturalWidth*k);c.height=Math.round(img.naturalHeight*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  URL.revokeObjectURL(img.src);
  let q=.8,blob;do{blob=await new Promise(r=>c.toBlob(r,'image/jpeg',q));q-=.15}while(blob&&blob.size>1e6&&q>.3);
  if(!blob||blob.size>1e6)throw new Error('That photo is too big. Try another one.');
  return {blob,url:URL.createObjectURL(blob),dataUrl:LIVE?null:c.toDataURL('image/jpeg',.6)};
}
async function uploadPhoto(blob){
  const path=`${me.id}/${(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2))}.jpg`;
  must(await sb.storage.from('product-photos').upload(path,blob,{contentType:'image/jpeg',cacheControl:'31536000',upsert:false}));
  return path;
}

/* ---------- Sending ---------- */
// The flavour hint for guess_variant(): the chip picked on the list you came from, else a flavour Open Food Facts files the pack under
function variantHint(){
  if(add.ctxVariant&&add.product===add.ctxProduct)return add.ctxVariant;
  const t=new Set((add.offPick&&add.offPick.categories_tags)||[]);
  return (((categoryBy(add.country,add.product)||{}).variants||[]).find(v=>(v.off_tags||[]).some(x=>t.has(x)))||{}).id||null;
}
async function sendAdd(){
  if(!add||add.sending)return;
  await flushPending();
  if(add.checking){const b=$('#add-send');if(b)b.textContent='Checking…';await add.checkPromise;if(!add)return}
  const bb=add.brandOpen&&$('#add-brand');if(bb&&tidyCase(bb.value))await answerBrand(bb.value);if(!add)return;
  if(add.catOpen&&norm(tidyCase(add.catFind,true)).length&&commitCatTyped())return; // Next takes what's typed, then stops so it can be checked
  if((add.typeOpen||!hasType())&&norm(tidyCase(add.typeFind,true)).length&&commitTypeTyped())return; // what's typed in the Category box, as for the subcategory
  if(add.typeOpen&&add.type)return answerType(add.type); // opened with Change and left as it was: keep it
  if(add.typeOpen&&add.newType)return answerNewType(add.newType);
  if(add.catOpen&&add.product&&!add.catFind.trim())return answerCategory(add.product);
  let q=openQuestion();
  if(q){ // never a silently greyed-out button: take them to what's left, saying what it needs
    const r=q.closest('.row')?.id;
    if((r==='row-type'||r==='row-cat')&&add.nudge?.row!==r){add.nudge={row:r};renderMid();q=openQuestion()}
    (q.closest('.row,.mustq')||q).scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    if(whichSnack())$('#add-mid .mustq')?.scrollIntoView({block:'center'});
    return q.focus();
  }
  if(add.dup)return renderMid();
  const brand=add.brand,pack=add.pack,review=!!add.newCat,cp=placeBy('id',add.country);
  add.sending=true;add.error=null;renderMid();
  const url=add.photo||add.ownPhoto?null:add.photoUrl;
  let res,path=null;
  try{
    if(add.photo&&LIVE){path=await uploadPhoto(add.photo.blob);track('photo-upload',true)}
    const extra={p_image_path:path,p_image_url:url,p_barcode:add.barcode,p_score:add.score};
    const args=review?{p_country:add.country,p_new_category:add.newCat,p_brand_name:brand,p_pack_name:pack,p_category:add.type,...(add.newType?{p_new_type:add.newType}:{}),...extra}
      :{p_country:add.country,p_product:add.product,p_brand_name:brand,p_pack_name:pack,p_variant_hint:variantHint(),...extra};
    if(!LIVE&&add.photo)args.p_demo_image=add.photo.dataUrl;
    res=await rpc(review?'submit_new_category':'submit_snack',args).catch(e=>{ // before migration 011, the database doesn't know p_category yet
      if(review&&e.code==='PGRST202'&&!args.p_new_type){delete args.p_category;return rpc('submit_new_category',args)}throw e});
  }catch(e){
    add.sending=false;const m=e.message||String(e);
    if(e.code==='23505'){ // a new category's snack that's already here
      try{add.dup=JSON.parse(e.details||'null')}catch(x){add.dup=null}
      if(!add.dup)await checkName();
      return renderMid();
    }
    const takenType=/^Category (.+) is already on TasteRank/.exec(m); // a new category someone else got in first
    if(takenType){delete allTypes[add.country];await loadTypes(add.country);if(!add)return;
      Object.assign(add,{typeOpen:true,typeFind:add.newType,newType:null,typeError:`${takenType[1]} is already here. Pick it below.`});renderMid();return $('#add-type')?.focus()}
    if(/already a category/i.test(m)){Object.assign(add,{catOpen:true,catFind:add.newCat,newCat:null,catError:`${add.newCat} is already here. Pick it below.`});renderMid();return $('#add-cat')?.focus()}
    if(/Type the full name/i.test(m)){add.whichForced=true;add.brandFor=null;await loadBrandSnacks();renderMid();return $('#add-pack')?.focus()}
    console.error(e);add.error=m;return renderMid();
  }
  if(res&&res.duplicate){add.sending=false;add.dup=res.duplicate;return renderMid()}
  if(review)emailOwner(add.newType?`TasteRank: check new category "${add.newType}" and subcategory "${add.newCat}"`:`TasteRank: check new subcategory "${add.newCat}"`,
    `Sold in: ${cp.name}\nCategory: ${typeLabel()}${add.newType?' (new)':''}\nNew subcategory: ${add.newCat}\nBrand: ${brand}\nName on the pack: ${pack}\nPhoto: ${path?'uploaded':url?'from Open Food Facts':'none'}\n\n`
    +`Check it on the owner page: https://tasterank.app/#/owner`);
  track('add-sent',true);
  add.sent={id:review?null:res.id,name:review?tidyCase(pack):res.pack_name,category:review?add.newCat:res.product,typeName:typeLabel(),product:review?null:add.product,cc:cp.code,newCat:review,newType:!!add.newType};
  add.step='sent';add.sending=false;homeData=null;
  renderAdd();focusAdd();
  refresh(); // the page behind shows it (and home reloads its data)
}
// The link a sent snack is shared with: its category, scrolled to its card (#/p/gb/2?snack=57)
const snackLink=s=>location.origin+location.pathname+hashFor({v:'category',cc:s.cc,product:s.product,snack:s.id});
async function openMatch(d){ // a snack that's already here: rate it, or see its card while it waits
  add=null;closeM();
  await go({v:'category',cc:d.cc,product:+d.product,variant:null,snack:d.live?null:+d.id});
  if(d.live&&page&&page.items.some(i=>i.id===+d.id))needUser({name:'rate',item:+d.id,from:'list'});
}
const ADD_ACT={
  'add-back':()=>{clearPending();add.step='find';renderAdd();focusAdd();runTyped()},
  'add-cancel':()=>{clearPending();add=null;closeM()},
  'add-new':()=>{track('add-by-hand',true);startCheck({})},
  'add-off-pick':d=>{track('add-off-picked',true);startCheck({off:offList()[+d.i]})},
  'add-open-match':d=>{track('add-rate-match',true);openMatch(d)},
  'add-change':d=>{clearPending();add.touched=true;
    if(d.row==='brand')add.brandOpen=true;
    if(d.row==='type')Object.assign(add,{typeOpen:true,typeFind:add.newType||(add.type&&!typesInOrder(add.country).slice(0,6).some(t=>t.id===add.type)?typeName(add.type):'')});
    if(d.row==='cat')Object.assign(add,{catOpen:true,catFind:add.newCat||''});
    if(d.row==='country')add.countryOpen=true;
    renderMid();($(`#row-${d.row} :is(input,select)`)||$(`#row-${d.row} .chip.on`))?.focus()},
  'add-brand-pick':d=>answerBrand(d.name),
  'add-brand-near':()=>{ // the brand, and the start of the name, as the known brand spells it (A8)
    const n=add.brandNear,w=add.pack.split(' '),rest=w.slice(n.words).join(' ');
    Object.assign(add,{brand:n.name,brandState:'known',brandNear:null,brandSet:true,touched:true});
    const t=[n.name,tidyCase(rest)].filter(Boolean).join(' ');add.pack='';commitPack(t).then(()=>{if(!add)return;categoryFromBrand();renderMid();focusAdd()})},
  'add-cat-yes':()=>answerCategory(add.catAsk),
  'add-cat-else':()=>{Object.assign(add,{catRefused:add.catAsk,catAsk:null,catOpen:true,catFind:'',nudge:null,touched:true});renderMid();($(`#row-cat .chips .chip:not([data-id="${add.catRefused}"])`)||$('#add-cat'))?.focus()},
  'add-type':d=>answerType(+d.id),
  'add-type-new':()=>answerNewType(tidyCase(add.typeFind,true)),
  'add-cat-pick':d=>{track(d.src==='typed'?'add-subcategory-typed':'add-subcategory-chip',true);answerCategory(+d.id)},
  'add-cat-new':()=>answerCategory(null,tidyCase(add.catFind,true)),
  'add-own-photo':()=>{add.ownPhoto=true;renderMid();$('#add-photo')?.click()},
  'add-face':d=>{add.score=add.score===+d.v?null:+d.v;document.querySelectorAll('#add-body .face-btn').forEach(b=>{const on=+b.dataset.v===add.score;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)})},
  'add-send':sendAdd,
  'add-share':()=>{const s=add.sent;share(`Know ${s.name}? Help it onto TasteRank: approve it in ${s.category}.`,snackLink(s))},
  'add-done':async()=>{const s=add.sent;add=null;closeM();await go(s.newCat?{v:'home'}:{v:'category',cc:s.cc,product:s.product,variant:null,snack:s.id})}
};
// Saving a typed answer: when the box is left (a moment later, see later()) or on Enter
function commitField(el){
  const v=el.value;
  if(el.id==='add-pack')return commitPack(v);
  if(el.id==='add-brand')return answerBrand(v);
  if(el.id==='add-type'){const t=tidyCase(v,true),ex=typeMatches(t).find(c=>snackKey(c.name)===snackKey(t));if(ex)return answerType(ex.id)}
  if(el.id==='add-cat'){ // an exact name picks it; a new category needs its own button (or Enter)
    const t=tidyCase(v,true),ex=categoriesIn(add.country).find(c=>snackKey(c.name)===snackKey(t));
    if(ex)return answerCategory(ex.id);
  }
}
// What's typed in the category box, on Enter or Next: an exact name picks it, part of one shows the matches, a new name adds it
function commitTypeTyped(){
  const t=tidyCase(add.typeFind,true),ms=typeMatches(t),ex=ms.find(c=>snackKey(c.name)===snackKey(t));
  if(ex){answerType(ex.id);return true}
  if(ms.length){add.nudge={row:'row-type',text:`Tap ${ms[0].name} below if that's it, or type the full name:`};renderMid();$('#type-find .chip')?.focus();return true}
  if(norm(t).length>=2){answerNewType(t);return true}
  return false;
}
// What's typed in the subcategory box, on Enter or Next: an exact name picks it, part of one shows the matches, a new name adds it
function commitCatTyped(){
  const t=tidyCase(add.catFind,true),ms=catMatches(t),ex=ms.find(c=>snackKey(c.name)===snackKey(t));
  if(ex){answerCategory(ex.id);return true}
  if(ms.length){add.nudge={row:'row-cat',text:`Tap ${ms[0].name} below if that's it, or type the full name:`};renderMid();$('#cat-find .chip')?.focus();return true}
  if(norm(t).length>=2){answerCategory(null,t);return true}
  return false;
}
document.addEventListener('input',e=>{
  if(!add)return;
  const id=e.target.id,v=e.target.value;
  if(id==='add-q'){add.q=v;runTyped()}
  if(id==='add-pack')fitPack();
  if(id==='add-brand'){clearTimeout(brandTimer);brandTimer=setTimeout(renderBrandHelp,200)}
  if(id==='add-type'){add.typeFind=v;add.typeError=null;if(add.nudge?.row==='row-type'&&add.nudge.text){add.nudge=null;const l=$('#row-type label.add-it');if(l){l.textContent='Not listed? Add it:';l.removeAttribute('role')}}const f=$('#type-find');if(f)f.innerHTML=typeFindHtml()}
  if(id==='add-cat'){add.catFind=v;add.catError=null;if(add.nudge?.row==='row-cat'){add.nudge=null;const l=$('#row-cat label.add-it');if(l&&$('#row-cat .chip[data-src="list"]')){l.textContent='Not listed? Add it:';l.removeAttribute('role')}else l?.remove()}const f=$('#cat-find');if(f)f.innerHTML=catFindHtml()}
});
document.addEventListener('keydown',e=>{
  if(!add||e.key!=='Enter'||!['add-pack','add-brand','add-type','add-cat'].includes(e.target.id))return;
  e.preventDefault();clearPending();
  if(e.target.id==='add-type'){add.typeFind=e.target.value;return commitTypeTyped()}
  if(e.target.id==='add-cat'){add.catFind=e.target.value;return commitCatTyped()}
  commitField(e.target);
});
document.addEventListener('change',async e=>{
  if(!add)return;
  const el=e.target;
  if(['add-pack','add-brand','add-type','add-cat'].includes(el.id))later(()=>commitField(el));
  if(el.id==='add-country')setCountry(+el.value);
  if(el.id==='add-photo'&&el.files[0]){
    try{add.photo=await shrinkPhoto(el.files[0]);add.ownPhoto=true;add.error=null}catch(x){add.error=x.message}
    renderMid();$('#add-photo')?.focus();
  }
});
function runTyped(){ // the box changed: TasteRank at once (after a short pause), Open Food Facts once typing pauses
  Object.assign(add,{results:null,off:null,offFor:null});renderResults();
  clearTimeout(searchTimer);clearTimeout(offTimer);searchTimer=setTimeout(runSearch,250);offTimer=setTimeout(runOff,600);
}
// TasteRank's own matches: every word typed; if nothing has them all, the snacks of the brand typed first ("werthers soft" → Werther's Original)
async function brandFallback(q){
  const w=q.split(/\s+/);if(w.length<2||bkey(w[0]).length<3)return [];
  return (await rpc('search_items',{q:w[0]})).filter(x=>bkey(x.brand).startsWith(bkey(w[0])));
}
async function runSearch(){
  const q=add.q.trim();
  if(norm(q).length<2){add.results=null;return renderResults()}
  try{let r=await rpc('search_items',{q});if(!r.length)r=await brandFallback(q);
    if(add&&add.q.trim()===q){add.results=r;renderResults();track(r.length?'add-search-match':'add-no-match',true)}}
  catch(e){console.error(e);if(add&&add.q.trim()===q){add.results=[];renderResults()}}
}
function runOff(){ // Open Food Facts, from 3 characters, once typing pauses
  const q=add.q.trim();
  if(norm(q).length<3)return;
  offLookup(q,r=>{if(!add||add.q.trim()!==q)return;add.off=r||[];add.offFor=q;renderResults()});
}

/* ---------- Withdraw something you sent that's still waiting (profile → Your additions) ---------- */
let withdrawing=null;
function askWithdraw(x){
  withdrawing=x;
  $('#confirm-body').innerHTML=`<h3 id="confirm-title">Withdraw ${esc(x.pack_name)}?</h3>
    <p id="confirm-text">${x.new_type?`We won't check the new category "${esc(x.new_type)}", and nothing goes live. You can add it again any time.`:x.new_category?`We won't check the new subcategory "${esc(x.product)}", and nothing goes live. You can add it again any time.`
      :'It leaves the vote, and its approvals go with it. You can add it again any time.'}</p>
    <button class="btn btn-block btn-danger-solid" data-act="withdraw-yes">Withdraw it</button>
    <button class="btn btn-block" data-act="close" data-autofocus>Keep it</button>`;
  openM('m-confirm');
}
async function doWithdraw(){
  const x=withdrawing;withdrawing=null;closeM();if(!x)return;
  try{await rpc('withdraw_submission',{p_id:String(x.id)})}catch(e){toast(e.message||'Something went wrong. Please try again.');console.error(e);return renderProfile()}
  track('add-withdrawn',true);toast('Withdrawn');homeData=null;
  await renderProfile();$('#subs-h')?.focus();
}

/* ---------- Your submissions: "it's live!" or "not this time", each shown once ---------- */
async function checkMoments(){
  if(!me||openId)return;
  let subs;try{subs=await rpc('my_submissions')}catch(e){return}
  const key='tasterank-moments-'+me.id,seen=new Set(store.get(key)||[]);
  const m=subs.find(x=>['live','closed','declined'].includes(x.status)&&!seen.has(x.id));
  if(!m||openId)return;
  seen.add(m.id);store.set(key,[...seen]);
  const live=m.status==='live',n=settings.approval_votes;
  moment=m;
  $('#moment-body').innerHTML=live
    ?`<div class="moment"><svg class="burst" viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-joy"/></svg><h3 id="moment-title">${esc(m.pack_name)} is live!</h3>
      <p>${n} people approved it. Be the first to rate it.</p>
      <button class="btn btn-primary btn-block" data-act="moment-rate">Rate it now</button><button class="btn btn-block" data-act="close">Later</button></div>`
    :m.status==='declined'?`<div class="moment"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-sad"/></svg><h3 id="moment-title">Not this time</h3>
      <p>${m.new_type?`We couldn't add ${esc(m.new_type)} as a new category, so ${esc(m.pack_name)} wasn't added. If it fits a category that's already here, you can add it there.`
        :`We couldn't add ${esc(m.new_ranking)} as a new subcategory, so ${esc(m.pack_name)} wasn't added. If it fits one that's already here, you can add it there.`}</p>
      <button class="btn btn-primary btn-block" data-act="close">OK</button></div>`
    :`<div class="moment"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-sad"/></svg><h3 id="moment-title">Not this time</h3>
      <p>${esc(m.pack_name)} didn't get ${n} approvals in ${settings.close_after_days} days. You can send it in again; it starts afresh.</p>
      <button class="btn btn-primary btn-block" data-act="moment-again">Add it again</button><button class="btn btn-block" data-act="close">OK</button></div>`;
  openM('m-moment');
  if(live)toast('🎉 Your snack went live');
}
let moment=null;
const addAgain=x=>startAdd({country:x.country_id,product:x.product_id,brand:x.brand,pack:x.pack_name});
Object.assign(ADD_ACT,{
  'moment-rate':async()=>{const m=moment,c=placeBy('id',m.country_id);closeM();await go({v:'category',cc:c.code,product:m.product_id,variant:null});needUser({name:'rate',item:m.id,from:'list'})},
  'moment-again':()=>{const m=moment;closeM();addAgain(m)},
  withdraw:d=>askWithdraw(mySubs[+d.i]),
  'withdraw-yes':doWithdraw,
  'add-again':d=>addAgain(mySubs[+d.i]),
  'subs-group':d=>subsGo(d.id||null),
  'subs-page':d=>subsGo(undefined,+d.p,d.dir)
});

/* ---------- Starting country: last choice, else where you are (from your internet address), else UK ---------- */
async function detectCountry(){
  try{const r=await withTimeout(fetch('https://api.country.is/'),1500);detected=(await r.json()).country||null}catch(e){}
  if(!detected){const m=(navigator.language||'').match(/-([A-Za-z]{2})$/);detected=m?m[1].toUpperCase():null}
}
const homeCountry=()=>placeBy('code',prefs.country)||placeBy('code',detected)||placeBy('code',DEFAULT_COUNTRY)||places[0];

/* ---------- Home: one card per category, or per brand (the switch shows once 3 brands have 2+ snacks here) ---------- */
let homeData=null, homeBy=null;
const homeCats=c=>homeData&&homeData.country===c?homeData.cats:[];
// The order rule for categories and subcategories: most ratings, then most snacks, then A to Z
const byUse=(a,b)=>b.ratings-a.ratings||b.snacks-a.snacks||a.name.localeCompare(b.name);
function homeTypes(cats){
  const m=new Map();
  for(const x of cats){const t=m.get(x.type_id)||{id:x.type_id,name:x.type,ratings:0,snacks:0};t.ratings+=x.ratings;t.snacks+=x.snacks;m.set(x.type_id,t)}
  return [...m.values()].sort(byUse);
}
// The adding form's category chips: the home order, then any without snacks yet, A to Z
function typesInOrder(c){
  const ord=homeTypes(homeCats(c)).map(t=>t.id),at=t=>{const i=ord.indexOf(t.id);return i<0?ord.length:i};
  return [...(catalogues[c]||[])].sort((a,b)=>at(a)-at(b)||a.name.localeCompare(b.name));
}
async function renderHome(r){
  const c=homeCountry();
  $('#country').innerHTML=places.map(p=>`<option value="${esc(p.code)}"${p===c?' selected':''}>${p.flag} ${esc(p.name)}</option>`).join('');
  homeBy=r&&r.by==='brands'?'brands':null;
  const uid=me?.id||null;
  if(!homeData||homeData.country!==c.id||homeData.uid!==uid){
    if(!homeData||homeData.country!==c.id)$('#cards').innerHTML='<div class="card empty">Loading…</div>';
    try{const [cats,brands,waiting]=await Promise.all([rpc('home_categories',{p_country:c.id}),rpc('home_brands',{p_country:c.id}),rpc('home_waiting',{p_country:c.id}).catch(()=>[])]); // [] before migration 015
      homeData={country:c.id,uid,cats,brands,waiting:waitOrder(waiting||[])}}
    catch(e){console.error(e);$('#cards').innerHTML='<div class="card empty">Couldn\'t load snacks. Check your connection and refresh.</div>';return}
  }
  renderHomeCards();
}
const ratingsPart=n=>n?' · '+plural(n,'rating'):'';
/* List cards (design/mockups/cat-preview.html): a square panel on the left, edge to edge, with Vera's own photo of the list,
   or its emoji on its category's soft colour; beside it the name, "3 snacks · 1 rating", then the winner or how close one is */
const LIST_PHOTOS={1:'chocolate-bars',2:'toffee',3:'crisps',4:'jelly-sweets'}; // assets/lists/, by subcategory id (the same id in every country)
const TINTS={1:'choc',2:'sweet',3:'crisp',4:'choc',5:'crisp',6:'choc',7:'crisp'}; // by category: cocoa blush, rose, blue mist
const listPhoto=(product,country)=>product===2&&country===5?null:LIST_PHOTOS[product]; // China's Milk candy isn't toffee: it keeps its emoji
// The emoji always sits underneath, so a photo that fails to load just leaves the emoji showing
const panel=(emoji,type,photo,cls='pp')=>`<span class="${cls}" style="--tint:var(--t-${TINTS[type]||'crisp'})" aria-hidden="true"><span class="emo">${esc(emoji||'🍽️')}</span>${photo?`<img src="assets/lists/${photo}.jpg" alt="" loading="lazy" decoding="async">`:''}</span>`;
// Under the name: the winner (up to 2 lines), or a bar filling up towards one (never "1/10", which reads like a score)
function cardStatus(win,label,lead,goal){
  if(win)return `<span class="win2"><span class="k">${label}</span> <b>${esc(win.pack_name)}</b> <span class="s">${faceFor(win.avg).e} ${score1(win.avg)}</span></span>`;
  if(lead==null)return `<span class="go"><b>No ${label.toLowerCase()} yet</b></span>`; // before migration 009
  if(!lead)return `<span class="go"><b>No ratings yet</b> · Be the first</span>`;
  const need=settings.rank_after_ratings;
  return `<span class="wb" aria-hidden="true"><i style="width:${Math.min(100,Math.round(lead/need*100))}%"></i></span><span class="go"><b>${plural(Math.max(1,need-lead),'more rating')}</b> ${goal}</span>`;
}
const cardText=(name,meta,status)=>`<span class="tx"><span class="nm">${esc(name)}</span><span class="mt">${meta}</span>${status}</span>`;
// A new list: none of its snacks is live yet, only in the vote (migration 013), so friends can find it and approve them
const isNew=x=>!x.snacks&&x.waiting>0;
const catCard=(x,country)=>panel(x.emoji,x.type_id,listPhoto(x.id,country))+(isNew(x)
  ?cardText(x.name,`${plural(x.waiting,'snack')} waiting`,`<span class="newk">New list</span><span class="go">Help decide what's in it</span>`)
  :cardText(x.name,plural(x.snacks,'snack')+ratingsPart(x.ratings),cardStatus(x.top[0],'Winner',x.lead??(x.to_rate[0]||{}).total,'to win')));
// A brand card shows its main list's picture: the list it has most snacks in, within the category picked in the chips.
// Matched by name, as home_brands gives the lists' names (most snacks first), not their ids.
function brandCard(b,country){
  const lists=(b.categories||[]).map(n=>homeData.cats.find(x=>x.name===n)).filter(Boolean),main=lists.find(x=>inType(x.type_id))||lists[0];
  return panel(main?.emoji||((b.thumbs||[b.thumb||{}])[0]||{}).emoji,main?.type_id??(b.type_ids||[])[0],main&&listPhoto(main.id,country))+cardText(b.name,plural(b.snacks,'snack')+ratingsPart(b.ratings),cardStatus(b.best,'Best',b.lead,'to be the best'));
}
function renderHomeCards(){
  if(!homeData)return;
  const c=places.find(p=>p.id===homeData.country),seg=homeData.brands.length>=3;
  if(homeBy==='brands'&&!seg){homeBy=null;if(location.hash==='#/brands'){history.replaceState(null,'',location.pathname);currentUrl=location.href}}
  const byBrand=homeBy==='brands';
  $('#home-seg').hidden=!seg;
  document.querySelectorAll('#home-seg [role=tab]').forEach(b=>{const on=(b.dataset.by==='brands')===byBrand;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1});
  const types=homeTypes(homeData.cats).map(t=>[t.id,t.name]);
  if(prefs.cat!=='all'&&!types.some(([id])=>String(id)===String(prefs.cat)))prefs.cat='all';
  $('#cats').innerHTML=[['all','All'],...types].map(([id,name])=>`<button class="chip${String(id)===String(prefs.cat)?' on':''}" data-act="cat" data-cat="${id}" aria-pressed="${String(id)===String(prefs.cat)}">${esc(name)}</button>`).join('');
  const cards=byBrand
    ?[...homeData.brands].sort(byUse).filter(b=>b.type_ids.some(inType)).map(b=>`<a class="lc" href="${esc(hashFor({v:'brand',cc:c.code,brand:b.id}))}" data-act="brand" data-cc="${c.code}" data-brand="${b.id}">${brandCard(b,c.id)}</a>`)
    :[...homeData.cats].sort(byUse).filter(x=>inType(x.type_id)).map(x=>`<a class="lc${isNew(x)?' new':''}" href="${esc(hashFor({v:'category',cc:c.code,product:x.id}))}" data-act="category" data-cc="${c.code}" data-product="${x.id}">${catCard(x,c.id)}</a>`);
  const empty=cards.length?'':`<div class="card empty">${byBrand?'No brand has 2 snacks of this type here yet.':'No snacks here yet. Know one? Tap + to add it.'}</div>`;
  cards.splice(wide.matches?6:4,0,bandHtml(waitList(),c.code)); // after 2 rows of lists, never further down; at the end when there are fewer
  $('#cards').innerHTML=empty+cards.join('');
  setFab();
}
const inType=id=>prefs.cat==='all'||String(id)===String(prefs.cat);

/* ---------- New snacks to check (design/mockups/waiting-on-home.html, round 4) ----------
   The snacks in the vote, in a white band after the first 4 lists (6 on wide screens), so rating comes first but the band never sinks.
   Up to 8, then "See all N". Each has Approve and "Not right?" (a reason and a note, for the owner page). */
const WAIT_CAP=8, wide=matchMedia('(min-width:900px)');
wide.addEventListener('change',()=>{if(view==='home')renderHomeCards()});
// Closest to going live first, then closing soonest; ties shuffled once per load, so each gets its turn at the front; your own last
function waitOrder(list){
  const r=new Map(list.map(w=>[w.id,Math.random()]));
  return [...list].sort((a,b)=>a.mine-b.mine||b.approvals-a.approvals||a.days_left-b.days_left||r.get(a.id)-r.get(b.id));
}
// What the band shows: not ones you've approved or reported, and only the category picked in the chips
const waitList=()=>(homeData?.waiting||[]).filter(w=>!w.approved&&!w.reported&&inType(w.type_id));
const placeIn=p=>p?(/^(UK|US)$/.test(p.short_name)?'the ':'')+p.short_name:'this country'; // "the UK", "Japan"
function waitCard(w,cc){
  const n=settings.approval_votes;
  return `<div class="wc">${panel(w.emoji,w.type_id,listPhoto(w.product_id,homeData.country),'wp')}
    <div class="in"><a class="bn" href="${esc(hashFor({v:'category',cc,product:w.product_id,snack:w.id}))}" data-act="open-snack" data-cc="${cc}" data-product="${w.product_id}" data-id="${w.id}">${esc(w.pack_name)}</a>
      <div class="pk">${w.mine?'<span class="mine">Added by you</span>':esc(w.product)} · ${w.approvals} of ${n}</div>
      <div class="prog" aria-hidden="true"><i style="width:${Math.min(100,Math.round(w.approvals/n*100))}%"></i></div></div>
    <div class="acts">${w.mine&&LIVE?'':`<button class="btn btn-primary" data-act="approve" data-id="${w.id}" data-brand="${esc(w.brand)}" data-mine="${w.mine?1:''}" aria-label="Approve ${esc(w.pack_name)}">${w.mine?'Approve (demo)':'Approve'}</button>`}
      ${w.mine?'':`<button class="lk" data-act="report" data-id="${w.id}" aria-label="Something not right about ${esc(w.pack_name)}?">Not right?</button>`}</div></div>`;
}
function bandHtml(list,cc){
  if(!list.length)return '';
  const more=list.length>WAIT_CAP;
  return `<section class="band" aria-labelledby="band-h"><div class="band-h"><span class="ic" aria-hidden="true">🧐</span><h2 id="band-h">New snacks to check</h2><span class="n">${list.length} waiting</span></div>
    <p class="band-s">Know one? Approve it if it's right, or tell us what's off. Snacks join once ${settings.approval_votes} people approve.</p>
    <div class="strip">${list.slice(0,WAIT_CAP).map(w=>waitCard(w,cc)).join('')}${more?`<button class="wc more" data-act="wait-all"><span class="arr" aria-hidden="true">→</span><b>See all ${list.length}</b></button>`:''}</div></section>`;
}
// "See all": every one, grouped by list, in a pop-up (no page of its own)
function openWaitAll(){
  const list=waitList(),c=places.find(p=>p.id===homeData.country),groups=new Map();
  for(const w of list){const g=groups.get(w.product_id)||{name:w.product,items:[]};g.items.push(w);groups.set(w.product_id,g)}
  $('#waiting-body').innerHTML=`<h3 id="waiting-title">New snacks to check</h3><p class="hm">${list.length} waiting in ${esc(placeIn(c))} · closest to going live first</p>
    ${[...groups.values()].map(g=>`<h4 class="grp">${esc(g.name)} · ${g.items.length}</h4><div class="wl">${g.items.map(w=>waitCard(w,c.code)).join('')}</div>`).join('')}`;
  track('waiting-all',true);openM('m-waiting');
}
// A snack in the vote, from home or the list page open now
function findWaiting(id){
  const p=page&&view==='category'&&(page.pending||[]).find(x=>x.id===id);
  if(p)return {...p,product:page.name,product_id:page.id,place:placeBy('code',page.cc)};
  const h=homeData&&(homeData.waiting||[]).find(w=>w.id===id);
  return h?{...h,place:places.find(x=>x.id===homeData.country)}:null;
}
/* "Not right?": one of 5 reasons and an optional note. It goes to the owner page's "To check" and the owner's inbox; it never says who sent it */
const REASONS=[['not_sold',w=>`Not sold in ${placeIn(w.place)}`],['wrong_list',()=>"It's in the wrong list",'It belongs in another list, or a new one'],
  ['wrong_name',()=>'Wrong name or photo'],['duplicate',()=>"It's already listed",'The same snack under another name'],['other',()=>'Something else']];
let reporting=null;
function openReport(id){
  const w=findWaiting(id);if(!w)return toast("This snack isn't waiting for approval any more.");
  reporting=w;
  $('#report-body').innerHTML=`<h3 id="report-title">What's not right?</h3><p class="hm">${esc(w.pack_name)} · ${esc(w.product)}</p>
    <form id="f-report"><fieldset class="opts"><legend class="sr-only">What's not right?</legend>
      ${REASONS.map(([k,t,sub])=>`<label class="opt"><input type="radio" name="reason" value="${k}"><span>${esc(t(w))}${sub?`<small>${esc(sub)}</small>`:''}</span></label>`).join('')}</fieldset>
      <label class="fl" for="report-note">Anything to add? <span>(optional)</span></label>
      <textarea id="report-note" maxlength="200" rows="3" placeholder="e.g. what it should be called, or which list"></textarea>
      <button class="btn btn-primary btn-block" type="submit" disabled>Send</button></form>`;
  track('report-open',true);openM('m-report');
}
async function sendReport(e){
  e.preventDefault();const w=reporting,f=e.target,reason=(f.querySelector('[name=reason]:checked')||{}).value,note=$('#report-note').value.trim();
  if(!w||!reason)return;
  const btn=f.querySelector('[type=submit]');btn.disabled=true;
  try{await rpc('report_item',{p_item:w.id,p_reason:reason,p_note:note||null})}
  catch(err){btn.disabled=false;toast(err.message||'Something went wrong. Please try again.');console.error(err);return}
  track('report-item',true);reporting=null;closeM();toast("Thanks! We'll take a look.");
  emailOwner(`TasteRank: someone says "${w.pack_name}" isn't right`,
    `${w.pack_name} (${w.product}, ${w.place?.name||''}) is in the vote. Someone says: ${REASONS.find(r=>r[0]===reason)[1](w)}.${note?`\n\nTheir note: ${note}`:''}\n\nSee it on the owner page, under To check.`);
  const h=homeData?.waiting?.find(x=>x.id===w.id);if(h)h.reported=true;
  const p=page?.pending?.find(x=>x.id===w.id);if(p)p.reported=true;
  if(view==='home')renderHomeCards();else if(view==='category'&&p)drawCategory();
}
$('#m-report').addEventListener('submit',sendReport);
$('#m-report').addEventListener('change',e=>{if(e.target.name==='reason')$('#f-report [type=submit]').disabled=false});
// The switch is a pair of tabs: arrow keys move between them
$('#home-seg').addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
  e.preventDefault();const other=$(`#home-seg [role=tab][aria-selected="false"]`);if(other){other.click();setTimeout(()=>$('#home-seg [aria-selected="true"]')?.focus(),0)}
});

/* ---------- Lists: a category page or a brand page. Each loads once; the chips filter it here, without asking the database again. ---------- */
// "All 18", then each with its count, read out as "Salt & vinegar, 6 snacks"
function chipsHtml(label,act,list,on){
  return `<div class="chips counted" role="group" aria-label="${label}">${list.map(x=>{const p=x.id===on;
    return `<button class="chip${p?' on':''}" aria-pressed="${p}" data-act="${act}" data-id="${x.id??''}" aria-label="${esc(x.name)}, ${plural(x.count,'snack')}">${esc(x.name)} <span class="n">${x.count}</span></button>`}).join('')}</div>`;
}
function winnerHtml(items,label,line,none){
  const w=items.find(i=>i.ranked);
  return w?`<div class="winner"><span class="lbl">${esc(label)}</span><span class="wrow"><span class="nm">${esc(w.pack_name)}</span><span class="face" aria-hidden="true">${faceFor(w.avg).e}</span><span class="num">${score1(w.avg)}</span></span><span class="cnt">${line(w)}</span></div>`
    :`<div class="early"><b>${none}</b>Each snack needs ${settings.rank_after_ratings} ratings. Rate the ones you know! <button class="link" data-act="how">How it works</button></div>`;
}
/* A row leads with the snack's name (up to 2 lines, the whole name in its label). The name is the button that opens the rating sheet,
   stretched over the row; the link underneath (brand, or "#1 in Crisps") sits above it, so it's a separate tap and Tab stop. */
function listRow(it,k,sub){
  const need=settings.rank_after_ratings,rank=it.ranked?k+1:null,mine=it.my_score?FACES.find(f=>f.v===it.my_score):null;
  const pct=it.ranked?Math.round(it.avg/5*100):Math.min(100,Math.round(it.total/need*100));
  const label=`${rank?`Number ${rank}: `:''}${it.pack_name}. ${it.ranked?`${score1(it.avg)} out of 5, ${plural(it.total,'rating')}`:`${it.total} of ${need} ratings`}${mine?`. You rated it ${mine.l}`:''}`;
  return `<div class="ir${it.ranked&&k<3?' top3':''}${it.ranked?'':' unranked'}" id="snack-${it.id}">
    <span class="rk" aria-hidden="true">${rank||'–'}</span>${thumb(it,'sm')}
    <span class="in"><button class="nm" data-act="rate" data-id="${it.id}" aria-label="${esc(label)}"><span class="nm-t">${esc(it.pack_name)}</span></button>
      <span class="sb">${sub}${mine?` <span class="mine">· You ${mine.e}</span>`:''}</span>
      <span class="track" aria-hidden="true"><span class="fill" style="width:${pct}%"></span></span></span>
    <span class="sc" aria-hidden="true">${it.ranked?`${faceFor(it.avg).e} ${score1(it.avg)}<small>${fmt(it.total)}</small>`:`<span class="nr">${it.total} of ${need}<small>ratings</small></span>`}</span>
  </div>`;
}
// Redraw a list, keeping the chips scrolled where they were and the focus on the chip just tapped
function redraw(el,draw,act){
  const sx=[...el.querySelectorAll('.chips')].map(c=>c.scrollLeft),f=document.activeElement&&el.contains(document.activeElement)&&document.activeElement.dataset;
  draw();
  el.querySelectorAll('.chips').forEach((c,i)=>c.scrollLeft=sx[i]||0);
  if(f&&f.act)(el.querySelector(`[data-act="${f.act}"][data-id="${f.id||''}"]`)||el.querySelector(`[data-act="${act}"]`))?.focus();
}
const possessive=n=>/s$/.test(n)?`${n}'`:`${n}'s`; // Walkers' best; M&S's and KETTLE's best (capitals take 's)
const listLink=(cc,product,text)=>`<a class="bl" href="${esc(hashFor({v:'category',cc,product}))}" data-act="category" data-cc="${cc}" data-product="${product}">${text}</a>`;

/* ---------- Category page: every snack in one category, with a chip per flavour ---------- */
async function renderCategory(r){
  const c=placeBy('code',r.cc);if(!c)return gone();
  const el=$('#v-category'),key=`p/${c.id}/${r.product}`,fresh=!page||page.key!==key;
  if(fresh)el.innerHTML='<div class="card empty">Loading…</div>';
  let d;try{d=await rpc('category_page',{p_product:r.product,p_country:c.id})}catch(e){oops(e);return}
  const gonePick=r.snack&&d&&d.withdrawn.find(w=>w.id===r.snack);
  if(!d||(!d.items.length&&!d.pending.length&&!gonePick))return gone();
  const variant=d.flavours.length>=2&&d.flavours.some(f=>f.id===r.variant)?r.variant:null; // an old link to a flavour that has no chip opens All
  page={...d,key,kind:'category',route:{v:'category',cc:c.code,product:r.product,variant},cc:c.code,gone:gonePick||null};
  if(variant!==r.variant)setRoute(page.route);
  if(fresh)track('open-category',true);
  drawCategory();
  const card=r.snack&&!gonePick&&document.getElementById('snack-'+r.snack);
  if(card){card.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});card.classList.add('hl');setTimeout(()=>card.classList.remove('hl'),2400)}
}
function drawCategory(){
  const d=page,f=d.flavours.find(x=>x.id===d.route.variant)||null,chips=d.flavours.length>=2;
  const items=f?d.items.filter(i=>i.variant_id===f.id):d.items,pend=f?d.pending.filter(p=>p.variant_id===f.id):d.pending;
  const flavour=id=>(d.flavours.find(x=>x.id===id)||{}).name||'',total=items.reduce((s,i)=>s+i.total,0),n=items.length;
  d.title=f?f.title:d.name;
  const fresh=!n&&pend.length>0; // a new list: nothing live yet, so one note instead of No winner yet, the rating tip and None live yet
  $('#v-category').innerHTML=`
    <button class="crumb" data-act="home-type" data-cc="${d.cc}" data-type="${d.type_id}">← ${esc(d.country.short_name)} <span>· ${esc(d.type)}</span></button>
    <h1 class="page-title">${esc(d.title)}: which one wins?</h1>
    <div class="meta">${d.country.flag} ${esc(d.country.name)} · ${fresh?'New list':plural(n,'snack')+ratingsPart(total)}</div>
    ${d.gone?`<div class="card gone-card" role="status"><span class="gone-e" aria-hidden="true">😶</span><b>${esc(d.gone.pack_name)} was withdrawn</b><span class="meta">The person who added it took it back before it went live, so there's nothing to approve.</span></div>`:''}
    ${chips?chipsHtml('Flavours','flavour',[{id:null,name:'All',count:d.items.length},...d.flavours],f?f.id:null):''}
    ${fresh?`<div class="newnote"><b>New list: help decide what's in it</b><span>Snacks join once ${settings.approval_votes} people approve them. Know one of these? Approve it. Missing one? Tap + to add it.</span></div>`
      :`${winnerHtml(items,'The winner so far',w=>`${plural(w.total,'rating')} · ${Math.round(w.r5/w.total*100)}% love it`,'No winner yet')}
    <div class="tip-slot" data-n="2"></div>`}
    ${n?`<div class="list">${items.map((it,k)=>listRow(it,k,(it.brand_snacks>=2
        ?`<a class="bl" href="${esc(hashFor({v:'brand',cc:d.cc,brand:it.brand_id}))}" data-act="brand" data-cc="${d.cc}" data-brand="${it.brand_id}">${esc(it.brand)}</a>`:esc(it.brand))
        +(chips&&!f?` · ${esc(flavour(it.variant_id))}`:''))).join('')}</div>`:''}
    ${n<3&&!fresh?`<div class="alert"><b>${n?`Only ${n===1?'one':'two'} so far`:'None live yet'}</b><span>Know ${n?`another ${esc(d.title.toLowerCase())}`:'one'} sold in ${esc(d.country.name)}? Tap + to add it. It goes live once ${settings.approval_votes} people approve.</span></div>`:''}
    ${pend.length?`${fresh?'':'<div class="tip-slot" data-n="5"></div>'}<h2>Waiting for approval</h2><div class="pend-list">${pend.map(pendCard).join('')}</div>`:''}
    <div class="tip-slot" data-n="6"></div>
    <button class="btn share-btn" data-act="share-list">Share this list</button>`;
  updateTips();
}
function pickFlavour(id){
  if(!page||page.kind!=='category'||page.route.variant===id)return;
  page.route={...page.route,variant:id};setRoute(page.route);track('pick-flavour',true);
  redraw($('#v-category'),drawCategory,'flavour');
}
function pendCard(p){
  const n=settings.approval_votes,w=Math.min(100,Math.round(p.approvals/n*100));
  return `<div class="pend${p.mine?' mine':''}" id="snack-${p.id}">${thumb(p,'sm')}
    <div class="in"><div class="bn">${esc(p.pack_name)}</div><div class="pk">${esc(p.brand)}${p.mine?' · <span class="mine">added by you</span>':''}</div>
      <div class="meta">${p.approvals} of ${n} approvals${p.mine?` · closes in ${p.days_left} days`:''}</div><div class="prog"><i style="width:${w}%"></i></div></div>
    <div class="pend-acts">${p.mine?`<button class="btn" data-act="share-snack" data-id="${p.id}" aria-label="Share ${esc(p.pack_name)}">Share</button>`:''}
      ${p.mine&&LIVE?'':p.approved?'<button class="btn" disabled>Approved ✓</button>'
        :`<button class="btn btn-primary" data-act="approve" data-id="${p.id}" data-brand="${esc(p.brand)}" data-mine="${p.mine?1:''}" aria-label="Approve ${esc(p.pack_name)}">${p.mine?'Approve (demo)':'Approve'}</button>`}
      ${p.mine?'':p.reported?'<span class="lk sent">Sent, thanks</span>':`<button class="lk" data-act="report" data-id="${p.id}" aria-label="Something not right about ${esc(p.pack_name)}?">Not right?</button>`}</div>
  </div>`;
}
async function doApprove(id,brand,mine){
  if(openId==='m-waiting')closeM();
  let r;try{r=await rpc('approve_item',{p_item:id});track('approve-item',true)}catch(e){toast(e.message||'Something went wrong. Please try again.');console.error(e);homeData=null;return refresh()}
  toast(r.status==='live'?`🎉 ${brand||'It'} is live`:`Thanks! ${r.approvals} of ${settings.approval_votes} approvals`);
  homeData=null;await refresh();
  if(r.status==='live'&&mine)checkMoments();
}

/* ---------- Brand page: every snack of one brand. Across 2+ categories the chips are categories, then that category's flavours. ---------- */
async function renderBrandPage(r){
  const c=placeBy('code',r.cc);if(!c)return gone();
  const el=$('#v-brand'),key=`b/${c.id}/${r.brand}`,fresh=!page||page.key!==key;
  if(fresh)el.innerHTML='<div class="card empty">Loading…</div>';
  let d;try{d=await rpc('brand_page',{p_brand:r.brand,p_country:c.id})}catch(e){oops(e);return}
  if(!d||!d.items.length)return gone();
  page={...d,key,kind:'brandpage',cc:c.code,route:brandRoute(d,c.code,r.product,r.variant)};
  if(page.route.product!==r.product||page.route.variant!==r.variant)setRoute(page.route);
  if(fresh)track('open-brand',true);
  drawBrand();
}
// What's picked, made valid: with one category the address names it only when a flavour is picked
function brandRoute(d,cc,product,variant){
  const multi=d.products.length>=2,p=multi?(d.products.some(x=>x.id===product)?product:null):d.products[0].id;
  const fls=p?d.flavours.filter(f=>f.product_id===p):[],v=fls.length>=2&&fls.some(f=>f.id===variant)?variant:null;
  return {v:'brand',cc,brand:d.id,product:multi||v?p:null,variant:v};
}
function drawBrand(){
  const d=page,multi=d.products.length>=2,prod=d.route.product||(multi?null:d.products[0].id),v=d.route.variant;
  const fls=prod?d.flavours.filter(f=>f.product_id===prod):[];
  const items=d.items.filter(i=>(!prod||i.product_id===prod)&&(!v||i.variant_id===v)),total=items.reduce((s,i)=>s+i.total,0);
  d.title=d.name;
  $('#v-brand').innerHTML=`
    <button class="crumb" data-act="home-brands" data-cc="${d.cc}">← ${esc(d.country.short_name)} <span>· Brands</span></button>
    <h1 class="page-title">${esc(d.name)}: which one wins?</h1>
    <div class="meta">${d.country.flag} ${esc(d.country.name)} · ${plural(items.length,'snack')}${ratingsPart(total)}</div>
    ${multi?chipsHtml('Subcategories','bp-cat',[{id:null,name:'All',count:d.items.length},...d.products],prod):''}
    ${fls.length>=2?chipsHtml('Flavours','bp-flavour',[{id:null,name:multi?`All ${(d.products.find(p=>p.id===prod)||{name:''}).name.toLowerCase()}`:'All',count:fls.reduce((s,f)=>s+f.count,0)},...fls],v):''}
    ${winnerHtml(items,`${possessive(d.name)} best so far`,w=>`${plural(w.total,'rating')}${w.place?` · #${w.place} in ${esc(w.product)}`:''}`,'No best yet')}
    <div class="tip-slot" data-n="2"></div>
    <div class="list">${items.map((it,k)=>listRow(it,k,it.place?listLink(d.cc,it.product_id,`#${it.place} in ${esc(it.product)}`)
      :`${listLink(d.cc,it.product_id,esc(it.product))} · not ranked yet`)).join('')}</div>`;
  updateTips();
}
function pickBrandChip(product,variant,event){
  if(!page||page.kind!=='brandpage')return;
  const r=brandRoute(page,page.cc,product,variant);
  if(r.product===page.route.product&&r.variant===page.route.variant)return;
  page.route=r;setRoute(r);track(event,true);
  redraw($('#v-brand'),drawBrand,event==='pick-category'?'bp-cat':'bp-flavour');
}

/* ---------- Rating sheet: tapping a face saves straight away; "Next" suggests what to rate next ---------- */
function itemFromPage(id){
  if(!page||!page.items)return null;
  const it=page.items.find(i=>i.id===id);if(!it)return null;
  const v=page.route.variant||null,base={cc:page.cc,country:page.country,flavour:v};
  if(page.kind==='category'){const f=page.flavours.find(x=>x.id===v);return {...it,...base,product_id:page.id,where:f?f.title:page.name,listTitle:f?f.title:page.name}}
  return {...it,...base,brand:page.name,brand_id:page.id,brand_snacks:page.items.length,where:v?it.flavour_title:it.product,listTitle:page.name};
}
async function openRate(id){
  const it=itemFromPage(id);if(!it)return;
  sheet={it,from:page.kind==='brandpage'?'brand':'list',editing:!it.my_score,next:null};
  if(it.my_score)loadNext();
  renderSheet();openM('m-rate');
}
function renderSheet(){
  if(!sheet)return;
  const it=sheet.it,home=profile&&profile.home_place,homeCountryId=home&&(home.country_id||null);
  $('#rate-thumb').outerHTML=thumb(it).replace('class="thumb"','class="thumb" id="rate-thumb"');
  // the brand, the list (the flavour when one is picked) and the country: "Walkers · Salt & vinegar crisps · 🇬🇧"
  $('#rate-meta').innerHTML=`${esc(it.brand)} · ${esc(it.where)} · ${it.country.flag}${homeCountryId&&homeCountryId!==it.country.id?` <span class="ver">${esc(placeBy('id',it.country.id)?.adjective||it.country.short_name)} version</span>`:''}`;
  $('#rate-title').textContent=it.pack_name;
  const body=$('#rate-body');
  if(sheet.editing){
    body.innerHTML=`<div class="faces">${FACES.map(f=>`<button class="face-btn${it.my_score===f.v?' on':''}" data-act="face" data-v="${f.v}" aria-pressed="${it.my_score===f.v}"><span aria-hidden="true">${f.e}</span>${f.l}</button>`).join('')}</div>
      ${sheet.error?`<div class="sheet-error" role="alert"><b>Your rating didn't save.</b> Please try again.<small>${esc(sheet.error)}</small></div>`
        :'<div class="help">Tap a face. It saves straight away.</div>'}
      ${it.my_score?'<button class="link remove-rating" data-act="unrate">Remove my rating</button>':''}`;
    return;
  }
  const f=FACES.find(x=>x.v===it.my_score),n=sheet.next,more=sheet.from!=='brand'&&it.brand_snacks>=2;
  const second=more?`More from ${it.brand}`:`Back to ${it.listTitle}`;
  let main='';
  if(!n)main='<button class="btn btn-primary btn-block" disabled>Finding what\'s next…</button>';
  else if(n.kind==='done')main=`<div class="crispy-done"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-joy"/></svg><div><b>You've rated them all!</b><div class="meta">Know one we're missing? Add it and I'll put it to the vote.</div></div></div>
      <button class="btn btn-primary btn-block" data-act="close">Back to ${esc(it.listTitle)}</button>
      <button class="btn btn-block" data-act="add">＋ Add one we're missing</button>
      ${more?`<button class="btn btn-block" data-act="sheet-second">More from ${esc(it.brand)}</button>`:''}`;
  else{
    const text=`Next: ${n.kind==='item'?n.short_label:n.title} →`;
    main=`${n.kind==='list'?`<div class="done-line">That's every ${esc(it.where.toLowerCase())} here rated. 🎉</div>`:''}<button class="btn btn-primary btn-block" data-act="next">${esc(text.length>32?'Rate the next one →':text)}</button>`;
  }
  body.innerHTML=`<div class="saved"><span>✓ Saved · You rated <b>${f.e} ${f.l}</b></span><button class="link" data-act="edit-rating">Edit</button></div>
    ${sheet.tip4?`<div class="tip plain${sheet.tip4==='new'?' tip-in':''}" role="note"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-joy"/></svg><p>Your first rating! The more snacks you rate here, the fairer the fight.</p></div>`:''}
    ${main}${n&&n.kind==='done'?'':`<button class="btn btn-block" data-act="sheet-second">${esc(second)}</button>`}`;
  if(sheet.tip4)sheet.tip4=true;
  // keep keyboard focus inside the sheet when its buttons are replaced
  if(!$('#m-rate').contains(document.activeElement)||document.activeElement===document.body)($('#rate-body .btn-primary:not([disabled])')||$('#rate-body [data-act="edit-rating"]')).focus();
}
async function loadNext(){
  const id=sheet.it.id;
  try{const n=await rpc('next_snack',{p_item:id,p_variant:sheet.it.flavour,p_brand:sheet.from==='brand'});if(sheet&&sheet.it.id===id){sheet.next=n;renderSheet()}}
  catch(e){console.error(e);if(sheet){sheet.next={kind:'done'};renderSheet()}}
}
async function saveRating(v){
  if(!sheet||!me)return;
  const it=sheet.it,first=!it.my_score;
  // a failed save stays visible in the sheet (with the reason), instead of a message that disappears
  let firstEver=false;
  try{const n=await rpc('rate_item',{p_item:it.id,p_score:v});if(profile)profile.rated=n;firstEver=first&&n===1}
  catch(e){console.error(e);sheet.error=e.message||String(e);renderSheet();return}
  track('rate-item',true);
  if(firstEver&&!tips.off&&!tipSeen(4)){sheet.tip4='new';tipMark(4);track('tip-shown-4',true)} // Crispy's tip 4, once
  it.my_score=v;sheet.editing=false;sheet.error=null;sheet.next=null;renderSheet();
  homeData=null;
  await refresh();                      // the page behind updates its counts, "You" tag and winner
  const fresh=itemFromPage(it.id);if(fresh&&sheet&&sheet.it.id===it.id)sheet.it={...fresh,my_score:v};
  if(sheet)await loadNext();
  if(first&&!profile&&me)await loadProfile();
}
async function removeRating(){
  if(!sheet||!me)return;
  const it=sheet.it;
  try{const n=await rpc('unrate_item',{p_item:it.id});if(profile)profile.rated=n}
  catch(e){console.error(e);sheet.error=e.message||String(e);renderSheet();return}
  track('unrate-item',true);
  it.my_score=null;sheet.editing=true;sheet.error=null;sheet.next=null;renderSheet();toast('Rating removed');
  $('#m-rate .face-btn')?.focus();
  homeData=null;await refresh();
}
async function nextStep(){
  const n=sheet&&sheet.next;if(!n)return;
  if(n.kind==='list'){track('next-list',true);const cc=sheet.it.cc;closeM();return go({v:'category',cc,product:n.product_id,variant:n.variant_id})}
  track('next-item',true);
  let it=itemFromPage(n.id);
  if(!it){ // another brand's snack, suggested from a brand page: move the page behind to its category, so "Back" and the counts match
    await go({v:'category',cc:sheet.it.cc,product:sheet.it.product_id,variant:null});
    it=itemFromPage(n.id);if(!it)return closeM();
  }
  sheet={it,from:page.kind==='brandpage'?'brand':'list',editing:!it.my_score,next:null};
  if(it.my_score)loadNext();
  renderSheet();$('#m-rate .face-btn')?.focus();
}
function sheetSecond(){ // "More from <brand>", or back to the list
  const it=sheet&&sheet.it,more=!!it&&sheet.from!=='brand'&&it.brand_snacks>=2;
  closeM();
  if(more)go({v:'brand',cc:it.cc,brand:it.brand_id});
}

/* ---------- Feedback ---------- */
function emailOwner(subject,message){ // tells the TasteRank inbox there's something to check; the database keeps the record
  message+=`\n\nSent by: Taster ID ${profile?.taster_id||'unknown'} (the first 6 characters of their account ID; never their name or email)`;
  if(LIVE)fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({access_key:CONFIG.WEB3FORMS_KEY,subject,from_name:'TasteRank',message})}).catch(err=>console.error(err));
}
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

/* ---------- Owner page (#/owner, design/mockups/owner.html): check additions, change or hide snacks, tidy subcategories.
   Only accounts on the database's owners list can use it: every owner call checks that list, so this page is a convenience, not the lock.
   It never shows who sent anything. ---------- */
let ownerInfo=null, own=null;
async function loadOwner(){try{ownerInfo=me?await rpc('owner_status'):null}catch(e){ownerInfo=e?.code==='PGRST202'?null:{owner:false,failed:true}}renderOwnerLink()} // null before migration 011
function renderOwnerLink(){
  const b=$('#owner-link');if(!b)return;
  b.hidden=!ownerInfo?.owner;
  const n=(ownerInfo?.to_check||0)+(ownerInfo?.reports||0); // additions, plus snacks someone says aren't right (migration 015)
  if(ownerInfo?.owner)b.textContent=`🛠️ Owner page${n?` · ${n} to check`:''}`;
}
const OWN_EMOJI={1:['🍫','🍪','🍩','🥜','🍓'],2:['🍬','🍭','🍫','🍪','🍯'],3:['🥔','🥨','🍿','🧀','🥜']};
// One emoji, as owner_emoji() in the database allows: flags and joined ones (👩‍🍳) too, but no letters, numbers or spaces
const OWN_EMOJI_RE=/^[©®‍‰-⯿〰〽㊗㊙︎️\u{1F000}-\u{1FAFF}\u{E0020}-\u{E007F}]+$/u;
const okEmoji=e=>!e||([...e].length<=10&&OWN_EMOJI_RE.test(e));
const OWN_FILTERS=[['all','All'],['live','Live'],['pending','In the vote'],['closed','Closed'],['hidden','Hidden'],['sort','Flavour to sort']];
const ownIn=(x,f)=>f==='all'||(f==='sort'?x.is_other&&x.status!=='hidden':x.status===f);
const ownCats=()=>own.cat.categories.filter(c=>c.visible);
const ownProduct=name=>own.cat.products.find(p=>norm(p.name)===norm(tidyCase(name||'',true)));
const ownQ=id=>own.queue.find(x=>String(x.id)===String(id));
const ownDate=d=>new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
const ownErr=e=>e.message||String(e);

async function renderOwner(){
  const el=$('#v-owner'),top=`<button class="crumb" data-act="home">← Back to the site</button><h1 class="page-title">Owner page</h1>`;
  if(!me){el.innerHTML=`${top}<div class="card empty"><p>Sign in to check additions and look after the snacks.</p><button class="btn btn-primary" data-act="own-sign-in">Sign in</button></div>`;return}
  if(!ownerInfo?.owner)await loadOwner();
  if(!ownerInfo?.owner){
    el.innerHTML=`<button class="crumb" data-act="home">← Back</button><div class="card empty own-empty"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-confused"/></svg>
      <h1 class="own-h">${ownerInfo?.failed?"Couldn't open the owner page":ownerInfo?"This page is for TasteRank's owner":'The owner page isn\'t ready yet'}</h1>
      <p>${ownerInfo?.failed?'Check your connection, then reload.':ownerInfo?'Looking for snacks? <button class="link" data-act="home">Go to the home page</button>':'Run migration 011 in Supabase first, then reload.'}</p></div>`;
    return;
  }
  if(!own)own={tab:'check',filter:'all',q:'',country:homeCountry()?.id??null,req:{}};
  el.innerHTML=`${top}<div class="own-tabs" role="tablist" aria-label="Owner page" id="own-tabs"></div><div id="own-body"><div class="card empty">Loading…</div></div>`;
  try{await ownFetch()}catch(e){console.error(e);$('#own-body').innerHTML=`<div class="card empty">Couldn't load the owner page. Check your connection and refresh.</div>`;return}
  drawOwner();
}
async function ownFetch(){
  const [queue,cat,snacks,reports]=await Promise.all([rpc('owner_queue'),rpc('owner_catalogue'),rpc('owner_snacks',{p_country:own.country}),rpc('owner_reports').catch(()=>[])]); // [] before migration 015
  Object.assign(own,{queue,cat,snacks,reports:reports||[]});
  if(ownerInfo){ownerInfo.to_check=queue.length;ownerInfo.reports=own.reports.length;renderOwnerLink()}
}
function ownRefresh(){ // after a change: everything reloads, and the rest of the site forgets what it had kept
  homeData=null;for(const k in catalogues)delete catalogues[k];for(const k in allTypes)delete allTypes[k];
  return ownFetch().then(()=>{const f=document.activeElement;if(!(f&&$('#own-body')?.contains(f)&&f.tagName!=='BUTTON'))drawOwner()}).catch(oops);
}
function drawOwner(){
  if(view!=='owner'||!own?.queue||!$('#own-body'))return;
  $('#own-tabs').innerHTML=[['check',`To check <span class="n">${own.queue.length+own.reports.length}</span>`],['snacks','Snacks'],['subs','Subcategories']]
    .map(([k,l])=>`<button class="chip${own.tab===k?' on':''}" role="tab" aria-selected="${own.tab===k}" data-act="own-tab" data-tab="${k}">${l}</button>`).join('');
  $('#own-body').innerHTML=own.tab==='check'?ownCheckHtml():own.tab==='snacks'?ownSnacksHtml():ownSubsHtml();
}

/* To check: one card per addition, filled in with what the sender chose */
function ownReq(r){
  return own.req[r.id]||(own.req[r.id]={cat:r.category_id||(r.new_type?'new':null),newType:r.new_type?tidyCase(r.new_type,true):'',sub:r.product||tidyCase(r.new_ranking,true),flavour:r.kind==='ranking'?tidyCase(r.new_variant||'Original',true):'',
    emoji:null,other:false,names:false,pack:r.pack_name,brand:r.brand_name,confirm:false,error:null,busy:false});
}
function ownCheckHtml(){
  if(!own.queue.length&&!own.reports.length)return `<div class="card empty own-empty"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-happy"/></svg><h2 class="own-h">Nothing to check</h2><p>New additions, and snacks someone says aren't right, appear here. You'll get an email too.</p></div>`;
  return own.reports.map(ownReportCard).join('')+own.queue.map(ownReqCard).join(''); // reports first: those snacks are in the vote now
}
/* "Not right?" reports (migration 015): one card per snack, with how many said what and their notes; never who sent them */
const REPORT_LABEL={not_sold:'Not sold here',wrong_list:'In the wrong list',wrong_name:'Wrong name or photo',duplicate:'Already listed',other:'Something else'};
function ownReportCard(x){
  const pl=placeBy('id',x.country_id)||{},busy=own.repBusy===x.item_id?' disabled':'';
  return `<div class="card own-req own-rep" id="own-rep-${x.item_id}"><div class="own-top">${thumb({emoji:x.emoji})}<div><h3 class="own-name">${esc(x.pack_name)}</h3>
    <p class="meta">${esc(x.brand)} · ${esc(x.product)} · ${esc(pl.short_name||'')} · ${x.approvals} of ${settings.approval_votes} approvals</p>
    <p class="own-what"><span class="reptag">${x.reports===1?'1 person says':`${x.reports} people say`} it's not right</span> ${ownPill(x.status)}</p></div></div>
    <ul class="own-reasons">${Object.entries(x.reasons||{}).sort((a,b)=>b[1]-a[1]).map(([k,c])=>`<li>${esc(REPORT_LABEL[k]||k)}${c>1?` <b>×${c}</b>`:''}</li>`).join('')}</ul>
    ${(x.notes||[]).length?`<div class="own-notes">${x.notes.map(t=>`<p>“${esc(t)}”</p>`).join('')}</div>`:''}
    <div class="own-acts"><button class="btn btn-primary" data-act="own-rep-fix" data-id="${x.item_id}"${busy}>Fix it</button>
      <button class="btn btn-danger" data-act="own-rep-hide" data-id="${x.item_id}"${busy}>${x.status==='pending'?'Take it out of the vote':'Hide it'}</button>
      <button class="btn" data-act="own-rep-keep" data-id="${x.item_id}"${busy}>Keep as is</button></div></div>`;
}
async function ownResolve(id,action){
  const x=own.reports.find(r=>r.item_id===id);if(!x||own.repBusy)return;
  own.repBusy=id;drawOwner();
  try{
    await rpc('owner_resolve_report',{p_item:id,p_action:action});
    own.reports=own.reports.filter(r=>r!==x);
    toast(action==='hide'?`${x.pack_name} is hidden`:`Kept ${x.pack_name} as it is`,action==='hide'?{label:'Undo',act:'own-unhide',id}:null);
  }catch(e){toast(ownErr(e))}
  own.repBusy=null;drawOwner();$('#own-tabs .chip.on')?.focus();ownRefresh();
}
// A new category's name, as you'd accept it: new, or one that's already set up (then it goes in there)
function ownTypeNote(n){const c=norm(n)&&own.cat.categories.find(x=>norm(x.name)===norm(n));return !norm(n)?'Name the new category':c?`Already listed: it goes into ${c.name}`:'New category: it shows on home once you accept'}
// The request's category chips: every category (ones with no snacks yet say so), then a new one the sender typed
function ownReqCatChips(r,s){
  return `<div class="chips wrap" role="group" aria-label="Category">${own.cat.categories.map(c=>`<button class="chip${c.id===s.cat?' on':''}" aria-pressed="${c.id===s.cat}" data-act="own-req-cat" data-id="${r.id}" data-cat="${c.id}">${esc(c.name)}${c.visible?'':' <span class="in">· no snacks yet</span>'}</button>`).join('')}${r.new_type?`<button class="chip chip-new${s.cat==='new'?' on':''}" aria-pressed="${s.cat==='new'}" data-act="own-req-cat" data-id="${r.id}" data-cat="new">＋ New: ${esc(s.newType||r.new_type)}</button>`:''}</div>
    ${s.cat==='new'?`<label class="field own-newtype">New category name<input data-own="newType" data-id="${r.id}" value="${esc(s.newType)}" autocomplete="off" maxlength="40"><span class="hint" id="own-tn-${r.id}">${esc(ownTypeNote(s.newType))}</span></label>`:''}`;
}
function ownSubNote(sub){const p=ownProduct(sub);return !norm(sub)?'Type the subcategory':p?`Already listed: it goes into ${p.name}`:'New subcategory'}
function ownEmojiHtml(cat,value,otherOpen,act,id,attr){ // five that suit the category, then Other… (any emoji, typed or pasted)
  const list=OWN_EMOJI[cat]||OWN_EMOJI[2],mine=!!value&&!list.includes(value)&&okEmoji(value),other=mine||otherOpen;
  return `<div class="own-emo" role="group" aria-label="Emoji">${list.map(e=>`<button type="button" class="${e===value&&!otherOpen?'on':''}" aria-pressed="${e===value&&!otherOpen}" data-act="${act}" data-id="${id}" data-e="${e}">${e}</button>`).join('')}
    <button type="button" class="other${other?' on':''}" aria-pressed="${other}" data-act="${act}" data-id="${id}" data-e="">${mine?`<b>${esc(value)}</b> Yours`:'Other…'}</button></div>
    ${otherOpen?`<label class="field own-custom">Your own emoji<input ${attr}="custom" data-id="${id}" value="${value&&!list.includes(value)?esc(value):''}" autocomplete="off" maxlength="16"><span class="hint">Type or paste one emoji. It shows on cards with no photo.</span></label>`:''}`;
}
const ownCatChips=(on,act,id)=>`<div class="chips wrap" role="group" aria-label="Category">${ownCats().map(c=>`<button class="chip${c.id===on?' on':''}" aria-pressed="${c.id===on}" data-act="${act}"${id!=null?` data-id="${id}"`:''} data-cat="${c.id}">${esc(c.name)}</button>`).join('')}</div>`;
function ownReqCard(r){
  const s=ownReq(r),pl=placeBy('id',r.country_id)||{},isNew=!ownProduct(s.sub),emo=s.emoji||(OWN_EMOJI[s.cat]||OWN_EMOJI[2])[0];
  const what=r.new_type?`category "${esc(r.new_type)}" · subcategory "${esc(r.new_ranking)}"`:r.kind==='category'?`subcategory "${esc(r.new_ranking)}"`:r.product?`flavour "${esc(r.new_variant||r.new_ranking)}" in ${esc(r.product)}`:`"${esc(r.new_ranking)}"`;
  const head=`<div class="own-top">${thumb({...r,emoji:okEmoji(emo)?emo:(OWN_EMOJI[s.cat]||OWN_EMOJI[2])[0]})}<div><h3 class="own-name">${esc(s.pack)}</h3><p class="meta">${esc(s.brand)} · ${esc(pl.short_name||'')} · sent ${ownDate(r.sent)}</p>
    <p class="own-what"><span class="newtag sm">New</span> ${what}</p></div></div>`;
  if(s.confirm)return `<div class="card own-req" id="own-r-${r.id}">${head}<div class="own-confirm"><p>Decline ${esc(s.pack)}? The sender sees "Not this time".</p>
    <div class="own-acts"><button class="btn btn-danger-solid" data-act="own-decline-yes" data-id="${r.id}"${s.busy?' disabled':''}>Decline</button><button class="btn" data-act="own-decline-no" data-id="${r.id}">Keep</button></div></div></div>`;
  return `<div class="card own-req" id="own-r-${r.id}">${head}
    <div class="own-f"><span class="lab">Category</span>${ownReqCatChips(r,s)}</div>
    <label class="field">Subcategory<input data-own="sub" data-id="${r.id}" value="${esc(s.sub)}" autocomplete="off"><span class="hint" id="own-sn-${r.id}">${esc(ownSubNote(s.sub))}</span></label>
    ${r.kind==='ranking'?`<label class="field">Flavour<input data-own="flavour" data-id="${r.id}" value="${esc(s.flavour)}" autocomplete="off"></label>`:''}
    <div class="own-f" id="own-emo-${r.id}"${isNew?'':' hidden'}><span class="lab">Emoji</span>${ownEmojiHtml(s.cat,emo,s.other,'own-req-emoji',r.id,'data-own')}</div>
    ${s.names?`<label class="field">Name on the pack<input data-own="pack" data-id="${r.id}" value="${esc(s.pack)}" autocomplete="off"></label><label class="field">Brand<input data-own="brand" data-id="${r.id}" value="${esc(s.brand)}" autocomplete="off"></label>`
      :`<button class="link own-edit" data-act="own-req-names" data-id="${r.id}">Edit name or brand</button>`}
    ${s.error?`<p class="sheet-error" role="alert">${esc(s.error)}</p>`:''}
    <div class="own-acts"><button class="btn btn-primary" data-act="own-accept" data-id="${r.id}"${s.busy?' disabled':''}>Accept</button><button class="btn btn-danger" data-act="own-decline" data-id="${r.id}">Decline</button></div></div>`;
}
function ownRedrawReq(id,focus){ // one card, keeping your place: focus goes back to the control you used
  const r=ownQ(id),el=$(`#own-r-${CSS.escape(String(id))}`);if(!r||!el)return;
  el.outerHTML=ownReqCard(r);
  if(focus)$(`#own-r-${CSS.escape(String(id))} ${focus}`)?.focus();
}
async function ownAccept(id){
  const r=ownQ(id),s=ownReq(r);if(s.busy)return;
  const isNew=!ownProduct(s.sub),emo=isNew?(s.emoji||(OWN_EMOJI[s.cat]||OWN_EMOJI[2])[0]):null;
  s.error=!norm(s.sub)?'Type the subcategory':s.cat==='new'&&!norm(s.newType)?'Name the new category':isNew&&!s.cat?'Pick the category':isNew&&s.other&&!s.emoji?'Type or paste an emoji, or pick one':isNew&&!okEmoji(emo)?'Just one emoji':!norm(s.pack)?'Type the name on the pack':!norm(s.brand)?'Add the brand':null;
  if(s.error)return ownRedrawReq(id,'[role="alert"]');
  s.busy=true;ownRedrawReq(id);
  try{
    const res=await rpc('owner_accept',{p_request:r.id,p_category:s.cat==='new'?null:s.cat,...(s.cat==='new'?{p_new_type:s.newType}:{}),p_subcategory:s.sub,p_flavour:r.kind==='ranking'?s.flavour||null:null,p_emoji:emo,
      p_brand_name:s.brand!==r.brand_name?s.brand:null,p_pack_name:s.pack!==r.pack_name?s.pack:null});
    ownDone(r);
    toast(/in the vote/.test(res.message)?`${res.pack_name} is in the vote, in ${res.product}.`:res.message,res.item_id?{label:'Change it',act:'own-open',id:res.item_id}:null);
  }catch(e){s.busy=false;s.error=ownErr(e);ownRedrawReq(id,'[role="alert"]')}
}
async function ownDecline(id){
  const r=ownQ(id),s=ownReq(r);if(s.busy)return;
  s.busy=true;ownRedrawReq(id);
  try{await rpc('owner_decline',{p_request:r.id});ownDone(r);toast('Declined. The sender sees "Not this time".')}
  catch(e){Object.assign(s,{busy:false,confirm:false,error:ownErr(e)});ownRedrawReq(id,'[role="alert"]')}
}
function ownDone(r){ // accepted or declined: it leaves the list now, and the rest reloads
  own.queue=own.queue.filter(x=>x!==r);delete own.req[r.id];
  if(ownerInfo){ownerInfo.to_check=own.queue.length;renderOwnerLink()}
  drawOwner();$('#own-tabs .chip.on')?.focus();ownRefresh();
}

/* Snacks: every snack in a country (or all), with a search and filters; a row opens "Change this snack" */
function ownSnacksHtml(){
  const list=own.snacks||[];
  return `<div class="own-srow"><input id="own-q" type="search" placeholder="Find a snack or brand" aria-label="Find a snack or brand" value="${esc(own.q)}" autocomplete="off">
    <select id="own-country" aria-label="Country"><option value="">All countries</option>${places.map(p=>`<option value="${p.id}"${p.id===own.country?' selected':''}>${p.flag} ${esc(p.short_name)}</option>`).join('')}</select></div>
    <div class="chips own-filters" role="group" aria-label="Show">${OWN_FILTERS.map(([k,l])=>`<button class="chip sm${own.filter===k?' on':''}" aria-pressed="${own.filter===k}" data-act="own-filter" data-f="${k}">${l} <span class="n">${list.filter(x=>ownIn(x,k)).length}</span></button>`).join('')}</div>
    <div id="own-list">${ownListHtml()}</div>`;
}
const ownPill=st=>`<span class="own-pill ${st}">${{live:'Live',pending:'In the vote',closed:'Closed',hidden:'Hidden'}[st]||esc(st)}</span>`;
function ownListHtml(){
  const words=snackKey(own.q).split(' ').filter(Boolean),n=settings.approval_votes;
  const l=(own.snacks||[]).filter(x=>ownIn(x,own.filter)&&words.every(w=>snackKey(`${x.pack_name} ${x.brand}`).includes(w)));
  if(!l.length)return `<div class="card empty">${own.snacks?.length?'No snacks match.':'No snacks here yet.'}</div>`;
  return `<div class="list">${l.map(x=>{
    const pl=own.country?null:placeBy('id',x.country_id);
    const more=x.status==='pending'?`${x.approvals} of ${n} approvals`:x.status==='closed'?`closed, ${x.approvals} of ${n} approvals`
      :x.status==='hidden'?`${plural(x.ratings,'rating')} kept`:x.ratings?plural(x.ratings,'rating'):'no ratings yet';
    return `<button class="ir own-row${x.status==='hidden'?' hid':''}" data-act="own-open" data-id="${x.id}">${thumb(x,'sm')}
      <span class="in"><span class="bn">${esc(x.pack_name)}</span><span class="pk">${pl?pl.flag+' ':''}${esc(x.product)} · ${esc(x.brand)} · ${more}</span></span>${ownPill(x.status)}</button>`}).join('')}</div>`;
}
function ownDrawList(){const el=$('#own-list');if(el)el.innerHTML=ownListHtml()}
async function ownOpenSnack(id){
  let x=own?.snacks?.find(s=>String(s.id)===String(id));
  if(!x)try{x=(await rpc('owner_snacks',{p_country:null,p_item:+id}))[0]}catch(e){return oops(e)}
  if(!x)return toast("That snack isn't here any more.");
  own.sub=null;own.edit={...x,sub:x.product,newSub:false,cat:x.category_id,photo:null,removePhoto:false,error:null,busy:false};
  ownDrawSheet();openM('m-owner');
}
function ownDrawSheet(){$('#owner-body').innerHTML=own.edit?ownSnackSheet():own.sub?ownSubSheet():''}
function ownStatusLine(x){
  const n=settings.approval_votes;
  return x.status==='live'?`Live · ${x.ratings?plural(x.ratings,'rating')+(x.avg!=null?` · average ${score1(x.avg)}`:''):'no ratings yet'}`
    :x.status==='pending'?`In the vote · ${x.approvals} of ${n} approvals · closes in ${plural(x.days_left,'day')}`
    :x.status==='closed'?`Closed · ${x.approvals} of ${n} approvals`:`Hidden · ${plural(x.ratings,'rating')} kept`;
}
function ownSnackSheet(){
  const e=own.edit,pl=placeBy('id',e.country_id)||{},prods=own.cat.products.filter(p=>p.category_id===e.cat),cur=e.newSub?null:ownProduct(e.sub);
  const pic=e.photo?{image_url:e.photo.url}:e.removePhoto?{emoji:e.emoji}:e,hasPic=!!(e.photo||(!e.removePhoto&&(e.image_url||e.image_path)));
  const link=['live','pending'].includes(e.status)?` · <a href="${esc(hashFor({v:'category',cc:pl.code,product:e.product_id,snack:e.status==='pending'?e.id:null}))}" target="_blank" rel="noopener">Open on TasteRank</a>`:'';
  return `<h3 id="own-sheet-title">Change this snack</h3><p class="own-sum">${esc(ownStatusLine(e))}${link}</p>
    <div class="own-photo">${thumb(pic,'big')}<label class="btn sm">Change photo<input type="file" id="own-photo" accept="image/*" class="sr-only"></label>${hasPic?'<button class="link btn-danger" data-act="own-photo-remove">Remove</button>':''}</div>
    <label class="field">Name on the pack<input data-edit="pack_name" value="${esc(e.pack_name)}" autocomplete="off"></label>
    <label class="field">Brand<input data-edit="brand" value="${esc(e.brand)}" autocomplete="off"></label>
    <label class="field">Sold in<select id="own-e-country">${places.map(p=>`<option value="${p.id}"${p.id===e.country_id?' selected':''}>${p.flag} ${esc(p.name)}</option>`).join('')}</select></label>
    <div class="own-f"><span class="lab">Category</span>${ownCatChips(e.cat,'own-edit-cat')}</div>
    <div class="own-two"><label class="field">Subcategory<select id="own-e-sub">${prods.map(p=>`<option value="${esc(p.name)}"${cur?.id===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}<option value="new"${cur?'':' selected'}>＋ New…</option></select></label>
      <label class="field">Flavour<input data-edit="flavour" value="${esc(e.flavour)}" list="own-flavours" autocomplete="off" placeholder="Guess it"><datalist id="own-flavours">${(cur?.flavours||[]).map(f=>`<option value="${esc(f.name)}">`).join('')}</datalist></label></div>
    ${cur?'':`<label class="field">New subcategory<input data-edit="sub" value="${esc(e.newSub?e.sub:'')}" autocomplete="off"><span class="hint" id="own-e-sn">${esc(ownSubNote(e.newSub?e.sub:''))}</span></label>`}
    ${e.error?`<p class="sheet-error" role="alert">${esc(e.error)}</p>`:''}
    <button class="btn btn-primary btn-block" data-act="own-save"${e.busy?' disabled':''}>Save changes</button>
    <div class="own-more">
      ${['pending','closed'].includes(e.status)?`<button class="btn btn-block" data-act="own-status" data-a="live"${e.busy?' disabled':''}>Put live now (skip the vote)</button>`:''}
      ${e.status==='hidden'?`<button class="btn btn-block" data-act="own-status" data-a="show"${e.busy?' disabled':''}>Show it again</button>`
        :`<button class="btn btn-block btn-danger" data-act="own-status" data-a="hide"${e.busy?' disabled':''}>Hide from TasteRank</button><p class="hint">It disappears from the site, but its ratings are kept and you can show it again.</p>`}
    </div>`;
}
async function ownSave(){
  const e=own.edit;if(e.busy)return;
  const sub=(e.sub||'').trim();
  e.error=!sub?'Pick or name the subcategory':!norm(e.pack_name)?'Type the name on the pack':!norm(e.brand)?'Add the brand':null;
  if(e.error)return ownDrawSheet();
  e.busy=true;ownDrawSheet();
  try{
    const photo=e.photo?(LIVE?await uploadPhoto(e.photo.blob):e.photo.dataUrl):e.removePhoto?'':null;
    await rpc('owner_save_snack',{p_item:e.id,p_pack_name:e.pack_name,p_brand_name:e.brand,p_country:e.country_id,p_category:e.cat,p_subcategory:sub,p_flavour:e.flavour||null,p_photo:photo});
    if(e.fromReport)await rpc('owner_resolve_report',{p_item:e.id,p_action:'clear'}).catch(console.error);
    closeM();toast(e.fromReport?'Saved, and its reports are cleared':'Saved');ownRefresh();
  }catch(err){e.busy=false;e.error=ownErr(err);ownDrawSheet()}
}
async function ownStatus(a,id){ // from the sheet, or (with id) from the Undo in the note
  const e=id==null?own.edit:null;if(e?.busy)return;if(e){e.busy=true;ownDrawSheet()}
  try{
    const x=await rpc('owner_set_status',{p_item:id??e.id,p_action:a});
    if(e)closeM();
    toast(a==='hide'?`${x.pack_name} is hidden`:a==='show'?`${x.pack_name} is back on TasteRank`:`🎉 ${x.pack_name} is live`,a==='hide'?{label:'Undo',act:'own-unhide',id:x.id}:null);
    ownRefresh();
  }catch(err){if(e){e.busy=false;e.error=ownErr(err);ownDrawSheet()}else toast(ownErr(err))}
}

/* Subcategories: by category; a row opens "Change …": name, category, emoji, and moving its snacks into another */
function ownSubsHtml(){
  return own.cat.categories.map(c=>{const ps=own.cat.products.filter(p=>p.category_id===c.id);if(!ps.length)return '';
    return `<h2>${esc(c.name)}</h2><div class="list">${ps.map(p=>`<button class="ir own-row" data-act="own-sub" data-id="${p.id}"><span class="thumb sm" aria-hidden="true">${esc(p.emoji)}</span>
      <span class="in"><span class="bn">${esc(p.name)}</span><span class="pk">${plural(p.snacks,'snack')} · ${p.ratings?plural(p.ratings,'rating'):'no ratings yet'}</span></span><span class="go" aria-hidden="true">›</span></button>`).join('')}</div>`}).join('');
}
function ownOpenSub(id){
  const p=own.cat.products.find(x=>x.id===+id);if(!p)return;
  own.edit=null;own.sub={...p,name0:p.name,cat:p.category_id,other:false,move:false,into:null,error:null,busy:false};
  ownDrawSheet();openM('m-owner');
}
function ownSubSheet(){
  const s=own.sub,others=own.cat.products.filter(p=>p.id!==s.id&&p.category_id===s.category_id),into=others.find(p=>p.id===s.into)||others[0];
  const catName=(own.cat.categories.find(c=>c.id===s.category_id)||{}).name||'';
  return `<h3 id="own-sheet-title">Change ${esc(s.name0)}</h3><p class="own-sum">${plural(s.snacks,'snack')} · ${s.ratings?plural(s.ratings,'rating'):'no ratings yet'}</p>
    <label class="field">Name<input data-sub="name" value="${esc(s.name)}" autocomplete="off"></label>
    <div class="own-f"><span class="lab">Category</span>${ownCatChips(s.cat,'own-sub-cat')}</div>
    <div class="own-f"><span class="lab">Emoji</span>${ownEmojiHtml(s.cat,s.emoji,s.other,'own-sub-emoji',s.id,'data-sub')}</div>
    ${s.error?`<p class="sheet-error" role="alert">${esc(s.error)}</p>`:''}
    <button class="btn btn-primary btn-block" data-act="own-sub-save"${s.busy?' disabled':''}>Save changes</button>
    <div class="own-more">${!s.move?`<button class="btn btn-block" data-act="own-move-open">Move its snacks into…</button><p class="hint">For a duplicate: its snacks and their ratings move across, then ${esc(s.name0)} goes.</p>`
      :!into?`<p class="hint">There's no other subcategory in ${esc(catName)} to move them into.</p>`
      :`<label class="field">Move its snacks into<select id="own-move-into">${others.map(p=>`<option value="${p.id}"${p.id===into.id?' selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
        <div class="own-confirm"><p>Move ${plural(s.snacks,'snack')} from ${esc(s.name0)} into ${esc(into.name)}? ${esc(s.name0)} then goes.</p>
        <div class="own-acts"><button class="btn btn-danger-solid" data-act="own-move" data-into="${into.id}"${s.busy?' disabled':''}>Move them</button><button class="btn" data-act="own-move-cancel">Keep</button></div></div>`}</div>`;
}
async function ownSubSave(){
  const s=own.sub;if(s.busy)return;
  s.error=!norm(s.name)?'Name the subcategory':s.other&&!s.emoji?'Type or paste an emoji, or pick one':!okEmoji(s.emoji)?'Just one emoji':null;
  if(s.error)return ownDrawSheet();
  s.busy=true;ownDrawSheet();
  try{await rpc('owner_save_subcategory',{p_product:s.id,p_name:s.name,p_category:s.cat,p_emoji:s.emoji||null});closeM();toast('Saved');ownRefresh()}
  catch(e){s.busy=false;s.error=ownErr(e);ownDrawSheet()}
}
async function ownMove(into){
  const s=own.sub;if(s.busy)return;s.busy=true;ownDrawSheet();
  try{const n=await rpc('owner_move_snacks',{p_from:s.id,p_into:+into});closeM();
    toast(`Moved ${plural(n,'snack')} into ${(own.cat.products.find(p=>p.id===+into)||{}).name}`);ownRefresh()}
  catch(e){s.busy=false;s.error=ownErr(e);ownDrawSheet()}
}
const OWN_ACT={
  'own-sign-in':()=>needUser({name:'owner'}),
  'own-tab':d=>{own.tab=d.tab;drawOwner();$(`#own-tabs [data-tab="${d.tab}"]`)?.focus()},
  'own-req-cat':d=>{const s=own.req[d.id];s.cat=d.cat==='new'?'new':+d.cat;s.error=null;ownRedrawReq(d.id,`[data-act="own-req-cat"][data-cat="${d.cat}"]`)},
  'own-req-emoji':d=>{const s=own.req[d.id];if(d.e){s.emoji=d.e;s.other=false}else{s.other=true;if((OWN_EMOJI[s.cat]||OWN_EMOJI[2]).includes(s.emoji))s.emoji=null}
    ownRedrawReq(d.id,d.e?`[data-e="${d.e}"]`:'[data-own="custom"]')},
  'own-req-names':d=>{own.req[d.id].names=true;ownRedrawReq(d.id,'[data-own="pack"]')},
  'own-accept':d=>ownAccept(d.id),
  'own-rep-fix':async d=>{await ownOpenSnack(d.id);if(own.edit)own.edit.fromReport=true},
  'own-rep-hide':d=>ownResolve(+d.id,'hide'),
  'own-rep-keep':d=>ownResolve(+d.id,'clear'),
  'own-decline':d=>{own.req[d.id].confirm=true;ownRedrawReq(d.id,'[data-act="own-decline-no"]')},
  'own-decline-no':d=>{own.req[d.id].confirm=false;ownRedrawReq(d.id,'[data-act="own-decline"]')},
  'own-decline-yes':d=>ownDecline(d.id),
  'own-filter':d=>{own.filter=d.f;drawOwner();$(`#own-body [data-f="${d.f}"]`)?.focus()},
  'own-open':d=>{$('#toast').hidden=true;ownOpenSnack(d.id)},
  'own-edit-cat':d=>{const e=own.edit;if(e.cat===+d.cat)return;e.cat=+d.cat;const first=own.cat.products.find(p=>p.category_id===e.cat);
    Object.assign(e,{sub:first?.name||'',newSub:!first,flavour:'',error:null});ownDrawSheet();$(`#owner-body [data-cat="${d.cat}"]`)?.focus()},
  'own-photo-remove':()=>{Object.assign(own.edit,{photo:null,removePhoto:true});ownDrawSheet();$('#own-photo')?.focus()},
  'own-save':ownSave,
  'own-status':d=>ownStatus(d.a),
  'own-unhide':d=>{$('#toast').hidden=true;ownStatus('show',+d.id)},
  'own-sub':d=>ownOpenSub(d.id),
  'own-sub-cat':d=>{own.sub.cat=+d.cat;ownDrawSheet();$(`#owner-body [data-cat="${d.cat}"]`)?.focus()},
  'own-sub-emoji':d=>{const s=own.sub;if(d.e){s.emoji=d.e;s.other=false}else{s.other=true;if((OWN_EMOJI[s.cat]||OWN_EMOJI[2]).includes(s.emoji))s.emoji=null}
    ownDrawSheet();$(`#owner-body ${d.e?`[data-e="${d.e}"]`:'[data-sub="custom"]'}`)?.focus()},
  'own-sub-save':ownSubSave,
  'own-move-open':()=>{own.sub.move=true;ownDrawSheet();$('#own-move-into')?.focus()},
  'own-move-cancel':()=>{own.sub.move=false;ownDrawSheet();$('#owner-body [data-act="own-move-open"]')?.focus()},
  'own-move':d=>ownMove(d.into)
};
document.addEventListener('input',e=>{
  if(!own)return;const t=e.target,d=t.dataset||{};
  if(t.id==='own-q'){own.q=t.value;return ownDrawList()}
  if(d.own&&own.req[d.id]){const s=own.req[d.id];
    if(d.own==='custom')s.emoji=t.value.trim()||null;else s[d.own]=t.value;
    if(d.own==='newType'){$('#own-tn-'+CSS.escape(d.id)).textContent=ownTypeNote(s.newType);const c=$(`#own-r-${CSS.escape(d.id)} .chip-new`);if(c)c.textContent='＋ New: '+(t.value.trim()||'…')}
    if(d.own==='sub'){$('#own-sn-'+CSS.escape(d.id)).textContent=ownSubNote(s.sub);$('#own-emo-'+CSS.escape(d.id)).hidden=!!ownProduct(s.sub)}}
  if(d.edit&&own.edit){own.edit[d.edit]=t.value;if(d.edit==='sub'){const n=$('#own-e-sn');if(n)n.textContent=ownSubNote(t.value)}}
  if(d.sub&&own.sub){if(d.sub==='custom')own.sub.emoji=t.value.trim()||null;else own.sub[d.sub]=t.value}
});
document.addEventListener('change',async e=>{
  if(!own)return;const t=e.target;
  if(t.id==='own-country'){own.country=t.value?+t.value:null;await ownRefresh();$('#own-country')?.focus()}
  if(t.id==='own-e-country'&&own.edit)own.edit.country_id=+t.value;
  if(t.id==='own-e-sub'&&own.edit){Object.assign(own.edit,t.value==='new'?{newSub:true,sub:''}:{newSub:false,sub:t.value},{flavour:''});ownDrawSheet();$(t.value==='new'?'#owner-body [data-edit="sub"]':'#own-e-sub')?.focus()}
  if(t.id==='own-move-into'&&own.sub){own.sub.into=+t.value;ownDrawSheet();$('#own-move-into')?.focus()}
  if(t.id==='own-photo'&&t.files[0]&&own.edit){
    try{own.edit.photo=await shrinkPhoto(t.files[0]);own.edit.removePhoto=false;own.edit.error=null}catch(x){own.edit.error=x.message}
    ownDrawSheet();$('#own-photo')?.focus();
  }
});

/* ---------- Profile ---------- */
async function renderProfile(){
  if(!me)return go({v:'home'});
  const el=$('#v-profile');
  let mine=[],subs=[];mySubs=[];try{await loadProfile();[mine,subs]=await Promise.all([rpc('my_ratings'),rpc('my_submissions').catch(()=>[])])}catch(e){oops(e)}
  subsView={group:null,page:1};
  for(const c of new Set([...subs,...mine].map(x=>x.country_id)))try{await loadCatalogue(c)}catch(e){} // for the category names
  const p=profile||{taster_id:'',rated:0},lists=new Set(mine.map(r=>`${r.product_id}-${r.country_id}`)).size;
  const category=r=>((catalogues[r.country_id]||[]).flatMap(t=>t.products).find(x=>x.id===r.product_id)||{}).name||r.ranking_title;
  el.innerHTML=`
    <button class="crumb" data-act="home">← Back</button>
    <div class="card profile">
      <div class="p-head"><span class="thumb big me-pic" aria-hidden="true"><svg><use href="#crisp-yum"/></svg></span><div><h1 class="page-title">Your profile</h1><div class="meta">Taster ID ${esc(p.taster_id)}</div></div></div>
      <div class="stats">
        <div class="stat"><b>${fmt(p.rated)}</b><span>snacks rated</span></div>
        <div class="stat"><b>${fmt(lists)}</b><span>${lists===1?'list':'lists'} helped</span></div>
      </div>
      <button class="btn" data-act="share">Share TasteRank</button>
    </div>
    <h2>Your ratings</h2>
    ${mine.length?`<div class="list">${mine.map(r=>{const f=FACES.find(x=>x.v===r.score),cc=placeBy('id',r.country_id)?.code||DEFAULT_COUNTRY;
      return `<button class="ir" data-act="category" data-cc="${cc}" data-product="${r.product_id}">
        <span class="rk" aria-label="${f.l}">${f.e}</span>${thumb(r,'sm')}
        <span class="in"><span class="bn">${esc(r.pack_name)}</span><span class="pk">${esc(category(r))} · ${r.flag}</span></span><span></span></button>`}).join('')}</div>`
      :`<div class="card empty">You haven't rated anything yet. <button class="link" data-act="home">Find something to rate</button></div>`}
    <h2 id="subs-h" tabindex="-1">Your additions</h2>
    <div id="subs-box"></div>
    <div class="profile-foot">
      <button class="btn" data-act="sign-out">Sign out</button>
      ${LIVE?'<button class="link btn-danger" data-act="delete-account">Delete my account</button>':'<button class="link" style="color:var(--muted)" data-act="reset-demo">Reset demo data</button>'}
    </div>`;
  mySubs=subs;drawSubs();
}
let mySubs=[],subsView={group:null,page:1};
/* Your additions: chips by where each one has got to, then 10 per page, newest first (design/mockups/profile-additions.html) */
const SUB_GROUPS=[['waiting','Waiting',['review','pending']],['live','Live',['live']],['closed','Closed',['closed','declined','hidden']]];
const subGroup=x=>(SUB_GROUPS.find(g=>g[2].includes(x.status))||SUB_GROUPS[2])[0];
const SUBS_PER_PAGE=10;
const chev=d=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
function drawSubs(){
  const box=$('#subs-box');if(!box)return;
  if(!mySubs.length){box.innerHTML=`<div class="card empty">Nothing yet. Missing a snack? Tap + and type what's on the pack.</div>`;return}
  const groups=SUB_GROUPS.map(([id,name])=>({id,name,count:mySubs.filter(x=>subGroup(x)===id).length})).filter(g=>g.count);
  if(!groups.some(g=>g.id===subsView.group))subsView.group=null; // a chip that's emptied (e.g. after withdrawing) goes back to All
  const list=subsView.group?mySubs.filter(x=>subGroup(x)===subsView.group):mySubs,pages=Math.ceil(list.length/SUBS_PER_PAGE);
  subsView.page=Math.min(Math.max(1,subsView.page),pages);
  const from=(subsView.page-1)*SUBS_PER_PAGE,shown=list.slice(from,from+SUBS_PER_PAGE);
  box.innerHTML=`${groups.length>=2?chipsHtml('Your additions by status','subs-group',[{id:null,name:'All',count:mySubs.length},...groups],subsView.group):''}
    <div class="list">${shown.map(x=>subRow(x,mySubs.indexOf(x))).join('')}</div>
    ${pages>1?`<div class="pager"><span class="of">${from+1}–${from+shown.length} of ${list.length}</span>
      <button class="pg" data-act="subs-page" data-p="${subsView.page-1}" data-dir="prev" aria-label="Previous page"${subsView.page===1?' disabled':''}>${chev('M15 6l-6 6 6 6')}</button>
      <button class="pg" data-act="subs-page" data-p="${subsView.page+1}" data-dir="next" aria-label="Next page"${subsView.page===pages?' disabled':''}>${chev('M9 6l6 6-6 6')}</button></div>`:''}`;
}
function subsGo(group,page,dir){
  if(group!==undefined)subsView={group,page:1};else subsView.page=page;
  redraw($('#subs-box'),drawSubs,'subs-group');
  if(dir)($(`#subs-box .pg[data-dir="${dir}"]:not([disabled])`)||$('#subs-box .pg:not([disabled])'))?.focus({preventScroll:true});
  const h=$('#subs-h'),bar=$('.bar')?.offsetHeight||0; // a new page starts at the top of Your additions, below the sticky header
  if(h&&h.getBoundingClientRect().top<bar)scrollTo({top:scrollY+h.getBoundingClientRect().top-bar-8,behavior:'instant'});
}
function subRow(x,i){ // a snack you sent in, and where it's got to: "🇬🇧 · Toffee", then "Waiting for approval · 2 of 5"
  const n=settings.approval_votes,pl=placeBy('id',x.country_id)||{},newCat=!!x.new_category,newType=newCat&&x.new_type;
  const st={pending:['⏳',`Waiting for approval · ${x.approvals} of ${n}`],live:['✅','Live: rate it'],
    review:['🔎',newType?'Waiting for us to check the new category':newCat?'Waiting for us to check the new subcategory':'Waiting for us to check it'],declined:['✖️','Not this time'],
    closed:['✖️',`Closed: it didn't get ${n} approvals in ${settings.close_after_days} days`],hidden:['✖️','Taken off TasteRank']}[x.status]||['',x.status];
  const inner=`<span class="rk" aria-hidden="true">${st[0]}</span><span></span>
    <span class="in"><span class="bn">${esc(x.pack_name||x.brand)}</span><span class="pk">${x.country_flag||pl.flag||''} · ${newType?`${esc(x.new_type)} › `:''}${esc(x.product||'')}${newCat?NEW_TAG:''}</span><span class="pk">${esc(st[1])}</span></span>`;
  if(x.status==='live')return `<button class="ir subr" data-act="category" data-cc="${esc(pl.code||DEFAULT_COUNTRY)}" data-product="${x.product_id}">${inner}<span class="go" aria-hidden="true">›</span></button>`;
  const act=['pending','review'].includes(x.status)?`<button class="btn sm" data-act="withdraw" data-i="${i}" aria-label="Withdraw ${esc(x.pack_name)}">Withdraw</button>`
    :x.status==='closed'&&x.product_id?`<button class="btn sm" data-act="add-again" data-i="${i}" aria-label="Add ${esc(x.pack_name)} again">Add again</button>`:'<span></span>';
  return `<div class="ir subr">${inner}${act}</div>`;
}
async function share(text,url=location.href){
  const data={title:'TasteRank',text:text||'Which snack wins? Snack brands from every country, rated like for like.',url};
  try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(url);toast('Link copied')}}catch(e){}
}
async function signedOut(msg){
  me=null;profile=null;homeData=null;ownerInfo=null;own=null;renderOwnerLink();
  renderHeader();await go({v:'home'});toast(msg);
}
async function signOut(){try{await api.signOut()}catch(e){}signedOut('Signed out')}
async function deleteAccount(){
  if(!confirm("Delete your account, ratings and approvals? This can't be undone."))return;
  try{await api.deleteAccount()}catch(e){return oops(e)}
  signedOut('Your account has been deleted');
}
async function resetDemo(){if(confirm('Reset all demo data in this browser?')){await api.deleteAccount();signedOut('Demo data reset')}}

/* ---------- Crispy's tips: one short tip at a time, where and when it helps, each once per device (design/DESIGN.md, "First-time guide").
   1 the home bubble, on the first visit only (or the visit the tips were turned back on), until 3 ratings · 2 the first list or brand page · 3 the sign-in pop-up's words (signInFor) · 4 the first rating, in the sheet
   · 5 above Waiting for approval · 6 above Share this list, after rating 2 in it · 7 beside the +, after 3 ratings or a second visit.
   The lowest number that fits wins; none is picked while a pop-up is open or before the page has loaded. ---------- */
const tips=(()=>{const t=store.get('tasterank-tips')||{};
  return {seen:Array.isArray(t.seen)?t.seen:[],visits:+t.visits||0,home:+t.home||1,last:+t.last||0,off:!!t.off,checked:!!t.checked}})();
const saveTips=()=>store.set('tasterank-tips',tips);
if(Date.now()-tips.last>30*60*1000)tips.visits++; // a visit: a page load more than 30 minutes after the last one
tips.last=Date.now();saveTips();
let tipNow=null,tipReady=false; // tipNow {n, key, fresh}; n 0 = one was just closed here, so no new one until a pop-up closes or the page changes
const tipSeen=n=>tips.seen.includes(n);
function tipMark(n){if(!tipSeen(n)){tips.seen.push(n);saveTips()}}
const tipKey=()=>view==='home'?'home':page?.key||view;
const myRated=()=>profile?profile.rated:0;
const TIPS={ // [Crispy's face, the words, whether it links to How it works]
  // under a "No winner yet" note, tip 2 leaves out what the note already says (10 ratings, How it works)
  2:()=>$(`#v-${view} .early`)?['crisp-happy','Know any of these? Tap a snack and pick a face.']
    :['crisp-happy',`Know any of these? Tap a snack and pick a face. Each snack needs ${settings.rank_after_ratings} ratings to be ranked.`,true],
  5:()=>['crisp-happy',`New snacks need ${settings.approval_votes} approvals to join the list. Know one of these? Approve it.`],
  6:()=>['crisp-joy',"Think the crowd's wrong? Share this list and settle it."]};
function tipFits(n){
  if(tipSeen(n))return false;
  const c=onCategory();
  if(n===2)return !!(c||onBrandPage());
  if(n===5)return !!(c&&me&&myRated()>=1&&$('#v-category .tip-slot[data-n="5"]')&&c.pending.some(p=>!p.mine&&!p.approved));
  if(n===6)return !!(c&&c.items.filter(i=>i.my_score).length>=2);
  if(n===7)return ['home','category','brand'].includes(view)&&(myRated()>=3||tips.visits>=2);
}
function updateTips(){
  if(profile&&!tips.checked){tips.checked=true;if(profile.rated>=3)[1,2,3,4].forEach(tipMark);saveTips()} // regulars skip the first four
  const key=tipKey(),bubble=view==='home'&&!tips.off&&!tipSeen(1)&&tips.visits<=tips.home&&myRated()<BUBBLE_UNTIL;
  $('#bubble').hidden=!bubble;
  if(tips.off||(tipNow&&tipNow.key!==key))tipNow=null;
  if(!tips.off&&!tipNow&&!bubble&&tipReady&&!openId){
    const n=[2,5,6,7].find(tipFits);
    if(n){tipNow={n,key,fresh:true};tipMark(n);track('tip-shown-'+n,true)}
  }
  drawTip();
}
function drawTip(){
  const n=tipNow?tipNow.n:0,fresh=!!tipNow?.fresh,fab=$('#add-fab'),t7=$('#tip7');
  document.querySelectorAll('.tip-slot').forEach(el=>{const k=+el.dataset.n;el.innerHTML=k===n?tipHtml(k,fresh):''});
  document.querySelectorAll('.share-btn').forEach(b=>b.classList.toggle('btn-primary',n===6));
  const show7=n===7&&!openId&&!fab.hidden;
  t7.hidden=!show7;t7.classList.toggle('tip-in',show7&&fresh);
  if(show7)fab.setAttribute('aria-describedby','tip7');else fab.removeAttribute('aria-describedby');
  if(tipNow)tipNow.fresh=false;
}
function tipHtml(n,fresh){
  const [face,text,how]=TIPS[n]();
  return `<div class="tip${fresh?' tip-in':''}" role="note"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#${face}"/></svg><div><p>${esc(text)}</p>
    <div class="acts"><button class="link" data-act="tip-ok" data-n="${n}">Got it</button>${how?'<button class="link" data-act="how">How it works</button>':''}</div></div></div>`;
}
function tipClose(n,how){ // Got it, or doing what the tip suggests
  tipMark(n);
  if(tipNow&&tipNow.n===n){track(`tip-${how}-${n}`,true);tipNow={n:0,key:tipKey()};drawTip()}
}
const tipAct=n=>tipClose(n,'acted'); // doing it also counts when the tip hasn't shown yet: they found it themselves
function setTips(on){
  if(on===!tips.off)return;
  tips.off=!on;if(on){tips.seen=[];tips.home=tips.visits} // back on: they start over, home bubble included
  tipNow=null;saveTips();track(on?'tips-on':'tips-off',true);renderTipsSwitch();updateTips();
}
function renderTipsSwitch(){document.querySelectorAll('[data-act="set-tips"]').forEach(b=>b.setAttribute('aria-pressed',!!b.dataset.on===!tips.off))}
function openHow(){
  const lines=[['Like for like','Every snack in a list, like Crisps or Toffee, is ranked together, country by country. Tap a flavour to compare like with like: Walkers vs Pringles in salt & vinegar crisps.'],
    ['Tap a face','Rate the ones you know. It saves straight away, and you can change it any time.'],
    ['Fair winners',`One rating per person. A snack is ranked after ${settings.rank_after_ratings} ratings, so nobody wins on a handful of votes.`],
    ['Grow it together',`New snacks go live with ${settings.approval_votes} approvals. Missing one? Tap + and type what's on the pack.`]];
  $('#how-list').innerHTML=lines.map(([b,t],k)=>`<li><span class="n" aria-hidden="true">${k+1}</span><div><b>${esc(b)}</b><span>${esc(t)}</span></div></li>`).join('');
  track('how-it-works',true);openM('m-how');
}

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
  renderTheme();renderTipsSwitch();
  $('#demo-bar').hidden=LIVE;
  if(!LIVE)$('#signin-fine').textContent='Demo mode: no real account is created.';
  if(CONFIG.SUPABASE_URL&&!window.supabase)toast("Couldn't reach the TasteRank server. Showing demo data.");
  const geo=detectCountry();
  const params=new URLSearchParams(location.search);
  try{
    if(params.has('error_description'))toast('Sign-in was cancelled or failed. Please try again.');
    me=await api.session();
    if(params.has('code')||params.has('error'))history.replaceState(null,'',location.pathname+location.hash); // tidy the address bar after Google sign-in
    [settings,places]=await Promise.all([rpc('app_settings'),rpc('place_list'),me?loadProfile():null,loadOwner()]);
  }catch(e){console.error(e);$('#cards').innerHTML='<div class="card empty">Couldn\'t load snacks. Check your connection and refresh.</div>';return}
  if(!prefs.country)await geo; // only wait for the guess when it decides what to show
  renderHeader();
  if(me&&store.get('tasterank-after',true))await afterSignIn();
  else await route();
  checkMoments();
  if(LIVE)sb.auth.onAuthStateChange((event,session)=>setTimeout(async()=>{ // e.g. signed out in another tab
    const u=userFrom(session);
    if((u&&u.id)===(me&&me.id))return;
    if(!u)return signedOut('Signed out');
    me=u;own=null;await Promise.all([loadProfile(),loadOwner()]);homeData=null;renderHeader();refresh();
  },0));
}
start();
