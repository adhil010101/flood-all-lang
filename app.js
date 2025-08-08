/* app.js - main app logic (separated) */
/* Put this file alongside index.html and styles.css */

/* ========== CONFIG ========== */
const GRAPH_HOPPER_KEY = '363c2df2-baa1-4e35-b1b9-9ceb7fc3eed1';
const ORS_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImViOTBkMjI4ZGUyNDRkMzg5MGU1ZWVkNjU0MDU0Y2MzIiwiaCI6Im11cm11cjY0In0=';
const OWM_KEY = 'ce70bf8bdb2bbf3ad192ee196735d6cf';
const VIEWBOX = '76.7,8.7,77.2,8.3';
const ADMIN_USER = 'admin';
const ADMIN_SALT = '::saltv1'; // used for client-side hashing

/* ========== MAP INIT ========== */
const bounds = L.latLngBounds([8.3,76.7],[8.7,77.2]);
const map = L.map('map',{minZoom:11,maxZoom:18,maxBounds:bounds}).setView([8.5241,76.9366],13);
const baseTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19});
if(OWM_KEY) L.tileLayer(`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`,{opacity:0.6}).addTo(map);

/* ========== SIMPLE IndexedDB wrapper ========== */
function openDB(name='floodDB', version=1){
  return new Promise((resolve,reject)=>{
    const rq = indexedDB.open(name, version);
    rq.onupgradeneeded = (ev)=>{
      const db = ev.target.result;
      if(!db.objectStoreNames.contains('roads')) db.createObjectStore('roads',{keyPath:'id'});
      if(!db.objectStoreNames.contains('reports')) db.createObjectStore('reports',{keyPath:'id'});
    };
    rq.onsuccess = ()=> resolve(rq.result);
    rq.onerror = ()=> reject(rq.error);
  });
}
async function addRecord(store, obj){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const rq = os.add(obj);
    rq.onsuccess = ()=> resolve(rq.result);
    rq.onerror = ()=> reject(rq.error);
  });
}
async function putRecord(store, obj){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const rq = os.put(obj);
    rq.onsuccess = ()=> resolve(rq.result);
    rq.onerror = ()=> reject(rq.error);
  });
}
async function deleteRecord(store, key){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const rq = os.delete(key);
    rq.onsuccess = ()=> resolve();
    rq.onerror = ()=> reject(rq.error);
  });
}
async function getAllRecords(store){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    const rq = os.getAll();
    rq.onsuccess = ()=> resolve(rq.result);
    rq.onerror = ()=> reject(rq.error);
  });
}

/* ========== UTILS ========== */
function genId(){ return 'id'+Math.random().toString(36).slice(2,9); }
function el(id){ return document.getElementById(id); }
function show(elm){ elm.classList.remove('hidden'); }
function hide(elm){ elm.classList.add('hidden'); }
function infoBanner(text, onclick){
  const b = el('alertBanner'); b.innerText = text; b.style.background='linear-gradient(90deg,#ef4444,#f43f5e)'; show(b);
  if(onclick){ b.style.cursor='pointer'; b.onclick = ()=>{ onclick(); b.style.display='none'; } } else b.onclick = null;
  setTimeout(()=>{ try{ b.style.display='none'; }catch(e){} }, 9000);
}
function clearBanner(){ const b = el('alertBanner'); b.style.display='none'; b.onclick = null; }

/* ========== NOMINATIM SUGGESTIONS ========= */
async function nominatim(q){
  try{
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&viewbox=${VIEWBOX}&bounded=1`;
    const r = await fetch(url);
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
    const list = await nominatim(q);
    boxEl.innerHTML='';
    if(!list || list.length===0){ const d=document.createElement('div'); d.innerText='No results (Trivandrum)'; d.className='small muted'; boxEl.appendChild(d); }
    list.forEach(it=>{
      const div = document.createElement('div'); div.innerText = it.display_name; div.onclick = ()=>{ inputEl.value = it.display_name; inputEl._latlng = [parseFloat(it.lat), parseFloat(it.lon)]; hide(boxEl); boxEl.innerHTML=''; };
      boxEl.appendChild(div);
    });
    positionSuggest(inputEl, boxEl); show(boxEl);
  }, 300); });
  inputEl.addEventListener('blur', ()=> setTimeout(()=>{ hide(boxEl); }, 200));
  window.addEventListener('resize', ()=>{ if(!boxEl.classList.contains('hidden')) positionSuggest(inputEl, boxEl); });
  window.addEventListener('scroll', ()=>{ if(!boxEl.classList.contains('hidden')) positionSuggest(inputEl, boxEl); });
}
attachSuggest(el('startInput'), el('startSuggest'));
attachSuggest(el('endInput'), el('endSuggest'));

/* ========== CURRENT LOCATION + WEATHER ========== */
let userPos = null, userMarker = null;
if(navigator.geolocation){
  navigator.geolocation.watchPosition(p=>{
    userPos = [p.coords.latitude, p.coords.longitude];
    if(!userMarker) userMarker = L.circleMarker(userPos, { radius:8, fillColor:'#06b6d4', color:'#fff', weight:2 }).addTo(map).bindPopup('You are here');
    else userMarker.setLatLng(userPos);
    // weather
    fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${userPos[0]}&lon=${userPos[1]}&appid=${OWM_KEY}&units=metric`)
      .then(r=>r.json()).then(w=>{
        const badge = el('weatherBadge'); badge.innerHTML = `<b>Weather</b><br>${w.main.temp}°C · Hum ${w.main.humidity}%${(w.rain && w.rain['1h'])?(' · Rain(1h): '+w.rain['1h']+'mm'):''}`; show(badge);
      }).catch(()=>{});
  }, e=>{ console.warn('geo err', e); }, { enableHighAccuracy:true, maximumAge:5000 });
}

/* ========== ROUTING HELPERS ========== */
async function ghRoute(points){
  const base = 'https://graphhopper.com/api/1/route';
  const p = new URLSearchParams();
  points.forEach(pt=> p.append('point', `${pt[0]},${pt[1]}`));
  p.set('vehicle','car'); p.set('points_encoded','false'); p.set('instructions','false'); p.set('key', GRAPH_HOPPER_KEY);
  const url = base + '?' + p.toString();
  const res = await fetch(url);
  if(!res.ok) throw new Error('GH:'+res.status);
  return res.json();
}
async function orsRoute(points, avoidMulti=null){
  const base = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
  const coords = points.map(pt => [pt[1], pt[0]]);
  const body = { coordinates: coords };
  if(avoidMulti) body.avoid_polygons = avoidMulti;
  const res = await fetch(base, { method: 'POST', headers: { 'Authorization': ORS_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if(!res.ok) { const txt = await res.text(); throw new Error('ORS:'+res.status + ' ' + txt); }
  return res.json();
}

/* ========== FLOODED ROADS (storage & render) ========== */
let roadsCache = [], roadLayers = {};
async function loadAndRenderRoads(){
  roadsCache = await getAllRecords('roads') || [];
  Object.values(roadLayers).forEach(l=>{ try{ map.removeLayer(l); } catch(e){} });
  roadLayers = {};
  roadsCache.forEach(r=>{
    const poly = L.polyline(r.coords, { color: getComputedStyle(document.documentElement).getPropertyValue('--danger') || '#ef4444', weight:5, dashArray:'8,8' }).addTo(map);
    poly.bindPopup('Flooded road (admin)');
    roadLayers[r.id] = poly;
  });
  renderRoadsListAdmin();
}
function renderRoadsListAdmin(){
  const container = el('roadsList'); if(!container) return;
  container.innerHTML = '';
  roadsCache.forEach(r=>{
    const row = document.createElement('div'); row.className='muted small'; row.style.padding='8px'; row.style.borderBottom='1px solid rgba(255,255,255,0.03)';
    row.innerHTML = `<b>Road</b> — ${r.coords.length} pts`;
    const rm = document.createElement('button'); rm.className='smallBtn'; rm.style.float='right'; rm.style.background='#b91c1c'; rm.innerText='Remove';
    rm.onclick = async ()=>{ await deleteRecord('roads', r.id); await loadAndRenderRoads(); alert('Removed'); };
    row.appendChild(rm); container.appendChild(row);
  });
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

/* build small circle polygon around a point (lon,lat order for ORS) */
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

/* ========== ROUTING & AVOIDANCE ========== */
let mainRouteLayer=null, altRouteLayer=null, floodedLayers=[];
function clearRouteGraphics(){
  if(mainRouteLayer) try{ map.removeLayer(mainRouteLayer); }catch(e){}
  if(altRouteLayer) try{ map.removeLayer(altRouteLayer); }catch(e){}
  floodedLayers.forEach(l=>{ try{ map.removeLayer(l); }catch(e){} });
  floodedLayers=[];
  clearBanner();
  hide(el('takeSafeBtn'));
  el('routeInfo').innerText = '';
}
function animateDash(layer, speed=90){
  let off=0; const id = setInterval(()=>{ off=(off+1)%100; try{ layer.setStyle({ dashOffset:String(off) }); }catch(e){} }, speed);
  layer._ani = id; return id;
}
function drawAnimatedPolyline(points, opts){
  const pl = L.polyline(points, opts).addTo(map);
  animateDash(pl, 90);
  return pl;
}
function decorateArrows(poly, color){
  try{ return L.polylineDecorator(poly, { patterns:[{ offset:'6%', repeat:'10%', symbol: L.Symbol.arrowHead({ pixelSize:10, polygon:false, pathOptions:{ stroke:true, weight:2, color } }) }] }).addTo(map); } catch(e){ return null; }
}

/* find intersections of route coords with flooded roads */
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

/* route UI: request main route (GH primary, ORS fallback), show route, detect flooded roads */
async function calculateAndShow(){
  try{
    clearRouteGraphics();
    infoBanner('Loading route — please wait...');
    const sVal = el('startInput').value.trim();
    const eVal = el('endInput').value.trim();
    if(!sVal || !eVal){ alert('Enter start and destination'); clearBanner(); return; }
    const start = await resolvePlace(sVal, el('startInput'));
    const dest = await resolvePlace(eVal, el('endInput'));
    if(!start || !dest){ alert('Could not resolve places'); clearBanner(); return; }

    // try GH first
    let coords = [], mainInfoText = '';
    try{
      const g = await ghRoute([start, dest]);
      coords = g.paths[0].points.coordinates.map(c=>[c[1], c[0]]);
      mainInfoText = `Main: ${(g.paths[0].distance/1000).toFixed(2)} km · ${(g.paths[0].time/60000).toFixed(1)} min`;
    }catch(e){
      console.warn('GH primary failed', e);
      try{
        const o = await orsRoute([start, dest]);
        coords = o.features[0].geometry.coordinates.map(c=>[c[1],c[0]]);
        const s = o.features[0].properties.summary || {};
        mainInfoText = `Main: ${(s.distance/1000||0).toFixed(2)} km · ${((s.duration||0)/60).toFixed(1)} min`;
      }catch(er){
        console.error('Both routing failed', er);
        alert('Route fetch failed — check API keys & network (see console)');
        clearBanner();
        return;
      }
    }

    mainRouteLayer = L.polyline(coords, { color:'#1e40af', weight:6 }).addTo(map);
    decorateArrows(mainRouteLayer, '#1e40af');
    animateDash(mainRouteLayer, 120);
    map.fitBounds(mainRouteLayer.getBounds(), { padding:[80,80] });
    el('routeInfo').innerText = mainInfoText;

    // detect flooded hits
    const hits = detectFloodHits(coords);
    if(hits.length > 0){
      hits.forEach(h=>{
        const l = drawAnimatedPolyline(h.seg, { color: '#ef4444', weight:6, dashArray:'10,8' });
        floodedLayers.push(l);
      });
      infoBanner('⚠️ Flooded road detected — click here to generate safe alternate', ()=> generateSafeAlternate(coords, start, dest));
      show(el('takeSafeBtn'));
      el('takeSafeBtn').onclick = ()=> generateSafeAlternate(coords, start, dest);
    } else {
      el('routeInfo').innerText += ' · No flooded roads on route';
      clearBanner();
    }
  }catch(e){ console.error(e); alert('Route calculation error'); clearBanner(); }
}

/* build avoid multipolygon from affected roads and call ORS avoid_polygons to get safe alt */
async function generateSafeAlternate(routeCoords, start, dest){
  try{
    infoBanner('Generating safe alternate — please wait...');
    const hits = detectFloodHits(routeCoords);
    const affectedRoadsIds = Array.from(new Set(hits.map(h=>h.road.id)));
    const affected = affectedRoadsIds.map(id => roadsCache.find(r=>r.id===id)).filter(Boolean);
    if(affected.length === 0){ alert('No affected roads found'); clearBanner(); return; }
    const avoidMulti = buildAvoidMultiFromRoads(affected);

    // try ORS with avoid_polygons
    try{
      const or = await orsRoute([start, dest], avoidMulti);
      const altCoords = or.features[0].geometry.coordinates.map(c=>[c[1],c[0]]);
      if(altRouteLayer) try{ map.removeLayer(altRouteLayer);}catch(e){}
      altRouteLayer = L.polyline(altCoords, { color: getComputedStyle(document.documentElement).getPropertyValue('--safe') || '#28c76f', weight:6 }).addTo(map);
      animateDash(altRouteLayer, 100); decorateArrows(altRouteLayer, getComputedStyle(document.documentElement).getPropertyValue('--safe') || '#28c76f');
      map.fitBounds(altRouteLayer.getBounds(), { padding:[80,80] });
      el('routeInfo').innerText += ' · Safe alternate (ORS avoid) shown';
      clearBanner();
      // take safe route behavior
      el('takeSafeBtn').onclick = ()=> { if(mainRouteLayer) try{ map.removeLayer(mainRouteLayer);}catch(e){} mainRouteLayer=null; if(altRouteLayer) altRouteLayer.setStyle({ color:'#16a34a', weight:7 }); clearBanner(); };
      return;
    }catch(e){
      console.warn('ORS avoid failed, fallback to GH detour', e);
      // fallback — compute simple left/right offset detour around mid of first hit
      const hit = hits[0];
      const mid = hit.seg[Math.floor(hit.seg.length/2)];
      const meters = 220;
      const dLat = meters/111000;
      const left = [ mid[0] + dLat, mid[1] - dLat ];
      const right = [ mid[0] - dLat, mid[1] + dLat ];
      const candidates = [ [start, left, dest], [start, right, dest] ];
      let best = null;
      for(const pts of candidates){
        try{
          const g = await ghRoute(pts);
          if(g.paths && g.paths.length>0){
            const coords = g.paths[0].points.coordinates.map(c=>[c[1],c[0]]);
            const time = g.paths[0].time;
            if(!best || time < best.time) best = { coords, time };
          }
        }catch(err){ console.warn('GH detour fail', err); }
      }
      if(best){
        if(altRouteLayer) try{ map.removeLayer(altRouteLayer);}catch(e){}
        altRouteLayer = L.polyline(best.coords, { color:getComputedStyle(document.documentElement).getPropertyValue('--safe') || '#28c76f', weight:6 }).addTo(map);
        animateDash(altRouteLayer, 100);
        decorateArrows(altRouteLayer, getComputedStyle(document.documentElement).getPropertyValue('--safe') || '#28c76f');
        map.fitBounds(altRouteLayer.getBounds(), { padding:[80,80] });
        el('routeInfo').innerText += ' · Safe alternate (detour) shown';
        clearBanner();
        return;
      }
      throw new Error('No alternate found');
    }
  }catch(e){ console.error('generateSafeAlternate err', e); alert('Could not generate safe alternate'); clearBanner(); }
}

/* ========== REPORTING FLOW (pick on map) ========== */
let reportPickMode = false, reportPoints = [], tempPreview = null;
el('reportBtn').addEventListener('click', ()=>{ show(el('reportModal')); reportPickMode=false; reportPoints=[]; clearTempPreview(); });
el('closeReportBtn').addEventListener('click', ()=>{ hide(el('reportModal')); reportPickMode=false; reportPoints=[]; clearTempPreview(); });

el('pickRoadBtn').addEventListener('click', ()=> {
  hide(el('reportModal'));
  reportPickMode = true;
  reportPoints = [];
  clearTempPreview();
  alert('Pick START then END on the map (two clicks). After second click, the Finish button appears.');
});

map.on('click', async function(e){
  // admin drawing handled separately below
  if(reportPickMode){
    if(reportPoints.length === 0){
      reportPoints[0] = [e.latlng.lat, e.latlng.lng];
      tempPreview = L.marker(reportPoints[0]).addTo(map);
      alert('Start set. Now click END point.');
    } else if(reportPoints.length === 1){
      reportPoints[1] = [e.latlng.lat, e.latlng.lng];
      if(tempPreview) try{ map.removeLayer(tempPreview);}catch(e){}
      tempPreview = L.polyline(reportPoints, { color:'#f97316', weight:4, dashArray:'6,6' }).addTo(map);
      reportPickMode = false;
      show(el('mapFinishBtn'));
      alert('END set. Click Finish Report to submit.');
    }
  }
});

el('mapFinishBtn').addEventListener('click', async ()=>{
  let coords = null;
  const val = el('reportInput').value.trim();
  if(val){
    const parts = val.split(';').map(s=>s.trim()).filter(Boolean);
    if(parts.length >= 2){
      coords = parts.slice(0,2).map(p=>{
        const m = p.match(/(-?\d+(\.\d+)?)\s*[,;]\s*(-?\d+(\.\d+)?)/);
        return [parseFloat(m[1]), parseFloat(m[3])];
      });
    }
  }
  if(!coords && reportPoints.length === 2) coords = reportPoints.slice();
  if(!coords || coords.length < 2){ alert('Select points or paste coords first'); return; }
  const rep = { id: genId(), type:'road', coords, text:'user-report', time: Date.now(), status:'pending' };
  await addRecord('reports', rep);
  alert('Report submitted to admin for review');
  clearTempPreview();
  hide(el('mapFinishBtn'));
});

/* helper */
function clearTempPreview(){ if(tempPreview) try{ map.removeLayer(tempPreview);}catch(e){} tempPreview=null; reportPoints=[]; reportPickMode=false; el('reportInput').value=''; }

/* ========== ADMIN (client-side hashed password) ========== */
async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const h = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function ensureAdminHash(){
  if(!localStorage.getItem('flood_admin_hash')){
    const h = await sha256Hex('StrongP@ssw0rd!' + ADMIN_SALT);
    localStorage.setItem('flood_admin_hash', h);
  }
}
async function checkAdminLogin(user, pass){
  const stored = localStorage.getItem('flood_admin_hash');
  if(!stored) return false;
  const hh = await sha256Hex(pass + ADMIN_SALT);
  return user === ADMIN_USER && hh === stored;
}
async function changeAdminPasswordFlow(){
  const cur = prompt('Enter current admin password:');
  if(!cur) return;
  const ok = await checkAdminLogin(ADMIN_USER, cur);
  if(!ok){ alert('Current password wrong'); return; }
  const nw = prompt('Enter new strong password (min 8 chars):');
  if(!nw || nw.length < 8) { alert('Password too short'); return; }
  const nh = await sha256Hex(nw + ADMIN_SALT);
  localStorage.setItem('flood_admin_hash', nh);
  alert('Password changed');
}

/* admin login wiring */
el('adminLoginBtn').addEventListener('click', async ()=>{
  const u = el('adminUser').value.trim() || ADMIN_USER;
  const p = el('adminPass').value;
  if(await checkAdminLogin(u, p)){
    show(el('adminTools'));
    await refreshAdminLists();
    await loadAndRenderRoads();
    alert('Admin logged in');
  } else alert('Wrong credentials');
});
el('adminChangePassBtn').addEventListener('click', changeAdminPasswordFlow);

/* admin reports UI */
async function refreshAdminLists(){
  const reps = await getAllRecords('reports') || [];
  const list = el('reportsList'); list.innerHTML = '';
  if(reps.length === 0){ list.innerHTML = '<div class="small muted">No pending reports</div>'; return; }
  reps.forEach(r=>{
    if(r.status && r.status !== 'pending') return;
    const div = document.createElement('div'); div.style.padding='8px'; div.style.borderBottom='1px solid rgba(255,255,255,0.03)';
    div.innerHTML = `<b>Road report</b><br><small>${new Date(r.time).toLocaleString()}</small>`;
    const preview = document.createElement('button'); preview.className='smallBtn'; preview.style.marginLeft='8px'; preview.innerText='Preview';
    preview.onclick = ()=> { if(window._preview) try{ map.removeLayer(window._preview);}catch(e){} window._preview = L.polyline(r.coords, { color:'#f97316', weight:5, dashArray:'6,6' }).addTo(map); map.fitBounds(window._preview.getBounds(), { padding:[60,60] }); };
    const approve = document.createElement('button'); approve.className='smallBtn'; approve.style.marginLeft='8px'; approve.style.background='#16a34a'; approve.innerText='Approve';
    approve.onclick = async ()=>{ await addRecord('roads', { id: genId(), coords: r.coords }); await deleteRecord('reports', r.id); await loadAndRenderRoads(); await refreshAdminLists(); alert('Approved'); };
    const reject = document.createElement('button'); reject.className='smallBtn'; reject.style.marginLeft='8px'; reject.style.background='#b91c1c'; reject.innerText='Reject';
    reject.onclick = async ()=>{ await deleteRecord('reports', r.id); await refreshAdminLists(); alert('Rejected'); };
    div.appendChild(preview); div.appendChild(approve); div.appendChild(reject);
    list.appendChild(div);
  });
}

/* admin draw flood roads */
let adminDrawing=false, adminDrawPts=[], adminDrawPreview=null;
el('startDrawBtn').addEventListener('click', ()=>{ adminDrawing=true; adminDrawPts=[]; alert('Admin: click map to add points, then Finish & Save.'); });
el('finishDrawBtn').addEventListener('click', async ()=>{
  if(adminDrawPts.length < 2){ alert('Need at least 2 points'); return; }
  await addRecord('roads', { id: genId(), coords: adminDrawPts.slice() });
  adminDrawing = false; if(adminDrawPreview) try{ map.removeLayer(adminDrawPreview);}catch(e){} adminDrawPreview=null; await loadAndRenderRoads(); alert('Saved flooded road');
});
el('cancelDrawBtn').addEventListener('click', ()=>{ adminDrawing=false; adminDrawPts=[]; if(adminDrawPreview) try{ map.removeLayer(adminDrawPreview);}catch(e){} adminDrawPreview=null; alert('Canceled'); });
map.on('click', function(e){
  if(adminDrawing){
    adminDrawPts.push([e.latlng.lat, e.latlng.lng]);
    if(adminDrawPreview) try{ map.removeLayer(adminDrawPreview);}catch(e){}
    adminDrawPreview = L.polyline(adminDrawPts, { color:'#ef4444', weight:4, dashArray:'8,8' }).addTo(map);
  }
});

/* export/import */
el('exportBtn').addEventListener('click', async ()=>{ const roads = await getAllRecords('roads'); el('importArea').value = JSON.stringify(roads, null, 2); alert('Exported'); });
el('importBtn').addEventListener('click', async ()=>{ const txt = el('importArea').value.trim(); if(!txt) return alert('Paste JSON'); try{ const arr = JSON.parse(txt); if(!Array.isArray(arr)) return alert('Invalid JSON'); for(const r of arr){ if(r.coords) await addRecord('roads', { id: genId(), coords: r.coords }); } await loadAndRenderRoads(); alert('Imported'); }catch(e){ alert('Import error: '+e.message); } });

/* ========== resolve place utility ========== */
async function resolvePlace(text, inputEl){
  if(!text) return null;
  if(text.toLowerCase().includes('current') && userPos) return userPos;
  if(inputEl && inputEl._latlng) return inputEl._latlng;
  const m = text.match(/(-?\d+(\.\d+)?)\s*[,;]\s*(-?\d+(\.\d+)?)/);
  if(m) return [parseFloat(m[1]), parseFloat(m[3])];
  const res = await nominatim(text);
  if(res && res.length>0) return [parseFloat(res[0].lat), parseFloat(res[0].lon)];
  return null;
}

/* ========== demo seed & startup ========== */
async function seedDemoOnce(){
  const r = await getAllRecords('roads');
  if(r && r.length>0) return;
  const demo = [
    { id: genId(), coords:[[8.5280,76.9350],[8.5285,76.9370]] },
    { id: genId(), coords:[[8.5150,76.9550],[8.5160,76.9560]] },
    { id: genId(), coords:[[8.5030,76.9300],[8.5045,76.9315]] },
    { id: genId(), coords:[[8.5440,76.9000],[8.5430,76.9020]] },
    { id: genId(), coords:[[8.4900,76.9800],[8.4920,76.9815]] },
    { id: genId(), coords:[[8.5350,76.9200],[8.5335,76.9220]] },
    { id: genId(), coords:[[8.5170,76.9200],[8.5185,76.9215]] },
    { id: genId(), coords:[[8.5600,76.8900],[8.5585,76.8920]] },
    { id: genId(), coords:[[8.4950,76.9470],[8.4965,76.9485]] },
    { id: genId(), coords:[[8.5020,76.9650],[8.5035,76.9660]] }
  ];
  for(const d of demo) await addRecord('roads', d);
}

/* ========== UI wiring ========== */
el('useCurrentBtn').addEventListener('click', ()=>{ if(userPos){ el('startInput').value = 'Current location'; el('startInput')._latlng = userPos; } else alert('Allow location'); });
el('findBtn').addEventListener('click', calculateAndShow);
el('openSettingsBtn').addEventListener('click', ()=> show(el('settingsModal')));
el('closeSettingsBtn').addEventListener('click', ()=> hide(el('settingsModal')));
el('toggleThemeBtn').addEventListener('click', ()=>{ document.body.classList.toggle('light'); if(document.body.classList.contains('light')){ if(map.hasLayer(darkTiles)) map.removeLayer(darkTiles); baseTiles.addTo(map); } else { if(map.hasLayer(baseTiles)) map.removeLayer(baseTiles); darkTiles.addTo(map); } });

/* initial startup */
(async function init(){
  await openDB();
  await ensureAdminHash();
  await seedDemoOnce();
  await loadAndRenderRoads();
  await refreshAdminLists();
  // suggestions reposition
  setTimeout(()=>{ positionSuggest(el('startInput'), el('startSuggest')); positionSuggest(el('endInput'), el('endSuggest')); }, 300);
})();
