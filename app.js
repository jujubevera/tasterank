/* TasteRank behaviour. Loaded by index.html after the Supabase library. */
/* ============================================================
   SETTINGS: paste your keys here (see SETUP.md). The page itself is index.html; styles are in app.css.
   All of these are safe to be public; none of them is a password.
   Leave SUPABASE ones empty to run in demo mode (data saved on this device only).
   ============================================================ */
const CONFIG={
  SUPABASE_URL:'https://odhqfbfgxdvpsdoykafy.supabase.co',
  SUPABASE_ANON_KEY:'sb_publishable_DgUNWQ4tsRpyaOrvPq-YcQ_jUr4bDm-',   // publishable key: safe to be public
  WEB3FORMS_KEY:'e8ee254f-15cf-486b-9704-6c890a2c2075',   // web3forms.com: feedback is emailed to the address this key was made for; it never appears on the site
  GOATCOUNTER_CODE:'tasterank'   // stats at https://tasterank.goatcounter.com
};

/* ---------- Constants ---------- */
const FACES=[
  {v:5,e:'😍',l:'Love it'},{v:4,e:'😊',l:'Like it'},{v:3,e:'😐',l:"It's okay"},
  {v:2,e:'😕',l:'Not for me'},{v:1,e:'🤢',l:'Yuck'}
];
const CATEGORIES=['Chocolate & sweets','Crisps & snacks','Biscuits','Drinks','Spreads & sauces'];
const COUNTRIES=[['United Kingdom','GB'],['Japan','JP'],['United States','US'],['France','FR'],['Mexico','MX'],
 ['South Korea','KR'],['Germany','DE'],['Italy','IT'],['Spain','ES'],['India','IN'],['China','CN'],
 ['Australia','AU'],['Canada','CA'],['Brazil','BR'],['Netherlands','NL'],['Poland','PL'],['Turkey','TR'],
 ['Nigeria','NG'],['Philippines','PH'],['Thailand','TH'],['Vietnam','VN'],['Greece','GR'],['Portugal','PT'],
 ['Ireland','IE'],['Sweden','SE'],['Switzerland','CH'],['Belgium','BE'],['South Africa','ZA'],['Ukraine','UA']];
const DEFAULT_COUNTRY='United Kingdom';
const APPROVAL_VOTES=5; // keep in sync with supabase/setup.sql

/* Demo-mode sample data (live mode reads foods from Supabase). r = ratings for scores [1,2,3,4,5] */
const OFF='https://images.openfoodfacts.org/images/products/';
const DEMO_ITEMS=[
 {id:1,name:'Dairy Milk',brand:'Cadbury',country:'United Kingdom',category:'Chocolate & sweets',emoji:'🍫',img:OFF+'96119341/front_en.20.400.jpg',r:[12,20,60,310,840]},
 {id:2,name:'Chocolate Digestives',brand:"McVitie's",country:'United Kingdom',category:'Biscuits',emoji:'🍪',img:OFF+'500/016/818/8102/front_en.4.400.jpg',r:[8,15,50,260,610]},
 {id:3,name:'Yorkshire Tea',brand:'Taylors',country:'United Kingdom',category:'Drinks',emoji:'🍵',img:OFF+'501/035/711/2061/front.8.400.jpg',r:[10,12,40,190,520]},
 {id:4,name:'Salt & Vinegar Crisps',brand:'Walkers',country:'United Kingdom',category:'Crisps & snacks',emoji:'🥔',img:OFF+'500/032/801/6832/front_en.3.400.jpg',r:[20,35,90,240,330]},
 {id:5,name:'Marmite',brand:'Marmite',country:'United Kingdom',category:'Spreads & sauces',emoji:'🫙',img:OFF+'50184453/front_en.78.400.jpg',r:[180,90,60,110,240]},
 {id:6,name:'Jaffa Cakes',brand:"McVitie's",country:'United Kingdom',category:'Biscuits',emoji:'🍊',img:OFF+'500/016/800/2071/front.6.400.jpg',r:[10,20,70,230,400]},
 {id:7,name:'Percy Pigs',brand:'Marks & Spencer',country:'United Kingdom',category:'Chocolate & sweets',emoji:'🐷',img:OFF+'00132589/front_de.60.400.jpg',r:[6,10,40,180,420]},
 {id:8,name:'English Mustard',brand:"Colman's",country:'United Kingdom',category:'Spreads & sauces',emoji:'🟡',img:OFF+'000/005/014/7588/front_en.61.400.jpg',r:[15,25,80,150,140]},
 {id:9,name:'Matcha KitKat',brand:'Nestlé',country:'Japan',category:'Chocolate & sweets',emoji:'🍵',img:OFF+'955/600/122/7539/front_en.13.400.jpg',r:[10,18,50,220,500]},
 {id:10,name:'Pocky Chocolate',brand:'Glico',country:'Japan',category:'Biscuits',emoji:'🥢',img:OFF+'490/100/551/0357/front_en.3.400.jpg',r:[8,15,70,250,380]},
 {id:11,name:'Jagariko',brand:'Calbee',country:'Japan',category:'Crisps & snacks',emoji:'🥔',img:OFF+'490/133/057/3492/front_en.3.400.jpg',r:[5,10,40,140,300]},
 {id:12,name:'Ramune',brand:'Hatakosen',country:'Japan',category:'Drinks',emoji:'🫧',img:OFF+'490/249/400/8004/front_en.28.400.jpg',r:[12,30,90,160,180]},
 {id:13,name:'Peanut Butter Cups',brand:"Reese's",country:'United States',category:'Chocolate & sweets',emoji:'🥜',img:OFF+'003/400/043/2899/front_en.3.400.jpg',r:[15,20,60,220,520]},
 {id:14,name:'Goldfish Crackers',brand:'Pepperidge Farm',country:'United States',category:'Crisps & snacks',emoji:'🐟',img:OFF+'001/410/008/5485/front.12.400.jpg',r:[10,25,90,200,220]},
 {id:15,name:'Root Beer',brand:'A&W',country:'United States',category:'Drinks',emoji:'🥤',img:OFF+'007/800/005/2459/front_en.3.400.jpg',r:[60,70,90,110,90]},
 {id:16,name:'Apricot Jam',brand:'Bonne Maman',country:'France',category:'Spreads & sauces',emoji:'🍑',img:OFF+'360/858/082/3452/front_fr.72.400.jpg',r:[5,8,30,150,260]},
 {id:17,name:'Petit Beurre',brand:'LU',country:'France',category:'Biscuits',emoji:'🧈',img:null,r:[6,15,60,150,170]},
 {id:18,name:'Carambar',brand:'Carambar',country:'France',category:'Chocolate & sweets',emoji:'🍬',img:OFF+'366/434/631/0406/front_fr.24.400.jpg',r:[10,20,70,120,110]},
 {id:19,name:'Takis Fuego',brand:'Barcel',country:'Mexico',category:'Crisps & snacks',emoji:'🌶️',img:OFF+'750/103/042/4536/front_es.14.400.jpg',r:[30,25,60,150,260]},
 {id:20,name:'Salsa Picante',brand:'Valentina',country:'Mexico',category:'Spreads & sauces',emoji:'🔥',img:OFF+'009/733/900/0054/front.8.400.jpg',r:[8,10,30,120,240]},
 {id:21,name:'Caramel Wafer',brand:"Tunnock's",country:'United Kingdom',category:'Biscuits',emoji:'🧇',img:OFF+'501/097/507/0095/front_en.28.400.jpg',status:'pending',votes:4},
 {id:22,name:'Hello Panda',brand:'Meiji',country:'Japan',category:'Biscuits',emoji:'🐼',img:OFF+'888/807/710/2023/front_en.16.400.jpg',status:'pending',votes:2}
];

/* ---------- Small helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const codeOf=name=>(COUNTRIES.find(c=>c[0]===name)||[])[1];
const flag=name=>{const c=codeOf(name);return c?String.fromCodePoint(...[...c].map(ch=>127397+ch.charCodeAt(0))):'🌍'};
const total=i=>i.r.reduce((a,b)=>a+b,0);
const avg=i=>{const t=total(i);return t?i.r.reduce((s,n,k)=>s+n*(k+1),0)/t:0};
const faceFor=a=>FACES.find(f=>f.v===Math.round(a))||FACES[2];
const fmt=n=>n.toLocaleString('en-GB');
/* Saved settings. Pass session=true for data that should last only until the tab closes.
   Wrapped in try because some browsers block storage (e.g. private windows). */
const store={
  get(k,session){try{return JSON.parse((session?sessionStorage:localStorage).getItem(k))}catch(e){return null}},
  set(k,v,session){try{(session?sessionStorage:localStorage).setItem(k,JSON.stringify(v))}catch(e){}},
  del(k,session){try{(session?sessionStorage:localStorage).removeItem(k)}catch(e){}}
};
function thumb(it,big){
  const e=esc(it.emoji||'🍽️');
  const inner=it.img?`<img src="${esc(it.img)}" alt="" loading="lazy" data-e="${e}" onerror="this.replaceWith(this.dataset.e)">`:e;
  return `<div class="thumb${big?' big':''}">${inner}</div>`;
}
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,2600)}
function oops(e){console.error(e);toast('Something went wrong. Please try again.')}
function withTimeout(p,ms){return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))])}

/* ============================================================
   DATA LAYER: everything that reads or saves data goes through `api`.
   Live mode uses Supabase (shared by everyone); demo mode uses this browser only.
   ============================================================ */
const LIVE=!!(CONFIG.SUPABASE_URL&&CONFIG.SUPABASE_ANON_KEY&&window.supabase);
const sb=LIVE?window.supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_ANON_KEY,{auth:{flowType:'pkce'}}):null;
/* People are known only by their random user ID: TasteRank never shows or saves their Google name, email or photo */
const userFrom=s=>s?{id:s.user.id}:null;
const tasterId=id=>'#'+String(id).replace(/-/g,'').slice(0,6).toUpperCase();
const must=({data,error})=>{if(error)throw error;return data};

const liveApi={
  async session(){return userFrom(must(await sb.auth.getSession()).session)},
  async signIn(){must(await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}}))},
  async signOut(){await sb.auth.signOut()},
  async deleteAccount(){must(await sb.rpc('delete_me'));await sb.auth.signOut()},
  async getHome(){const d=must(await sb.from('profiles').select('home_country').eq('id',me.id).maybeSingle());return d?.home_country||null},
  async setHome(c){must(await sb.from('profiles').update({home_country:c}).eq('id',me.id))},
  async load(){
    items=must(await sb.rpc('item_list')).map(d=>({id:d.id,name:d.name,brand:d.brand,country:d.country,category:d.category,
      emoji:d.emoji,img:d.image_url,status:d.status,r:[d.r1,d.r2,d.r3,d.r4,d.r5],votes:d.votes,mine:d.mine}));
    if(!me){myRatings={};myVotes=new Set();return}
    const [r,v]=await Promise.all([sb.from('ratings').select('item_id,score'),sb.from('votes').select('item_id')]);
    myRatings=Object.fromEntries(must(r).map(x=>[x.item_id,x.score]));
    myVotes=new Set(must(v).map(x=>x.item_id));
  },
  async rate(id,score){must(await sb.from('ratings').upsert({item_id:id,user_id:me.id,score,updated_at:new Date().toISOString()},{onConflict:'item_id,user_id'}))},
  async vote(id){must(await sb.from('votes').insert({item_id:id,user_id:me.id}))},
  async submit(p){must(await sb.from('items').insert({name:p.name,brand:p.brand,country:p.country,category:p.category,emoji:p.emoji,image_url:p.img}))},
  async suggest(name){must(await sb.from('suggestions').insert({name}))}
};

/* Demo mode stores only what this person did; sample foods always come fresh from the code. */
const DEMO_KEY='tasterank-demo-v2';
const demo=()=>Object.assign({user:null,home:null,ratings:{},votes:[],items:[],suggestions:[]},store.get(DEMO_KEY)||{});
const demoSave=d=>store.set(DEMO_KEY,d);
const demoApi={
  async session(){return demo().user},
  async signIn(){const d=demo();d.user={id:'demo'};demoSave(d)},
  async signOut(){const d=demo();d.user=null;demoSave(d)},
  async deleteAccount(){store.del(DEMO_KEY)},
  async getHome(){return demo().home},
  async setHome(c){const d=demo();d.home=c;demoSave(d)},
  async load(){
    const d=demo();
    items=[...DEMO_ITEMS,...d.items].map(x=>({status:'live',votes:0,r:[0,0,0,0,0],...x,r:[...(x.r||[0,0,0,0,0])],mine:!!x.mine}));
    for(const it of items){
      const s=d.ratings[it.id];if(s)it.r[s-1]++;
      if(d.votes.includes(it.id))it.votes++;
      if(it.status==='pending'&&it.votes>=APPROVAL_VOTES)it.status='live';
    }
    myRatings=me?{...d.ratings}:{};myVotes=new Set(me?d.votes:[]);
  },
  async rate(id,score){const d=demo();d.ratings[id]=score;demoSave(d)},
  async vote(id){const d=demo();if(!d.votes.includes(id))d.votes.push(id);demoSave(d)},
  async submit(p){const d=demo(),id=Date.now();d.items.push({...p,id,status:'pending',votes:0,mine:true});d.votes.push(id);demoSave(d)},
  async suggest(name){const d=demo();d.suggestions.push(name);demoSave(d)}
};
const api=LIVE?liveApi:demoApi;

/* ---------- App state ---------- */
let items=[], me=null, home=null, myRatings={}, myVotes=new Set();
let loaded=false, detected=null;
const prefs=Object.assign({country:null,cat:'All'},store.get('tasterank-prefs')||{});
const savePrefs=()=>store.set('tasterank-prefs',prefs);
let view='home', current=null, picked=null, pendingAfter=null, currentUrl=location.href;
store.del('tasterank-proto-v1'); // data from the first prototype

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
  const first=m.querySelector('.face-btn,input:not([type=checkbox]),textarea,select,button:not(.x)');
  (first||m.querySelector('button')).focus();
}
function closeM(){
  if(!openId)return;
  $('#'+openId).hidden=true;openId=null;
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

/* ---------- Navigation: each page has its own link (#/item/5, #/me) ---------- */
function show(v,id){
  view=v;
  ['home','detail','profile'].forEach(x=>$('#v-'+x).hidden=x!==v);
  if(v==='home')renderHome();
  if(v==='detail'){current=id;renderDetail()}
  if(v==='profile')renderProfile();
  currentUrl=location.href;
  track(pagePath());
}
function go(v,id){
  const h=v==='detail'?'#/item/'+id:v==='profile'?'#/me':'';
  if(location.hash!==h)history.pushState(null,'',h||location.pathname);
  show(v,id);window.scrollTo(0,0);
}
function route(){
  const m=location.hash.match(/^#\/item\/(\d+)$/), id=m&&Number(m[1]);
  if(id&&items.some(i=>i.id===id&&i.status==='live'))show('detail',id);
  else if(location.hash==='#/me'&&me&&home)show('profile');
  else show('home');
}
window.addEventListener('popstate',()=>{
  if(openId){closeM();history.pushState(null,'',currentUrl);return} // Back closes the pop-up instead of leaving the page
  route();
});
const renderAll=()=>{renderHeader();show(view,current)};

/* ---------- Clicks: every button says what it does with data-act ---------- */
const ACT={
  home:()=>go('home'),
  item:d=>go('detail',Number(d.id)),
  cat:d=>{prefs.cat=d.cat;savePrefs();renderHome()},
  add:()=>needUser('submit'),
  suggest:()=>needUser('suggest'),
  me:()=>needUser('profile'),
  rate:()=>needUser('rate'),
  vote:d=>needUser('vote',Number(d.id)),
  face:d=>{picked=Number(d.v);renderFaces()},
  'save-rating':saveRating,
  close:closeM,
  'sign-in':signIn,
  'pick-home':d=>pickHome(d.country),
  'other-country':()=>{$('#c-other').hidden=false;$('#c-other-in').focus()},
  'other-continue':()=>pickHome($('#c-other-in').value.trim()),
  'change-home':()=>{pendingAfter={name:'profile'};openOnboard()},
  'home-board':homeBoard,
  share:()=>share(),
  'share-item':shareItem,
  'sign-out':signOut,
  'delete-account':deleteAccount,
  'reset-demo':resetDemo,
  feedback:()=>{track('feedback-open',true);openM('m-feedback')},
  privacy:()=>openM('m-privacy'),
  settings:()=>showSettings($('#settings-pop').hidden),
  'set-theme':d=>setTheme(d.theme)
};
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');
  if(!el||el.disabled)return;
  const f=ACT[el.dataset.act];if(!f)return;
  e.preventDefault();f(el.dataset);
});
$('#country').addEventListener('change',e=>{prefs.country=e.target.value;savePrefs();renderHome()});
$('#c-search').addEventListener('input',renderCountryList);
$('#f-submit').addEventListener('submit',submitItem);
$('#f-suggest').addEventListener('submit',suggestCat);
$('#f-feedback').addEventListener('submit',sendFeedback);

/* ---------- Sign-in & onboarding ---------- */
const AFTER={
  rate:()=>openRate(),
  submit:()=>openSubmit(),
  suggest:()=>openM('m-suggest'),
  profile:()=>go('profile'),
  vote:id=>doVote(id)
};
function needUser(name,arg){
  if(me&&home)return AFTER[name](arg);
  if(me){pendingAfter={name,arg};return openOnboard()}
  store.set('tasterank-after',{name,arg,hash:location.hash},true); // survives the trip to Google and back
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
  if(!me){renderAll();return}
  home=await api.getHome();
  await api.load();
  closeM();renderHeader();
  if(next&&next.hash&&next.hash!==location.hash)history.replaceState(null,'',next.hash);
  route();
  if(!home){pendingAfter=next;openOnboard()}
  else if(next&&AFTER[next.name])AFTER[next.name](next.arg);
}
function openOnboard(){$('#c-search').value='';$('#c-other').hidden=true;renderCountryList();openM('m-onboard')}
function renderCountryList(){
  const q=$('#c-search').value.toLowerCase();
  const list=COUNTRIES.map(c=>c[0]).sort((a,b)=>(codeOf(b)===detected)-(codeOf(a)===detected)||a.localeCompare(b));
  $('#c-list').innerHTML=list.filter(c=>c.toLowerCase().includes(q))
    .map(c=>`<li><button data-act="pick-home" data-country="${esc(c)}"><span>${flag(c)}</span>${esc(c)}</button></li>`).join('')
    ||'<li style="padding:12px 14px;color:var(--muted)">No match. Try "My country isn\'t listed" below.</li>';
}
async function pickHome(c){
  if(!c)return;
  const first=!home;
  try{await api.setHome(c)}catch(e){return oops(e)}
  home=c;closeM();toast(first?'Welcome to TasteRank!':'Home country updated');
  const f=pendingAfter;pendingAfter=null;
  if(f&&AFTER[f.name])AFTER[f.name](f.arg);else renderAll();
}
function renderHeader(){
  const b=$('#me-btn');
  b.innerHTML=me?'👤<span class="hide-sm">Profile</span>':'Sign in';
  if(me)b.setAttribute('aria-label','Profile');else b.removeAttribute('aria-label');
}

/* ---------- Starting country: last choice, else where you are (from your internet address), else UK ---------- */
async function detectCountry(){
  try{const r=await withTimeout(fetch('https://api.country.is/'),1500);detected=(await r.json()).country||null}catch(e){}
  if(!detected){const m=(navigator.language||'').match(/-([A-Za-z]{2})$/);detected=m?m[1].toUpperCase():null}
}
function boardCountry(countries){
  const guess=(COUNTRIES.find(c=>c[1]===detected)||[])[0];
  return [prefs.country,guess,DEFAULT_COUNTRY].find(c=>c&&countries.includes(c))||countries[0];
}

/* ---------- Home ---------- */
function renderHome(){
  const board=$('#board');
  if(!loaded){board.innerHTML='<li class="card empty">Loading…</li>';return}
  const countries=[...new Set(items.map(i=>i.country))].sort();
  const country=boardCountry(countries);
  $('#country').innerHTML=countries.map(c=>`<option value="${esc(c)}"${c===country?' selected':''}>${flag(c)} ${esc(c)}</option>`).join('');
  $('#cats').innerHTML=['All',...CATEGORIES].map(c=>`<button class="chip${c===prefs.cat?' on':''}" data-act="cat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')
    +`<button class="chip ghost" data-act="suggest">+ Suggest a category</button>`;

  const list=items.filter(i=>i.status==='live'&&i.country===country&&(prefs.cat==='All'||i.category===prefs.cat))
    .sort((a,b)=>avg(b)-avg(a)||total(b)-total(a)||a.name.localeCompare(b.name));
  board.innerHTML=list.length?list.map((it,k)=>{
    const a=avg(it),t=total(it);
    return `<li><button class="row" data-act="item" data-id="${it.id}">
      <span class="rank">${t?(k?k+1:'<span class="badge">#1</span>'):'–'}</span>${thumb(it)}
      <span class="info"><div class="name">${esc(it.name)}</div><div class="meta">${esc(it.brand)} · ${esc(it.category)}</div></span>
      <span class="score">${t?`<div class="face">${faceFor(a).e}</div><div class="num">${a.toFixed(1)}</div><div class="cnt">${fmt(t)} rating${t===1?'':'s'}</div>`:'<div class="cnt">No ratings yet</div>'}</span>
    </button></li>`}).join('')
    :`<li class="card empty">Nothing here yet. <button class="link" data-act="add">Add the first one</button></li>`;

  const pend=items.filter(p=>p.status==='pending'&&p.country===country);
  $('#pending-wrap').hidden=!pend.length;
  $('#pending').innerHTML=pend.map(p=>{
    const voted=myVotes.has(p.id);
    return `<div class="card prow">${thumb(p)}
      <div class="info"><div class="name">${esc(p.name)}</div><div class="meta">${esc(p.brand)} · ${p.votes}/${APPROVAL_VOTES} votes</div>
      <div class="progress"><i style="width:${Math.min(p.votes/APPROVAL_VOTES,1)*100}%"></i></div></div>
      <button class="btn${voted?'':' btn-primary'}" ${voted?'disabled':''} data-act="vote" data-id="${p.id}">${voted?'Voted ✓':'Approve'}</button>
    </div>`}).join('');
}
async function doVote(id){
  if(myVotes.has(id))return renderHome();
  try{await api.vote(id);await api.load()}catch(e){return oops(e)}
  track('vote',true);
  const it=items.find(i=>i.id===id);
  toast(it&&it.status==='live'?`${it.name} is now live 🎉`:'Thanks for voting!');
  renderHome();
}

/* ---------- Detail ---------- */
function renderDetail(){
  const it=items.find(i=>i.id===current&&i.status==='live');if(!it)return go('home');
  const a=avg(it),t=total(it),mine=myRatings[it.id];
  const bars=FACES.map(f=>{const n=it.r[f.v-1],pct=t?Math.round(n/t*100):0;
    return `<div class="bar-row"><span>${f.e}</span><div class="track"><div class="fill" style="width:${pct}%"></div></div><span class="pct">${pct}%</span></div>`}).join('');
  const mf=FACES.find(f=>f.v===mine);
  $('#detail').innerHTML=`
    <div class="detail-head">${thumb(it,true)}
      <div><h1>${esc(it.name)}</h1><div class="meta">${esc(it.brand)} · ${flag(it.country)} ${esc(it.country)} · ${esc(it.category)}</div></div>
    </div>
    <div class="avg">${t?`<span class="face">${faceFor(a).e}</span><span><span class="num">${a.toFixed(1)}</span> <span class="meta">/ 5 from ${fmt(t)} rating${t===1?'':'s'}</span></span>`:'<span class="meta">No ratings yet. Be the first!</span>'}</div>
    <div class="bars">${bars}</div>
    ${mf?`<div class="mine">Your rating: ${mf.e} ${mf.l}</div>`:''}
    <div class="detail-actions">
      <button class="btn btn-primary btn-block" data-act="rate">${mf?'Change my rating':'Rate this'}</button>
      <button class="btn btn-block" data-act="share-item">Share this item</button>
    </div>`;
}

/* ---------- Rating ---------- */
function openRate(){
  const it=items.find(i=>i.id===current);if(!it)return;
  picked=myRatings[current]||null;
  $('#rate-sub').textContent=`${it.brand} ${it.name}`;
  renderFaces();openM('m-rate');
}
function renderFaces(){
  const focused=document.activeElement&&document.activeElement.dataset.v;
  $('#faces').innerHTML=FACES.map(f=>`<button class="face-btn${picked===f.v?' on':''}" data-act="face" data-v="${f.v}" aria-pressed="${picked===f.v}"><span aria-hidden="true">${f.e}</span>${f.l}</button>`).join('');
  if(focused){const b=$(`#faces [data-v="${focused}"]`);if(b)b.focus()}
  $('#rate-save').disabled=!picked;
}
async function saveRating(){
  const btn=$('#rate-save');btn.disabled=true;
  try{await api.rate(current,picked);await api.load()}catch(e){btn.disabled=false;return oops(e)}
  track('rate',true);
  closeM();toast('Rating saved '+FACES.find(f=>f.v===picked).e);renderDetail();
}

/* ---------- Submit, suggest & feedback ---------- */
function openSubmit(){
  const country=$('#country').value||DEFAULT_COUNTRY;
  $('#s-country').innerHTML=COUNTRIES.map(c=>`<option${c[0]===country?' selected':''}>${esc(c[0])}</option>`).join('');
  $('#s-cat').innerHTML=CATEGORIES.map(c=>`<option>${esc(c)}</option>`).join('');
  openM('m-submit');
}
async function submitItem(e){
  e.preventDefault();
  const p={name:$('#s-name').value.trim(),brand:$('#s-brand').value.trim(),country:$('#s-country').value,
    category:$('#s-cat').value,emoji:$('#s-emoji').value.trim()||'🍽️',img:$('#s-img').value.trim()||null};
  if(!p.name)return;
  const btn=e.target.querySelector('[type=submit]');btn.disabled=true;
  try{await api.submit(p);await api.load()}catch(err){btn.disabled=false;return oops(err)}
  btn.disabled=false;track('submit',true);
  prefs.country=p.country;prefs.cat='All';savePrefs();
  e.target.reset();closeM();go('home');toast(`Submitted! It needs ${APPROVAL_VOTES-1} more votes to go live.`);
}
async function suggestCat(e){
  e.preventDefault();
  const name=$('#sg-name').value.trim();if(!name)return;
  try{await api.suggest(name)}catch(err){return oops(err)}
  track('suggest',true);
  e.target.reset();closeM();toast('Thanks! Your suggestion has been sent.');
}
async function sendFeedback(e){
  e.preventDefault();
  const message=$('#fb-msg').value.trim();if(!message)return;
  const btn=e.target.querySelector('[type=submit]');btn.disabled=true;
  try{
    const r=await fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({access_key:CONFIG.WEB3FORMS_KEY,subject:'TasteRank feedback',from_name:'TasteRank',
        message,email:$('#fb-email').value.trim()||undefined,page:location.href,
        signed_in:me?'yes':'no',home_country:home||'',botcheck:$('#fb-bot').checked})});
    const j=await r.json();if(!j.success)throw new Error(j.message||'Feedback not sent');
  }catch(err){btn.disabled=false;return oops(err)}
  btn.disabled=false;track('feedback-sent',true);
  e.target.reset();closeM();toast('Thank you! Your feedback has been sent.');
}

/* ---------- Profile ---------- */
function renderProfile(){
  if(!me||!home)return go('home');
  const rated=items.filter(i=>myRatings[i.id]);
  const cats=new Set(rated.map(i=>i.category));
  const mySubs=items.filter(p=>p.mine&&p.status==='pending');
  $('#profile').innerHTML=`
    <div class="p-head"><div class="avatar" aria-hidden="true">😋</div>
      <div><h1 style="font-size:24px;margin:0">Your profile</h1><div class="meta">Taster ID ${esc(tasterId(me.id))} · Home country: ${flag(home)} ${esc(home)} · <button class="link" data-act="change-home">change</button></div></div>
    </div>
    <div class="stats">
      <div class="stat"><b>${rated.length}</b><span>items rated</span></div>
      <div class="stat"><b>${cats.size}/${CATEGORIES.length}</b><span>categories covered</span></div>
      <div class="stat"><b>${mySubs.length}</b><span>submissions pending</span></div>
    </div>
    <div class="actions">
      <button class="btn btn-primary" data-act="home-board">${flag(home)} My country's leaderboard</button>
      <button class="btn" data-act="share">Share TasteRank</button>
    </div>
    <h2>My ratings</h2>
    ${rated.length?`<ul class="history">${rated.map(it=>`<li><button class="row" data-act="item" data-id="${it.id}">${thumb(it)}
      <span class="info"><div class="name">${esc(it.name)}</div><div class="meta">${flag(it.country)} ${esc(it.brand)}</div></span>
      <span class="score"><div class="face">${FACES.find(f=>f.v===myRatings[it.id]).e}</div></span></button></li>`).join('')}</ul>`
      :`<div class="card empty">You haven't rated anything yet. <button class="link" data-act="home">Find something to rate</button></div>`}
    <div style="margin-top:28px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <button class="btn" data-act="sign-out">Sign out</button>
      ${LIVE?'<button class="link btn-danger" data-act="delete-account">Delete my account</button>':'<button class="link" style="color:var(--muted)" data-act="reset-demo">Reset demo data</button>'}
    </div>`;
}
function homeBoard(){
  if(items.some(i=>i.country===home)){prefs.country=home;prefs.cat='All';savePrefs();go('home')}
  else toast(`No ${home} items yet. Add the first one!`);
}
function shareItem(){const it=items.find(i=>i.id===current);if(it)share(`${it.brand} ${it.name} on TasteRank`)}
async function share(text){
  const data={title:'TasteRank',text:text||'Find out which food is worth bringing home.',url:location.href};
  try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(location.href);toast('Link copied')}}catch(e){}
}
async function signedOut(msg){
  me=null;home=null;
  try{await api.load()}catch(e){}
  renderHeader();go('home');toast(msg);
}
async function signOut(){try{await api.signOut()}catch(e){}signedOut('Signed out')}
async function deleteAccount(){
  if(!confirm("Delete your account, ratings and votes? This can't be undone."))return;
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
/* Settings panel under the gear: closes on a click elsewhere or Escape */
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
  $('#fab').hidden=!CONFIG.WEB3FORMS_KEY;
  if(!LIVE)$('#signin-fine').textContent='Demo mode: no real account is created.';
  if(CONFIG.SUPABASE_URL&&!window.supabase)toast("Couldn't reach the TasteRank server. Showing demo data.");
  const geo=detectCountry();
  const params=new URLSearchParams(location.search);
  try{
    if(params.has('error_description'))toast('Sign-in was cancelled or failed. Please try again.');
    me=await api.session();
    if(params.has('code')||params.has('error'))history.replaceState(null,'',location.pathname+location.hash); // tidy the address bar after Google sign-in
    if(me)home=await api.getHome();
    await api.load();
  }catch(e){console.error(e);$('#board').innerHTML='<li class="card empty">Couldn\'t load foods. Check your connection and refresh.</li>';return}
  if(!prefs.country)await geo; // only wait for the guess when it decides what to show
  loaded=true;renderHeader();
  if(me&&store.get('tasterank-after',true))await afterSignIn();
  else{route();if(me&&!home)openOnboard()}
  if(LIVE)sb.auth.onAuthStateChange((event,session)=>setTimeout(async()=>{ // e.g. signed out in another tab
    const u=userFrom(session);
    if((u&&u.id)===(me&&me.id))return;
    if(!u)return signedOut('Signed out');
    me=u;home=await api.getHome();await api.load();renderAll();
  },0));
}
start();
