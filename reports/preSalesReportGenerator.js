const fs = require("fs");
const path = require("path");

function esc(value) {
    return String(value === null || value === undefined ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function json(value) {
    return esc(JSON.stringify(value || {}, null, 2));
}

function badge(status) {
    const cls = String(status).toUpperCase() === "PASS" ? "pass" : String(status).toUpperCase() === "FAIL" ? "fail" : "warn";
    return `<span class="badge ${cls}">${esc(status || "INFO")}</span>`;
}

function table(headers, rows, empty = "No data captured.") {
    let html = `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>`;
    if (!rows.length) html += `<tr><td colspan="${headers.length}" class="empty">${esc(empty)}</td></tr>`;
    else html += rows.join("");
    html += "</tbody></table></div>";
    return html;
}

function hitRows(hits) {
    return hits.map((hit, i) => `<tr>
<td>${i + 1}</td>
<td>${esc(hit.timestamp)}</td>
<td>${esc(hit.reportSuite)}</td>
<td>${esc(hit.pageName)}</td>
<td>${esc(hit.events.join(", "))}</td>
<td><pre>${esc(hit.products)}</pre></td>
<td><pre>${json(hit.eVars)}</pre></td>
<td><pre>${json(hit.props)}</pre></td>
<td>${esc(hit.orderId)}</td>
<td>${esc(hit.revenue)}</td>
<td><details><summary>Raw hit</summary><pre>${esc(hit.url)}\n\nPOST:\n${esc(hit.postData)}</pre></details></td>
</tr>`);
}

function buildHtml(result) {
    const summary = result.summary || {};
    const pages = result.pages || [];
    const actions = result.actions || [];
    const selections = result.selections || [];
    const events = result.ecommerceEvents || [];
    const products = result.products || [];
    const orders = result.orders || [];
    const hits = result.hits || [];
    const errors = result.errors || [];

    const eventMap = new Map();
    for (const item of events) {
        const key = item.event || "unknown";
        if (!eventMap.has(key)) eventMap.set(key, []);
        eventMap.get(key).push(item);
    }

    let html = `<!doctype html><html><head><meta charset="utf-8"><title>StarHub Pre-Sales Journey Validation</title><style>
body{font-family:Arial,Helvetica,sans-serif;background:#f5f7fa;color:#1f2937;margin:0}.container{max-width:1600px;margin:0 auto;padding:28px}.hero{background:#111827;color:white;padding:28px;border-radius:14px}.hero h1{margin:0 0 8px;font-size:28px}.muted{color:#6b7280}.hero .muted{color:#d1d5db}.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:18px 0}.card{background:white;border:1px solid #e5e7eb;border-radius:12px;padding:16px}.card .n{font-size:25px;font-weight:700;margin-top:5px}.section{background:white;border:1px solid #e5e7eb;border-radius:14px;margin:18px 0;padding:20px}.section h2{margin-top:0;font-size:20px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #e5e7eb;padding:9px;vertical-align:top;text-align:left}th{background:#f3f4f6;position:sticky;top:0;z-index:1}pre{white-space:pre-wrap;word-break:break-word;margin:0;max-width:500px;font-size:11px}.badge{display:inline-block;padding:4px 8px;border-radius:999px;font-weight:700;font-size:11px}.pass{background:#dcfce7;color:#166534}.fail{background:#fee2e2;color:#991b1b}.warn{background:#fef3c7;color:#92400e}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.empty{color:#6b7280;text-align:center}details summary{cursor:pointer;color:#2563eb}.selection{display:inline-block;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:8px;margin:4px}.selection b{display:block;font-size:11px;color:#4f46e5}.footer{margin-top:25px;color:#6b7280;font-size:12px}@media(max-width:1100px){.cards{grid-template-columns:repeat(3,1fr)}.grid{grid-template-columns:1fr}}@media(max-width:650px){.cards{grid-template-columns:repeat(2,1fr)}}
</style></head><body><div class="container">
<div class="hero"><h1>StarHub Pre-Sales Journey Validation</h1><div class="muted">Generated: ${esc(new Date().toISOString())}</div><div style="margin-top:14px">Overall Status: ${badge(summary.status)}</div>${result.interrupted ? `<div style="margin-top:10px"><b>Execution ended before normal completion.</b><br><span class="muted">Type: ${esc(result.executionTerminationType || "INTERRUPTED")}</span><br><span class="muted">Reason: ${esc(result.executionTerminationReason || "")}</span></div>` : ""}</div>
<div class="cards">
<div class="card">Pages Visited<div class="n">${esc(summary.pagesVisited || 0)}</div></div>
<div class="card">Adobe /b/ss Hits<div class="n">${esc(summary.adobeHits || 0)}</div></div>
<div class="card">Ecommerce Events<div class="n">${esc(summary.ecommerceEvents || 0)}</div></div>
<div class="card">Products<div class="n">${esc(summary.productsCaptured || 0)}</div></div>
<div class="card">Orders<div class="n">${esc(summary.ordersCaptured || 0)}</div></div>
<div class="card">Errors<div class="n">${esc(errors.length)}</div></div>
</div>

<div class="section"><h2>1. Journey Selections</h2><div>${selections.map(x => `<span class="selection"><b>${esc(x.type)}</b>${esc(x.value)}${x.url ? `<br><span class="muted">${esc(x.url)}</span>` : ""}</span>`).join("") || "No selections recorded."}</div></div>

<div class="section"><h2>2. Page-Level Validation</h2>${table(["Step","Page","Page URL","Page Name","Adobe Hit","Events","Status"], pages.map((p,i) => `<tr><td>${i+1}</td><td>${esc(p.step)}</td><td><pre>${esc(p.url)}</pre></td><td>${esc(p.pageName)}</td><td>${esc(p.adobeHitCount)}</td><td>${esc((p.eventsFound||[]).join(", "))}</td><td>${badge(p.status)}</td></tr>`))}</div>

<div class="section"><h2>3. CTA / Option / Popup Tracking</h2>${table(["Time","Type","Label","Selected Value","Page URL","Adobe Hits","Events","Hit Details"], actions.map(a => `<tr><td>${esc(a.timestamp)}</td><td>${esc(a.action)}</td><td>${esc(a.label)}</td><td>${esc(a.value)}</td><td><pre>${esc(a.pageUrl)}</pre></td><td>${esc(a.adobeHitCount)}</td><td>${esc((a.events||[]).join(", "))}</td><td><details><summary>View ${a.hits ? a.hits.length : 0} hit(s)</summary>${table(["Timestamp","Page Name","Events","Products","eVars","Props","Order","Revenue"], hitRows(a.hits || []))}</details></td></tr>`))}</div>

<div class="section"><h2>4. Ecommerce Events — Values + Pages + URLs</h2>${table(["Event","Value","Page Name","Page URL","Products","Order ID","Revenue","Timestamp","Adobe Hit URL"], events.map(e => `<tr><td><b>${esc(e.event)}</b></td><td>${esc(e.value)}</td><td>${esc(e.pageName)}</td><td><pre>${esc(e.pageUrl)}</pre></td><td><pre>${esc(e.products)}</pre></td><td>${esc(e.orderId)}</td><td>${esc(e.revenue)}</td><td>${esc(e.timestamp)}</td><td><pre>${esc(e.hitUrl)}</pre></td></tr>`))}</div>

<div class="section"><h2>5. Ecommerce Event Summary</h2>${table(["Event","Occurrences","Pages / URLs"], [...eventMap.entries()].map(([event, list]) => `<tr><td><b>${esc(event)}</b></td><td>${list.length}</td><td>${list.map(x => `<div><b>${esc(x.pageName)}</b><br><pre>${esc(x.pageUrl)}</pre></div>`).join("<hr>")}</td></tr>`))}</div>

<div class="section"><h2>6. Product-Level Validation</h2>${table(["Page Name","Page URL","Products","Events","eVars","Props","Timestamp"], products.map(p => `<tr><td>${esc(p.pageName)}</td><td><pre>${esc(p.pageUrl)}</pre></td><td><pre>${esc(p.products)}</pre></td><td>${esc((p.events||[]).join(", "))}</td><td><pre>${json(p.eVars)}</pre></td><td><pre>${json(p.props)}</pre></td><td>${esc(p.timestamp)}</td></tr>`))}</div>

<div class="section"><h2>7. Order-Level Validation</h2>${table(["Order ID","Revenue","Page Name","Page URL","Products","Events","eVars","Props","Timestamp"], orders.map(o => `<tr><td><b>${esc(o.orderId)}</b></td><td>${esc(o.revenue)}</td><td>${esc(o.pageName)}</td><td><pre>${esc(o.pageUrl)}</pre></td><td><pre>${esc(o.products)}</pre></td><td>${esc((o.events||[]).join(", "))}</td><td><pre>${json(o.eVars)}</pre></td><td><pre>${json(o.props)}</pre></td><td>${esc(o.timestamp)}</td></tr>`))}</div>

<div class="section"><h2>8. Complete Adobe /b/ss Hit Details</h2>${table(["#","Timestamp","Report Suite","Page Name","Events","Products","eVars","Props","Order ID","Revenue","Request"], hitRows(hits))}</div>

<div class="section"><h2>9. Crawled / Visited Page URLs</h2>${table(["#","Step","URL","Status"], pages.map((p,i) => `<tr><td>${i+1}</td><td>${esc(p.step)}</td><td><pre>${esc(p.url)}</pre></td><td>${badge(p.status)}</td></tr>`))}</div>

<div class="section"><h2>10. Errors</h2>${table(["Time","Step","Error","Current URL"], errors.map(e => `<tr><td>${esc(e.timestamp)}</td><td>${esc(e.step)}</td><td><pre>${esc(e.error)}</pre></td><td><pre>${esc(e.currentUrl)}</pre></td></tr>`))}</div>

<div class="footer">StarHub Adobe Analytics Pre-Sales Journey Validator</div></div></body></html>`;
    return html;
}

async function generatePreSalesHTML(result, outputDirectory, options = {}) {
    if (!result) throw new Error("Pre-Sales result is required.");

    const outputDir = outputDirectory || path.join(__dirname, "output");
    fs.mkdirSync(outputDir, { recursive: true });

    const html = buildHtml(result);
    const useUniqueFile = options.uniqueFile !== false;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = useUniqueFile
        ? `preSalesJourneyReport_${stamp}`
        : "preSalesJourneyReport";

    const outputPath = path.join(outputDir, `${baseName}.html`);
    fs.writeFileSync(outputPath, html, "utf8");

    const jsonPath = path.join(outputDir, `${baseName}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf8");

    return outputPath;
}

module.exports = { generatePreSalesHTML };
