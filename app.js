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
/* Names compared the way the database does: ignoring capitals, curly apostrophes, "&" vs "and" and extra spaces */
const norm=t=>String(t||'').toLowerCase().replace(/[\u2018\u2019]/g,"'").replace(/&/g,' and ').replace(/\s+/g,' ').trim();
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
  local:(kind,id,c)=>DEMO.local[`${kind}:${id}:${c}`],
  product:(id,c)=>D.local('product',id,c)||DEMO.products.find(p=>p.id===id).name,
  variant:(id,c)=>D.local('variant',id,c)||DEMO.variants.find(v=>v.id===id).name,
  title:(id,c)=>D.local('title',id,c)||DEMO.variants.find(v=>v.id===id).title,
  approvals:(it,st)=>it.approvals+(st.approvals.includes(it.id)?1:0)+(st.extra[it.id]||0),
  live:(it,st)=>!it.pending||D.approvals(it,st)>=DEMO.settings.approval_votes,
  totals(c,st){
    return D.all().filter(i=>i.c===c&&D.live(i,st)).map(i=>{
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
      // demo: Approve stays clickable, and each extra click counts as another person, so the live moment can be tried alone
      pending:D.all().filter(i=>i.pending&&!D.live(i,st)&&!i.closed&&i.c===p_country&&i.p===p_product&&i.v===p_variant).map(i=>({id:i.id,brand:i.b,pack_name:i.pack,image_url:i.img||null,image_path:null,
        emoji:p.emoji,approvals:D.approvals(i,st),approved:false,mine:!!i.mine,days_left:i.days_left})).sort((a,b)=>b.mine-a.mine||b.approvals-a.approvals)};
  },
  brand_view({p_brand,p_product,p_country},st){
    const t=D.totals(p_country,st).filter(x=>x.product_id===p_product),pl=DEMO.places.find(x=>x.id===p_country);
    const items=t.filter(x=>x.brand_id===p_brand).map(x=>{
      const peers=t.filter(y=>y.variant_id===x.variant_id),ranked=peers.filter(y=>y.ranked).sort(D.order);
      return {...x,variant:D.variant(x.variant_id,p_country),ranking_title:D.title(x.variant_id,p_country),place_in_ranking:x.ranked?ranked.findIndex(y=>y.id===x.id)+1:null,ranking_size:peers.length};
    }).sort(D.order);
    return {brand:D.all().find(i=>D.brandId(i.b)===p_brand).b,product:D.product(p_product,p_country),country:{id:pl.id,short_name:pl.short_name,flag:pl.flag},items};
  },
  next_to_rate({p_item,p_from_brand_view},st){
    const it=D.all().find(i=>i.id===p_item);if(!it)return {kind:'done'};
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
  unrate_item({p_item},st){delete st.ratings[p_item];demoSave(st);return Object.keys(st.ratings).length},
  approve_item({p_item},st){
    const it=D.all().find(i=>i.id===p_item);
    if(!st.approvals.includes(p_item)&&!it.mine)st.approvals.push(p_item);else st.extra[p_item]=(st.extra[p_item]||0)+1;
    if(D.live(it,st)&&st.planned[p_item]&&!st.ratings[p_item]){st.ratings[p_item]=st.planned[p_item];delete st.planned[p_item]} // "Tried it?" becomes a real rating
    demoSave(st);
    return {approvals:D.approvals(it,st),status:D.live(it,st)?'live':'pending'};
  },
  search_items({q},st){
    const words=norm(q).split(' ').filter(Boolean);if(norm(q).length<2)return [];
    return D.all().filter(i=>!i.closed&&words.every(w=>norm(`${i.b} ${i.pack} ${D.product(i.p,i.c)} ${D.variant(i.v,i.c)} ${D.title(i.v,i.c)}`).includes(w))).slice(0,20).map(i=>{
      const pl=DEMO.places.find(x=>x.id===i.c);
      return {id:i.id,pack_name:i.pack,brand:i.b,status:D.live(i,st)?'live':'pending',product_id:i.p,variant_id:i.v,country_id:i.c,country:pl.short_name,flag:pl.flag,
        ranking_title:D.title(i.v,i.c),image_url:i.img||null,image_path:null,emoji:DEMO.products.find(p=>p.id===i.p).emoji};
    }).sort((a,b)=>(b.status==='live')-(a.status==='live')||a.pack_name.localeCompare(b.pack_name));
  },
  catalogue({p_country}){return DEMO.categories.map(c=>({id:c.id,name:c.name,products:DEMO.products.filter(p=>p.category_id===c.id).map(p=>({id:p.id,name:D.product(p.id,p_country),emoji:p.emoji,
    variants:DEMO.variants.filter(v=>v.product_id===p.id).map(v=>({id:v.id,name:D.variant(v.id,p_country),title:D.title(v.id,p_country)}))}))}))},
  brand_suggest({q},st){const k=norm(q);return [...new Set(D.all().filter(i=>D.live(i,st)).map(i=>i.b))].filter(b=>k&&norm(b).includes(k)).sort((a,b)=>norm(b).startsWith(k)-norm(a).startsWith(k)||a.localeCompare(b)).slice(0,8).map(b=>({id:D.brandId(b),name:b}))},
  submit_item({p_product,p_variant,p_country,p_brand_name,p_pack_name,p_score,p_image_url,p_demo_image},st){
    const dup=D.all().find(i=>!i.closed&&i.p===p_product&&i.v===p_variant&&i.c===p_country&&norm(i.b)===norm(p_brand_name));
    if(dup)throw Object.assign(new Error('Already here'),{code:'23505',details:String(dup.id)});
    const brand=D.all().map(i=>i.b).find(b=>norm(b)===norm(p_brand_name))||p_brand_name.trim().replace(/\s+/g,' ');
    const id=Date.now();
    st.added.push({id,c:p_country,p:p_product,v:p_variant,b:brand,pack:p_pack_name||`${brand} ${D.title(p_variant,p_country)}`,img:p_demo_image||p_image_url||null,r:[0,0,0,0,0],pending:true,approvals:1,days_left:30,mine:true});
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
  my_submissions(_,st){return [...(st.added||[]).map(i=>({id:i.id,pack_name:i.pack,brand:i.b,product_id:i.p,variant_id:i.v,country_id:i.c,
    status:i.closed?'closed':D.live(i,st)?'live':'pending',approvals:D.approvals(i,st)})),...(st.requests||[]).map(r=>({...r,approvals:0}))]},
  my_profile(_,st){return st.user?{taster_id:'#DEMO00',home_place:{id:0,level:'unknown',name:'Unknown'},rated:Object.keys(st.ratings).length,
    rankings_helped:new Set(Object.keys(st.ratings).map(id=>{const i=D.all().find(x=>x.id==id);return i&&`${i.p}-${i.v}-${i.c}`})).size}:null},
  my_ratings(_,st){return Object.entries(st.ratings).map(([id,score])=>{const i=D.all().find(x=>x.id==id);if(!i)return null;
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
  cat:d=>{prefs.cat=d.cat;savePrefs();renderHomeCards()},  // renderHomeCards also relabels the + for that type
  ranking:d=>go({v:'ranking',cc:d.cc,product:+d.product,variant:+d.variant}),
  brand:d=>go({v:'brand',cc:d.cc,brand:+d.brand,product:+d.product}),
  rate:d=>needUser({name:'rate',item:+d.id,from:view}),
  face:d=>saveRating(+d.v),
  'edit-rating':()=>{sheet.editing=true;renderSheet()},
  unrate:removeRating,
  next:nextStep,
  'sheet-second':sheetSecond,
  approve:d=>needUser({name:'approve',item:+d.id,brand:d.brand,mine:d.mine==='1'}),
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
  const f=ACT[el.dataset.act]||ADD_ACT[el.dataset.act];if(!f)return;
  e.preventDefault();f(el.dataset);
});
$('#country').addEventListener('change',e=>{prefs.country=e.target.value;prefs.cat='all';savePrefs();renderHome()});
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

/* ---------- The floating +: add a snack (to the type chosen on home), or a brand to the ranking you're on ---------- */
function setFab(){
  const f=$('#add-fab'),t=view==='home'&&prefs.cat!=='all'&&homeData&&homeData.rankings.find(r=>String(r.category_id)===String(prefs.cat));
  f.hidden=view==='profile';
  f.setAttribute('aria-label',view==='ranking'&&page?`Add a brand to ${page.title}`:t?`Add a snack to ${t.category}`:'Add a snack');
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
  const g={brand:'',brandState:null,brandFrom:null,brandAsk:null,rk:null,rkChoices:[],rkCat:ctxCat||null,rkOther:false,
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
  if(!g.rkCat&&!g.rkChoices.length)g.rkOther=true; // nothing to go on: show the types
  if(off){g.photoUrl=offImg(off.image_front_url);if(/^\d{8,14}$/.test(String(off.code||'')))g.barcode=String(off.code)}
  return g;
}
function packName(){ // the name on the pack: as edited, or the brand (in its own spelling) followed by the rest
  if(add.packEdited)return add.pack;
  const b=add.brand.trim(),base=add.packBase||'';if(!b)return base;
  const r=afterBrand(base,b);return r===null?(base?`${b} ${base}`:b):[b,r].filter(Boolean).join(' ');
}
const thingsLeft=()=>add.mode==='short'?(add.brand.trim()?0:1):(add.brandState?0:1)+(add.rk?0:1);

/* ---------- Starting ---------- */
const freshAdd=o=>Object.assign({mode:'full',step:'find',country:null,ctxCat:null,q:'',results:null,off:null,offFor:null,offShown:[],
  brand:'',brandState:null,brandFrom:null,brandAsk:null,rk:null,rkChoices:[],rkCat:null,rkOther:false,rkList:[],rkFind:'',rkData:null,rkError:null,
  newRkOpen:false,newRk:'',open:{},touched:false,guessed:0,pack:'',packBase:'',packEdited:false,packEditing:false,packFromRk:false,
  photo:null,photoUrl:null,ownPhoto:false,barcode:null,score:null,error:null,sending:false},o);
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
  const v=tidyCase(name);if(!v)return;
  const k=(await knownBrands([v])).find(b=>bkey(b)===bkey(v));
  if(!add)return;
  Object.assign(add,{brand:k||v,brandState:k?'known':'new',brandFrom:!k&&add.brandAsk&&bkey(v)===bkey(add.brandAsk.off)?'off':null,touched:true});
  add.open.brand=false;
  renderAdd();focusAdd();
}
async function answerRanking(x){
  clearPending();if(!x)return;
  add.rk=x.new?{new:true,title:x.title,cat:x.cat,pid:x.pid||null,variant:x.variant||null}:{pid:x.pid,vid:x.vid,title:x.title,cat:x.cat};
  if(x.new)track('add-new-ranking',true);
  Object.assign(add,{newRkOpen:false,newRk:'',rkError:null,touched:true});add.open.ranking=false;
  if(add.packFromRk&&!add.packEdited)add.packBase=titleCase(x.title);
  await loadRanking();renderAdd();focusAdd();
}
const capFirst=t=>t.charAt(0).toUpperCase()+t.slice(1);
function answerNewRk(text){
  const t=capFirst(tidyCase(text,true));if(!t||!add.rkCat)return;
  if(rankingsFor(add.country).some(r=>norm(r.title)===norm(t)))return renderNewRkHelp(); // "… is already a ranking", with Use it
  answerRanking(add.rkChoices.find(x=>x.new&&norm(x.title)===norm(t))||{new:true,title:t,cat:add.rkCat}); // typing our own guess keeps its filing
}
async function setCountry(c){ // keeps the brand; the ranking is checked against that country's list
  add.country=c;try{await loadCatalogue(c)}catch(e){return oops(e)}
  const rs=rankingsFor(c),same=x=>rs.find(r=>r.pid===x.pid&&r.vid===x.vid);
  if(add.rk&&!add.rk.new){const r=same(add.rk);add.rk=r?{pid:r.pid,vid:r.vid,title:r.title,cat:r.cat}:null}
  else if(add.rk&&rs.some(r=>norm(r.title)===norm(add.rk.title))){add.newRk=add.rk.title;add.rk=null;add.newRkOpen=true}
  add.rkChoices=add.rkChoices.map(x=>x.new?x:same(x)).filter(Boolean);
  add.open.country=false;add.touched=true;
  await loadRanking();renderAdd();focusAdd();
}
async function commitShortBrand(v){ // the shortcut's brand box: known spelling, then ask Open Food Facts for this pack
  const t=tidyCase(v),k=t&&(await knownBrands([t])).find(b=>bkey(b)===bkey(t));
  if(!add)return;
  add.brand=k||t;add.brandState=t?(k?'known':'new'):null;
  const i=$('#add-brand');if(i&&i.value!==add.brand)i.value=add.brand;
  renderRest();renderBrandHelp();
  if(!t)return;
  const q=`${add.brand} ${add.rk.title}`;if(add.yoursFor===q)return;
  add.yoursFor=q;add.offYours=null;
  offLookup(q,r=>{
    if(!add||add.yoursFor!==q)return;
    const l=(r||[]).filter(p=>{const a=bkey(offBrand(p)),b=bkey(add.brand);return a&&(a.startsWith(b)||b.startsWith(a))});
    add.offYours=l.find(offSoldHere)||l[0]||null;renderRest();
  });
}

/* ---------- Drawing it ---------- */
const stepBar=n=>{const cancel=n===1||add.mode==='brand';
  return `<div class="flow-top"><button class="link" data-act="${cancel?'add-cancel':'add-back'}">${cancel?'Cancel':'← Back'}</button><div class="steps" aria-label="Step ${n} of 2">${[1,2].map(k=>`<i${k<=n?' class="on"':''}></i>`).join('')}<span>${n} of 2</span></div></div>`};
function searchExample(){ // from the rankings on home, for the type chosen there
  const rs=(homeData&&homeData.country===add.country?homeData.rankings:[]).filter(r=>!add.ctxCat||r.category_id===add.ctxCat),top=rs.find(r=>r.top);
  return top?`Brand or name, e.g. ${top.top.brand} ${top.title.toLowerCase()}`:rs[0]?`Brand or name, e.g. ${rs[0].title.toLowerCase()}`:'Brand or name, e.g. Walkers salt';
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
      +'<p class="src">From Open Food Facts, the free food database</p>';
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
  if(add.packEditing)return `<div class="pack"><input id="add-pack" class="row-input" value="${esc(add.pack)}" maxlength="120" autocomplete="off" aria-label="Name on the pack"></div>`;
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
  const types=catalogues[add.country]||[];
  let list=add.rkOther||(!add.rkChoices.length&&add.rkCat)
    ?[...add.rkChoices.filter(x=>x.new&&x.cat===add.rkCat),...rankingsFor(add.country).filter(r=>r.cat===add.rkCat)]:add.rkChoices;
  if(add.rk&&!list.some(x=>sameRk(x,add.rk)))list=[add.rk,...list];
  add.rkList=list;
  return `<div class="row ask" role="group" aria-labelledby="rl-rank" id="row-rank"><span class="lab" id="rl-rank">Ranked in${add.rkCat?` · ${esc(typeName(add.rkCat))}`:''}</span>
    <div class="q">Which ranking does it go in?</div>
    ${add.rkOther?`<div class="chips" role="group" aria-label="Types">${types.map(t=>`<button class="chip sm${t.id===add.rkCat?' on':''}" aria-pressed="${t.id===add.rkCat}" data-act="add-type" data-id="${t.id}">${esc(t.name)}</button>`).join('')}</div>`:''}
    ${list.length>=9?`<input id="add-rkfind" class="row-input" type="search" placeholder="Find a ranking" aria-label="Find a ranking" autocomplete="off" value="${esc(add.rkFind)}">`:''}
    <div id="rk-list">${rkChips()}</div></div>`;
}
function rkChips(){
  const list=add.rkList,f=norm(add.rkFind),shown=list.map((x,i)=>[x,i]).filter(([x])=>!f||norm(x.title).includes(f));
  return `${shown.length||add.rkCat?`<div class="chips wrap">${shown.map(([x,i])=>{const on=sameRk(x,add.rk);
      return `<button class="chip${x.new?' chip-new':''}${on?' on':''}" aria-pressed="${on}" data-act="add-rk" data-i="${i}">${x.new?'＋ ':''}${esc(x.title)}${x.new?NEW_TAG:''}</button>`}).join('')}
      ${add.rkCat?`<button class="chip chip-new${add.newRkOpen?' on':''}" aria-pressed="${add.newRkOpen}" data-act="add-newrk">＋ New ranking</button>`:''}</div>`:''}
    ${f?`<div class="hint">${shown.length} of ${list.length} · <button class="link" data-act="add-rk-all">Show all</button></div>`:''}
    ${add.newRkOpen?`<input id="add-newrk" class="row-input" value="${esc(add.newRk)}" maxlength="60" autocomplete="off" aria-label="New ranking" aria-describedby="newrk-help"><div id="newrk-help" class="hint">${newRkHelp()}</div>`:''}
    ${add.rkError?`<p class="sheet-error" role="alert">${esc(add.rkError)}</p>`:''}
    <div class="hint">${add.rkOther&&!add.rkCat?'Pick a type first.':`It goes head to head with other brands of the same thing.${add.rkOther?'':' <button class="link" data-act="add-other-types">Other types</button>'}`}</div>`;
}
function renderRkList(){const el=$('#rk-list');if(el)el.innerHTML=rkChips()}
function newRkHelp(){
  const t=tidyCase(add.newRk,true),rs=rankingsFor(add.country),same=t&&rs.find(r=>norm(r.title)===norm(t));
  if(same)return `${esc(same.title)} is already a ranking. <button class="chip" data-act="add-rk-use" data-pid="${same.pid}" data-vid="${same.vid}">Use it</button>`;
  const ex=rs.filter(r=>r.cat===add.rkCat).map(r=>r.title),[a,b]=ex.length>=2?ex:['Chewy sweets','Sour sweets'];
  return `What other brands would it go head to head with? Like "${esc(a)}" or "${esc(b)}", not the brand.`;
}
function renderNewRkHelp(){const el=$('#newrk-help');if(el)el.innerHTML=newRkHelp()}
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
function yoursHtml(){ // the shortcut: Open Food Facts' pack for this brand and ranking
  const p=add.offYours;if(!p||add.offUsed||add.yoursFor!==`${add.brand} ${add.rk.title}`)return '';
  return `<div class="offr yours">${offPic(p)}<div><div class="nm">Is this yours?</div><div class="src">${esc(tidyCase(p.product_name))}${p.quantity?`, ${esc(p.quantity)}`:''} · Open Food Facts</div></div>
    <button class="btn" data-act="add-off-use">Use</button></div>`;
}
function renderRest(){ // below the rows: "Already here", or the photo, "Tried it?" and Send
  const el=$('#add-rest');if(!el)return;
  const left=thingsLeft(),d=dupOf(),n=settings.approval_votes,cp=placeBy('id',add.country)||{};
  let h=add.mode==='short'&&add.brand.trim()?packHtml()+yoursHtml():'';
  if(d){
    if(add.dupFor!==d.id){add.dupFor=d.id;track('add-duplicate',true)}
    el.innerHTML=h+`<div class="alert"><b>Already here</b><span>${esc(d.brand)} already has ${esc(add.rk.title.toLowerCase())} ${esc(inPlace(cp))}.</span></div>
      <div class="match">${thumb(d,'sm')}<div><div class="nm">${esc(d.pack_name)}</div><div class="meta">${d.live?(d.total?plural(d.total,'rating'):'No ratings yet'):`${d.approvals} of ${n} approvals`}</div></div>
        <button class="btn btn-primary" data-act="add-open-match" data-id="${d.id}" data-cc="${cp.code}" data-product="${add.rk.pid}" data-variant="${add.rk.vid}">${d.live?'Rate it':'See it'}</button></div>
      <p class="hint center">Is yours a different range, like Walkers Max? Change the brand.</p>`;
    return;
  }
  if(!left){
    const tried=`<div class="field tried"><span class="lab">Tried it? <span class="optional">(optional)</span></span><div class="faces sm">${FACES.map(f=>
      `<button class="face-btn${add.score===f.v?' on':''}" aria-pressed="${add.score===f.v}" aria-label="${f.l}" data-act="add-face" data-v="${f.v}"><span aria-hidden="true">${f.e}</span></button>`).join('')}</div></div>`;
    h+=add.photoUrl&&!add.ownPhoto
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
  const exact=sugg.find(s=>bkey(s)===k);
  $('#brand-help').innerHTML=(exact?'<span class="ok">✓ on TasteRank</span>':`<span class="newtag">＋ New brand: ${esc(tidyCase(v))}</span>`)
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
    if(/already a ranking/i.test(e.message||'')){Object.assign(add,{rk:null,rkError:e.message,newRkOpen:false});add.open.ranking=true;renderAdd();return focusAdd()}
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
  'add-change':d=>{const row=d.row==='rank'?'ranking':d.row;add.open[row]=true;add.touched=true;track('add-row-changed-'+row,true);renderAdd();
    $(`#row-${d.row} :is(.chip.on,button,input,select)`)?.focus()},
  'add-brand-pick':d=>{if(add.mode==='short'){clearPending();$('#add-brand').value=d.name;add.brand=d.name;commitShortBrand(d.name)}else answerBrand(d.name)},
  'add-rk':d=>answerRanking(add.rkList[+d.i]),
  'add-rk-use':d=>answerRanking(rankingsFor(add.country).find(r=>r.pid===+d.pid&&r.vid===+d.vid)),
  'add-newrk':()=>{add.newRkOpen=!add.newRkOpen;renderRkList();if(add.newRkOpen)$('#add-newrk')?.focus()},
  'add-other-types':()=>{add.rkOther=true;add.rkFind='';renderAdd();$('#row-rank :is(.chip.on,.chip)')?.focus()},
  'add-type':d=>{Object.assign(add,{rkCat:+d.id,rkFind:'',newRkOpen:false});renderAdd();$(`#row-rank [data-act="add-type"][data-id="${d.id}"]`)?.focus()},
  'add-rk-all':()=>{add.rkFind='';const f=$('#add-rkfind');if(f){f.value='';f.focus()}renderRkList()},
  'add-edit-pack':()=>{add.pack=packName();add.packEditing=true;if(add.mode==='short')renderRest();else renderAdd();const p=$('#add-pack');if(p){p.focus();p.select()}},
  'add-own-photo':()=>{add.ownPhoto=true;renderRest();$('#add-photo')?.click()},
  'add-off-use':()=>{const p=add.offYours;Object.assign(add,{offUsed:true,photoUrl:offImg(p.image_front_url),barcode:/^\d{8,14}$/.test(String(p.code||''))?String(p.code):null});
    if(!add.packEdited)add.packBase=tidyCase(p.product_name);add.packFromRk=false;renderRest();$('#add-send')?.focus()},
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
  if(el.id==='add-newrk')return answerNewRk(v);
  if(el.id==='add-pack'){Object.assign(add,{pack:tidyCase(v),packEdited:!!tidyCase(v),packEditing:false});if(add.mode==='short')renderRest();else renderAdd();$('#add-body [data-act="add-edit-pack"]')?.focus()}
}
document.addEventListener('input',e=>{
  if(!add)return;
  const id=e.target.id,v=e.target.value;
  if(id==='add-q'){add.q=v;add.results=null;add.off=null;add.offFor=null;renderResults();clearTimeout(searchTimer);clearTimeout(offTimer);searchTimer=setTimeout(runSearch,250);offTimer=setTimeout(runOff,600)}
  if(id==='add-brand'){
    if(add.mode==='short'){
      if(add.offUsed&&bkey(v)!==bkey(add.brand)){Object.assign(add,{offUsed:false,photoUrl:null,barcode:null,packFromRk:true});if(!add.packEdited)add.packBase=titleCase(add.rk.title)}
      add.brand=v;add.brandState=null;renderRest();
    }
    clearTimeout(brandTimer);brandTimer=setTimeout(renderBrandHelp,200);
  }
  if(id==='add-newrk'){add.newRk=v;renderNewRkHelp()}
  if(id==='add-rkfind'){add.rkFind=v;renderRkList()}
  if(id==='add-pack')add.pack=v;
});
document.addEventListener('keydown',e=>{
  if(!add||e.key!=='Enter'||!['add-brand','add-newrk','add-pack'].includes(e.target.id))return;
  e.preventDefault();clearPending();commitField(e.target);
});
document.addEventListener('change',async e=>{
  if(!add)return;
  const el=e.target;
  if(['add-brand','add-newrk','add-pack'].includes(el.id))later(()=>commitField(el));
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
  $('#cards').innerHTML=cards+brands||`<div class="card empty">No snacks here yet. Know one? Tap + to add it.</div>`;
  setFab();
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
    <div class="pend-acts">${p.mine?'<button class="btn" data-act="share-ranking">Share</button>':''}
      ${p.mine&&LIVE?'':p.approved?'<button class="btn" disabled>Approved ✓</button>'
        :`<button class="btn btn-primary" data-act="approve" data-id="${p.id}" data-brand="${esc(p.brand)}" data-mine="${p.mine?1:''}">${p.mine?'Approve (demo)':'Approve'}</button>`}</div>
  </div>`;
}
async function doApprove(id,brand,mine){
  let r;try{r=await rpc('approve_item',{p_item:id});track('approve-item',true)}catch(e){return oops(e)}
  toast(r.status==='live'?`🎉 ${brand||'It'} is live`:`Thanks! ${r.approvals} of ${settings.approval_votes} approvals`);
  homeData=null;await refresh();
  if(r.status==='live'&&mine)checkMoments();
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
      ${sheet.error?`<div class="sheet-error" role="alert"><b>Your rating didn't save.</b> Please try again.<small>${esc(sheet.error)}</small></div>`
        :'<div class="help">Tap a face. It saves straight away.</div>'}
      ${it.my_score?'<button class="link remove-rating" data-act="unrate">Remove my rating</button>':''}`;
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
  checkMoments();
  if(LIVE)sb.auth.onAuthStateChange((event,session)=>setTimeout(async()=>{ // e.g. signed out in another tab
    const u=userFrom(session);
    if((u&&u.id)===(me&&me.id))return;
    if(!u)return signedOut('Signed out');
    me=u;await loadProfile();homeData=null;renderHeader();refresh();
  },0));
}
start();
