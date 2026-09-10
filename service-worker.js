const CACHE="nous-deux-v15";
const ASSETS=[
  "./",
  "./index.html",
  "./app.css?v=14",
  "./app.js?v=14",
  "./manifest.json",
  "./icon.svg",
  "./config.js",
  "./location.html",
  "./location.css?v=3",
  "./location.js?v=3"
];

self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  const isLocationAsset=url.origin===self.location.origin && /\/location\.(html|css|js)$/.test(url.pathname);
  if(isLocationAsset){
    event.respondWith(
      fetch(event.request,{cache:"no-store"})
        .then(response=>{
          if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
          return response;
        })
        .catch(()=>caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then(response=>{
        if(response.ok&&url.origin===self.location.origin){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        }
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});
self.addEventListener("push",event=>{
  let data={title:"Nous Deux",body:"Nouvelle activité partagée",url:"/APP-MANON-JB/"};
  try{if(event.data)data={...data,...event.data.json()}}catch{}
  event.waitUntil(self.registration.showNotification(data.title,{
    body:data.body,
    tag:"nous-deux-"+Date.now(),
    data:{url:data.url},
    vibrate:[120,60,120]
  }));
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"/APP-MANON-JB/",self.location.origin).href;
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(openClients=>{
    const existing=openClients.find(client=>client.url.startsWith(self.location.origin+"/APP-MANON-JB/"));
    if(existing){existing.navigate(target);return existing.focus()}
    return clients.openWindow(target);
  }));
});
