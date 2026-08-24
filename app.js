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
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const save=()=>{localStorage.setItem(stateKey,JSON.stringify(state));renderAll()};
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
  list.innerHTML=state.chat.map(m=>`<div class="bubble ${m.from==="NASTX"?"me":""}"><div>${esc(m.text)}</div><div class="time">${new Date(m.time).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</div></div>`).join("");
  list.scrollTop=list.scrollHeight;
}
function renderHomeSummary(){
  const urgent=state.tasks.filter(t=>!t.done&&t.priority==="urgent").length;
  const shopping=state.shopping.filter(x=>!x.done).length;
  const upcoming=state.events.filter(e=>new Date(e.date+"T"+(e.time||"00:00"))>=new Date()).length;
  const home=state.home.filter(x=>!x.done).length;
  $("#urgentCount").textContent=urgent;$("#shoppingCount").textContent=shopping;$("#eventCount").textContent=upcoming;$("#homeCount").textContent=home;
  const d=new Date();$("#todayLabel").textContent=d.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  $("#helloText").textContent="Bonjour NASTX";
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
$("#chatForm").onsubmit=e=>{e.preventDefault();const v=$("#chatInput").value.trim();if(!v)return;state.chat.push({id:uid(),from:"NASTX",text:v,time:new Date().toISOString()});$("#chatInput").value="";save()};

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
renderAll();
