document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("urlBox");

    // ENTER triggers scrape
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            run();
        }
    });
});


async function run() {
    const url = document.getElementById("urlBox").value;
    const status = document.getElementById("status");
    const table = document.getElementById("table");

    if (!url) {
        alert("Please paste a SeLoger URL");
        return;
    }

    status.innerText = "Scraping... please wait";
    table.innerHTML = "";

    try {
        const res = await fetch("http://127.0.0.1:8000/scrape", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ url })
        });

        if (!res.ok) {
            throw new Error("Backend error: " + res.status);
        }

        const data = await res.json();

        console.log("FULL RESPONSE:", data);

        render(data.listings);

        status.innerText = `Done: ${data.count} listings`;

    } catch (err) {
        console.error(err);
        status.innerText = "Error while scraping (check console)";
    }
}


function render(rows) {
    const table = document.getElementById("table");
    table.innerHTML = "";

    if (!rows || rows.length === 0) {
        table.innerHTML = "<tr><td>No data found</td></tr>";
        return;
    }

    const headers = [
        "url",
        "description",
        "property_type",
        "address"
    ];

    // HEADER
    const headerRow = document.createElement("tr");
    headers.forEach(h => {
        const th = document.createElement("th");
        th.innerText = h;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    // ROWS
    rows.forEach(r => {
        const tr = document.createElement("tr");

        headers.forEach(h => {
            const td = document.createElement("td");

            let value = r[h];

            if (!value) value = "";

            // make URL clickable
            if (h === "url" && value) {
                const a = document.createElement("a");
                a.href = value;
                a.target = "_blank";
                a.innerText = "open";
                td.appendChild(a);
            } else {
                td.innerText = value;
            }

            tr.appendChild(td);
        });

        table.appendChild(tr);
    });
}