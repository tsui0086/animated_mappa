/* Route Atlas · static map animation studio */
(() => {
  'use strict';

  const STORAGE_KEY = 'route-atlas-project-v1';
  const SHAPE_SIZES = {
    '16:9': [1920, 1080],
    '9:16': [1080, 1920],
    '1:1': [1080, 1080],
    '4:5': [1080, 1350],
    '4:3': [1440, 1080],
  };
  const COLORS = ['#ff7045', '#f5bb63', '#5f9cff', '#4fc59b', '#df6c9a', '#ffffff', '#1b1d22'];
  const TILE_STYLES = {
    paper: { label: 'Paper', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors' },
    terrain: { label: 'Terrain', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap' },
    night: { label: 'Night', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO' },
  };

  const defaultPoints = [
    [37.7749, -122.4194],
    [37.8044, -122.2712],
    [37.8715, -122.2730],
    [38.0194, -122.1341],
    [38.1041, -122.2566],
    [38.2975, -122.2869],
    [38.4404, -122.7141],
  ];

  const initialState = {
    projectName: 'Coastal loop',
    shape: '16:9',
    activeStep: 'route',
    sceneIndex: 0,
    speed: 1,
    scenes: [
      {
        id: 'scene-1',
        name: 'Coastal loop',
        duration: 12,
        route: {
          points: defaultPoints,
          line: 'solid',
          lineColor: '#ff7045',
          lineWidth: 5,
          startDot: true,
          outline: true,
          glow: true,
          transport: 'car',
          symbol: 'car',
          symbolSize: 40,
          symbolColor: '#ff7045',
        },
        map: { style: 'paper', showLabels: true, followRoute: true, autoFit: true },
        signs: [
          { id: 'sign-1', pointIndex: 0, label: 'Start', note: 'Pacific side' },
          { id: 'sign-2', pointIndex: 4, label: 'Napa', note: 'Day 02' },
        ],
        overlays: { showTitle: true, showSubtitle: true, showBrand: false, title: 'Pacific coast', subtitle: 'A weekend in motion' },
        camera: { mode: 'follow', zoom: 1.1, easing: 'smooth' },
      },
      {
        id: 'scene-2',
        name: 'Golden hour',
        duration: 9,
        route: { ...makeRoute(defaultPoints.slice(2), '#f5bb63', 'dashed'), points: defaultPoints.slice(2) },
        map: { style: 'terrain', showLabels: true, followRoute: true, autoFit: true },
        signs: [{ id: 'sign-3', pointIndex: 1, label: 'Ridgeline', note: 'Golden hour' }],
        overlays: { showTitle: true, showSubtitle: false, showBrand: false, title: 'Golden hour', subtitle: '' },
        camera: { mode: 'follow', zoom: 1.2, easing: 'smooth' },
      },
    ],
  };

  function makeRoute(points, lineColor, line) {
    return {
      points,
      line,
      lineColor,
      lineWidth: 5,
      startDot: true,
      outline: true,
      glow: false,
      transport: 'car',
      symbol: 'car',
      symbolSize: 40,
      symbolColor: lineColor,
    };
  }

  const state = loadState();
  let map;
  let tileLayer;
  let routeLayer;
  let outlineLayer;
  let glowLayer;
  let pointLayers = [];
  let signLayers = [];
  let vehicleLayer;
  let mapMode = 'draw';
  let progress = 0;
  let playing = false;
  let playTimer = null;
  let animationFrame = null;
  let lastFrameTime = 0;
  let saveTimer = null;
  let cameraBaseZoom = null;
  let ffmpegPromise = null;
  let exportBusy = false;
  const exportTileCache = new Map();

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const currentScene = () => state.scenes[state.sceneIndex];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Array.isArray(saved.scenes) || !saved.scenes.length) return clone(initialState);
      return mergeState(clone(initialState), saved);
    } catch {
      return clone(initialState);
    }
  }

  function mergeState(base, saved) {
    const merged = { ...base, ...saved };
    merged.scenes = saved.scenes.map((scene, index) => {
      const fallback = base.scenes[index % base.scenes.length];
      return {
        ...clone(fallback),
        ...scene,
        route: { ...clone(fallback.route), ...(scene.route || {}) },
        map: { ...clone(fallback.map), ...(scene.map || {}) },
        overlays: { ...clone(fallback.overlays), ...(scene.overlays || {}) },
        camera: { ...clone(fallback.camera), ...(scene.camera || {}) },
        signs: Array.isArray(scene.signs) ? scene.signs : [],
      };
    });
    merged.sceneIndex = Math.min(Math.max(Number(merged.sceneIndex) || 0, 0), merged.scenes.length - 1);
    return merged;
  }

  function saveState(message = 'Saved locally') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, activeStep: undefined }));
    const status = $('#save-state');
    if (status) status.textContent = message;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (status) status.textContent = 'Saved locally'; }, 1700);
  }

  function formatTime(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(value / 60).toString().padStart(2, '0');
    const rest = (value % 60).toFixed(1).padStart(4, '0');
    return `${minutes}:${rest}`;
  }

  function distanceKm(points) {
    if (!points || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = L.latLng(points[i - 1]);
      const b = L.latLng(points[i]);
      total += a.distanceTo(b) / 1000;
    }
    return total;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function icon(name) {
    const paths = {
      upload: '<path d="M12 16V4m0 0 4 4m-4-4L8 8M5 15v3h14v-3"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      trash: '<path d="M5 7h14M10 11v5m4-5v5M9 7V4h6v3m-8 0 1 13h8l1-13"/>',
      map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/>',
      download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/>',
      fullscreen: '<path d="M8 3H3v5m13-5h5v5M8 21H3v-5m18 0v5h-5"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.map}</svg>`;
  }

  function initMap() {
    if (!window.L) {
      showToast('Leaflet could not load. The editor still works, but map controls are unavailable.', true);
      return;
    }
    map = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0.1 }).setView(defaultPoints[2], 9);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    tileLayer = L.tileLayer(TILE_STYLES.paper.url, { maxZoom: 18, attribution: TILE_STYLES.paper.attribution, crossOrigin: true }).addTo(map);
    map.on('click', onMapClick);
    map.on('zoomend moveend', updateMapMeta);
    setTimeout(() => {
      map.invalidateSize({ pan: false, animate: false });
      updateMap();
    }, 120);
    updateMap();
  }

  function onMapClick(event) {
    if (mapMode !== 'draw') return;
    const scene = currentScene();
    scene.route.points.push([Number(event.latlng.lat.toFixed(5)), Number(event.latlng.lng.toFixed(5))]);
    if (event.originalEvent?.shiftKey) {
      const pointIndex = scene.route.points.length - 1;
      scene.signs.push({ id: `sign-${Date.now()}`, pointIndex, label: `Stop ${scene.signs.length + 1}`, note: '' });
      showToast('Waypoint added');
    } else {
      showToast('Point added to the route');
    }
    progress = 1;
    saveState();
    renderSidebar();
    updateMap();
  }

  function updateMap(rebuild = true) {
    if (!map) return;
    const scene = currentScene();
    const points = scene.route.points || [];
    const style = TILE_STYLES[scene.map.style] || TILE_STYLES.paper;
    if (tileLayer && tileLayer._url !== style.url) {
      tileLayer.setUrl(style.url);
      tileLayer.options.attribution = style.attribution;
    }

    if (rebuild || !routeLayer && !vehicleLayer && !pointLayers.length) {
      clearMapLayers();
      const dashArray = scene.route.line === 'dashed' ? '12 10' : scene.route.line === 'dotted' ? '2 10' : undefined;
      if (points.length > 1 && scene.route.line !== 'none') {
        if (scene.route.glow) {
          glowLayer = L.polyline([], { color: scene.route.lineColor, weight: scene.route.lineWidth + 18, opacity: .3, lineCap: 'round', lineJoin: 'round', className: 'route-glow', interactive: false }).addTo(map);
        }
        if (scene.route.outline) {
          outlineLayer = L.polyline([], { color: '#ffffff', weight: scene.route.lineWidth + 4, opacity: .85, lineCap: 'round', lineJoin: 'round', dashArray, className: 'route-outline', interactive: false }).addTo(map);
        }
        routeLayer = L.polyline([], { color: scene.route.lineColor, weight: scene.route.lineWidth, opacity: 1, lineCap: 'round', lineJoin: 'round', dashArray, className: 'route-progress', interactive: false }).addTo(map);
      }

      pointLayers = points.map((point, index) => {
        const className = `route-point ${index === 0 ? 'is-start' : ''} ${index === points.length - 1 ? 'is-end' : ''}`;
        return L.marker(point, { icon: L.divIcon({ className: '', html: `<span class="${className}"></span>`, iconSize: [14, 14], iconAnchor: [7, 7] }), opacity: 0, interactive: false }).addTo(map);
      });

      signLayers = scene.signs.map((sign) => {
        const point = points[Number(sign.pointIndex)];
        if (!point) return null;
        return L.marker(point, { icon: L.divIcon({ className: '', html: `<span class="sign-marker">${escapeHtml(sign.label || 'Waypoint')}</span>`, iconSize: [120, 32], iconAnchor: [12, 31] }), opacity: 0, interactive: false }).addTo(map);
      }).filter(Boolean);

      const vehiclePoint = pointAtProgress(points, animationRatio(scene, progress), true);
      if (vehiclePoint && scene.route.symbol !== 'none') {
        vehicleLayer = L.marker(vehiclePoint, { icon: vehicleIcon(scene), interactive: false }).addTo(map);
      }
    }

    const reveal = animationRatio(scene, progress);
    const visible = getVisibleRoute(points, reveal, true);
    const routeLayers = [glowLayer, outlineLayer, routeLayer];
    routeLayers.forEach((layer) => layer?.setLatLngs(visible));
    points.forEach((point, index) => {
      const pointLayer = pointLayers[index];
      if (!pointLayer) return;
      const show = scene.route.startDot || index > 0 ? ratioForPoint(points, index, true) <= reveal + .002 : false;
      pointLayer.setOpacity(show ? 1 : 0);
    });
    scene.signs.forEach((sign, index) => {
      const signLayer = signLayers[index];
      const signRatio = ratioForPoint(points, Number(sign.pointIndex), true);
      signLayer?.setOpacity(signRatio <= reveal + .035 ? 1 : 0);
    });

    const vehiclePoint = pointAtProgress(points, reveal, true);
    if (vehicleLayer && vehiclePoint) {
      vehicleLayer.setLatLng(vehiclePoint);
      if (scene.camera.mode === 'follow' && scene.map.followRoute && playing) {
        followCamera(scene, vehiclePoint, pointAtProgress(points, Math.min(1, reveal + .1), true));
      }
    }
    updateMapMeta();
  }

  function clearMapLayers() {
    [routeLayer, outlineLayer, glowLayer, vehicleLayer, ...pointLayers, ...signLayers].forEach((layer) => {
      if (layer && map?.hasLayer(layer)) map.removeLayer(layer);
    });
    routeLayer = null;
    outlineLayer = null;
    glowLayer = null;
    vehicleLayer = null;
    pointLayers = [];
    signLayers = [];
  }

  function vehicleIcon(scene) {
    const size = Math.max(26, Number(scene.route.symbolSize) || 40);
    return L.divIcon({
      className: '',
      html: `<span class="vehicle-marker" style="--marker-size:${size}px;--marker-color:${scene.route.symbolColor || scene.route.lineColor}"><span class="vehicle-glyph">${vehicleGlyph(scene.route.symbol)}</span></span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function followCamera(scene, vehiclePoint, lookAheadPoint) {
    if (!vehiclePoint) return;
    const center = map.getCenter();
    const lead = lookAheadPoint || vehiclePoint;
    const target = L.latLng(vehiclePoint[0] * .78 + lead[0] * .22, vehiclePoint[1] * .78 + lead[1] * .22);
    const alpha = scene.camera.easing === 'snappy' ? .24 : scene.camera.easing === 'linear' ? .18 : .12;
    const next = L.latLng(center.lat + (target.lat - center.lat) * alpha, center.lng + (target.lng - center.lng) * alpha);
    const baseZoom = cameraBaseZoom ?? map.getZoom();
    const targetZoom = Math.max(2, Math.min(18, baseZoom + Math.log2(Number(scene.camera.zoom) || 1)));
    map.setView(next, targetZoom, { animate: false });
  }

  function vehicleGlyph(type) {
    return ({ car: '↗', train: '▰', plane: '✦', boat: '⌁', none: '·' }[type] || '↗');
  }

  function animationRatio(scene, value) {
    const ratio = Math.max(0, Math.min(1, Number(value) || 0));
    if (scene.camera.easing === 'linear') return ratio;
    if (scene.camera.easing === 'snappy') return 1 - Math.pow(1 - ratio, 3);
    return ratio < .5 ? 4 * ratio * ratio * ratio : 1 - Math.pow(-2 * ratio + 2, 3) / 2;
  }

  function segmentDistance(a, b, mapCoordinates = false) {
    if (mapCoordinates && window.L) return L.latLng(a).distanceTo(L.latLng(b));
    return Math.hypot((b[0] || 0) - (a[0] || 0), (b[1] || 0) - (a[1] || 0));
  }

  function ratioForPoint(points, index, mapCoordinates = false) {
    if (!points.length || index <= 0) return 0;
    const target = Math.min(points.length - 1, Math.max(0, Number(index) || 0));
    let total = 0;
    let distance = 0;
    for (let i = 1; i < points.length; i += 1) {
      const segment = segmentDistance(points[i - 1], points[i], mapCoordinates);
      total += segment;
      if (i <= target) distance += segment;
    }
    return total ? distance / total : 0;
  }

  function getVisibleRoute(points, ratio, mapCoordinates = false) {
    if (!points.length) return [];
    if (ratio >= .999) return points;
    if (ratio <= 0) return [points[0]];
    const distances = [0];
    for (let i = 1; i < points.length; i += 1) distances.push(distances[i - 1] + segmentDistance(points[i - 1], points[i], mapCoordinates));
    const total = distances[distances.length - 1];
    if (!total) return [points[0]];
    const target = total * ratio;
    let end = 1;
    while (end < distances.length && distances[end] < target) end += 1;
    const previousIndex = Math.max(0, end - 1);
    const next = points[end];
    const partial = points.slice(0, previousIndex + 1);
    if (next) {
      const span = distances[end] - distances[previousIndex] || 1;
      const t = (target - distances[previousIndex]) / span;
      const a = points[previousIndex];
      partial.push([a[0] + ((next[0] - a[0]) * t), a[1] + ((next[1] - a[1]) * t)]);
    }
    return partial;
  }

  function pointAtProgress(points, ratio, mapCoordinates = false) {
    const route = getVisibleRoute(points, ratio, mapCoordinates);
    return route[route.length - 1];
  }

  function updateMapMeta() {
    const scene = currentScene();
    const shape = state.shape;
    const [width, height] = SHAPE_SIZES[shape];
    $('#stage-shape').textContent = `${shape} · ${width} × ${height}`;
    $('#stage-scene').textContent = `Scene ${state.sceneIndex + 1}`;
    $('#overlay-scene-name').textContent = scene.name;
    const bottom = $('#map-overlay-bottom');
    bottom.textContent = scene.overlays.showTitle ? scene.overlays.title : '';
    bottom.style.display = scene.overlays.showTitle ? 'flex' : 'none';
    $('#overlay-scene-name').style.display = 'inline-flex';
    $('#overlay-brand').style.display = scene.overlays.showBrand ? 'inline-flex' : 'none';
    $('#route-lane-label').textContent = scene.overlays.showSubtitle && scene.overlays.subtitle ? scene.overlays.subtitle : 'Route draws';
    $('#time-current').textContent = formatTime(progress * scene.duration);
    $('#time-total').textContent = formatTime(scene.duration);
    $('#timeline-progress').style.width = `${progress * 100}%`;
    $('#timeline-scrubber').value = Math.round(progress * 1000);
    $('#speed-button').textContent = `${state.speed}×`;
  }

  function fitRoute() {
    const scene = currentScene();
    if (!map || !scene.route.points.length) return;
    map.fitBounds(L.latLngBounds(scene.route.points), { padding: [70, 70], maxZoom: 11, animate: false });
    cameraBaseZoom = map.getZoom();
    const zoomBias = Math.log2(Number(scene.camera.zoom) || 1);
    if (zoomBias) map.setZoom(Math.max(2, Math.min(18, cameraBaseZoom + zoomBias)), { animate: false });
    scene.map.autoFit = true;
    saveState();
  }

  function renderSceneTabs() {
    const tabs = $('#scene-tabs');
    tabs.innerHTML = state.scenes.map((scene, index) => `
      <button class="scene-tab ${index === state.sceneIndex ? 'is-active' : ''}" role="tab" aria-selected="${index === state.sceneIndex}" data-action="select-scene" data-index="${index}">
        <span class="scene-number">${index + 1}</span><strong>${escapeHtml(scene.name)}</strong><span class="scene-duration">${scene.duration.toFixed(1)} s</span><span class="scene-more">⋯</span>
      </button>
    `).join('');
  }

  function renderStepNav() {
    $$('#step-nav .step-button').forEach((button) => button.classList.toggle('is-active', button.dataset.step === state.activeStep));
  }

  function renderSidebar() {
    const scene = currentScene();
    const panel = $('#sidebar-panel');
    const step = state.activeStep;
    const headings = {
      route: ['Route', 'Draw a route or bring in a GPX track.'],
      map: ['Map', 'Choose the map mood and framing.'],
      signs: ['Signs', 'Drop labels along the route.'],
      overlays: ['Overlays', 'Add title cards and route context.'],
      camera: ['Camera', 'Decide how the map travels with the route.'],
      export: ['Preview & export', 'Play the scene and take it with you.'],
    };
    const [title, subtitle] = headings[step];
    panel.innerHTML = `<div class="panel-head"><div><span class="eyebrow">Scene ${state.sceneIndex + 1}</span><h2>${title}</h2><p>${subtitle}</p></div></div>${stepMarkup(step, scene)}`;
    bindSidebarEvents();
  }

  function stepMarkup(step, scene) {
    if (step === 'route') return routeMarkup(scene);
    if (step === 'map') return mapMarkup(scene);
    if (step === 'signs') return signsMarkup(scene);
    if (step === 'overlays') return overlaysMarkup(scene);
    if (step === 'camera') return cameraMarkup(scene);
    return exportMarkup(scene);
  }

  function routeMarkup(scene) {
    const route = scene.route;
    return `
      <div class="stat-grid"><div class="stat-card"><span>Points</span><strong>${route.points.length}</strong></div><div class="stat-card"><span>Distance</span><strong>${distanceKm(route.points).toFixed(0)}</strong> <small>km</small></div></div>
      <section class="control-section"><div class="section-title"><span>Input</span><strong>Build the route</strong></div><div class="button-row"><button class="button button-primary compact" data-action="import-gpx">${icon('upload')} Import GPX</button><button class="button button-quiet compact" data-action="clear-route">Clear route</button></div><p class="note">Or choose Draw above, then click anywhere on the map. Shift-click adds a sign.</p></section>
      <section class="control-section"><div class="section-title"><span>Line</span><strong>Route style</strong></div>
        <div class="segmented">${['solid','dashed','dotted','none'].map((type) => `<button class="segment-button ${route.line === type ? 'is-active' : ''}" data-action="set-route-line" data-value="${type}">${type === 'none' ? 'No line' : type[0].toUpperCase() + type.slice(1)}</button>`).join('')}</div>
        <div class="option-row"><span>Colour</span><div class="color-row">${COLORS.map((color) => `<button class="swatch ${route.lineColor === color ? 'is-active' : ''}" style="background:${color}" aria-label="Set route colour ${color}" data-action="set-route-color" data-value="${color}"></button>`).join('')}<label class="swatch swatch-custom" aria-label="Custom route colour"><input type="color" value="${route.lineColor}" data-input="route.lineColor" /></label></div></div>
        <div class="option-row"><span>Thickness</span><div class="range-wrap"><input type="range" min="2" max="12" value="${route.lineWidth}" data-input="route.lineWidth" /><span class="range-value">${route.lineWidth} px</span></div></div>
        <label class="check-row"><input type="checkbox" ${route.startDot ? 'checked' : ''} data-input="route.startDot" /> Dot at the start</label>
        <label class="check-row"><input type="checkbox" ${route.outline ? 'checked' : ''} data-input="route.outline" /> White outline</label>
        <label class="check-row"><input type="checkbox" ${route.glow ? 'checked' : ''} data-input="route.glow" /> Soft glow</label>
      </section>
      <section class="control-section"><div class="section-title"><span>Symbol</span><strong>Moving marker</strong></div><div class="radio-grid">${[['car','Car','↗'],['train','Train','▰'],['plane','Plane','✦'],['boat','Boat','⌁'],['none','None','·']].map(([value,label,glyph]) => `<div class="radio-card"><input type="radio" id="symbol-${value}" name="symbol" value="${value}" ${route.symbol === value ? 'checked' : ''} data-input="route.symbol" /><label for="symbol-${value}"><span>${glyph}</span>${label}</label></div>`).join('')}</div>
        <div class="option-row"><span>Size</span><div class="range-wrap"><input type="range" min="26" max="68" value="${route.symbolSize}" data-input="route.symbolSize" /><span class="range-value">${route.symbolSize} px</span></div></div>
      </section>
      <section class="control-section"><div class="section-title"><span>Tools</span><strong>Edit points</strong></div><div class="button-row"><button class="button button-quiet compact" data-action="show-route">${icon('map')} Fit route</button><button class="button button-quiet compact" data-action="undo-point">Undo last</button></div></section>`;
  }

  function mapMarkup(scene) {
    return `<section class="control-section"><div class="section-title"><span>Basemap</span><strong>Choose a surface</strong></div><div class="radio-grid">${Object.entries(TILE_STYLES).map(([key, value]) => `<div class="radio-card"><input type="radio" id="style-${key}" name="map-style" value="${key}" ${scene.map.style === key ? 'checked' : ''} data-input="map.style" /><label for="style-${key}"><span>${key === 'paper' ? '□' : key === 'terrain' ? '⌁' : '◐'}</span>${value.label}</label></div>`).join('')}</div></section>
      <section class="control-section"><div class="section-title"><span>Framing</span><strong>Map details</strong></div><label class="check-row"><input type="checkbox" ${scene.map.showLabels ? 'checked' : ''} data-input="map.showLabels" /> Show map labels</label><label class="check-row"><input type="checkbox" ${scene.map.followRoute ? 'checked' : ''} data-input="map.followRoute" /> Keep route centred</label><label class="check-row"><input type="checkbox" ${scene.map.autoFit ? 'checked' : ''} data-input="map.autoFit" /> Fit route on load</label><div class="button-row"><button class="button button-primary compact" data-action="fit-route">Fit current scene</button></div><p class="note">Tiles are served by the selected map provider and include attribution on the canvas.</p></section>
      <section class="control-section"><div class="section-title"><span>Scene</span><strong>Timing</strong></div><div class="option-row"><span>Duration</span><div class="range-wrap"><input type="range" min="4" max="40" step="0.5" value="${scene.duration}" data-input="duration" /><span class="range-value">${scene.duration.toFixed(1)} s</span></div></div></section>`;
  }

  function signsMarkup(scene) {
    const points = scene.route.points;
    const items = scene.signs.map((sign, index) => `<div class="sign-item"><div class="sign-item-header"><strong>Waypoint ${index + 1}</strong><button class="remove-button" data-action="remove-sign" data-index="${index}" aria-label="Remove waypoint">×</button></div><div class="inline-fields"><input class="text-control" value="${escapeHtml(sign.label)}" data-sign-input="label" data-index="${index}" maxlength="30" /><select class="select-control" data-sign-input="pointIndex" data-index="${index}">${points.map((_, pointIndex) => `<option value="${pointIndex}" ${Number(sign.pointIndex) === pointIndex ? 'selected' : ''}>Point ${pointIndex + 1}</option>`).join('')}</select></div><input class="text-control" style="margin-top:7px" value="${escapeHtml(sign.note || '')}" data-sign-input="note" data-index="${index}" maxlength="50" placeholder="Small note (optional)" /></div>`).join('');
    return `<section class="control-section"><div class="button-row"><button class="button button-primary compact" data-action="add-sign">${icon('plus')} Add waypoint</button><button class="button button-quiet compact" data-action="add-sign-at-current">Use marker position</button></div><p class="note">Waypoints appear as small editorial labels and stay attached to the route.</p></section><section class="control-section">${items || '<div class="empty-note">No signs yet. Add one to introduce a place, stop or chapter.</div>'}</section>`;
  }

  function overlaysMarkup(scene) {
    const overlays = scene.overlays;
    return `<section class="control-section"><div class="section-title"><span>Title card</span><strong>On the map</strong></div><label class="check-row"><input type="checkbox" ${overlays.showTitle ? 'checked' : ''} data-input="overlays.showTitle" /> Show scene title</label><input class="text-control" value="${escapeHtml(overlays.title)}" data-input="overlays.title" maxlength="50" placeholder="Scene title" /><label class="check-row"><input type="checkbox" ${overlays.showSubtitle ? 'checked' : ''} data-input="overlays.showSubtitle" /> Show route subtitle</label><input class="text-control" value="${escapeHtml(overlays.subtitle)}" data-input="overlays.subtitle" maxlength="70" placeholder="Subtitle" /><label class="check-row"><input type="checkbox" ${overlays.showBrand ? 'checked' : ''} data-input="overlays.showBrand" /> Show Route Atlas mark</label></section><section class="control-section"><div class="section-title"><span>Scene identity</span><strong>Rename</strong></div><input class="text-control" value="${escapeHtml(scene.name)}" data-input="name" maxlength="36" /><p class="note">The scene name appears in the top-left live preview pill and scene strip.</p></section>`;
  }

  function cameraMarkup(scene) {
    return `<section class="control-section"><div class="section-title"><span>Motion</span><strong>Camera mode</strong></div><div class="segmented" style="grid-template-columns:repeat(2,minmax(0,1fr))"><button class="segment-button ${scene.camera.mode === 'follow' ? 'is-active' : ''}" data-action="set-camera-mode" data-value="follow">Follow route</button><button class="segment-button ${scene.camera.mode === 'fixed' ? 'is-active' : ''}" data-action="set-camera-mode" data-value="fixed">Fixed frame</button></div><label class="check-row"><input type="checkbox" ${scene.map.followRoute ? 'checked' : ''} data-input="map.followRoute" /> Pan with moving marker</label></section><section class="control-section"><div class="section-title"><span>Scale</span><strong>Camera zoom</strong></div><div class="option-row"><span>Zoom bias</span><div class="range-wrap"><input type="range" min="0.8" max="1.6" step="0.1" value="${scene.camera.zoom}" data-input="camera.zoom" /><span class="range-value">${scene.camera.zoom.toFixed(1)}×</span></div></div></section><section class="control-section"><div class="section-title"><span>Easing</span><strong>Movement feel</strong></div><div class="segmented" style="grid-template-columns:repeat(3,minmax(0,1fr))">${['smooth','linear','snappy'].map((value) => `<button class="segment-button ${scene.camera.easing === value ? 'is-active' : ''}" data-action="set-camera-easing" data-value="${value}">${value[0].toUpperCase() + value.slice(1)}</button>`).join('')}</div><p class="note">Follow mode keeps the moving symbol readable while the route draws.</p></section>`;
  }

  function exportMarkup(scene) {
    return `<section class="control-section"><div class="stat-grid"><div class="stat-card"><span>Scene duration</span><strong>${scene.duration.toFixed(1)}</strong> <small>s</small></div><div class="stat-card"><span>Output shape</span><strong>${state.shape}</strong></div></div><div class="button-row"><button class="button button-primary compact" data-action="export-mp4">Export MP4</button><button class="button button-quiet compact" data-action="export-webm">Export WebM</button><button class="button button-quiet compact" data-action="download-json">Download JSON</button></div><p class="export-status" id="export-status" role="status" aria-live="polite">MP4 encoding runs locally in your browser and may take a few minutes.</p><p class="note">The preview uses a deterministic map renderer, smooth route travel and a moving camera. MP4 conversion loads FFmpeg WebAssembly only when requested.</p></section><section class="control-section"><div class="section-title"><span>Project</span><strong>Local-first</strong></div><button class="button button-quiet compact" data-action="copy-project">Copy project JSON</button><p class="note">All edits are stored in this browser. Download the JSON to move the project between devices.</p></section>`;
  }

  function bindSidebarEvents() {
    $('#sidebar-panel').querySelectorAll('[data-input]').forEach((element) => {
      element.addEventListener('input', () => handleInput(element));
      element.addEventListener('change', () => handleInput(element));
    });
    $('#sidebar-panel').querySelectorAll('[data-sign-input]').forEach((element) => {
      element.addEventListener('input', () => handleSignInput(element));
      element.addEventListener('change', () => handleSignInput(element));
    });
  }

  function setPath(object, path, value) {
    const parts = path.split('.');
    const last = parts.pop();
    const target = parts.reduce((cursor, key) => cursor[key], object);
    target[last] = value;
  }

  function readInputValue(element) {
    if (element.type === 'checkbox') return element.checked;
    if (element.type === 'range' || element.type === 'number') return Number(element.value);
    return element.value;
  }

  function handleInput(element) {
    const scene = currentScene();
    const path = element.dataset.input;
    setPath(path === 'projectName' ? state : path.startsWith('duration') || path === 'name' ? scene : scene, path.replace(/^duration$/, 'duration').replace(/^name$/, 'name'), readInputValue(element));
    if (path === 'route.symbolColor') scene.route.symbolColor = scene.route.lineColor;
    saveState();
    if (path === 'duration' || path === 'name' || path.startsWith('overlays') || path.startsWith('camera') || path.startsWith('route') || path.startsWith('map')) {
      if (path === 'name' || path === 'duration') renderSceneTabs();
      updateMap();
      updateMapMeta();
    }
    const valueLabel = element.parentElement?.querySelector('.range-value');
    if (valueLabel && (element.type === 'range')) valueLabel.textContent = `${element.value}${path.includes('zoom') ? '×' : path.includes('duration') ? ' s' : ' px'}`;
  }

  function handleSignInput(element) {
    const sign = currentScene().signs[Number(element.dataset.index)];
    if (!sign) return;
    sign[element.dataset.signInput] = element.dataset.signInput === 'pointIndex' ? Number(element.value) : element.value;
    saveState();
    updateMap();
  }

  function addScene() {
    const next = clone(currentScene());
    next.id = `scene-${Date.now()}`;
    next.name = `Scene ${state.scenes.length + 1}`;
    next.signs = [];
    state.scenes.push(next);
    state.sceneIndex = state.scenes.length - 1;
    progress = 0;
    renderAll();
    saveState();
    showToast('New scene added');
  }

  function selectScene(index) {
    state.sceneIndex = Number(index);
    progress = 0;
    renderAll();
    if (currentScene().map.autoFit) fitRoute();
  }

  function addSign(pointIndex = null) {
    const scene = currentScene();
    const index = pointIndex == null ? Math.max(0, Math.floor(scene.route.points.length / 2)) : pointIndex;
    scene.signs.push({ id: `sign-${Date.now()}`, pointIndex: index, label: `Stop ${scene.signs.length + 1}`, note: '' });
    saveState();
    renderSidebar();
    updateMap();
  }

  function removeSign(index) {
    currentScene().signs.splice(Number(index), 1);
    saveState();
    renderSidebar();
    updateMap();
  }

  function importGpx(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const xml = new DOMParser().parseFromString(reader.result, 'application/xml');
      const points = [...xml.querySelectorAll('trkpt, rtept')].map((node) => [Number(node.getAttribute('lat')), Number(node.getAttribute('lon'))]).filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
      if (points.length < 2) { showToast('That GPX file did not contain enough route points.', true); return; }
      currentScene().route.points = simplifyPoints(points, 220);
      progress = 1;
      saveState();
      renderSidebar();
      updateMap();
      fitRoute();
      showToast(`Imported ${currentScene().route.points.length} route points`);
    };
    reader.readAsText(file);
  }

  function simplifyPoints(points, maxPoints) {
    if (points.length <= maxPoints) return points;
    const step = (points.length - 1) / (maxPoints - 1);
    return Array.from({ length: maxPoints }, (_, index) => points[Math.round(index * step)]);
  }

  function togglePlay() {
    if (playing) stopPlay(); else startPlay();
  }

  function startPlay() {
    if (!currentScene().route.points.length) { showToast('Add at least two route points first.', true); return; }
    if (progress >= 1) progress = 0;
    playing = true;
    $('#play-icon').textContent = 'Ⅱ';
    lastFrameTime = performance.now();
    cancelAnimationFrame(animationFrame);
    const tick = (now) => {
      if (!playing) return;
      const delta = Math.min(.08, Math.max(0, (now - lastFrameTime) / 1000));
      lastFrameTime = now;
      progress = Math.min(1, progress + delta * state.speed / currentScene().duration);
      updateMap(false);
      if (progress >= 1) stopPlay();
      else animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
  }

  function stopPlay() {
    playing = false;
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
    playTimer = null;
    $('#play-icon').textContent = '▶';
    updateMapMeta();
  }

  function exportProject() {
    const blob = new Blob([JSON.stringify({ ...state, activeStep: undefined }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${slugify(state.projectName)}.route-atlas.json`);
    showToast('Project JSON downloaded');
  }

  function copyProject() {
    navigator.clipboard?.writeText(JSON.stringify(state, null, 2)).then(() => showToast('Project JSON copied')).catch(() => showToast('Clipboard access was not available.', true));
  }

  function slugify(value) { return String(value || 'route-atlas').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'route-atlas'; }
  function downloadBlob(blob, name) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 2000); }

  function mercatorPoint(lat, lng, zoom) {
    const size = 256 * (2 ** zoom);
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat) || 0));
    const sin = Math.sin((clampedLat * Math.PI) / 180);
    return [
      ((Number(lng) + 180) / 360) * size,
      (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
    ];
  }

  function tileUrl(style, x, y, z) {
    const subdomains = ['a', 'b', 'c'];
    const host = subdomains[Math.abs(x + y) % subdomains.length];
    return style.url.replace('{s}', host).replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{r}', '');
  }

  function loadExportTile(url) {
    if (exportTileCache.has(url)) return exportTileCache.get(url);
    const promise = new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => finish(null), 6000);
      image.onload = () => finish(image);
      image.onerror = () => finish(null);
      image.src = url;
    });
    exportTileCache.set(url, promise);
    promise.then((image) => {
      if (image) exportTileCache.set(url, image);
      else exportTileCache.delete(url);
    });
    return promise;
  }

  function exportZoom(scene, width, height) {
    const points = scene.route.points || [];
    if (!points.length) return 4;
    const world = points.map(([lat, lng]) => mercatorPoint(lat, lng, 0));
    const spanX = Math.max(.02, Math.max(...world.map(([x]) => x)) - Math.min(...world.map(([x]) => x)));
    const spanY = Math.max(.02, Math.max(...world.map(([, y]) => y)) - Math.min(...world.map(([, y]) => y)));
    const fit = Math.log2(Math.min((width - 180) / spanX, (height - 180) / spanY));
    const bias = scene.camera.mode === 'follow' ? Math.log2(Number(scene.camera.zoom) || 1) : 0;
    return Math.max(2, Math.min(12, Math.floor(fit + bias)));
  }

  async function prepareExportTiles(scene, width, height) {
    const style = TILE_STYLES[scene.map.style] || TILE_STYLES.paper;
    const zoom = exportZoom(scene, width, height);
    const points = scene.route.points || [];
    const worldSize = 256 * (2 ** zoom);
    const routeWorld = points.map(([lat, lng]) => mercatorPoint(lat, lng, zoom));
    const tileRadiusX = Math.ceil(width / 256 / 2) + 2;
    const tileRadiusY = Math.ceil(height / 256 / 2) + 2;
    if (!routeWorld.length) return { style, zoom, worldSize, routeWorld, tileRadiusX, tileRadiusY };
    const urls = new Set();
    const tileXs = routeWorld.map(([x]) => Math.floor(x / 256));
    const tileYs = routeWorld.map(([, y]) => Math.floor(y / 256));
    const minTileX = Math.min(...tileXs) - tileRadiusX;
    const maxTileX = Math.max(...tileXs) + tileRadiusX;
    const minTileY = Math.max(0, Math.min(...tileYs) - tileRadiusY);
    const maxTileY = Math.min((2 ** zoom) - 1, Math.max(...tileYs) + tileRadiusY);
    for (let y = minTileY; y <= maxTileY; y += 1) {
      for (let rawX = minTileX; rawX <= maxTileX; rawX += 1) {
        const x = ((rawX % (2 ** zoom)) + (2 ** zoom)) % (2 ** zoom);
        urls.add(tileUrl(style, x, y, zoom));
      }
    }
    // The canvas renderer is independent from Leaflet's DOM layers. It must
    // wait for the tile images before recording starts; otherwise every frame
    // can contain only the fallback gradient while the vector route still
    // renders on top of it.
    await Promise.all([...urls].map(loadExportTile));
    return { style, zoom, worldSize, routeWorld, tileRadiusX, tileRadiusY };
  }

  function drawExportTiles(context, tileState, center, width, height) {
    const { style, zoom, worldSize } = tileState;
    const scale = 1;
    const centerX = center[0];
    const centerY = center[1];
    const tileX = Math.floor(centerX / 256);
    const tileY = Math.floor(centerY / 256);
    const radiusX = Math.ceil(width / 256 / 2) + 2;
    const radiusY = Math.ceil(height / 256 / 2) + 2;
    for (let offsetY = -radiusY; offsetY <= radiusY; offsetY += 1) {
      const y = tileY + offsetY;
      if (y < 0 || y >= 2 ** zoom) continue;
      for (let offsetX = -radiusX; offsetX <= radiusX; offsetX += 1) {
        const x = ((tileX + offsetX) % (2 ** zoom) + (2 ** zoom)) % (2 ** zoom);
        const image = exportTileCache.get(tileUrl(style, x, y, zoom));
        if (!image || image instanceof Promise || image.width === 0) continue;
        const rawX = x * 256;
        let dx = width / 2 + (rawX - centerX) * scale;
        const dy = height / 2 + (y * 256 - centerY) * scale;
        if (rawX - centerX > worldSize / 2) dx -= worldSize;
        if (rawX - centerX < -worldSize / 2) dx += worldSize;
        context.drawImage(image, dx, dy, 256 * scale, 256 * scale);
      }
    }
  }

  function renderExportFrame(canvas, context, scene, ratio, tileState = null) {
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, scene.map.style === 'night' ? '#1a2129' : scene.map.style === 'terrain' ? '#c8d4ca' : '#e5e1c9');
    background.addColorStop(1, scene.map.style === 'night' ? '#0e1218' : scene.map.style === 'terrain' ? '#a8bba9' : '#f1e8c5');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    let path;
    const eased = animationRatio(scene, ratio);
    if (tileState) {
      const currentPoint = pointAtProgress(tileState.routeWorld, eased);
      const routeCenter = tileState.routeWorld[Math.floor(tileState.routeWorld.length / 2)] || [tileState.worldSize / 2, tileState.worldSize / 2];
      const cameraCenter = scene.camera.mode === 'follow' && currentPoint ? currentPoint : routeCenter;
      drawExportTiles(context, tileState, cameraCenter, width, height);
      const scale = 1;
      const routePath = tileState.routeWorld;
      path = routePath.map(([x, y]) => [width / 2 + (x - cameraCenter[0]) * scale, height / 2 + (y - cameraCenter[1]) * scale]);
    } else {
      path = projectPoints(scene.route.points, width, height, Math.max(80, Math.round(Math.min(width, height) * .09)));
    }
    const visible = getVisibleRoute(path, eased);
    if (visible.length > 1 && scene.route.line !== 'none') {
      context.lineCap = 'round'; context.lineJoin = 'round';
      if (scene.route.glow) {
        drawCanvasPath(context, visible, scene.route.lineColor, scene.route.lineWidth + 28, scene.route.line, .08, true);
        drawCanvasPath(context, visible, scene.route.lineColor, scene.route.lineWidth + 12, scene.route.line, .18, true);
      }
      if (scene.route.outline) { drawCanvasPath(context, visible, '#ffffff', scene.route.lineWidth + 7, scene.route.line); }
      drawCanvasPath(context, visible, scene.route.lineColor, scene.route.lineWidth, scene.route.line);
    }
    const visibleRatio = eased;
    path.forEach((point, index) => { if (ratioForPoint(path, index) <= visibleRatio + .002) drawCanvasDot(context, point, index === 0 ? '#4fc59b' : index === path.length - 1 ? '#192329' : scene.route.lineColor, index === 0 || index === path.length - 1 ? 8 : 5); });
    const vehicle = pointAtProgress(path, eased);
    if (vehicle && scene.route.symbol !== 'none') { drawCanvasVehicle(context, vehicle, scene.route.symbol, scene.route.symbolColor || scene.route.lineColor, scene.route.symbolSize); }
    scene.signs.forEach((sign) => { const point = path[Number(sign.pointIndex)]; if (point && ratioForPoint(path, Number(sign.pointIndex)) <= visibleRatio + .035) drawCanvasSign(context, point, sign.label); });
    if (scene.overlays.showTitle || (scene.overlays.showSubtitle && scene.overlays.subtitle)) {
      const cardWidth = Math.min(560, width * .48);
      const cardHeight = scene.overlays.showSubtitle && scene.overlays.subtitle ? 128 : 84;
      context.fillStyle = 'rgba(249, 245, 229, .9)'; context.fillRect(42, 42, cardWidth, cardHeight);
      context.fillStyle = '#27342f'; context.font = `700 ${Math.max(24, Math.round(width / 44))}px Inter, sans-serif`;
      if (scene.overlays.showTitle) context.fillText(scene.overlays.title || scene.name, 64, 82);
      if (scene.overlays.showSubtitle && scene.overlays.subtitle) { context.fillStyle = '#53615b'; context.font = `500 ${Math.max(15, Math.round(width / 72))}px Inter, sans-serif`; context.fillText(scene.overlays.subtitle, 64, 115); }
    }
    if (scene.overlays.showBrand) {
      context.fillStyle = '#27342f'; context.font = `700 ${Math.max(13, Math.round(width / 90))}px Inter, sans-serif`; context.fillText('ROUTE ATLAS', width - 180, height - 46);
    }
  }

  function projectPoints(points, width, height, padding) {
    if (!points.length) return [];
    const lats = points.map((point) => point[0]); const lngs = points.map((point) => point[1]);
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats); const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
    const latSpan = maxLat - minLat || .01; const lngSpan = maxLng - minLng || .01;
    const scale = Math.min((width - padding * 2) / lngSpan, (height - padding * 2) / latSpan);
    const xOffset = (width - lngSpan * scale) / 2; const yOffset = (height - latSpan * scale) / 2;
    return points.map(([lat, lng]) => [xOffset + (lng - minLng) * scale, height - (yOffset + (lat - minLat) * scale)]);
  }

  function drawCanvasPath(context, points, color, width, lineType, opacity = 1, blur = false) {
    if (points.length < 2) return;
    context.save(); context.globalAlpha = opacity; context.strokeStyle = color; context.lineWidth = width;
    if (blur) context.filter = `blur(${Math.max(4, Math.round(width / 4))}px)`;
    context.setLineDash(lineType === 'dashed' ? [22, 16] : lineType === 'dotted' ? [2, 14] : []);
    context.beginPath(); context.moveTo(points[0][0], points[0][1]); points.slice(1).forEach((point) => context.lineTo(point[0], point[1])); context.stroke(); context.restore();
  }
  function drawCanvasDot(context, point, color, radius) { context.beginPath(); context.fillStyle = color; context.arc(point[0], point[1], radius, 0, Math.PI * 2); context.fill(); context.strokeStyle = '#fff'; context.lineWidth = 3; context.stroke(); }
  function drawCanvasVehicle(context, point, symbol, color, symbolSize = 40) { const radius = Math.max(13, Number(symbolSize) / 2); context.save(); context.shadowColor = color; context.shadowBlur = radius * .75; context.beginPath(); context.fillStyle = color; context.arc(point[0], point[1], radius, 0, Math.PI * 2); context.fill(); context.shadowBlur = 0; context.strokeStyle = '#fff'; context.lineWidth = Math.max(3, radius / 5); context.stroke(); context.fillStyle = '#1c1814'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = `900 ${Math.max(14, Math.round(radius))}px sans-serif`; context.fillText(vehicleGlyph(symbol), point[0], point[1] + 1); context.restore(); }
  function drawCanvasSign(context, point, label) { context.save(); context.font = '700 16px Inter, sans-serif'; const width = context.measureText(label).width + 22; context.fillStyle = '#f4f0db'; context.strokeStyle = '#27342f'; context.lineWidth = 2; context.beginPath(); context.roundRect(point[0] + 10, point[1] - 43, width, 30, 7); context.fill(); context.stroke(); context.fillStyle = '#27342f'; context.fillText(label, point[0] + 21, point[1] - 22); context.restore(); }

  function setExportStatus(message, error = false) {
    const status = $('#export-status');
    if (status) {
      status.textContent = message;
      status.classList.toggle('is-error', error);
    }
  }

  async function renderWebmBlob(scene, onProgress = () => {}) {
    const [width, height] = SHAPE_SIZES[state.shape];
    const scale = Math.min(1, 1280 / width, 720 / height);
    const canvas = document.createElement('canvas'); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!canvas.captureStream || !window.MediaRecorder) throw new Error('WebM recording is not supported in this browser.');
    setExportStatus('Preparing map tiles…');
    const tileState = await prepareExportTiles(scene, canvas.width, canvas.height);
    const stream = canvas.captureStream(30); const chunks = [];
    const recorder = createWebmRecorder(stream);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    const started = performance.now();
    await new Promise((resolve) => {
      const tick = (now) => { const ratio = Math.min(1, (now - started) / 1000 / scene.duration); renderExportFrame(canvas, context, scene, ratio, tileState); onProgress(ratio); if (ratio < 1) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    });
    recorder.stop(); await done;
    return new Blob(chunks, { type: 'video/webm' });
  }

  function createWebmRecorder(stream) {
    const candidates = ['video/webm;codecs=vp8', 'video/webm', 'video/webm;codecs=vp9'];
    const supported = typeof MediaRecorder.isTypeSupported === 'function'
      ? candidates.filter((type) => MediaRecorder.isTypeSupported(type))
      : candidates;
    let lastError;
    for (const mimeType of supported) {
      try {
        return new MediaRecorder(stream, { mimeType });
      } catch (error) {
        lastError = error;
      }
    }
    try {
      return new MediaRecorder(stream);
    } catch (error) {
      throw lastError || error;
    }
  }

  async function exportWebm() {
    if (exportBusy) return;
    exportBusy = true;
    const scene = currentScene();
    try {
      setExportStatus('Rendering WebM locally…');
      const blob = await renderWebmBlob(scene, (ratio) => setExportStatus(`Rendering WebM locally… ${Math.round(ratio * 100)}%`));
      downloadBlob(blob, `${slugify(scene.name)}.webm`);
      setExportStatus('WebM exported.');
      showToast('WebM preview exported');
    } catch (error) {
      setExportStatus(error.message || 'WebM export failed.', true);
      showToast(error.message || 'WebM export failed.', true);
    } finally {
      exportBusy = false;
    }
  }

  async function getFfmpeg() {
    if (ffmpegPromise) return ffmpegPromise;
    ffmpegPromise = (async () => {
      setExportStatus('Loading MP4 encoder (about 31 MB)…');
      const [{ FFmpeg }, { fetchFile }] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js'),
        import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js'),
      ]);
      const ffmpeg = new FFmpeg();
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
      await ffmpeg.load({
        classWorkerURL: new URL('./ffmpeg-worker.js', document.baseURI).href,
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });
      return { ffmpeg, fetchFile };
    })();
    try {
      return await ffmpegPromise;
    } catch (error) {
      ffmpegPromise = null;
      throw error;
    }
  }

  async function exportMp4() {
    if (exportBusy) return;
    exportBusy = true;
    const scene = currentScene();
    try {
      const webm = await renderWebmBlob(scene, (ratio) => setExportStatus(`Rendering animation… ${Math.round(ratio * 55)}%`));
      const { ffmpeg, fetchFile } = await getFfmpeg();
      setExportStatus('Encoding MP4…');
      ffmpeg.on('progress', ({ progress }) => setExportStatus(`Encoding MP4… ${Math.min(100, Math.round(55 + progress * 45))}%`));
      await ffmpeg.writeFile('route-atlas-input.webm', await fetchFile(webm));
      await ffmpeg.exec([
        '-i', 'route-atlas-input.webm',
        '-an',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        'route-atlas-output.mp4',
      ]);
      const data = await ffmpeg.readFile('route-atlas-output.mp4');
      downloadBlob(new Blob([data.buffer], { type: 'video/mp4' }), `${slugify(scene.name)}.mp4`);
      setExportStatus('MP4 exported.');
      showToast('MP4 exported');
    } catch (error) {
      console.error('MP4 export failed', error);
      setExportStatus(error.message || 'MP4 export failed. Try WebM in a browser without MP4 support.', true);
      showToast(error.message || 'MP4 export failed.', true);
    } finally {
      exportBusy = false;
    }
  }

  function showToast(message, error = false) {
    const region = $('#toast-region'); const toast = document.createElement('div'); toast.className = `toast ${error ? 'is-error' : ''}`; toast.textContent = message; region.appendChild(toast); setTimeout(() => toast.remove(), 3200);
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      location.replace('/login');
    }
  }

  function renderAll() {
    $('#project-name').value = state.projectName;
    $('#video-shape').value = state.shape;
    renderSceneTabs(); renderStepNav(); renderSidebar(); updateMap(); updateMapMeta();
  }

  function handleAction(action, element) {
    const scene = currentScene();
    switch (action) {
      case 'select-scene': selectScene(element.dataset.index); break;
      case 'add-scene': addScene(); break;
      case 'toggle-play': togglePlay(); break;
      case 'toggle-speed': state.speed = state.speed === 1 ? 1.5 : state.speed === 1.5 ? .5 : 1; updateMapMeta(); saveState(); break;
      case 'fit-route': fitRoute(); break;
      case 'show-route': progress = 1; updateMap(); fitRoute(); break;
      case 'undo-point': if (scene.route.points.length > 2) { scene.route.points.pop(); progress = 1; saveState(); renderSidebar(); updateMap(); } break;
      case 'clear-route': scene.route.points = []; scene.signs = []; progress = 0; saveState(); renderSidebar(); updateMap(); showToast('Route cleared'); break;
      case 'import-gpx': $('#gpx-input').click(); break;
      case 'add-sign': addSign(); break;
      case 'add-sign-at-current': addSign(Math.max(0, Math.min(scene.route.points.length - 1, Math.round(progress * (scene.route.points.length - 1))))); break;
      case 'remove-sign': removeSign(element.dataset.index); break;
      case 'set-route-line': scene.route.line = element.dataset.value; saveState(); renderSidebar(); updateMap(); break;
      case 'set-route-color': scene.route.lineColor = element.dataset.value; scene.route.symbolColor = element.dataset.value; saveState(); renderSidebar(); updateMap(); break;
      case 'set-camera-mode': scene.camera.mode = element.dataset.value; saveState(); renderSidebar(); updateMap(); break;
      case 'set-camera-easing': scene.camera.easing = element.dataset.value; saveState(); renderSidebar(); break;
      case 'download-json': exportProject(); break;
      case 'copy-project': copyProject(); break;
      case 'export-webm': stopPlay(); void exportWebm(); break;
      case 'export-mp4': stopPlay(); void exportMp4(); break;
      case 'keyboard-help': $('#help-modal').showModal(); break;
      case 'close-help': $('#help-modal').close(); break;
      case 'logout': void logout(); break;
      case 'reset-project': localStorage.removeItem(STORAGE_KEY); location.reload(); break;
      case 'toggle-fullscreen': $('#map-frame').classList.toggle('is-fullscreen'); setTimeout(() => map?.invalidateSize(), 150); break;
      case 'back-projects': element.href = '#projects'; showToast('This static build keeps projects in the current browser.'); break;
      default: break;
    }
  }

  function bindGlobalEvents() {
    document.addEventListener('click', (event) => {
      const actionElement = event.target.closest('[data-action]');
      if (actionElement) { event.preventDefault(); handleAction(actionElement.dataset.action, actionElement); return; }
      const stepButton = event.target.closest('[data-step]');
      if (stepButton) { state.activeStep = stepButton.dataset.step; renderStepNav(); renderSidebar(); }
      const modeButton = event.target.closest('[data-map-mode]');
      if (modeButton) { mapMode = modeButton.dataset.mapMode; $$('.tool-button[data-map-mode]').forEach((button) => button.classList.toggle('is-active', button === modeButton)); if (map) map.dragging[mapMode === 'draw' ? 'disable' : 'enable'](); }
    });
    $('#project-name').addEventListener('input', (event) => { state.projectName = event.target.value; saveState(); });
    $('#video-shape').addEventListener('change', (event) => { state.shape = event.target.value; updateMapMeta(); saveState(); });
    $('#timeline-scrubber').addEventListener('input', (event) => { progress = Number(event.target.value) / 1000; updateMap(); });
    $('#gpx-input').addEventListener('change', (event) => { const [file] = event.target.files; if (file) importGpx(file); event.target.value = ''; });
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); exportProject(); }
      if (event.key === ' ') { const tag = document.activeElement?.tagName; if (!['INPUT','TEXTAREA','SELECT'].includes(tag)) { event.preventDefault(); togglePlay(); } }
      if (event.key === 'Escape') { if ($('#help-modal').open) $('#help-modal').close(); $('#map-frame').classList.remove('is-fullscreen'); }
      if (event.key >= '1' && event.key <= '6') { state.activeStep = ['route','map','signs','overlays','camera','export'][Number(event.key) - 1]; renderStepNav(); renderSidebar(); }
      if (event.key.toLowerCase() === 'd') { mapMode = 'draw'; $$('.tool-button[data-map-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.mapMode === mapMode)); }
      if (event.key.toLowerCase() === 'f') fitRoute();
    });
  }

  bindGlobalEvents();
  renderAll();
  initMap();
  window.addEventListener('resize', () => map?.invalidateSize({ pan: false, animate: false }));
  if (currentScene().map.autoFit) setTimeout(() => { map?.invalidateSize({ pan: false, animate: false }); fitRoute(); }, 450);
})();
