const STORAGE_KEY = 'selogerEnhancerEnabled';
const BACKEND_URL = 'http://127.0.0.1:5000/features';
const FALSE_EMOJI = '❌';
const DPE_COLORS = {
  A: '#4CAF50',    // Green
  B: '#8BC34A',    // Light Green
  C: '#CDDC39',    // Pistache
  D: '#FFEB3B',    // Yellow
  E: '#FFB74D',    // Clear Orange
  F: '#FF9800',    // Orange
  G: '#F44336'     // Red
};
const DEFAULT_FEATURES = [
  { emoji: '🛗', label: 'Elevator', enabled: true },
  { emoji: '🔥', label: 'Chauffage collectif', enabled: true }
];
const SCAN_INTERVAL_MS = 1000;
const MAX_SCAN_ATTEMPTS = 15;
const MAX_CONCURRENT = 3;
// script,sections,facts,hardFacts, check by type (numberOfRooms + price)
// priceComparison
const FILTER_STORAGE_KEY = 'selogerFilters';
const SAVED_FILTERS_KEY = 'selogerSavedFilterPresets';
let enabled = window.localStorage.getItem(STORAGE_KEY) !== 'false';
let badgesData = DEFAULT_FEATURES;
let scanTimer = null;
let scanAttempts = 0;
let activeRequests = 0;
const queue = [];
const listingFeaturesCache = new Map();
let activeFilters = loadFilters();
let filtersDirty = true;
function markFiltersChanged() {
  filtersDirty = true;
  saveFilters();
}
const FEATURES_CONFIG = {
  propertyType: {
    label: 'PropertyType',
    emoji: '🏠',
    isSpecial: 'propertyType'
  },
  elevator: {
    positive: ['ascenseur'],
    negative: ['pas d ascenseur', 'sans ascenseur'],
    emojiTrue: '🛗',
    label: 'Elevator',
    isSpecial: false
  },
  parking: {
    positive: ['parking', 'box de stationnement'],
    negative: ['pas de parking', 'sans parking'],
    emojiTrue: '🅿️',
    label: 'Parking',
    isSpecial: false
  },
  cave: {
    positive: ['cave'],
    negative: ['pas de cave', 'sans cave'],
    emojiTrue: '🕳️',
    label: 'Cave',
    isSpecial: false
  },
  garden: {
    positive: ['jardin'],
    negative: ['pas de jardin', 'sans jardin'],
    emojiTrue: '🌳',
    label: 'Garden',
    isSpecial: false
  },
  terrasse: {
    positive: ['terasse', 'terrasse', 'balcon'],
    negative: ['pas de', 'sans'],
    emojiTrue: '☀️',
    label: 'Terasse',
    isSpecial: true
  },
  etage: {
    positive: ['etage'],
    negative: [],
    emojiTrue: '📍',
    label: 'Etage',
    isSpecial: 'extractor'
  },
  chauffage: {
    label: 'Chauffage',
    emoji: '🔥',
    isSpecial: 'energy',
    energyLabel: 'Type de chauffage'
  },
  etat: {
    label: 'État',
    emoji: '🏠',
    isSpecial: 'energy',
    energyLabel: 'État'
  },
  anneeConstruction: {
    label: 'Year',
    emoji: '📅',
    isSpecial: 'energy',
    energyLabel: 'Année de construction'
  },
  sourceEnergie: {
    label: 'Energy',
    emoji: '⚡',
    isSpecial: 'energy',
    energyLabel: 'Sources d\'énergie'
  },
  nombreDeLots: {
    label: 'Lots',
    emoji: '🏘️',
    isSpecial: 'co-ownership',
    coOwnershipLabel: 'Nombre de lots'
  },
  chargesCopropriete: {
    label: 'Charges',
    emoji: '💰',
    isSpecial: 'co-ownership',
    coOwnershipLabel: 'Charges de copropriété'
  },
  dpe: {
    label: 'DPE',
    emoji: '⚡',
    isSpecial: 'dpe'
  },
  quartier: {
    label: 'Quartier',
    emoji: '🏘️',
    isSpecial: 'quartier'
  },
  exactAddress: {
    label: 'exactAddress',
    emoji: '📍',
    isSpecial: 'exactAddress'
  },
};

function loadSavedFilters() {
  return JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY) || '{}');
}

function saveSavedFilters(presets) {
  localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(presets));
}
function saveCurrentFilterPreset(name) {
  const presets = loadSavedFilters();

  presets[name] = structuredClone(activeFilters);

  saveSavedFilters(presets);
}
function applyFilterPreset(name) {
  const presets = loadSavedFilters();

  if (!presets[name]) return;

  activeFilters = structuredClone(presets[name]);

  saveFilters();
  filtersDirty = true;
}
function normalizeValue(v) {
  if (v === undefined || v === null || v === '') return 'N/A';
  return v;
}
function saveFilters() {
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(activeFilters));
}
function loadFilters() {
  return JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || '{}');
}
function buildResolvedFeatures(featureData) {
  const resolved = {};

  Object.entries(FEATURES_CONFIG).forEach(([key, config]) => {
    if (config.isSpecial === 'energy') {
      resolved[key] = normalizeValue(featureData.energyFeatures?.[key]);
    } else if (config.isSpecial === 'co-ownership') {
      resolved[key] = normalizeValue(featureData.coOwnershipFeatures?.[key]);
    } else if (config.isSpecial === 'quartier') {
      resolved[key] = normalizeValue(featureData.quartier);
    } else if (config.isSpecial === 'exactAddress') {
      resolved[key] = normalizeValue(featureData.exactAddress);
    } else if (config.isSpecial === 'propertyType') {
      resolved[key] = normalizeValue(featureData.propertyType);
    } else if (config.isSpecial === 'dpe') {
      resolved[key] = normalizeValue(featureData.dpe);
    } else {
      resolved[key] = resolveFeature(featureData.featureLines || [], config);
    }
  });

  return resolved;
}
function matchesFilters(resolved) {
  const filterKeys = Object.keys(activeFilters);

  // no filters → show everything
  if (filterKeys.length === 0) return true;

  return filterKeys.every((key) => {
    const selectedValues = activeFilters[key];

    // if filter exists but empty → ignore it
    if (!selectedValues || selectedValues.length === 0) return true;

    const listingValue = normalizeValue(resolved[key]);

    return selectedValues.includes(listingValue);
  });
}
function applyFilters() {
  let listings = document.querySelectorAll('[data-testid="serp-core-classified-card-testid"]');

  if (!listings.length) {
    listings = document.querySelectorAll('.css-dhg3gq');
  }

  listings.forEach((listing) => {
    const link = listing.querySelector('a[href*="/annonces/"]');
    if (!link) return;

    const data = listingFeaturesCache.get(link.href);
    if (!data) return;

    const resolved = buildResolvedFeatures(data);

    const isMatch = matchesFilters(resolved);

    listing.style.display = isMatch ? '' : 'none';
  });
}
function getDynamicFilterValues() {
  const values = {};

  listingFeaturesCache.forEach((data) => {
    const resolved = buildResolvedFeatures(data);

    Object.entries(resolved).forEach(([key, value]) => {
      const v = normalizeValue(value);
      if (!values[key]) values[key] = new Set();
      values[key].add(v);
    });
  });

  // convert Set → Array
  Object.keys(values).forEach((key) => {
    values[key] = Array.from(values[key]);
  });

  return values;
}
function normalizeFeatureText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveBooleanFeature(lines, config) {
  const normalized = lines.map(normalizeFeatureText);
  const hasNegative = config.negative.some((pattern) => normalized.some((line) => line.includes(pattern)));
  if (hasNegative) return false;
  const hasPositive = config.positive.some((pattern) => normalized.some((line) => line.includes(pattern)));
  return hasPositive ? true : 'N/A';
}

function resolveTerrasseFeature(lines) {
  const normalized = lines.map(normalizeFeatureText);
  const terraceIndex = normalized.findIndex((line) => /terasse|terrasse|balcon/.test(line));
  if (terraceIndex < 0) return 'N/A';
  return /pas de|sans /.test(normalized[terraceIndex]) ? false : true;
}

function resolveFeature(lines, config) {
  if (config.isSpecial === 'extractor') {
    return extractEtageField(lines);
  } else if (config.isSpecial === true) {
    return resolveTerrasseFeature(lines);
  } else {
    return resolveBooleanFeature(lines, config);
  }
}

function extractEnergyFeatures(doc) {
  const energyFeatures = {
    chauffage: 'N/A',
    etat: 'N/A',
    anneeConstruction: 'N/A',
    sourceEnergie: 'N/A'
  };

  const energySection = doc.querySelector('[data-testid="cdp-energy-features"]');
  if (!energySection) return energyFeatures;

  const divs = energySection.querySelectorAll('div');
  divs.forEach((div) => {
    const spans = div.querySelectorAll('span');
    if (spans.length >= 2) {
      const firstSpan = spans[0].textContent.trim();
      const secondSpan = spans[1].textContent.trim();

      if (firstSpan.includes('Type de chauffage')) {
        energyFeatures.chauffage = secondSpan;
      } else if (firstSpan.includes('État')) {
        energyFeatures.etat = secondSpan;
      } else if (firstSpan.includes('Année de construction')) {
        energyFeatures.anneeConstruction = secondSpan;
      } else if (firstSpan.includes('Sources d\'énergie') || firstSpan.includes('Sources d énergie')) {
        energyFeatures.sourceEnergie = secondSpan;
      }
    }
  });

  return energyFeatures;
}

function extractCoOwnershipFeatures(doc) {
  const coOwnershipFeatures = {
    nombreDeLots: 'N/A',
    chargesCopropriete: 'N/A'
  };

  const coOwnershipSection = doc.querySelector('[data-testid="cdp-co-ownership"]');
  if (!coOwnershipSection) return coOwnershipFeatures;

  const divs = coOwnershipSection.querySelectorAll('div');
  divs.forEach((div) => {
    const spans = div.querySelectorAll('span');
    if (spans.length >= 2) {
      const firstSpan = spans[0].textContent.trim();
      const secondSpan = spans[1].textContent.trim();

      if (firstSpan.includes('Nombre de lots')) {
        coOwnershipFeatures.nombreDeLots = secondSpan;
      } else if (firstSpan.includes('Charges de copropriété')) {
        coOwnershipFeatures.chargesCopropriete = secondSpan;
      }
    }
  });

  return coOwnershipFeatures;
}

function extractDPE(doc) {
  const dpeElement = doc.querySelector('[data-testid="cdp-preview-scale-highlighted"]');
  if (!dpeElement) return 'N/A';

  const value = dpeElement.textContent.trim();
  const validDPE = /^[A-G]$/.test(value) ? value : 'N/A';
  return validDPE;
}

function extractQuartier(doc) {  
  const addressSection = doc.querySelector('[data-testid="cdp-location-address"]');
  if (!addressSection) {
    return 'N/A';
  }

  const addressElement = addressSection.querySelector('.css-1x2e3ne');
  if (!addressElement) {
    return 'N/A';
  }

  const divs = addressElement.querySelectorAll('div');
  // console.log('[DEBUG] extractQuartier: divs found:', divs.length);
  if (divs.length === 0) {
    return addressElement.innerHTML.substring(0, 200);
  }
    return addressElement.innerHTML.substring(0, 200);
  // Address https://www.coordonnees-gps.fr/
  // https://nominatim.openstreetmap.org/reverse?lat=48.849434&lon=2.550188&format=json

}

function extractEtageField(lines) {
  const normalized = lines.map(normalizeFeatureText);
  const etageIndex = normalized.findIndex((line) => line.includes('etage'));
  return etageIndex >= 0 ? lines[etageIndex] : 'N/A';
}

function getPropertyType(doc) {
  try {
    const script = doc.getElementById("__UFRN_LIFECYCLE_SERVERREQUEST__");
    if (!script) return null;

    // 1. Extract the string inside JSON.parse(" ... ")
    const match = script.textContent.match(/JSON\.parse\("(.+)"\)/s);

    if (!match) return null;

    let jsonString = match[1];

    // 2. First unescape layer (turn \" into ")
    jsonString = jsonString
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '')
      .replace(/\\r/g, '');

    // 3. Parse outer JSON
    const outer = JSON.parse(jsonString);

    return outer?.app_cldp?.data?.classified?.rawData?.propertyTypeLabel;
  } catch (error) {
    console.debug('[SeLoger Enhancer] getPropertyType failed', error);
    return 'N/A';
  }
}
    
async function getAddressFromCoords(doc) {
  try {
    const script = doc.getElementById("__UFRN_LIFECYCLE_SERVERREQUEST__");
    if (!script) return null;

    // 1. Extract the string inside JSON.parse(" ... ")
    const match = script.textContent.match(/JSON\.parse\("(.+)"\)/s);

    if (!match) return null;

    let jsonString = match[1];

    // 2. First unescape layer (turn \" into ")
    jsonString = jsonString
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '')
      .replace(/\\r/g, '');

    // 3. Parse outer JSON
    const outer = JSON.parse(jsonString);

    const location = outer?.app_cldp?.data?.classified?.sections?.location;

    if (!location) return null;

    const isAddressPublished = location.isAddressPublished;
    if (!isAddressPublished) return 'N/A';
    const coords =
      location.geometry?.coordinates || null;

    const [lon, lat] = coords;

    return fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=fr`)
      .then(res => res.json())
      .then(data => data.display_name || 'N/A')
      .catch(() => 'N/A');
  } catch (error) {
    console.debug('[SeLoger Enhancer] getAddressFromCoords failed', error);
    return 'N/A';
  }
}
  
function enqueue(task) {
  return new Promise((resolve) => {
    queue.push({ task, resolve });
    runQueue();
  });
}

function runQueue() {
  if (activeRequests >= MAX_CONCURRENT || queue.length === 0) return;

  const { task, resolve } = queue.shift();
  activeRequests++;

  task().then((res) => {
    resolve(res);
    activeRequests--;
    runQueue();
  });
}

async function fetchFeaturesFromBackend() {
  try {
    const response = await fetch(BACKEND_URL, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store'
    });

    if (!response.ok) {
      console.debug('[SeLoger Enhancer] backend response not OK', response.status);
      return DEFAULT_FEATURES;
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.features)) {
      console.debug('[SeLoger Enhancer] backend returned invalid payload');
      return DEFAULT_FEATURES;
    }

    return data.features.map((feature) => ({
      emoji: feature.emoji || '•',
      label: feature.label || feature.name || 'Feature',
      enabled: feature.enabled !== false
    }));
  } catch (error) {
    console.debug('[SeLoger Enhancer] backend fetch failed', error);
    return DEFAULT_FEATURES;
  }
}

function createToggleButton() {
  let button = document.getElementById('seloger-enhancer-toggle');
  if (button) return button;

  button = document.createElement('button');
  button.id = 'seloger-enhancer-toggle';
  button.type = 'button';
  button.addEventListener('click', () => {
    enabled = !enabled;
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    updateExtensionState();
  });

  document.body.appendChild(button);
  return button;
}
function createSimpleFilterUI() {
  // BUTTON
  const button = document.createElement('button');
  button.textContent = 'Filters ⚙️';

  button.style.position = 'fixed';
  button.style.top = '90px';
  button.style.left = '10px';
  button.style.zIndex = '99999';
  button.style.padding = '8px';
  button.style.background = '#333';
  button.style.color = '#fff';

  // PANEL
  const panel = document.createElement('div');
  panel.style.position = 'fixed';
  panel.style.top = '130px';
  panel.style.left = '10px';
  panel.style.zIndex = '99999';
  panel.style.background = 'white';
  panel.style.padding = '10px';
  panel.style.display = 'none';
  panel.style.border = '1px solid #ccc';
  panel.style.maxHeight = '70vh';
  panel.style.overflow = 'auto';

  // TOGGLE
  button.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  document.body.appendChild(button);
  document.body.appendChild(panel);

  return panel;
}
function renderDynamicFilters(panel) {
  panel.innerHTML = '';

  const dynamicValues = getDynamicFilterValues();

  // =========================
  // ➕ ADD FILTER (accordion)
  // =========================
  const addSection = document.createElement('div'); // NOT details
  addSection.style.marginBottom = '10px';

  const addTitle = document.createElement('div');
  addTitle.textContent = '+ Add Filter';
  addTitle.style.fontWeight = 'bold';
  addTitle.style.marginBottom = '5px';

  addSection.appendChild(addTitle);
  addTitle.style.fontSize = '14px';
  addTitle.style.color = '#333';

  const selector = document.createElement('select');

  const defaultOption = document.createElement('option');
  defaultOption.textContent = 'Select filter...';
  defaultOption.disabled = true;
  defaultOption.selected = true;

  selector.appendChild(defaultOption);

  Object.keys(dynamicValues).forEach((key) => {
    if (activeFilters[key]) return;

    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;

    selector.appendChild(option);
  });

  selector.addEventListener('change', () => {
    const key = selector.value;
    activeFilters[key] = [];
    saveFilters();
    renderDynamicFilters(panel);
  });

  addSection.appendChild(selector);
  panel.appendChild(addSection);

  // =========================
  // 📦 ACTIVE FILTERS
  // =========================
  const activeSection = document.createElement('details');
  activeSection.open = true; // optional: open by default

  const activeSummary = document.createElement('summary');
  activeSummary.textContent = '📦 Active Filters';

  activeSection.appendChild(activeSummary);

  Object.entries(activeFilters).forEach(([key, selectedValues]) => {
    const block = document.createElement('div');
    block.style.margin = '6px 0';

    const header = document.createElement('div');
    header.style.fontWeight = 'bold';
    header.textContent = key + ' ';

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '❌';

    removeBtn.addEventListener('click', () => {
      delete activeFilters[key];
      saveFilters();
      renderDynamicFilters(panel);
    });

    header.appendChild(removeBtn);
    block.appendChild(header);

    const values = dynamicValues[key] || [];

    values.forEach((val) => {
      const label = document.createElement('label');
      label.style.display = 'block';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedValues.includes(val);

      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          activeFilters[key].push(val);
        } else {
          activeFilters[key] =
            activeFilters[key].filter(v => v !== val);
        }

        saveFilters();
      });

      label.appendChild(checkbox);
      label.append(` ${val}`);
      block.appendChild(label);
    });

    activeSection.appendChild(block);
  });

  panel.appendChild(activeSection);

  // =========================
  // ⭐ SAVED FILTERS
  // =========================
  const savedSection = document.createElement('details');

  const savedSummary = document.createElement('summary');
  savedSummary.textContent = '⭐ Saved Filters';

  savedSection.appendChild(savedSummary);

  const presets = loadSavedFilters();

  Object.keys(presets).forEach((name) => {
    const row = document.createElement('div');

    // LOAD BUTTON
    const btn = document.createElement('button');
    btn.textContent = name;

    btn.addEventListener('click', () => {
      applyFilterPreset(name);
      renderDynamicFilters(panel);
    });

    // ❌ DELETE BUTTON (NEW)
    const delBtn = document.createElement('button');
    delBtn.textContent = '❌';

    delBtn.style.marginLeft = '8px';
    delBtn.style.opacity = '0.5';
    delBtn.onmouseover = () => delBtn.style.opacity = '1';
    delBtn.onmouseout = () => delBtn.style.opacity = '0.5';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // prevents triggering load click

      if (!confirm(`Delete filter "${name}" ?`)) return;

      deleteFilterPreset(name);
      renderDynamicFilters(panel);
    });

    row.appendChild(btn);
    row.appendChild(delBtn);

    savedSection.appendChild(row);
  });

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '+ Save current filters';

  saveBtn.addEventListener('click', () => {
    const name = prompt('Name this filter set:');
    if (!name) return;

    saveCurrentFilterPreset(name);
    renderDynamicFilters(panel);
  });

  savedSection.appendChild(saveBtn);

  panel.appendChild(savedSection);

  // =========================
  // 🔄 RESET FILTERS
  // =========================
  const resetBtn = document.createElement('button');
  resetBtn.textContent = '🔄 Reset filters';

  resetBtn.style.marginTop = '10px';
  resetBtn.style.background = '#f44336';
  resetBtn.style.color = 'white';

  resetBtn.addEventListener('click', () => {
    activeFilters = {};
    saveFilters();
    renderDynamicFilters(panel);
  });

  panel.appendChild(resetBtn);
}

function deleteFilterPreset(name) {
  const presets = loadSavedFilters();

  if (!presets[name]) return;

  delete presets[name];

  saveSavedFilters(presets);
}
function renderAddFilterSelector(panel) {
  const selector = document.createElement('select');

  const defaultOption = document.createElement('option');
  defaultOption.textContent = 'Select filter...';
  defaultOption.disabled = true;
  defaultOption.selected = true;

  selector.appendChild(defaultOption);

  const dynamicValues = getDynamicFilterValues();

  Object.keys(dynamicValues).forEach((key) => {
    // avoid duplicates
    if (activeFilters[key]) return;

    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;

    selector.appendChild(option);
  });

  selector.addEventListener('change', () => {
    const key = selector.value;

    activeFilters[key] = []; // initialize empty

    renderDynamicFilters(panel);
  });

  panel.appendChild(selector);
}
function createDownloadButton() {
  let button = document.getElementById('seloger-download-btn');
  if (button) return button;

  button = document.createElement('button');
  button.id = 'seloger-download-btn';
  button.type = 'button';
  button.textContent = 'Download Excel';
  button.addEventListener('click', downloadExcel);

  document.body.appendChild(button);
  console.log('Download button created and appended to body');
  return button;
}

function updateToggleButton() {
  const button = document.getElementById('seloger-enhancer-toggle');
  if (!button) return;

  button.textContent = enabled ? 'SeLoger Enhancer: ON' : 'SeLoger Enhancer: OFF';
  button.classList.toggle('off', !enabled);
}

function updateDownloadButton() {
  const button = document.getElementById('seloger-download-btn');
  if (!button) return;

  let listings = document.querySelectorAll('[data-testid="serp-core-classified-card-testid"]');
  if (!listings.length) {
    listings = document.querySelectorAll('.css-dhg3gq');
  }

  const totalListings = listings.length;
  const readyListings = Array.from(listings).filter((listing) => {
    const link = listing.querySelector('a[href*="/annonces/"]');
    return link && listingFeaturesCache.has(link.href);
  }).length;

  button.textContent = `Download Excel (${readyListings}/${totalListings})`;
}

async function downloadExcel() {
  console.log('Download Excel started');
  if (typeof XLSX === 'undefined') {
    console.error('XLSX library not loaded yet');
    alert('Excel library not loaded yet. Please wait and try again.');
    return;
  }

  let listings = document.querySelectorAll('[data-testid="serp-core-classified-card-testid"]');
  if (!listings.length) {
    const fallbackListings = document.querySelectorAll('.css-dhg3gq');
    if (fallbackListings.length > 0) {
      listings = fallbackListings;
    } else {
      console.debug('[SeLoger Enhancer] no listings found yet');
      return;
    }
  }
  console.log('Found listings for download:', listings.length);
  const data = [];

  listings.forEach((listing) => {
    const linkEl = listing.querySelector('a[href*="/annonces/"]');
    const link = linkEl ? linkEl.href : '';

    const featureLines = link ? listingFeaturesCache.get(link) || {} : {};
    const featureLinesArray = featureLines.featureLines || [];
    const energyFeatures = featureLines.energyFeatures || {};
    const coOwnershipFeatures = featureLines.coOwnershipFeatures || {};
    const quartier = featureLines.quartier || 'N/A';
    const dpe = featureLines.dpe || 'N/A';
    const exactAddress = featureLines.exactAddress || 'N/A';    
    const propertyType = featureLines.propertyType || 'N/A';    

    // Resolve all features using config
    const resolvedFeatures = {};
    Object.entries(FEATURES_CONFIG).forEach(([key, config]) => {
      if (config.isSpecial === 'energy') {
        resolvedFeatures[key] = energyFeatures[key] || 'N/A';
      } else if (config.isSpecial === 'co-ownership') {
        resolvedFeatures[key] = coOwnershipFeatures[key] || 'N/A';
      } else if (config.isSpecial === 'quartier') {
        resolvedFeatures[key] = quartier;
      } else if (config.isSpecial === 'exactAddress') {
        resolvedFeatures[key] = exactAddress;
      } else if (config.isSpecial === 'propertyType') {
        resolvedFeatures[key] = propertyType;
      } else if (config.isSpecial === 'dpe') {
        resolvedFeatures[key] = dpe;
      } else {
        resolvedFeatures[key] = resolveFeature(featureLinesArray, config);
      }
    });
    
    const excelData = {
      Link: link,
      PropertyType: resolvedFeatures.propertyType,
      Elevator: resolvedFeatures.elevator,
      Parking: resolvedFeatures.parking,
      Etage: resolvedFeatures.etage,
      Cave: resolvedFeatures.cave,
      Garden: resolvedFeatures.garden,
      Terasse: resolvedFeatures.terrasse,
      Chauffage: resolvedFeatures.chauffage,
      Etat: resolvedFeatures.etat,
      AnneeConstruction: resolvedFeatures.anneeConstruction,
      SourceEnergie: resolvedFeatures.sourceEnergie,
      NombreDeLots: resolvedFeatures.nombreDeLots,
      ChargesCompropriete: resolvedFeatures.chargesCopropriete,
      Quartier: resolvedFeatures.quartier,
      DPE: resolvedFeatures.dpe,
      ExactAddress: resolvedFeatures.exactAddress
    };

    console.log('Collected data for listing:', excelData);

    data.push(excelData);
  });

  console.log('Total data entries:', data.length);
  if (data.length === 0) {
    alert('No data to download. Please ensure listings are loaded and enhanced.');
    return;
  }

  try {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Listings');
    XLSX.writeFile(wb, 'seloger_listings.xlsx');
    console.log('Excel file downloaded successfully');
  } catch (error) {
    console.error('Error creating Excel file:', error);
    alert('Error creating Excel file. Check console for details.');
  }
}

function createBadgeItem(feature) {
  const badge = document.createElement('span');
  badge.className = 'my-badge';
  badge.innerText = `${feature.emoji} ${feature.label}`;
  return badge;
}

function createFeatureBadge(emoji, label) {
  const badge = document.createElement('span');
  badge.className = 'my-badge';
  badge.innerText = `${emoji} ${label}`;
  return badge;
}

function createColoredBadge(emoji, label, bgColor, textColor = '#000') {
  const badge = document.createElement('span');
  badge.className = 'my-badge';
  badge.innerText = `${emoji} ${label}`;
  badge.style.backgroundColor = bgColor;
  badge.style.color = textColor;
  return badge;
}

function removeOverflowHidden() {
  const body = document.body;
  if (body && body.classList.contains('overflowHidden')) {
    body.classList.remove('overflowHidden');
    console.debug('[SeLoger Enhancer] removed overflowHidden class');
  }
}

async function addBadges() {
  console.count('addBadges called');
  removeOverflowHidden();
  if (!enabled || !badgesData.length) return;
  let listings = document.querySelectorAll('[data-testid="serp-core-classified-card-testid"]');
  if (!listings.length) {
    const fallbackListings = document.querySelectorAll('.css-dhg3gq');
    if (fallbackListings.length > 0) {
      listings = fallbackListings;
    } else {
      console.debug('[SeLoger Enhancer] no listings found yet');
      return;
    }
  }

  let added = 0;
  let skipped = 0;

  listings.forEach((listing) => {
    if (listing.querySelector('.my-badges')) {
      skipped += 1;
      return;
    }

    const badgeContainer = document.createElement('div');
    badgeContainer.className = 'my-badges';

    // Fetch annonce page and extract features
    const link = listing.querySelector('a[href*="/annonces/"]');
    if (link) {
      // Skip selogerneuf links
      if (link.href.includes('selogerneuf')) {
        skipped += 1;
        return;
      }

      enqueue(() => fetch(link.href).then(r => r.text())).then(async (html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const featureLines = [];
        const featuresUl = doc.querySelector('ul.css-1w21zbm.FeaturesPreview');
        if (featuresUl) {
          featuresUl.querySelectorAll('li').forEach((li) => {
            const text = li.textContent.trim();
            if (text) {
              featureLines.push(text);
            }
          });
        }

        // Extract energy features
        const energyFeatures = extractEnergyFeatures(doc);
        const coOwnershipFeatures = extractCoOwnershipFeatures(doc);
        const quartier = extractQuartier(doc);
        const dpe = extractDPE(doc);
        const exactAddress = await getAddressFromCoords(doc);
        const propertyType = getPropertyType(doc);
        // Parse and create feature badges
        const resolvedFeatures = {};
        Object.entries(FEATURES_CONFIG).forEach(([key, config]) => {
          if (config.isSpecial === 'energy') {
            resolvedFeatures[key] = energyFeatures[key];
          } else if (config.isSpecial === 'co-ownership') {
            resolvedFeatures[key] = coOwnershipFeatures[key];
          } else if (config.isSpecial === 'exactAddress') {
            resolvedFeatures[key] = exactAddress;
          } else if (config.isSpecial === 'propertyType') {
            resolvedFeatures[key] = propertyType;
          } else if (config.isSpecial === 'quartier') {
            resolvedFeatures[key] = quartier;
          } else if (config.isSpecial === 'dpe') {
            resolvedFeatures[key] = dpe;
          } else {
            resolvedFeatures[key] = resolveFeature(featureLines, config);
          }
        });

        // Add badges for each feature
        Object.entries(FEATURES_CONFIG).forEach(([key, config]) => {
          const value = resolvedFeatures[key];
          
          if (config.isSpecial === 'extractor') {
            // Skip etage display (keep in Excel only)
            return;
          }

          if (config.isSpecial === 'energy' || config.isSpecial === 'co-ownership' || config.isSpecial === 'exactAddress' || config.isSpecial === 'propertyType' || config.isSpecial === 'quartier') {
            if (value !== 'N/A') {
              badgeContainer.appendChild(createFeatureBadge(config.emoji, value));
            }
            return;
          }
          if (config.isSpecial === 'exactAddress') {
            badgeContainer.appendChild(createFeatureBadge('📍', exactAddress));
          }
          if (config.isSpecial === 'propertyType') {
            badgeContainer.appendChild(createFeatureBadge('🏠', propertyType));
          }
          if (config.isSpecial === 'dpe') {
            // Display DPE with color
            if (value !== 'N/A' && DPE_COLORS[value]) {
              const bgColor = DPE_COLORS[value];
              const textColor = ['D', 'E', 'F', 'G'].includes(value) ? '#000' : '#fff';
              badgeContainer.appendChild(createColoredBadge(config.emoji, `DPE ${value}`, bgColor, textColor));
            }
            return;
          }

          if (value === true && config.emojiTrue) {
            badgeContainer.appendChild(createFeatureBadge(config.emojiTrue, config.label));
          } else if (value === false) {
            badgeContainer.appendChild(createFeatureBadge(FALSE_EMOJI, `No ${config.label}`));
          }
        });

        listingFeaturesCache.set(link.href, {
          featureLines: normalizeValue(featureLines),
          energyFeatures: normalizeValue(energyFeatures),
          coOwnershipFeatures: normalizeValue(coOwnershipFeatures),
          quartier: normalizeValue(quartier),
          dpe: normalizeValue(dpe),
          exactAddress: normalizeValue(exactAddress),
          propertyType: normalizeValue(propertyType)
        });
        updateDownloadButton();
        applyFilters();
        filtersDirty = true;
      }).catch(e => {
        listingFeaturesCache.set(link.href, { featureLines: [], energyFeatures: {}, coOwnershipFeatures: {}, exactAddress: 'N/A',propertyType: 'N/A', quartier: 'N/A', dpe: 'N/A' });
        updateDownloadButton();
        console.debug('[SeLoger Enhancer] fetch failed for listing', link.href, e);
      });
    }

    listing.insertBefore(badgeContainer, listing.firstChild);
    added += 1;
  });

  console.debug(`[SeLoger Enhancer] badges added: ${added}, skipped: ${skipped}`);
}

function removeBadges() {
  document.querySelectorAll('.my-badges').forEach((badgeContainer) => {
    badgeContainer.remove();
  });
}

function updateExtensionState() {
  updateToggleButton();

  if (enabled) {
    console.debug('[SeLoger Enhancer] enabled');
    addBadges();
  } else {
    console.debug('[SeLoger Enhancer] disabled');
    removeBadges();
  }
}

async function init() {
  removeOverflowHidden();
  
  // Monitor for overflowHidden class being added
  const observer = new MutationObserver(() => {
    removeOverflowHidden();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  createToggleButton();
  createDownloadButton();
  updateDownloadButton();
  badgesData = await fetchFeaturesFromBackend();
  const panel = createSimpleFilterUI();
  renderDynamicFilters(panel);
  updateExtensionState();
  setInterval(() => {
    if (filtersDirty) {
      renderDynamicFilters(panel);
      filtersDirty = false;
    }

    applyFilters();
  }, 2000);}

  console.debug('[SeLoger Enhancer] content script loaded');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
}
