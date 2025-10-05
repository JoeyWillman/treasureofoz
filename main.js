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

// Create a custom round info control (top-right)
const InfoControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd: function () {
    // Control container
    const container = L.DomUtil.create('div', 'leaflet-control map-info-ctl');

    // Accessible, round button
    const btn = L.DomUtil.create('button', 'map-info-btn', container);
    btn.id = 'mapInfoBtn';
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-controls', 'info-modal');
    btn.setAttribute('aria-label', 'How to use this map');
    btn.title = 'How to use this map';

    // SVG question mark (crisp at any scale)
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10" fill="none"></circle>
        <path d="M9.75 9a2.25 2.25 0 1 1 3.59 1.84c-.8.57-1.59 1.08-1.59 2.41v.25" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
        <circle cx="12" cy="17.25" r="1" fill="currentColor"/>
      </svg>
    `;

    // Prevent map drag/scroll when interacting with the control
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  }
});
map.addControl(new InfoControl());



  // ----- UI elements -----
  const $ = id => document.getElementById(id);
  const menuBtn = $('menuBtn');
  const sidebar = $('sidebar');
  const listEl  = $('list');
  const chipBar = $('chipBar');

  // Desktop controls
  const dSearch = $('search');
  const dType   = $('filterType');
  const dLoc    = $('filterLocation');
  const dAct    = $('filterActivity');

  // Mobile controls (in the dedicated mobile filter bar)
  const mSearch = $('mSearch');
  const mType   = $('mFilterType');
  const mLoc    = $('mFilterLocation');
  const mAct    = $('mFilterActivity');

  // Pick the active control (mobile has priority if present)
  const pickEl = (mEl, dEl) => mEl || dEl;

  // Unified handles used throughout (kept for convenience)
  const searchInput = pickEl(mSearch, dSearch);
  const typeSelect  = pickEl(mType,   dType);
  const locSelect   = pickEl(mLoc,    dLoc);
  const actSelect   = pickEl(mAct,    dAct);

  // Keep desktop & mobile controls mirrored both ways
  function mirror(from, to){
    if (!from || !to || from === to) return;
    const sync = () => { to.value = from.value; };
    from.addEventListener('input', sync);
    from.addEventListener('change', sync);
  }
  mirror(mSearch, dSearch); mirror(dSearch, mSearch);
  mirror(mType,   dType);   mirror(dType,   mType);
  mirror(mLoc,    dLoc);    mirror(dLoc,    mLoc);
  mirror(mAct,    dAct);    mirror(dAct,    mAct);

  if (menuBtn && sidebar){
    menuBtn.addEventListener('click', ()=>{
      sidebar.classList.toggle('open');
      setTimeout(()=> map.invalidateSize(), 250);
    });
  }
// ===== Map Info Modal (legend + tutorial) =====
(function(){
  const btn     = document.getElementById('mapInfoBtn');
  const modal   = document.getElementById('info-modal');
  const embed   = document.getElementById('legendEmbed');
  const closeEl = modal?.querySelector('.modal-close');

  if (!btn || !modal || !embed) return;

  const cloneLegendInto = () => {
    const src = document.getElementById('legend');
    if (!src) return;

    // Grab just the list markup so we don't inherit floating card classes/IDs
    const list = src.querySelector('.legend-list')?.cloneNode(true);
    const title = document.createElement('div');
    title.className = 'legend-title';
    title.textContent = 'Legend';

    const wrap = document.createElement('div');
    wrap.className = 'legend-embed'; // NOTE: not ".legend"
    wrap.appendChild(title);
    if (list) wrap.appendChild(list);

    embed.innerHTML = '';
    embed.appendChild(wrap);
  };

  let lastFocus = null;

  const openModal = () => {
    cloneLegendInto();
    lastFocus = document.activeElement;
    modal.setAttribute('aria-hidden', 'false');
    (modal.querySelector('button, [href], [tabindex]:not([tabindex="-1"])') || closeEl)?.focus();
  };

  const closeModal = () => {
    modal.setAttribute('aria-hidden', 'true');
    lastFocus?.focus?.();
  };

  btn.addEventListener('click', openModal);
  closeEl?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e)=>{
    if (e.target.matches('[data-close="true"]')) closeModal();
  });
  document.addEventListener('keydown', (e)=>{
    if (modal.getAttribute('aria-hidden') === 'false' && e.key === 'Escape') closeModal();
  });
})();

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
  const setValueBoth = (mEl, dEl, v) => { if (mEl) mEl.value = v; if (dEl) dEl.value = v; };

  // Debounce helper (for search typing)
  const debounce = (fn, ms=160) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

  // Safe HTML (uses DOMPurify if present; otherwise text-only fallback)
  const safeHTML = (html) => {
    if (window.DOMPurify?.sanitize) return window.DOMPurify.sanitize(html || '');
    const d = document.createElement('div'); d.textContent = String(html || ''); return d.innerHTML;
  };

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
    if (text.length <= maxChars) return `<p>${text}</p>`;
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

  // Preserve paragraphs/line breaks when the description is plain text
function formatDescription(htmlOrText=''){
  const s = String(htmlOrText || '');
  const looksLikeHTML = /<\/?[a-z][\s\S]*>/i.test(s);
  if (looksLikeHTML) return s; // author-provided HTML
  // Convert plain text to <p>…</p> and <br>
  const parts = s.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`);
  return parts.join('');
}


  // Drawer
  const drawer = $('detail-drawer');
  const drawerBody = $('drawerBody');

  // Drawer a11y: Esc to close + focus on open
  const closeDrawer = () => drawer.setAttribute('aria-hidden', 'true');
  const openDrawerA11y = () => {
    drawer.setAttribute('aria-hidden', 'false');
    const focusable = drawer.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
  };

  document.addEventListener('keydown', (e)=>{
    if (drawer.getAttribute('aria-hidden') === 'false' && e.key === 'Escape') closeDrawer();
  });
  document.addEventListener('click', (e)=>{
    if (e.target.closest('.drawer-close')) closeDrawer();
  });

  function directionsBtn(r){
    const gm = `https://www.google.com/maps?q=${encodeURIComponent(r.lat+','+r.lon)}&daddr=${encodeURIComponent(r.name)}`;
    return `<a class="btn" href="${gm}" target="_blank" rel="noopener">Directions</a>`;
  }
 function suggestSimilar(current){
  const sameCat = rows.filter(x => x !== current && x.category === current.category).slice(0, 4);
  if (!sameCat.length) return '';
  const items = sameCat.map(x =>
    `<button class="link tag js-zoom-to" data-lat="${x.lat}" data-lon="${x.lon}" type="button">${x.name}</button>`
  ).join('');
  return `<div class="morelike-wrap"><strong>More like this</strong><div class="morelike">${items}</div></div>`;
}

  document.addEventListener('click', (e)=>{
    const b = e.target.closest('.js-zoom-to');
    if (!b) return;
    const lat = parseFloat(b.getAttribute('data-lat'));
    const lon = parseFloat(b.getAttribute('data-lon'));
    closeDrawer();
    map.setView([lat, lon], Math.max(map.getZoom(), 14));
  });

  // Preserve paragraphs/line breaks when the description is plain text
function formatDescription(htmlOrText=''){
  const s = String(htmlOrText || '');
  const looksLikeHTML = /<\/?[a-z][\s\S]*>/i.test(s);
  if (looksLikeHTML) return s; // author-provided HTML
  // Convert plain text to <p>…</p> and <br>
  const parts = s.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`);
  return parts.join('');
}


 function openDetails(r){
  const website = r.website ? `<a class="btn" href="${r.website}" target="_blank" rel="noopener">Website ↗</a>` : '';
  const address = r.address ? `<span class="chip"><strong>Address:</strong> ${r.address}</span>` : '';
  const photo = r.photo ? `<img src="${r.photo}" alt="${r.name}" loading="lazy" style="margin:.6rem 0">` : '';

  // activities will be fitted to one line using layoutActs after insertion
  const actsDataAttr = (r.activities && r.activities.length)
    ? ` data-acts='${JSON.stringify(r.activities)}'`
    : '';

  drawerBody.innerHTML = `
    <h2>${r.name}</h2>
    <div class="meta-row">
      <span class="chip">${r.category || 'other'}</span>
      ${r.location ? `<span class="chip muted">${r.location}</span>` : ''}
    </div>

    ${ r.activities?.length ? `<div class="acts"${actsDataAttr}></div>` : '' }

    ${photo}

    <div class="desc">${formatDescription(r.description || '') || '<p><em>No description yet.</em></p>'}</div>

    <div class="meta-row">
      ${address || ''}
      ${website || ''}
      ${directionsBtn(r)}
    </div>

    ${suggestSimilar(r)}
  `;

  openDrawerA11y();

  // Fit the activity chips in the drawer
  const acts = drawerBody.querySelector('.acts[data-acts]');
  if (acts) requestAnimationFrame(() => layoutActs(acts));
}

window.addEventListener('resize', () => {
  const acts = drawerBody?.querySelector('.acts[data-acts]');
  if (acts) layoutActs(acts);
}, { passive: true });


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
  const url = getIconPath(category, overridePath);
  return L.divIcon({
    // Round badge with centered glyph
    html: `<div class="treasure-pin"><img src="${url}" alt=""></div>`,
    className: 'treasure-divicon',      // neutral outer class (no default Leaflet sprite)
    iconSize: [36, 36],                 // total badge size
    iconAnchor: [18, 36],               // point sits at bottom center of badge
    popupAnchor: [0, -30]               // popup above the badge
  });
}

  // === Interurban Trail (GeoJSON) ===
  map.createPane('trailPane');
  map.getPane('trailPane').style.zIndex = 450;
  map.getPane('trailPane').style.pointerEvents = 'auto';

const TRAIL_POPUP_HTML = `
  <div class="popup">
    <div class="popup-head" style="display:flex;align-items:center;gap:.4rem;">
      <span class="legend-line" style="display:inline-block;width:18px;height:3px;background:#2f7c31;border-radius:2px"></span>
      <h3 class="popup-title" style="margin:.1rem 0 .2rem;font-size:1.05rem;">Ozaukee Interurban Trail</h3>
    </div>

    <div class="popup-desc">
      <p>The Ozaukee Interurban Trail was not always a trail, but the route of the Interurban Electric Railway. It opened in 1908 and ran from Milwaukee to Sheboygan. The Northern Route had stops in the mostly rural communities of Brown Deer, Thiensville, Cedarburg, Grafton, Port Washington, Belgium, Cedar Grove, Oostburg, and Sheboygan. Until it ceased operation completely in 1951, many people leaving the city for work or play traveled on the railway.</p>
      <p>Workers used the railway to access factory jobs, making cigars, shoes, nails, and pearl buttons. Perhaps the most famous “commuters” were the African American blues singers who traveled north in the 1920s and 30s to use the recording studio in the Grafton chair factory, which eventually became Paramount Records.</p>
      <p>After the railway ceased operation, the land was retained, and the company, by that time called Wisconsin Electric (now We Energies), began to convert parts of the trail into bike paths in 1975—an easy conversion because the trail was built on old railroad beds. In 1998, Ozaukee County and several of its communities received state funding to lease the land from Wisconsin Electric and complete what is now known as the Ozaukee Interurban Trail.</p>
    </div>

    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.4rem">
      <a class="btn small" href="https://www.interurbantrail.com/" target="_blank" rel="noopener">Official Website</a>
      <a class="btn small" href="https://joeywillman.github.io/ozaukee-interurbantrail-birding/" target="_blank" rel="noopener">Trailside Birding Guide</a>
    </div>
  </div>
`;


  const trailStyle = {
    color: '#2f7c31',
    weight: 4,
    opacity: 0.9,
    dashArray: '8 6',
    lineJoin: 'round'
  };

  fetch('data/trail.geojson')
    .then(r => r.json())
    .then(geo => {
      L.geoJSON(geo, {
        pane: 'trailPane',
        style: trailStyle,
        onEachFeature: (_, layer) => {
          const small = window.matchMedia('(max-width: 760px)').matches;
layer.bindPopup(TRAIL_POPUP_HTML, {
  maxWidth: small ? 300 : 360, // keeps it compact on phones
  keepInView: true,
  autoPan: true,
  // keep the popup clear of the sticky header on small screens
  autoPanPaddingTopLeft: [16, small ? 90 : 30],
  autoPanPaddingBottomRight: [16, 16],
  closeButton: true
});

          layer.setStyle({ className: 'trail-line' }); // animated dashed line via CSS
        }
      }).addTo(map);
    })
    .catch(err => console.error('Trail GeoJSON load error:', err));

  // ----- Popups -----
 function popupHTML(r){
  const iconSrc = getIconPath(r.category, r.icon);

  // Activities will be fitted after popup opens
  const actsDataAttr = r.activities && r.activities.length
    ? ` data-acts='${JSON.stringify(r.activities)}'`
    : '';

  const photo = r.photo
    ? `<img src="${r.photo}" alt="${r.name}" loading="lazy" style="width:100%;border-radius:8px;margin:.4rem 0">`
    : '';

  const teaser = r.description ? truncateHTML(r.description, 240) : '<p><em>No description yet.</em></p>';
  const websiteBtn = r.website ? `<a class="btn small" href="${r.website}" target="_blank" rel="noopener">Website</a>` : '';
  const gm = `https://www.google.com/maps?q=${encodeURIComponent(r.lat+','+r.lon)}&daddr=${encodeURIComponent(r.name)}`;
  const dirBtn = `<a class="btn small" href="${gm}" target="_blank" rel="noopener">Directions</a>`;

  return `
    <div class="popup">
      <div class="popup-head" style="display:flex; align-items:center; gap:.4rem;">
        <img src="${iconSrc}" alt="" width="20" height="20"/>
        <h3 class="popup-title" style="margin:.1rem 0 .2rem; font-size:1.05rem;">${r.name}</h3>
      </div>

      ${ r.activities.length ? `<div class="acts"${actsDataAttr}></div>` : '' }

      ${photo}
      <div class="popup-desc">${teaser}</div>

      <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.4rem">
        <button class="btn small js-details" type="button" data-id="${r.id}">Details</button>
        ${websiteBtn}
        ${dirBtn}
      </div>
    </div>`;
}


// ----- Sidebar list items (desktop) -----
function sidebarItemHTML(r){
  const iconSrc = getIconPath(r.category, r.icon);

  // Show town/location only (fall back to address, then category)
  const sub = r.location || r.address || (r.category || '');

  // We'll fit chips dynamically after insert; store full activities on the node
  const actsDataAttr = r.activities && r.activities.length
    ? ` data-acts='${JSON.stringify(r.activities)}'`
    : '';

  return `
    <img src="${iconSrc}" alt="">
    <div class="meta">
      <span class="title">${r.name}</span>
      <span class="sub">${sub}</span>
      ${ r.activities.length ? `<div class="acts"${actsDataAttr}></div>` : '' }
    </div>
  `;
}

/**
 * Fit activity chips into one line:
 * - Append as many activity chips as will fit within the container width
 * - If there are hidden ones, append a "+N more" chip that ALWAYS fits
 */
function layoutActs(container){
  if (!container) return;
  let acts = [];
  try {
    acts = JSON.parse(container.getAttribute('data-acts') || '[]');
  } catch (_) {
    acts = [];
  }
  container.innerHTML = '';
  if (!acts.length) return;

  const makeChip = (label, cls='') => {
    const el = document.createElement('span');
    el.className = 'chip' + (cls ? (' ' + cls) : '');
    el.textContent = label;
    return el;
  };

  // We'll try increasing counts until the next candidate overflows.
  let bestCount = 0;

  for (let i = 0; i < acts.length; i++) {
    // Build a trial DOM for i+1 visible chips (+ optional more chip)
    container.innerHTML = '';

    // Visible chips
    for (let j = 0; j <= i; j++) {
      container.appendChild(makeChip(acts[j]));
    }

    // If there are hidden chips, append a "+N more" chip for measurement
    const hidden = acts.length - (i + 1);
    if (hidden > 0) {
      container.appendChild(makeChip(`+${hidden} more`, 'more'));
    }

    // Check overflow
    if (container.scrollWidth <= container.clientWidth) {
      bestCount = i + 1;
    } else {
      break;
    }
  }

  // Render final content using the bestCount found
  container.innerHTML = '';
  if (bestCount === 0) {
    // If even the first chip + "+N more" doesn't fit, just show "+N more"
    container.appendChild(makeChip(`+${acts.length} more`, 'more'));
    return;
  }

  // Visible chips
  for (let j = 0; j < bestCount; j++) {
    container.appendChild(makeChip(acts[j]));
  }

  // If there are hidden ones, append "+N more"
  const hiddenFinal = acts.length - bestCount;
  if (hiddenFinal > 0) {
    container.appendChild(makeChip(`+${hiddenFinal} more`, 'more'));
  }
}

function addRow(r){
  if (r.lat == null || r.lon == null) return;

  const m = L.marker([r.lat, r.lon], { icon: makeIcon(r.category, r.icon) })
  .bindPopup(popupHTML(r), { maxWidth: 360, keepInView: true, autoPanPadding: [30, 30] });


  m.feature = { properties: r };
  cluster.addLayer(m);
  markers.push(m);
  markerById.set(r.id, m);

  if (listEl) {
    const li = document.createElement('li');
    li.className = 'card';
    li.innerHTML = sidebarItemHTML(r);

    // Fit the activity chips after we’re in the DOM (so widths are known)
    const actsEl = li.querySelector('.acts');
    if (actsEl) {
      // Wait a tick to ensure fonts/layout are ready
      requestAnimationFrame(() => layoutActs(actsEl));
    }

    li.addEventListener('click', ()=>{
      map.setView([r.lat, r.lon], Math.max(map.getZoom(), 14));
      m.openPopup();
      if (sidebar) sidebar.classList.remove('open');
      setTimeout(()=> map.invalidateSize(), 150);
    });

    listEl.appendChild(li);
  }
}

// Fit activity chips inside popups when they open
map.on('popupopen', (e) => {
  const root = e?.popup?._contentNode || e?.popup?.getElement();
  const acts = root?.querySelector('.acts[data-acts]');
  if (acts) layoutActs(acts);
});

// Also re-fit popup acts on resize
window.addEventListener('resize', () => {
  document.querySelectorAll('.leaflet-popup .acts[data-acts]').forEach(el => layoutActs(el));
}, { passive: true });


function clearLayers(){
  cluster.clearLayers();
  markers = [];
  markerById.clear();
  if (listEl) listEl.innerHTML = '';
}

// Friendly empty state in the list when no matches
function renderEmpty(){
  if (!listEl) return;
  const li = document.createElement('li');
  li.className = 'card';
  li.innerHTML = `
    <div class="meta">
      <span class="title">No matches</span>
      <span class="sub">Try clearing a filter or using fewer terms.</span>
    </div>`;
  listEl.appendChild(li);
}

/* Re-fit all visible activity chip rows on resize or after fonts load */
const relayoutAllActs = (() => {
  let t;
  const run = () => {
    if (!listEl) return;
    const rows = listEl.querySelectorAll('.acts[data-acts]');
    rows.forEach(el => layoutActs(el));
  };
  return () => { clearTimeout(t); t = setTimeout(run, 100); };
})();

window.addEventListener('resize', relayoutAllActs, { passive: true });
if (document.fonts?.ready) document.fonts.ready.then(relayoutAllActs);

  // ----- Filters -----
  function buildFilterOptions(data){
    const setOptions = (select, options, firstLabel) => {
      if (!select) return;
      select.innerHTML = `<option value="">${firstLabel}</option>` + options;
    };

    // Locations from CSV 'location'
    const locations = uniq(data.map(r => r.location).filter(Boolean))
      .sort((a,b)=>a.localeCompare(b));
    const locOptions = locations.map(c=>`<option value="${c}">${c}</option>`).join('');
    setOptions(dLoc, locOptions, 'Location: All');
    setOptions(mLoc, locOptions, 'Location: All');

    // Activities from CSV 'activities'
    const acts = uniq(data.flatMap(r=>r.activities)).sort((a,b)=>a.localeCompare(b));
    const actOptions = acts.map(a=>`<option value="${a}">${a}</option>`).join('');
    setOptions(dAct, actOptions, 'Activity: All');
    setOptions(mAct, actOptions, 'Activity: All');
  }

  function applyFilters(){
    const q   = (searchInput?.value || '').trim().toLowerCase();
    const t   = (typeSelect?.value   || '').toLowerCase();
    const loc = (locSelect?.value    || '').toLowerCase();
    const act = (actSelect?.value    || '').toLowerCase();

    clearLayers();

    const filtered = rows.filter(r=>{
      const matchesType = !t || (r.category || '').toLowerCase() === t;
      const matchesLoc  = !loc || (r.location || '').toLowerCase() === loc;
      const matchesAct  = !act || (r.activities||[]).some(a => a.toLowerCase() === act);
      const hay = `${r.name} ${r.description} ${r.address} ${r.category} ${(r.activities||[]).join(' ')}`.toLowerCase();
      const matchesQ = !q || hay.includes(q);
      return matchesType && matchesLoc && matchesAct && matchesQ;
    });

    if (!filtered.length){
      renderEmpty();
      map.setView([43.38, -87.95], 11);
      renderChips({q, t, loc, act, count: 0});
      setTimeout(()=> map.invalidateSize(), 50);
      return;
    }

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
    if (!chipBar) return;
    chipBar.innerHTML = '';
    const make = (label, onClear)=>{
      const el = document.createElement('button');
      el.className = 'chip';
      el.type = 'button';
      el.textContent = label;
      el.addEventListener('click', onClear);
      chipBar.appendChild(el);
    };
    if(q)   make(`Search: "${q}" ✕`, ()=>{ setValueBoth(mSearch, dSearch, ''); applyFilters(); });
    if(t)   make(`Type: ${t} ✕`,      ()=>{ setValueBoth(mType,   dType,   ''); applyFilters(); });
    if(loc) make(`Location: ${loc} ✕`,()=>{ setValueBoth(mLoc,    dLoc,    ''); applyFilters(); });
    if(act) make(`Activity: ${act} ✕`,()=>{ setValueBoth(mAct,    dAct,    ''); applyFilters(); });
    make(`${count} result${count===1?'':'s'}`, ()=>{});
  }

  // Auto-refresh on input/changes — attach to BOTH desktop and mobile
  const onSearch = debounce(applyFilters, 160);
  [dSearch, mSearch].filter(Boolean).forEach(el => el.addEventListener('input', onSearch));
  [dType,  mType ].filter(Boolean).forEach(el => el.addEventListener('change', applyFilters));
  [dLoc,   mLoc  ].filter(Boolean).forEach(el => el.addEventListener('change', applyFilters));
  [dAct,   mAct  ].filter(Boolean).forEach(el => el.addEventListener('change', applyFilters));

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
