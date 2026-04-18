// ===============================
// GLOBAL STATE (like Streamlit)
// ===============================
let appState = {
    currentDF: [],
    previousDF: []
};

let mainTable;
let diffTable;

// ===============================
// CACHE HELPERS (NEW)
// ===============================
const CACHE_PREFIX = "seloger_cache:";
const GEO_CACHE_KEY = "seloger_geo";

function getGeoCache() {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
}

function setGeoCache(data) {
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(data));
}
function getCache(url) {
    const raw = localStorage.getItem(CACHE_PREFIX + url);
    return raw ? JSON.parse(raw) : null;
}

function setCache(url, data) {
    localStorage.setItem(CACHE_PREFIX + url, JSON.stringify(data));
}

// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("urlBox");

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") run();
    });

    initTables();

    document.getElementById("downloadBtn").addEventListener("click", () => {
        mainTable.download("csv", "seloger_listings.csv");
    });
});

// ===============================
// INIT TABLES
// ===============================
function initTables() {

    mainTable = new Tabulator("#table", {
        layout: "fitColumns",
        height: "500px",
        placeholder: "No data yet",

        columns: [
            { title: "URL", field: "url", formatter: linkFormatter },
            { title: "Description", field: "description", headerFilter: "input" },
            { title: "Type", field: "property_type", headerFilter: "input" },
            { title: "Address", field: "address", headerFilter: "input" }
        ],

        rowFormatter: function(row) {
            const data = row.getData();
            if (isNewRow(data)) {
                row.getElement().style.backgroundColor = "#d4edda";
            }
        }
    });

    diffTable = new Tabulator("#diffTable", {
        layout: "fitColumns",
        height: "300px",
        placeholder: "No new data",

        columns: [
            { title: "URL", field: "url", formatter: linkFormatter },
            { title: "Description", field: "description", headerFilter: "input" },
            { title: "Type", field: "property_type", headerFilter: "input" },
            { title: "Address", field: "address", headerFilter: "input" }
        ]
    });
}

// ===============================
// FORMATTERS
// ===============================
function linkFormatter(cell) {
    const url = cell.getValue();
    if (!url) return "";
    return `<a href="${url}" target="_blank">open</a>`;
}

// ===============================
// MAIN FUNCTION
// ===============================
async function run() {
    const url = document.getElementById("urlBox").value;
    const status = document.getElementById("status");

    if (!url) {
        alert("Please paste a SeLoger URL");
        return;
    }

    status.innerText = "Scraping... please wait";

    // 🔴 GET FULL CACHE FROM LOCALSTORAGE
    const fullCache = {};

    // listings cache
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith(CACHE_PREFIX)) {
            const urlKey = key.replace(CACHE_PREFIX, "");
            fullCache[urlKey] = JSON.parse(localStorage.getItem(key));
        }
    });

    // ✅ ADD GEO CACHE
    fullCache["geo"] = getGeoCache();
    try {
        const res = await fetch("http://127.0.0.1:8000/scrape", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                url: url,
                cache: fullCache   // ✅ SEND CACHE
            })
        });

        const data = await res.json();

        // ✅ RECEIVE UPDATED CACHE
        Object.entries(data.cache).forEach(([key, value]) => {
            if (key === "geo") {
                setGeoCache(value);   // ✅ store geo separately
            } else {
                setCache(key, value);
            }
        });
        console.log("FULL RESPONSE:", data);

        // Save previous state
        appState.previousDF = [...appState.currentDF];

        // ===============================
        // CACHE PROCESSING (NEW LOGIC)
        // ===============================
        const processedListings = data.listings.map(listing => {
            const cached = getCache(listing.url);

            if (cached) {
                console.log("🟢 CACHE HIT");
                console.log("URL:", listing.url);
                console.log("CACHED CONTENT:", cached);
                return cached;
            } else {
                console.log("🔴 CACHE MISS");
                console.log("URL:", listing.url);
                console.log("NEW CONTENT:", listing);

                setCache(listing.url, listing);
                return listing;
            }
        });

        // Merge new data (instead of overwrite)
        appState.currentDF = mergeData(appState.currentDF, processedListings);

        updateTables();

        status.innerText = `Done: ${data.count} listings`;

    } catch (err) {
        console.error(err);
        status.innerText = "Error while scraping";
    }
}

// ===============================
// MERGE DATA (avoid duplicates)
// ===============================
function mergeData(oldRows, newRows) {
    const map = new Map();

    oldRows.forEach(r => map.set(r.url, r));
    newRows.forEach(r => map.set(r.url, r));

    return Array.from(map.values());
}

// ===============================
// DIFF LOGIC
// ===============================
function getNewRows(oldRows, newRows) {
    const oldUrls = new Set(oldRows.map(r => r.url));
    return newRows.filter(r => !oldUrls.has(r.url));
}

function isNewRow(row) {
    return !appState.previousDF.find(r => r.url === row.url);
}

// ===============================
// UPDATE TABLES
// ===============================
function updateTables() {
    mainTable.replaceData(appState.currentDF);

    const newRows = getNewRows(appState.previousDF, appState.currentDF);
    diffTable.replaceData(newRows);
}