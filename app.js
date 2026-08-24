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
    el.style.cssText="position:fixed;top:12px;right:12px;z-index:90;padding:7px 11px;border-radius:999px;background:#eef2ff;color:#4338ca;font:700 12px system-ui;box-shadow:0 8px 24px #312e8122";
    el.textContent="Connexion…";
    document.body.appendChild(el);
  }
}
function setSyncStatus(text,error=false){
  ensureSyncUi();
  const el=document.getElementById("syncStatus");
  el.textContent=text;
  el.style.background=error?"#fff1f2":"#ecfdf5";
  el.style.color=error?"#be123c":"#047857";
}
function buildAuthGate(){
  if(document.getElementById("authGate"))return;
  const style=document.createElement("style");
  style.textContent="#authGate{position:fixed;inset:0;z-index:9999;background:linear-gradient(145deg,#eef2ff,#fff7ed 48%,#ecfeff);display:grid;place-items:center;padding:22px;font-family:system-ui}#authCard{width:min(430px,100%);background:#fff;border:1px solid #ffffffcc;border-radius:28px;padding:26px;box-shadow:0 24px 70px #312e8130}#authCard h2{margin:0 0 8px;font-size:28px;color:#172554}#authCard p{color:#64748b;line-height:1.45}#authCard label{display:block;margin:14px 0 6px;font-weight:700;color:#334155}#authCard input{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:14px;padding:13px;font-size:16px}#authSubmit{width:100%;margin-top:18px;border:0;border-radius:14px;padding:14px;background:linear-gradient(135deg,#4f46e5,#06b6d4);color:white;font-size:16px;font-weight:800}#authToggle{width:100%;margin-top:10px;border:0;background:transparent;color:#4f46e5;font-weight:750;padding:9px}#authMessage{min-height:22px;color:#be123c!important;font-weight:650}#authNameWrap{display:none}";
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

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const save=()=>{localStorage.setItem(stateKey,JSON.stringify(state));renderAll();queueRemoteSave()};
const uid=()=>Date.now()+Math.floor(Math.random()*999);
const esc=s=>(s??"").toString().replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));

function setScreen(name){
  $$(".screen").forEach(x=>x.classList.toggle("active",x.dataset.screen===name));
  $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.screenTarget===name));
  $("#pageTitle").textContent={home:"Accueil",us:"Nous",lists:"Listes",planning:"Planning"}[name]||"Maison";
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
    <button class="ghost" onclick="removeItem('shopping',${i.id})">Suppr.</button>
  </div>`).join(""):`<div class="empty card">Aucune course.</div>`;
}
function renderTasks(){
  $("#taskList").innerHTML=state.tasks.length?state.tasks.map(i=>`
  <div class="item ${i.done?"done":""}">
    <input class="check" type="checkbox" ${i.done?"checked":""} onchange="toggleItem('tasks',${i.id})">
    <div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.owner||"Nous deux")}</div></div>
    <span class="badge ${i.priority==="urgent"?"urgent":""}">${esc(i.priority||"normal")}</span>
  </div>`).join(""):`<div class="empty card">Aucune tâche.</div>`;
}
function renderEvents(){
  const events=[...state.events].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  $("#eventList").innerHTML=events.length?events.map(i=>`
  <div class="item"><div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.date)} ${esc(i.time||"")}</div></div><button class="ghost" onclick="removeItem('events',${i.id})">Suppr.</button></div>`).join(""):`<div class="empty card">Aucun événement.</div>`;
}
function renderHome(){
  $("#homeList").innerHTML=state.home.length?state.home.map(i=>`
  <div class="item ${i.done?"done":""}">
    <input class="check" type="checkbox" ${i.done?"checked":""} onchange="toggleItem('home',${i.id})">
    <div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.category||"Maison")}</div></div>
    <span class="badge">${esc(i.priority||"normal")}</span>
  </div>`).join(""):`<div class="empty card">Aucun sujet maison.</div>`;
}
function renderNotes(){
  $("#notesList").innerHTML=state.notes.length?state.notes.map(i=>`
  <div class="item"><div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.text||"")}</div></div><button class="ghost" onclick="removeItem('notes',${i.id})">Suppr.</button></div>`).join(""):`<div class="empty card">Aucune note.</div>`;
}
function renderBuys(){
  $("#buyList").innerHTML=state.buys.length?state.buys.map(i=>`
  <div class="item"><div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${i.price?esc(i.price)+" €":"Prix à comparer"}</div></div><span class="badge">${esc(i.priority||"normal")}</span></div>`).join(""):`<div class="empty card">Aucun achat prévu.</div>`;
}
function renderChat(){
  const list=$("#chatList");
  list.innerHTML=state.chat.map(m=>`<div class="bubble ${(m.userId&&currentUser&&m.userId===currentUser.id)||m.from===currentDisplayName?"me":""}"><div>${esc(m.text)}</div><div class="time">${new Date(m.time).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</div></div>`).join("");
  list.scrollTop=list.scrollHeight;
}
function renderHomeSummary(){
  const urgent=state.tasks.filter(t=>!t.done&&t.priority==="urgent").length;
  const shopping=state.shopping.filter(x=>!x.done).length;
  const upcoming=state.events.filter(e=>new Date(e.date+"T"+(e.time||"00:00"))>=new Date()).length;
  const home=state.home.filter(x=>!x.done).length;
  $("#urgentCount").textContent=urgent;$("#shoppingCount").textContent=shopping;$("#eventCount").textContent=upcoming;$("#homeCount").textContent=home;
  const d=new Date();$("#todayLabel").textContent=d.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  $("#helloText").textContent="Bonjour "+currentDisplayName;
  const feed=[];
  state.tasks.filter(x=>!x.done).slice(0,3).forEach(x=>feed.push(`<div class="item"><div class="grow"><div class="title">${esc(x.title)}</div><div class="meta">Tâche · ${esc(x.owner||"Nous deux")}</div></div><span class="badge ${x.priority==="urgent"?"urgent":""}">${esc(x.priority)}</span></div>`));
  state.events.slice(0,2).forEach(x=>feed.push(`<div class="item"><div class="grow"><div class="title">${esc(x.title)}</div><div class="meta">Planning · ${esc(x.date)} ${esc(x.time||"")}</div></div></div>`));
  $("#todayFeed").innerHTML=feed.length?feed.join(""):`<div class="empty card">Rien d'urgent pour le moment.</div>`;
}
function renderAll(){renderShopping();renderTasks();renderEvents();renderHome();renderNotes();renderBuys();renderChat();renderHomeSummary()}
window.toggleItem=(type,id)=>{const i=state[type].find(x=>x.id===id);if(i){i.done=!i.done;save()}};
window.removeItem=(type,id)=>{state[type]=state[type].filter(x=>x.id!==id);save()};

$("#addShoppingBtn").onclick=()=>{const v=$("#shoppingInput").value.trim();if(!v)return;state.shopping.unshift({id:uid(),title:v,done:false,store:"Courses"});$("#shoppingInput").value="";save()};
$("#shoppingInput").addEventListener("keydown",e=>{if(e.key==="Enter"){$("#addShoppingBtn").click()}});
$("#chatForm").onsubmit=e=>{e.preventDefault();const v=$("#chatInput").value.trim();if(!v)return;state.chat.push({id:uid(),from:currentDisplayName,userId:currentUser?.id||null,text:v,time:new Date().toISOString()});$("#chatInput").value="";save()};

const modal=$("#modal"), modalTitle=$("#modalTitle"), modalBody=$("#modalBody");
let modalType=null;
function openForm(type){
  modalType=type;
  const forms={
    task:["Nouvelle tâche",`<div class="field"><label>Tâche</label><input name="title" required></div><div class="field"><label>Responsable</label><select name="owner"><option>NASTX</option><option>Manon</option><option>Nous deux</option></select></div><div class="field"><label>Priorité</label><select name="priority"><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select></div>`],
    event:["Nouvel événement",`<div class="field"><label>Titre</label><input name="title" required></div><div class="field"><label>Date</label><input name="date" type="date" required></div><div class="field"><label>Heure</label><input name="time" type="time"></div>`],
    home:["Maison",`<div class="field"><label>Problème ou projet</label><input name="title" required></div><div class="field"><label>Catégorie</label><input name="category" placeholder="Plomberie, terrasse, jardin..."></div><div class="field"><label>Priorité</label><select name="priority"><option>normal</option><option>important</option><option>urgent</option></select></div>`],
    note:["Nouvelle note",`<div class="field"><label>Titre</label><input name="title" required></div><div class="field"><label>Note</label><textarea name="text" rows="5"></textarea></div>`],
    buy:["Achat à prévoir",`<div class="field"><label>Article</label><input name="title" required></div><div class="field"><label>Prix estimé</label><input name="price" inputmode="decimal"></div><div class="field"><label>Priorité</label><select name="priority"><option>normal</option><option>important</option><option>urgent</option></select></div>`],
    shopping:["Ajouter une course",`<div class="field"><label>Article</label><input name="title" required></div><div class="field"><label>Magasin ou catégorie</label><input name="store" value="Courses"></div>`]
  };
  modalTitle.textContent=forms[type][0];modalBody.innerHTML=forms[type][1];modal.showModal();
}
$("#modalForm").addEventListener("submit",e=>{
  if(e.submitter?.value==="cancel")return;
  e.preventDefault();
  const fd=Object.fromEntries(new FormData(e.currentTarget).entries());
  if(!fd.title?.trim())return;
  if(modalType==="task")state.tasks.unshift({id:uid(),title:fd.title,owner:fd.owner,priority:fd.priority,done:false});
  if(modalType==="event")state.events.unshift({id:uid(),title:fd.title,date:fd.date,time:fd.time});
  if(modalType==="home")state.home.unshift({id:uid(),title:fd.title,category:fd.category||"Maison",priority:fd.priority,done:false});
  if(modalType==="note")state.notes.unshift({id:uid(),title:fd.title,text:fd.text});
  if(modalType==="buy")state.buys.unshift({id:uid(),title:fd.title,price:fd.price,priority:fd.priority});
  if(modalType==="shopping")state.shopping.unshift({id:uid(),title:fd.title,store:fd.store||"Courses",done:false});
  modal.close();save();
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
