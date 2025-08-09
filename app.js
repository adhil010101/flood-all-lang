/* app.js - main app logic */

/* ========== CONFIG ========== */
const GRAPH_HOPPER_KEY = '363c2df2-baa1-4e35-b1b9-9ceb7fc3eed1';
const ORS_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImViOTBkMjI4ZGUyNDRkMzg5MGU1ZWVkNjU0MDU0Y2MzIiwiaCI6Im11cm11cjY0In0=';
const OWM_KEY = 'ce70bf8bdb2bbf3ad192ee196735d6cf';
const VIEWBOX = '76.7,8.7,77.2,8.3'; // lon1,lat1,lon2,lat2
const ADMIN_USER = 'helix';
const ADMIN_SALT = '::saltv1';

/* ========== MAP INIT ========== */
const bounds = L.latLngBounds([8.3,76.7],[8.7,77.2]);
const map = L.map('map',{minZoom:11,maxZoom:18,maxBounds:bounds}).setView([8.5241,76.9366],13);
const baseTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19});
if(OWM_KEY) L.tileLayer(`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`,{opacity:0.55}).addTo(map);

/* ========== IndexedDB tiny wrapper ========== */
function openDB(name='floodDB',version=1){
  return new Promise((resolve,reject)=>{
    const rq = indexedDB.open(name,version);
    rq.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains('roads')) db.createObjectStore('roads',{keyPath:'id'});
      if(!db.objectStoreNames.contains('reports')) db.createObjectStore('reports',{keyPath:'id'});
    };
    rq.onsuccess = ()=> resolve(rq.result);
    rq.onerror = ()=> reject(rq.error);
  });
}
async function addRecord(store,obj){ const db = await openDB(); return new Promise((res,rej)=>{ const tx = db.transaction(store,'readwrite'); const os = tx.objectStore(store); const r = os.add(obj); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function putRecord(store,obj){ const db = await openDB(); return new Promise((res,rej)=>{ const tx = db.transaction(store,'readwrite'); const os = tx.objectStore(store); const r = os.put(obj); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function deleteRecord(store,key){ const db = await openDB(); return new Promise((res,rej)=>{ const tx = db.transaction(store,'readwrite'); const os = tx.objectStore(store); const r = os.delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
async function getAllRecords(store){ const db = await openDB(); return new Promise((res,rej)=>{ const tx = db.transaction(store,'readonly'); const os = tx.objectStore(store); const r = os.getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }

/* ========== HELPERS ========== */
function el(id){ return document.getElementById(id); }
function show(elm){ elm.classList.remove('hidden'); elm.style.display='block'; }
function hide(elm){ elm.classList.add('hidden'); elm.style.display='none'; }
function showAlert(txt, onClick){ const b = el('alertBanner'); b.innerText = txt; b.style.display='block'; if(onClick){ b.style.cursor='pointer'; b.onclick = ()=>{ onClick(); b.style.display='none'; } } else b.onclick=null; setTimeout(()=>{ try{ b.style.display='none'; }catch(e){} },8000); }
function hideAlert(){ const b = el('alertBanner'); b.style.display='none'; b.onclick=null; }
function genId(){ return 'id'+Math.random().toString(36).slice(2,9); }

/* ========== NOMINATIM SUGGESTIONS ========== */
async function nominatim(q, bounded=true){
  try{
    const viewboxParam = bounded ? `&viewbox=${VIEWBOX}&bounded=1` : '';
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6${viewboxParam}`;
    const r = await fetch(url, { headers:{ 'Accept-Language':'en' } });
    if(!r.ok) return [];
    return await r.json();
  }catch(e){ console.warn('nominatim err', e); return []; }
}
function positionSuggest(inputEl, boxEl){
  const rect = inputEl.getBoundingClientRect();
  boxEl.style.left = (rect.left + window.scrollX) + 'px';
  boxEl.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  boxEl.style.width = rect.width + 'px';
}
function attachSuggest(inputEl, boxEl){
  let timer=null;
  inputEl.addEventListener('input', ()=>{ clearTimeout(timer); const q=inputEl.value.trim(); if(!q){ hide(boxEl); boxEl.innerHTML=''; return; } timer=setTimeout(async ()=>{
    let list = await nominatim(q, true);
    // fallback to global if bounded returned nothing
    if(!list || list.length === 0) list = await nominatim(q, false);
    boxEl.innerHTML='';
    if(!list || list.length===0){ const d=document.createElement('div'); d.innerText='No results'; d.className='small muted'; boxEl.appendChild(d); }
    else {
      list.forEach(it=>{
        const div = document.createElement('div'); div.innerText = it.display_name; div.onclick = ()=>{ inputEl.value = it.display_name; inputEl._latlng = [parseFloat(it.lat), parseFloat(it.lon)]; hide(boxEl); boxEl.innerHTML=''; };
        boxEl.appendChild(div);
      });
    }
    positionSuggest(inputEl, boxEl); show(boxEl);
  }, 300); });
  inputEl.addEventListener('blur', ()=> setTimeout(()=>{ hide(boxEl); }, 200));
  window.addEventListener('resize', ()=>{ if(boxEl.style.display==='block') positionSuggest(inputEl, boxEl); });
  window.addEventListener('scroll', ()=>{ if(boxEl.style.display==='block') positionSuggest(inputEl, boxEl); });
}
attachSuggest(el('startInput'), el('startSuggest'));
attachSuggest(el('endInput'), el('endSuggest'));

/* ========== CURRENT LOCATION ========== */
let userPos=null, userMarker=null, userAccuracy=null;
function makeCurrentIcon(){
  const svg = `<div class="leaflet-current-icon">
    <div class="pulse-ring" style="width:36px;height:36px;border-radius:50%;"></div>
    <svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2 L15 11 L12 9 L9 11 Z" fill="#fff" stroke="#60A5FA" stroke-width="1"/>
      <circle cx="12" cy="15" r="2" fill="#60A5FA"/>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize:[36,36], iconAnchor:[18,18]});
}
if(navigator.geolocation){
  navigator.geolocation.watchPosition(p=>{
    userPos = [p.coords.latitude, p.coords.longitude];
    if(!userMarker){
      userMarker = L.marker(userPos, { icon: makeCurrentIcon(), zIndexOffset:1000 }).addTo(map).bindPopup('You are here');
    } else userMarker.setLatLng(userPos);
    if(userAccuracy) try{ map.removeLayer(userAccuracy);}catch(e){} userAccuracy = L.circle(userPos, { radius: p.coords.accuracy || 50, color:'#60A5FA', fillColor:'#60A5FA', fillOpacity:0.08 }).addTo(map);

    // small weather badge (inside left panel)
    if(OWM_KEY){
      fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${userPos[0]}&lon=${userPos[1]}&appid=${OWM_KEY}&units=metric`).then(r=>r.json()).then(w=>{
        let wb = el('weatherBadge'); if(!wb){ wb = document.createElement('div'); wb.id='weatherBadge'; wb.className='small muted'; el('leftPanel').appendChild(wb); }
        const rain = (w.rain && w.rain['1h']) ? ` · Rain(1h): ${w.rain['1h']}mm` : '';
        wb.innerHTML = `Weather: ${w.main.temp}°C · Hum ${w.main.humidity}%${rain}`;
      }).catch(()=>{});
    }
  }, e=>{ console.warn('geo err', e); }, { enableHighAccuracy:true, maximumAge:5000 });
}

/* ========== ROUTING ========== */
async function ghRoute(points){
  const base = 'https://graphhopper.com/api/1/route';
  const params = new URLSearchParams();
  points.forEach(p => params.append('point', `${p[0]},${p[1]}`));
  params.set('vehicle','car'); params.set('points_encoded','false'); params.set('instructions','false'); params.set('key', GRAPH_HOPPER_KEY);
  const url = base + '?' + params.toString();
  const r = await fetch(url);
  if(!r.ok){ const t = await r.text(); throw new Error('GH '+r.status+': '+t); }
  return r.json();
}
async function orsRoute(points, avoidMulti=null){
  const base = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
  const coords = points.map(pt => [pt[1], pt[0]]);
  const body = { coordinates: coords };
  if(avoidMulti) body.avoid_polygons = avoidMulti;
  const res = await fetch(base, { method:'POST', headers:{ 'Authorization': ORS_KEY, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  if(!res.ok){ const t = await res.text(); throw new Error('ORS '+res.status+': '+t); }
  return res.json();
}

/* ========== FLOODED ROADS storage & render ========= */
let roadsCache = [], roadLayers = {};
async function loadAndRenderRoads(){
  roadsCache = await getAllRecords('roads') || [];
  Object.values(roadLayers).forEach(l=>{ try{ map.removeLayer(l);}catch(e){} });
  roadLayers = {};
  roadsCache.forEach(r=>{
    const poly = L.polyline(r.coords, { color: getComputedStyle(document.documentElement).getPropertyValue('--danger') || '#ef4444', weight:5, dashArray:'8,8' }).addTo(map);
    poly.bindPopup('Flooded road (admin)');
    roadLayers[r.id] = poly;
  });
  renderApprovedList();
}

/* ========== GEO HELPERS ========== */
function pointToSegmentDistance(pt, A, B){
  const lat1=A[0]*Math.PI/180, lon1=A[1]*Math.PI/180;
  const lat2=B[0]*Math.PI/180, lon2=B[1]*Math.PI/180;
  const lat3=pt[0]*Math.PI/180, lon3=pt[1]*Math.PI/180;
  const R=6371000;
  const x1=R*lon1*Math.cos(lat1), y1=R*lat1;
  const x2=R*lon2*Math.cos(lat2), y2=R*lat2;
  const x3=R*lon3*Math.cos(lat3), y3=R*lat3;
  const dx=x2-x1, dy=y2-y1;
  if(dx===0 && dy===0) return Math.hypot(x3-x1,y3-y1);
  const t = ((x3-x1)*dx + (y3-y1)*dy) / (dx*dx + dy*dy);
  const tt = Math.max(0, Math.min(1, t));
  const xc = x1 + dx*tt, yc = y1 + dy*tt;
  return Math.hypot(x3-xc, y3-yc);
}
function circleToPolygon(center, radiusMeters=30, steps=12){
  const lat=center[0], lon=center[1];
  const R=6378137;
  const coords=[];
  for(let i=0;i<steps;i++){
    const brng = (i*(360/steps))*Math.PI/180;
    const lat2 = Math.asin(Math.sin(lat*Math.PI/180)*Math.cos(radiusMeters/R) + Math.cos(lat*Math.PI/180)*Math.sin(radiusMeters/R)*Math.cos(brng));
    const lon2 = (lon*Math.PI/180) + Math.atan2(Math.sin(brng)*Math.sin(radiusMeters/R)*Math.cos(lat*Math.PI/180), Math.cos(radiusMeters/R)-Math.sin(lat*Math.PI/180)*Math.sin(lat2));
    coords.push([ lon2*180/Math.PI, lat2*180/Math.PI ]);
  }
  coords.push(coords[0]);
  return [ coords ];
}
function buildAvoidMultiFromRoads(roadArray){
  const multi = { type:'MultiPolygon', coordinates: [] };
  roadArray.forEach(r=>{
    r.coords.forEach(pt=>{
      const poly = circleToPolygon(pt, 35, 12);
      multi.coordinates.push(poly[0]);
    });
  });
  return multi;
}

/* ========== ROUTE UI ========== */
let mainRouteLayer=null, altRouteLayer=null, dangerLayers=[];
function clearRouteGraphics(){
  if(mainRouteLayer) try{ map.removeLayer(mainRouteLayer);}catch(e){}
  if(altRouteLayer) try{ map.removeLayer(altRouteLayer);}catch(e){}
  dangerLayers.forEach(l=>{ try{ map.removeLayer(l);}catch(e){} });
  dangerLayers=[];
  hideAlert();
  el('takeSafeBtn').style.display='none';
  el('routeInfo').innerText='';
}
function animateDash(layer, speed=90){
  let off=0; const id = setInterval(()=>{ off=(off+1)%100; try{ layer.setStyle({ dashOffset:String(off) }); }catch(e){} }, speed);
  layer._ani = id; return id;
}
function drawAnimatedPolyline(points, opts){
  const pl = L.polyline(points, opts).addTo(map);
  animateDash(pl, 85);
  return pl;
}
function decorateArrows(poly, color){
  try{ return L.polylineDecorator(poly, { patterns:[{ offset:'6%', repeat:'10%', symbol: L.Symbol.arrowHead({ pixelSize:10, polygon:false, pathOptions:{ stroke:true, weight:2, color } }) }] }).addTo(map); }catch(e){ return null; }
}
function detectFloodHits(routeCoords){
  const hits = [];
  roadsCache.forEach(road=>{
    let seg=null;
    routeCoords.forEach(pt=>{
      let near=false;
      for(let j=0;j<road.coords.length-1;j++){
        if(pointToSegmentDistance(pt, road.coords[j], road.coords[j+1]) < 25){ near=true; break; }
      }
      if(near){ if(!seg) seg=[]; seg.push(pt); } else { if(seg){ hits.push({road, seg}); seg=null; } }
    });
    if(seg) hits.push({road, seg});
  });
  return hits;
}

async function calculateAndShow(){
  try{
    clearRouteGraphics();
    showAlert('Loading route — please wait...');
    const sVal = el('startInput').value.trim();
    const eVal = el('endInput').value.trim();
    if(!sVal || !eVal){ alert('Enter start and destination'); hideAlert(); return; }
    const start = await resolvePlace(sVal, el('startInput'));
    const dest = await resolvePlace(eVal, el('endInput'));
    if(!start || !dest){ alert('Could not resolve places; try typing a nearby landmark or coordinates'); hideAlert(); return; }

    // try GH then ORS
    let coords=[], mainInfo='';
    try{
      const g = await ghRoute([start,dest]);
      coords = g.paths[0].points.coordinates.map(c=>[c[1],c[0]]);
      mainInfo = `Main: ${(g.paths[0].distance/1000).toFixed(2)} km · ${(g.paths[0].time/60000).toFixed(1)} min`;
    }catch(e){
      console.warn('GH fail', e);
      try{
        const o = await orsRoute([start,dest]);
        coords = o.features[0].geometry.coordinates.map(c=>[c[1],c[0]]);
        const s = o.features[0].properties.summary || {};
        mainInfo = `Main: ${(s.distance/1000||0).toFixed(2)} km · ${((s.duration||0)/60).toFixed(1)} min`;
      }catch(er){
        console.error('Routing failed', er);
        alert('Route fetch failed — check API keys & network (see console)');
        hideAlert(); return;
      }
    }

    mainRouteLayer = L.polyline(coords, { color:'#1e40af', weight:6 }).addTo(map);
    decorateArrows(mainRouteLayer, '#1e40af'); animateDash(mainRouteLayer,120);
    map.fitBounds(mainRouteLayer.getBounds(), { padding:[80,80] });
    el('routeInfo').innerText = mainInfo;

    const hits = detectFloodHits(coords);
    if(hits.length>0){
      hits.forEach(h=>{ const l = drawAnimatedPolyline(h.seg,{ color:'#ef4444', weight:6, dashArray:'10,8' }); dangerLayers.push(l); });
      showAlert('⚠️ Flooded road detected — click here to generate safe alternate', ()=> generateSafeAlternate(coords, start, dest));
      el('takeSafeBtn').style.display='inline-block';
      el('takeSafeBtn').onclick = ()=> generateSafeAlternate(coords, start, dest);
    } else {
      el('routeInfo').innerText += ' · No flooded roads on route';
      hideAlert();
    }
  }catch(e){ console.error('calculate error', e); alert('Route calculation error'); hideAlert(); }
}

async function generateSafeAlternate(routeCoords, start, dest){
  try{
    showAlert('Generating safe alternate — please wait...');
    const hits = detectFloodHits(routeCoords);
    const affectedIds = Array.from(new Set(hits.map(h=>h.road.id)));
    const affected = affectedIds.map(id=> roadsCache.find(r=>r.id===id)).filter(Boolean);
    if(affected.length===0){ alert('No affected roads found'); hideAlert(); return; }
    const avoidMulti = buildAvoidMultiFromRoads(affected);

    try{
      const or = await orsRoute([start,dest], avoidMulti);
      const altCoords = or.features[0].geometry.coordinates.map(c=>[c[1],c[0]]);
      if(altRouteLayer) try{ map.removeLayer(altRouteLayer);}catch(e){}
      altRouteLayer = L.polyline(altCoords, { color:getComputedStyle(document.documentElement).getPropertyValue('--safe') || '#60A5FA', weight:6 }).addTo(map);
      animateDash(altRouteLayer, 100); decorateArrows(altRouteLayer, getComputedStyle(document.documentElement).getPropertyValue('--safe') || '#60A5FA');
      map.fitBounds(altRouteLayer.getBounds(), { padding:[80,80] });
      el('routeInfo').innerText += ' · Safe alternate shown';
      hideAlert();
      el('takeSafeBtn').onclick = ()=>{ if(mainRouteLayer) try{ map.removeLayer(mainRouteLayer);}catch(e){} mainRouteLayer=null; if(altRouteLayer) altRouteLayer.setStyle({ color:'#3b82f6', weight:7 }); hideAlert(); };
      return;
    }catch(e){
      console.warn('ORS avoid failed', e);
      // fallback simple detour
      const hit = hits[0]; const mid = hit.seg[Math.floor(hit.seg.length/2)];
      const meters = 220; const dLat = meters/111000;
      const left = [ mid[0] + dLat, mid[1] - dLat ]; const right = [ mid[0] - dLat, mid[1] + dLat ];
      const candidates = [ [start, left, dest], [start, right, dest] ];
      let best=null;
      for(const pts of candidates){
        try{
          const g = await ghRoute(pts);
          if(g.paths && g.paths.length>0){
            const c = g.paths[0].points.coordinates.map(cc=>[cc[1],cc[0]]);
            const t = g.paths[0].time;
            if(!best || t < best.time) best = { coords:c, time:t };
          }
        }catch(err){ console.warn('GH detour err', err); }
      }
      if(best){
        if(altRouteLayer) try{ map.removeLayer(altRouteLayer);}catch(e){}
        altRouteLayer = L.polyline(best.coords, { color:getComputedStyle(document.documentElement).getPropertyValue('--safe') || '#60A5FA', weight:6 }).addTo(map);
        animateDash(altRouteLayer,100); decorateArrows(altRouteLayer, getComputedStyle(document.documentElement).getPropertyValue('--safe') || '#60A5FA');
        map.fitBounds(altRouteLayer.getBounds(), { padding:[80,80] });
        el('routeInfo').innerText += ' · Safe alternate (detour) shown';
        hideAlert();
        return;
      }
      throw new Error('No alternate found');
    }
  }catch(e){ console.error('generate alt error', e); alert('Could not generate safe alternate'); hideAlert(); }
}

/* ========== REPORTING FLOW ========== */
let reportPickMode=false, reportPoints=[], tempPreview=null;
el('reportBtn').addEventListener('click', ()=>{ el('reportModal').classList.remove('hidden'); el('reportModal').style.display='flex'; reportPickMode=false; reportPoints=[]; clearTempPreview(); });
el('closeReportBtn').addEventListener('click', ()=>{ el('reportModal').classList.add('hidden'); el('reportModal').style.display='none'; reportPickMode=false; reportPoints=[]; clearTempPreview(); });
el('pickOnMapBtn').addEventListener('click', ()=>{ alert('Click START then END on map (two clicks).'); reportPickMode=true; reportPoints=[]; clearTempPreview(); });

map.on('click', async (e)=>{
  if(reportPickMode){
    if(reportPoints.length===0){
      reportPoints[0] = [e.latlng.lat, e.latlng.lng];
      tempPreview = L.marker(reportPoints[0]).addTo(map);
      alert('Start set. Now
