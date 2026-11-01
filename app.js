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
const BUBBLE_UNTIL=3; // Crispy's speech bubble on home shows until someone has rated this many items

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

/* ---------- Demo mode: the UK seed list plus Japanese crisps, with sample ratings ---------- */
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
  products:[{id:1,category_id:1,name:'Chocolate bars',emoji:'🍫',off_tags:['en:chocolate-bars','en:milk-chocolate-bars','en:dark-chocolate-bars']},
    {id:2,category_id:2,name:'Toffee',emoji:'🍬',off_tags:['en:caramels','en:toffees','en:toffee']},
    {id:3,category_id:3,name:'Crisps',emoji:'🥔',off_tags:['en:crisps','en:potato-crisps']}],
  /* flavours, in sort order; each category's "Other" holds what the owner hasn't sorted yet */
  variants:[{id:1,product_id:1,name:'Milk chocolate',title:'Milk chocolate bars',keywords:['milk'],off_tags:['en:milk-chocolate-bars']},
    {id:2,product_id:2,name:'Plain',title:'Toffee',keywords:[]},
    {id:3,product_id:2,name:'Chocolate-covered',title:'Chocolate-covered toffee',keywords:['chocolate covered','chocolate toffee']},
    {id:4,product_id:3,name:'Salt & vinegar',title:'Salt & vinegar crisps',keywords:['vinegar'],off_tags:['en:salt-and-vinegar-crisps']},
    {id:5,product_id:3,name:'Cheese & onion',title:'Cheese & onion crisps',keywords:['cheese','cheddar'],off_tags:['en:cheese-and-onion-crisps']},
    {id:6,product_id:3,name:'Ready salted',title:'Ready salted crisps',keywords:['ready salted','lightly salted','lightly sea salted','sea salt','sea salted']},
    {id:7,product_id:1,name:'Other',title:'Other chocolate bars',is_other:true,keywords:[]},
    {id:8,product_id:2,name:'Other',title:'Other toffee',is_other:true,keywords:[]},
    {id:9,product_id:3,name:'Other',title:'Other crisps',is_other:true,keywords:[]}],
  local:{'product:3:4':'Potato chips','variant:6:4':'Lightly salted (うすしお)','title:6:4':'Lightly salted potato chips (うすしお)','title:9:4':'Other potato chips'},
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
    {id:902,c:1,p:2,v:2,b:"Werther's Original",pack:"Werther's Original Soft Caramels",r:[0,0,0,0,0],pending:true,approvals:2,days_left:26}
  ]
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
  async rpc(name,args){const f=DEMO_RPC[name];if(!f)throw new Error('Demo mode has no '+name);return f(args||{},demoState())}
};
/* The same rules as the database functions, worked out from the sample data */
const D={
  all:()=>[...DEMO.items,...(demoState().added||[])],   // the sample items plus anything added on this device
  brandId:name=>[...new Set(D.all().map(i=>i.b))].indexOf(name)+1,
  brandName:id=>[...new Set(D.all().map(i=>i.b))][id-1],
  local:(kind,id,c)=>DEMO.local[`${kind}:${id}:${c}`],
  product:(id,c)=>D.local('product',id,c)||DEMO.products.find(p=>p.id===id).name,
  variant:(id,c)=>D.local('variant',id,c)||DEMO.variants.find(v=>v.id===id).name,
  title:(id,c)=>D.local('title',id,c)||DEMO.variants.find(v=>v.id===id).title,
  type:id=>DEMO.categories.find(c=>c.id===DEMO.products.find(p=>p.id===id).category_id),
  emoji:id=>DEMO.products.find(p=>p.id===id).emoji,
  country:id=>{const pl=DEMO.places.find(x=>x.id===id);return pl&&{id:pl.id,name:pl.name,short_name:pl.short_name,flag:pl.flag,code:pl.code}},
  vsort:(a,b)=>!!a.is_other-!!b.is_other||a.id-b.id,
  pic:x=>({image_url:x.image_url,image_path:null,emoji:x.emoji}),
  sum:l=>l.reduce((s,x)=>s+x.total,0),
  approvals:(it,st)=>it.approvals+(st.approvals.includes(it.id)?1:0)+(st.extra[it.id]||0),
  live:(it,st)=>!it.withdrawn&&(!it.pending||D.approvals(it,st)>=DEMO.settings.approval_votes),
  waiting:(it,st)=>it.pending&&!it.closed&&!it.withdrawn&&!D.live(it,st),
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
    const t=D.totals(p_country,st);
    return DEMO.products.filter(p=>t.some(x=>x.product_id===p.id)).map(p=>{
      const mine=t.filter(x=>x.product_id===p.id).sort(D.order),ranked=mine.filter(x=>x.ranked);
      return {id:p.id,name:D.product(p.id,p_country),emoji:p.emoji,type:D.type(p.id).name,type_id:p.category_id,snacks:mine.length,ratings:D.sum(mine),
        thumbs:mine.slice(0,3).map(D.pic),top:ranked.slice(0,3).map(x=>({item_id:x.id,pack_name:x.pack_name,brand:x.brand,avg:x.avg,total:x.total})),
        to_rate:ranked.length?[]:mine.slice(0,2).map(x=>({item_id:x.id,pack_name:x.pack_name,total:x.total}))};
    }).sort((a,b)=>b.ratings-a.ratings||a.type_id-b.type_id||a.id-b.id);
  },
  home_brands({p_country},st){
    const t=D.totals(p_country,st);
    return [...new Set(t.map(x=>x.brand_id))].map(id=>{
      const mine=t.filter(x=>x.brand_id===id).sort(D.order);if(mine.length<2)return null;
      const ps=DEMO.products.map(p=>({p,n:mine.filter(x=>x.product_id===p.id).length})).filter(x=>x.n).sort((a,b)=>b.n-a.n||a.p.id-b.p.id),best=mine.find(x=>x.ranked);
      return {id,name:mine[0].brand,snacks:mine.length,ratings:D.sum(mine),categories:ps.map(x=>D.product(x.p.id,p_country)),type_ids:[...new Set(ps.map(x=>x.p.category_id))],
        thumb:D.pic([...mine].sort((a,b)=>!a.image_url-!b.image_url||b.total-a.total||a.id-b.id)[0]),
        best:best?{item_id:best.id,pack_name:best.pack_name,avg:best.avg,total:best.total}:null};
    }).filter(Boolean).sort((a,b)=>b.ratings-a.ratings||a.name.localeCompare(b.name));
  },
  category_page({p_product,p_country},st){
    const p=DEMO.products.find(x=>x.id===p_product),country=D.country(p_country);if(!p||!country)return null;
    const t=D.totals(p_country,st),live=t.filter(x=>x.product_id===p_product).map(x=>({...x,brand_snacks:t.filter(y=>y.brand_id===x.brand_id).length})).sort(D.order);
    return {id:p.id,name:D.product(p.id,p_country),emoji:p.emoji,type:D.type(p.id).name,type_id:p.category_id,country,
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
  // the old add form still checks "Already here" against one flavour's list
  ranking({p_product,p_variant,p_country},st){
    const t=D.totals(p_country,st),p=DEMO.products.find(x=>x.id===p_product);
    return {title:D.title(p_variant,p_country),product:D.product(p_product,p_country),variant:D.variant(p_variant,p_country),country:D.country(p_country),
      items:t.filter(x=>x.product_id===p_product&&x.variant_id===p_variant).sort(D.order),
      pending:D.all().filter(i=>D.waiting(i,st)&&i.c===p_country&&i.p===p_product&&i.v===p_variant).map(i=>({id:i.id,brand:i.b,pack_name:i.pack,image_url:i.img||null,image_path:null,
        emoji:p.emoji,approvals:D.approvals(i,st),approved:false,mine:!!i.mine,days_left:i.days_left}))};
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
  catalogue({p_country}){return DEMO.categories.map(c=>({id:c.id,name:c.name,products:DEMO.products.filter(p=>p.category_id===c.id).map(p=>({id:p.id,name:D.product(p.id,p_country),emoji:p.emoji,off_tags:p.off_tags,
    variants:DEMO.variants.filter(v=>v.product_id===p.id&&!v.is_other).map(v=>({id:v.id,name:D.variant(v.id,p_country),title:D.title(v.id,p_country),off_tags:v.off_tags||null}))}))}))},
  brand_suggest({q},st){const k=norm(q);return [...new Set(D.all().filter(i=>D.live(i,st)).map(i=>i.b))].filter(b=>k&&norm(b).includes(k)).sort((a,b)=>norm(b).startsWith(k)-norm(a).startsWith(k)||a.localeCompare(b)).slice(0,8).map(b=>({id:D.brandId(b),name:b}))},
  submit_item({p_product,p_variant,p_country,p_brand_name,p_pack_name,p_score,p_image_url,p_demo_image},st){
    const dup=D.all().find(i=>(D.live(i,st)||D.waiting(i,st))&&i.p===p_product&&i.v===p_variant&&i.c===p_country&&norm(i.b)===norm(p_brand_name));
    if(dup)throw Object.assign(new Error('Already here'),{code:'23505',details:String(dup.id)});
    const brand=D.all().map(i=>i.b).find(b=>norm(b)===norm(p_brand_name))||p_brand_name.trim().replace(/\s+/g,' ');
    const pack=p_pack_name||`${brand} ${D.title(p_variant,p_country)}`;
    if(D.same(p_country,pack,null,st))throw new Error('That snack is already on TasteRank.');
    const id=Date.now();
    st.added.push({id,c:p_country,p:p_product,v:p_variant,b:brand,pack,img:p_demo_image||p_image_url||null,r:[0,0,0,0,0],pending:true,approvals:1,days_left:30,mine:true});
    if(p_score)st.planned[id]=p_score;
    demoSave(st);return id;
  },
  submit_item_request({p_country,p_category,p_new_ranking,p_brand_name,p_pack_name,p_product,p_new_variant},st){ // waits for the owner's check, which demo mode never does
    const same=DEMO.variants.find(v=>norm(D.title(v.id,p_country))===norm(p_new_ranking)||norm(v.title)===norm(p_new_ranking));
    if(same)throw new Error(`${D.title(same.id,p_country)} is already a ranking. Pick it from the list.`);
    const id='r'+Date.now();
    (st.requests=st.requests||[]).push({id,country_id:p_country,category_id:p_category,new_ranking:p_new_ranking,product_id:p_product||null,new_variant:p_new_variant||null,
      brand:p_brand_name,pack_name:p_pack_name||`${p_brand_name} ${p_new_ranking}`,status:'review'});
    demoSave(st);return id;
  },
  // Prompt 14's way in: a snack in a category; the flavour is guessed; one snack per name per country
  submit_snack({p_country,p_product,p_brand_name,p_pack_name,p_variant_hint,p_image_url,p_barcode,p_score,p_demo_image},st){
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
  submit_new_category({p_country,p_new_category,p_brand_name,p_pack_name},st){
    const nc=tidyCase(p_new_category,true),pack=tidyCase(p_pack_name);
    const found=DEMO.products.find(p=>norm(p.name)===norm(nc)||Object.entries(DEMO.local).some(([k,n])=>k.startsWith(`product:${p.id}:`)&&norm(n)===norm(nc)));
    if(found)throw new Error(`${D.product(found.id,p_country)} is already a category. Pick it from the list.`);
    const dup=D.same(p_country,pack,null,st);
    if(dup)throw Object.assign(new Error(`Already on TasteRank: ${dup.pack} is in ${D.product(dup.p,dup.c)}.`),{code:'23505'});
    const n=Date.now();
    (st.requests=st.requests||[]).push({id:'r'+n,kind:'category',country_id:p_country,new_ranking:nc,brand:D.all().map(i=>i.b).find(b=>norm(b)===norm(p_brand_name))||tidyCase(p_brand_name),pack_name:pack,status:'review'});
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
    product:D.product(i.p,i.c),country_flag:(D.country(i.c)||{}).flag,status:i.closed?'closed':D.live(i,st)?'live':'pending',approvals:D.approvals(i,st)})),
    ...(st.requests||[]).filter(r=>r.status!=='withdrawn').map(r=>({...r,new_category:r.kind==='category',product:r.new_ranking,country_flag:(D.country(r.country_id)||{}).flag,approvals:0}))]},
  my_profile(_,st){return st.user?{taster_id:'#DEMO00',home_place:{id:0,level:'unknown',name:'Unknown'},rated:Object.keys(st.ratings).length,
    rankings_helped:new Set(Object.keys(st.ratings).map(id=>{const i=D.all().find(x=>x.id==id);return i&&`${i.p}-${i.v}-${i.c}`})).size}:null},
  my_ratings(_,st){return Object.entries(st.ratings).map(([id,score])=>{const i=D.all().find(x=>x.id==id);if(!i)return null;
    const pl=DEMO.places.find(p=>p.id===i.c);return {item_id:i.id,pack_name:i.pack,brand:i.b,product_id:i.p,variant_id:i.v,country_id:i.c,flag:pl.flag,
      ranking_title:D.title(i.v,i.c),score,image_url:i.img||null,image_path:null,emoji:D.emoji(i.p)}}).filter(Boolean)},
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

/* ---------- Navigation: #/ home · #/brands home by brand · #/p/gb/3[/4] category (and flavour)
   · #/b/gb/12[/3[/4]] brand (and category, flavour) · #/me profile. Old #/r/gb/3/4 ranking links open #/p/gb/3/4. ---------- */
const VIEWS=['home','category','brand','profile'];
function parseHash(){
  const h=location.hash;let m;
  if((m=h.match(/^#\/p\/([a-z]{2})\/(\d+)(?:\/(\d+))?$/i)))return {v:'category',cc:m[1],product:+m[2],variant:m[3]?+m[3]:null};
  if((m=h.match(/^#\/b\/([a-z]{2})\/(\d+)(?:\/(\d+)(?:\/(\d+))?)?$/i)))return {v:'brand',cc:m[1],brand:+m[2],product:m[3]?+m[3]:null,variant:m[4]?+m[4]:null};
  if((m=h.match(/^#\/r\/([a-z]{2})\/(\d+)\/(\d+)$/i))){const r={v:'category',cc:m[1],product:+m[2],variant:+m[3]};history.replaceState(null,'',hashFor(r));return r}
  if(h==='#/brands')return {v:'home',by:'brands'};
  if(h==='#/me')return {v:'profile'};
  return {v:'home'}; // includes old #/item/5 links: those foods aren't in the new structure
}
const hashFor=r=>{const cc=String(r.cc||'').toLowerCase();
  return r.v==='category'?`#/p/${cc}/${r.product}${r.variant?'/'+r.variant:''}`
    :r.v==='brand'?`#/b/${cc}/${r.brand}${r.product?`/${r.product}${r.variant?'/'+r.variant:''}`:''}`
    :r.v==='profile'?'#/me':r.by==='brands'?'#/brands':''};
// {v:'ranking'} from the add form (until prompt 14) is the category page with that flavour picked
const asRoute=r=>r.v==='ranking'?{v:'category',cc:r.cc,product:r.product,variant:r.variant||null}:r;
async function show(r){
  r=asRoute(r);view=r.v;
  VIEWS.forEach(x=>$('#v-'+x).hidden=x!==r.v);
  setFab();
  if(r.v==='home')await renderHome(r);
  if(r.v==='category')await renderCategory(r);
  if(r.v==='brand')await renderBrandPage(r);
  if(r.v==='profile')await renderProfile();
  currentUrl=location.href;
  track(pagePath());
}
function go(r){
  r=asRoute(r);const h=hashFor(r);
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
  ranking:d=>go({v:'category',cc:d.cc,product:+d.product,variant:+d.variant||null}),
  brand:d=>go({v:'brand',cc:d.cc,brand:+d.brand,product:d.product?+d.product:null}),
  flavour:d=>pickFlavour(d.id?+d.id:null),
  'bp-cat':d=>pickBrandChip(d.id?+d.id:null,null,'pick-category'),
  'bp-flavour':d=>pickBrandChip(page.route.product,d.id?+d.id:null,'pick-flavour'),
  rate:d=>needUser({name:'rate',item:+d.id,from:view}),
  face:d=>saveRating(+d.v),
  'edit-rating':()=>{sheet.editing=true;renderSheet()},
  unrate:removeRating,
  next:nextStep,
  'sheet-second':sheetSecond,
  approve:d=>needUser({name:'approve',item:+d.id,brand:d.brand,mine:d.mine==='1'}),
  'share-list':()=>{if(!page)return;track('share-list',true);share(`${page.title}: which one wins? Vote on TasteRank`)},
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
  if(el.tagName==='A'&&(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button))return; // a link opened in a new tab
  const f=ACT[el.dataset.act]||ADD_ACT[el.dataset.act];if(!f)return;
  e.preventDefault();f(el.dataset);
});
$('#country').addEventListener('change',e=>{prefs.country=e.target.value;prefs.cat='all';savePrefs();renderHome({by:homeBy})});
$('#f-feedback').addEventListener('submit',sendFeedback);

/* ---------- Sign-in: some actions need an account; we come back to them afterwards ---------- */
const AFTER={
  profile:()=>go({v:'profile'}),
  rate:a=>openRate(a.item,a.from),
  approve:a=>doApprove(a.item,a.brand,a.mine),
  add:a=>startAdd()
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
  else checkMoments();
}
async function loadProfile(){try{profile=me?await rpc('my_profile'):null}catch(e){profile=null}}
function renderHeader(){
  const b=$('#me-btn');
  b.innerHTML=me?'👤<span class="hide-sm">Profile</span>':'Sign in';
  b.classList.toggle('me',!!me);
  if(me)b.setAttribute('aria-label','Profile');else b.removeAttribute('aria-label');
}

/* ---------- The floating +: add a snack. Until prompt 14 it always opens the full search. ---------- */
function setFab(){
  const f=$('#add-fab');
  f.hidden=view==='profile';
  f.setAttribute('aria-label','Add a snack');
}
function openAdd(){needUser({name:'add'})}  // a declaration, so the click map above can use it

/* ---------- Adding, in two steps: type what's on the pack, then check what we filled in.
   From a ranking page it's a shortcut with the ranking fixed; from a brand page, step 2 with the brand answered.
   Visitors only ever see Type, Ranking (by its title), Brand and Snack: never "product" or "variant". ---------- */
let add=null, searchTimer=null, offTimer=null, brandTimer=null, pending=null;
const catalogues={};
const NEW_TAG=' <span class="newtag sm">new</span>';
const titleCase=t=>String(t||'').replace(/(^|\s)([a-z])/g,(m,s,c)=>s+c.toUpperCase()).replace(/ And /g,' and ');
// The same rules as tidy_case() in the database: text typed ALL IN CAPITALS or all small gets a capital at the start of each word
// ("TONY'S" → "Tony's"); mixed capitals ("KitKat") are kept. sentence: "Dark chocolate" style, for ranking names.
function tidyCase(t,sentence){
  const c=String(t||'').trim().replace(/\s+/g,' '),mixed=c!==c.toUpperCase()&&c!==c.toLowerCase(),caps=c===c.toUpperCase();
  if(!c||(mixed&&!sentence))return c;
  return c.split(' ').map((w,i)=>{
    const l=w.toLowerCase();
    if(mixed)return i&&/^\p{Lu}[\p{Ll}']+$/u.test(w)?l:w;
    if(/[0-9&]/.test(w)||(caps&&w.length<=2&&!['of','in','on','a','to','n'].includes(l)))return w; // 70%, M&S, KP
    if(i&&(sentence||['and','of','the','with','in','on','a','n','to'].includes(l)))return l;
    return l.replace(/\p{L}/u,ch=>ch.toUpperCase());
  }).join(' ');
}
// Ranking title from the names, as guess_title() does: Dark chocolate + Chocolate bars → "Dark chocolate bars"
function guessTitle(v,p){
  p=p.toLowerCase();if(/^(original|regular|plain)$/i.test(v))return p.charAt(0).toUpperCase()+p.slice(1);
  const last=v.toLowerCase().split(' ').pop();return p.split(' ')[0]===last?v+p.slice(last.length):`${v} ${p}`;
}
async function loadCatalogue(c){return catalogues[c]||(catalogues[c]=await rpc('catalogue',{p_country:c}))}
// Every ranking in a country, with its local names
const rankingsFor=c=>(catalogues[c]||[]).flatMap(t=>t.products.flatMap(p=>p.variants.map(v=>({cat:t.id,pid:p.id,pname:p.name,vid:v.id,vname:v.name,title:v.title}))));
const typeName=id=>((catalogues[add.country]||[]).find(t=>t.id===id)||{}).name||'';
const sameRk=(a,b)=>!!a&&!!b&&(a.new?!!b.new&&norm(a.title)===norm(b.title):!b.new&&a.pid===b.pid&&a.vid===b.vid);
const bkey=t=>norm(t).replace(/'/g,''); // brands are compared ignoring apostrophes too, so Tyrrell's is Tyrrells
const afterBrand=(t,b)=>{if(!b)return null;const n=b.split(' ').length,w=String(t||'').split(' ');return bkey(w.slice(0,n).join(' '))===bkey(b)?w.slice(n).join(' '):null};
const inPlace=p=>/^(UK|US)$/.test(p.short_name)?`in the ${p.short_name}`:`in ${p.short_name}`;
// Live brands that could be these names: searched by the first word up to any apostrophe, so "Tyrrell's" finds Tyrrells
const brandProbe=t=>String(t||'').replace(/[\u2018\u2019]/g,"'").trim().split(/\s+/)[0].split("'")[0];
async function knownBrands(qs){
  const out=new Set();
  for(const q of new Set(qs.map(brandProbe).filter(Boolean)))try{(await rpc('brand_suggest',{q})).forEach(b=>out.add(b.name))}catch(e){}
  return [...out];
}

/* ---------- Open Food Facts, the free food database: packs that aren't on TasteRank yet.
   One request at a time and at most 8 a minute (they allow 10 per visitor), 4 s timeout; any failure just hides the section. ---------- */
const OFF_COUNTRY={GB:'en:united-kingdom',US:'en:united-states',AU:'en:australia',JP:'en:japan',CN:'en:china'};
const offLog=[]; let offBusy=false, offNext=null;
async function offSearch(q){
  const now=Date.now();while(offLog.length&&now-offLog[0]>60000)offLog.shift();
  if(offLog.length>=8)return null;
  offLog.push(now);
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),4000);
  try{
    const r=await fetch('https://world.openfoodfacts.org/cgi/search.pl?'+new URLSearchParams({search_terms:q,json:1,page_size:10,
      fields:'code,product_name,brands,categories_tags,countries_tags,quantity,image_front_small_url,image_front_url'}),{signal:ctl.signal});
    if(!r.ok)return null;
    return ((await r.json()).products||[]).filter(p=>String(p.product_name||'').trim());
  }catch(e){return null}finally{clearTimeout(timer)}
}
function offLookup(q,done){ // a newer search waits for the one in flight; older waiting ones are dropped
  if(offBusy){offNext=[q,done];return}
  offBusy=true;
  offSearch(q).then(r=>{offBusy=false;done(r);if(offNext){const [nq,nd]=offNext;offNext=null;offLookup(nq,nd)}});
}
const offBrand=p=>String(p.brands||'').split(',')[0].replace(/[‘’]/g,"'").trim();
const offImg=u=>/^https:\/\/images\.openfoodfacts\.org\//.test(String(u||''))&&String(u).length<=500?String(u):null;
const offSoldHere=p=>(p.countries_tags||[]).includes(OFF_COUNTRY[(placeBy('id',add.country)||{}).code]);
const offPlace=p=>offSoldHere(p)?placeBy('id',add.country):places.find(pl=>(p.countries_tags||[]).includes(OFF_COUNTRY[pl.code]))||null;
const offPic=p=>{const u=offImg(p.image_front_small_url);
  return `<span class="thumb">${u?`<img src="${esc(u)}" alt="Pack photo: ${esc(p.product_name)}" loading="lazy" onerror="this.remove()">`:'<span aria-hidden="true">🍽️</span>'}</span>`};

/* ---------- Guessing: the brand, the ranking and the name on the pack, from the search text or a picked Open Food Facts pack.
   Pure: brands = known brand names to compare with; rankings = every ranking in the country (rankingsFor). ---------- */
const NO_VARIANT=/^(original|regular|plain)$/;
// words compared ignoring capitals, "&"/"and" and a trailing "s": "Salt & Vinegar Crisps" → salt, vinegar, crisp
const wordsOf=s=>norm(s).split(/[^\p{L}\p{N}']+/u).filter(w=>w&&w!=='and').map(w=>w.replace(/'s$/,'').replace(/(\p{L}{3})s$/u,'$1'));
function guessFromSearch({text,off,brands,rankings,ctxCat}){
  const t=String(text||'').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
  const g={brand:'',brandState:null,brandFrom:null,brandAsk:null,rk:null,rkChoices:[],rkCat:ctxCat||null,
    packBase:tidyCase(t),photoUrl:null,barcode:null};
  // Brand: the longest known brand the text starts with; else Open Food Facts' brand, unless it's nearly a known one
  const hit=brands.filter(b=>bkey(t)===bkey(b)||bkey(t).startsWith(bkey(b)+' ')).sort((a,b)=>b.length-a.length)[0];
  const ob=off?offBrand(off):'';
  if(hit)Object.assign(g,{brand:hit,brandState:'known'});
  else if(ob){
    const exact=brands.find(b=>bkey(b)===bkey(ob)),near=brands.filter(b=>bkey(b).startsWith(bkey(ob))||bkey(ob).startsWith(bkey(b)));
    if(exact)Object.assign(g,{brand:exact,brandState:'known'});
    else if(near.length===1)g.brandAsk={similar:near[0],off:tidyCase(ob)}; // "Is it Tony's Chocolonely?": never a quiet near-duplicate
    else Object.assign(g,{brand:tidyCase(ob),brandState:'new',brandFrom:'off'});
  }
  // The ranking: the words after the brand, plus how Open Food Facts files the pack (en:salt-and-vinegar-crisps)
  const rest=afterBrand(t,g.brand)??afterBrand(t,ob)??t;
  const tags=((off&&off.categories_tags)||[]).filter(x=>/^en:/.test(x)).map(x=>x.slice(3).replace(/-/g,' '));
  const W=new Set([rest,...tags].flatMap(wordsOf)),has=w=>W.has(w);
  const pick=({cat,pid,vid,title})=>({cat,pid,vid,title});
  const pool=rankings.filter(r=>!ctxCat||r.cat===ctxCat).map(r=>({...r,vw:wordsOf(r.vname).filter(w=>!NO_VARIANT.test(w)),pw:wordsOf(r.pname)}));
  let m=pool.filter(r=>r.vw.every(has)&&r.pw.some(has));
  if(!m.length){const v=pool.filter(r=>r.vw.length&&r.vw.every(has));if(v.length===1)m=v}
  const most=Math.max(0,...m.map(r=>r.vw.length));m=m.filter(r=>r.vw.length===most); // chocolate-covered toffee beats toffee
  if(m.length===1)g.rk=pick(m[0]);
  else if(m.length){g.rkChoices=m.map(pick);if(new Set(m.map(r=>r.cat)).size===1)g.rkCat=m[0].cat}
  else{
    const p=pool.find(r=>r.pw.some(has));
    if(p){ // a known kind of snack, but no ranking for this one: offer a new ranking from the leftover words first
      const left=rest.split(' ').filter(w=>w&&!/[\d%]/.test(w)&&!/^(g|kg|ml|l)$/i.test(w));
      if(left.length&&wordsOf(left[left.length-1]).pop()===wordsOf(p.pname).pop())left.pop(); // "Prawn cocktail crisps" → Prawn cocktail
      const variant=tidyCase(left.join(' '),true),title=variant&&guessTitle(variant,p.pname);
      const same=title&&rankings.find(r=>norm(r.title)===norm(title));
      g.rkCat=p.cat;
      g.rkChoices=[...(same?[pick(same)]:title?[{new:true,cat:p.cat,pid:p.pid,variant,title}]:[]),
        ...pool.filter(r=>r.pid===p.pid&&!(same&&r.vid===same.vid)).map(pick)];
    }else g.rkChoices=ctxCat?pool.map(pick):[];
  }
  if(off){g.photoUrl=offImg(off.image_front_url);if(/^\d{8,14}$/.test(String(off.code||'')))g.barcode=String(off.code)}
  return g;
}
function packName(){ // the name on the pack: as edited, or the brand (in its own spelling) followed by the rest
  if(add.packEdited)return add.pack;
  const b=add.brand.trim(),base=add.packBase||'';if(!b)return base;
  const r=afterBrand(base,b);return r===null?(base?`${b} ${base}`:b):[b,r].filter(Boolean).join(' ');
}
// "Maltesers Milk Chocolate" typed as the brand on Milk chocolate bars → brand Maltesers: a known brand at the start wins,
// else the words before the first word of the ranking. brandWhole: a brand picked as it stands (a chip, or "Make the brand Walkers Max").
function splitBrand(text,known){
  const t=tidyCase(text);if(add.brandWhole)return {brand:t,cut:false};
  const k=(known||[]).filter(b=>bkey(t).startsWith(bkey(b)+' ')).sort((a,b)=>b.length-a.length)[0];
  if(k)return {brand:k,cut:true};
  if(!add.rk)return {brand:t,cut:false};
  const rw=new Set(wordsOf(add.rk.title)),w=t.split(' '),i=w.findIndex(x=>wordsOf(x).some(y=>rw.has(y)));
  return i>0?{brand:w.slice(0,i).join(' ').replace(/[\s&+,-]+$/,''),cut:true}:{brand:t,cut:false};
}
// What the pack says beyond the brand and the ranking: "Werther's Original Soft Caramels" in Toffee → "Soft caramels"
function leftover(){
  const pack=packName(),rest=afterBrand(pack,add.brand)??pack,rw=new Set(wordsOf(add.rk?add.rk.title:''));
  const w=rest.split(' ').filter(x=>x&&!/[\d%]/.test(x)&&!wordsOf(x).every(y=>rw.has(y)||NO_VARIANT.test(y))); // "Original" is part of the name, not a kind
  return capFirst(tidyCase(w.join(' '),true));
}
// A range between the brand and the ranking's words: "Walkers Max Salt & Vinegar" → Walkers Max. None for "Werther's Original Soft Caramels" in Toffee.
function subBrand(){
  const rest=afterBrand(packName(),add.brand);if(!rest||!add.rk)return null;
  const rw=new Set(wordsOf(add.rk.title)),w=rest.split(' '),i=w.findIndex(x=>wordsOf(x).some(y=>rw.has(y)));
  return i>0?`${add.brand} ${w.slice(0,i).join(' ')}`.replace(/[\s&+,-]+$/,''):null;
}
const thingsLeft=()=>add.mode==='short'?(add.brand.trim()?0:1):(add.brandState?0:1)+(add.rk?0:1);

/* ---------- Starting ---------- */
const freshAdd=o=>Object.assign({mode:'full',step:'find',country:null,ctxCat:null,q:'',results:null,off:null,offFor:null,offShown:[],
  brand:'',brandState:null,brandFrom:null,brandAsk:null,rk:null,rkChoices:[],rkCat:null,rkList:[],rkFind:'',rkData:null,rkError:null,
  open:{},touched:false,guessed:0,pack:'',packBase:'',packEdited:false,packEditing:false,packFromRk:false,
  photo:null,photoUrl:null,ownPhoto:false,offPhotos:[],offNone:false,barcode:null,score:null,error:null,sending:false},o);
async function startAdd(prefill){
  // a saved copy of the old page can be paired with this newer code for a few minutes after an update: reload once to match
  if(!$('#add-body')){if(!store.get('tasterank-reloaded',true)){store.set('tasterank-reloaded',1,true);toast('TasteRank was just updated. Reloading…');setTimeout(()=>location.reload(),900)}else oops(new Error('Add pop-up missing'));return}
  if(add&&!prefill&&!/^sent/.test(add.step)){renderAdd();openM('m-add');focusAdd();return} // closed by tapping outside: carry on where they left off
  track('add-open',true);
  const onRanking=!prefill&&view==='ranking'&&page&&page.kind==='ranking',onBrand=!prefill&&view==='brand'&&page&&page.kind==='brand';
  const c=prefill?prefill.country:onRanking||onBrand?page.country.id:homeCountry().id;
  add=freshAdd({mode:onRanking?'short':onBrand?'brand':'full',step:onRanking||onBrand||prefill?'check':'find',country:c});
  try{await loadCatalogue(c)}catch(e){add=null;return oops(e)}
  if(!prefill&&view==='home'&&prefs.cat!=='all'&&catalogues[c].some(t=>String(t.id)===String(prefs.cat)))add.ctxCat=+prefs.cat; // the type chip on home
  const rs=rankingsFor(c);
  if(onRanking){
    const r=rs.find(x=>x.pid===page.route.product&&x.vid===page.route.variant);
    Object.assign(add,{rk:{pid:page.route.product,vid:page.route.variant,title:page.title,cat:r&&r.cat},rkData:page,
      packBase:titleCase(page.title),packFromRk:true,brandPh:'Brand on the pack'});
    neighbourBrand();
  }
  if(onBrand){ // the brand is answered; its own kind of snack is listed first
    const mine=rs.filter(x=>x.pid===page.route.product);
    Object.assign(add,{brand:page.brand,brandState:'known',rkChoices:mine,rkCat:mine[0]?mine[0].cat:null,packFromRk:true,guessed:1});
  }
  if(prefill){ // "Add it again" after one closed: everything as it was
    const r=rs.find(x=>x.pid===prefill.product&&x.vid===prefill.variant),k=(await knownBrands([prefill.brand])).find(b=>bkey(b)===bkey(prefill.brand));
    Object.assign(add,{brand:k||prefill.brand,brandState:k?'known':'new',rk:r?{pid:r.pid,vid:r.vid,title:r.title,cat:r.cat}:null,
      pack:prefill.pack||'',packEdited:!!prefill.pack,guessed:r?2:1});
    await loadRanking();
  }
  renderAdd();openM('m-add');focusAdd();
}
function neighbourBrand(){ // the shortcut's placeholder: a brand from a neighbouring ranking that isn't in this one yet
  const sib=(page.variants||[]).find(v=>v.id!==page.route.variant),here=page.items.map(i=>bkey(i.brand));if(!sib)return;
  rpc('ranking',{p_product:page.route.product,p_variant:sib.id,p_country:page.country.id}).then(r=>{
    const b=r&&r.items.map(i=>i.brand).find(x=>!here.includes(bkey(x)));
    if(b&&add&&add.mode==='short'){add.brandPh=`e.g. ${b}`;const i=$('#add-brand');if(i)i.placeholder=add.brandPh}
  }).catch(()=>{});
}
async function startCheck(src){ // step 1 → step 2, with our guesses filled in
  const text=src.off?String(src.off.product_name):add.q.trim();
  const brands=await knownBrands([text,src.off&&offBrand(src.off)]);
  Object.assign(add,freshAdd({mode:add.mode,step:'check',country:add.country,ctxCat:add.ctxCat,q:add.q,results:add.results,off:add.off,offFor:add.offFor,offShown:add.offShown}),
    guessFromSearch({text,off:src.off,brands,rankings:rankingsFor(add.country),ctxCat:add.ctxCat}));
  add.guessed=(add.brandState?1:0)+(add.rk?1:0);
  await loadRanking();renderAdd();focusAdd();
}
async function loadRanking(){ // who's already in the chosen ranking: for "With Walkers, Pringles…" and the "Already here" check
  add.rkData=null;
  if(add.rk&&!add.rk.new)try{add.rkData=await rpc('ranking',{p_product:add.rk.pid,p_variant:add.rk.vid,p_country:add.country})}catch(e){console.error(e)}
}
function focusAdd(){ // the search box; else the first open question; else Send
  setTimeout(()=>{if(!add)return;(add.step==='find'?$('#add-q'):$('#add-body .row.ask :is(button,input,select)')||$('#add-send')||$('#add-body .btn-primary'))?.focus()},0);
}

/* ---------- Answers ---------- */
// Typed answers are saved when the box is left, a moment later, so a tap on a chip beside it still counts
function later(fn){clearPending();pending={fn,t:setTimeout(()=>{const f=pending.fn;pending=null;f()},250)}}
function clearPending(){if(pending){clearTimeout(pending.t);pending=null}}
async function flushPending(){if(pending){const f=pending.fn;clearPending();await f()}}
async function answerBrand(name){
  clearPending();
  let v=tidyCase(name);if(!v)return;
  const kb=await knownBrands([v]);if(!add)return;
  v=splitBrand(v,kb).brand;
  const k=kb.find(b=>bkey(b)===bkey(v));
  Object.assign(add,{brand:k||v,brandState:k?'known':'new',brandFrom:!k&&add.brandAsk&&bkey(v)===bkey(add.brandAsk.off)?'off':null,touched:true});
  add.open.brand=false;
  renderAdd();focusAdd();
}
async function answerRanking(x){
  clearPending();if(!x)return;
  add.rk=x.new?{new:true,title:x.title,cat:x.cat,pid:x.pid||null,variant:x.variant||null}:{pid:x.pid,vid:x.vid,title:x.title,cat:x.cat};
  if(x.new)track('add-new-ranking',true);
  Object.assign(add,{rkFind:'',rkError:null,touched:true});add.open.ranking=false;
  if(add.packFromRk&&!add.packEdited)add.packBase=titleCase(x.title);
  await loadRanking();renderAdd();focusAdd();
}
const capFirst=t=>t.charAt(0).toUpperCase()+t.slice(1);
function pickNewRk(){ // "＋ New ranking: …" from the ranking box, in the type chosen under it
  const t=capFirst(tidyCase(add.rkFind,true));if(!t)return;
  if(!add.rkCat)return $('#rk-find [data-act="add-type"]')?.focus();
  answerRanking(add.rkChoices.find(x=>x.new&&norm(x.title)===norm(t)&&x.cat===add.rkCat)||{new:true,title:t,cat:add.rkCat}); // typing our own guess keeps its filing
}
function commitRkFind(enter){ // leaving the box (or Enter): an exact title is picked; a new one only when nothing else is close
  const t=capFirst(tidyCase(add.rkFind,true));if(!t)return;
  const ex=rankingsFor(add.country).find(r=>norm(r.title)===norm(t));
  if(ex)return answerRanking(ex);
  if(!rkMatches(t).length&&add.rkCat)return pickNewRk();
  if(enter)$('#rk-find .chip')?.focus();
}
async function setCountry(c){ // keeps the brand; the ranking is checked against that country's list
  add.country=c;try{await loadCatalogue(c)}catch(e){return oops(e)}
  const rs=rankingsFor(c),same=x=>rs.find(r=>r.pid===x.pid&&r.vid===x.vid);
  if(add.rk&&!add.rk.new){const r=same(add.rk);add.rk=r?{pid:r.pid,vid:r.vid,title:r.title,cat:r.cat}:null}
  else if(add.rk&&rs.some(r=>norm(r.title)===norm(add.rk.title))){add.rkFind=add.rk.title;add.rk=null;add.open.ranking=true}
  add.rkChoices=add.rkChoices.map(x=>x.new?x:same(x)).filter(Boolean);
  add.open.country=false;add.touched=true;
  await loadRanking();renderAdd();focusAdd();
}
function shortBrand(v,known){ // the shortcut's brand box, typed or saved: the brand, and the name on the pack from the same words
  const sp=splitBrand(v,known);add.brandTyped=v;add.brand=sp.brand;
  if(!add.packEdited)add.packBase=sp.cut?tidyCase(v):titleCase(add.rk.title);
}
async function commitShortBrand(v){ // known spelling, then ask Open Food Facts for photos of this brand's pack
  const kb=v.trim()?await knownBrands([v]):[];if(!add)return;
  shortBrand(v,kb);
  const t=add.brand,k=t&&kb.find(b=>bkey(b)===bkey(t));
  add.brand=k||t;add.brandState=t?(k?'known':'new'):null;
  const i=$('#add-brand');if(i&&i.value!==add.brand)i.value=add.brand;
  renderRest();renderBrandHelp();
  if(!t)return;
  const r0=rankingsFor(add.country).find(r=>r.pid===add.rk.pid&&r.vid===add.rk.vid)||{vname:'',pname:add.rk.title};
  const vw=wordsOf(r0.vname).filter(w=>!NO_VARIANT.test(w)),pw=wordsOf(r0.pname);
  const q=`${add.brand} ${vw.length?r0.vname:r0.pname}`;if(add.photosFor===q)return; // brand + flavour: "bars" would narrow it too much
  Object.assign(add,{photosFor:q,offPhotos:[],offNone:false});
  if(!add.photo)add.photoUrl=null;
  offLookup(q,r=>{
    if(!add||add.photosFor!==q)return;
    const typed=add.brandTyped||add.brand,b=bkey(add.brand);
    const l=(r||[]).filter(p=>{const a=bkey(offBrand(p));return a&&(a.startsWith(b)||b.startsWith(a)||bkey(typed).startsWith(a+' '))});
    // Open Food Facts knows the brand: "Tyrrells Sea Salt…" is Tyrrells
    const ob=!add.brandWhole&&add.brandState==='new'&&l.map(offBrand).find(x=>bkey(x)!==b&&bkey(typed).startsWith(bkey(x)+' '));
    if(ob){add.brand=tidyCase(ob);add.photosFor=`${add.brand} ${vw.length?r0.vname:r0.pname}`;if(!add.packEdited)add.packBase=tidyCase(typed);const i=$('#add-brand');if(i)i.value=add.brand;renderBrandHelp()}
    // only packs of this ranking's kind (Milk chocolate bars: "milk" and "chocolate" in the name or how it's filed), with photos
    const fits=p=>{const W=new Set(wordsOf(`${p.product_name} ${(p.categories_tags||[]).filter(x=>/^en:/.test(x)).map(x=>x.slice(3).replace(/-/g,' ')).join(' ')}`));
      return vw.length?vw.every(w=>W.has(w)):pw.some(w=>W.has(w))};
    const ok=l.filter(p=>fits(p)&&offImg(p.image_front_small_url)&&offImg(p.image_front_url)),seen=new Set();
    add.offPhotos=[...ok.filter(offSoldHere),...ok.filter(p=>!offSoldHere(p))].filter(p=>!seen.has(p.image_front_url)&&seen.add(p.image_front_url)).slice(0,3);
    if(add.offPhotos.length)track('add-photos-shown',true);
    renderRest();
  });
}

/* ---------- Drawing it ---------- */
const stepBar=n=>{const cancel=n===1||add.mode==='brand';
  return `<div class="flow-top"><button class="link" data-act="${cancel?'add-cancel':'add-back'}">${cancel?'Cancel':'← Back'}</button><div class="steps" aria-label="Step ${n} of 2">${[1,2].map(k=>`<i${k<=n?' class="on"':''}></i>`).join('')}<span>${n} of 2</span></div></div>`};
function searchExample(){ // from the categories on home, for the type chosen there: "e.g. Walkers crisps"
  const cs=(homeData&&homeData.country===add.country?homeData.cats:[]).filter(c=>!add.ctxCat||c.type_id===add.ctxCat),top=cs.find(c=>c.top.length);
  return top?`Brand or name, e.g. ${top.top[0].brand} ${top.name.toLowerCase()}`:cs[0]?`Brand or name, e.g. ${cs[0].name.toLowerCase()}`:'Brand or name, e.g. Walkers salt';
}
function renderAdd(){
  const b=$('#add-body'),cp=placeBy('id',add.country)||{flag:'',name:'',short_name:''};
  if(add.step==='find'){
    b.innerHTML=`${stepBar(1)}<h3 id="add-title">What snack is it?</h3>
      <p class="meta add-sub">${add.ctxCat?`Adding to ${esc(typeName(add.ctxCat))} · ${cp.flag} ${esc(cp.short_name)}`:"Type what's on the pack."}</p>
      <div class="field"><input id="add-q" type="search" placeholder="${esc(searchExample())}" aria-label="Search all snacks" autocomplete="off" value="${esc(add.q)}"></div>
      <div id="add-results"></div>`;
    renderResults();return;
  }
  if(add.step==='check'){
    b.innerHTML=add.mode==='short'
      ?`<h3 id="add-title">Add a brand to ${esc(add.rk.title)}</h3><div class="meta short-meta">${cp.flag} ${esc(cp.short_name)} · <button class="link" data-act="add-search-all">Search all snacks instead</button></div>
        <div class="rows"><div class="row ask" role="group" aria-labelledby="rl-brand" id="row-brand"><label class="lab" id="rl-brand" for="add-brand">Brand</label>
          <input id="add-brand" class="row-input" value="${esc(add.brand)}" maxlength="60" autocomplete="off" placeholder="${esc(add.brandPh||'')}" aria-describedby="brand-help"><div id="brand-help" class="hint"></div></div></div>
        <div id="add-rest"></div>`
      :`${stepBar(2)}<h3 id="add-title" class="sr-only">Check it</h3>${crispyLine()}${packHtml()}
        <div class="rows">${brandRow()}${rankRow()}${countryRow()}</div><div id="add-rest"></div>`;
    renderRest();renderBrandHelp();return;
  }
  const left=settings.approval_votes-1,more=`${left} more approval${left===1?'':'s'}`;
  if(add.step==='sent-review'){
    b.innerHTML=`<div class="thanks"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-happy"/></svg>
      <h3 id="add-title">Thanks! We'll check ${esc(add.rk.title)} first</h3>
      <p>New rankings are checked by hand, usually within a few days. Then ${esc(add.sentName)} goes to the vote and needs ${more}. We'll show you here when it's live.</p>
      <button class="btn btn-primary btn-block" data-act="add-cancel">Done</button></div>`;
    return;
  }
  if(add.step==='sent'){
    b.innerHTML=`<div class="thanks"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-happy"/></svg>
      <h3 id="add-title">Thanks! ${esc(add.sentName)} is waiting for approval</h3>
      <p>It needs ${more} to go live. Share it, and friends who know it can approve it.</p>
      <button class="btn btn-primary btn-block" data-act="add-share">Share the link</button>
      <button class="btn btn-block" data-act="add-done">Back to ${esc(add.rk.title)}</button></div>`;
  }
}
// Step 1: TasteRank's own matches (Rate), then Open Food Facts packs that aren't on TasteRank yet (Add)
function offList(){
  const tr=add.results||[],same=(x,p)=>bkey(x.brand)===bkey(offBrand(p))&&(norm(x.pack_name).includes(norm(p.product_name))||norm(p.product_name).includes(norm(x.pack_name)));
  const l=(add.off||[]).filter(p=>!tr.some(x=>same(x,p)));
  return add.offShown=[...l.filter(offSoldHere),...l.filter(p=>!offSoldHere(p))].slice(0,tr.length?3:4);
}
function renderResults(){
  const el=$('#add-results');if(!el)return;
  const q=add.q.trim(),tr=add.results;
  if(norm(q).length<2){el.innerHTML=`<p class="hint">Search first, so nothing gets added twice. Each country's version is separate.</p>`;return}
  const offWait=norm(q).length>=3&&add.offFor!==q;
  if(!tr||(!tr.length&&offWait)){el.innerHTML='<p class="hint">Searching…</p>';return}
  const off=offList();
  if(!tr.length&&!off.length){
    el.innerHTML=`<div class="nomatch"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-confused"/></svg><b>Hmm… no match for that snack.</b><span class="meta">Add it, and I'll put it to the vote.</span></div>
      <button class="btn btn-primary btn-block" data-act="add-new">Add it →</button>`;return;
  }
  let h='';
  if(tr.length)h+=`<h4 class="lab res-h">On TasteRank</h4>`+tr.map(x=>`<div class="offr">${thumb(x)}<div><div class="nm">${esc(x.pack_name)}</div><div class="meta">${x.flag} ${esc(x.country)} · ${esc(x.ranking_title)}${x.status==='pending'?' · waiting for approval':''}</div></div>
      <button class="btn${x.status==='live'?' btn-primary':''}" data-act="add-open-match" data-id="${x.id}" data-cc="${esc((placeBy('id',x.country_id)||{}).code||'')}" data-product="${x.product_id}" data-variant="${x.variant_id}" aria-label="${x.status==='live'?'Rate':'See'} ${esc(x.pack_name)}">${x.status==='live'?'Rate':'See it'}</button></div>`).join('');
  if(off.length){
    h+=(tr.length?`<h4 class="lab res-h">Not on TasteRank yet</h4>`
      :`<div class="mini"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-happy"/></svg><span><b>Not on TasteRank yet.</b><br><span class="meta">Is it one of these? Tap yours and I'll fill in the rest.</span></span></div>`)
      +off.map((p,i)=>{const pl=offPlace(p);return `<div class="offr">${offPic(p)}<div><div class="nm">${esc(tidyCase(p.product_name))}</div>
        <div class="meta">${[esc(offBrand(p)),pl?`${pl.flag} ${esc(pl.short_name)}`:'',esc(p.quantity||'')].filter(Boolean).join(' · ')}</div></div>
        <button class="btn" data-act="add-off-pick" data-i="${i}" aria-label="Add ${esc(p.product_name)}">Add</button></div>`}).join('')
      +'<p class="src">From Open Food Facts</p>';
    if(add.offTracked!==q){add.offTracked=q;track('add-off-shown',true)}
  }
  el.innerHTML=h+'<button class="btn btn-block" data-act="add-new">None of these: add it myself →</button>';
}
// Step 2: Crispy's line, the name on the pack, then a row each for Brand, Ranked in and Sold in
function crispyLine(){
  if(add.touched||dupOf())return ''; // no "then send" when it's already here
  const left=thingsLeft(),t=!left?'Found it all. Check it, then send.':add.guessed?"I've filled in what I could. Check it, then send.":left===1?'One quick question, then send.':'Two quick questions, then send.';
  return `<div class="crispy-line"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#${left?'crisp-happy':'crisp-joy'}"/></svg><span>${t}</span></div>`;
}
function packHtml(){
  if(add.packEditing)return `<div class="pack editing"><label class="lab" for="add-pack">Name on the pack</label><input id="add-pack" class="row-input" value="${esc(add.pack)}" maxlength="120" autocomplete="off"></div>`;
  return `<div class="pack"><span><span class="sr-only">Name on the pack: </span>${esc(packName())}</span><button class="link" data-act="add-edit-pack" aria-label="Edit the name on the pack">Edit</button></div>`;
}
const answered=(row,label,val,sub)=>`<div class="row" role="group" aria-labelledby="rl-${row}"><span class="lab" id="rl-${row}">${label}</span>
  <button class="link" data-act="add-change" data-row="${row}" aria-label="Change ${label.toLowerCase()}">Change</button><span class="val">${val}</span>${sub?`<span class="sub">${sub}</span>`:''}</div>`;
const wordChips=t=>{const out=[];for(const w of String(t||'').split(' ').filter(Boolean).slice(0,3)){if(/\d/.test(w))break;out.push(out.length?`${out[out.length-1]} ${w}`:w)}return out};
function brandRow(){
  if(add.brandState&&!add.open.brand)return answered('brand','Brand',`${esc(add.brand)} ${add.brandState==='known'?'<span class="ok">✓ on TasteRank</span>':NEW_TAG}`,add.brandFrom==='off'?'From Open Food Facts':'');
  const ask=add.brandAsk,chips=ask?[ask.similar,ask.off]:wordChips(add.packBase);
  if(add.brand&&!chips.some(c=>bkey(c)===bkey(add.brand)))chips.unshift(add.brand);
  return `<div class="row ask" role="group" aria-labelledby="rl-brand" id="row-brand"><span class="lab" id="rl-brand">Brand</span>
    <div class="q">${ask?`Is it ${esc(ask.similar)}?`:'Who makes it?'}</div>
    ${chips.length?`<div class="chips wrap">${chips.map(c=>{const on=!!add.brand&&bkey(c)===bkey(add.brand);return `<button class="chip${on?' on':''}" aria-pressed="${on}" data-act="add-brand-pick" data-name="${esc(c)}">${esc(c)}</button>`}).join('')}</div>`:''}
    <input id="add-brand" class="row-input" maxlength="60" autocomplete="off" placeholder="Or type the brand" aria-label="Or type the brand" aria-describedby="brand-help"><div id="brand-help" class="hint"></div></div>`;
}
function withLine(){ // "With Walkers, Pringles and 2 more"
  const b=add.rkData?add.rkData.items.map(i=>esc(i.brand)):[];if(!b.length)return '';
  return `With ${b[0]}${b.length===2?` and ${b[1]}`:b.length>2?`, ${b[1]}${b.length>3?` and ${b.length-2} more`:` and ${b[2]}`}`:''}`;
}
function rankRow(){
  if(add.rk&&!add.open.ranking)return answered('rank','Ranked in',`${esc(add.rk.title)}${add.rk.new?NEW_TAG:''}`,add.rk.new?"A new ranking: we'll check it first":withLine());
  let list=!add.rkChoices.length&&add.rkCat?rankingsFor(add.country).filter(r=>r.cat===add.rkCat):add.rkChoices;
  if(add.rk&&!list.some(x=>sameRk(x,add.rk)))list=[add.rk,...list];
  add.rkList=list.slice(0,8); // more than that: type to find it
  const ex=rankingsFor(add.country)[0];
  return `<div class="row ask" role="group" aria-labelledby="rl-rank" id="row-rank"><span class="lab" id="rl-rank">Ranked in${add.rkCat?` · ${esc(typeName(add.rkCat))}`:''}</span>
    <div class="q">Which ranking does it go in?</div>
    <div id="rk-list">${rkChips()}</div>
    <input id="add-rkfind" class="row-input" type="search" maxlength="60" autocomplete="off" value="${esc(add.rkFind)}" aria-label="Type a ranking" aria-describedby="rk-find"
      placeholder="${add.rkList.length?'Or type a ranking':`Type a ranking${ex?`, e.g. ${esc(ex.title.toLowerCase())}`:''}`}">
    <div id="rk-find" aria-live="polite">${rkFindHtml()}</div>
    ${add.rkError?`<p class="sheet-error" role="alert">${esc(add.rkError)}</p>`:''}</div>`;
}
function rkChips(){ // our guesses; tapping your own new ranking again lets you edit its name
  const l=add.rkList;if(!l.length)return '';
  return `<div class="chips wrap">${l.map((x,i)=>{const on=sameRk(x,add.rk);
    return `<button class="chip${x.new?' chip-new':''}${on?' on':''}" aria-pressed="${on}" data-act="add-rk" data-i="${i}"${on&&x.new?` aria-label="${esc(x.title)}, new: edit its name"`:''}>${x.new?'＋ ':''}${esc(x.title)}${x.new?NEW_TAG:''}</button>`}).join('')}</div>`;
}
// Rankings in any type whose words start with what's typed: "milk choc" finds Milk chocolate bars
function rkMatches(t){
  const tw=wordsOf(t);if(!tw.length)return [];
  return rankingsFor(add.country).filter(r=>{const w=wordsOf(`${r.title} ${r.vname} ${r.pname}`);return tw.every(x=>w.some(y=>y.startsWith(x)))})
    .sort((a,b)=>(b.cat===add.rkCat)-(a.cat===add.rkCat)||a.title.length-b.title.length).slice(0,4);
}
function rkFindHtml(){ // under the box: what's already there ("Did you mean"), then "＋ New ranking: …" with its type
  const t=capFirst(tidyCase(add.rkFind,true));if(norm(t).length<2)return '<div class="hint">It goes head to head with other brands of the same thing.</div>';
  const rs=rankingsFor(add.country),ex=rs.find(r=>norm(r.title)===norm(t)),ms=rkMatches(t).filter(r=>r!==ex);
  const chip=r=>`<button class="chip" data-act="add-rk-pick" data-pid="${r.pid}" data-vid="${r.vid}">${esc(r.title)}${r.cat!==add.rkCat?` <span class="in-type">· ${esc(typeName(r.cat))}</span>`:''}</button>`;
  if(ex)return `<div class="hint">${esc(ex.title)} is already a ranking.</div><div class="chips wrap">${chip(ex)}</div>`;
  const flav=rs.filter(r=>norm(r.vname)===norm(t)),types=catalogues[add.country]||[];
  const help=flav.length?`"${esc(t)}" on its own is a flavour. Name the kind of snack too, like "${esc(flav[0].title)}".`
    :(()=>{const [a,b]=[...rs.filter(r=>r.cat===add.rkCat),...rs.filter(r=>r.cat!==add.rkCat)].map(r=>r.title); // examples from its own type first
      return `What other brands would it go head to head with? Like "${esc(a||'Dark chocolate bars')}" or "${esc(b||'Chewy sweets')}", not the brand.`})();
  return `${ms.length?`<div class="hint">Did you mean</div><div class="chips wrap">${ms.map(chip).join('')}</div>`:''}
    <div class="chips wrap"><button class="chip chip-new" data-act="add-rk-new"${add.rkCat?'':' aria-disabled="true"'}>＋ New ranking: ${esc(t)}</button></div>
    <div class="chips wrap" role="group" aria-label="Its type"><span class="lab">Type</span>${types.map(c=>`<button class="chip${c.id===add.rkCat?' on':''}" aria-pressed="${c.id===add.rkCat}" data-act="add-type" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>
    <div class="hint">${add.rkCat?help:'Pick its type first.'}</div>`;
}
function renderRkFind(){const el=$('#rk-find');if(el)el.innerHTML=rkFindHtml()}
function countryRow(){
  const cp=placeBy('id',add.country)||{flag:'',name:''};
  if(!add.open.country)return answered('country','Sold in',`${cp.flag} ${esc(cp.name)}`);
  return `<div class="row ask" role="group" aria-labelledby="rl-country" id="row-country"><label class="lab" id="rl-country" for="add-country">Sold in</label>
    <select id="add-country" class="row-input">${places.map(p=>`<option value="${p.id}"${p.id===add.country?' selected':''}>${p.flag} ${esc(p.name)}</option>`).join('')}</select></div>`;
}
function dupOf(){ // one snack per brand, ranking and country
  const k=bkey(add.brand);if(!k||!add.rkData||!add.rk||add.rk.new)return null;
  return [...add.rkData.items.map(i=>({...i,live:true})),...add.rkData.pending.map(i=>({...i,live:false}))].find(x=>bkey(x.brand)===k)||null;
}
function renderRest(){ // below the rows: "Already here", or the photo, "Tried it?" and Send
  const el=$('#add-rest');if(!el)return;
  const left=thingsLeft(),d=dupOf(),n=settings.approval_votes,cp=placeBy('id',add.country)||{};
  let h=add.mode==='short'&&add.brand.trim()?packHtml():'';
  if(d){
    if(add.dupFor!==d.id){add.dupFor=d.id;track('add-duplicate',true)}
    const lo=leftover(),sub=subBrand();
    el.innerHTML=h+`<div class="alert"><b>Already here</b><span>${esc(d.brand)} already has ${esc(add.rk.title.toLowerCase())} ${esc(inPlace(cp))}.</span></div>
      <div class="match">${thumb(d,'sm')}<div><div class="nm">${esc(d.pack_name)}</div><div class="meta">${d.live?(d.total?plural(d.total,'rating'):'No ratings yet'):`${d.approvals} of ${n} approvals`}</div></div>
        <button class="btn btn-primary" data-act="add-open-match" data-id="${d.id}" data-cc="${cp.code}" data-product="${add.rk.pid}" data-variant="${add.rk.vid}">${d.live?'Rate it':'See it'}</button></div>
      <div class="dup-other"><p><b>Not ${esc(add.rk.title.toLowerCase())}?</b> If ${lo?esc(packName()):'yours'} is a different kind of snack, it goes head to head in its own ranking.</p>
        <button class="btn btn-block" data-act="add-rk-other">Put it in another ranking</button>
        ${sub?`<p class="hint center">Or is it a separate range, sold as ${esc(sub)}? <button class="link" data-act="add-brand-sub" data-name="${esc(sub)}">Make the brand ${esc(sub)}</button></p>`:''}</div>`;
    return;
  }
  if(!left){
    const tried=`<div class="field tried"><span class="lab">Tried it? <span class="optional">(optional)</span></span><div class="faces sm">${FACES.map(f=>
      `<button class="face-btn${add.score===f.v?' on':''}" aria-pressed="${add.score===f.v}" aria-label="${f.l}" data-act="add-face" data-v="${f.v}"><span aria-hidden="true">${f.e}</span></button>`).join('')}</div></div>`;
    const pick=add.mode==='short'&&add.offPhotos.length&&!add.offNone&&!add.photo; // photos only: the name stays yours
    h+=pick
      ?`<div class="pick-photo" role="group" aria-labelledby="pp-lab"><span class="lab" id="pp-lab">Pack photo <span class="optional">(optional)</span></span>
        <div class="photo-opts">${add.offPhotos.map((p,i)=>{const on=add.photoUrl===offImg(p.image_front_url);
          return `<button class="photo-opt${on?' on':''}" aria-pressed="${on}" data-act="add-photo-pick" data-i="${i}" aria-label="Use this photo: ${esc(tidyCase(p.product_name))}"><img src="${esc(offImg(p.image_front_small_url))}" alt="" loading="lazy"></button>`}).join('')}
          <button class="link" data-act="add-photo-none">None of these</button></div>
        <span class="src">${add.photoUrl?'Photo from Open Food Facts':'From Open Food Facts. Tap one that looks like yours.'}</span></div>${tried}`
      :add.photoUrl&&!add.ownPhoto
      ?`<div class="photo-row"><span class="thumb big"><img src="${esc(add.photoUrl)}" alt="Pack photo: ${esc(packName())}"></span><div><span class="src">Photo from Open Food Facts</span><br><button class="link" data-act="add-own-photo">Use my own photo</button></div></div>${tried}`
      :`<div class="photo-tried"><label class="upload${add.photo?' has-photo':''}">${add.photo?`<img src="${add.photo.url}" alt="Your photo"><span class="change">Change</span>`:'<span class="cam" aria-hidden="true">📷</span>Add photo<span class="optional">optional</span>'}
          <input type="file" id="add-photo" accept="image/*" class="sr-only"></label>${tried}</div>`;
    h+=`<p class="rule">${add.rk.new?`${esc(add.rk.title)} is new, so we'll check it first (usually within a few days). Then it goes to the vote: it needs ${n} approvals, and yours counts as the first.`
      :`It needs ${n} approvals to go live, and yours counts as the first.`}</p>`;
  }
  el.innerHTML=h+`<div id="add-error">${add.error?`<div class="sheet-error" role="alert"><b>It didn't send.</b> Please try again.<small>${esc(add.error)}</small></div>`:''}</div>`
    +(left?`<p class="left">${left===1?'1 thing':`${left} things`} left to check ↑</p>`:'')
    +`<button class="btn btn-primary btn-block" id="add-send" data-act="add-send">${left?'Send':add.rk.new?'Send for a check':'Send for approval'}</button>`;
}
async function renderBrandHelp(){ // under a brand box: ✓ on TasteRank, or "＋ New brand", plus known brands that match
  const help=$('#brand-help'),inp=$('#add-brand');if(!help||!inp)return;
  const v=inp.value,k=bkey(v);
  if(!k){help.innerHTML='';return}
  const sugg=(await knownBrands([v])).filter(s=>bkey(s).includes(k)||k.includes(bkey(s)));
  if(!$('#add-brand')||bkey($('#add-brand').value)!==k)return; // typing moved on
  const sp=splitBrand(v,sugg),bk=bkey(sp.brand),exact=sugg.find(s=>bkey(s)===bk),typed=add&&!add.brandWhole&&add.brandTyped;
  const cut=sp.cut||!!typed&&bkey(typed).startsWith(k+' '); // still said once the box shows just the brand
  $('#brand-help').innerHTML=(exact?`<span class="ok">✓ ${sp.cut?`${esc(exact)} `:''}on TasteRank</span>`:`<span class="newtag">＋ New brand: ${esc(sp.brand)}</span>`)
    +sugg.filter(s=>bkey(s)!==bk).slice(0,4).map(s=>`<button class="chip" data-act="add-brand-pick" data-name="${esc(s)}">${esc(s)}</button>`).join('')
    +(cut?'<div class="hint">The rest goes on the pack name.</div>':'');
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
async function sendAdd(){
  if(!add||add.sending)return;
  await flushPending();
  if(thingsLeft()){ // never a silently greyed-out button: take them to what's left
    $('#add-body .row.ask')?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    return focusAdd();
  }
  if(dupOf())return renderRest();
  const brand=tidyCase(add.brand),pack=tidyCase(packName())||null,rk=add.rk,review=!!rk.new,cp=placeBy('id',add.country),btn=$('#add-send');
  add.sending=true;add.error=null;btn.disabled=true;btn.textContent='Sending…';
  const url=add.photo||add.ownPhoto?null:add.photoUrl;
  let id,path=null;
  try{
    if(add.photo&&LIVE){path=await uploadPhoto(add.photo.blob);track('photo-upload',true)}
    const extra={p_image_path:path,p_image_url:url,p_barcode:add.barcode,p_score:add.score};
    const args=review
      ?{p_country:add.country,p_category:rk.cat,p_new_ranking:rk.title,p_brand_name:brand,p_pack_name:pack,p_product:rk.pid||null,p_new_variant:rk.pid?rk.variant:null,...extra}
      :{p_product:rk.pid,p_variant:rk.vid,p_country:add.country,p_brand_name:brand,p_pack_name:pack,...extra};
    if(!LIVE&&add.photo)args.p_demo_image=add.photo.dataUrl;
    id=await rpc(review?'submit_item_request':'submit_item',args);
  }catch(e){
    add.sending=false;
    if(e.code==='23505'){await loadRanking();return renderRest()} // someone added it a moment ago
    if(/already a ranking/i.test(e.message||'')){Object.assign(add,{rk:null,rkError:e.message,rkFind:rk.title});add.open.ranking=true;renderAdd();return focusAdd()}
    console.error(e);add.error=e.message||String(e);return renderRest();
  }
  if(review){
    const p=rk.pid&&rankingsFor(add.country).find(r=>r.pid===rk.pid);
    emailOwner(`TasteRank: check new ranking "${rk.title}"`,
      `Type: ${typeName(rk.cat)}\nSold in: ${cp.name}\nBrand: ${brand}\nName on the pack: ${pack||`${brand} ${rk.title}`}\nPhoto: ${path?'uploaded':url?'from Open Food Facts':'none'}\n`
      +`My guess: ${p?`${p.pname} › ${rk.variant||'Original'}`:`new product "${rk.title}" › Original`}\n\n`
      +`To check it, open Supabase → SQL Editor and run:\n  select * from public.review_list();\nThen accept it (with my guess) or decline it:\n  select public.accept_request(${id});\n  select public.decline_request(${id});`);
  }
  track('add-sent',true);
  add.sentName=pack||`${brand} ${rk.title}`;add.step=review?'sent-review':'sent';add.sending=false;homeData=null;
  renderAdd();$('#m-add .btn-primary')?.focus();
  refresh(); // the page behind shows it (and home reloads its data, so the type chips keep working)
}
const ADD_ACT={
  'add-back':()=>{clearPending();add.step='find';renderAdd();focusAdd()},
  'add-new':()=>{if(add.offShown.length)track('add-off-none',true);startCheck({})},
  'add-off-pick':d=>{track('add-off-picked',true);startCheck({off:add.offShown[+d.i]})},
  'add-cancel':()=>{clearPending();add=null;closeM()},
  'add-change':d=>{const row=d.row==='rank'?'ranking':d.row;add.open[row]=true;add.touched=true;track('add-row-changed-'+row,true);
    if(row==='ranking'&&add.rk&&add.rk.new)add.rkFind=add.rk.title; // your own new ranking: its name, ready to edit
    renderAdd();$(row==='ranking'&&add.rkFind?'#add-rkfind':`#row-${d.row} :is(.chip.on,button,input,select)`)?.focus()},
  'add-brand-pick':d=>{add.brandWhole=true; // a chip is a brand as it stands
    if(add.mode==='short'){clearPending();$('#add-brand').value=d.name;add.brand=d.name;commitShortBrand(d.name)}else answerBrand(d.name)},
  'add-rk':d=>{const x=add.rkList[+d.i];
    if(x.new&&sameRk(x,add.rk)){add.rkFind=x.title;const f=$('#add-rkfind');f.value=x.title;renderRkFind();f.focus();return}
    answerRanking(x)},
  'add-rk-pick':d=>{clearPending();answerRanking(rankingsFor(add.country).find(r=>r.pid===+d.pid&&r.vid===+d.vid))},
  'add-rk-new':()=>{clearPending();pickNewRk()},
  'add-type':d=>{clearPending();add.rkCat=+d.id;renderRkFind();const l=$('#rl-rank');if(l)l.textContent=`Ranked in · ${typeName(add.rkCat)}`;
    $(`#rk-find [data-act="add-type"][data-id="${d.id}"]`)?.focus()},
  'add-edit-pack':()=>{add.pack=packName();add.packEditing=true;if(add.mode==='short')renderRest();else renderAdd();const p=$('#add-pack');if(p){p.focus();p.select()}},
  'add-own-photo':()=>{add.ownPhoto=true;renderRest();$('#add-photo')?.click()},
  'add-photo-pick':d=>{const u=offImg(add.offPhotos[+d.i].image_front_url);add.photoUrl=add.photoUrl===u?null:u;if(add.photoUrl)track('add-photo-picked',true);
    renderRest();$(`#add-rest [data-act="add-photo-pick"][data-i="${d.i}"]`)?.focus()},
  'add-photo-none':()=>{Object.assign(add,{offNone:true,photoUrl:null});renderRest();$('#add-photo')?.focus()},
  'add-brand-sub':d=>{add.brandWhole=true;track('add-dup-sub-brand',true); // kept as typed, not cut back to the known brand
    if(add.mode==='short'){clearPending();$('#add-brand').value=d.name;commitShortBrand(d.name)}else answerBrand(d.name)},
  'add-rk-other':()=>{ // from "Already here": same brand and pack, a different ranking, starting from the words left over
    const d=dupOf(),t=leftover();clearPending();track('add-dup-other-ranking',true);
    if(add.mode==='short')Object.assign(add,{mode:'brand',pack:packName(),packEdited:true,packEditing:false}); // the ranking is no longer fixed
    Object.assign(add,{brand:d?d.brand:add.brand,brandState:'known',rkCat:add.rk.cat,rkChoices:[],rk:null,rkData:null,rkFind:t,rkError:null,touched:true});
    add.open.ranking=true;renderAdd();const f=$('#add-rkfind');if(f){f.focus();f.select()}},
  'add-search-all':()=>{clearPending();add=freshAdd({country:add.country});renderAdd();focusAdd()},
  'add-face':d=>{add.score=add.score===+d.v?null:+d.v;document.querySelectorAll('#add-body .face-btn').forEach(b=>{const on=+b.dataset.v===add.score;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)})},
  'add-send':sendAdd,
  'add-open-match':async d=>{add=null;closeM();await go({v:'ranking',cc:d.cc,product:+d.product,variant:+d.variant});if(page&&page.items.some(i=>i.id===+d.id))needUser({name:'rate',item:+d.id,from:'ranking'})},
  'add-share':()=>share(`Know ${add.sentName}? Help it onto TasteRank: approve it in ${add.rk.title}.`),
  'add-done':async()=>{const c=placeBy('id',add.country),rk=add.rk;closeM();await go({v:'ranking',cc:c.code,product:rk.pid,variant:rk.vid})}
};
// Saving a typed answer: when the box is left (a moment later, see later()) or on Enter
function commitField(el){
  const v=el.value;
  if(el.id==='add-brand')return add.mode==='short'?commitShortBrand(v):answerBrand(v);
  if(el.id==='add-rkfind')return commitRkFind(false);
  if(el.id==='add-pack'){Object.assign(add,{pack:tidyCase(v),packEdited:!!tidyCase(v),packEditing:false});if(add.mode==='short')renderRest();else renderAdd();$('#add-body [data-act="add-edit-pack"]')?.focus()}
}
document.addEventListener('input',e=>{
  if(!add)return;
  const id=e.target.id,v=e.target.value;
  if(id==='add-q'){add.q=v;add.results=null;add.off=null;add.offFor=null;renderResults();clearTimeout(searchTimer);clearTimeout(offTimer);searchTimer=setTimeout(runSearch,250);offTimer=setTimeout(runOff,600)}
  if(id==='add-brand'){
    add.brandWhole=false;add.brandTyped=v;
    if(add.mode==='short'){shortBrand(v,[]);add.brandState=null;renderRest()}
    clearTimeout(brandTimer);brandTimer=setTimeout(renderBrandHelp,200);
  }
  if(id==='add-rkfind'){add.rkFind=v;add.rkError=null;renderRkFind()}
  if(id==='add-pack')add.pack=v;
});
document.addEventListener('keydown',e=>{
  if(!add||e.key!=='Enter'||!['add-brand','add-rkfind','add-pack'].includes(e.target.id))return;
  e.preventDefault();clearPending();if(e.target.id==='add-rkfind')return commitRkFind(true);commitField(e.target);
});
document.addEventListener('change',async e=>{
  if(!add)return;
  const el=e.target;
  if(['add-brand','add-rkfind','add-pack'].includes(el.id))later(()=>commitField(el));
  if(el.id==='add-country')setCountry(+el.value);
  if(el.id==='add-photo'&&el.files[0]){
    try{add.photo=await shrinkPhoto(el.files[0]);add.ownPhoto=true;add.error=null}catch(x){add.error=x.message}
    renderRest();$('#add-photo')?.focus();
  }
});
async function runSearch(){ // TasteRank's own matches
  const q=add.q.trim();
  if(norm(q).length<2){add.results=null;return renderResults()}
  try{const r=await rpc('search_items',{q});if(add&&add.q.trim()===q){add.results=r;renderResults();track(r.length?'add-search-match':'add-no-match',true)}}
  catch(e){console.error(e);if(add&&add.q.trim()===q){add.results=[];renderResults()}}
}
function runOff(){ // Open Food Facts, from 3 characters, once typing pauses
  const q=add.q.trim();
  if(norm(q).length<3)return;
  offLookup(q,r=>{if(!add||add.q.trim()!==q)return;add.off=r||[];add.offFor=q;renderResults()});
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
      <p>We couldn't add ${esc(m.new_ranking)} as a new ranking, so ${esc(m.pack_name)} wasn't added. If it fits one that's already listed, you can add it there.</p>
      <button class="btn btn-primary btn-block" data-act="close">OK</button></div>`
    :`<div class="moment"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#crisp-sad"/></svg><h3 id="moment-title">Not this time</h3>
      <p>${esc(m.pack_name)} didn't get ${n} approvals in ${settings.close_after_days} days. You can send it in again; it starts afresh.</p>
      <button class="btn btn-primary btn-block" data-act="moment-again">Add it again</button><button class="btn btn-block" data-act="close">OK</button></div>`;
  openM('m-moment');
  if(live)toast('🎉 Your snack went live');
}
let moment=null;
Object.assign(ADD_ACT,{
  'moment-rate':async()=>{const m=moment,c=placeBy('id',m.country_id);closeM();await go({v:'ranking',cc:c.code,product:m.product_id,variant:m.variant_id});needUser({name:'rate',item:m.id,from:'ranking'})},
  'moment-again':async()=>{const m=moment;closeM();startAdd({country:m.country_id,product:m.product_id,variant:m.variant_id,brand:m.brand,pack:m.pack_name})}
});

/* ---------- Starting country: last choice, else where you are (from your internet address), else UK ---------- */
async function detectCountry(){
  try{const r=await withTimeout(fetch('https://api.country.is/'),1500);detected=(await r.json()).country||null}catch(e){}
  if(!detected){const m=(navigator.language||'').match(/-([A-Za-z]{2})$/);detected=m?m[1].toUpperCase():null}
}
const homeCountry=()=>placeBy('code',prefs.country)||placeBy('code',detected)||placeBy('code',DEFAULT_COUNTRY)||places[0];

/* ---------- Home: one card per category, or per brand (the switch shows once 3 brands have 2+ snacks here) ---------- */
let homeData=null, homeBy=null;
async function renderHome(r){
  const c=homeCountry();
  $('#country').innerHTML=places.map(p=>`<option value="${esc(p.code)}"${p===c?' selected':''}>${p.flag} ${esc(p.name)}</option>`).join('');
  $('#bubble').hidden=!!(profile&&profile.rated>=BUBBLE_UNTIL);
  homeBy=r&&r.by==='brands'?'brands':null;
  if(!homeData||homeData.country!==c.id){
    $('#cards').innerHTML='<div class="card empty">Loading…</div>';
    try{const [cats,brands]=await Promise.all([rpc('home_categories',{p_country:c.id}),rpc('home_brands',{p_country:c.id})]);homeData={country:c.id,cats,brands}}
    catch(e){console.error(e);$('#cards').innerHTML='<div class="card empty">Couldn\'t load snacks. Check your connection and refresh.</div>';return}
  }
  renderHomeCards();
}
const andList=l=>l.length<2?l.join(''):`${l.slice(0,-1).join(', ')} and ${l[l.length-1]}`; // "Toffee, chocolate bars and crisps"
const ratingsPart=n=>n?' · '+plural(n,'rating'):'';
function renderHomeCards(){
  if(!homeData)return;
  const c=places.find(p=>p.id===homeData.country),need=settings.rank_after_ratings,seg=homeData.brands.length>=3;
  if(homeBy==='brands'&&!seg){homeBy=null;if(location.hash==='#/brands'){history.replaceState(null,'',location.pathname);currentUrl=location.href}}
  const byBrand=homeBy==='brands';
  $('#home-seg').hidden=!seg;
  document.querySelectorAll('#home-seg [role=tab]').forEach(b=>{const on=(b.dataset.by==='brands')===byBrand;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1});
  const types=[...new Map(homeData.cats.map(x=>[x.type_id,x.type])).entries()].sort((a,b)=>a[0]-b[0]);
  if(prefs.cat!=='all'&&!types.some(([id])=>String(id)===String(prefs.cat)))prefs.cat='all';
  $('#cats').innerHTML=[['all','All'],...types].map(([id,name])=>`<button class="chip${String(id)===String(prefs.cat)?' on':''}" data-act="cat" data-cat="${id}" aria-pressed="${String(id)===String(prefs.cat)}">${esc(name)}</button>`).join('');
  const inType=id=>prefs.cat==='all'||String(id)===String(prefs.cat);
  const cards=byBrand
    ?homeData.brands.filter(b=>b.type_ids.some(inType)).map(b=>`<a class="pcard" href="${esc(hashFor({v:'brand',cc:c.code,brand:b.id}))}" data-act="brand" data-cc="${c.code}" data-brand="${b.id}">
        <span class="pc-head">${thumb(b.thumb||{},'sm')}<span class="pc-t"><b>${esc(b.name)}</b><span class="meta">${esc(andList(b.categories.map((n,i)=>i?n.toLowerCase():n)))} · ${plural(b.snacks,'snack')}${ratingsPart(b.ratings)}</span></span></span>
        ${b.best?`<span class="best"><span class="k">Best</span><span class="nm">${esc(b.best.pack_name)}</span><span class="sc">${faceFor(b.best.avg).e} ${score1(b.best.avg)}</span></span>`
          :`<span class="nowin"><b>No best yet</b> · each snack needs ${need} ratings</span>`}</a>`).join('')
    :homeData.cats.filter(x=>inType(x.type_id)).map(x=>`<a class="pcard" href="${esc(hashFor({v:'category',cc:c.code,product:x.id}))}" data-act="category" data-cc="${c.code}" data-product="${x.id}">
        <span class="pc-head"><span class="thumbs">${x.thumbs.map(p=>thumb(p,'xs')).join('')}</span><span class="pc-t"><b>${esc(x.name)}</b><span class="meta">${esc(x.type)} · ${plural(x.snacks,'snack')}${ratingsPart(x.ratings)}</span></span></span>
        ${x.top.length?`<ol class="toplist">${x.top.map((t,k)=>`<li><span class="r">${k+1}</span><span class="nm">${esc(t.pack_name)}</span><span class="sc">${faceFor(t.avg).e} ${score1(t.avg)}</span></li>`).join('')}</ol>`
          // nothing ranked yet: the snacks closest to 10 ratings, in a neutral style so they never look like winners
          :`<span class="nowin"><b>No winner yet</b> · ${x.to_rate.length?'rate these first:':`each snack needs ${need} ratings`}</span>
            ${x.to_rate.length?`<ol class="toplist todo">${x.to_rate.map(t=>`<li><span class="r">–</span><span class="nm">${esc(t.pack_name)}</span><span class="sc">${t.total} of ${need}</span></li>`).join('')}</ol>`:''}`}</a>`).join('');
  $('#cards').innerHTML=cards||`<div class="card empty">${byBrand?'No brand has 2 snacks of this type here yet.':'No snacks here yet. Know one? Tap + to add it.'}</div>`;
  setFab();
}
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
    :`<div class="early"><b>${none}</b>Each snack needs ${settings.rank_after_ratings} ratings. Rate the ones you know!</div>`;
}
/* A row leads with the snack's name (up to 2 lines, the whole name in its label). The name is the button that opens the rating sheet,
   stretched over the row; the link underneath (brand, or "#1 in Crisps") sits above it, so it's a separate tap and Tab stop. */
function listRow(it,k,sub){
  const need=settings.rank_after_ratings,rank=it.ranked?k+1:null,mine=it.my_score?FACES.find(f=>f.v===it.my_score):null;
  const pct=it.ranked?Math.round(it.avg/5*100):Math.min(100,Math.round(it.total/need*100));
  const label=`${rank?`Number ${rank}: `:''}${it.pack_name}. ${it.ranked?`${score1(it.avg)} out of 5, ${plural(it.total,'rating')}`:`${it.total} of ${need} ratings`}${mine?`. You rated it ${mine.l}`:''}`;
  return `<div class="ir${it.ranked&&k<3?' top3':''}${it.ranked?'':' unranked'}">
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
  if(!d||(!d.items.length&&!d.pending.length))return gone();
  const variant=d.flavours.length>=2&&d.flavours.some(f=>f.id===r.variant)?r.variant:null; // an old link to a flavour that has no chip opens All
  page={...d,key,kind:'category',route:{v:'category',cc:c.code,product:r.product,variant},cc:c.code};
  if(variant!==r.variant)setRoute(page.route);
  if(fresh)track('open-category',true);
  drawCategory();
}
function drawCategory(){
  const d=page,f=d.flavours.find(x=>x.id===d.route.variant)||null,chips=d.flavours.length>=2;
  const items=f?d.items.filter(i=>i.variant_id===f.id):d.items,pend=f?d.pending.filter(p=>p.variant_id===f.id):d.pending;
  const flavour=id=>(d.flavours.find(x=>x.id===id)||{}).name||'',total=items.reduce((s,i)=>s+i.total,0),n=items.length;
  d.title=f?f.title:d.name;
  $('#v-category').innerHTML=`
    <button class="crumb" data-act="home-type" data-cc="${d.cc}" data-type="${d.type_id}">← ${esc(d.country.short_name)} <span>· ${esc(d.type)}</span></button>
    <h1 class="page-title">${esc(d.title)}: which one wins?</h1>
    <div class="meta">${d.country.flag} ${esc(d.country.name)} · ${plural(n,'snack')}${ratingsPart(total)}</div>
    ${chips?chipsHtml('Flavours','flavour',[{id:null,name:'All',count:d.items.length},...d.flavours],f?f.id:null):''}
    ${winnerHtml(items,'The winner so far',w=>`${plural(w.total,'rating')} · ${Math.round(w.r5/w.total*100)}% love it`,'No winner yet')}
    ${n?`<div class="list">${items.map((it,k)=>listRow(it,k,(it.brand_snacks>=2
        ?`<a class="bl" href="${esc(hashFor({v:'brand',cc:d.cc,brand:it.brand_id}))}" data-act="brand" data-cc="${d.cc}" data-brand="${it.brand_id}">${esc(it.brand)}</a>`:esc(it.brand))
        +(chips&&!f?` · ${esc(flavour(it.variant_id))}`:''))).join('')}</div>`:''}
    ${n<3?`<div class="alert"><b>${n?`Only ${n===1?'one':'two'} so far`:'None live yet'}</b><span>Know ${n?`another ${esc(d.title.toLowerCase())}`:'one'} sold in ${esc(d.country.name)}? Tap + to add it. It goes live once ${settings.approval_votes} people approve.</span></div>`:''}
    ${pend.length?`<h2>Waiting for approval</h2><div class="pend-list">${pend.map(pendCard).join('')}</div>`:''}
    <button class="btn share-btn" data-act="share-list">Share this list</button>`;
}
function pickFlavour(id){
  if(!page||page.kind!=='category'||page.route.variant===id)return;
  page.route={...page.route,variant:id};setRoute(page.route);track('pick-flavour',true);
  redraw($('#v-category'),drawCategory,'flavour');
}
function pendCard(p){
  const n=settings.approval_votes,w=Math.min(100,Math.round(p.approvals/n*100));
  return `<div class="pend${p.mine?' mine':''}">${thumb(p,'sm')}
    <div class="in"><div class="bn">${esc(p.pack_name)}</div><div class="pk">${esc(p.brand)}${p.mine?' · <span class="mine">added by you</span>':''}</div>
      <div class="meta">${p.approvals} of ${n} approvals${p.mine?` · closes in ${p.days_left} days`:''}</div><div class="prog"><i style="width:${w}%"></i></div></div>
    <div class="pend-acts">${p.mine?'<button class="btn" data-act="share-list">Share</button>':''}
      ${p.mine&&LIVE?'':p.approved?'<button class="btn" disabled>Approved ✓</button>'
        :`<button class="btn btn-primary" data-act="approve" data-id="${p.id}" data-brand="${esc(p.brand)}" data-mine="${p.mine?1:''}" aria-label="Approve ${esc(p.pack_name)}">${p.mine?'Approve (demo)':'Approve'}</button>`}</div>
  </div>`;
}
async function doApprove(id,brand,mine){
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
    ${multi?chipsHtml('Categories','bp-cat',[{id:null,name:'All',count:d.items.length},...d.products],prod):''}
    ${fls.length>=2?chipsHtml('Flavours','bp-flavour',[{id:null,name:multi?`All ${(d.products.find(p=>p.id===prod)||{name:''}).name.toLowerCase()}`:'All',count:fls.reduce((s,f)=>s+f.count,0)},...fls],v):''}
    ${winnerHtml(items,`${possessive(d.name)} best so far`,w=>`${plural(w.total,'rating')}${w.place?` · #${w.place} in ${esc(w.product)}`:''}`,'No best yet')}
    <div class="list">${items.map((it,k)=>listRow(it,k,it.place?listLink(d.cc,it.product_id,`#${it.place} in ${esc(it.product)}`)
      :`${listLink(d.cc,it.product_id,esc(it.product))} · not ranked yet`)).join('')}</div>`;
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
    ${main}${n&&n.kind==='done'?'':`<button class="btn btn-block" data-act="sheet-second">${esc(second)}</button>`}`;
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
  try{const n=await rpc('rate_item',{p_item:it.id,p_score:v});if(profile)profile.rated=n}
  catch(e){console.error(e);sheet.error=e.message||String(e);renderSheet();return}
  track('rate-item',true);
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

/* ---------- Profile ---------- */
async function renderProfile(){
  if(!me)return go({v:'home'});
  const el=$('#v-profile');
  let mine=[],subs=[];try{await loadProfile();[mine,subs]=await Promise.all([rpc('my_ratings'),rpc('my_submissions').catch(()=>[])])}catch(e){oops(e)}
  for(const c of new Set([...subs,...mine].map(x=>x.country_id)))try{await loadCatalogue(c)}catch(e){} // for the category names
  const p=profile||{taster_id:'',rated:0},lists=new Set(mine.map(r=>`${r.product_id}-${r.country_id}`)).size;
  const category=r=>((catalogues[r.country_id]||[]).flatMap(t=>t.products).find(x=>x.id===r.product_id)||{}).name||r.ranking_title;
  el.innerHTML=`
    <button class="crumb" data-act="home">← Back</button>
    <div class="card profile">
      <div class="p-head"><span class="thumb big" aria-hidden="true">😋</span><div><h1 class="page-title">Your profile</h1><div class="meta">Taster ID ${esc(p.taster_id)}</div></div></div>
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
    <h2>Your additions</h2>
    ${subs.length?`<div class="list">${subs.map(subRow).join('')}</div>`
      :`<div class="card empty">Nothing yet. Missing a snack? Tap + and type what's on the pack.</div>`}
    <div class="profile-foot">
      <button class="btn" data-act="sign-out">Sign out</button>
      ${LIVE?'<button class="link btn-danger" data-act="delete-account">Delete my account</button>':'<button class="link" style="color:var(--muted)" data-act="reset-demo">Reset demo data</button>'}
    </div>`;
}
function subRow(x){ // a snack you sent in, and where it's got to
  const n=settings.approval_votes,pl=placeBy('id',x.country_id)||{},r=x.product_id&&rankingsFor(x.country_id).find(r=>r.pid===x.product_id&&r.vid===x.variant_id);
  const st={pending:['⏳',`Waiting for approval · ${x.approvals} of ${n}`],live:['✅','Live: rate it'],review:['🔎','Waiting for us to check the new ranking'],
    declined:['✖️','Not this time'],closed:['✖️',`Closed: it didn't get ${n} approvals in ${settings.close_after_days} days`]}[x.status]||['',x.status];
  const inner=`<span class="rk" aria-hidden="true">${st[0]}</span><span></span>
    <span class="in"><span class="bn">${esc(x.pack_name||x.brand)}</span><span class="pk">${esc(r?r.title:x.new_ranking||'')}${r||x.new_ranking?' · ':''}${pl.flag||''}</span><span class="pk">${esc(st[1])}</span></span><span></span>`;
  return r&&['pending','live'].includes(x.status)
    ?`<button class="ir" data-act="ranking" data-cc="${esc(pl.code||DEFAULT_COUNTRY)}" data-product="${x.product_id}" data-variant="${x.variant_id}">${inner}</button>`
    :`<div class="ir">${inner}</div>`;
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
  checkMoments();
  if(LIVE)sb.auth.onAuthStateChange((event,session)=>setTimeout(async()=>{ // e.g. signed out in another tab
    const u=userFrom(session);
    if((u&&u.id)===(me&&me.id))return;
    if(!u)return signedOut('Signed out');
    me=u;await loadProfile();homeData=null;renderHeader();refresh();
  },0));
}
start();
