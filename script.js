/* ==========================================================
   NYC room type predictor - script.js
   Works with index.html + style.css from the same folder.

   Expected API (FastAPI):
     GET  /health   -> anything below HTTP 500 counts as "connected"
     POST /predict  -> JSON body (see buildPayload below)
                       response: { prediction: 0|1|2 | "Private room" ...,
                                   probabilities: [p0, p1, p2] | {name: p} }
   Class order: 0 = Entire home/apt, 1 = Private room, 2 = Shared room.
   If your endpoint names differ, change CONFIG / buildPayload / parseResponse.
   ========================================================== */
(() => {
  'use strict';

  /* ---------------- Config ---------------- */
  const CONFIG = {
    defaultApi: 'https://nyc-room-type-prediction-a3sq.onrender.com',
    predictPath: '/predict',
    healthPath: '/health',
    timeoutMs: 15000,
    healthEveryMs: 20000,
    storageKey: 'nyc-room-api-url',
    maxHistory: 5,
  };

  const CLASSES = [
    { id: 0, name: 'Entire home/apt', short: 'entire home', color: '#f5b547',
      verdict: 'Guests would get the whole place to themselves, which is typical of an apartment or house listing.' },
    { id: 1, name: 'Private room', short: 'private room', color: '#46d3c2',
      verdict: 'Guests would get their own room but share the rest of the home with the host or others.' },
    { id: 2, name: 'Shared room', short: 'shared room', color: '#ff7096',
      verdict: 'Guests would share the sleeping space itself, which is typical of hostel-style, budget listings.' },
  ];

  /* ---------------- Geography ---------------- */
  // Map bounds for the location pad
  const LAT0 = 40.48, LAT1 = 40.93, LNG0 = -74.28, LNG1 = -73.68;
  const COS_LAT = Math.cos(40.7 * Math.PI / 180);

  const BOROUGHS = [
    { name: 'Manhattan',     short: 'Manhattan',  lat: 40.7831, lng: -73.9712 },
    { name: 'Brooklyn',      short: 'Brooklyn',   lat: 40.6501, lng: -73.9496 },
    { name: 'Queens',        short: 'Queens',     lat: 40.7282, lng: -73.7949 },
    { name: 'Bronx',         short: 'Bronx',      lat: 40.8448, lng: -73.8648 },
    { name: 'Staten Island', short: 'Staten Isl.', lat: 40.5795, lng: -74.1502 },
  ];

  // Approximate neighbourhood centres, most popular first
  const HOODS = {
    'Manhattan': [
      ['Midtown', 40.7549, -73.9840], ['Harlem', 40.8116, -73.9465], ['Hell\'s Kitchen', 40.7638, -73.9918],
      ['East Village', 40.7265, -73.9815], ['Upper West Side', 40.7870, -73.9754], ['Upper East Side', 40.7736, -73.9566],
      ['Chelsea', 40.7465, -73.9973], ['Lower East Side', 40.7150, -73.9843], ['East Harlem', 40.7957, -73.9389],
      ['Greenwich Village', 40.7336, -74.0027], ['West Village', 40.7358, -74.0036], ['Financial District', 40.7075, -74.0089],
      ['Washington Heights', 40.8417, -73.9394], ['Murray Hill', 40.7479, -73.9757], ['Kips Bay', 40.7423, -73.9801],
      ['Gramercy', 40.7368, -73.9845], ['SoHo', 40.7233, -74.0030], ['Chinatown', 40.7158, -73.9970],
      ['Nolita', 40.7223, -73.9955], ['Tribeca', 40.7163, -74.0086], ['Morningside Heights', 40.8100, -73.9626],
      ['Theater District', 40.7590, -73.9845], ['Inwood', 40.8677, -73.9212],
    ],
    'Brooklyn': [
      ['Williamsburg', 40.7081, -73.9571], ['Bedford-Stuyvesant', 40.6872, -73.9418], ['Bushwick', 40.6944, -73.9213],
      ['Crown Heights', 40.6694, -73.9422], ['Greenpoint', 40.7304, -73.9515], ['Park Slope', 40.6710, -73.9814],
      ['Fort Greene', 40.6895, -73.9750], ['Clinton Hill', 40.6896, -73.9661], ['Flatbush', 40.6410, -73.9583],
      ['Prospect-Lefferts Gardens', 40.6600, -73.9450], ['Brooklyn Heights', 40.6960, -73.9936], ['Carroll Gardens', 40.6795, -73.9991],
      ['Boerum Hill', 40.6848, -73.9845], ['Cobble Hill', 40.6860, -73.9962], ['DUMBO', 40.7033, -73.9881],
      ['Gowanus', 40.6737, -73.9899], ['Red Hook', 40.6734, -74.0083], ['Sunset Park', 40.6458, -74.0124],
      ['Bay Ridge', 40.6264, -74.0299], ['Kensington', 40.6400, -73.9735], ['East Flatbush', 40.6520, -73.9310],
      ['Coney Island', 40.5755, -73.9707],
    ],
    'Queens': [
      ['Astoria', 40.7644, -73.9235], ['Long Island City', 40.7447, -73.9485], ['Flushing', 40.7675, -73.8331],
      ['Ridgewood', 40.7043, -73.9018], ['Sunnyside', 40.7433, -73.9196], ['Woodside', 40.7454, -73.9070],
      ['Jackson Heights', 40.7557, -73.8831], ['Elmhurst', 40.7370, -73.8801], ['Jamaica', 40.7027, -73.7890],
      ['Forest Hills', 40.7181, -73.8448], ['Ditmars Steinway', 40.7745, -73.9070], ['Maspeth', 40.7230, -73.9126],
      ['Corona', 40.7449, -73.8642], ['Bayside', 40.7686, -73.7770], ['Kew Gardens', 40.7057, -73.8272],
      ['Richmond Hill', 40.6958, -73.8272], ['Howard Beach', 40.6571, -73.8430], ['Rockaway Beach', 40.5998, -73.8160],
      ['Far Rockaway', 40.6055, -73.7555],
    ],
    'Bronx': [
      ['Mott Haven', 40.8090, -73.9229], ['Concourse', 40.8231, -73.9212], ['Fordham', 40.8610, -73.8901],
      ['Kingsbridge', 40.8817, -73.9049], ['Longwood', 40.8163, -73.8975], ['Port Morris', 40.8025, -73.9159],
      ['Morrisania', 40.8318, -73.9066], ['Highbridge', 40.8365, -73.9264], ['Melrose', 40.8195, -73.9148],
      ['Belmont', 40.8563, -73.8880], ['Williamsbridge', 40.8790, -73.8560], ['Pelham Bay', 40.8506, -73.8300],
      ['Throgs Neck', 40.8203, -73.8199], ['City Island', 40.8469, -73.7864], ['Riverdale', 40.8900, -73.9126],
      ['Woodlawn', 40.8988, -73.8630],
    ],
    'Staten Island': [
      ['St. George', 40.6437, -74.0764], ['Tompkinsville', 40.6367, -74.0899], ['Stapleton', 40.6270, -74.0775],
      ['Clifton', 40.6220, -74.0750], ['Port Richmond', 40.6349, -74.1367], ['West Brighton', 40.6318, -74.1180],
      ['Rosebank', 40.6146, -74.0680], ['Concord', 40.6040, -74.0740], ['Arrochar', 40.5951, -74.0687],
      ['Todt Hill', 40.5965, -74.1119], ['New Springville', 40.5900, -74.1600], ['Great Kills', 40.5540, -74.1510],
      ['Eltingville', 40.5440, -74.1640], ['Tottenville', 40.5100, -74.2440],
    ],
  };
  const ALL_HOODS = Object.entries(HOODS).flatMap(([borough, list]) =>
    list.map(([name, lat, lng]) => ({ name, borough, lat, lng })));

  const hoodsOf = (borough) => ALL_HOODS.filter((h) => h.borough === borough);
  const findHood = (name, borough) => {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    return ALL_HOODS.find((h) => h.name.toLowerCase() === n && (!borough || h.borough === borough))
        || ALL_HOODS.find((h) => h.name.toLowerCase() === n) || null;
  };

  /* ---------------- Numeric fields ---------------- */
  const FIELDS = {
    latitude:  { label: 'Latitude',  min: 40.49, max: 40.92, int: false, fixed: 4 },
    longitude: { label: 'Longitude', min: -74.26, max: -73.69, int: false, fixed: 4 },
    price:     { label: 'Price', min: 0, max: 10000, int: false, slider: true },
    minimum_nights: { label: 'Minimum nights', min: 1, max: 365, int: true, slider: true },
    availability_365: { label: 'Availability', min: 0, max: 365, int: true, slider: true },
    number_of_reviews: { label: 'Total reviews', min: 0, max: 10000, int: true, slider: true },
    reviews_per_month: { label: 'Reviews per month', min: 0, max: 100, int: false, slider: true },
    calculated_host_listings_count: { label: 'Listings by this host', min: 0, max: 1000, int: true, slider: true },
  };

  const DEFAULTS = {
    borough: 'Manhattan', neighbourhood: 'Midtown', latitude: 40.7549, longitude: -73.984,
    price: 150, minimum_nights: 3, availability_365: 120,
    number_of_reviews: 20, reviews_per_month: 0.5, calculated_host_listings_count: 1,
  };

  const PRESETS = [
    { label: 'Midtown apartment', borough: 'Manhattan', neighbourhood: 'Midtown', price: 220, minimum_nights: 3,
      availability_365: 210, number_of_reviews: 45, reviews_per_month: 1.2, calculated_host_listings_count: 2 },
    { label: 'Bushwick spare room', borough: 'Brooklyn', neighbourhood: 'Bushwick', price: 55, minimum_nights: 2,
      availability_365: 300, number_of_reviews: 18, reviews_per_month: 0.6, calculated_host_listings_count: 1 },
    { label: 'Hostel bunk', borough: 'Manhattan', neighbourhood: 'Harlem', price: 32, minimum_nights: 1,
      availability_365: 360, number_of_reviews: 110, reviews_per_month: 3.2, calculated_host_listings_count: 6 },
    { label: 'Astoria flat', borough: 'Queens', neighbourhood: 'Astoria', price: 120, minimum_nights: 30,
      availability_365: 90, number_of_reviews: 6, reviews_per_month: 0.2, calculated_host_listings_count: 1 },
  ];

  /* ---------------- Helpers ---------------- */
  const $ = (id) => document.getElementById(id);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (p) => (p > 0 && p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`);
  const money = (n) => `$${Number(n).toLocaleString('en-US')}`;

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- Element refs ---------------- */
  const root = document.documentElement;
  const el = {
    form: $('form'), result: $('result'),
    apiStatus: $('apiStatus'), apiStatusText: $('apiStatusText'), apiUrl: $('apiUrl'),
    boroughSeg: $('boroughSeg'), combo: $('combo'), hoodInput: $('hoodInput'), hoodList: $('hoodList'),
    pad: $('pad'), padSvg: $('padSvg'), presetList: $('presetList'),
    ringSub: $('ringSub'), ringLabel: $('ringLabel'), ringPct: $('ringPct'), verdict: $('verdict'),
    bars: $('bars'), predictBtn: $('predictBtn'), predictBtnText: $('predictBtnText'), resetBtn: $('resetBtn'),
    apiError: $('apiError'), historyWrap: $('historyWrap'), history: $('history'), skyline: $('skyline'),
  };

  let borough = DEFAULTS.borough;
  let busy = false;
  let windows = [];
  let pin = null;
  const anchors = {};
  const history = [];

  /* ==========================================================
     Skyline
     ========================================================== */
  function buildSkyline() {
    const W = 1440, H = 360;
    const rnd = mulberry32(42);
    el.skyline.setAttribute('viewBox', `0 0 ${W} ${H}`);
    el.skyline.setAttribute('preserveAspectRatio', 'xMidYMax slice');
    let x = -10, out = '';
    while (x < W) {
      const w = 46 + Math.floor(rnd() * 56);
      const tall = rnd() < 0.14;
      const h = Math.floor(tall ? 210 + rnd() * 90 : 70 + rnd() * 120);
      const y = H - h;
      out += `<rect class="bld${rnd() < 0.5 ? ' alt' : ''}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
      if (tall) {
        const cx = x + w / 2;
        out += `<line class="ant" x1="${cx}" y1="${y}" x2="${cx}" y2="${y - 26}"/>`;
      }
      const cols = Math.floor((w - 14) / 12);
      const rows = Math.floor((h - 18) / 16);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rnd() < 0.22) continue;
          const rv = rnd();
          out += `<rect class="win" data-r="${rv.toFixed(3)}" x="${x + 8 + c * 12}" y="${y + 10 + r * 16}" width="5" height="8" rx="1" style="transition-delay:${Math.round(rv * 700)}ms"/>`;
        }
      }
      x += w + Math.floor(rnd() * 6);
    }
    el.skyline.innerHTML = out;
    windows = Array.from(el.skyline.querySelectorAll('.win')).map((node) => ({ node, r: Number(node.dataset.r) }));
  }

  function lightSkyline(level) {
    // level 0 = dark, 1 = brightest
    const ratio = level <= 0 ? 0 : 0.2 + 0.5 * level;
    for (const { node, r } of windows) {
      const on = r < ratio;
      node.classList.toggle('lit', on);
      node.style.fill = on ? 'var(--accent)' : '';
    }
  }

  /* ==========================================================
     Location pad
     ========================================================== */
  const toX = (lng) => ((lng - LNG0) / (LNG1 - LNG0)) * 300;
  const toY = (lat) => ((LAT1 - lat) / (LAT1 - LAT0)) * 300;

  function buildPad() {
    let svg = '';
    for (let i = 1; i < 6; i++) {
      svg += `<line class="grid-line" x1="${i * 50}" y1="0" x2="${i * 50}" y2="300"/>`;
      svg += `<line class="grid-line" x1="0" y1="${i * 50}" x2="300" y2="${i * 50}"/>`;
    }
    for (const b of BOROUGHS) {
      const x = toX(b.lng), y = toY(b.lat);
      svg += `<circle class="anchor" data-b="${esc(b.name)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`;
      svg += `<text class="anchor-label" data-b="${esc(b.name)}" x="${x.toFixed(1)}" y="${(y + 17).toFixed(1)}" text-anchor="middle">${esc(b.short)}</text>`;
    }
    svg += '<g id="pin"><circle class="halo" r="14"/><circle class="core" r="6.5"/></g>';
    el.padSvg.innerHTML = svg;
    pin = $('pin');
    el.padSvg.querySelectorAll('[data-b]').forEach((n) => {
      (anchors[n.dataset.b] ||= []).push(n);
    });

    let dragging = false;
    const fromPointer = (e) => {
      const rect = el.padSvg.getBoundingClientRect();
      const fx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const fy = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      const lng = LNG0 + fx * (LNG1 - LNG0);
      const lat = LAT1 - fy * (LAT1 - LAT0);
      setLocation(lat, lng, { glide: false });
      detectHood(lat, lng);
    };
    const ping = () => {
      pin.classList.remove('ping');
      void pin.getBoundingClientRect();
      pin.classList.add('ping');
      setTimeout(() => pin.classList.remove('ping'), 750);
    };
    el.pad.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      el.pad.setPointerCapture(e.pointerId);
      el.pad.focus({ preventScroll: true });
      fromPointer(e);
    });
    el.pad.addEventListener('pointermove', (e) => { if (dragging) fromPointer(e); });
    const stop = () => { if (dragging) { dragging = false; ping(); } };
    el.pad.addEventListener('pointerup', stop);
    el.pad.addEventListener('pointercancel', stop);

    el.pad.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.01 : 0.002;
      const d = { ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      const lat = clamp((Number(readNum('latitude')) || DEFAULTS.latitude) + d[0], LAT0, LAT1);
      const lng = clamp((Number(readNum('longitude')) || DEFAULTS.longitude) + d[1], LNG0, LNG1);
      setLocation(lat, lng, { glide: false });
      detectHood(lat, lng);
    });
  }

  function movePin(lat, lng, glide = true) {
    if (!pin) return;
    pin.classList.toggle('glide', glide);
    pin.style.transform = `translate(${clamp(toX(lng), 0, 300).toFixed(1)}px, ${clamp(toY(lat), 0, 300).toFixed(1)}px)`;
  }

  function setLocation(lat, lng, { glide = true } = {}) {
    setField('latitude', lat);
    setField('longitude', lng);
    clearError('latitude');
    clearError('longitude');
    movePin(lat, lng, glide);
  }

  function detectHood(lat, lng) {
    let best = null, bestD = Infinity;
    for (const h of ALL_HOODS) {
      const d = (h.lat - lat) ** 2 + ((h.lng - lng) * COS_LAT) ** 2;
      if (d < bestD) { bestD = d; best = h; }
    }
    if (!best) return;
    setBorough(best.name === el.hoodInput.value ? borough : best.borough, { pickHood: false, movePin: false });
    el.hoodInput.value = best.name;
    setComboInvalid(false);
  }

  /* ==========================================================
     Borough + neighbourhood
     ========================================================== */
  function buildBoroughSeg() {
    el.boroughSeg.innerHTML = '';
    BOROUGHS.forEach((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.dataset.b = b.name;
      btn.textContent = b.name;
      btn.addEventListener('click', () => setBorough(b.name, { pickHood: true, movePin: true }));
      el.boroughSeg.appendChild(btn);
    });
    el.boroughSeg.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const i = BOROUGHS.findIndex((b) => b.name === borough);
      const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
      const next = BOROUGHS[(i + dir + BOROUGHS.length) % BOROUGHS.length].name;
      setBorough(next, { pickHood: true, movePin: true });
      el.boroughSeg.querySelector(`[data-b="${next}"]`).focus();
    });
  }

  function setBorough(name, { pickHood = true, movePin: move = true } = {}) {
    borough = name;
    el.boroughSeg.querySelectorAll('button').forEach((btn) => {
      const on = btn.dataset.b === name;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    });
    for (const [b, nodes] of Object.entries(anchors)) nodes.forEach((n) => n.classList.toggle('on', b === name));
    if (pickHood) {
      const first = hoodsOf(name)[0];
      if (first) selectHood(first, move);
    }
  }

  /* Combobox */
  let hoodOptions = [];
  let hoodActive = -1;

  function renderHoodList(showAll) {
    const q = showAll ? '' : el.hoodInput.value.trim().toLowerCase();
    hoodOptions = hoodsOf(borough).filter((h) => h.name.toLowerCase().includes(q));
    el.hoodList.innerHTML = hoodOptions.length
      ? hoodOptions.map((h, i) => `<li role="option" id="hood-opt-${i}" data-i="${i}" aria-selected="false">${esc(h.name)}</li>`).join('')
      : '<li class="empty" role="presentation">No match. The text you typed will be used as is.</li>';
    hoodActive = -1;
    el.hoodInput.removeAttribute('aria-activedescendant');
    el.hoodList.hidden = false;
    el.hoodInput.setAttribute('aria-expanded', 'true');
  }

  function closeHoodList() {
    el.hoodList.hidden = true;
    el.hoodInput.setAttribute('aria-expanded', 'false');
    hoodActive = -1;
  }

  function highlightHood(i) {
    const items = el.hoodList.querySelectorAll('li[role="option"]');
    if (!items.length) return;
    hoodActive = (i + items.length) % items.length;
    items.forEach((li, idx) => li.setAttribute('aria-selected', String(idx === hoodActive)));
    const active = items[hoodActive];
    el.hoodInput.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }

  function selectHood(h, move = true) {
    el.hoodInput.value = h.name;
    setComboInvalid(false);
    closeHoodList();
    if (move) setLocation(h.lat, h.lng);
  }

  function commitHoodText() {
    const typed = el.hoodInput.value.trim();
    const h = findHood(typed, borough);
    if (h) {
      if (h.borough !== borough) setBorough(h.borough, { pickHood: false });
      el.hoodInput.value = h.name;
      setLocation(h.lat, h.lng);
    }
    validateHood();
  }

  function setComboInvalid(bad, msg = '') {
    el.combo.dataset.invalid = bad ? 'true' : 'false';
    el.combo.querySelector('[data-err="neighbourhood"]').textContent = bad ? msg : '';
  }
  function validateHood() {
    const ok = el.hoodInput.value.trim() !== '';
    setComboInvalid(!ok, 'Choose or type a neighbourhood.');
    return ok;
  }

  function wireCombobox() {
    el.hoodInput.addEventListener('focus', () => renderHoodList(true));
    el.hoodInput.addEventListener('input', () => { setComboInvalid(false); renderHoodList(false); });
    el.hoodInput.addEventListener('blur', () => { closeHoodList(); commitHoodText(); });
    el.hoodInput.addEventListener('keydown', (e) => {
      const open = !el.hoodList.hidden;
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) renderHoodList(true); highlightHood(hoodActive + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (!open) renderHoodList(true); highlightHood(hoodActive - 1); }
      else if (e.key === 'Enter' && open) {
        if (hoodActive >= 0 && hoodOptions[hoodActive]) { e.preventDefault(); selectHood(hoodOptions[hoodActive]); }
        else { closeHoodList(); }
      } else if (e.key === 'Escape') { closeHoodList(); }
    });
    el.hoodList.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-i]');
      if (!li) return;
      e.preventDefault(); // keep focus, avoid blur firing first
      selectHood(hoodOptions[Number(li.dataset.i)]);
    });
  }

  /* ==========================================================
     Numeric fields, sliders, validation
     ========================================================== */
  function fieldEls(key) {
    return {
      wrap: document.querySelector(`.field[data-key="${key}"]`),
      input: $(`in-${key}`),
      slider: $(`sl-${key}`),
    };
  }

  function paintSlider(slider) {
    const min = Number(slider.min), max = Number(slider.max);
    const p = ((clamp(Number(slider.value), min, max) - min) / (max - min)) * 100;
    slider.style.setProperty('--p', `${p}%`);
  }

  function setField(key, value) {
    const { input, slider } = fieldEls(key);
    const f = FIELDS[key];
    input.value = f.fixed ? Number(value).toFixed(f.fixed) : String(value);
    if (slider) {
      slider.value = clamp(Number(value), Number(slider.min), Number(slider.max));
      paintSlider(slider);
    }
  }

  function readNum(key) {
    const raw = fieldEls(key).input.value.trim();
    return raw === '' ? NaN : Number(raw);
  }

  function showError(key, msg) {
    const { wrap } = fieldEls(key);
    wrap.dataset.invalid = 'true';
    wrap.querySelector('.err').textContent = msg;
  }
  function clearError(key) {
    const { wrap } = fieldEls(key);
    wrap.dataset.invalid = 'false';
    wrap.querySelector('.err').textContent = '';
  }

  function validateField(key) {
    const f = FIELDS[key];
    const raw = fieldEls(key).input.value.trim();
    const n = Number(raw);
    let msg = '';
    if (raw === '') msg = `${f.label} is required.`;
    else if (!Number.isFinite(n)) msg = 'Enter a number.';
    else if (f.int && !Number.isInteger(n)) msg = 'Use a whole number.';
    else if (n < f.min || n > f.max) msg = `Must be between ${f.min} and ${f.max}.`;
    if (msg) { showError(key, msg); return false; }
    clearError(key);
    return true;
  }

  function validateAll() {
    let firstBad = null;
    if (!validateHood()) firstBad = el.hoodInput;
    for (const key of Object.keys(FIELDS)) {
      if (!validateField(key) && !firstBad) firstBad = fieldEls(key).input;
    }
    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  function wireFields() {
    for (const key of Object.keys(FIELDS)) {
      const { input, slider } = fieldEls(key);
      if (slider) {
        slider.addEventListener('input', () => {
          input.value = slider.value;
          paintSlider(slider);
          clearError(key);
        });
      }
      input.addEventListener('input', () => {
        clearError(key);
        const n = Number(input.value);
        if (slider && input.value.trim() !== '' && Number.isFinite(n)) {
          slider.value = clamp(n, Number(slider.min), Number(slider.max));
          paintSlider(slider);
        }
        if (key === 'latitude' || key === 'longitude') {
          const lat = readNum('latitude'), lng = readNum('longitude');
          if (Number.isFinite(lat) && Number.isFinite(lng)) movePin(lat, lng, true);
        }
      });
      input.addEventListener('change', () => validateField(key));
    }
  }

  /* ==========================================================
     Form values
     ========================================================== */
  function readValues() {
    const v = { borough, neighbourhood: el.hoodInput.value.trim() };
    for (const key of Object.keys(FIELDS)) v[key] = readNum(key);
    return v;
  }

  function applyValues(v) {
    setBorough(v.borough, { pickHood: false, movePin: false });
    let lat = v.latitude, lng = v.longitude;
    if (lat == null || lng == null) {
      const h = findHood(v.neighbourhood, v.borough);
      const b = BOROUGHS.find((x) => x.name === v.borough);
      lat = h ? h.lat : b.lat;
      lng = h ? h.lng : b.lng;
    }
    el.hoodInput.value = v.neighbourhood;
    setComboInvalid(false);
    for (const key of Object.keys(FIELDS)) {
      if (key === 'latitude' || key === 'longitude') continue;
      setField(key, v[key]);
      clearError(key);
    }
    setLocation(lat, lng);
  }

  function buildPayload(v) {
    return {
      neighbourhood_group: v.borough,
      neighbourhood: v.neighbourhood,
      latitude: v.latitude,
      longitude: v.longitude,
      price: v.price,
      minimum_nights: v.minimum_nights,
      number_of_reviews: v.number_of_reviews,
      reviews_per_month: v.reviews_per_month,
      calculated_host_listings_count: v.calculated_host_listings_count,
      availability_365: v.availability_365,
    };
  }

  /* ==========================================================
     API
     ========================================================== */
  const apiBase = () => (el.apiUrl.value.trim() || CONFIG.defaultApi).replace(/\/+$/, '');

  async function request(path, options = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.timeoutMs);
    try {
      return await fetch(apiBase() + path, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function setApiStatus(state) {
    el.apiStatus.dataset.state = state;
    el.apiStatusText.textContent =
      { ok: 'API connected', down: 'API unreachable', checking: 'Checking API' }[state];
  }

  async function checkHealth() {
    setApiStatus('checking');
    try {
      const res = await request(CONFIG.healthPath);
      setApiStatus(res.status < 500 ? 'ok' : 'down');
    } catch {
      setApiStatus('down');
    }
  }

  function classIdFrom(x) {
    if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 3) return x;
    if (typeof x !== 'string') return null;
    const s = x.trim().toLowerCase();
    if (/^[012]$/.test(s)) return Number(s);
    if (s.includes('private')) return 1;
    if (s.includes('shared')) return 2;
    if (s.includes('entire') || s.includes('home') || s.includes('apt')) return 0;
    return null;
  }

  function parseResponse(data) {
    const d = data && typeof data === 'object' ? data : {};
    const rawProbs = d.probabilities ?? d.probs ?? d.proba ?? d.probability ?? d.class_probabilities ?? null;
    let probs = null;
    if (Array.isArray(rawProbs) && rawProbs.length === 3) {
      probs = rawProbs.map(Number);
    } else if (rawProbs && typeof rawProbs === 'object') {
      probs = [NaN, NaN, NaN];
      for (const [k, val] of Object.entries(rawProbs)) {
        const id = classIdFrom(k);
        if (id !== null) probs[id] = Number(val);
      }
    }
    if (probs && probs.some((p) => !Number.isFinite(p))) probs = null;
    if (probs) {
      const sum = probs.reduce((a, b) => a + b, 0);
      if (sum > 1.5) probs = probs.map((p) => p / 100); // sent as percentages
      probs = probs.map((p) => clamp(p, 0, 1));
    }
    let top = classIdFrom(d.prediction ?? d.predicted_class ?? d.class ?? d.label ?? d.room_type ?? d.predicted_label);
    if (top === null && probs) top = probs.indexOf(Math.max(...probs));
    if (top === null) throw new Error('The API response did not include a prediction.');
    let conf = probs ? probs[top] : null;
    if (conf === null && Number.isFinite(Number(d.confidence))) conf = clamp(Number(d.confidence), 0, 1);
    return { top, probs, conf };
  }

  function showError422(detail) {
    const lines = [];
    for (const item of detail) {
      const loc = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : '';
      const msg = item.msg || 'invalid value';
      if (FIELDS[loc]) showError(loc, msg);
      lines.push(loc ? `${loc}: ${msg}` : msg);
    }
    return lines.join('; ');
  }

  function showApiError(html) {
    el.apiError.innerHTML = html;
    el.apiError.hidden = false;
  }

  /* ==========================================================
     Result rendering
     ========================================================== */
  const CIRC = 604; // matches stroke-dasharray in the CSS (2 * PI * 96)

  function buildBars() {
    el.bars.innerHTML = CLASSES.map((c) =>
      `<li style="--c:${c.color}" data-id="${c.id}">
         <span class="name"><span class="swatch"></span>${esc(c.name)}</span>
         <span class="val">-</span>
         <span class="track"><span class="fill"></span></span>
       </li>`).join('');
  }

  function paintArcs(probs) {
    const arcs = el.result.querySelectorAll('.arc');
    let start = 0;
    const visible = probs ? probs.filter((p) => p > 0.005).length : 0;
    arcs.forEach((arc, i) => {
      const p = probs ? probs[i] : 0;
      const gap = visible > 1 && p > 0.005 ? 5 : 0;
      const len = Math.max(0, p * CIRC - gap);
      arc.style.strokeDasharray = `${len.toFixed(1)} ${CIRC}`;
      arc.style.strokeDashoffset = `${(-start).toFixed(1)}`;
      start += p * CIRC;
    });
  }

  function paintBars(probs, top) {
    el.bars.querySelectorAll('li').forEach((li, i) => {
      const p = probs ? probs[i] : (i === top ? 1 : 0);
      li.classList.toggle('top', i === top);
      li.querySelector('.val').textContent = probs ? pct(probs[i]) : '';
      li.querySelector('.fill').style.transform = `scaleX(${p})`;
    });
  }

  function resetBars() {
    el.bars.querySelectorAll('li').forEach((li) => {
      li.classList.remove('top');
      li.querySelector('.val').textContent = '-';
      li.querySelector('.fill').style.transform = 'scaleX(0)';
    });
  }

  function verdictText({ top, probs }) {
    const c = CLASSES[top];
    if (!probs) return c.verdict;
    const order = [0, 1, 2].sort((a, b) => probs[b] - probs[a]);
    const second = CLASSES[order[1]];
    const margin = probs[order[0]] - probs[order[1]];
    if (probs[top] >= 0.8) return `A strong match. ${c.verdict}`;
    if (probs[top] >= 0.55 && margin >= 0.15) return `Most likely ${c.short}. ${c.verdict}`;
    return `A close call between ${c.short} and ${second.short}, so treat this one with caution.`;
  }

  function setIdle() {
    el.result.dataset.state = 'idle';
    delete root.dataset.class;
    el.ringSub.textContent = 'Ready';
    el.ringLabel.textContent = 'No prediction yet';
    el.ringPct.textContent = '';
    el.verdict.textContent = 'Fill in the listing details, then predict.';
    paintArcs(null);
    resetBars();
    lightSkyline(0);
  }

  function setLoading() {
    el.result.dataset.state = 'loading';
    el.ringSub.textContent = 'Thinking';
    el.ringLabel.textContent = 'Predicting';
    el.ringPct.textContent = '';
    el.verdict.textContent = 'Asking the model about this listing.';
    paintArcs(null);
    resetBars();
    lightSkyline(0);
  }

  function showResult(parsed) {
    const { top, probs, conf } = parsed;
    const c = CLASSES[top];
    root.dataset.class = String(top);
    el.result.dataset.state = 'done';
    el.ringSub.textContent = 'Predicted type';
    el.ringLabel.textContent = c.name;
    el.ringPct.textContent = conf != null ? `${pct(conf)} confident` : '';
    el.verdict.textContent = verdictText(parsed);
    lightSkyline(conf != null ? conf : 0.6);
    // two frames so the CSS transitions start from the previous values
    requestAnimationFrame(() => requestAnimationFrame(() => {
      paintArcs(probs || [0, 0, 0].map((_, i) => (i === top ? 1 : 0)));
      paintBars(probs, top);
    }));
  }

  /* ==========================================================
     Predict + history
     ========================================================== */
  function setBusy(on) {
    busy = on;
    el.predictBtn.disabled = on;
    el.predictBtnText.textContent = on ? 'Predicting' : 'Predict room type';
  }

  async function predict(evt) {
    if (evt) evt.preventDefault();
    if (busy) return;
    el.apiError.hidden = true;
    if (!validateAll()) return;

    const values = readValues();
    setBusy(true);
    setLoading();
    try {
      const res = await request(CONFIG.predictPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(buildPayload(values)),
      });
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON body */ }

      if (!res.ok) {
        let detail = `The API returned HTTP ${res.status}.`;
        if (res.status === 422 && data && Array.isArray(data.detail)) detail = `The API rejected the input (${showError422(data.detail)}).`;
        else if (data && typeof data.detail === 'string') detail = data.detail;
        setIdle();
        showApiError(esc(detail));
        setApiStatus('ok');
        return;
      }

      const parsed = parseResponse(data);
      setApiStatus('ok');
      showResult(parsed);
      addHistory(values, parsed);
    } catch (err) {
      setIdle();
      if (err instanceof TypeError || err.name === 'AbortError') {
        setApiStatus('down');
        showApiError(`Could not reach the API at <code>${esc(apiBase())}</code>. Check that the server is running and allows requests from this page (CORS).`);
      } else {
        showApiError(esc(err.message || 'Something went wrong.'));
      }
    } finally {
      setBusy(false);
    }
  }

  function addHistory(values, parsed) {
    history.unshift({ values, parsed });
    history.length = Math.min(history.length, CONFIG.maxHistory);
    renderHistory(true);
  }

  function renderHistory(animateFirst) {
    el.historyWrap.hidden = history.length === 0;
    el.history.innerHTML = '';
    history.forEach((item, i) => {
      const c = CLASSES[item.parsed.top];
      const li = document.createElement('li');
      if (animateFirst && i === 0) li.className = 'enter';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.setProperty('--c', c.color);
      btn.innerHTML =
        `<span class="h-dot"></span>
         <span class="h-main">${esc(c.name)}<span class="h-sub">${esc(item.values.neighbourhood)}, ${esc(item.values.borough)} &middot; ${esc(money(item.values.price))}</span></span>
         <span class="h-pct">${item.parsed.conf != null ? pct(item.parsed.conf) : ''}</span>`;
      btn.addEventListener('click', () => {
        applyValues(item.values);
        el.apiError.hidden = true;
        showResult(item.parsed);
      });
      li.appendChild(btn);
      el.history.appendChild(li);
    });
  }

  /* ==========================================================
     Presets, reset, API url
     ========================================================== */
  function buildPresets() {
    el.presetList.innerHTML = '';
    PRESETS.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = p.label;
      btn.addEventListener('click', () => {
        applyValues(p);
        predict();
      });
      el.presetList.appendChild(btn);
    });
  }

  function resetAll() {
    applyValues(DEFAULTS);
    el.apiError.hidden = true;
    setIdle();
  }

  function initApiUrl() {
    let saved = '';
    try { saved = localStorage.getItem(CONFIG.storageKey) || ''; } catch { /* storage unavailable */ }
    el.apiUrl.value = saved || CONFIG.defaultApi;
    el.apiUrl.addEventListener('change', () => {
      try { localStorage.setItem(CONFIG.storageKey, el.apiUrl.value.trim()); } catch { /* ignore */ }
      checkHealth();
    });
  }

  /* ==========================================================
     Init
     ========================================================== */
  function init() {
    buildSkyline();
    buildBars();
    buildPad();
    buildBoroughSeg();
    buildPresets();
    wireCombobox();
    wireFields();
    initApiUrl();

    el.form.addEventListener('submit', predict);
    el.resetBtn.addEventListener('click', resetAll);

    resetAll();
    // place the pin without a glide on first paint
    movePin(DEFAULTS.latitude, DEFAULTS.longitude, false);

    checkHealth();
    setInterval(() => { if (!document.hidden && !busy) checkHealth(); }, CONFIG.healthEveryMs);
  }

  init();
})();
