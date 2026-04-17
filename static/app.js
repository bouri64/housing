async function run() {
    const url = document.getElementById("urlBox").value;

    if (!url) {
        alert("Paste URL");
        return;
    }

    const res = await fetch("/scrape", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ url })
    });

    const data = await res.json();

    render(data.listings);
}


function render(rows) {
    const container = document.getElementById("table");
    container.innerHTML = "";

    if (!rows.length) {
        container.innerHTML = "No data found";
        return;
    }

    const table = document.createElement("table");

    const header = document.createElement("tr");
    Object.keys(rows[0]).forEach(k => {
        const th = document.createElement("th");
        th.innerText = k;
        header.appendChild(th);
    });
    table.appendChild(header);

    rows.forEach(r => {
        const tr = document.createElement("tr");

        Object.values(r).forEach(v => {
            const td = document.createElement("td");
            td.innerText = v;
            tr.appendChild(td);
        });

        table.appendChild(tr);
    });

    container.appendChild(table);
}