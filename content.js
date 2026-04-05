const STORAGE_KEY = 'selogerEnhancerEnabled';
const BACKEND_URL = 'http://127.0.0.1:5000/features';
const DEFAULT_FEATURES = [
  { emoji: '🛗', label: 'Elevator', enabled: true },
  { emoji: '🔥', label: 'Chauffage collectif', enabled: true }
];
const SCAN_INTERVAL_MS = 1000;
const MAX_SCAN_ATTEMPTS = 15;
const MAX_CONCURRENT = 3;

let enabled = window.localStorage.getItem(STORAGE_KEY) !== 'false';
let badgesData = DEFAULT_FEATURES;
let scanTimer = null;
let scanAttempts = 0;
let activeRequests = 0;
const queue = [];

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

function downloadExcel() {
  console.log('Download Excel started');
  if (typeof XLSX === 'undefined') {
    console.error('XLSX library not loaded yet');
    alert('Excel library not loaded yet. Please wait and try again.');
    return;
  }

  const listings = document.querySelectorAll('[data-testid="serp-core-classified-card-testid"]');
  console.log('Found listings for download:', listings.length);
  const data = [];

  listings.forEach((listing) => {
    const linkEl = listing.querySelector('a[href*="/annonces/"]');
    const link = linkEl ? linkEl.href : '';

    const badgeContainer = listing.querySelector('.my-badges');
    let description = '';
    let feature = '';

    if (badgeContainer) {
      const descSpan = badgeContainer.querySelector('.my-description');
      description = descSpan ? descSpan.textContent.trim() : '';

      const badges = badgeContainer.querySelectorAll('.my-badge');
      // Skip the first 2 badges (elevator and chauffage), take the next one as feature
      const featureBadges = Array.from(badges).slice(2);
      if (featureBadges.length > 0) {
        feature = featureBadges[0].textContent.trim();
      }
    }

    console.log('Collected data for listing:', { Link: link, Description: description, Feature: feature });
    data.push({
      Link: link,
      Description: description,
      Feature: feature
    });
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

function removeOverflowHidden() {
  const body = document.body;
  if (body && body.classList.contains('overflowHidden')) {
    body.classList.remove('overflowHidden');
    console.debug('[SeLoger Enhancer] removed overflowHidden class');
  }
}

function addBadges() {
  console.count('addBadges called');
  removeOverflowHidden();
  if (!enabled || !badgesData.length) return;

  const listings = document.querySelectorAll('[data-testid="serp-core-classified-card-testid"]');
  if (!listings.length) {
    console.debug('[SeLoger Enhancer] no listings found yet');
    return;
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

    badgesData.forEach((feature) => {
      if (feature.enabled) {
        badgeContainer.appendChild(createBadgeItem(feature));
      }
    });

    // Add first 3 words from description and first characteristic (fetched from annonce page)
    const link = listing.querySelector('a[href*="/annonces/"]');
    if (link) {
      enqueue(() => fetch(link.href).then(r => r.text())).then(html => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Description
        const desc = doc.querySelector('[data-testid="cdp-main-description-expandable-text"]');
        if (desc) {
          const text = desc.textContent || desc.innerText || '';
          const words = text.trim().split(/\s+/).slice(0, 3).join(' ');
          if (words) {
            const descSpan = document.createElement('span');
            descSpan.className = 'my-description';
            descSpan.innerText = words;
            badgeContainer.appendChild(descSpan);
          }
        }
        
        // First characteristic
        const featuresUl = doc.querySelector('ul.css-1w21zbm.FeaturesPreview');
        if (featuresUl) {
          const firstLi = featuresUl.querySelector('li');
          if (firstLi) {
            const featureText = firstLi.textContent.trim();
            if (featureText) {
              const featureBadge = document.createElement('span');
              featureBadge.className = 'my-badge';
              featureBadge.innerText = featureText;
              badgeContainer.appendChild(featureBadge);
            }
          }
        }
      }).catch(e => console.debug('[SeLoger Enhancer] fetch failed for listing', link.href, e));
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
  badgesData = await fetchFeaturesFromBackend();
  updateExtensionState();
}

console.debug('[SeLoger Enhancer] content script loaded');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
