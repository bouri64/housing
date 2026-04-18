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
            { title: "Description", field: "description" },
            { title: "Type", field: "property_type" },
            { title: "Address", field: "address" }
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

    try {
        const res = await fetch("http://127.0.0.1:8000/scrape", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ url })
        });

        if (!res.ok) {
            throw new Error("Backend error: " + res.status);
        }

        const data = await res.json();

        console.log("FULL RESPONSE:", data);

        // Save previous state
        appState.previousDF = [...appState.currentDF];

        // Merge new data (instead of overwrite)
        appState.currentDF = mergeData(appState.currentDF, data.listings);

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
    // Main dataframe
    mainTable.replaceData(appState.currentDF);

    // Diff dataframe
    const newRows = getNewRows(appState.previousDF, appState.currentDF);
    diffTable.replaceData(newRows);
}