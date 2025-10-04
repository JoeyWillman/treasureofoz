/* global L, Papa */
document.addEventListener('DOMContentLoaded', () => {
  // ----- Map init -----
  const map = L.map('map', { scrollWheelZoom: true, zoomControl: true });

  // CARTO Voyager basemap
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
        'Tiles © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19
    }
  ).addTo(map);

  map.setView([43.38, -87.95], 11);
  requestAnimationFrame(()=> map.invalidateSize());
  window.addEventListener('resize', ()=> map.invalidateSize());

  // ----- UI elements -----
  const menuBtn = document.getElementById('menuBtn');
  const sidebar = document.getElementById('sidebar');
  const listEl = document.getElementById('list');
  const searchEl = document.getElementById('search');
  const typeEl = document.getElementById('filterType');
  const locEl = document.getElementById('filterLocation');
  const actEl = document.getElementById('filterActivity');
  const chipBar = document.getElementById('chipBar');

  if (menuBtn && sidebar){
    menuBtn.addEventListener('click', ()=>{
      sidebar.classList.toggle('open');
      setTimeout(()=> map.invalidateSize(), 250);
    });
  }

  // ----- Clustering -----
  const cluster = L.markerClusterGroup({
    disableClusteringAtZoom: 15,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false
  }).addTo(map);

  let rows = [];
  let markers = [];
  const markerById = new Map();

  // ----- Helpers -----
  const titleCase = s => String(s||'').replace(/\S+/g, w => w[0]?.toUpperCase() + w.slice(1));
  function normKey(k){ return String(k || '').trim().toLowerCase(); }
  function pick(obj, keys){ for (const k of keys){ if (obj[k] != null && String(obj[k]).trim() !== '') return obj[k]; } return ''; }
  function slugify(str){ return String(str||'').toLowerCase().trim().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
  function uniq(arr){ return Array.from(new Set(arr.filter(Boolean))); }

  const CATEGORY_MAP = {
    'naturepreserve': 'naturepreserve', 'preserve': 'naturepreserve', 'natural-area': 'naturepreserve',
    'park': 'parks', 'parks': 'parks', 'county-park': 'parks', 'city-park': 'parks',
    'wpa': 'wpa', 'waterfowl': 'wpa', 'waterfowl-production': 'wpa', 'waterfowl-production-area': 'wpa',
    'other': 'other'
  };
  function normalizeCategory(cat){ const s = slugify(cat || ''); return CATEGORY_MAP[s] || 'other'; }
  function getIconPath(category, overridePath){ if (overridePath) return overridePath; return `data/icons/${normalizeCategory(category)}.png`; }

  // Activities (CSV-only)
  function parseActivities(raw){
    if (!raw) return [];
    return String(raw)
      .split(/[;,|]/)
      .map(s => titleCase(s.trim()))
      .filter(Boolean);
  }

  // Content helpers
  function truncateHTML(html, maxChars=240){
    if (!html) return '';
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || '';
    if (text.length <= maxChars) return html;
    const short = text.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
    return `<p>${short}</p>`;
  }
  function firstSentence(html=''){
    const t = (new DOMParser()).parseFromString(html, 'text/html').body.textContent || '';
    if (!t) return '';
    const m = t.match(/^.*?[.!?](\s|$)/);
    const s = (m ? m[0] : t).trim();
    return s.length > 90 ? s.slice(0, 90).replace(/\s+\S*$/,'') + '…' : s;
  }

  // Drawer
  const drawer = document.getElementById('detail-drawer');
  const drawerBody = document.getElementById('drawerBody');
  document.addEventListener('click', (e)=>{
    if (e.target.closest('.drawer-close')) drawer.setAttribute('aria-hidden', 'true');
  });
  function directionsBtn(r){
    const gm = `https://www.google.com/maps?q=${encodeURIComponent(r.lat+','+r.lon)}&daddr=${encodeURIComponent(r.name)}`;
    return `<a class="btn" href="${gm}" target="_blank" rel="noopener">Directions</a>`;
  }
  function suggestSimilar(current){
    const sameCat = rows.filter(x => x !== current && x.category === current.category).slice(0,2);
    if (!sameCat.length) return '';
    const items = sameCat.map(x => `<li><button class="link js-zoom-to" data-lat="${x.lat}" data-lon="${x.lon}">${x.name}</button></li>`).join('');
    return `<div style="margin-top:1rem"><strong>More like this</strong><ul>${items}</ul></div>`;
  }
  document.addEventListener('click', (e)=>{
    const b = e.target.closest('.js-zoom-to');
    if (!b) return;
    const lat = parseFloat(b.getAttribute('data-lat'));
    const lon = parseFloat(b.getAttribute('data-lon'));
    drawer.setAttribute('aria-hidden', 'true');
    map.setView([lat, lon], Math.max(map.getZoom(), 14));
  });

  function openDetails(r){
    const website = r.website ? `<a class="btn" href="${r.website}" target="_blank" rel="noopener">Website ↗</a>` : '';
    const address = r.address ? `<span class="chip"><strong>Address:</strong> ${r.address}</span>` : '';
    const photo = r.photo ? `<img src="${r.photo}" alt="${r.name}" style="margin:.6rem 0">` : '';
    const actChips = r.activities.length ? `<div class="chips chip-row">${r.activities.map(a=>`<span class="chip">${a}</span>`).join('')}</div>` : '';

    drawerBody.innerHTML = `
      <h2>${r.name}</h2>
      <div class="meta-row">
        <span class="chip">${r.category || 'other'}</span>
        ${r.location ? `<span class="chip muted">${r.location}</span>` : ''}
      </div>
      ${actChips}
      ${photo}
      ${r.description || '<p><em>No description yet.</em></p>'}
      <div class="meta-row">
        ${address || ''}
        ${website || ''}
        ${directionsBtn(r)}
      </div>
      ${suggestSimilar(r)}
    `;
    drawer.setAttribute('aria-hidden', 'false');
  }

  // Normalize row from CSV (use LOCATION + ACTIVITIES only from CSV)
  function normalizeRow(raw, idx){
    const m = {}; Object.keys(raw).forEach(k => { m[normKey(k)] = raw[k]; });

    const name = pick(m, ['name','title']);
    const categoryRaw = pick(m, ['category','type']);
    const description = pick(m, ['description','desc']);
    const latStr = pick(m, ['lat','latitude']);
    const lonStr = pick(m, ['lon','long','longitude','lng']);
    const address = pick(m, ['address','addr']);
    const website = pick(m, ['website','url','link']);
    const photo = pick(m, ['photo','image','img']);
    const iconOverride = pick(m, ['icon']);
    const activitiesRaw = pick(m, ['activities']); // CSV truth
    const locationRaw = pick(m, ['location','city','town','municipality']); // prefer 'location'

    const lat = parseFloat(String(latStr).replace(',', '.'));
    const lon = parseFloat(String(lonStr).replace(',', '.'));

    return {
      id: pick(m, ['id']) || `row-${idx}`,
      name: name || 'Untitled',
      category: normalizeCategory(categoryRaw),
      description: description || '',
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      address,
      website,
      photo,
      icon: iconOverride,
      activities: parseActivities(activitiesRaw),
      location: locationRaw ? String(locationRaw).trim() : ''
    };
  }

  function makeIcon(category, overridePath){
    return L.icon({
      iconUrl: getIconPath(category, overridePath),
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -22],
      className: 'treasure-icon'
    });
  }

// === Interurban Trail (GeoJSON) ===
map.createPane('trailPane');
map.getPane('trailPane').style.zIndex = 450;
map.getPane('trailPane').style.pointerEvents = 'auto';

const TRAIL_POPUP_HTML = `
  <div class="popup">
    <h3 style="margin:.1rem 0 .4rem;font-size:1.1rem;color:#2f7c31;">Ozaukee Interurban Trail</h3>
    <p>The Ozaukee Interurban Trail was not always a trail, but the route of the Interurban Electric Railway. It opened in 1908 and ran from Milwaukee to Sheboygan. The Northern Route had stops in the mostly rural communities of Brown Deer, Thiensville, Cedarburg, Grafton, Port Washington, Belgium, Cedar Grove, Oostburg, and Sheboygan. Until it ceased operation completely in 1951, many people leaving the city for work or play traveled on the railway.</p>
    <p>Workers used the railway to access factory jobs, making cigars, shoes, nails, and pearl buttons. Perhaps the most famous “commuters” were the African American blues singers who traveled north in the 1920s and 30s to use the recording studio in the Grafton chair factory, which eventually became Paramount Records.</p>
    <p>After the railway ceased operation, the land was retained, and the company, by that time called Wisconsin Electric (now We Energies), began to convert parts of the trail into bike paths in 1975—an easy conversion because the trail was built on old railroad beds. In 1998, Ozaukee County and several of its communities received state funding to lease the land from Wisconsin Electric and complete what is now known as the Ozaukee Interurban Trail.</p>
    <p>
      <a class="btn small" href="https://www.interurbantrail.com/" target="_blank" rel="noopener">Official Website</a>
      <a class="btn small" href="https://joeywillman.github.io/ozaukee-interurbantrail-birding/" target="_blank" rel="noopener">Trailside Birding Guide</a>
    </p>
  </div>
`;

const trailStyle = {
  color: '#2f7c31',        // deep green
  weight: 4,
  opacity: 0.9,
  dashArray: '8 6',        // dashed pattern
  lineJoin: 'round'
};

fetch('data/trail.geojson')
  .then(r => r.json())
  .then(geo => {
    const trailLayer = L.geoJSON(geo, {
      pane: 'trailPane',
      style: trailStyle,
      onEachFeature: (feature, layer) => {
        layer.bindPopup(TRAIL_POPUP_HTML, { maxWidth: 420 });

        // Subtle glow effect by duplicating a thicker, blurred line underneath
        layer.setStyle({
          className: 'trail-line'
        });
      }
    }).addTo(map);
  })
  .catch(err => console.error('Trail GeoJSON load error:', err));



  // POPUP
  function popupHTML(r){
    const iconSrc = getIconPath(r.category, r.icon);
    const acts = r.activities.length ? `<div class="chips chip-row">${r.activities.map(a=>`<span class="chip">${a}</span>`).join('')}</div>` : '';
    const photo = r.photo ? `<img src="${r.photo}" alt="${r.name}" style="width:100%;border-radius:8px;margin:.4rem 0">` : '';
    const teaser = r.description ? truncateHTML(r.description, 240) : '<p><em>No description yet.</em></p>';
    const websiteBtn = r.website ? `<a class="btn small" href="${r.website}" target="_blank" rel="noopener">Website</a>` : '';
    const gm = `https://www.google.com/maps?q=${encodeURIComponent(r.lat+','+r.lon)}&daddr=${encodeURIComponent(r.name)}`;
    const dirBtn = `<a class="btn small" href="${gm}" target="_blank" rel="noopener">Directions</a>`;
    return `
      <div class="popup">
        <div class="popup-head" style="display:flex; align-items:center; gap:.4rem;">
          <img src="${iconSrc}" alt="icon" width="20" height="20"/>
          <h3 style="margin:.1rem 0 .2rem; font-size:1.05rem;">${r.name}</h3>
        </div>
        ${acts}
        ${photo}
        ${teaser}
        <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.4rem">
          <button class="btn small js-details" type="button" data-id="${r.id}">Details</button>
          ${websiteBtn}
          ${dirBtn}
        </div>
      </div>`;
  }

  // SIDEBAR ITEM with activities + overflow “+x more”
  function sidebarItemHTML(r){
    const iconSrc = getIconPath(r.category, r.icon);
    const sub = r.description ? firstSentence(r.description) : (r.address || r.location || r.category || '');
    const maxShow = 3;
    const shown = r.activities.slice(0, maxShow);
    const hiddenCount = Math.max(0, r.activities.length - shown.length);
    const acts = shown.map(a => `<span class="chip">${a}</span>`).join('');
    const more = hiddenCount ? `<span class="chip more">+${hiddenCount} more</span>` : '';
    return `
      <img src="${iconSrc}" alt="icon">
      <div class="meta">
        <span class="title">${r.name}</span>
        <span class="sub">${sub}</span>
        ${ r.activities.length ? `<div class="acts">${acts}${more}</div>` : '' }
      </div>
    `;
  }

  function addRow(r){
    if (r.lat == null || r.lon == null) return;

    const m = L.marker([r.lat, r.lon], { icon: makeIcon(r.category, r.icon) })
      .bindPopup(popupHTML(r));

    m.feature = { properties: r };
    cluster.addLayer(m);
    markers.push(m);
    markerById.set(r.id, m);

    const li = document.createElement('li');
    li.className = 'card';
    li.innerHTML = sidebarItemHTML(r);
    li.addEventListener('click', ()=>{
      map.setView([r.lat, r.lon], Math.max(map.getZoom(), 14));
      m.openPopup();
      sidebar.classList.remove('open');
      setTimeout(()=> map.invalidateSize(), 150);
    });
    listEl.appendChild(li);
  }

  function clearLayers(){
    cluster.clearLayers();
    markers = [];
    markerById.clear();
    listEl.innerHTML = '';
  }

  // ----- Filters -----
  function buildFilterOptions(data){
    // Locations from CSV 'location' only
    const locations = uniq(data.map(r => r.location).filter(Boolean))
      .sort((a,b)=>a.localeCompare(b));
    locEl.innerHTML = `<option value="">Location: All</option>` +
      locations.map(c=>`<option value="${c}">${c}</option>`).join('');

    // Activities from CSV 'activities' only
    const acts = uniq(data.flatMap(r=>r.activities)).sort((a,b)=>a.localeCompare(b));
    actEl.innerHTML = `<option value="">Activity: All</option>` +
      acts.map(a=>`<option value="${a}">${a}</option>`).join('');
  }

  function applyFilters(){
    const q = (searchEl.value || '').trim().toLowerCase();
    const t = (typeEl.value || '').toLowerCase();
    const loc = (locEl.value || '').toLowerCase();
    const act = (actEl.value || '').toLowerCase();

    clearLayers();

    const filtered = rows.filter(r=>{
      const matchesType = !t || (r.category || '').toLowerCase() === t;
      const matchesLoc = !loc || (r.location || '').toLowerCase() === loc;
      const matchesAct = !act || (r.activities||[]).some(a => a.toLowerCase() === act);
      const hay = `${r.name} ${r.description} ${r.address} ${r.category} ${(r.activities||[]).join(' ')}`.toLowerCase();
      const matchesQ = !q || hay.includes(q);
      return matchesType && matchesLoc && matchesAct && matchesQ;
    });

    filtered.forEach(addRow);

    if (filtered.length && markers.length){
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.15));
    } else {
      map.setView([43.38, -87.95], 11);
    }

    renderChips({q, t, loc, act, count: filtered.length});
    setTimeout(()=> map.invalidateSize(), 50);
  }

  function renderChips({q, t, loc, act, count}){
    chipBar.innerHTML = '';
    const make = (label, onClear)=>{
      const el = document.createElement('button');
      el.className = 'chip';
      el.type = 'button';
      el.textContent = label;
      el.addEventListener('click', onClear);
      chipBar.appendChild(el);
    };
    if(q) make(`Search: "${q}" ✕`, ()=>{ searchEl.value=''; applyFilters(); });
    if(t) make(`Type: ${t} ✕`, ()=>{ typeEl.value=''; applyFilters(); });
    if(loc) make(`Location: ${loc} ✕`, ()=>{ locEl.value=''; applyFilters(); });
    if(act) make(`Activity: ${act} ✕`, ()=>{ actEl.value=''; applyFilters(); });
    make(`${count} result${count===1?'':'s'}`, ()=>{});
  }

  // Auto-refresh when selects change / search input
  searchEl.addEventListener('input', applyFilters);
  typeEl.addEventListener('change', applyFilters);
  locEl.addEventListener('change', applyFilters);
  actEl.addEventListener('change', applyFilters);

  // Details button (from popup)
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('.js-details');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const m = id ? markerById.get(id) : null;
    const data = m?.feature?.properties;
    if (data) openDetails(data);
  });

  // ----- Load CSV -----
  Papa.parse('data/treasures.csv', {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: res => {
      rows = res.data
        .map((r,i)=>normalizeRow(r,i))
        .filter(r => r.name && r.lat != null && r.lon != null);

      buildFilterOptions(rows);
      applyFilters();
      setTimeout(()=> map.invalidateSize(), 50);
    },
    error: err => { console.error('CSV load error:', err); }
  });

  // Expose for quick debugging if needed
  window.__map = map;
});
