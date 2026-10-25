/* ndea shell prototype — shared mock data, workspace state and canvas placeholders.
   Each Shell*.dc.html calls NDEA.vals(this, shellId, opts) from renderVals(). */
(function () {
  if (window.NDEA) return;
  const rng = (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = (r) => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const pad = (n, k) => String(n).padStart(k, '0');
  const clock = () => { const d = new Date(); return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2); };

  const DS = {
    cp7: { id: 'cp7', name: 'cpg0016 · batch 7', kind: 'cp', n: 48312, unit: 'obs', catField: 'treatment', numField: 'cell_area', fields: 14, seed: 7,
      cats: [['DMSO', 9412], ['Staurosporine', 6108], ['Nocodazole', 7731], ['Taxol', 8265], ['Brefeldin A', 5947], ['Cytochalasin D', 10849]],
      emb: ['UMAP · dinov2-s14', 'PCA · cellprofiler'], channels: ['DNA', 'ER', 'RNA', 'AGP', 'Mito'], dims: 't 1 · c 5 · z 1 · 1080 × 1080', path: 's3://cpg0016/batch7/images.zarr' },
    cp8: { id: 'cp8', name: 'cpg0016 · batch 8', kind: 'cp', n: 51077, unit: 'obs', catField: 'treatment', numField: 'cell_area', fields: 14, seed: 8,
      cats: [['DMSO', 10233], ['Staurosporine', 6410], ['Nocodazole', 8004], ['Taxol', 9117], ['Brefeldin A', 6302], ['Cytochalasin D', 11011]],
      emb: ['UMAP · dinov2-s14', 'PCA · cellprofiler'], channels: ['DNA', 'ER', 'RNA', 'AGP', 'Mito'], dims: 't 1 · c 5 · z 1 · 1080 × 1080', path: 's3://cpg0016/batch8/images.zarr' },
    hela: { id: 'hela', name: 'HeLa H2B-mCherry · 72 h', kind: 'tr', n: 126540, unit: 'obs', catField: 'state', numField: 'speed_um_min', fields: 11, seed: 3,
      cats: [['interphase', 88214], ['prophase', 9876], ['metaphase', 11402], ['anaphase', 4317], ['telophase', 6951], ['apoptotic', 5780]],
      emb: ['UMAP · track features', 'PCA · morphology'], channels: ['H2B', 'PCNA'], dims: 't 288 · c 2 · z 9 · 2048 × 2048', path: '/data/live/hela_h2b_72h.ome.zarr' },
  };
  const mkParts = (prefix, k, n, seed, label) => { const r = rng(seed), w = Array.from({ length: k }, () => 0.85 + r() * 0.3), t = w.reduce((a, b) => a + b, 0); let acc = 0; return w.map((x, i) => { const c = i === k - 1 ? n - acc : Math.round((x / t) * n); acc += c; return { name: prefix(i), n: c, label }; }); };
  DS.cp7.parts = mkParts((i) => 'BR001170' + (10 + i), 4, DS.cp7.n, 71, 'plate');
  DS.cp8.parts = mkParts((i) => 'BR001180' + (40 + i), 4, DS.cp8.n, 81, 'plate');
  DS.hela2 = Object.assign({}, DS.hela, { id: 'hela2', name: 'HeLa H2B + nocodazole · 72 h', n: 118206, seed: 4, path: '/data/live/hela_h2b_noc_72h.ome.zarr',
    cats: [['interphase', 71420], ['prophase', 9102], ['metaphase', 24881], ['anaphase', 2114], ['telophase', 3370], ['apoptotic', 7319]] });
  DS.hela.parts = mkParts((i) => 'fov_' + pad(i, 2), 12, DS.hela.n, 31, 'fov');
  DS.hela2.parts = mkParts((i) => 'fov_' + pad(i, 2), 12, DS.hela2.n, 41, 'fov');
  const WS = [
    { id: 'jump', name: 'JUMP pilot', ds: ['cp7', 'cp8'] },
    { id: 'mito', name: 'Mitosis timing', ds: ['hela', 'hela2'] },
    { id: 'new', name: 'Untitled project', ds: [] },
  ];
  const SOURCES = {
    cp: (d) => [
      { id: 'all', name: 'All obs', expr: 'no filter', count: d.n, by: 'you' },
      { id: 'qc', name: 'QC pass', expr: 'nuclei_count ≥ 1', count: Math.round(d.n * 0.9288), by: 'Maya Chen', rev: 'r38', why: 'Drop empty segmentations' },
      { id: 'dmso', name: 'DMSO controls', expr: 'treatment = DMSO', count: d.cats[0][1], by: 'agent', rev: 'r37', why: 'Asked for a negative-control baseline', catEq: 0 },
    ],
    tr: (d) => [
      { id: 'all', name: 'All obs', expr: 'no filter', count: d.n, by: 'you' },
      { id: 'qc', name: 'Complete tracks', expr: 'track_length ≥ 24', count: Math.round(97310 * d.n / 126540), by: 'Maya Chen', rev: 'r31', why: 'Exclude tracks that leave the field' },
      { id: 'mit', name: 'Mitotic', expr: 'state IN (prophase, metaphase, anaphase, telophase)', count: d.cats.slice(1, 5).reduce((a, c) => a + c[1], 0), by: 'agent', rev: 'r33', why: 'Asked to isolate dividing cells' },
    ],
  };
  const REVS = {
    hela2: [[1, 'you', 'Created from Mitosis timing layout', '09:44']],
    cp7: [[36, 'agent', 'Added tile Count in scope F1', '09:58'], [37, 'agent', 'Added source DMSO controls', '10:04'], [38, 'Maya Chen', 'Edited source QC pass', '10:11'], [39, 'you', 'Split tile: gallery | image', '10:26'], [40, 'agent', 'Sorted gallery by cell_area desc', '10:31'], [41, 'you', 'Set color-by: treatment', '10:42']],
    cp8: [[1, 'you', 'Created from batch 7 layout', '11:02'], [2, 'agent', 'Added source DMSO controls', '11:03'], [3, 'you', 'Set color-by: treatment', '11:05']],
    hela: [[28, 'you', 'Linked image viewer to focus', '08:40'], [29, 'agent', 'Added tile Count in scope F1', '08:47'], [30, 'Maya Chen', 'Edited embedding: UMAP · track features', '09:02'], [31, 'Maya Chen', 'Added source Complete tracks', '09:15'], [32, 'you', 'Sorted gallery by speed desc', '09:20'], [33, 'agent', 'Added source Mitotic', '09:31']],
  };
  const ACT = {
    cp: [['10:04', 'add_data_source', 'DMSO controls · treatment = DMSO', 'applied', 1], ['10:31', 'configure_tile', 'gal · sort cell_area desc', 'applied', 1], ['10:38', 'count', 'treatment = Taxol', '8,265'], ['10:38', 'count', 'QC pass ∩ treatment = Taxol', '7,688'], ['10:43', 'get_workspace', '', '7 tiles · 3 sources']],
    tr: [['09:31', 'add_data_source', 'Mitotic · state IN (…)', 'applied', 1], ['09:34', 'count', 'Complete tracks ∩ metaphase ∩ gen 2', '1,212 tracks'], ['09:35', 'aggregate', 'metaphase duration · median', '23.4 min'], ['09:40', 'get_workspace', '', '7 tiles · 3 sources']],
  };
  const INTENT = { cp: 'Compare cell_area distributions across treatments; drop debris above 4,200 px².', tr: 'Compare speed by cell-cycle state; isolate later-generation mitoses.' };
  const PROPOSAL = {
    cp: (d) => [
      { k: 'tile', title: 'Add tile · Histogram', detail: 'cell_area, stacked by treatment · joins scopes F1, COLOR · splits Table if no slot is free' },
      { k: 'source', title: 'Edit source · QC pass', old: 'nuclei_count ≥ 1', nw: 'nuclei_count ≥ 1 AND cell_area < 4200', detail: fmt(d.n * 0.9288) + ' → ' + fmt(d.n * 0.9089) + ' obs' },
      { k: 'rej', title: 'Set color-by · moa_class', reason: 'Field moa_class does not exist in ' + d.name + '. Closest field: moa. Nothing changed.' },
    ],
    tr: () => [
      { k: 'tile', title: 'Add tile · Histogram', detail: 'speed_um_min, stacked by state · joins scopes F1, COLOR · splits Table if no slot is free' },
      { k: 'source', title: 'Add source · Mitotic, gen ≥ 2', old: '', nw: 'state IN (prophase … telophase) AND generation ≥ 2', detail: '9,112 obs · 611 tracks' },
      { k: 'rej', title: 'Focus · T9921', reason: 'track_id T9921 is not in source All obs (highest is T3417). Nothing changed.' },
    ],
  };
  const PROV = { emb: ['you', 'r12'], emb2: ['agent', '', 'Intent: compare two embedding models on the same cells'], mul: ['you', ''], img: ['Maya Chen', 'r20'], tbl: ['you', 'r22'], gal: ['agent', 'r40', 'Asked: show the largest cells first'], cat: ['you', 'r12'], met: ['agent', 'r36', 'Asked: keep an exact count of the current filter'] };
  const SCOPES = { emb: ['F1', 'FOCUS', 'COLOR'], emb2: ['F1', 'FOCUS', 'COLOR'], mul: ['F1', 'FOCUS', 'COLOR'], img: ['FOCUS'], tbl: ['F1', 'FOCUS'], gal: ['F1', 'FOCUS', 'COLOR'], cat: ['F1'], met: ['F1'], slot: ['F1', 'COLOR'] };
  const ARR = {
    explore: { cols: 'minmax(0,.8fr) minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr)', rows: 'minmax(0,1fr) minmax(0,1fr) minmax(0,.85fr)', areas: '"cat emb emb emb2 img" "cat emb emb mul gal" "met tbl tbl tbl slot"',
      wide: { cols: 'minmax(0,.7fr) minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,.9fr) minmax(0,1fr) minmax(0,1fr)', rows: 'minmax(0,1fr) minmax(0,1fr) minmax(0,.8fr)', areas: '"cat emb emb emb2 mul img gal" "cat emb emb emb2 mul img gal" "met tbl tbl tbl tbl tbl slot"' } },
    review: { cols: 'repeat(5,minmax(0,1fr))', rows: 'minmax(0,1fr) minmax(0,1fr) minmax(0,.85fr)', areas: '"gal gal gal img img" "gal gal gal img img" "emb mul tbl cat slot"',
      wide: { cols: 'repeat(7,minmax(0,1fr))', rows: 'minmax(0,1fr) minmax(0,1fr) minmax(0,.85fr)', areas: '"gal gal gal gal img img img" "gal gal gal gal img img img" "emb emb2 mul tbl tbl cat slot"' } },
  };
  ARR.compare = { cols: 'minmax(0,1fr) minmax(0,1fr) minmax(0,.75fr)', rows: 'minmax(0,1fr) minmax(0,1fr) minmax(0,.8fr)', areas: '"emb emb2 cat" "emb emb2 img" "tbl tbl gal"' };
  ARR.images = { cols: 'repeat(4,minmax(0,1fr))', rows: 'repeat(3,minmax(0,1fr))', areas: '"gal gal gal img" "gal gal gal img" "gal gal gal tbl"' };
  ARR.focus = { cols: 'minmax(0,1fr)', rows: 'minmax(0,1fr)', areas: '"emb"' };
  const EMB = {
    cp: [['UMAP', 'dinov2-s14', 'n_neighbors 15 · min_dist 0.1', 'you'], ['UMAP', 'dinov2-b14', 'n_neighbors 15 · min_dist 0.1', 'you'], ['UMAP', 'dinov2-s14 · DMSO-normalized', 'n_neighbors 30', 'agent'], ['Harmony UMAP', 'dinov2-s14', 'batch key plate', 'Maya Chen'], ['PCA', 'cellprofiler', 'PC1 · PC2 · 31% var', 'you'], ['UMAP', 'cellprofiler', 'n_neighbors 15', 'you'], ['t-SNE', 'cellprofiler', 'perplexity 30', 'Maya Chen'], ['UMAP', 'openphenom', 'n_neighbors 15', 'agent'], ['PHATE', 'openphenom', 'knn 5 · t auto', 'agent'], ['UMAP', 'subcell-vit', 'n_neighbors 15', 'Maya Chen'], ['PCA', 'dinov2-s14', 'PC1 · PC2 · 22% var', 'you'], ['PaCMAP', 'dinov2-s14', 'defaults', 'agent']],
    tr: [['UMAP', 'track features', 'n_neighbors 20', 'you'], ['PCA', 'morphology', 'PC1 · PC2 · 44% var', 'Maya Chen'], ['UMAP', 'H2B crops · dinov2', 'n_neighbors 15', 'you'], ['UMAP', 'motion · 24-frame window', 'n_neighbors 15', 'agent'], ['t-SNE', 'track features', 'perplexity 50', 'Maya Chen'], ['PHATE', 'H2B crops · dinov2', 'knn 5', 'agent'], ['UMAP', 'PCNA texture', 'n_neighbors 15', 'you'], ['PCA', 'motion', 'PC1 · PC2 · 38% var', 'you']],
  };
  const CO = {};
  function coords(id, e) {
    const key = id + '|' + e; if (CO[key]) return CO[key];
    const { d, obs } = data(id), list = EMB[d.kind], spec = list[e % list.length], r = rng(d.seed * 31 + e * 977 + 5);
    const pca = /PCA/.test(spec[0]), ring = d.kind === 'tr' && !/motion/.test(spec[1]) && !pca;
    const th = r() * 6.283, ct = Math.cos(th), st = Math.sin(th), sp = pca ? 0.3 : 0.08 + r() * 0.1;
    const C = d.cats.map(() => { const a = r() * 6.283, rad = pca ? 0.28 : 0.35 + r() * 0.4; return [Math.cos(a) * rad, Math.sin(a) * rad]; });
    const sub = d.cats.map(() => [gauss(r) * 0.14, gauss(r) * 0.14]);
    const out = new Float32Array(obs.length * 2); let m = 0;
    obs.forEach((o, i) => {
      let x, y;
      if (ring && o.ph >= 0) { const a = o.ph * 6.283 + th, rad = 0.62 + o.l1 * 0.06; x = Math.cos(a) * rad; y = Math.sin(a) * rad * (0.75 + 0.25 * Math.abs(ct)); }
      else { const lx = o.l1 * ct - o.l2 * st, ly = o.l1 * st + o.l2 * ct, k = o.l1 > 0.9 ? 1 : 0; x = C[o.c][0] + lx * sp + sub[o.c][0] * k; y = C[o.c][1] + ly * sp * 0.85 + sub[o.c][1] * k; }
      x += gauss(r) * 0.015; y += gauss(r) * 0.015; out[i * 2] = x; out[i * 2 + 1] = y; m = Math.max(m, Math.abs(x), Math.abs(y));
    });
    for (let i = 0; i < out.length; i++) out[i] /= m * 1.02;
    return (CO[key] = out);
  }
  function dimInfo(id, e) {
    const d = DS[id]; if (!d) return { n: 2, names: ['1', '2'], ve: [] }; const list = EMB[d.kind], spec = list[e % list.length], pca = /PCA/.test(spec[0]);
    const n = pca ? 50 : /^UMAP/.test(spec[0]) ? 3 : 2, pre = pca ? 'PC' : spec[0].split(' ').pop().replace('t-SNE', 'tSNE');
    const ve = pca ? Array.from({ length: n }, (_, k) => +(0.19 * Math.pow(0.8, k) + 0.004).toFixed(3)) : [];
    return { n, names: Array.from({ length: n }, (_, k) => pre + (k + 1)), ve, key: 'X_' + spec[0].toLowerCase().replace(/[^a-z]+/g, '') + '_' + spec[1].split(' ')[0].replace(/[^a-z0-9]+/gi, '') };
  }
  const COL = {};
  function dimCol(id, e, k) {
    const key = id + '|' + e + '|' + k; if (COL[key]) return COL[key];
    const base = coords(id, e), { d, obs } = data(id), N = obs.length, out = new Float32Array(N);
    if (k < 2) { for (let i = 0; i < N; i++) out[i] = base[i * 2 + k]; return (COL[key] = out); }
    const r = rng(d.seed * 131 + e * 71 + k * 997), off = d.cats.map(() => (r() - 0.5) * 2 * Math.max(0, 1.1 - k * 0.12)), mix = r() - 0.5; let m = 0;
    obs.forEach((o, i) => { const v = off[o.c] * 0.6 + gauss(r) * 0.32 + mix * base[i * 2] * 0.4 + (k % 2 ? o.l2 : o.l1) * 0.15; out[i] = v; m = Math.max(m, Math.abs(v)); });
    for (let i = 0; i < N; i++) out[i] /= m * 1.02; return (COL[key] = out);
  }
  const CO2 = {};
  function coordsDims(id, e, dx, dy) {
    if (dx === 0 && dy === 1) return coords(id, e);
    const key = id + '|' + e + '|' + dx + '|' + dy; if (CO2[key]) return CO2[key];
    const X = dimCol(id, e, dx), Y = dimCol(id, e, dy), out = new Float32Array(X.length * 2); for (let i = 0; i < X.length; i++) { out[i * 2] = X[i]; out[i * 2 + 1] = Y[i]; }
    return (CO2[key] = out);
  }

  /* ---------- observations ---------- */
  const CACHE = {};
  function data(id) {
    if (CACHE[id]) return CACHE[id];
    const d = DS[id], r = rng(d.seed * 1013), N = 2600, tot = d.n, obs = [];
    const cum = []; let acc = 0; d.cats.forEach((c) => { acc += c[1] / tot; cum.push(acc); });
    const CP_C = [[-0.1, 0.05, 0.22], [0.62, -0.58, 0.12], [-0.62, -0.5, 0.14], [-0.55, 0.52, 0.15], [0.16, -0.22, 0.15], [0.6, 0.45, 0.18]];
    const CP_AREA = [2400, 1300, 3100, 3900, 2600, 3400];
    const ARCS = [[0, 0.62], [0.62, 0.73], [0.73, 0.84], [0.84, 0.9], [0.9, 1]];
    const SPD = [0.42, 0.18, 0.12, 0.16, 0.2, 0.06];
    for (let i = 0; i < N; i++) {
      const u = r(); let c = cum.findIndex((v) => u <= v); if (c < 0) c = d.cats.length - 1;
      const pu = r() * d.n; let p = 0, pa = 0; for (; p < d.parts.length - 1; p++) { pa += d.parts[p].n; if (pu < pa) break; }
      let x, y, o, ph = -1; const l1 = gauss(r), l2 = gauss(r);
      if (d.kind === 'cp') {
        const C = CP_C[c], sub = r() < 0.3 ? 0.18 : 0;
        x = C[0] + gauss(r) * C[2] + sub * (c % 2 ? 1 : -1); y = C[1] + gauss(r) * C[2] * 0.85 + sub * 0.5;
        const row = 'ABCDEFGHIJKLMNOP'[(r() * 16) | 0], col = pad(1 + ((r() * 24) | 0), 2), site = 1 + ((r() * 9) | 0), cell = (r() * 900) | 0, plate = d.parts[p].name;
        o = { well: row + col, site, plate, cell, area: Math.max(420, Math.round(CP_AREA[c] + gauss(r) * 520)), nuc: (0.08 + r() * 0.22).toFixed(3) };
        o.id = plate + '·' + o.well + '·s' + site + '·' + cell; o.short = o.well + '-s' + site + '-' + cell;
      } else {
        if (c === 5) { x = 0.02 + gauss(r) * 0.12; y = -0.04 + gauss(r) * 0.12; }
        else { ph = ARCS[c][0] + r() * (ARCS[c][1] - ARCS[c][0]); const a = ph * Math.PI * 2, rad = 0.68 + gauss(r) * 0.07; x = Math.cos(a) * rad; y = Math.sin(a) * rad * 0.9; }
        const tr = (r() * 3418) | 0, fr = (r() * 288) | 0;
        o = { track: 'T' + pad(tr, 4), frame: fr, gen: 1 + ((r() * 4) | 0), area: Math.max(0.01, SPD[c] + gauss(r) * 0.06) };
        o.speed = o.area.toFixed(3); o.fov = d.parts[p].name; o.id = o.fov + '·' + o.track + '·f' + pad(fr, 3); o.short = o.track + '·f' + pad(fr, 3);
      }
      o.p = p; o.l1 = l1; o.l2 = l2; o.ph = ph; o.i = i; o.c = c; o.x = x; o.y = y; o.px = 0.62 * x + 0.32 * y + gauss(r) * 0.08; o.py = 0.3 * x - 0.55 * y + gauss(r) * 0.08;
      obs.push(o);
    }
    const sorted = obs.slice().sort((a, b) => b.area - a.area);
    return (CACHE[id] = { d, obs, sorted });
  }

  /* ---------- field filters ---------- */
  function fval(kind, d, o, f) {
    if (kind === 'cp') return { well: o.well, site: 's' + o.site, treatment: d.cats[o.c][0], plate: o.plate, cell_area: o.area, nuc_int: +o.nuc }[f];
    return { track_id: o.track, frame: o.frame, state: d.cats[o.c][0], speed: o.area, gen: o.gen }[f];
  }
  function fxPass(kind, d, o, fx) {
    if (!fx || !fx.c || !fx.c.length) return true;
    const t = (k) => { const v = fval(kind, d, o, k.f); if (k.op === 'any') return !k.vals || !k.vals.length || k.vals.includes(v); if (k.op === 'none') return !(k.vals || []).includes(v);
      const n = typeof v === 'number' ? v : parseFloat(v), a = parseFloat(k.a), b = parseFloat(k.b);
      if (k.op === 'gt') return isNaN(a) || n > a; if (k.op === 'lt') return isNaN(a) || n < a; if (k.op === 'between') return (isNaN(a) || n >= a) && (isNaN(b) || n <= b);
      const sv = String(v).toLowerCase(), q = String(k.s || '').toLowerCase(); if (k.op === 'contains') return !q || sv.includes(q); if (k.op === 'is') return !q || sv === q; return true; };
    return fx.m === 'or' ? fx.c.some(t) : fx.c.every(t);
  }

  /* ---------- procedural microscopy ---------- */
  const vnoise = (r, g) => { const a = new Float32Array((g + 1) * (g + 1)); for (let i = 0; i < a.length; i++) a[i] = r(); const s = (t) => t * t * (3 - 2 * t);
    return (x, y) => { x *= g; y *= g; const xi = Math.min(g - 1, x | 0), yi = Math.min(g - 1, y | 0), u = s(x - xi), v = s(y - yi), i = yi * (g + 1) + xi; return (a[i] * (1 - u) + a[i + 1] * u) * (1 - v) + (a[i + g + 1] * (1 - u) + a[i + g + 2] * u) * v; }; };
  function cellBlobs(dk, c, r) {
    const B = [], R = (a, b) => a + r() * (b - a);
    const nuc = (dx, dy, rx, ry, amp, tex) => B.push({ dx, dy, rx, ry, rot: R(0, 3.14), amp, tex, edge: 9 });
    if (dk === 'cp') {
      B.push({ dx: 0, dy: 0, rx: R(0.75, 0.95), ry: R(0.6, 0.8), rot: R(0, 3.14), amp: c === 4 ? 0.42 : 0.24, tex: 1, edge: 3 });
      if (c === 0 || c === 4) nuc(0, 0, 0.32, 0.26, 0.9, 0.4);
      else if (c === 1) { nuc(0, 0, 0.17, 0.15, 1, 0.2); for (let k = 0; k < 3; k++) nuc(R(-0.3, 0.3), R(-0.3, 0.3), 0.07, 0.06, 1, 0); }
      else if (c === 2) nuc(0, 0, 0.4, 0.38, 0.8, 0.6);
      else if (c === 3) { nuc(-0.18, -0.1, 0.2, 0.17, 0.9, 0.4); nuc(0.17, -0.08, 0.18, 0.16, 0.9, 0.4); nuc(0, 0.2, 0.19, 0.15, 0.9, 0.4); }
      else { nuc(-0.22, 0, 0.22, 0.2, 0.9, 0.4); nuc(0.22, 0.02, 0.21, 0.19, 0.9, 0.4); }
    } else {
      if (c === 0) nuc(0, 0, 0.36, 0.3, 0.62, 0.8);
      else if (c === 1) nuc(0, 0, 0.33, 0.3, 0.85, 1.4);
      else if (c === 2) nuc(0, 0, 0.34, 0.09, 1, 0.3);
      else if (c === 3) { nuc(0, -0.2, 0.28, 0.07, 1, 0.3); nuc(0, 0.2, 0.28, 0.07, 1, 0.3); }
      else if (c === 4) { nuc(0, -0.3, 0.17, 0.14, 0.95, 0.4); nuc(0, 0.3, 0.17, 0.14, 0.95, 0.4); }
      else for (let k = 0; k < 5; k++) nuc(R(-0.25, 0.25), R(-0.25, 0.25), 0.07, 0.06, 1, 0);
    }
    return B;
  }
  const IMG = new Map();
  function micro(seed, c, dk, res, fov, lut) {
    const key = [seed, c, dk, res, fov, lut].join('|'); if (IMG.has(key)) return IMG.get(key);
    const r = rng(seed * 7919 + 13), n1 = vnoise(r, 5), n2 = vnoise(r, Math.round(res / 6)), buf = new Float32Array(res * res);
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) buf[y * res + x] = 0.035 + 0.06 * n1(x / res, y / res);
    const cells = [];
    if (fov) { cells.push([0.5, 0.5, c, 0.085]); for (let k = 0; k < 26; k++) { let px, py; do { px = r(); py = r(); } while (Math.hypot(px - 0.5, py - 0.5) < 0.12); cells.push([px, py, r() < 0.5 ? c : (r() * 6) | 0, 0.07 + r() * 0.03]); } }
    else { cells.push([0.5, 0.5, c, 0.42]); for (let k = 0; k < 3; k++) { const a = r() * 6.28; cells.push([0.5 + Math.cos(a) * 0.62, 0.5 + Math.sin(a) * 0.62, (r() * 6) | 0, 0.38]); } }
    cells.forEach(([cx, cy, cc, sc0]) => {
      const ang = r() * 6.283, ca = Math.cos(ang), sa = Math.sin(ang), sc = sc0 * (0.85 + r() * 0.3), sq = 0.8 + r() * 0.4;
      cellBlobs(dk, cc, r).forEach((b) => {
        const bdx = (b.dx * ca - b.dy * sa) * sq, bdy = b.dx * sa + b.dy * ca, rot = b.rot + ang;
        const rx = b.rx * sc * res * (0.9 + r() * 0.2), ry = b.ry * sc * res, co = Math.cos(rot), si = Math.sin(rot), ox = (cx + bdx * sc) * res, oy = (cy + bdy * sc) * res, ext = Math.max(rx, ry) * 1.5;
        for (let y = Math.max(0, (oy - ext) | 0); y < Math.min(res, oy + ext); y++) for (let x = Math.max(0, (ox - ext) | 0); x < Math.min(res, ox + ext); x++) {
          const X = x - ox, Y = y - oy, u = (X * co + Y * si) / rx, v = (-X * si + Y * co) / ry, dd = Math.sqrt(u * u + v * v);
          let val = b.amp / (1 + Math.exp((dd - 1) * b.edge)); if (b.tex) val *= 1 - b.tex * 0.5 + b.tex * 0.6 * n2(x / res, y / res);
          buf[y * res + x] += val;
        }
      });
    });
    const cv = document.createElement('canvas'); cv.width = cv.height = res; const ctx = cv.getContext('2d'), im = ctx.createImageData(res, res);
    const L = [parseInt(lut.slice(1, 3), 16), parseInt(lut.slice(3, 5), 16), parseInt(lut.slice(5, 7), 16)];
    for (let i = 0; i < res * res; i++) { const v = Math.max(0, Math.min(1, Math.pow(buf[i] + (r() - 0.5) * 0.04, 0.85))); im.data[i * 4] = L[0] * v; im.data[i * 4 + 1] = L[1] * v; im.data[i * 4 + 2] = L[2] * v; im.data[i * 4 + 3] = 255; }
    ctx.putImageData(im, 0, 0); IMG.set(key, cv); return cv;
  }

  /* ---------- custom elements ---------- */
  class Base extends HTMLElement {
    connectedCallback() { if (!this.cv) { if (getComputedStyle(this).position === 'static') this.style.position = 'relative'; this.cv = document.createElement('canvas'); this.cv.style.cssText = 'position:absolute;left:0;top:0;display:block;width:100%;height:100%'; this.appendChild(this.cv); this.ro = new ResizeObserver(() => { cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(() => this.draw()); }); this.ro.observe(this); } this.draw(); }
    disconnectedCallback() { this.ro && this.ro.disconnect(); this.ro = null; this.cv && this.cv.remove(); this.cv = null; }
    attributeChangedCallback() { this.draw(); }
    size() { const dpr = window.devicePixelRatio || 1, w = this.clientWidth, h = this.clientHeight; if (!w || !h) return null; this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); const ctx = this.cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, w, h }; }
    a(n, d) { const v = this.getAttribute(n); return v == null || v === '' ? d : v; }
  }
  class Micro extends Base {
    static get observedAttributes() { return ['seed', 'cat', 'dk', 'res', 'fov', 'lut', 'mark']; }
    draw() {
      if (!this.cv) return; const S = this.size(); if (!S) return; const { ctx, w, h } = S;
      const res = +this.a('res', 64), fov = this.a('fov', '') === '1', src = micro(+this.a('seed', 1), +this.a('cat', 0), this.a('dk', 'cp'), res, fov, this.a('lut', '#ffffff'));
      const s = Math.max(w, h) / res; ctx.imageSmoothingEnabled = true; ctx.drawImage(src, (w - res * s) / 2, (h - res * s) / 2, res * s, res * s);
      const mk = this.a('mark', ''); if (mk) { const b = res * s * 0.16; ctx.strokeStyle = mk; ctx.lineWidth = 1; ctx.strokeRect(w / 2 - b / 2 + 0.5, h / 2 - b / 2 + 0.5, b, b); }
    }
  }
  class Scatter extends Base {
    static get observedAttributes() { return ['ds', 'cat', 'focus', 'pal', 'dim', 'ring', 'emb', 'src', 'mini', 'excl', 'ps', 'cb', 'nomark', 'fx', 'dims', 'tool', 'lsel', 'pt']; }
    attributeChangedCallback(n, o, v) {
      if (n === 'tool') { this.style.cursor = v === 'box' || v === 'lasso' ? 'crosshair' : this._is3d ? 'grab' : 'default'; return; }
      if (o === v || !this.cv || !this._wh) return this.draw();
      const dur = durOf(this);
      if (n === 'dims') { this._yaw = null; this._pitch = null; }
      if (n === 'focus' && dur && this._fxy && this.a('mini', '') !== '1') { this._fFrom = this._fxy.slice(); this._fT0 = performance.now(); this._fDur = dur * 1.2; const tick = () => { this.draw(); if (performance.now() - this._fT0 < this._fDur) this._fr = requestAnimationFrame(tick); else { this._fFrom = null; this.draw(); } }; cancelAnimationFrame(this._fr); this._fr = requestAnimationFrame(tick); return; }
      if (dur && ['cat', 'src', 'excl', 'fx', 'cb', 'emb', 'dims', 'ds', 'pal', 'lsel'].includes(n) && this.cv.width) { const g = document.createElement('canvas'); g.width = this.cv.width; g.height = this.cv.height; g.getContext('2d').drawImage(this.cv, 0, 0); g.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none'; this.appendChild(g); const an = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 1.1, easing: 'ease-out' }); an.onfinish = () => g.remove(); }
      this.draw();
    }
    connectedCallback() { super.connectedCallback(); if (!this._c) { this._c = true; this.style.cursor = 'default'; this.style.touchAction = 'none';
      this.addEventListener('click', (e) => { if (this._dragged) { this._dragged = false; return; } const t = this.a('tool', 'pointer'); if (t === 'pointer' || !t) this.pick(e); });
      this.addEventListener('pointerdown', (e) => this.lassoStart(e)); this.addEventListener('pointerdown', (e) => this.rotStart(e)); } }
    rotStart(e) { const tool = this.a('tool', 'pointer'); if (!this._is3d || (tool && tool !== 'pointer') || e.button !== 0) return; const x0 = e.clientX, y0 = e.clientY, ya0 = this._yaw == null ? 0.6 : this._yaw, pi0 = this._pitch == null ? 0.35 : this._pitch; let moved = false, raf = 0;
      const mv = (ev) => { const dx = ev.clientX - x0, dy = ev.clientY - y0; if (!moved && Math.hypot(dx, dy) < 3) return; moved = true; this._dragged = true; this.style.cursor = 'grabbing'; this._yaw = ya0 + dx * 0.01; this._pitch = Math.max(-1.45, Math.min(1.45, pi0 + dy * 0.01)); if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.draw(); }); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); this.style.cursor = 'grab'; if (!moved) this._dragged = false; };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); }
    local(e) { const b = this.getBoundingClientRect(); return [(e.clientX - b.left) * (this._wh[0] / b.width), (e.clientY - b.top) * (this._wh[1] / b.height)]; }
    lassoStart(e) {
      const tool = this.a('tool', 'pointer'); if ((tool !== 'box' && tool !== 'lasso') || this._mini || !this._wh || e.button !== 0) return;
      e.preventDefault(); this.setPointerCapture(e.pointerId);
      const mode = e.shiftKey ? 'add' : e.altKey ? 'sub' : 'replace', p0 = this.local(e), pts = [p0];
      if (!this.ov) { this.ov = document.createElement('canvas'); this.ov.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none'; this.appendChild(this.ov); }
      const dpr = window.devicePixelRatio || 1, [w, h] = this._wh; this.ov.width = Math.round(w * dpr); this.ov.height = Math.round(h * dpr); const ctx = this.ov.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ring = getComputedStyle(this).getPropertyValue('--primary').trim() || '#26CFDB', fg = getComputedStyle(this).getPropertyValue('--foreground').trim() || '#fff', bg = getComputedStyle(this).getPropertyValue('--card').trim() || '#000';
      const poly = () => (tool === 'box' ? [[p0[0], p0[1]], [pts[pts.length - 1][0], p0[1]], [pts[pts.length - 1][0], pts[pts.length - 1][1]], [p0[0], pts[pts.length - 1][1]]] : pts);
      const inside = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
      const hits = () => { const P = poly(); if (P.length < 3) return []; const out = []; (this._cand || []).forEach((o) => { const [x, y] = this.xy(o, w, h); if (inside(x, y, P)) out.push(o.i); }); return out; };
      const unit = (DS[this.a('ds', '')] || {}).unit || '', tot = (DS[this.a('ds', '')] || {}).n || 0, N = (data(this.a('ds', '')).obs || []).length || 1;
      let raf = 0;
      const paint = () => { raf = 0; ctx.clearRect(0, 0, w, h); const P = poly(); if (P.length < 2) return; ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
        ctx.globalAlpha = 0.1; ctx.fillStyle = ring; ctx.fill(); ctx.globalAlpha = 1; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.25; ctx.strokeStyle = ring; ctx.stroke(); ctx.setLineDash([]);
        const n = hits().length, lab = (mode === 'add' ? '+ ' : mode === 'sub' ? '− ' : '') + Math.round((n / N) * tot).toLocaleString('en-US') + ' ' + unit, q = pts[pts.length - 1];
        ctx.font = '500 11px ' + (getComputedStyle(this).getPropertyValue('--font-mono').trim() || 'monospace'); const tw = ctx.measureText(lab).width + 12, lx = Math.min(w - tw - 4, q[0] + 10), ly = Math.max(4, q[1] - 24);
        ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx, ly, tw, 18, 9) : ctx.rect(lx, ly, tw, 18); ctx.fill(); ctx.fillStyle = fg; ctx.fillText(lab, lx + 6, ly + 12.5); };
      const mv = (ev) => { const p = this.local(ev); const l = pts[pts.length - 1]; if (tool === 'box') { pts[1] = p; pts.length = 2; } else if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 2) pts.push(p); if (!raf) raf = requestAnimationFrame(paint); };
      const upf = (ev) => { this.removeEventListener('pointermove', mv); this.removeEventListener('pointerup', upf); this.removeEventListener('pointercancel', upf); cancelAnimationFrame(raf);
        const moved = pts.length > 1 && Math.hypot(pts[pts.length - 1][0] - p0[0], pts[pts.length - 1][1] - p0[1]) > 4, idx = moved ? hits() : [];
        const g = this.ov; g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out' }).onfinish = () => ctx.clearRect(0, 0, w, h);
        this._dragged = moved; const sh = shells[this.a('shell', '')]; if (sh && sh.lasso) { if (moved) sh.lasso(idx, mode, this.a('lname', 'Embedding'), tool); else if (mode === 'replace') sh.lasso(null, 'clear'); } };
      this.addEventListener('pointermove', mv); this.addEventListener('pointerup', upf); this.addEventListener('pointercancel', upf);
    }
    xy(o, w, h) { const co = this._co, m = this._mini ? 4 : 14, ky = h / 2 - m, kx = Math.min(w / 2 - m, ky * 1.5); return [w / 2 + co[o.i * 2] * kx, h / 2 - co[o.i * 2 + 1] * ky]; }
    draw() {
      if (!this.cv) return; const id = this.a('ds', ''); if (!DS[id]) return; const S = this.size(); if (!S) return; const { ctx, w, h } = S; this._wh = [w, h]; this._mini = this.a('mini', '') === '1'; { const dd = this.a('dims', '').split(',').filter((x) => x !== '').map(Number), e0 = +this.a('emb', '0'); this._is3d = dd.length === 3 && !this._mini;
        if (this._is3d) { const X = dimCol(id, e0, dd[0]), Y = dimCol(id, e0, dd[1]), Z = dimCol(id, e0, dd[2]), ya = this._yaw == null ? 0.6 : this._yaw, pi = this._pitch == null ? 0.35 : this._pitch, cy = Math.cos(ya), sy = Math.sin(ya), cp = Math.cos(pi), sp = Math.sin(pi), N = X.length, co = new Float32Array(N * 2); this._dep = new Float32Array(N);
          for (let i = 0; i < N; i++) { const x1 = X[i] * cy + Z[i] * sy, z1 = -X[i] * sy + Z[i] * cy, y1 = Y[i] * cp - z1 * sp; co[i * 2] = x1 / 1.45; co[i * 2 + 1] = y1 / 1.45; this._dep[i] = Y[i] * sp + z1 * cp; } this._co = co; this._rot = [cy, sy, cp, sp]; }
        else { this._dep = null; this._co = dd.length === 2 && !isNaN(dd[0]) && !isNaN(dd[1]) ? coordsDims(id, e0, dd[0], dd[1]) : coords(id, e0); } }
      const { obs } = data(id), pal = this.a('pal', '#888').split(','), dim = this.a('dim', '#888'), cat = this.a('cat', ''), ci = DS[id].cats.findIndex((c) => c[0] === cat), sc = +this.a('src', -1);
      const pr = this._mini ? 1 : +this.a('pt', '0') > 0 ? +this.a('pt', '0') : Math.max(1.2, Math.min(2.2, Math.min(w, h) / 260)) * +this.a('ps', '1'), cb = this.a('cb', 'cat'), _nr = cb === 'num' ? (() => { let lo = Infinity, hi = -Infinity; obs.forEach((o) => { if (o.area < lo) lo = o.area; if (o.area > hi) hi = o.area; }); return [lo, hi]; })() : null, _L = cb === 'num' ? lutCached('viridis') : null, colOf0 = (o) => { const j = Math.max(0, Math.min(255, (((o.area - _nr[0]) / (_nr[1] - _nr[0] || 1)) * 255) | 0)) * 3; return 'rgb(' + _L[j] + ',' + _L[j + 1] + ',' + _L[j + 2] + ')'; }, colOf = (o) => cb === 'num' ? colOf0(o) : colOf1(o), colOf1 = (o) => (cb === 'none' ? pal[0] : pal[(cb === 'part' ? o.p : o.c) % pal.length]);
      const dot = (o, col) => { if (this._mini && o.i % 3) return; const [x, y] = this.xy(o, w, h); if (this._dep) { const ga = ctx.globalAlpha; ctx.globalAlpha = ga * (0.45 + 0.55 * Math.min(1, Math.max(0, (this._dep[o.i] + 1.2) / 2.4))); ctx.fillStyle = col; ctx.fillRect(x - pr / 2, y - pr / 2, pr, pr); ctx.globalAlpha = ga; return; } ctx.fillStyle = col; ctx.fillRect(x - pr / 2, y - pr / 2, pr, pr); };
      let fx = null; try { fx = JSON.parse(this.a('fx', '') || 'null'); } catch (e) {} const dd = DS[id], ex = this.a('excl', '').split(',').filter(Boolean).map(Number), lss = api.selSet(id), inSrc0 = (o) => !ex.includes(o.p) && (sc < 0 || o.c === sc) && fxPass(dd.kind, dd, o, fx), inSrc = (o) => inSrc0(o) && (!lss || lss.has(o.i));
      if (!this._mini) this._cand = obs.filter((o) => inSrc0(o) && (ci < 0 || o.c === ci));
      if (ci >= 0 || sc >= 0 || ex.length || lss || (fx && fx.c && fx.c.length)) { ctx.globalAlpha = 0.55; obs.forEach((o) => { if (!(inSrc(o) && (ci < 0 || o.c === ci))) dot(o, dim); }); }
      ctx.globalAlpha = 0.9; obs.forEach((o) => { if (inSrc(o) && (ci < 0 || o.c === ci)) dot(o, colOf(o)); });
      ctx.globalAlpha = 1;
      if (this._is3d && this._rot) { const [cy, sy, cp, sp] = this._rot, gx = 26, gy = h - 26, L = 14, fg = getComputedStyle(this).getPropertyValue('--text-muted').trim() || '#888';
        ctx.save(); ctx.lineWidth = 1.2; ctx.font = '500 9px ' + (getComputedStyle(this).getPropertyValue('--font-mono').trim() || 'monospace'); ctx.strokeStyle = fg; ctx.fillStyle = fg;
        [[1, 0, 0, 'x'], [0, 1, 0, 'y'], [0, 0, 1, 'z']].forEach(([X, Y, Z, n]) => { const x1 = X * cy + Z * sy, z1 = -X * sy + Z * cy, y1 = Y * cp - z1 * sp; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + x1 * L, gy - y1 * L); ctx.stroke(); ctx.fillText(n, gx + x1 * (L + 5) - 2.5, gy - y1 * (L + 5) + 3); }); ctx.restore(); }
      const f = this.a('nomark', '') === '1' ? null : obs[+this.a('focus', -1)];
      if (f) { let [x, y] = this.xy(f, w, h); this._fxy = [x, y]; if (this._fFrom) { const k = Math.min(1, (performance.now() - this._fT0) / this._fDur), e = 1 - Math.pow(1 - k, 3); x = this._fFrom[0] + (x - this._fFrom[0]) * e; y = this._fFrom[1] + (y - this._fFrom[1]) * e; } ctx.strokeStyle = this.a('ring', '#fff'); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, this._mini ? 4 : 7, 0, 6.283); ctx.stroke(); if (this._mini) return; ctx.beginPath(); ctx.moveTo(x + 10, y); ctx.lineTo(x + 18, y); ctx.moveTo(x - 10, y); ctx.lineTo(x - 18, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y - 18); ctx.moveTo(x, y + 10); ctx.lineTo(x, y + 18); ctx.stroke(); }
    }
    pick(e) {
      const id = this.a('ds', ''); if (!DS[id] || !this._wh || this._mini) return; const b = this.getBoundingClientRect(), sx = (e.clientX - b.left) * (this._wh[0] / b.width), sy = (e.clientY - b.top) * (this._wh[1] / b.height);
      const cat = this.a('cat', ''), ci = DS[id].cats.findIndex((c) => c[0] === cat); let best = null, bd = 16 * 16;
      data(id).obs.forEach((o) => { if (ci >= 0 && o.c !== ci) return; const [x, y] = this.xy(o, ...this._wh), dd = (x - sx) ** 2 + (y - sy) ** 2; if (dd < bd) { bd = dd; best = o; } });
      const sh = shells[this.a('shell', '')]; if (best && sh) sh.focusObs(best.i);
    }
  }
  class Hist extends Base {
    static get observedAttributes() { return ['ds', 'cat', 'pal', 'dim', 'fg', 'bg', 'ghost', 'bins']; }
    draw() {
      if (!this.cv) return; const id = this.a('ds', ''); if (!DS[id]) return; const S = this.size(); if (!S) return; const { ctx, w, h } = S;
      const { obs } = data(id), pal = this.a('pal', '#888').split(','), cat = this.a('cat', ''), ci = DS[id].cats.findIndex((c) => c[0] === cat), NB = +this.a('bins', '28');
      let lo = Infinity, hi = -Infinity; obs.forEach((o) => { lo = Math.min(lo, o.area); hi = Math.max(hi, o.area); });
      const bins = Array.from({ length: NB }, () => new Array(6).fill(0)); obs.forEach((o) => { bins[Math.min(NB - 1, (((o.area - lo) / (hi - lo)) * NB) | 0)][o.c]++; });
      const mx = Math.max(...bins.map((b) => b.reduce((a, c) => a + c, 0))), bw = (w - 8) / NB, base = h - 6;
      ctx.globalAlpha = this.a('ghost', '') === '1' ? 0.45 : 1;
      bins.forEach((b, i) => { let y = base; b.forEach((v, c) => { if (!v) return; const bh = (v / mx) * (h - 14); ctx.fillStyle = ci >= 0 && c !== ci ? this.a('dim', '#888') : pal[c % pal.length]; ctx.fillRect(4 + i * bw + 0.5, y - bh, bw - 1.5, bh); ctx.fillStyle = this.a('bg', '#fff'); ctx.fillRect(4 + i * bw, y - bh, bw, 1); y -= bh; }); });
      ctx.globalAlpha = 1; ctx.fillStyle = this.a('fg', '#000'); ctx.fillRect(4, base, w - 8, 0.5);
    }
  }
  /* ---------- multichannel viewer ---------- */
  const CMAPS = {
    viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
    magma: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
    inferno: [[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]],
  };
  const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const lutOf = (cm) => { const L = new Uint8ClampedArray(256 * 3); for (let i = 0; i < 256; i++) { const v = i / 255; let c;
      if (CMAPS[cm]) { const st = CMAPS[cm], x = v * (st.length - 1), k = Math.min(st.length - 2, x | 0), f = x - k; c = [0, 1, 2].map((j) => st[k][j] * (1 - f) + st[k + 1][j] * f); }
      else { const rgb = hexRgb(cm && cm[0] === '#' ? cm : '#ffffff'); c = rgb.map((x2) => x2 * v); }
      L[i * 3] = c[0]; L[i * 3 + 1] = c[1]; L[i * 3 + 2] = c[2]; } return L; };
  const LUTS = {}; const lutCached = (cm) => LUTS[cm] || (LUTS[cm] = lutOf(cm));
  const CB = new Map();
  function chanBufs(seed, cat, dk, res, t, z, nch) {
    const key = [seed, cat, dk, res, t, z].join('|'); if (CB.has(key)) return CB.get(key);
    const r = rng(seed * 7919 + 13), nT = vnoise(rng(seed + 5), Math.round(res / 10)), nF = vnoise(rng(seed + 9), Math.round(res / 4)), nP = vnoise(rng(seed + 17), Math.round(res / 2.5));
    const N = res * res, B = Array.from({ length: nch }, () => new Float32Array(N));
    const zf = Math.exp(-Math.pow((z - 4) / 2.6, 2)), edge = 4 + 6 * zf, zamp = 0.45 + 0.55 * zf;
    const cells = [[0.5, 0.5, cat, 0.085]]; for (let k = 0; k < 24; k++) { let px, py; do { px = r(); py = r(); } while (Math.hypot(px - 0.5, py - 0.5) < 0.12); cells.push([px, py, r() < 0.5 ? cat : (r() * 6) | 0, 0.07 + r() * 0.03]); }
    cells.forEach(([cx0, cy0, cc, sc], ci) => {
      const ph = ci * 1.7, cx = cx0 + Math.sin(t * 0.045 + ph) * 0.012 * (ci ? 1 : 0.3), cy = cy0 + Math.cos(t * 0.038 + ph) * 0.012 * (ci ? 1 : 0.3);
      const ang = r() * 6.283, nuc = Array.from({ length: dk === 'cp' && cc === 3 ? 3 : 1 }, (_, j) => [cx + (j ? (r() - 0.5) * sc * 0.6 : 0), cy + (j ? (r() - 0.5) * sc * 0.6 : 0), sc * (dk === 'cp' && cc === 1 ? 0.18 : dk === 'cp' && cc === 2 ? 0.4 : 0.3) * (0.85 + r() * 0.3)]);
      const mit = dk === 'tr' && cc >= 1 && cc <= 4, cr = sc * (dk === 'cp' ? 0.9 : 0.7), ca = Math.cos(ang), sa = Math.sin(ang), ex = cr * 1.4, nucl = [0, 1, 2].map(() => [cx + (r() - 0.5) * sc * 0.25, cy + (r() - 0.5) * sc * 0.25]);
      const x0 = Math.max(0, ((cx - ex) * res) | 0), x1 = Math.min(res, ((cx + ex) * res) | 0), y0 = Math.max(0, ((cy - ex) * res) | 0), y1 = Math.min(res, ((cy + ex) * res) | 0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const X = x / res - cx, Y = y / res - cy, u = (X * ca + Y * sa) / cr, w = (-X * sa + Y * ca) / (cr * 0.78), dc = Math.sqrt(u * u + w * w);
        const cyto = 1 / (1 + Math.exp((dc - 1) * edge)); let nu = 0;
        nuc.forEach(([nx, ny, nr]) => { const dx = (x / res - nx) / (mit ? nr * 0.45 : nr), dy = (y / res - ny) / (mit ? nr * 1.4 : nr * 0.85); nu = Math.max(nu, 1 / (1 + Math.exp((Math.sqrt(dx * dx + dy * dy) - 1) * edge * 1.4))); });
        const i = y * res + x, tex = nT(x / res, y / res), fine = nF(x / res, y / res), pun = nP(x / res, y / res);
        if (dk === 'cp') {
          B[0][i] += nu * (0.7 + 0.3 * tex) * zamp;
          B[1][i] += cyto * (1 - nu * 0.6) * (0.25 + 0.6 * fine) * (0.6 + 0.6 * Math.exp(-dc * 2)) * zamp * (cc === 4 ? 1.5 : 1);
          let sp = 0; nucl.forEach(([nx, ny]) => { const d2 = ((x / res - nx) ** 2 + (y / res - ny) ** 2) / (sc * sc * 0.004); sp += Math.exp(-d2); }); B[2][i] += (sp * nu * 0.9 + cyto * 0.18 * fine) * zamp;
          B[3][i] += (Math.exp(-Math.pow((dc - 0.95) / 0.09, 2)) * 0.8 + cyto * 0.08) * (0.6 + 0.4 * tex) * zamp * (cc === 5 ? 0.5 : 1);
          B[4][i] += cyto * (1 - nu) * Math.pow(pun, 3) * 1.6 * zamp;
        } else {
          B[0][i] += nu * (mit ? 1 : 0.55 + 0.35 * tex) * zamp * (cc === 5 ? 1.3 : 1);
          B[1][i] += nu * ((cc === 0 ? 0.35 : 0.15) + (cc === 0 ? Math.pow(pun, 4) * 2.2 : 0)) * zamp;
        }
      }
    });
    const hist = B.map((b) => { const h = new Float32Array(64); for (let i = 0; i < N; i++) { const v = b[i] + (r() - 0.5) * 0.03; b[i] = v < 0 ? 0 : v > 1 ? 1 : v; h[Math.min(63, (b[i] * 64) | 0)]++; } return h; });
    const out = { B, hist }; CB.set(key, out); if (CB.size > 48) CB.delete(CB.keys().next().value); return out;
  }
  class Multi extends Base {
    static get observedAttributes() { return ['seed', 'cat', 'dk', 't', 'z', 'cfg', 'mark']; }
    draw() {
      if (!this.cv) return; const S = this.size(); if (!S) return; const { ctx, w, h } = S; let cfg = []; try { cfg = JSON.parse(this.a('cfg', '[]')); } catch (e) {}
      const res = 256, dk = this.a('dk', 'cp'), D2 = chanBufs(+this.a('seed', 1), +this.a('cat', 0), dk, res, +this.a('t', 0), +this.a('z', 4), dk === 'cp' ? 5 : 2);
      if (!this._off) { this._off = document.createElement('canvas'); this._off.width = this._off.height = res; }
      const oc = this._off.getContext('2d'), im = oc.createImageData(res, res), px = im.data, act = cfg.map((c, k) => (c.on ? { b: D2.B[k], lo: c.lo, span: Math.max(0.002, c.hi - c.lo), g: c.g || 1, L: lutCached(c.cm) } : null)).filter((x) => x && x.b);
      for (let i = 0; i < res * res; i++) { let R = 0, G = 0, Bb = 0; for (let k = 0; k < act.length; k++) { const a = act[k]; let v = (a.b[i] - a.lo) / a.span; if (v <= 0) continue; if (v > 1) v = 1; if (a.g !== 1) v = Math.pow(v, a.g); const j = ((v * 255) | 0) * 3; R += a.L[j]; G += a.L[j + 1]; Bb += a.L[j + 2]; } px[i * 4] = R; px[i * 4 + 1] = G; px[i * 4 + 2] = Bb; px[i * 4 + 3] = 255; }
      oc.putImageData(im, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); const s2 = Math.max(w, h) / res; ctx.imageSmoothingEnabled = true; ctx.drawImage(this._off, (w - res * s2) / 2, (h - res * s2) / 2, res * s2, res * s2);
      const mk = this.a('mark', ''); if (mk) { const b = res * s2 * 0.16; ctx.strokeStyle = mk; ctx.lineWidth = 1; ctx.strokeRect(w / 2 - b / 2 + 0.5, h / 2 - b / 2 + 0.5, b, b); }
    }
  }
  class CHist extends Base {
    static get observedAttributes() { return ['seed', 'cat', 'dk', 't', 'z', 'ch', 'col', 'lo', 'hi']; }
    draw() {
      if (!this.cv) return; const S = this.size(); if (!S) return; const { ctx, w, h } = S; const dk = this.a('dk', 'cp');
      const H = chanBufs(+this.a('seed', 1), +this.a('cat', 0), dk, 256, +this.a('t', 0), +this.a('z', 4), dk === 'cp' ? 5 : 2).hist[+this.a('ch', 0)]; if (!H) return;
      const lg = Array.from(H, (x) => Math.log1p(x)), mx = Math.max(...lg) || 1, lo = +this.a('lo', 0), hi = +this.a('hi', 1), col = this.a('col', '#ffffff'), bw = w / 64;
      ctx.clearRect(0, 0, w, h); lg.forEach((v, i) => { const x = i / 64, inR = x >= lo - 1 / 64 && x <= hi; ctx.fillStyle = inR ? col : '#4A4741'; ctx.globalAlpha = inR ? 0.75 : 0.6; const bh = (v / mx) * (h - 1); ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.5), bh); }); ctx.globalAlpha = 1;
    }
  }
  customElements.define('nd-multi', Multi); customElements.define('nd-chist', CHist);
  const durOf = (el) => { const v = parseFloat(getComputedStyle(el).getPropertyValue('--dur')); return isNaN(v) ? 180 : v; };
  class Num extends HTMLElement {
    static get observedAttributes() { return ['value']; }
    attributeChangedCallback(n, o, v) { const p = (x) => parseFloat(String(x || '').replace(/,/g, '')); const a = p(o), b = p(v), dur = this.isConnected ? durOf(this) * 1.6 : 0;
      cancelAnimationFrame(this._r); if (isNaN(a) || isNaN(b) || a === b || !dur || !/^[\d,.]+$/.test(String(v))) { this.textContent = v || ''; return; }
      const dec = (String(v).split('.')[1] || '').length, t0 = performance.now(), f = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), x = a + (b - a) * e; this.textContent = x.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); if (k < 1) this._r = requestAnimationFrame(f); }; this._r = requestAnimationFrame(f); }
    connectedCallback() { if (!this.textContent) this.textContent = this.getAttribute('value') || ''; }
  }
  customElements.define('nd-num', Num);
  customElements.define('nd-micro', Micro); customElements.define('nd-scatter', Scatter); customElements.define('nd-hist', Hist);

  /* ---------- workspace state ---------- */
  const shells = {}; const SELS = {};
  const api = { active: null, fval, fxPass, SELS, selSet: (ds) => SELS[ds] || null, dimInfo: (id, e) => dimInfo(id, e) };
  api.numRange = (id) => { const ob = data(id).obs; let lo = Infinity, hi = -Infinity; ob.forEach((o) => { if (o.area < lo) lo = o.area; if (o.area > hi) hi = o.area; }); return [lo, hi]; };
  api.chanStats = (seed, cat, dk, t, z, k) => { const H = chanBufs(seed, cat, dk, 256, t, z, dk === 'cp' ? 5 : 2).hist[k]; if (!H) return [0, 1]; const tot = H.reduce((a, b) => a + b, 0); let acc = 0, lo = 0, hi = 1; for (let i = 0; i < 64; i++) { acc += H[i]; if (acc < tot * 0.5) lo = i / 64; if (acc < tot * 0.998) hi = (i + 1) / 64; } return [Math.min(lo, 0.2), Math.max(hi, lo + 0.05)]; };

  function init(o) {
    return Object.assign({ ws: 'jump', ds: 'cp7', arr: 'explore', cat: null, src: 'all', focus: null, emb: 0, agentOpen: true, left: 'sources', menu: null, pal: false, q: '', sel: 0,
      toasts: [], agent: 'idle', steps: [], changes: null, added: {}, srcEdit: {}, extra: {}, viewRev: null, msgs: {}, draft: '', hover: null, prov: true, mode: 'propose', wide: false, max: null, tid: 0 }, o || {});
  }
  document.addEventListener('keydown', (e) => {
    const c = api.active; if (!c || !c._nd) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); c._nd.togglePal(); }
    else if (e.key === 'Escape') c._nd.esc();
  });

  function vals(comp, sid, opts) {
    opts = opts || {};
    if (!comp.state || !comp.state.s) { comp.state = Object.assign({}, comp.state, { s: init(opts.init) }); }
    const S = comp.state.s, up = (fn) => comp.setState((st) => { const s = Object.assign({}, st.s); fn(s); return { s }; });
    const colors = opts.colors || ['#888', '#888', '#888', '#888', '#888', '#888'], accent = opts.accent || '#6E4FF9';
    const firstRun = S.ws === 'new', d = DS[S.ds], D = data(S.ds), kind = d.kind, ws = WS.find((w) => w.id === S.ws);
    const toast = (s, text) => { const id = ++s.tid; s.toasts = s.toasts.concat([{ id, text }]).slice(-3); setTimeout(() => up((x) => { x.toasts = x.toasts.filter((t) => t.id !== id); }), 4200); };
    const baseRevs = REVS[S.ds].map(([r, who, what, t]) => ({ r, who, what, t })), revList = baseRevs.concat(S.extra[S.ds] || []), live = revList[revList.length - 1].r;
    const pushRev = (s, who, what) => { const ex = (s.extra[s.ds] || []).slice(), all = REVS[s.ds].map((x) => ({ r: x[0] })).concat(ex), r = all[all.length - 1].r + 1; ex.push({ r, who, what, t: clock() }); s.extra = Object.assign({}, s.extra, { [s.ds]: ex }); return r; };

    /* sources & counts */
    let sources = SOURCES[kind](d).map((x) => Object.assign({}, x));
    const edited = S.srcEdit[S.ds], ch = S.changes, chSrc = ch && ch[1];
    if (edited) { if (kind === 'cp') { sources[1].expr = 'nuclei_count ≥ 1 AND cell_area < 4200'; sources[1].count = Math.round(d.n * 0.9089); sources[1].by = 'agent'; sources[1].rev = edited; sources[1].why = 'Asked: add a chart for cell_area; capped debris'; }
      else sources.push({ id: 'mit2', name: 'Mitotic, gen ≥ 2', expr: 'state IN (prophase … telophase) AND generation ≥ 2', count: 9112, by: 'agent', rev: edited, why: 'Asked: add a chart for ' + d.numField }); }
    const excl = (S.excl || {})[S.ds] || [], inclN = d.parts.reduce((a, p, i) => a + (excl.includes(i) ? 0 : p.n), 0), fr = inclN / d.n;
    const src = sources.find((x) => x.id === S.src) || sources[0], base = Math.round(src.count * fr), scIdx = src.catEq != null ? src.catEq : -1;
    const ci = S.cat ? d.cats.findIndex((c) => c[0] === S.cat) : -1;
    const catCount = (i) => (scIdx >= 0 ? (i === scIdx ? Math.round(d.cats[i][1] * fr) : 0) : Math.round((d.cats[i][1] * base) / d.n));
    const fxS = (S.fx || {})[S.ds] || { m: 'and', c: [] }, fxOn = fxS.c.length > 0;
    const filt0 = D.sorted.filter((o) => !excl.includes(o.p) && (ci < 0 || o.c === ci) && (scIdx < 0 || o.c === scIdx));
    const selS = (S.lsel || {})[S.ds] || null, selSet = selS ? new Set(selS.idx) : null; if (selSet) SELS[S.ds] = selSet; else delete SELS[S.ds];
    const filt1 = fxOn ? filt0.filter((o) => fxPass(kind, d, o, fxS)) : filt0, brush = !!opts.brush && !!selSet && !selS.filt, selMem = selSet ? filt1.filter((o) => selSet.has(o.i)) : [], fromTbl = !!selS && selS.tool === 'table', filt = selSet ? (brush ? (fromTbl ? filt1 : selMem.concat(filt1.filter((o) => !selSet.has(o.i)))) : selMem) : filt1;
    const scopeN = Math.round((ci >= 0 ? catCount(ci) : base) * (filt0.length ? (brush ? filt1.length : filt.length) / filt0.length : 1));
    const focusO = D.obs[S.focus != null ? S.focus : (filt[0] || D.sorted[0]).i];
    const cmpId = (S.cmp || {})[S.ds] || null, dc = cmpId ? DS[cmpId] : null, cexcl = cmpId ? ((S.excl || {})[cmpId] || []) : [], cfr = dc ? dc.parts.reduce((a, p, i) => a + (cexcl.includes(i) ? 0 : p.n), 0) / dc.n : 1;
    const cmpCount = (i) => (dc ? Math.round(dc.cats[i][1] * cfr) : 0), cmpN = dc ? (ci >= 0 ? cmpCount(ci) : Math.round(dc.n * cfr)) : 0;
    const toggleExcl = (i) => up((s) => { const cur = ((s.excl || {})[s.ds] || []).slice(), k = cur.indexOf(i); if (k >= 0) cur.splice(k, 1); else if (cur.length < d.parts.length - 1) cur.push(i); s.excl = Object.assign({}, s.excl, { [s.ds]: cur }); });
    const setCmp = (id) => up((s) => { s.cmp = Object.assign({}, s.cmp, { [s.ds]: id }); toast(s, id ? 'Comparing with ' + DS[id].name : 'Comparison closed'); });

    /* actions */
    const focusObs = (i) => up((s) => { s.focus = i; });
    const setSel = (fn) => up((s) => { s.lsel = Object.assign({}, s.lsel, { [s.ds]: fn((s.lsel || {})[s.ds] || null) }); });
    const lasso = (idx, mode, src, tool) => { if (mode === 'clear') { if ((S.lsel || {})[S.ds]) setSel(() => null); return; }
      setSel((cur) => { let set = new Set(cur && mode !== 'replace' ? cur.idx : []); if (mode === 'sub') idx.forEach((i) => set.delete(i)); else idx.forEach((i) => set.add(i)); if (mode === 'sub' && !cur) return null; return set.size ? { idx: [...set], src, tool, v: Date.now() } : null; }); };
    const lasso2 = opts.brush ? (idx, mode, src, tool) => { lasso(idx, mode, src, tool); if (mode !== 'clear' && mode !== 'sub' && idx && idx.length) { const has = new Set(idx), best = D.sorted.find((o) => has.has(o.i)); if (best) up((s) => { s.focus = best.i; }); } } : lasso;
    shells[sid] = { focusObs, lasso: lasso2 };
    const pickCat = (name) => up((s) => { s.cat = s.cat === name ? null : name; const ex = (s.extra[s.ds] || []).slice(); const last = ex[ex.length - 1];
      const what = s.cat ? 'Filter F1: ' + d.catField + ' = ' + s.cat : 'Cleared filter F1'; if (last && last.f) { last.what = what; last.t = clock(); s.extra = Object.assign({}, s.extra, { [s.ds]: ex }); } else { pushRev(s, 'you', what); s.extra[s.ds][s.extra[s.ds].length - 1].f = true; }
      const ci2 = s.cat ? d.cats.findIndex((c) => c[0] === s.cat) : -1; const cur = D.obs[s.focus != null ? s.focus : D.sorted[0].i]; if (ci2 >= 0 && cur.c !== ci2) s.focus = D.sorted.find((o) => o.c === ci2).i; });
    const resetAgent = (s) => { (comp._t || []).forEach(clearTimeout); comp._t = []; s.agent = 'idle'; s.steps = []; s.changes = null; };
    const setDs = (id) => up((s) => { resetAgent(s); s.ds = id; s.cat = null; s.src = 'all'; s.focus = null; s.menu = null; s.viewRev = null; s.max = null; toast(s, 'Opened ' + DS[id].name + ' · ' + fmt(DS[id].n) + ' ' + DS[id].unit); });
    const setWs = (id) => up((s) => { resetAgent(s); const w = WS.find((x) => x.id === id); s.ws = id; s.menu = null; s.cat = null; s.src = 'all'; s.focus = null; s.viewRev = null; s.max = null; if (w.ds.length) s.ds = w.ds[0]; toast(s, 'Switched to ' + w.name); });
    const settle = (s) => { if (s.changes && s.changes.every((c) => c.status !== 'pending')) { s.agent = 'idle'; } };
    const decide = (k, ok) => up((s) => { const cs = s.changes.map((c) => Object.assign({}, c)), c = cs[k]; if (!c || c.status !== 'pending') return; c.status = ok ? 'accepted' : 'rejected';
      if (ok) { const r = pushRev(s, 'agent', c.k === 'tile' ? 'Added tile Histogram · ' + d.numField : c.title.replace(' · ', ' ')); c.rev = 'r' + r; if (c.k === 'tile') s.added = Object.assign({}, s.added, { [s.ds]: 'r' + r }); else s.srcEdit = Object.assign({}, s.srcEdit, { [s.ds]: 'r' + r }); toast(s, 'Accepted · ' + c.title); }
      s.changes = cs; settle(s); });
    const decideAll = (ok) => { [0, 1].forEach((k) => decide(k, ok)); };
    const log = (s, e) => { s.act = Object.assign({}, s.act, { [s.ds]: ((s.act || {})[s.ds] || ACT[kind].map((a) => ({ t: a[0], tool: a[1], arg: a[2], res: a[3], write: !!a[4] }))).concat([Object.assign({ t: clock() }, e)]) }); };
    const simulate = () => {
      if (S.agent === 'working' || firstRun) return;
      up((s) => { resetAgent(s); s.agent = 'working'; s.pal = false; if (opts.onSim) opts.onSim(s); });
      const steps = [['get_project', '', '7 tiles'], ['list_components', '', '9 components'], ['list_fields', d.name, d.fields + ' fields'], ['count', 'scope F1', fmt(scopeN)], ['propose_edits', '3 edits', '2 valid · 1 rejected']];
      comp._t = steps.map((st, i) => setTimeout(() => up((s) => { s.steps = s.steps.concat([{ x: st[0] + (st[1] ? ' · ' + st[1] : '') + ' → ' + st[2] }]); log(s, { tool: st[0], arg: st[1], res: st[2], write: i === 4 }); }), 420 * (i + 1)));
      comp._t.push(setTimeout(() => up((s) => {
        s.steps = [];
        s.changes = PROPOSAL[kind](d).map((c) => Object.assign({}, c, { status: c.k === 'rej' ? 'invalid' : 'pending' }));
        if (s.mode === 'direct') { s.agent = 'idle'; [0, 1].forEach((k) => { const c = s.changes[k]; const r = pushRev(s, 'agent', c.k === 'tile' ? 'Added tile Histogram · ' + d.numField : c.title.replace(' · ', ' ')); c.status = 'accepted'; c.rev = 'r' + r; if (c.k === 'tile') s.added = Object.assign({}, s.added, { [s.ds]: 'r' + r }); else s.srcEdit = Object.assign({}, s.srcEdit, { [s.ds]: 'r' + r }); });
          toast(s, 'claude-code applied 2 edits · 1 rejected'); }
        else { s.agent = 'proposed'; toast(s, 'claude-code proposed 3 edits · 1 rejected'); }
      }), 420 * (steps.length + 1) + 200));
    };
    const copyRef = (what) => up((s) => { toast(s, 'Copied ndea://' + s.ws + '/' + s.ds + '/' + what); });
    const N = comp._nd = {
      togglePal: () => up((s) => { s.pal = !s.pal; s.q = ''; s.sel = 0; s.menu = null; }),
      esc: () => up((s) => { if (!s.pal && !s.menu && !s.max && !s.embMenu && s.lsel && s.lsel[s.ds]) s.lsel = Object.assign({}, s.lsel, { [s.ds]: null }); s.pal = false; s.menu = null; s.max = null; s.embMenu = null; }),
    };
    if (!comp._rootRef) comp._rootRef = (el) => { if (!el || comp._ro) return; comp._ro = new ResizeObserver(() => { const wd = el.clientWidth >= 2200; if (wd !== comp.state.s.wide) up((s) => { s.wide = wd; }); }); comp._ro.observe(el); };
    if (!comp._palRef) comp._palRef = (el) => { if (el) setTimeout(() => el.focus(), 0); };

    /* palette */
    const cmds = [], arr = ARR[S.arr];
    if (!firstRun) {
      const sk = (S.slot || {})[S.ds], busy = S.agent === 'working' || (S.changes && S.changes[0].status === 'pending') || S.added[S.ds];
      if (sk === 'empty') cmds.push({ label: 'Fill slot: Histogram · ' + d.numField, hint: 'component', run: () => fillSlot('hist') }, { label: 'Remove empty slot', hint: 'layout', run: () => fillSlot('none') });
      else if (!sk && !busy) cmds.push({ label: 'Add empty slot (split Table)', hint: 'layout', run: () => fillSlot('empty') });
    }
    if (!firstRun) { cmds.push({ label: 'Layout: exploration', hint: 'layout', run: () => up((s) => { s.arr = 'explore'; s.max = null; }) }, { label: 'Layout: review', hint: 'layout', run: () => up((s) => { s.arr = 'review'; s.max = null; }) });
      cmds.push({ label: 'Copy reference: scope F1' + (S.cat ? ' (' + S.cat + ')' : ''), hint: 'harness', run: () => copyRef('scopes/F1') }, { label: 'Copy reference: focused observation', hint: 'harness', run: () => copyRef('obs/' + focusO.short) });
      if (S.changes && S.changes.some((c) => c.status === 'pending')) cmds.push({ label: 'Review: accept all pending edits', hint: 'review', run: () => decideAll(true) });
      cmds.push({ label: 'Prototype: simulate harness edit', hint: 'demo', run: () => simulate() });
      if (S.cat) cmds.push({ label: 'Clear filter F1 (' + d.catField + ' = ' + S.cat + ')', hint: 'filter', run: () => pickCat(S.cat) });
      cmds.push({ label: 'Focus next observation', hint: 'focus', run: () => { const k = filt.findIndex((o) => o.i === focusO.i); focusObs(filt[(k + 1) % filt.length].i); } }); }
    const embCmds = []; if (!firstRun) EMB[kind].forEach((e, k) => embCmds.push({ label: 'Embedding 1: ' + e[0] + ' · ' + e[1], hint: 'embedding', run: () => up((s) => { s.te = Object.assign({}, s.te, { [s.ds]: Object.assign({}, (s.te || {})[s.ds] || {}, { emb: k }) }); }) }));
    WS.filter((w) => w.id !== S.ws).forEach((w) => cmds.push({ label: 'Project: ' + w.name, hint: 'project', run: () => setWs(w.id) }));
    (ws.ds || []).filter((x) => x !== S.ds || firstRun).forEach((x) => cmds.push({ label: 'Dataset: ' + DS[x].name, hint: 'dataset', run: () => setDs(x) }));
    cmds.push({ label: 'Panel: harness session', hint: 'panel', run: () => up((s) => { s.agentOpen = !s.agentOpen; }) }, { label: 'Panel: data sources', hint: 'panel', run: () => up((s) => { s.left = s.left === 'sources' ? null : 'sources'; }) }, { label: 'Settings', hint: 'panel', run: () => up((s) => { s.left = s.left === 'settings' ? null : 'settings'; }) });
    if (!firstRun) { (ws.ds || []).filter((x) => x !== S.ds).forEach((x) => cmds.push({ label: (cmpId === x ? 'Stop comparing with ' : 'Compare with ') + DS[x].name, hint: 'collection', run: () => setCmp(cmpId === x ? null : x) })); }
    cmds.push(...embCmds);
    const qq = S.q.trim().toLowerCase(), shown = cmds.filter((c) => !qq || c.label.toLowerCase().includes(qq)).slice(0, 10), sel = Math.min(S.sel, Math.max(0, shown.length - 1));
    const runCmd = (c) => { up((s) => { s.pal = false; }); c.run(); };

    /* tiles */
    const added = S.added[S.ds], working = S.agent === 'working', proposedTile = ch && ch[0].status === 'pending';
    const slotK = (S.slot || {})[S.ds] || (added ? 'hist' : null), slotShown = !!slotK || working || proposedTile, slotHistK = slotK === 'hist' || !!added;
    const geoA = S.wide && arr.wide ? arr.wide : arr, geo0 = (opts.noMul || opts.noMet) ? Object.assign({}, geoA, { areas: geoA.areas.replace(opts.noMul ? /\bmul\b/g : /^$/, 'emb2').replace(opts.noMet ? /\bmet\b/g : /^$/, 'cat') }) : geoA, geo = slotShown ? geo0 : Object.assign({}, geo0, { areas: geo0.areas.replace(/(\w+) slot/g, '$1 $1') });
    const fillSlot = (k) => up((s) => { s.slot = Object.assign({}, s.slot, { [s.ds]: k }); toast(s, k === 'empty' ? 'Added empty slot' : k === 'none' ? 'Removed empty slot' : 'Slot filled · ' + (k === 'hist' ? 'Histogram' : 'Annotation')); if (k === 'none') s.slot[s.ds] = null; });
    const labels = (S.labels || {})[S.ds] || (kind === 'cp' ? [214, 96, 41, 1120] : [388, 52, 17, 940]);
    const LABELS = kind === 'cp' ? ['mitotic arrest', 'multinucleate', 'debris', 'normal'] : ['missed division', 'merge error', 'debris', 'correct'];
    const label = (k) => up((s) => { const L = labels.slice(); L[k]++; s.labels = Object.assign({}, s.labels, { [s.ds]: L }); toast(s, 'Labeled ' + focusO.short + ' · ' + LABELS[k]); });
    const scopeOn = (k) => ({ k, label: k, on: S.hover === k, enter: () => up((s) => { s.hover = k; }), leave: () => up((s) => { s.hover = null; }) });
    let tileIds = []; geo.areas.replace(/"/g, ' ').split(/\s+/).forEach((t) => { if (t && !tileIds.includes(t)) tileIds.push(t); }); const allTiles = tileIds.slice(); if (S.max && tileIds.includes(S.max)) tileIds = [S.max];
    const EL = EMB[kind], te = Object.assign({ emb: 0, emb2: kind === 'cp' ? 4 : 1 }, (S.te || {})[S.ds] || {}), embLabel = (e) => EL[e][0] + ' · ' + EL[e][1];
    const setEmb = (tile, e) => up((s) => { s.te = Object.assign({}, s.te, { [s.ds]: Object.assign({}, te, { [tile]: e }) }); s.embMenu = null; s.embQ = ''; });
    const usedBy = (k) => ['emb', 'emb2'].filter((t) => te[t] === k && allTiles.includes(t)).map((t) => (t === 'emb' ? 'Embedding 1' : 'Embedding 2')).join(', ');
    const eq = (S.embQ || '').toLowerCase();
    const TITLE = { emb: cmpId ? d.name.split(' · ').pop() : 'Embedding 1', emb2: cmpId ? dc.name.split(' · ').pop() : 'Embedding 2', mul: 'All embeddings · ' + EL.length, img: 'Image viewer', tbl: 'Table', gal: 'Crop gallery', cat: 'Categories · ' + d.catField, met: 'Count', slot: slotHistK ? 'Histogram · ' + d.numField : slotK === 'annot' ? 'Annotation · phenotype' : proposedTile ? 'Proposed · Histogram' : 'Empty slot' };
    const SUB = { emb: EL[te.emb][2], emb2: EL[te.emb2][2], mul: 'click one to load it into Embedding 1', img: focusO.short, tbl: fmt(scopeN) + ' rows · sorted ' + (kind === 'cp' ? 'cell_area' : 'speed') + ' desc', gal: fmt(scopeN) + ' crops · sorted ' + (kind === 'cp' ? 'cell_area' : 'speed') + ' desc', cat: 'excludes own selection', met: 'scope F1', slot: slotHistK ? 'stacked by ' + d.catField : slotK === 'annot' ? 'labels the focused observation' : proposedTile ? 'claude-code · pending review' : working ? 'claude-code is editing' : 'choose a component with ⌘K' };
    const tiles = firstRun ? [] : tileIds.map((id) => {
      const pv = id === 'slot' ? (added ? ['agent', added, 'Intent: ' + INTENT[kind]] : slotK && slotK !== 'empty' ? ['you', ''] : null) : PROV[id], sc = id === 'slot' ? (slotHistK ? SCOPES.slot : slotK === 'annot' ? ['FOCUS'] : []) : SCOPES[id];
      const hl = !!S.hover && sc.includes(S.hover), dim = !!S.hover && !hl;
      return { id, area: id, title: TITLE[id], sub: SUB[id], scopes: sc.map(scopeOn), hasScopes: sc.length > 0,
        by: pv ? (pv[0] === 'you' ? 'You' : pv[0]) : '', rev: pv ? pv[1] : '', why: pv && pv[2] ? pv[2] : '', isAgent: !!pv && pv[0] === 'agent', hasProv: !!pv && S.prov, agentProv: !!pv && pv[0] === 'agent' && S.prov,
        hl, dim, ol: hl ? '1px solid ' + accent : '1px solid transparent', op: dim ? '0.4' : '1',
        tdsId: id === 'emb2' && cmpId ? cmpId : S.ds, tfocus: id === 'emb2' && cmpId ? '-1' : String(focusO.i), isCmpTile: id === 'emb2' && !!cmpId, texcl: (id === 'emb2' && cmpId ? cexcl : excl).join(','), isEmb: id === 'emb' || id === 'emb2', isMul: id === 'mul', embIdx: String(te[id] != null ? te[id] : 0), embLabel: te[id] != null ? embLabel(te[id]) : '', embMenuOpen: S.embMenu === id,
        toggleEmbMenu: () => up((s) => { s.embMenu = s.embMenu === id ? null : id; s.embQ = ''; }), embQ: S.embQ || '', onEmbQ: (e) => { const v = e.target.value; up((s) => { s.embQ = v; }); },
        embItems: S.embMenu === id ? EL.map((e, k) => ({ label: embLabel(k), params: e[2], by: e[3] === 'you' ? 'You' : e[3] === 'agent' ? 'claude-code' : e[3], on: te[id] === k, used: usedBy(k), onClick: () => setEmb(id, k) })).filter((x) => !eq || x.label.toLowerCase().includes(eq)) : [],
        isImg: id === 'img', isTbl: id === 'tbl', isGal: id === 'gal', isCat: id === 'cat', isMet: id === 'met', isSlot: id === 'slot',
        slotEmpty: id === 'slot' && slotK === 'empty' && !working && !proposedTile, slotWorking: id === 'slot' && working && !slotHistK, slotProposed: id === 'slot' && proposedTile, slotHist: id === 'slot' && slotHistK && !proposedTile, slotAnnot: id === 'slot' && slotK === 'annot' && !working && !proposedTile,
        copyRef: () => copyRef('tiles/' + id), isMax: S.max === id, onMax: () => up((s) => { s.max = s.max === id ? null : id; }), maxLabel: S.max === id ? 'Restore' : 'Fullscreen' };
    });

    const cols = kind === 'cp' ? ['well', 'site', 'treatment', 'plate', 'cell_area', 'nuc_int'] : ['track_id', 'frame', 'state', 'speed', 'gen'];
    const cellsOf = (o) => (kind === 'cp' ? [o.well, 's' + o.site, d.cats[o.c][0], o.plate.slice(-4), fmt(o.area), o.nuc] : [o.track, o.frame, d.cats[o.c][0], o.speed, o.gen]);
    const dimOf = (o) => (brush && !selSet.has(o.i) ? '0.35' : '1');
    const rows = filt.slice(0, 40).map((o) => ({ oi: o.i, op: fromTbl ? '1' : dimOf(o), cells: cellsOf(o).map((v) => ({ v: String(v) })), on: o.i === focusO.i, bg: o.i === focusO.i ? (opts.rowOn || 'rgba(127,127,127,.18)') : 'transparent', onClick: () => focusObs(o.i) }));
    const crops = filt.slice(0, S.arr === 'review' ? 60 : 24).map((o) => ({ op: dimOf(o), seed: o.i + d.seed * 10000, cat: o.c, on: o.i === focusO.i, ol: o.i === focusO.i ? '2px solid ' + accent : '2px solid transparent', label: o.short, onClick: () => focusObs(o.i) }));
    const fields = kind === 'cp' ? [['treatment', d.cats[focusO.c][0]], ['plate', focusO.plate], ['well', focusO.well], ['site', 's' + focusO.site], ['cell_area', fmt(focusO.area) + ' px²'], ['nuc_int', focusO.nuc]] : [['track_id', focusO.track], ['frame', focusO.frame + ' / 288'], ['state', d.cats[focusO.c][0]], ['speed', focusO.speed + ' µm/min'], ['generation', focusO.gen]];
    const act = (((S.act || {})[S.ds]) || ACT[kind].map((a) => ({ t: a[0], tool: a[1], arg: a[2], res: a[3], write: !!a[4] }))).slice().reverse().map((a) => ({ t: a.t, tool: a.tool, arg: a.arg || '', hasArg: !!a.arg, res: a.res, write: a.write, read: !a.write }));
    const changes = (ch || []).map((c, k) => ({ title: c.title, detail: c.detail || '', reason: c.reason || '', old: c.old || '', nw: c.nw || '', hasOld: !!c.old, hasNw: !!c.nw,
      isTile: c.k === 'tile', isSource: c.k === 'source', isRej: c.k === 'rej', pending: c.status === 'pending', accepted: c.status === 'accepted', rejected: c.status === 'rejected', invalid: c.status === 'invalid', done: c.status === 'accepted' || c.status === 'rejected',
      status: { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected by you', invalid: 'Rejected by ndea' }[c.status], accept: () => decide(k, true), reject: () => decide(k, false) }));
    const pendingN = (ch || []).filter((c) => c.status === 'pending').length;
    const srcPending = chSrc && chSrc.status === 'pending';
    const srcItems = firstRun ? [] : sources.map((x, k) => ({ name: x.name, expr: x.expr, count: fmt(x.count), by: x.by === 'you' ? 'You' : x.by, rev: x.rev || '', why: x.why || '', isAgent: x.by === 'agent', on: x.id === src.id, onClick: () => up((s) => { s.src = x.id; }),
      diff: srcPending && kind === 'cp' && k === 1, oldExpr: kind === 'cp' ? 'nuclei_count ≥ 1' : '', newExpr: chSrc ? chSrc.nw : '', newCount: chSrc ? chSrc.detail : '' }));
    const srcNew = srcPending && kind === 'tr' ? [{ name: 'Mitotic, gen ≥ 2', expr: chSrc.nw, count: chSrc.detail }] : [];
    const scopes = firstRun ? [] : [
      { k: 'F1', kind: 'filter', def: ([S.cat ? d.catField + ' = ' + S.cat : '', selS ? (selS.tool === 'table' ? 'rows in ' + selS.src : selS.tool + ' on ' + selS.src) + ' · ' + fmt(fromTbl ? selMem.length : Math.round((selMem.length / Math.max(1, D.obs.length)) * d.n)) : ''].filter(Boolean).join(' · ') || 'no selection') + (cmpId ? ' · applies to 2 collections' : ''), members: allTiles.filter((t) => SCOPES[t].includes('F1') && (t !== 'slot' || added)).map((t) => TITLE[t]).join(', ') },
      { k: 'FOCUS', kind: 'focus', def: focusO.short, members: allTiles.filter((t) => SCOPES[t].includes('FOCUS')).map((t) => TITLE[t]).join(', ') },
      { k: 'COLOR', kind: 'color-by', def: d.catField, members: allTiles.filter((t) => SCOPES[t].includes('COLOR') && (t !== 'slot' || added)).map((t) => TITLE[t]).join(', ') },
    ].map((x) => Object.assign(x, scopeOn(x.k)));
    const revs = revList.slice().reverse().map((x) => ({ r: 'r' + x.r, who: x.who === 'you' ? 'You' : x.who, what: x.what, t: x.t, isAgent: x.who === 'agent', on: S.viewRev === x.r, live: x.r === live, onClick: () => up((s) => { s.viewRev = x.r === live ? null : x.r; }) }));
    const L = (k) => () => up((s) => { s.left = s.left === k ? null : k; s.menu = null; });

    return {
      shellId: sid, rootRef: comp._rootRef, enter: () => { api.active = comp; },
      wsName: ws.name, dsName: firstRun ? 'No dataset' : d.name, dsPath: d.path, dk: kind, dsId: S.ds, firstRun, notFirstRun: !firstRun, wide: S.wide,
      wsList: WS.map((w) => ({ name: w.name, sub: w.ds.length ? w.ds.length + (w.ds.length > 1 ? ' collections' : ' collection') : 'empty', on: w.id === S.ws, onClick: () => setWs(w.id) })),
      dsList: (ws.ds || []).map((x) => ({ name: DS[x].name, sub: DS[x].parts.length + ' ' + DS[x].parts[0].label + 's · ' + fmt(DS[x].n), on: x === S.ds, off: x !== S.ds, onClick: () => setDs(x) })),
      menuWs: S.menu === 'ws', menuDs: S.menu === 'ds', toggleWsMenu: () => up((s) => { s.menu = s.menu === 'ws' ? null : 'ws'; }), toggleDsMenu: () => up((s) => { s.menu = s.menu === 'ds' ? null : 'ds'; }), closeMenu: () => up((s) => { s.menu = null; }),
      firstRunOpts: [{ label: 'Open OME-Zarr image store', sub: 'Local path or s3:// URL. Observations are read from its label tables.', onClick: () => setWs('jump') }, { label: 'Open observation table', sub: 'Parquet or CSV with an id column and embedding columns.', onClick: () => setWs('mito') }, { label: 'Connect a harness over MCP', sub: 'claude mcp add ndea -- ndea mcp --workspace untitled', onClick: () => setWs('jump') }],
      arrKey: S.arr, setArr: (k) => up((s) => { s.arr = k; s.max = null; }),
      arrExplore: S.arr === 'explore', arrReview: S.arr === 'review', setExplore: () => up((s) => { s.arr = 'explore'; s.max = null; }), setReview: () => up((s) => { s.arr = 'review'; s.max = null; }),
      gridCols: S.max ? 'minmax(0,1fr)' : geo.cols, gridRows: S.max ? 'minmax(0,1fr)' : geo.rows, gridAreas: S.max ? '"' + S.max + '"' : geo.areas, tiles, maxed: !!S.max,
      cats: d.cats.map((c, i) => { const n = catCount(i); return { name: c[0], count: fmt(n), count2: fmt(cmpCount(i)), w: ((n / Math.max(...d.cats.map((_, j) => catCount(j)))) * 100).toFixed(1) + '%', color: colors[i], on: S.cat === c[0], off: !!S.cat && S.cat !== c[0], op: S.cat && S.cat !== c[0] ? '0.45' : '1', onClick: () => pickCat(c[0]) }; }),
      catField: d.catField, catSel: S.cat || '', hasCat: !!S.cat, clearCat: () => S.cat && pickCat(S.cat),
      fxShared: fxS, fxAttr: fxOn ? JSON.stringify(fxS) : '', setFxShared: (fx) => up((s) => { s.fx = Object.assign({}, s.fx, { [s.ds]: fx }); }),
      lselKey: selS ? String(selS.v) : '', hasLsel: !!selS, lselN: selS ? fmt(fromTbl ? selMem.length : Math.round((selMem.length / Math.max(1, D.obs.length)) * d.n)) : '', lselFiltered: !!selS && !!selS.filt, lselBrush: !!selS && !selS.filt, filterToSel: () => setSel((cur) => (cur ? Object.assign({}, cur, { filt: !cur.filt, v: Date.now() }) : null)), lselSrc: selS ? selS.src : '', lselTool: selS ? (selS.tool === 'box' ? 'box' : selS.tool === 'table' ? 'table rows' : 'lasso') : '', setLselIdx: (idx, src, tool) => setSel(() => (idx && idx.length ? { idx, src, tool, v: Date.now() } : null)),
      clearLsel: () => setSel(() => null), invertLsel: () => setSel((cur) => { if (!cur) return null; const has = new Set(cur.idx), inv = filt1.filter((o) => !has.has(o.i)).map((o) => o.i); return inv.length ? { idx: inv, src: cur.src, tool: cur.tool, v: Date.now(), inv: !cur.inv } : null; }),
      saveLsel: () => up((s) => { toast(s, 'Saved selection as a source · ' + fmt(Math.round((filt.length / Math.max(1, D.obs.length)) * d.n)) + ' ' + d.unit); }),
      scopeCount: fmt(scopeN), totalCount: fmt(Math.round(d.n * fr)), unit: d.unit, pctScope: ((scopeN / d.n) * 100).toFixed(1) + '%', srcName: src.name,
      cols: cols.map((h) => ({ h })), rows, crops, numField: d.numField,
      focusId: focusO.id, focusShort: focusO.short, focusCat: focusO.c, focusSeed: focusO.i * 7 + d.seed, focusFields: fields.map(([k, v]) => ({ k, v: String(v) })), channels: d.channels.map((c, i) => ({ c, on: i === 0 })), dims: d.dims,
      minis: EL.map((e, k) => ({ idx: String(k), method: e[0], model: e[1], on: te.emb === k, used: usedBy(k), ol: te.emb === k ? '1px solid ' + accent : te.emb2 === k ? '1px dashed ' + accent : '1px solid transparent', onClick: () => setEmb('emb', k) })),
      embList: EL.map((e, k) => ({ label: embLabel(k), params: e[2], by: e[3] === 'you' ? 'You' : e[3] === 'agent' ? 'claude-code' : e[3], used: usedBy(k), isUsed: !!usedBy(k), onClick: () => setEmb('emb', k) })), embCount: String(EL.length), srcCat: String(scIdx),
      focusIdx: String(focusO.i), focusCropSeed: String(focusO.i + d.seed * 10000), catAttr: S.cat || '',
      parts: d.parts.map((p, i) => { const dm = (d.dims.match(/(\d+) × (\d+)/) || [0, '?', '?']), cN = (d.dims.match(/c (\d+)/) || [0, '?'])[1], tN = (d.dims.match(/t (\d+)/) || [0, '1'])[1], zN = (d.dims.match(/z (\d+)/) || [0, '1'])[1];
        return { name: p.name, count: fmt(p.n), on: !excl.includes(i), off: excl.includes(i), onClick: () => toggleExcl(i),
          adFile: p.name + '.h5ad', adMeta: fmt(p.n) + ' × ' + d.fields, zFile: p.name + '.ome.zarr', zMeta: (tN !== '1' ? 't' + tN + ' ' : '') + 'c' + cN + (zN !== '1' ? ' z' + zN : '') + ' · ' + dm[1] + '²', key: d.kind === 'cp' ? 'obs.plate' : 'obs.fov' }; }),
      dataRoot: d.path.replace(/\/[^\/]*$/, '/'), pairFields: String(d.fields), pairChannels: d.channels.join(' · '), pairCh: String(d.channels.length), partLabel: d.parts[0].label, partCount: String(d.parts.length - excl.length) + ' of ' + d.parts.length + ' ' + d.parts[0].label + 's',
      exclAttr: excl.join(','), includeAll: () => up((s) => { s.excl = Object.assign({}, s.excl, { [s.ds]: [] }); }), someExcluded: excl.length > 0,
      cmpOpts: (ws.ds || []).filter((x) => x !== S.ds).map((x) => ({ name: DS[x].name, sub: DS[x].parts.length + ' ' + DS[x].parts[0].label + 's · ' + fmt(DS[x].n), on: cmpId === x, off: cmpId !== x, onClick: () => setCmp(cmpId === x ? null : x) })), hasCmpOpts: (ws.ds || []).length > 1,
      comparing: !!cmpId, cmpName: dc ? dc.name : '', cmpShort: dc ? dc.name.split(' · ').pop() : '', cmpCount: fmt(cmpN), cmpTotal: dc ? fmt(Math.round(dc.n * cfr)) : '', dsShort: d.name.split(' · ').pop(), stopCmp: () => setCmp(null),
      sources: srcItems, srcNew, hasSrcNew: srcNew.length > 0, scopes, revs, liveRev: 'r' + live, viewing: S.viewRev != null, notViewing: S.viewRev == null, viewRevLabel: 'r' + S.viewRev,
      restore: () => up((s) => { const v = s.viewRev; s.viewRev = null; const r = pushRev(s, 'you', 'Restored r' + v); toast(s, 'Restored r' + v + ' as r' + r); }), backLive: () => up((s) => { s.viewRev = null; }),
      act, intent: INTENT[kind], session: 'claude-code', sessionHost: 'maya@lab-mbp · ~/screens/jump', sessionSince: 'since 09:52', simulate, copyTileRef: () => copyRef('tiles/slot'),
      agentIdle: S.agent === 'idle', agentWorking: working, agentProposed: S.agent === 'proposed', steps: S.steps.map((x) => ({ x })), changes, hasChanges: changes.length > 0, pendingN: String(pendingN), hasPending: pendingN > 0,
      acceptTile: () => decide(0, true), rejectTile: () => decide(0, false), acceptSrc: () => decide(1, true), rejectSrc: () => decide(1, false), srcPending: !!srcPending,
      acceptAll: () => decideAll(true), rejectAll: () => decideAll(false), clearChanges: () => up((s) => { if (s.agent !== 'working') { s.changes = null; s.agent = 'idle'; } }),
      agentOpen: S.agentOpen, agentClosed: !S.agentOpen, toggleAgent: () => up((s) => { s.agentOpen = !s.agentOpen; }),
      left: S.left || '', leftOpen: !!S.left, leftSources: S.left === 'sources', leftScopes: S.left === 'scopes', leftRevs: S.left === 'revs', leftSettings: S.left === 'settings',
      toggleSources: L('sources'), toggleScopes: L('scopes'), toggleRevs: L('revs'), toggleSettings: L('settings'), closeLeft: () => up((s) => { s.left = null; }),
      openSlotPal: () => up((s) => { s.pal = true; s.q = 'slot'; s.sel = 0; }),
      labelItems: LABELS.map((l, k) => ({ key: String(k + 1), label: l, count: fmt(labels[k]), onClick: () => label(k) })),
      palOpen: S.pal, openPal: N.togglePal, closePal: () => up((s) => { s.pal = false; }), q: S.q, palRef: comp._palRef,
      onQ: (e) => { const v = e.target.value; up((s) => { s.q = v; s.sel = 0; }); },
      onQKey: (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); up((s) => { s.sel = Math.min(shown.length - 1, sel + 1); }); } else if (e.key === 'ArrowUp') { e.preventDefault(); up((s) => { s.sel = Math.max(0, sel - 1); }); } else if (e.key === 'Enter' && shown[sel]) runCmd(shown[sel]); else if (e.key === 'Escape') up((s) => { s.pal = false; }); },
      palCmds: cmds.filter((c) => !/^(Layout|Workspace|Dataset):/.test(c.label)).map((c) => ({ label: c.label, hint: c.hint, run: () => runCmd(c) })),
      kTree: WS.filter((w) => w.ds.length).map((w) => ({ id: w.id, name: w.name, on: w.id === S.ws, open: () => setWs(w.id),
        colls: w.ds.map((x) => { const X = DS[x], ex = (S.excl || {})[x] || []; return { id: x, name: X.name, n: fmt(X.n), unit: X.unit, partLabel: X.parts[0].label, on: x === S.ds && w.id === S.ws,
          open: () => { if (w.id !== S.ws) setWs(w.id); setTimeout(() => setDs(x), 0); },
          parts: X.parts.map((p, i) => ({ name: p.name, n: fmt(p.n), on: x === S.ds && !ex.includes(i) && ex.length > 0 && ex.length === X.parts.length - 1,
            open: () => { if (w.id !== S.ws) setWs(w.id); setTimeout(() => { if (x !== S.ds) setDs(x); setTimeout(() => up((s2) => { s2.excl = Object.assign({}, s2.excl, { [x]: X.parts.map((_, j) => j).filter((j) => j !== i) }); toast(s2, 'Showing only ' + p.name); }), 0); }, 0); } })) }; }) })),
      palItems: shown.map((c, i) => ({ label: c.label, hint: c.hint, on: i === sel, bg: i === sel ? (opts.palOn || 'rgba(127,127,127,.18)') : 'transparent', onClick: () => runCmd(c), onEnter: () => up((s) => { s.sel = i; }) })), palEmpty: shown.length === 0,
      toasts: S.toasts.map((t) => ({ text: t.text, hasUndo: !!t.undo, onUndo: () => { up((s) => { s.toasts = s.toasts.filter((x) => x.id !== t.id); }); t.undo && t.undo(); }, onClose: () => up((s) => { s.toasts = s.toasts.filter((x) => x.id !== t.id); }) })), hasToasts: S.toasts.length > 0,
      modePropose: S.mode === 'propose', modeDirect: S.mode === 'direct', setPropose: () => up((s) => { s.mode = 'propose'; }), setDirect: () => up((s) => { s.mode = 'direct'; }),
      prov: S.prov, toggleProv: () => up((s) => { s.prov = !s.prov; }), provLabel: S.prov ? 'On' : 'Off',
      conn: 'MCP · 1 agent connected', hoverScope: S.hover || '', scopeHover: !!S.hover,
    };
  }
  api.vals = vals; api.fmt = fmt; api.shells = shells;
  window.NDEA = api;
})();
