const stateKey="nousDeuxStateV1";
const defaultState={
  shopping:[{id:1,title:"Lait",done:false,store:"Courses"},{id:2,title:"Croquettes",done:false,store:"Animaux"}],
  tasks:[{id:11,title:"Appeler le plombier",priority:"urgent",owner:"NASTX",done:false},{id:12,title:"Ranger les papiers",priority:"normal",owner:"Nous deux",done:false}],
  events:[{id:21,title:"Exemple : rendez-vous",date:new Date(Date.now()+86400000).toISOString().slice(0,10),time:"14:00"}],
  home:[{id:31,title:"Vérifier la terrasse",category:"Maison",priority:"important",done:false}],
  notes:[{id:41,title:"Dimensions meuble",text:"Ajoute ici les infos à retenir."}],
  buys:[{id:51,title:"Exemple : nouveau sommier",price:"",priority:"normal"}],
  chat:[{id:61,from:"Manon",text:"Bienvenue dans notre appli ❤️",time:new Date().toISOString()}]
};
let state=JSON.parse(localStorage.getItem(stateKey)||"null")||defaultState;

const appConfig=window.APP_CONFIG||{};
let supabaseClient=null;
let currentUser=null;
let currentDisplayName="Nous";
let remoteTimer=null;
let realtimeChannel=null;
let appActivated=false;
let appActivating=false;

function ensureSyncUi(){
  if(!document.getElementById("syncStatus")){
    const el=document.createElement("div");
    el.id="syncStatus";
    el.style.cssText="position:fixed;top:calc(10px + env(safe-area-inset-top));right:12px;z-index:90;padding:7px 11px;border-radius:999px;background:#071d38;color:#68d8ff;border:1px solid #1d74c8;font:700 12px system-ui;box-shadow:0 8px 24px #001a3b66";
    el.textContent="Connexion…";
    document.body.appendChild(el);
  }
}
function setSyncStatus(text,error=false){
  ensureSyncUi();
  const el=document.getElementById("syncStatus");
  el.textContent=text;
  el.style.background=error?"#2a0f1b":"#071d38";
  el.style.color=error?"#ff9ab2":"#68d8ff";
}
function buildAuthGate(){
  if(document.getElementById("authGate"))return;
  const style=document.createElement("style");
  style.textContent="#authGate{position:fixed;inset:0;z-index:9999;background:radial-gradient(circle at 50% 25%,#082f6e,#020817 55%,#01040b);display:grid;place-items:center;padding:22px;font-family:system-ui}#authCard{width:min(430px,100%);background:#07111f;border:1px solid #123565;border-radius:26px;padding:26px;box-shadow:0 24px 80px #0066ff35;color:#f8fbff}#authCard h2{margin:0 0 8px;font-size:32px;color:#fff}#authCard p{color:#8fa7c7;line-height:1.45}#authCard label{display:block;margin:14px 0 6px;font-weight:700;color:#c7d8ef}#authCard input{width:100%;box-sizing:border-box;border:1px solid #1a3f70;border-radius:13px;padding:13px;font-size:16px;background:#020817;color:#fff}#authSubmit{width:100%;margin-top:18px;border:0;border-radius:13px;padding:14px;background:linear-gradient(135deg,#006eff,#00c8ff);color:#fff;font-size:16px;font-weight:800}#authToggle{width:100%;margin-top:10px;border:0;background:transparent;color:#38cfff;font-weight:750;padding:9px}#authMessage{min-height:22px;color:#ff7a70!important;font-weight:650}#authNameWrap{display:none}";
  document.head.appendChild(style);
  const gate=document.createElement("div");
  gate.id="authGate";
  gate.innerHTML='<div id="authCard"><div style="font-size:34px">💫</div><h2>Nous Deux</h2><p id="authIntro">Connectez-vous pour retrouver vos listes et messages sur vos deux téléphones.</p><form id="authForm"><div id="authNameWrap"><label for="authName">Votre prénom</label><input id="authName" autocomplete="name" placeholder="Jean-Baptiste ou Manon"></div><label for="authEmail">Adresse e-mail</label><input id="authEmail" type="email" autocomplete="email" required><label for="authPassword">Mot de passe</label><input id="authPassword" type="password" autocomplete="current-password" minlength="6" required><p id="authMessage"></p><button id="authSubmit" type="submit">Se connecter</button><button id="authToggle" type="button">Créer mon compte</button></form></div>';
  document.body.appendChild(gate);
  let signup=false;
  const toggle=gate.querySelector("#authToggle");
  const submit=gate.querySelector("#authSubmit");
  const nameWrap=gate.querySelector("#authNameWrap");
  toggle.onclick=()=>{
    signup=!signup;
    nameWrap.style.display=signup?"block":"none";
    submit.textContent=signup?"Créer mon compte":"Se connecter";
    toggle.textContent=signup?"J’ai déjà un compte":"Créer mon compte";
    gate.querySelector("#authPassword").autocomplete=signup?"new-password":"current-password";
    gate.querySelector("#authMessage").textContent="";
  };
  gate.querySelector("#authForm").onsubmit=async e=>{
    e.preventDefault();
    const msg=gate.querySelector("#authMessage");
    const email=gate.querySelector("#authEmail").value.trim();
    const password=gate.querySelector("#authPassword").value;
    const displayName=gate.querySelector("#authName").value.trim()||email.split("@")[0];
    submit.disabled=true;
    submit.textContent=signup?"Création…":"Connexion…";
    const result=signup
      ? await supabaseClient.auth.signUp({email,password,options:{data:{display_name:displayName},emailRedirectTo:location.origin+location.pathname}})
      : await supabaseClient.auth.signInWithPassword({email,password});
    submit.disabled=false;
    submit.textContent=signup?"Créer mon compte":"Se connecter";
    if(result.error){msg.textContent=result.error.message;return}
    if(result.data.session){await activateSession(result.data.user)}
    else msg.textContent="Compte créé. Ouvrez l’e-mail Supabase pour confirmer, puis revenez vous connecter.";
  };
}
function hideAuthGate(){
  const gate=document.getElementById("authGate");
  if(gate)gate.style.display="none";
}
async function pushRemoteState(){
  if(!supabaseClient||!currentUser||!appActivated)return;
  setSyncStatus("Synchronisation…");
  const {error}=await supabaseClient.from("couple_state").upsert({id:"main",data:state,updated_at:new Date().toISOString()});
  setSyncStatus(error?"Hors ligne":"Synchronisé",!!error);
}
function queueRemoteSave(){
  if(!appActivated)return;
  clearTimeout(remoteTimer);
  remoteTimer=setTimeout(pushRemoteState,250);
}
async function activateSession(user){
  if(appActivating)return;
  appActivating=true;
  currentUser=user;
  currentDisplayName=user.user_metadata?.display_name||user.email?.split("@")[0]||"Nous";
  const {data,error}=await supabaseClient.from("couple_state").select("data").eq("id","main").maybeSingle();
  if(error){setSyncStatus("Erreur de connexion",true);appActivating=false;return}
  if(data?.data){
    state=data.data;
  }else{
    const first={id:"main",data:state,updated_at:new Date().toISOString()};
    const created=await supabaseClient.from("couple_state").upsert(first);
    if(created.error){setSyncStatus("Erreur de synchronisation",true);appActivating=false;return}
  }
  localStorage.setItem(stateKey,JSON.stringify(state));
  appActivated=true;
  hideAuthGate();
  renderAll();
  setSyncStatus("Synchronisé");
  setupNotificationButton();
  const profileBtn=document.querySelector('[aria-label="Profil"]');
  if(profileBtn){
    profileBtn.textContent=currentDisplayName.slice(0,1).toUpperCase();
    profileBtn.title="Appuyer pour se déconnecter";
    profileBtn.onclick=async()=>{if(confirm("Se déconnecter de Nous Deux ?"))await supabaseClient.auth.signOut()};
  }
  if(realtimeChannel)await supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel=supabaseClient.channel("couple-state-live").on("postgres_changes",{event:"*",schema:"public",table:"couple_state",filter:"id=eq.main"},payload=>{
    if(payload.new?.data){
      state=payload.new.data;
      localStorage.setItem(stateKey,JSON.stringify(state));
      renderAll();
      setSyncStatus("Synchronisé");
    }
  }).subscribe();
  appActivating=false;
}
async function initSupabase(){
  buildAuthGate();
  ensureSyncUi();
  if(!appConfig.supabaseUrl||!appConfig.supabaseAnonKey){
    document.querySelector("#authMessage").textContent="Configuration Supabase manquante.";
    setSyncStatus("Configuration manquante",true);
    return;
  }
  try{
    const mod=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabaseClient=mod.createClient(appConfig.supabaseUrl,appConfig.supabaseAnonKey);
    supabaseClient.auth.onAuthStateChange(async(event,session)=>{
      if(session?.user&&!appActivated)await activateSession(session.user);
      if(event==="SIGNED_OUT"){
        appActivated=false;
        currentUser=null;
        if(realtimeChannel)await supabaseClient.removeChannel(realtimeChannel);
        document.getElementById("authGate").style.display="grid";
        setSyncStatus("Déconnecté",true);
      }
    });
    const {data}=await supabaseClient.auth.getSession();
    if(data.session?.user)await activateSession(data.session.user);
    else setSyncStatus("Connexion requise",true);
  }catch(error){
    document.querySelector("#authMessage").textContent="Impossible de joindre Supabase. Vérifiez votre connexion.";
    setSyncStatus("Hors ligne",true);
  }
}

const NOTIFICATION_FUNCTION="send-push";
const VAPID_PUBLIC_KEY="BMcWFM9x5bWukvAOC5Y2PjrzOdhpVONySuFklfItIlgomFmoj6-x05Atj2nscWRN_UxsAq3XTy5iYtn_9-23L-I";
function base64UrlToBytes(value){
  const padding="=".repeat((4-value.length%4)%4);
  const base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64);
  return Uint8Array.from([...raw].map(char=>char.charCodeAt(0)));
}
async function setupNotificationButton(){
  const button=document.getElementById("notificationBtn");
  if(!button)return;
  button.onclick=enableNotifications;
  if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window)){
    button.textContent="🔕";
    button.title="Notifications non disponibles sur ce navigateur";
    return;
  }
  const registration=await navigator.serviceWorker.ready.catch(()=>null);
  const subscription=registration?await registration.pushManager.getSubscription().catch(()=>null):null;
  const enabled=Notification.permission==="granted"&&!!subscription;
  button.textContent=enabled?"🔔":"🔕";
  button.classList.toggle("enabled",enabled);
  button.title=enabled?"Notifications activées":"Activer les notifications";
}
async function enableNotifications(){
  if(!currentUser||!supabaseClient)return;
  const button=document.getElementById("notificationBtn");
  const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone=window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;
  if(isiOS&&!standalone){
    alert("Sur iPhone : dans Safari, touchez Partager puis Sur l’écran d’accueil. Rouvrez ensuite Nous Deux depuis son icône pour activer les notifications.");
    return;
  }
  if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window)){
    alert("Ce navigateur ne permet pas les notifications. Installez Nous Deux sur l’écran d’accueil puis réessayez.");
    return;
  }
  if(Notification.permission==="denied"){
    alert("Les notifications sont bloquées. Autorisez-les dans les réglages du téléphone pour Nous Deux.");
    return;
  }
  button?.classList.add("working");
  try{
    const permission=await Notification.requestPermission();
    if(permission!=="granted")return;
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription){
      subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToBytes(VAPID_PUBLIC_KEY)});
    }
    const json=subscription.toJSON();
    const {error}=await supabaseClient.from("push_subscriptions").upsert({
      user_id:currentUser.id,
      endpoint:subscription.endpoint,
      p256dh:json.keys?.p256dh||"",
      auth:json.keys?.auth||"",
      platform:isiOS?"ios":"web",
      updated_at:new Date().toISOString()
    },{onConflict:"endpoint"});
    if(error)throw error;
    await setupNotificationButton();
    alert("Notifications activées. Vous recevrez maintenant les nouveautés de l’autre.");
  }catch(error){
    console.error("Notification setup failed",error);
    alert("Impossible d’activer les notifications pour le moment. Fermez puis rouvrez l’application et réessayez.");
  }finally{button?.classList.remove("working")}
}
async function notifyPartner(title,body){
  if(!supabaseClient||!currentUser)return;
  try{
    await supabaseClient.functions.invoke(NOTIFICATION_FUNCTION,{body:{title,body,url:"/APP-MANON-JB/"}});
  }catch(error){console.warn("Push notification failed",error)}
}

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const save=(notification=null)=>{localStorage.setItem(stateKey,JSON.stringify(state));renderAll();queueRemoteSave();if(notification)notifyPartner(notification.title,notification.body)};
const uid=()=>Date.now()+Math.floor(Math.random()*999);
const esc=s=>(s??"").toString().replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));

function setScreen(name){
  $$(".screen").forEach(x=>x.classList.toggle("active",x.dataset.screen===name));
  $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.screenTarget===name));
  $("#pageTitle").textContent={home:"Accueil",us:"Nous",lists:"Listes",planning:"Planning",house:"Maison"}[name]||"Nous Deux";
  window.scrollTo({top:0,behavior:"smooth"});
}
$$("[data-screen-target]").forEach(b=>b.onclick=()=>setScreen(b.dataset.screenTarget));
$$("[data-jump]").forEach(b=>b.onclick=()=>{
  const j=b.dataset.jump;
  if(j==="tasks"){setScreen("lists");setListTab("tasks")}
  else if(j==="lists"){setScreen("lists");setListTab("shopping")}
  else setScreen(j);
});

function setListTab(tab){
  $$("[data-list-tab]").forEach(x=>x.classList.toggle("active",x.dataset.listTab===tab));
  ["shopping","tasks","buys"].forEach(k=>$("#"+k+"Panel").classList.toggle("hidden",k!==tab));
}
$$("[data-list-tab]").forEach(b=>b.onclick=()=>setListTab(b.dataset.listTab));
$$("[data-us-tab]").forEach(b=>b.onclick=()=>{
  const tab=b.dataset.usTab;
  $$("[data-us-tab]").forEach(x=>x.classList.toggle("active",x.dataset.usTab===tab));
  ["chat","notes","memories"].forEach(k=>$("#"+k+"Panel").classList.toggle("hidden",k!==tab));
});

function renderShopping(){
  $("#shoppingList").innerHTML=state.shopping.length?state.shopping.map(i=>`
  <div class="item ${i.done?"done":""}">
    <input class="check" type="checkbox" ${i.done?"checked":""} onchange="toggleItem('shopping',${i.id})">
    <div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.store||"Courses")}</div></div>
    <div class="item-actions"><button class="item-action" aria-label="Modifier" onclick="editItem('shopping',${i.id})">✎</button><button class="item-action delete" aria-label="Supprimer" onclick="removeItem('shopping',${i.id})">⌫</button></div>
  </div>`).join(""):`<div class="empty card">Aucune course.</div>`;
}
function renderTasks(){
  $("#taskList").innerHTML=state.tasks.length?state.tasks.map(i=>`
  <div class="item ${i.done?"done":""}">
    <input class="check" type="checkbox" ${i.done?"checked":""} onchange="toggleItem('tasks',${i.id})">
    <div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.owner||"Nous deux")}</div></div>
    <span class="badge ${i.priority==="urgent"?"urgent":""}">${esc(i.priority||"normal")}</span><div class="item-actions"><button class="item-action" aria-label="Modifier" onclick="editItem('tasks',${i.id})">✎</button><button class="item-action delete" aria-label="Supprimer" onclick="removeItem('tasks',${i.id})">⌫</button></div>
  </div>`).join(""):`<div class="empty card">Aucune tâche.</div>`;
}

let calendarCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);
const calendarKey=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
let selectedCalendarDate=calendarKey(new Date());
window.selectCalendarDate=key=>{selectedCalendarDate=key;renderCalendar();renderEvents()};
window.changeCalendarMonth=delta=>{
  calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+delta,1);
  const now=new Date();
  selectedCalendarDate=now.getFullYear()===calendarCursor.getFullYear()&&now.getMonth()===calendarCursor.getMonth()?calendarKey(now):calendarKey(calendarCursor);
  renderCalendar();
  renderEvents();
};
function renderCalendar(){
  const grid=$("#calendarGrid");
  if(!grid)return;
  const year=calendarCursor.getFullYear();
  const month=calendarCursor.getMonth();
  $("#calendarMonth").textContent=calendarCursor.toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
  const first=new Date(year,month,1);
  const start=(first.getDay()+6)%7;
  const daysInMonth=new Date(year,month+1,0).getDate();
  const cellCount=Math.ceil((start+daysInMonth)/7)*7;
  const cursor=new Date(first);
  cursor.setDate(cursor.getDate()-start);
  const today=calendarKey(new Date());
  const cells=[];
  for(let n=0;n<cellCount;n++){
    const d=new Date(cursor);
    d.setDate(cursor.getDate()+n);
    if(d.getFullYear()!==year||d.getMonth()!==month){
      cells.push('<span class="calendar-day empty-day" aria-hidden="true"></span>');
      continue;
    }
    const key=calendarKey(d);
    const count=state.events.filter(e=>e.date===key).length;
    cells.push('<button class="calendar-day '+(key===today?'today ':'')+(key===selectedCalendarDate?'selected':'')+'" onclick="selectCalendarDate(\''+key+'\')"><span>'+d.getDate()+'</span>'+(count?'<i>'+Array(Math.min(count,3)).fill('•').join('')+'</i>':'')+'</button>');
  }
  grid.innerHTML=cells.join("");
}
function renderEvents(){
  const all=[...state.events].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const events=all.filter(e=>e.date===selectedCalendarDate);
  const title=$("#selectedDateTitle");if(title)title.textContent=new Date(selectedCalendarDate+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  $("#eventList").innerHTML=events.length?events.map(i=>`
  <div class="item"><div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.date)} ${esc(i.time||"")}</div></div><div class="item-actions"><button class="item-action" aria-label="Modifier" onclick="editItem('events',${i.id})">✎</button><button class="item-action delete" aria-label="Supprimer" onclick="removeItem('events',${i.id})">⌫</button></div></div>`).join(""):`<div class="empty card">Aucun événement.</div>`;
}
function renderHome(){
  $("#homeList").innerHTML=state.home.length?state.home.map(i=>`
  <div class="item ${i.done?"done":""}">
    <input class="check" type="checkbox" ${i.done?"checked":""} onchange="toggleItem('home',${i.id})">
    <div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.category||"Maison")}</div></div>
    <span class="badge">${esc(i.priority||"normal")}</span><div class="item-actions"><button class="item-action" aria-label="Modifier" onclick="editItem('home',${i.id})">✎</button><button class="item-action delete" aria-label="Supprimer" onclick="removeItem('home',${i.id})">⌫</button></div>
  </div>`).join(""):`<div class="empty card">Aucun sujet maison.</div>`;
}
function renderNotes(){
  $("#notesList").innerHTML=state.notes.length?state.notes.map(i=>`
  <div class="item"><div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.text||"")}</div></div><div class="item-actions"><button class="item-action" aria-label="Modifier" onclick="editItem('notes',${i.id})">✎</button><button class="item-action delete" aria-label="Supprimer" onclick="removeItem('notes',${i.id})">⌫</button></div></div>`).join(""):`<div class="empty card">Aucune note.</div>`;
}
function renderBuys(){
  $("#buyList").innerHTML=state.buys.length?state.buys.map(i=>`
  <div class="item"><div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${i.price?esc(i.price)+" €":"Prix à comparer"}</div></div><span class="badge">${esc(i.priority||"normal")}</span><div class="item-actions"><button class="item-action" aria-label="Modifier" onclick="editItem('buys',${i.id})">✎</button><button class="item-action delete" aria-label="Supprimer" onclick="removeItem('buys',${i.id})">⌫</button></div></div>`).join(""):`<div class="empty card">Aucun achat prévu.</div>`;
}
function renderChat(){
  const list=$("#chatList");
  list.innerHTML=state.chat.map(m=>{
    const own=(m.userId&&currentUser&&m.userId===currentUser.id)||m.from===currentDisplayName;
    return `<div class="bubble ${own?"me":""}"><div>${esc(m.text)}</div><div class="time">${new Date(m.time).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}${m.edited?" · modifié":""}</div>${own?`<div class="chat-actions"><button class="chat-action" onclick="editChatMessage(${m.id})">Modifier</button><button class="chat-action delete" onclick="removeItem('chat',${m.id})">Supprimer</button></div>`:""}</div>`;
  }).join("");
  list.scrollTop=list.scrollHeight;
}
window.editChatMessage=id=>{
  const message=state.chat.find(m=>String(m.id)===String(id));
  if(!message)return;
  const next=prompt("Modifier le message",message.text);
  if(next!==null&&next.trim()){message.text=next.trim();message.edited=true;save({title:"Message modifié",body:currentDisplayName+" : "+message.text})}
};

function renderHomeSummary(){
  const urgent=state.tasks.filter(t=>!t.done&&t.priority==="urgent").length;
  const shopping=state.shopping.filter(x=>!x.done).length;
  const upcoming=state.events.filter(e=>new Date(e.date+"T"+(e.time||"00:00"))>=new Date()).length;
  const home=state.home.filter(x=>!x.done).length;
  $("#urgentCount").textContent=urgent;$("#shoppingCount").textContent=shopping;$("#eventCount").textContent=upcoming;$("#homeCount").textContent=home;
  const d=new Date();$("#todayLabel").textContent=d.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});if($("#heroWeekday"))$("#heroWeekday").textContent=d.toLocaleDateString("fr-FR",{weekday:"long"});if($("#heroDay"))$("#heroDay").textContent=d.getDate();if($("#heroMonth"))$("#heroMonth").textContent=d.toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
  $("#helloText").textContent="Bonjour "+currentDisplayName;
  const feed=[];
  state.tasks.filter(x=>!x.done).slice(0,3).forEach(x=>feed.push(`<div class="item"><div class="grow"><div class="title">${esc(x.title)}</div><div class="meta">Tâche · ${esc(x.owner||"Nous deux")}</div></div><span class="badge ${x.priority==="urgent"?"urgent":""}">${esc(x.priority)}</span></div>`));
  state.events.slice(0,2).forEach(x=>feed.push(`<div class="item"><div class="grow"><div class="title">${esc(x.title)}</div><div class="meta">Planning · ${esc(x.date)} ${esc(x.time||"")}</div></div></div>`));
  $("#todayFeed").innerHTML=feed.length?feed.join(""):`<div class="empty card">Rien d'urgent pour le moment.</div>`;
}
function renderAll(){renderShopping();renderTasks();renderCalendar();renderEvents();renderHome();renderNotes();renderBuys();renderChat();renderHomeSummary()}
window.toggleItem=(type,id)=>{const i=state[type].find(x=>x.id===id);if(i){i.done=!i.done;save({title:i.done?"Élément terminé":"Élément rouvert",body:currentDisplayName+" : "+(i.title||"Mise à jour")})}};
window.removeItem=(type,id)=>{if(!confirm("Supprimer cet élément ?"))return;const removed=state[type].find(x=>String(x.id)===String(id));state[type]=state[type].filter(x=>String(x.id)!==String(id));save({title:"Élément supprimé",body:currentDisplayName+" : "+(removed?.title||removed?.text||"Mise à jour")})};

$("#addShoppingBtn").onclick=()=>{const v=$("#shoppingInput").value.trim();if(!v)return;state.shopping.unshift({id:uid(),title:v,done:false,store:"Courses"});$("#shoppingInput").value="";save({title:"Nouvelle course",body:currentDisplayName+" a ajouté : "+v})};
$("#shoppingInput").addEventListener("keydown",e=>{if(e.key==="Enter"){$("#addShoppingBtn").click()}});
$("#chatForm").onsubmit=e=>{e.preventDefault();const v=$("#chatInput").value.trim();if(!v)return;state.chat.push({id:uid(),from:currentDisplayName,userId:currentUser?.id||null,text:v,time:new Date().toISOString()});$("#chatInput").value="";save({title:"Message de "+currentDisplayName,body:v})};

const modal=$("#modal"), modalTitle=$("#modalTitle"), modalBody=$("#modalBody");
let modalType=null;
let editingId=null;
const collectionFor={task:"tasks",event:"events",home:"home",note:"notes",buy:"buys",shopping:"shopping"};
function openForm(type,item=null){
  modalType=type;
  editingId=item?.id??null;
  const forms={
    task:["Tâche",'<div class="field"><label>Tâche</label><input name="title" required></div><div class="field"><label>Responsable</label><select name="owner"><option>NASTX</option><option>Manon</option><option>Nous deux</option></select></div><div class="field"><label>Priorité</label><select name="priority"><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select></div>'],
    event:["Événement",'<div class="field"><label>Titre</label><input name="title" required></div><div class="field"><label>Date</label><input name="date" type="date" required></div><div class="field"><label>Heure</label><input name="time" type="time"></div>'],
    home:["Maison",'<div class="field"><label>Problème ou projet</label><input name="title" required></div><div class="field"><label>Catégorie</label><input name="category" placeholder="Plomberie, terrasse, jardin..."></div><div class="field"><label>Priorité</label><select name="priority"><option>normal</option><option>important</option><option>urgent</option></select></div>'],
    note:["Note",'<div class="field"><label>Titre</label><input name="title" required></div><div class="field"><label>Note</label><textarea name="text" rows="5"></textarea></div>'],
    buy:["Achat à prévoir",'<div class="field"><label>Article</label><input name="title" required></div><div class="field"><label>Prix estimé</label><input name="price" inputmode="decimal"></div><div class="field"><label>Priorité</label><select name="priority"><option>normal</option><option>important</option><option>urgent</option></select></div>'],
    shopping:["Course",'<div class="field"><label>Article</label><input name="title" required></div><div class="field"><label>Magasin ou catégorie</label><input name="store" value="Courses"></div>']
  };
  modalTitle.textContent=(item?"Modifier ":"Ajouter ")+forms[type][0].toLowerCase();
  modalBody.innerHTML=forms[type][1];
  if(item)Object.entries(item).forEach(([key,value])=>{const field=modalBody.querySelector('[name="'+key+'"]');if(field)field.value=value??""});
  modal.showModal();
}
window.editItem=(type,id)=>{
  const singular={tasks:"task",events:"event",home:"home",notes:"note",buys:"buy",shopping:"shopping"}[type];
  const item=state[type].find(x=>String(x.id)===String(id));
  if(item)openForm(singular,item);
};
$("#modalForm").addEventListener("submit",e=>{
  if(e.submitter?.value==="cancel"){editingId=null;return}
  e.preventDefault();
  const fd=Object.fromEntries(new FormData(e.currentTarget).entries());
  if(!fd.title?.trim())return;
  const key=collectionFor[modalType];
  const base={title:fd.title.trim()};
  const wasEditing=editingId!==null;
  if(modalType==="task")Object.assign(base,{owner:fd.owner,priority:fd.priority,done:false});
  if(modalType==="event")Object.assign(base,{date:fd.date,time:fd.time});
  if(modalType==="home")Object.assign(base,{category:fd.category||"Maison",priority:fd.priority,done:false});
  if(modalType==="note")Object.assign(base,{text:fd.text});
  if(modalType==="buy")Object.assign(base,{price:fd.price,priority:fd.priority});
  if(modalType==="shopping")Object.assign(base,{store:fd.store||"Courses",done:false});
  if(wasEditing){
    const existing=state[key].find(x=>String(x.id)===String(editingId));
    if(existing)Object.assign(existing,base);
  }else state[key].unshift({id:uid(),...base});
  const notificationLabel={task:"tâche",event:"événement",home:"élément Maison",note:"note",buy:"achat",shopping:"course"}[modalType]||"élément";
  editingId=null;
  modal.close();
  save({title:(wasEditing?"Modification : ":"Nouveau : ")+notificationLabel,body:currentDisplayName+" : "+base.title});
});

$$("[data-action]").forEach(b=>b.addEventListener("click",()=>{
  const a=b.dataset.action;
  if(a==="open-add")$("#quickAddModal").showModal();
  if(a==="add-task")openForm("task");
  if(a==="add-event")openForm("event");
  if(a==="add-home")openForm("home");
  if(a==="add-note")openForm("note");
  if(a==="add-buy")openForm("buy");
  if(["camera","budget","documents","pets","car","inventory","where"].includes(a))alert("Module prêt à être connecté dans la prochaine étape.");
}));
$("[data-close-quick]").onclick=()=>$("#quickAddModal").close();
$$("[data-quick]").forEach(b=>b.onclick=()=>{$("#quickAddModal").close();openForm(b.dataset.quick)});
if("serviceWorker" in navigator){navigator.serviceWorker.register("service-worker.js").catch(()=>{})}
renderAll();initSupabase();
