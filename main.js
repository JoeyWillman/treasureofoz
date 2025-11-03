/* global L, Papa */
document.addEventListener('DOMContentLoaded', () => {
  // ----- Map init -----
  const map = L.map('map', { scrollWheelZoom: true, zoomControl: true });

  // CARTO Voyager basemap
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
      'Tiles © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  map.setView([43.38, -87.95], 11);
  requestAnimationFrame(()=> map.invalidateSize());
  window.addEventListener('resize', ()=> map.invalidateSize());

  // Create a custom round info control (top-right)
  const InfoControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      const container = L.DomUtil.create('div', 'leaflet-control map-info-ctl');
      const btn = L.DomUtil.create('button', 'map-info-btn', container);
      btn.id = 'mapInfoBtn';
      btn.type = 'button';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-controls', 'info-modal');
      btn.setAttribute('aria-label', 'How to use this map');
      btn.title = 'How to use this map';
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="10" fill="none"></circle>
          <path d="M9.75 9a2.25 2.25 0 1 1 3.59 1.84c-.8.57-1.59 1.08-1.59 2.41v.25" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
          <circle cx="12" cy="17.25" r="1" fill="currentColor"/>
        </svg>`;
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

  // Mobile controls
  const mSearch = $('mSearch');
  const mType   = $('mFilterType');
  const mLoc    = $('mFilterLocation');
  const mAct    = $('mFilterActivity');

  // Pick the active control (mobile has priority)
  const pickEl = (mEl, dEl) => mEl || dEl;
  const searchInput = pickEl(mSearch, dSearch);
  const typeSelect  = pickEl(mType,   dType);
  const locSelect   = pickEl(mLoc,    dLoc);
  const actSelect   = pickEl(mAct,    dAct);

  // Mirror desktop & mobile controls
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

  // ===== Map Info Modal =====
  (function(){
    const btn     = document.getElementById('mapInfoBtn');
    const modal   = document.getElementById('info-modal');
    const embed   = document.getElementById('legendEmbed');
    const closeEl = modal?.querySelector('.modal-close');
    if (!btn || !modal || !embed) return;

    const cloneLegendInto = () => {
      const src = document.getElementById('legend');
      if (!src) return;
      const list = src.querySelector('.legend-list')?.cloneNode(true);
      const title = document.createElement('div');
      title.className = 'legend-title';
      title.textContent = 'Legend';
      const wrap = document.createElement('div');
      wrap.className = 'legend-embed';
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
  const h   = v => (v == null ? '' : String(v));
  const has = v => !!(v != null && String(v).trim() !== '');
  const chip = (label, val) => has(val) ? `<span class="chip"><strong>${label}:</strong> ${h(val)}</span>` : '';

  function normKey(k){ return String(k || '').trim().toLowerCase(); }
  function pick(obj, keys){ for (const k of keys){ if (obj[k] != null && String(obj[k]).trim() !== '') return obj[k]; } return ''; }
  function slugify(str){ return String(str||'').toLowerCase().trim().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
  function uniq(arr){ return Array.from(new Set(arr.filter(Boolean))); }
  const setValueBoth = (mEl, dEl, v) => { if (mEl) mEl.value = v; if (dEl) dEl.value = v; };

  const debounce = (fn, ms=160) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

  const safeHTML = (html) => {
    if (window.DOMPurify?.sanitize) return window.DOMPurify.sanitize(html || '');
    const d = document.createElement('div'); d.textContent = String(html || ''); return d.innerHTML;
  };

  const CATEGORY_MAP = {
    'naturepreserve': 'naturepreserve', 'preserve': 'naturepreserve', 'natural-area': 'naturepreserve',
    'park': 'parks', 'parks': 'parks', 'county-park': 'parks', 'city-park': 'parks',
    'wpa': 'wpa', 'waterfowl': 'wpa', 'waterfowl-production': 'wpa', 'waterfowl-production-area': 'wpa',
    'kayak': 'kayak', // <— added (endpoints)
    'other': 'other'
  };
  function normalizeCategory(cat){ const s = slugify(cat || ''); return CATEGORY_MAP[s] || 'other'; }
  function getIconPath(category, overridePath){
    if (overridePath) return overridePath;
    const key = normalizeCategory(category);
    if (key === 'kayak') return 'data/icons/kayak.png';
    return `data/icons/${key}.png`;
  }

  function parseActivities(raw){
    if (!raw) return [];
    return String(raw)
      .split(/[;,|]/)
      .map(s => titleCase(s.trim()))
      .filter(Boolean);
  }

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

  function formatDescription(htmlOrText=''){
    const s = String(htmlOrText || '');
    const looksLikeHTML = /<\/?[a-z][\s\S]*>/i.test(s);
    if (looksLikeHTML) return s;
    const parts = s.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`);
    return parts.join('');
  }

  // Drawer
  const drawer = $('detail-drawer');
  const drawerBody = $('drawerBody');
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

  function openDetails(r){
    const website = r.website ? `<a class="btn" href="${r.website}" target="_blank" rel="noopener">Website ↗</a>` : '';
    const address = r.address ? `<span class="chip"><strong>Address:</strong> ${r.address}</span>` : '';
    const photo = r.photo ? `<img src="${r.photo}" alt="${r.name}" loading="lazy" style="margin:.6rem 0">` : '';

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

    const acts = drawerBody.querySelector('.acts[data-acts]');
    if (acts) requestAnimationFrame(() => layoutActs(acts));
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
        <p>The Ozaukee Interurban Trail was not always a trail, but the route of the Interurban Electric Railway...</p>
        <p>Workers used the railway to access factory jobs... Paramount Records.</p>
        <p>After the railway ceased operation... what is now known as the Ozaukee Interurban Trail.</p>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.4rem">
        <a class="btn small" href="https://www.interurbantrail.com/" target="_blank" rel="noopener">Official Website</a>
        <a class="btn small" href="https://joeywillman.github.io/ozaukee-interurbantrail-birding/" target="_blank" rel="noopener">Trailside Birding Guide</a>
      </div>
    </div>`;

  const trailStyle = { color:'#2f7c31', weight:4, opacity:0.9, dashArray:'8 6', lineJoin:'round' };

  fetch('data/trail.geojson')
    .then(r => r.json())
    .then(geo => {
      L.geoJSON(geo, {
        pane: 'trailPane',
        style: trailStyle,
        onEachFeature: (_, layer) => {
          const small = window.matchMedia('(max-width: 760px)').matches;
          layer.bindPopup(TRAIL_POPUP_HTML, {
            maxWidth: small ? 300 : 360,
            keepInView: true,
            autoPan: true,
            autoPanPaddingTopLeft: [16, small ? 90 : 30],
            autoPanPaddingBottomRight: [16, 16],
            closeButton: true
          });
          layer.setStyle({ className: 'trail-line' });
        }
      }).addTo(map);
    })
    .catch(err => console.error('Trail GeoJSON load error:', err));

  // ----- Park popups (unchanged) -----
  function popupHTML(r){
    const iconSrc = getIconPath(r.category, r.icon);
    const actsDataAttr = r.activities && r.activities.length
      ? ` data-acts='${JSON.stringify(r.activities)}'` : '';
    const photo = r.photo ? `<img src="${r.photo}" alt="${r.name}" loading="lazy" style="width:100%;border-radius:8px;margin:.4rem 0">` : '';
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

  function sidebarItemHTML(r){
    const iconSrc = getIconPath(r.category, r.icon);
    const sub = r.location || r.address || (r.category || '');
    const actsDataAttr = r.activities && r.activities.length
      ? ` data-acts='${JSON.stringify(r.activities)}'` : '';
    return `
      <img src="${iconSrc}" alt="">
      <div class="meta">
        <span class="title">${r.name}</span>
        <span class="sub">${sub}</span>
        ${ r.activities.length ? `<div class="acts"${actsDataAttr}></div>` : '' }
      </div>`;
  }

  function layoutActs(container){
    if (!container) return;
    let acts = [];
    try { acts = JSON.parse(container.getAttribute('data-acts') || '[]'); }
    catch (_) { acts = []; }
    container.innerHTML = '';
    if (!acts.length) return;

    const makeChip = (label, cls='') => {
      const el = document.createElement('span');
      el.className = 'chip' + (cls ? (' ' + cls) : '');
      el.textContent = label;
      return el;
    };

    let bestCount = 0;
    for (let i = 0; i < acts.length; i++) {
      container.innerHTML = '';
      for (let j = 0; j <= i; j++) container.appendChild(makeChip(acts[j]));
      const hidden = acts.length - (i + 1);
      if (hidden > 0) container.appendChild(makeChip(`+${hidden} more`, 'more'));
      if (container.scrollWidth <= container.clientWidth) bestCount = i + 1;
      else break;
    }

    container.innerHTML = '';
    if (bestCount === 0) { container.appendChild(makeChip(`+${acts.length} more`, 'more')); return; }
    for (let j = 0; j < bestCount; j++) container.appendChild(makeChip(acts[j]));
    const hiddenFinal = acts.length - bestCount;
    if (hiddenFinal > 0) container.appendChild(makeChip(`+${hiddenFinal} more`, 'more'));
  }

  function makeIcon(category, overridePath){
    const url = getIconPath(category, overridePath);
    return L.divIcon({
      html: `<div class="treasure-pin"><img src="${url}" alt=""></div>`,
      className: 'treasure-divicon',
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -30]
    });
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
      const actsEl = li.querySelector('.acts');
      if (actsEl) requestAnimationFrame(() => layoutActs(actsEl));
      li.addEventListener('click', ()=>{
        map.setView([r.lat, r.lon], Math.max(map.getZoom(), 14));
        m.openPopup();
        if (sidebar) sidebar.classList.remove('open');
        setTimeout(()=> map.invalidateSize(), 150);
      });
      listEl.appendChild(li);
    }
  }

  // Fit popup activity chips when popups open / window resizes
  map.on('popupopen', (e) => {
    const root = e?.popup?._contentNode || e?.popup?.getElement();
    const acts = root?.querySelector('.acts[data-acts]');
    if (acts) layoutActs(acts);
  });
  window.addEventListener('resize', () => {
    document.querySelectorAll('.leaflet-popup .acts[data-acts]').forEach(el => layoutActs(el));
  }, { passive: true });

  function clearLayers(){
    cluster.clearLayers();
    markers = [];
    markerById.clear();
    if (listEl) listEl.innerHTML = '';
  }

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
    const locations = uniq(data.map(r => r.location).filter(Boolean))
      .sort((a,b)=>a.localeCompare(b));
    const locOptions = locations.map(c=>`<option value="${c}">${c}</option>`).join('');
    setOptions(dLoc, locOptions, 'Location: All');
    setOptions(mLoc, locOptions, 'Location: All');

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

  const onSearch = debounce(applyFilters, 160);
  [dSearch, mSearch].filter(Boolean).forEach(el => el.addEventListener('input', onSearch));
  [dType,  mType ].filter(Boolean).forEach(el => el.addEventListener('change', applyFilters));
  [dLoc,   mLoc  ].filter(Boolean).forEach(el => el.addEventListener('change', applyFilters));
  [dAct,   mAct  ].filter(Boolean).forEach(el => el.addEventListener('change', applyFilters));

  // Details button (parks)
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('.js-details');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const m = id ? markerById.get(id) : null;
    const data = m?.feature?.properties;
    if (data) openDetails(data);
  });

  // ----- Load parks CSV -----
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

  // Normalize row from CSV (parks only)
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
    const activitiesRaw = pick(m, ['activities']);
    const locationRaw = pick(m, ['location','city','town','municipality']);

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

  // ===========================
  // === KAYAKING INTEGRATION ===
  // ===========================

  // Panes & style for route lines
  map.createPane('kayakPane');
  map.getPane('kayakPane').style.zIndex = 440;
  map.getPane('kayakPane').style.pointerEvents = 'auto';

  const KAYAK_CSV_URL     = 'data/kayakroutes.csv';
  const KAYAK_GEOJSON_URL = 'data/kayakroutes.geojson';

  let kayakById = new Map();
  let kayakLayer = null;

function kayakStyle(feature){
  const river = String((feature.properties?.River) || '').toLowerCase();
  const riverCls =
    river.includes('cedar creek') ? 'kayak--cedar' :
    river.includes('milwaukee')   ? 'kayak--milwaukee' : 'kayak--unknown';
  return {
    pane: 'kayakPane',
    weight: 4,
    opacity: 0.95,
    className: `kayak-line ${riverCls}`
  };
}

  // Popup: teaser view (truncate like parks)
  function kayakTeaserHTML(p){
    const title = h(p.Route_Name) + (has(p.Option_Name) ? ` — ${h(p.Option_Name)}` : '');
    const combined = [h(p.Notes), h(p.Route_Notes)].filter(Boolean).join('<br><br>');
    const teaser = has(combined) ? truncateHTML(combined, 240) : '<p><em>No notes yet.</em></p>';

    // Buttons in teaser
    const btns = [
      `<button class="btn small js-kayak-details" type="button" data-kayak-id="${h(p.Route_ID)}">Details</button>`
    ];
    if (has(p.Website_Info_Source)) {
      btns.push(`<a class="btn small" href="${h(p.Website_Info_Source)}" target="_blank" rel="noopener">Website</a>`);
    }
    if (has(p.Put_in_lat) && has(p.Put_in_lon)) {
      btns.push(`<a class="btn small" href="https://www.google.com/maps?daddr=${encodeURIComponent(p.Put_in_lat+','+p.Put_in_lon)} (Put-in)" target="_blank" rel="noopener">Put-in</a>`);
    }
    if (has(p.Take_out_lat) && has(p.Take_out_lon)) {
      btns.push(`<a class="btn small" href="https://www.google.com/maps?daddr=${encodeURIComponent(p.Take_out_lat+','+p.Take_out_lon)} (Take-out)" target="_blank" rel="noopener">Take-out</a>`);
    }

    return `
      <div class="popup">
        <div class="popup-head" style="display:flex; align-items:center; gap:.4rem;">
          <span class="legend-line legend-kayak" style="display:inline-block;width:18px;height:3px;border-radius:2px"></span>
          <h3 class="popup-title" style="margin:.1rem 0 .2rem; font-size:1.05rem;">${title || `Route ${h(p.Route_ID)}`}</h3>
        </div>

        <div class="meta-row" style="display:flex; flex-wrap:wrap; gap:.35rem; margin:.35rem 0 .25rem;">
          ${chip('Route ID', p.Route_ID)}
          ${chip('River', p.River)}
          ${chip('Location', p.Location)}
          ${chip('Distance (mi)', p.Distance_mi)}
        </div>

        <p><strong>Start:</strong> ${h(p.Start_Point)}</p>
        <p><strong>End:</strong> ${h(p.End_Point)}</p>

        <div class="popup-desc">${teaser}</div>

        <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.4rem">
          ${btns.join('')}
        </div>
      </div>`;
  }

  // Drawer details for kayak
  function openKayakDetails(p){
    const fullNotes = [h(p.Notes), h(p.Route_Notes)].filter(Boolean).join('<br><br>');
    const title = h(p.Route_Name) + (has(p.Option_Name) ? ` — ${h(p.Option_Name)}` : '');

    const putBtn  = (has(p.Put_in_lat)  && has(p.Put_in_lon))  ? `<a class="btn" href="https://www.google.com/maps?daddr=${encodeURIComponent(p.Put_in_lat+','+p.Put_in_lon)} (Put-in)" target="_blank" rel="noopener">Put-in</a>` : '';
    const takeBtn = (has(p.Take_out_lat) && has(p.Take_out_lon)) ? `<a class="btn" href="https://www.google.com/maps?daddr=${encodeURIComponent(p.Take_out_lat+','+p.Take_out_lon)} (Take-out)" target="_blank" rel="noopener">Take-out</a>` : '';
    const webBtn  = has(p.Website_Info_Source) ? `<a class="btn" href="${h(p.Website_Info_Source)}" target="_blank" rel="noopener">Website ↗</a>` : '';

    drawerBody.innerHTML = `
      <h2>${title || `Route ${h(p.Route_ID)}`}</h2>
      <div class="meta-row">
        ${chip('Route ID', p.Route_ID)}
        ${chip('River', p.River)}
        ${chip('Location', p.Location)}
        ${chip('Distance (mi)', p.Distance_mi)}
      </div>

      <div class="desc">
        ${ has(fullNotes) ? fullNotes : '<p><em>No notes yet.</em></p>'}
      </div>

      <div class="meta-row" style="margin-top:.6rem">
        ${putBtn} ${takeBtn} ${webBtn}
      </div>
    `;
    openDrawerA11y();
  }

  // Join + layer assembly
  function onEachKayakFeature(feature, layer){
    const props = feature.properties || {};
    const id = String(props.Route_ID ?? '').trim();
    const row = kayakById.get(id) || {};
    const joined = { ...props, ...row };

    // teaser popup
    layer.bindPopup(kayakTeaserHTML(joined), {
      maxWidth: 380, keepInView: true, autoPanPadding: [30,30]
    });
    layer.on('mouseover', () => layer.setStyle({ weight: 6 }));
    layer.on('mouseout',  () => layer.setStyle({ weight: 4 }));

    // delegate "Details" to open drawer
    layer.on('popupopen', (e) => {
      const root = e?.popup?._contentNode || e?.popup?.getElement();
      const btn = root?.querySelector('.js-kayak-details');
      if (btn) {
        btn.addEventListener('click', () => {
          e.popup.remove(); // close popup
          openKayakDetails(joined);
        }, { once: true });
      }
    });
  }

  // Endpoint markers (put-in / take-out)
  function addKayakEndpoint(lat, lon, label, routeName, typeLabel){
    if (!isFinite(lat) || !isFinite(lon)) return;
    const r = {
      id: `kayak-endpoint-${routeName}-${typeLabel}-${lat},${lon}`,
      name: `${routeName} — ${typeLabel}`,
      category: 'kayak',
      lat, lon,
      location: label || '',
      description: '',
      icon: 'data/icons/kayak.png',
      activities: []
    };
    const m = L.marker([lat, lon], { icon: makeIcon('kayak', 'data/icons/kayak.png') })
      .bindPopup(`
        <div class="popup">
          <div class="popup-head" style="display:flex; align-items:center; gap:.4rem;">
            <img src="${getIconPath('kayak','data/icons/kayak.png')}" alt="" width="20" height="20"/>
            <h3 class="popup-title" style="margin:.1rem 0 .2rem; font-size:1.05rem;">${routeName}</h3>
          </div>
          <div class="meta-row" style="display:flex; flex-wrap:wrap; gap:.35rem; margin:.35rem 0 .25rem;">
            <span class="chip">${typeLabel}</span>
            ${has(label) ? `<span class="chip muted">${label}</span>` : ''}
          </div>
          <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.2rem">
            <a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps?daddr=${encodeURIComponent(lat+','+lon)}">${typeLabel} Directions</a>
          </div>
        </div>
      `, { maxWidth: 320, keepInView: true, autoPanPadding: [30,30] });

    // Don’t add to sidebar list (keeps list focused on parks)
    m.feature = { properties: r };
    cluster.addLayer(m);
  }

  // Load CSV first (for joins & endpoints), then routes GeoJSON
  Papa.parse(KAYAK_CSV_URL, {
    header: true,
    download: true,
    dynamicTyping: true,
    complete: res => {
      kayakById = new Map();
      const rowsCSV = (res.data || []).filter(Boolean);
      rowsCSV.forEach(row => {
        const id = String(row.Route_ID ?? '').trim();
        if (id) kayakById.set(id, row);

        // endpoints (pins)
        const putLat  = parseFloat(row.Put_in_lat);
        const putLon  = parseFloat(row.Put_in_lon);
        const takeLat = parseFloat(row.Take_out_lat);
        const takeLon = parseFloat(row.Take_out_lon);
        const routeNm = h(row.Route_Name) + (has(row.Option_Name) ? ` — ${h(row.Option_Name)}` : h(row.Route_Name) ? '' : h(row.Route_ID));
        if (Number.isFinite(putLat) && Number.isFinite(putLon))  addKayakEndpoint(putLat,  putLon,  h(row.Start_Point), routeNm, 'Put-in');
        if (Number.isFinite(takeLat) && Number.isFinite(takeLon)) addKayakEndpoint(takeLat, takeLon, h(row.End_Point),   routeNm, 'Take-out');
      });

      // Routes linework
      fetch(KAYAK_GEOJSON_URL)
        .then(r => r.json())
        .then(geo => {
          kayakLayer = L.geoJSON(geo, {
            pane: 'kayakPane',
            style: kayakStyle,
            onEachFeature: onEachKayakFeature
          }).addTo(map);

          // Fit once (don’t yank view away from user later)
          try {
            const b = kayakLayer.getBounds();
            if (b.isValid()) map.fitBounds(b.pad(0.12));
          } catch(_) {}
        })
        .catch(err => console.error('Kayak GeoJSON load error:', err));
    },
    error: err => console.error('Kayak CSV parse error:', err)
  });

  // ===== Events for drawer & acts in drawer =====
  window.addEventListener('resize', () => {
    const acts = drawerBody?.querySelector('.acts[data-acts]');
    if (acts) layoutActs(acts);
  }, { passive: true });

  // ===== Expose for debug =====
  window.__map = map;
});
