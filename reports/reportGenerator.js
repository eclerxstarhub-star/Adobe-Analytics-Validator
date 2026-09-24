const fs = require("fs");
const path = require("path");

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizeArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (value === null || value === undefined || value === "") {
        return [];
    }

    return [value];
}

function unique(values) {
    return [...new Set(
        values
            .filter(value => value !== null && value !== undefined)
            .map(value => String(value).trim())
            .filter(Boolean)
    )];
}

function getPageUrl(page) {
    return (
        page.url ||
        page.pageUrl ||
        page.URL ||
        ""
    );
}

function getPageName(page) {
    return (
        page.pageName ||
        page.page_name ||
        ""
    );
}

function getPageError(page) {
    return Array.isArray(page.errors) && page.errors.length > 0;
}

function getAdobePresent(page) {
    return (
        page.adobeTagPresent === true ||
        (
            Array.isArray(page.adobeHits) &&
            page.adobeHits.length > 0
        )
    );
}

/*
 * ------------------------------------------------------------
 * VALUE HELPERS
 * ------------------------------------------------------------
 */

function collectPageEvars(page) {
    const values = {};

    if (page.eVars && typeof page.eVars === "object") {
        Object.entries(page.eVars).forEach(([key, value]) => {
            values[key] = unique(normalizeArray(value));
        });
    }

    if (Array.isArray(page.adobeHits)) {
        page.adobeHits.forEach(hit => {
            if (!hit || !hit.eVars) {
                return;
            }

            Object.entries(hit.eVars).forEach(([key, value]) => {
                if (!values[key]) {
                    values[key] = [];
                }

                values[key].push(...normalizeArray(value));
                values[key] = unique(values[key]);
            });
        });
    }

    return values;
}

function collectPageProps(page) {
    const values = {};

    if (page.props && typeof page.props === "object") {
        Object.entries(page.props).forEach(([key, value]) => {
            values[key] = unique(normalizeArray(value));
        });
    }

    if (Array.isArray(page.adobeHits)) {
        page.adobeHits.forEach(hit => {
            if (!hit || !hit.props) {
                return;
            }

            Object.entries(hit.props).forEach(([key, value]) => {
                if (!values[key]) {
                    values[key] = [];
                }

                values[key].push(...normalizeArray(value));
                values[key] = unique(values[key]);
            });
        });
    }

    return values;
}

function collectPageEvents(page) {
    let events = [];

    if (Array.isArray(page.events)) {
        events.push(...page.events);
    }

    if (Array.isArray(page.adobeHits)) {
        page.adobeHits.forEach(hit => {
            if (hit && Array.isArray(hit.events)) {
                events.push(...hit.events);
            }
        });
    }

    return unique(events);
}

/*
 * ------------------------------------------------------------
 * PAGE VALIDATION
 * ------------------------------------------------------------
 */

function buildPageValidation(pages) {
    return pages.map((page, index) => {
        return {
            srNo: index + 1,
            url: getPageUrl(page),
            adobePresent: getAdobePresent(page),
            error: getPageError(page)
        };
    });
}

/*
 * ------------------------------------------------------------
 * EVAR / PROP / EVENT VALIDATION
 * ------------------------------------------------------------
 */

function buildVariableValidation(pages, variableType) {
    const map = new Map();

    pages.forEach(page => {
        const pageUrl = getPageUrl(page);
        const pageName = getPageName(page);

        let values = {};

        if (variableType === "eVar") {
            values = collectPageEvars(page);
        } else if (variableType === "prop") {
            values = collectPageProps(page);
        }

        Object.entries(values).forEach(([key, pageValues]) => {
            if (!map.has(key)) {
                map.set(key, {
                    key,
                    pages: [],
                    values: []
                });
            }

            const item = map.get(key);

            if (pageValues.length > 0) {
                item.values.push(...pageValues);

                item.pages.push({
                    url: pageUrl,
                    values: pageValues
                });
            }
        });
    });

    return [...map.values()]
        .map((item, index) => {
            item.values = unique(item.values);

            return {
                srNo: index + 1,
                key: item.key,
                pages: item.pages,
                values: item.values
            };
        });
}

function buildEventValidation(pages) {
    const eventMap = new Map();

    pages.forEach(page => {
        const pageUrl = getPageUrl(page);
        const pageName = getPageName(page);
        const events = collectPageEvents(page);

        events.forEach(event => {
            if (!eventMap.has(event)) {
                eventMap.set(event, {
                    event,
                    pages: []
                });
            }

            eventMap.get(event).pages.push({
                url: pageUrl
            });
        });
    });

    return [...eventMap.values()]
        .map((item, index) => ({
            srNo: index + 1,
            event: item.event,
            pages: item.pages
        }));
}

/*
 * ------------------------------------------------------------
 * CTA VALIDATION
 *
 * IMPORTANT:
 *
 * Crawling/validation happens on EVERY PAGE.
 *
 * Reporting is SITE-WIDE UNIQUE CTA.
 *
 * Same CTA appearing on 10 pages = ONE report row.
 * The Pages column contains all pages where it was validated.
 * ------------------------------------------------------------
 */

function extractCTARecords(page) {
    const records = [];

    /*
     * CTA validation must come ONLY from the explicit CTA validation
     * results generated by siteCrawler.validateCTAs().
     *
     * Do NOT infer CTA validation from normal page-load adobeHits.
     * A page-load hit can contain v24/event6 values unrelated to a
     * CTA click and would produce false PASS/FAIL results.
     */
    if (Array.isArray(page.ctaValidations)) {
        page.ctaValidations.forEach(item => {
            records.push({
                name:
                    item.ctaName ||
                    item.eVar24 ||
                    item.name ||
                    item.value ||
                    "",

                event6:
                    item.event6 === true ||
                    String(item.event6).toLowerCase() === "yes" ||
                    String(item.event6Value).toLowerCase() === "yes",

                validation:
                    String(item.validation || "").toUpperCase(),

                diagnostic:
                    item.diagnostic ||
                    item.error ||
                    item.errorMessage ||
                    ""
            });
        });
    }

    return records.filter(item => String(item.name || "").trim());
}

function buildUniqueCTAValidation(pages) {
    const ctaMap = new Map();

    /*
     * Every CTA occurrence from every scanned page is processed.
     * Reporting is unique by CTA name, but the PASS/FAIL decision is
     * based on ALL occurrences, including duplicate CTAs on the same page.
     */
    pages.forEach(page => {
        const pageUrl = getPageUrl(page);
        const pageName = getPageName(page);
        const ctas = extractCTARecords(page);

        ctas.forEach(cta => {
            const name = String(cta.name || "").trim();
            if (!name) {
                return;
            }

            const key = name.toLowerCase();

            if (!ctaMap.has(key)) {
                ctaMap.set(key, {
                    ctaName: name,
                    occurrences: [],
                    pages: [],
                    failedPages: [],
                    notValidatedPages: []
                });
            }

            const item = ctaMap.get(key);
            const validation = cta.validation;
            const event6Yes = cta.event6 === true;
            const passed = validation === "PASS" && event6Yes;
            const notValidated = validation === "NOT_VALIDATED";

            item.occurrences.push({
                url: pageUrl,
                pageName,
                passed,
                notValidated,
                diagnostic: cta.diagnostic || ""
            });

            if (pageUrl && !item.pages.includes(pageUrl)) {
                item.pages.push(pageUrl);
            }

            if (!passed) {
                if (notValidated) {
                    if (!item.notValidatedPages.some(p => p.url === pageUrl && p.pageName === pageName)) {
                        item.notValidatedPages.push({
                            url: pageUrl,
                            pageName,
                            diagnostic: cta.diagnostic || ""
                        });
                    }
                } else if (!item.failedPages.some(p => p.url === pageUrl && p.pageName === pageName)) {
                    item.failedPages.push({
                        url: pageUrl,
                        pageName,
                        diagnostic: cta.diagnostic || ""
                    });
                }
            }
        });
    });

    return [...ctaMap.values()].map((item, index) => {
        const totalOccurrences = item.occurrences.length;
        const passedOccurrences = item.occurrences.filter(
            occurrence => occurrence.passed
        ).length;
        const failedOccurrences = item.occurrences.filter(
            occurrence => !occurrence.passed && !occurrence.notValidated
        ).length;
        const notValidatedOccurrences = item.occurrences.filter(
            occurrence => occurrence.notValidated
        ).length;

        const allPassed =
            totalOccurrences > 0 &&
            passedOccurrences === totalOccurrences;

        const hasFailed = failedOccurrences > 0;
        const hasNotValidated = notValidatedOccurrences > 0;

        let status = "FAIL";
        if (allPassed) {
            status = "PASS";
        } else if (!hasFailed && hasNotValidated) {
            status = "NOT VALIDATED";
        }

        let event6 = "No";
        if (allPassed) {
            event6 = "Yes";
        } else if (passedOccurrences > 0) {
            event6 = "Yes / No";
        }

        return {
            srNo: index + 1,
            ctaName: item.ctaName,
            pages: item.pages.map(pageUrl => ({ url: pageUrl })),
            event6,
            status,
            failedPages: item.failedPages,
            notValidatedPages: item.notValidatedPages,
            totalOccurrences,
            passedOccurrences,
            failedOccurrences,
            notValidatedOccurrences
        };
    });
}

/*
 * ------------------------------------------------------------
 * MARKETING PIXELS
 *
 * One unique marketing pixel per vendor.
 * All page names are combined.
 * ------------------------------------------------------------
 */

function buildMarketingPixelValidation(pages) {
    const pixelMap = new Map();

    pages.forEach(page => {
        const pageName = getPageName(page);
        const pageUrl = getPageUrl(page);

        const pixels = Array.isArray(page.marketingPixels)
            ? page.marketingPixels
            : [];

        pixels.forEach(pixel => {
            if (!pixel || !pixel.name) {
                return;
            }

            const key = pixel.name.toLowerCase();

            if (!pixelMap.has(key)) {
                pixelMap.set(key, {
                    name: pixel.name,
                    use: pixel.use || "Engagement",
                    pages: [],
                    errors: []
                });
            }

            const item = pixelMap.get(key);

            if (
                pageUrl &&
                !item.pages.includes(pageUrl)
            ) {
                item.pages.push(pageUrl);
            }

            if (
                pixel.error === true ||
                pixel.errors === true
            ) {
                if (!item.errors.includes(pageUrl)) {
                    item.errors.push(pageUrl);
                }
            }

            if (pixel.use) {
                item.use = pixel.use;
            }
        });
    });

    return [...pixelMap.values()].map((item, index) => ({
        srNo: index + 1,
        name: item.name,
        pageUrls: item.pages,
        use: item.use,
        error:
            item.errors.length > 0,
        errorPages: item.errors
    }));
}

/*
 * ------------------------------------------------------------
 * HTML HELPERS
 * ------------------------------------------------------------
 */

function statusBadge(status) {
    const value = String(status).toUpperCase();

    if (value === "PASS" || value === "YES") {
        return `<span class="badge pass">${escapeHtml(status)}</span>`;
    }

    if (value === "FAIL" || value === "NO") {
        return `<span class="badge fail">${escapeHtml(status)}</span>`;
    }

    return `<span class="badge neutral">${escapeHtml(status)}</span>`;
}

function yesNoBadge(value) {
    const yes =
        value === true ||
        String(value).toLowerCase() === "yes";

    return yes
        ? `<span class="badge pass">Yes</span>`
        : `<span class="badge fail">No</span>`;
}

function pageListHtml(items) {
    if (!items || items.length === 0) {
        return "—";
    }

    return items
        .map(item => {
            if (typeof item === "string") {
                return escapeHtml(item);
            }

            return escapeHtml(
                item.url ||
                item.pageUrl ||
                item.url ||
                item.pageUrl ||
                ""
            );
        })
        .join("<br>");
}

/*
 * ------------------------------------------------------------
 * HTML REPORT
 * ------------------------------------------------------------
 */

function buildHTML(results) {
    const pages = Array.isArray(results.pages)
        ? results.pages
        : [];

    const adobePages = pages.filter(
        page => getAdobePresent(page)
    );

    const errors = Array.isArray(results.errors)
        ? results.errors
        : [];

    const totalPages = pages.length;

    const adobeHits = Array.isArray(results.adobeHits)
        ? results.adobeHits.length
        : pages.reduce(
            (total, page) =>
                total +
                normalizeArray(page.adobeHits).length,
            0
        );

    const marketingPixels = buildMarketingPixelValidation(
        pages
    );

    const eVarValidation =
        buildVariableValidation(
            pages,
            "eVar"
        );

    const propValidation =
        buildVariableValidation(
            pages,
            "prop"
        );

    const eventValidation =
        buildEventValidation(pages);

    /*
     * UNIQUE SITE-WIDE CTA REPORT
     */
    const ctaValidation =
        buildUniqueCTAValidation(pages);

    const pageValidation =
        buildPageValidation(pages);

    const detectionRate =
        totalPages > 0
            ? (
                (adobePages.length / totalPages) *
                100
            ).toFixed(2)
            : "0.00";

    const reportDate =
        new Date().toLocaleString();

    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">

<title>Adobe Website Analytics Scan Report</title>

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<style>

body {
    font-family: Arial, Helvetica, sans-serif;
    margin: 0;
    padding: 30px;
    background: #f4f6f8;
    color: #222;
}

h1 {
    margin: 0;
    font-size: 28px;
}

h2 {
    margin-top: 35px;
    margin-bottom: 12px;
    font-size: 20px;
}

h3 {
    margin-top: 25px;
}

.header {
    background: #1f2937;
    color: white;
    padding: 25px;
    border-radius: 8px;
    margin-bottom: 25px;
}

.header p {
    margin: 8px 0 0 0;
}

.summary {
    display: grid;
    grid-template-columns:
        repeat(auto-fit, minmax(150px, 1fr));
    gap: 15px;
    margin-bottom: 30px;
}

.card {
    background: white;
    border-radius: 8px;
    padding: 18px;
    box-shadow:
        0 2px 8px rgba(0,0,0,0.08);
}

.card-title {
    font-size: 13px;
    color: #666;
    margin-bottom: 8px;
}

.card-value {
    font-size: 26px;
    font-weight: bold;
}

.section {
    background: white;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 25px;
    box-shadow:
        0 2px 8px rgba(0,0,0,0.06);
}

.table-container {
    overflow-x: auto;
}

table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
}

th {
    background: #374151;
    color: white;
    padding: 11px;
    text-align: left;
    font-size: 13px;
}

td {
    padding: 10px;
    border-bottom: 1px solid #e5e7eb;
    vertical-align: top;
    font-size: 13px;
}

tr:nth-child(even) {
    background: #f9fafb;
}

.badge {
    display: inline-block;
    padding: 4px 9px;
    border-radius: 12px;
    font-weight: bold;
    font-size: 11px;
}

.pass {
    background: #dcfce7;
    color: #166534;
}

.fail {
    background: #fee2e2;
    color: #991b1b;
}

.neutral {
    background: #e5e7eb;
    color: #374151;
}

.url {
    word-break: break-all;
    max-width: 400px;
}

.small {
    color: #666;
    font-size: 11px;
}

.footer {
    margin-top: 30px;
    color: #777;
    font-size: 12px;
    text-align: center;
}

.failed-pages {
    color: #991b1b;
}

.success-pages {
    color: #166534;
}

</style>
</head>

<body>

<div class="header">

<h1>Adobe Website Analytics Scanner</h1>

<p>
Generated: ${escapeHtml(reportDate)}
</p>

</div>

<div class="summary">

<div class="card">
<div class="card-title">Total Pages</div>
<div class="card-value">${totalPages}</div>
</div>

<div class="card">
<div class="card-title">Adobe Pages</div>
<div class="card-value">${adobePages.length}</div>
</div>

<div class="card">
<div class="card-title">Adobe Hits</div>
<div class="card-value">${adobeHits}</div>
</div>

<div class="card">
<div class="card-title">Marketing Vendors</div>
<div class="card-value">${marketingPixels.length}</div>
</div>

<div class="card">
<div class="card-title">eVars</div>
<div class="card-value">${eVarValidation.length}</div>
</div>

<div class="card">
<div class="card-title">Props</div>
<div class="card-value">${propValidation.length}</div>
</div>

<div class="card">
<div class="card-title">Events</div>
<div class="card-value">${eventValidation.length}</div>
</div>

<div class="card">
<div class="card-title">Unique CTAs</div>
<div class="card-value">${ctaValidation.length}</div>
</div>

<div class="card">
<div class="card-title">Errors</div>
<div class="card-value">${errors.length}</div>
</div>

</div>

<div class="section">

<h2>Page Validation</h2>

<div class="table-container">

<table>

<thead>
<tr>
<th>Sr. No.</th>
<th>Page URL</th>
<th>Adobe Tag present</th>
<th>Error</th>
</tr>
</thead>

<tbody>
`;

    pageValidation.forEach(row => {
        html += `
<tr>
<td>${row.srNo}</td>
<td class="url">${escapeHtml(row.url)}</td>
<td>${yesNoBadge(row.adobePresent)}</td>
<td>${yesNoBadge(!row.error)}</td>
</tr>
`;
    });

    html += `
</tbody>
</table>

</div>
</div>

<!-- EVAR -->

<div class="section">

<h2>Adobe eVar Validation</h2>

<div class="table-container">

<table>

<thead>
<tr>
<th>Sr. No.</th>
<th>Adobe eVar</th>
<th>Pages Populated</th>
<th>Values Found</th>
<th>Page URLs where fired</th>
</tr>
</thead>

<tbody>
`;

    eVarValidation.forEach(row => {
        const pagesPopulated =
            row.pages.length +
            " / " +
            totalPages;

        html += `
<tr>
<td>${row.srNo}</td>
<td><strong>${escapeHtml(row.key)}</strong></td>
<td>
${escapeHtml(pagesPopulated)}
</td>
<td>
${escapeHtml(
    row.values.length > 0
        ? row.values.join(", ")
        : "Not Populated"
)}
</td>
<td class="url">
${pageListHtml(row.pages)}
</td>
</tr>
`;
    });

    html += `
</tbody>
</table>

</div>
</div>

<!-- PROP -->

<div class="section">

<h2>Adobe Prop Validation</h2>

<div class="table-container">

<table>

<thead>
<tr>
<th>Sr. No.</th>
<th>Adobe Prop</th>
<th>Pages Populated</th>
<th>Values Found</th>
<th>Page URLs where fired</th>
</tr>
</thead>

<tbody>
`;

    propValidation.forEach(row => {
        html += `
<tr>
<td>${row.srNo}</td>
<td><strong>${escapeHtml(row.key)}</strong></td>
<td>
${escapeHtml(
    row.pages.length +
    " / " +
    totalPages
)}
</td>
<td>
${escapeHtml(
    row.values.length > 0
        ? row.values.join(", ")
        : "Not Populated"
)}
</td>
<td class="url">
${pageListHtml(row.pages)}
</td>
</tr>
`;
    });

    html += `
</tbody>
</table>

</div>
</div>

<!-- EVENTS -->

<div class="section">

<h2>Adobe Event Validation</h2>

<div class="table-container">

<table>

<thead>
<tr>
<th>Sr. No.</th>
<th>Adobe Event</th>
<th>Pages Populated</th>
<th>Page URLs where fired</th>
</tr>
</thead>

<tbody>
`;

    eventValidation.forEach(row => {
        html += `
<tr>
<td>${row.srNo}</td>
<td><strong>${escapeHtml(row.event)}</strong></td>
<td>
${escapeHtml(row.pages.length + " / " + totalPages)}
</td>
<td class="url">
${pageListHtml(row.pages)}
</td>
</tr>
`;
    });

    html += `
</tbody>
</table>

</div>
</div>

<!-- CTA -->

<div class="section">

<h2>CTA Validation - Unique Site-Wide</h2>

<p class="small">
Every CTA occurrence is checked during crawling.
The same CTA is displayed only once in this report.
If a CTA exists on multiple pages, all validated pages
are listed together.
PASS means the same Adobe hit contained both v24 and event6.
FAIL means the CTA was clicked but the expected tracking
was not found in the same Adobe hit.
</p>

<div class="table-container">

<table>

<thead>
<tr>
<th>Sr. No.</th>
<th>CTA Name (eVar24)</th>
<th>Pages Where CTA Was Validated</th>
<th>Click Event (event6)</th>
<th>Result</th>
<th>Pages Where event6 Was Not Fired</th>
</tr>
</thead>

<tbody>
`;

    ctaValidation.forEach(row => {
        const failedPageUrls =
            (row.failedPages || []).map(
                page => page.url || page.pageUrl || ""
            );

        const notValidatedPageUrls =
            (row.notValidatedPages || []).map(
                page => page.url || page.pageUrl || ""
            );

        const failedDisplay = [
            ...failedPageUrls,
            ...notValidatedPageUrls.map(
                page => `${page} — NOT VALIDATED`
            )
        ];

        html += `
<tr>

<td>${row.srNo}</td>

<td>
<strong>
${escapeHtml(row.ctaName)}
</strong>
</td>

<td>
${pageListHtml(row.pages)}
</td>

<td>
${statusBadge(row.event6)}
</td>

<td>
${statusBadge(row.status)}
</td>

<td class="failed-pages">
${
    failedDisplay.length > 0
        ? escapeHtml(failedDisplay.join(", "))
        : "—"
}
</td>

</tr>
`;
    });

    if (ctaValidation.length === 0) {
        html += `
<tr>
<td colspan="6">
No CTA validation data was captured.
</td>
</tr>
`;
    }

    html += `
</tbody>
</table>

</div>
</div>

<!-- MARKETING PIXELS -->

<div class="section">

<h2>Third-Party Marketing Pixels</h2>

<p class="small">
Marketing pixels are shown uniquely by vendor.
All page URLs where the pixel fired are combined
into one row.
</p>

<div class="table-container">

<table>

<thead>
<tr>
<th>Sr. No.</th>
<th>Marketing Pixel Name</th>
<th>Page URL (where it fired)</th>
<th>Pixel Use</th>
<th>Error</th>
</tr>
</thead>

<tbody>
`;

    marketingPixels.forEach(row => {
        html += `
<tr>

<td>${row.srNo}</td>

<td>
<strong>
${escapeHtml(row.name)}
</strong>
</td>

<td>
${escapeHtml(
    row.pageUrls.join(", ")
)}
</td>

<td>
${escapeHtml(row.use)}
</td>

<td>
${
    row.error
        ? '<span class="badge fail">Yes</span>'
        : '<span class="badge fail">No</span>'
}
</td>

</tr>
`;
    });

    if (marketingPixels.length === 0) {
        html += `
<tr>
<td colspan="5">
No third-party marketing pixels detected.
</td>
</tr>
`;
    }

    html += `
</tbody>
</table>

</div>
</div>

<div class="footer">

Adobe Website Analytics Scanner

</div>

</body>
</html>
`;

    return html;
}

/*
 * ------------------------------------------------------------
 * GENERATE HTML
 * ------------------------------------------------------------
 */

async function generateHTML(results, outputDirectory) {
    if (!results) {
        throw new Error(
            "Scan results are required to generate the report."
        );
    }

    if (!outputDirectory) {
        outputDirectory = path.join(
            __dirname,
            "output"
        );
    }

    if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(
            outputDirectory,
            {
                recursive: true
            }
        );
    }

    const html = buildHTML(results);

    const outputPath = path.join(
        outputDirectory,
        "adobeScanReport.html"
    );

    fs.writeFileSync(
        outputPath,
        html,
        "utf8"
    );

    return outputPath;
}

/*
 * Keep generate() as an alias as well so app.js
 * can use either generateHTML() or generate().
 */
async function generate(results, outputDirectory) {
    return generateHTML(
        results,
        outputDirectory
    );
}

module.exports = {
    generateHTML,
    generate
};