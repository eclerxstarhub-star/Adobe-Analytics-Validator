const {
    Builder,
    By,
    until
} = require("selenium-webdriver");

const chrome = require("selenium-webdriver/chrome");

class SiteCrawler {

    constructor(options = {}) {

        this.driver = null;

        this.maxPages =
            options.maxPages || 25;

        this.maxAdobeWait =
            options.maxAdobeWait || 30000;

        this.postAdobeWait =
            options.postAdobeWait || 2000;

        /*
         * CTA click analytics wait window.
         *
         * A click can generate the Adobe request asynchronously,
         * and some CTAs trigger a navigation/page-view request
         * before the click tracking request reaches the network.
         * We therefore poll the performance log for several seconds
         * and evaluate ALL Adobe hits generated after the click.
         */
        this.ctaClickWait =
            options.ctaClickWait || 8000;

        this.ctaPollInterval =
            options.ctaPollInterval || 250;

        this.results = {
            pages: [],
            adobePages: [],
            adobeHits: [],
            marketingPixels: [],
            errors: [],

            eVars: new Set(),
            props: new Set(),
            events: new Set(),
            reportSuites: new Set(),

            ctaValidations: [],

            totalNetworkRequests: 0
        };

        this.visited = new Set();
        this.queue = [];
    }

    /* =========================================================
       BROWSER
       ========================================================= */

    async createDriver() {

        if (this.driver) {
            return this.driver;
        }

        console.log("");
        console.log("Starting Chrome...");

        const options = new chrome.Options();

        options.addArguments(
            "--start-maximized",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-extensions",
            "--disable-popup-blocking",
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-features=TranslateUI",
            "--disable-software-rasterizer"
        );

        /*
         * IMPORTANT
         * Enable Selenium performance logs.
         *
         * This fixes:
         *
         * InvalidArgumentError:
         * log type 'performance' not found
         */
        options.setLoggingPrefs({
            performance: "ALL",
            browser: "ALL"
        });

        try {

            this.driver = await new Builder()
                .forBrowser("chrome")
                .setChromeOptions(options)
                .build();

            console.log("Chrome started successfully.");

            return this.driver;

        } catch (error) {

            console.log("");
            console.log("Chrome could not be started.");
            console.log(error.message || error);

            throw error;
        }
    }

    async close() {

        if (!this.driver) {
            return;
        }

        try {

            await this.driver.quit();

        } catch (error) {

            console.log(
                "Browser close warning:",
                error.message || error
            );

        } finally {

            this.driver = null;
        }
    }

    /* =========================================================
       URL HELPERS
       ========================================================= */

    normalizeUrl(url) {

        if (!url) {
            return "";
        }

        try {

            const parsed = new URL(url);

            parsed.hash = "";

            return parsed
                .toString()
                .replace(/\/$/, "");

        } catch (error) {

            return url;
        }
    }

    isSameDomain(url, baseUrl) {

        try {

            const target = new URL(url);
            const base = new URL(baseUrl);

            return (
                target.hostname.toLowerCase() ===
                base.hostname.toLowerCase()
            );

        } catch (error) {

            return false;
        }
    }

    isValidPageUrl(url) {

        if (!url) {
            return false;
        }

        const lower = url.toLowerCase();

        if (
            lower.startsWith("javascript:") ||
            lower.startsWith("mailto:") ||
            lower.startsWith("tel:") ||
            lower.startsWith("data:")
        ) {
            return false;
        }

        const blockedExtensions = [
            ".jpg",
            ".jpeg",
            ".png",
            ".gif",
            ".svg",
            ".webp",
            ".ico",
            ".css",
            ".js",
            ".json",
            ".xml",
            ".pdf",
            ".zip",
            ".mp4",
            ".mp3",
            ".woff",
            ".woff2",
            ".ttf",
            ".eot"
        ];

        const cleanUrl = lower.split("?")[0];

        return !blockedExtensions.some(
            extension =>
                cleanUrl.endsWith(extension)
        );
    }

    /* =========================================================
       PERFORMANCE LOGS
       ========================================================= */

    async getPerformanceLogs() {

        if (!this.driver) {
            return [];
        }

        try {

            const logs =
                await this.driver
                    .manage()
                    .logs()
                    .get("performance");

            this.results.totalNetworkRequests +=
                logs.length;

            return logs;

        } catch (error) {

            /*
             * Do not allow Selenium to crash the
             * entire scanner if performance logs
             * are temporarily unavailable.
             */
            if (
                error &&
                error.message &&
                error.message.includes(
                    "log type 'performance' not found"
                )
            ) {

                console.log(
                    "WARNING: Chrome performance logging is not available."
                );

                return [];
            }

            console.log(
                "Performance log warning:",
                error.message || error
            );

            return [];
        }
    }

    parsePerformanceLog(log) {

        try {

            const message =
                JSON.parse(log.message);

            return (
                message.message ||
                message
            );

        } catch (error) {

            return null;
        }
    }

    /* =========================================================
       ADOBE HIT PARSER
       ========================================================= */

    extractAdobeData(url, postData = "", requestId = "") {

        const result = {

            url: url,

            requestId:
                requestId || "",

            postData:
                postData || "",

            reportSuite: "",

            pageName: "",

            eVars: {},

            props: {},

            events: [],

            products: "",

            raw: url,

            sameHitKey:
                requestId || `${url}|${postData || ""}`
        };

        if (
            !url ||
            !url.includes("/b/ss/")
        ) {
            return result;
        }

        try {

            const parsed =
                new URL(url);

            const params =
                new URLSearchParams(
                    parsed.search
                );

            /*
             * Adobe Analytics can send the values in either the
             * URL query string or the POST body. Merge both sources
             * into one parameter collection so that v24/event6 can
             * be evaluated from the complete Adobe request.
             */
            if (postData) {

                let body =
                    postData;

                if (
                    typeof body !== "string"
                ) {
                    body = String(body);
                }

                try {
                    const bodyParams =
                        new URLSearchParams(body);

                    for (
                        const [key, value]
                        of bodyParams.entries()
                    ) {
                        params.append(
                            key,
                            value
                        );
                    }

                } catch (bodyError) {
                    /* Ignore invalid POST bodies. */
                }
            }

            const pathParts =
                parsed.pathname.split("/");

            const bIndex =
                pathParts.findIndex(
                    part =>
                        part.toLowerCase() === "b"
                );

            if (
                bIndex !== -1 &&
                pathParts[bIndex + 1] &&
                pathParts[bIndex + 1].toLowerCase() === "ss" &&
                pathParts[bIndex + 2]
            ) {

                result.reportSuite =
                    pathParts[bIndex + 2];
            }

            result.pageName =
                params.get("pageName") ||
                params.get("gn") ||
                "";

            result.products =
                params.get("products") ||
                "";

            const eventsValues =
                params.getAll("events");

            eventsValues.forEach(
                eventsValue => {

                    if (!eventsValue) {
                        return;
                    }

                    eventsValue
                        .split(",")
                        .map(
                            value =>
                                value.trim()
                        )
                        .filter(Boolean)
                        .forEach(
                            event =>
                                result.events.push(
                                    event
                                )
                        );
                }
            );

            /*
             * Also support individual Adobe event parameters such as
             * event6 or event6=1.
             */
            for (
                const [key, value]
                of params.entries()
            ) {

                if (
                    /^event\d+$/i.test(key)
                ) {

                    result.events.push(
                        value
                            ? `${key}=${value}`
                            : key
                    );
                }
            }

            result.events =
                [
                    ...new Set(
                        result.events
                            .map(
                                event =>
                                    String(event).trim()
                            )
                            .filter(Boolean)
                    )
                ];

            /* Adobe eVars: v1, v2, v24, etc. */
            for (
                const [key, value]
                of params.entries()
            ) {

                if (
                    /^v\d+$/.test(key)
                ) {

                    result.eVars[key] =
                        value;
                }

                /* Adobe props: c1, c2, c24, etc. */
                if (
                    /^c\d+$/.test(key)
                ) {

                    result.props[key] =
                        value;
                }
            }

            if (result.reportSuite) {

                this.results.reportSuites.add(
                    result.reportSuite
                );
            }

            Object.keys(
                result.eVars
            ).forEach(key =>
                this.results.eVars.add(key)
            );

            Object.keys(
                result.props
            ).forEach(key =>
                this.results.props.add(key)
            );

            result.events.forEach(event =>
                this.results.events.add(event)
            );

        } catch (error) {
            /* Keep the basic Adobe result if parsing fails. */
        }

        return result;
    }

    /* =========================================================
       MARKETING PIXELS
       ========================================================= */

    detectMarketingPixel(url) {

        if (!url) {
            return null;
        }

        const lower =
            url.toLowerCase();

        const vendors = [

            {
                name: "Meta Pixel",

                patterns: [
                    "facebook.com/tr",
                    "connect.facebook.net",
                    "facebook.net"
                ],

                use: "Conversion/Engagement"
            },

            {
                name: "Google Analytics",

                patterns: [
                    "google-analytics.com",
                    "googletagmanager.com",
                    "google-analytics"
                ],

                use: "Engagement"
            },

            {
                name: "Google Ads",

                patterns: [
                    "googleadservices.com",
                    "doubleclick.net",
                    "googleads"
                ],

                use: "Conversion"
            },

            {
                name: "Pinterest",

                patterns: [
                    "pinimg.com",
                    "pinterest.com/ct",
                    "ct.pinterest.com"
                ],

                use: "Conversion/Engagement"
            },

            {
                name: "TikTok Pixel",

                patterns: [
                    "analytics.tiktok.com",
                    "tiktok.com/i18n"
                ],

                use: "Conversion/Engagement"
            },

            {
                name: "LinkedIn Insight",

                patterns: [
                    "linkedin.com/insight",
                    "snap.licdn.com"
                ],

                use: "Conversion/Engagement"
            },

            {
                name: "Microsoft Advertising",

                patterns: [
                    "bat.bing.com",
                    "clarity.ms"
                ],

                use: "Conversion/Engagement"
            },

            {
                name: "Amazon Advertising",

                patterns: [
                    "amazon-adsystem.com",
                    "aax.amazon-adsystem.com"
                ],

                use: "Conversion"
            }
        ];

        for (
            const vendor
            of vendors
        ) {

            if (
                vendor.patterns.some(
                    pattern =>
                        lower.includes(
                            pattern.toLowerCase()
                        )
                )
            ) {

                return {

                    name:
                        vendor.name,

                    url: url,

                    use:
                        vendor.use,

                    error: false
                };
            }
        }

        return null;
    }

    /* =========================================================
       NETWORK DATA
       ========================================================= */

    async collectNetworkData() {

        const adobeHits = [];

        const marketingPixels = [];

        const networkErrors = [];

        const logs =
            await this.getPerformanceLogs();

        for (
            const log
            of logs
        ) {

            const message =
                this.parsePerformanceLog(log);

            if (!message) {
                continue;
            }

            if (
                message.method ===
                "Network.requestWillBeSent"
            ) {

                const request =
                    message.params &&
                    message.params.request
                        ? message.params.request
                        : {};

                const requestUrl =
                    request.url || "";

                if (!requestUrl) {
                    continue;
                }

                if (
                    requestUrl.includes(
                        "/b/ss/"
                    )
                ) {

                    const adobeData =
                        this.extractAdobeData(
                            requestUrl,
                            request.postData || "",
                            message.params &&
                            message.params.requestId
                                ? message.params.requestId
                                : ""
                        );

                    adobeHits.push(
                        adobeData
                    );
                }

                const pixel =
                    this.detectMarketingPixel(
                        requestUrl
                    );

                if (pixel) {

                    marketingPixels.push(
                        pixel
                    );
                }
            }

            if (
                message.method ===
                "Network.loadingFailed"
            ) {

                networkErrors.push({

                    error:
                        message.params &&
                        message.params.errorText
                            ? message.params.errorText
                            : "Network request failed"
                });
            }
        }

        return {

            adobeHits,

            marketingPixels,

            networkErrors
        };
    }

    async waitForAdobeHit(
        timeout = this.maxAdobeWait
    ) {

        const start =
            Date.now();

        let collectedPixels = [];

        let collectedErrors = [];

        while (
            Date.now() - start <
            timeout
        ) {

            const data =
                await this.collectNetworkData();

            if (
                data.marketingPixels.length
            ) {

                collectedPixels.push(
                    ...data.marketingPixels
                );
            }

            if (
                data.networkErrors.length
            ) {

                collectedErrors.push(
                    ...data.networkErrors
                );
            }

            if (
                data.adobeHits.length > 0
            ) {

                return {

                    adobeHits:
                        data.adobeHits,

                    marketingPixels:
                        collectedPixels,

                    networkErrors:
                        collectedErrors
                };
            }

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        500
                    )
            );
        }

        return {

            adobeHits: [],

            marketingPixels:
                collectedPixels,

            networkErrors:
                collectedErrors
        };
    }

    /* =========================================================
       PAGE NAME
       ========================================================= */

    async getPageNameFromDom() {

        if (!this.driver) {
            return "";
        }

        try {

            const pageName =
                await this.driver.executeScript(`

                    try {

                        if (
                            window.digitalData &&
                            window.digitalData.page
                        ) {

                            return (

                                window.digitalData.page.pageInfo &&
                                (
                                    window.digitalData.page.pageInfo.pageName ||
                                    window.digitalData.page.pageName
                                )

                            ) || "";
                        }

                        if (
                            window.dataLayer &&
                            Array.isArray(window.dataLayer)
                        ) {

                            for (
                                let i =
                                    window.dataLayer.length - 1;
                                i >= 0;
                                i--
                            ) {

                                const item =
                                    window.dataLayer[i];

                                if (!item) {
                                    continue;
                                }

                                if (
                                    item.pageName
                                ) {

                                    return item.pageName;
                                }

                                if (
                                    item.page &&
                                    item.page.pageName
                                ) {

                                    return item.page.pageName;
                                }
                            }
                        }

                        return "";

                    } catch (e) {

                        return "";
                    }

                `);

            return pageName || "";

        } catch (error) {

            return "";
        }
    }

    /* =========================================================
       LINKS
       ========================================================= */

    async getPageLinks(baseUrl) {

        if (!this.driver) {
            return [];
        }

        try {

            const anchors =
                await this.driver.findElements(
                    By.css("a")
                );

            const links = [];

            for (
                const anchor
                of anchors
            ) {

                try {

                    const href =
                        await anchor.getAttribute(
                            "href"
                        );

                    if (!href) {
                        continue;
                    }

                    const normalized =
                        this.normalizeUrl(
                            href
                        );

                    if (
                        this.isSameDomain(
                            normalized,
                            baseUrl
                        ) &&
                        this.isValidPageUrl(
                            normalized
                        )
                    ) {

                        links.push(
                            normalized
                        );
                    }

                } catch (error) {

                    // Ignore invalid anchors.
                }
            }

            return [
                ...new Set(links)
            ];

        } catch (error) {

            return [];
        }
    }

    /* =========================================================
       CTA DISCOVERY
       ========================================================= */

    async getCTAs() {

        if (!this.driver) {
            return [];
        }

        try {

            const elements =
                await this.driver.findElements(
                    By.css(`
                        a,
                        button,
                        input[type="button"],
                        input[type="submit"],
                        [role="button"]
                    `)
                );

            const ctas = [];

            let visibleIndex = 0;

            for (
                let domIndex = 0;
                domIndex < elements.length;
                domIndex++
            ) {

                const element =
                    elements[domIndex];

                try {

                    const displayed =
                        await element.isDisplayed();

                    const enabled =
                        await element.isEnabled();

                    if (
                        !displayed ||
                        !enabled
                    ) {
                        continue;
                    }

                    const tagName =
                        await element.getTagName();

                    const text =
                        (
                            await element.getText()
                        ).trim();

                    const ariaLabel =
                        await element.getAttribute(
                            "aria-label"
                        ) || "";

                    const title =
                        await element.getAttribute(
                            "title"
                        ) || "";

                    const value =
                        await element.getAttribute(
                            "value"
                        ) || "";

                    const href =
                        await element.getAttribute(
                            "href"
                        ) || "";

                    const ctaName =
                        (
                            text ||
                            ariaLabel ||
                            title ||
                            value ||
                            ""
                        ).trim();

                    if (!ctaName) {
                        continue;
                    }

                    /*
                     * DO NOT DEDUPLICATE CTAs.
                     * Every visible CTA occurrence is validated.
                     */
                    ctas.push({

                        index:
                            domIndex,

                        domIndex:
                            domIndex,

                        visibleIndex:
                            visibleIndex,

                        name:
                            ctaName,

                        tag:
                            tagName,

                        href:
                            href,

                        ariaLabel:
                            ariaLabel,

                        title:
                            title,

                        value:
                            value,

                        text:
                            text
                    });

                    visibleIndex++;

                } catch (error) {
                    /* Ignore stale/invalid CTA elements. */
                }
            }

            /*
             * Assign duplicate occurrence numbers so that identical
             * CTAs can still be distinguished after a page reload.
             */
            const counters =
                new Map();

            ctas.forEach(cta => {

                const key =
                    `${cta.name}|${cta.tag}|${cta.href}|${cta.text}|${cta.ariaLabel}`;

                const occurrence =
                    counters.get(key) || 0;

                cta.duplicateIndex =
                    occurrence;

                counters.set(
                    key,
                    occurrence + 1
                );
            });

            return ctas;

        } catch (error) {

            console.log(
                "CTA discovery warning:",
                error.message || error
            );

            return [];
        }
    }

    /* =========================================================
       CTA VALIDATION HELPERS
       ========================================================= */

    normalizeAdobeEvent(event) {

        if (
            event === null ||
            event === undefined
        ) {
            return "";
        }

        return String(event)
            .trim()
            .toLowerCase();
    }

    isEvent6(event) {

        const normalized =
            this.normalizeAdobeEvent(event);

        return /^event6(?:[=:].*)?$/.test(
            normalized
        );
    }

    hitHasEvent6(hit) {

        if (
            !hit ||
            !Array.isArray(hit.events)
        ) {
            return false;
        }

        return hit.events.some(
            event =>
                this.isEvent6(event)
        );
    }

    getHitEVar24(hit) {

        if (
            !hit ||
            !hit.eVars
        ) {
            return "";
        }

        return String(
            hit.eVars.v24 ||
            hit.eVars.eVar24 ||
            ""
        ).trim();
    }

    async preparePageForCTAClick(pageUrl) {

        console.log(
            "  Reloading page for clean CTA state..."
        );

        try {

            /*
             * Fresh page for EVERY CTA.
             */
            await this.driver.get(
                pageUrl
            );

            await this.driver.wait(
                until.elementLocated(
                    By.css("body")
                ),
                15000
            ).catch(() => {});

            /* Allow SPA/AEM components to render. */
            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        1500
                    )
            );

            /*
             * Drain page-load Adobe/network activity until the browser
             * is quiet for several consecutive polling rounds.
             */
            let quietRounds = 0;

            const requiredQuietRounds =
                4;

            const interval =
                400;

            const start =
                Date.now();

            const maxWait =
                10000;

            let pageLoadAdobeHits = 0;

            while (
                Date.now() - start <
                maxWait
            ) {

                const data =
                    await this.collectNetworkData();

                if (
                    data.adobeHits.length > 0
                ) {

                    pageLoadAdobeHits +=
                        data.adobeHits.length;

                    quietRounds = 0;

                } else {

                    quietRounds++;
                }

                if (
                    quietRounds >=
                    requiredQuietRounds
                ) {
                    break;
                }

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            interval
                        )
                );
            }

            if (pageLoadAdobeHits > 0) {

                console.log(
                    "  Page-load Adobe hits consumed:",
                    pageLoadAdobeHits
                );
            } else {

                console.log(
                    "  No page-load Adobe hits detected before CTA."
                );
            }

            /*
             * Final drain. Anything returned here is deliberately
             * discarded because it belongs to page preparation.
             */
            await this.getPerformanceLogs();

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        250
                    )
            );

            await this.getPerformanceLogs();

            console.log(
                "  Adobe performance log clean before click."
            );

            return true;

        } catch (error) {

            console.log(
                "  Page preparation warning:",
                error.message || error
            );

            /* Always drain logs before continuing. */
            await this.getPerformanceLogs();

            return false;
        }
    }

    async findCTAElement(cta) {

        if (!this.driver) {
            return null;
        }

        const elements =
            await this.driver.findElements(
                By.css(`
                    a,
                    button,
                    input[type="button"],
                    input[type="submit"],
                    [role="button"]
                `)
            );

        const visibleCandidates = [];

        for (
            let domIndex = 0;
            domIndex < elements.length;
            domIndex++
        ) {

            const candidate =
                elements[domIndex];

            try {

                if (
                    !await candidate.isDisplayed() ||
                    !await candidate.isEnabled()
                ) {
                    continue;
                }

                const tag =
                    await candidate.getTagName();

                const text =
                    (
                        await candidate.getText()
                    ).trim();

                const ariaLabel =
                    await candidate.getAttribute(
                        "aria-label"
                    ) || "";

                const title =
                    await candidate.getAttribute(
                        "title"
                    ) || "";

                const value =
                    await candidate.getAttribute(
                        "value"
                    ) || "";

                const href =
                    await candidate.getAttribute(
                        "href"
                    ) || "";

                const name =
                    (
                        text ||
                        ariaLabel ||
                        title ||
                        value ||
                        ""
                    ).trim();

                if (!name) {
                    continue;
                }

                visibleCandidates.push({
                    element:
                        candidate,
                    domIndex:
                        domIndex,
                    tag:
                        tag,
                    text:
                        text,
                    ariaLabel:
                        ariaLabel,
                    title:
                        title,
                    value:
                        value,
                    href:
                        href,
                    name:
                        name
                });

            } catch (error) {
                /* Ignore stale candidates. */
            }
        }

        /*
         * PRIMARY MATCH:
         * Preserve the visible CTA position from the original page.
         */
        if (
            Number.isInteger(
                cta.visibleIndex
            ) &&
            visibleCandidates[
                cta.visibleIndex
            ]
        ) {

            const candidate =
                visibleCandidates[
                    cta.visibleIndex
                ];

            if (
                candidate.name === cta.name &&
                candidate.tag === cta.tag
            ) {

                return candidate.element;
            }
        }

        /*
         * SECONDARY MATCH:
         * Exact fingerprint + duplicate occurrence.
         */
        const exactMatches =
            visibleCandidates.filter(
                candidate =>
                    candidate.tag === cta.tag &&
                    candidate.href ===
                        (cta.href || "") &&
                    candidate.text ===
                        (cta.text || "") &&
                    candidate.ariaLabel ===
                        (cta.ariaLabel || "") &&
                    candidate.title ===
                        (cta.title || "") &&
                    candidate.value ===
                        (cta.value || "")
            );

        if (exactMatches.length > 0) {

            const index =
                Number.isInteger(
                    cta.duplicateIndex
                )
                    ? cta.duplicateIndex
                    : 0;

            return (
                exactMatches[index] ||
                exactMatches[0]
            ).element;
        }

        /* FINAL MATCH: same name/tag + occurrence. */
        const nameMatches =
            visibleCandidates.filter(
                candidate =>
                    candidate.name === cta.name &&
                    candidate.tag === cta.tag
            );

        if (nameMatches.length > 0) {

            const index =
                Number.isInteger(
                    cta.duplicateIndex
                )
                    ? cta.duplicateIndex
                    : 0;

            return (
                nameMatches[index] ||
                nameMatches[0]
            ).element;
        }

        return null;
    }

    async collectCTAAdobeHits() {

        const hits = [];

        const seen = new Set();

        const addHits = adobeHits => {

            if (!Array.isArray(adobeHits)) {
                return;
            }

            adobeHits.forEach(hit => {

                if (
                    !hit ||
                    !hit.url
                ) {
                    return;
                }

                /*
                 * Use requestId where available. URL-only deduplication
                 * is unsafe because multiple Adobe hits share the same
                 * endpoint URL.
                 */
                const key =
                    hit.requestId ||
                    hit.sameHitKey ||
                    `${hit.url}|${hit.raw || ""}|${hit.postData || ""}`;

                if (seen.has(key)) {
                    return;
                }

                seen.add(key);
                hits.push(hit);
            });
        };

        const start =
            Date.now();

        while (
            Date.now() - start <
            this.ctaClickWait
        ) {

            const data =
                await this.collectNetworkData();

            addHits(
                data.adobeHits
            );

            /*
             * STRICT SAME-HIT CHECK.
             * Do not combine v24 from one request with event6 from
             * another request.
             */
            const sameHit =
                hits.find(
                    hit =>
                        Boolean(
                            this.getHitEVar24(hit)
                        ) &&
                        this.hitHasEvent6(hit)
                );

            if (sameHit) {

                return {

                    hits:
                        hits,

                    eVar24:
                        this.getHitEVar24(
                            sameHit
                        ),

                    event6:
                        true,

                    sameHit:
                        sameHit
                };
            }

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        this.ctaPollInterval
                    )
            );
        }

        const eVarHit =
            hits.find(
                hit =>
                    Boolean(
                        this.getHitEVar24(hit)
                    )
            );

        const event6Hit =
            hits.find(
                hit =>
                    this.hitHasEvent6(hit)
            );

        return {

            hits:
                hits,

            eVar24:
                eVarHit
                    ? this.getHitEVar24(eVarHit)
                    : "",

            event6:
                Boolean(event6Hit),

            sameHit:
                null
        };
    }

    /* =========================================================
       CTA VALIDATION
       ========================================================= */

    async validateCTAs(
        pageUrl,
        pageName,
        baseUrl
    ) {

        const validations = [];

        /*
         * Establish the page in a clean state before discovering CTAs.
         */
        await this.preparePageForCTAClick(
            pageUrl
        );

        const ctas =
            await this.getCTAs();

        console.log(
            "CTAs found:",
            ctas.length
        );

        if (!ctas.length) {
            return validations;
        }

        for (
            let ctaIndex = 0;
            ctaIndex < ctas.length;
            ctaIndex++
        ) {

            const cta =
                ctas[ctaIndex];

            console.log("");
            console.log(
                `CTA ${ctaIndex + 1}/${ctas.length}: ${cta.name}`
            );

            const validation = {

                pageUrl:
                    pageUrl,

                pageName:
                    pageName,

                ctaName:
                    cta.name,

                eVar24:
                    "",

                event6:
                    false,

                eVar24Present:
                    false,

                event6Present:
                    false,

                sameHitCorrelation:
                    false,

                clicked:
                    false,

                validation:
                    "NOT_VALIDATED",

                error:
                    "",

                diagnostic:
                    "",

                adobeHitCount:
                    0,

                href:
                    cta.href || "",

                domIndex:
                    cta.domIndex,

                visibleIndex:
                    cta.visibleIndex,

                duplicateIndex:
                    cta.duplicateIndex
            };

            try {

                /*
                 * CRITICAL:
                 * Fresh page before EVERY CTA.
                 */
                await this.preparePageForCTAClick(
                    pageUrl
                );

                const element =
                    await this.findCTAElement(
                        cta
                    );

                if (!element) {

                    validation.error =
                        "CTA element not found after page reload.";

                    validation.validation =
                        "NOT_VALIDATED";

                    validations.push(
                        validation
                    );

                    console.log(
                        "  NOT VALIDATED:",
                        validation.error
                    );

                    continue;
                }

                await this.driver.executeScript(
                    `
                    arguments[0].scrollIntoView({
                        behavior: "instant",
                        block: "center"
                    });
                    `,
                    element
                );

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            400
                        )
                );

                /*
                 * One final drain immediately before the click.
                 * Nothing collected before the click is used for CTA
                 * validation.
                 */
                await this.getPerformanceLogs();

                console.log(
                    "  Performance log cleared."
                );

                console.log(
                    "  Clicking CTA:",
                    cta.name
                );

                try {

                    await element.click();

                } catch (clickError) {

                    console.log(
                        "  Normal click failed; using JavaScript click."
                    );

                    await this.driver.executeScript(
                        `
                        arguments[0].click();
                        `,
                        element
                    );
                }

                validation.clicked =
                    true;

                const clickData =
                    await this.collectCTAAdobeHits();

                const ctaHits =
                    clickData.hits || [];

                validation.adobeHitCount =
                    ctaHits.length;

                console.log(
                    "  Adobe hits after click:",
                    ctaHits.length
                );

                /*
                 * Find the exact Adobe request that contains BOTH:
                 *
                 * v24 = CTA name/value
                 * event6
                 *
                 * This must be one request.
                 */
                const sameHit =
                    ctaHits.find(
                        hit =>
                            Boolean(
                                this.getHitEVar24(hit)
                            ) &&
                            this.hitHasEvent6(hit)
                    );

                const eVarHit =
                    ctaHits.find(
                        hit =>
                            Boolean(
                                this.getHitEVar24(hit)
                            )
                    );

                const event6Hit =
                    ctaHits.find(
                        hit =>
                            this.hitHasEvent6(hit)
                    );

                validation.eVar24 =
                    eVarHit
                        ? this.getHitEVar24(eVarHit)
                        : "";

                validation.eVar24Present =
                    Boolean(
                        eVarHit
                    );

                validation.event6Present =
                    Boolean(
                        event6Hit
                    );

                validation.sameHitCorrelation =
                    Boolean(
                        sameHit
                    );

                validation.event6 =
                    Boolean(
                        sameHit
                    );

                if (
                    validation.eVar24Present
                ) {

                    validation.ctaName =
                        validation.eVar24;
                }

                if (sameHit) {

                    validation.validation =
                        "PASS";

                    validation.diagnostic =
                        "v24 and event6 found in the same Adobe hit.";

                    validation.error =
                        "";

                    console.log(
                        "  ✓ PASS | v24=" +
                        validation.eVar24 +
                        " | event6=Yes | same hit=Yes"
                    );

                } else {

                    validation.validation =
                        "FAIL";

                    const problems = [];

                    if (!validation.eVar24Present) {
                        problems.push(
                            "v24 not found in CTA click window"
                        );
                    }

                    if (!validation.event6Present) {
                        problems.push(
                            "event6 not found in CTA click window"
                        );
                    }

                    if (
                        validation.eVar24Present &&
                        validation.event6Present &&
                        !validation.sameHitCorrelation
                    ) {
                        problems.push(
                            "v24 and event6 were found, but not in the same Adobe hit"
                        );
                    }

                    validation.error =
                        problems.join(
                            " | "
                        );

                    validation.diagnostic =
                        validation.error;

                    console.log(
                        "  ✗ FAIL:",
                        validation.error
                    );

                    /*
                     * Print every Adobe hit captured after the click.
                     * This is extremely useful for diagnosing the exact
                     * CTA that failed.
                     */
                    ctaHits.forEach(
                        (hit, hitIndex) => {

                            console.log(
                                `    Adobe Hit ${hitIndex + 1}: v24=${this.getHitEVar24(hit) || "NOT FOUND"} | events=${Array.isArray(hit.events) ? hit.events.join(",") : "NONE"}`
                            );
                        }
                    );
                }

                validations.push(
                    validation
                );

                console.log(
                    "  CTA validation completed."
                );

            } catch (error) {

                validation.validation =
                    "NOT_VALIDATED";

                validation.error =
                    error.message ||
                    String(error);

                validations.push(
                    validation
                );

                console.log(
                    "  NOT VALIDATED:",
                    validation.error
                );
            }
        }

        console.log("");
        console.log(
            "CTA validation completed:",
            validations.length,
            "of",
            ctas.length
        );

        return validations;
    }

    /* =========================================================
       MERGE PAGE RESULT
       ========================================================= */

    mergePageResult(pageResult) {

        this.results.pages.push(
            pageResult
        );

        if (
            pageResult.adobeTagPresent
        ) {
            this.results.adobePages.push(
                pageResult
            );
        }

        (pageResult.adobeHits || []).forEach(
            hit => {
                this.results.adobeHits.push(hit);

                if (hit.reportSuite) {
                    this.results.reportSuites.add(
                        hit.reportSuite
                    );
                }

                Object.keys(hit.eVars || {}).forEach(
                    key => this.results.eVars.add(key)
                );

                Object.keys(hit.props || {}).forEach(
                    key => this.results.props.add(key)
                );

                (hit.events || []).forEach(
                    event => this.results.events.add(event)
                );
            }
        );

        (pageResult.marketingPixels || []).forEach(
            pixel => this.results.marketingPixels.push(pixel)
        );

        (pageResult.errors || []).forEach(
            error => this.results.errors.push(error)
        );

        if (Array.isArray(pageResult.ctaValidations)) {
            pageResult.ctaValidations.forEach(
                validation => this.results.ctaValidations.push(validation)
            );
        }
    }

    /* =========================================================
       PAGE SCAN
       ========================================================= */

    async scanPage(
        url,
        baseUrl
    ) {

        if (!this.driver) {
            await this.createDriver();
        }

        const pageUrl =
            this.normalizeUrl(url);

        console.log("");
        console.log(
            "----------------------------------------------------------"
        );
        console.log(
            "Scanning:",
            pageUrl
        );
        console.log(
            "----------------------------------------------------------"
        );

        const pageResult = {

            url: pageUrl,

            title: "",

            pageName: "",

            adobeTagPresent: false,

            adobeHits: [],

            eVars: {},

            props: {},

            events: [],

            marketingPixels: [],

            errors: [],

            internalLinks: [],

            ctaValidations: []
        };

        try {

            /*
             * Clear previous performance logs
             * before loading the page.
             */
            await this.getPerformanceLogs();

            await this.driver.get(
                pageUrl
            );

            await this.driver.wait(
                until.elementLocated(
                    By.css("body")
                ),
                15000
            ).catch(() => {});

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        1500
                    )
            );

            pageResult.title =
                await this.driver.getTitle();

            /*
             * Checkout-success is a dynamic confirmation URL.
             * BasketId / ContractId / OrderId can change from run to run.
             * Capture the actual final URL while treating all
             * /personal/checkout-success URLs as the same validation page.
             */
            const actualLoadedUrl =
                this.normalizeUrl(
                    await this.driver.getCurrentUrl()
                );

            if (this.isCheckoutSuccessUrl(pageUrl) && actualLoadedUrl) {
                pageResult.url = actualLoadedUrl;
            }

            /*
             * Collect page-load network data.
             */
            let networkData =
                await this.collectNetworkData();

            /*
             * Wait for Adobe if the first
             * collection didn't find it.
             */
            if (
                networkData.adobeHits.length === 0
            ) {

                const waitedData =
                    await this.waitForAdobeHit(
                        this.maxAdobeWait
                    );

                networkData.adobeHits.push(
                    ...waitedData.adobeHits
                );

                networkData.marketingPixels.push(
                    ...waitedData.marketingPixels
                );

                networkData.networkErrors.push(
                    ...waitedData.networkErrors
                );
            }

            pageResult.adobeHits =
                networkData.adobeHits;

            pageResult.adobeTagPresent =
                pageResult.adobeHits.length > 0;

            /*
             * Determine pageName.
             */
            pageResult.pageName =
                await this.getPageNameFromDom();

            if (
                !pageResult.pageName &&
                pageResult.adobeHits.length > 0
            ) {

                pageResult.pageName =
                    pageResult.adobeHits[0]
                        .pageName || "";
            }

            /*
             * Extract eVars, props and events.
             */
            for (
                const hit
                of pageResult.adobeHits
            ) {

                Object.entries(
                    hit.eVars || {}
                ).forEach(
                    ([key, value]) => {

                        if (
                            !pageResult.eVars[key]
                        ) {

                            pageResult.eVars[key] =
                                [];
                        }

                        if (
                            value &&
                            !pageResult.eVars[key]
                                .includes(value)
                        ) {

                            pageResult.eVars[key]
                                .push(value);
                        }
                    }
                );

                Object.entries(
                    hit.props || {}
                ).forEach(
                    ([key, value]) => {

                        if (
                            !pageResult.props[key]
                        ) {

                            pageResult.props[key] =
                                [];
                        }

                        if (
                            value &&
                            !pageResult.props[key]
                                .includes(value)
                        ) {

                            pageResult.props[key]
                                .push(value);
                        }
                    }
                );

                (
                    hit.events || []
                ).forEach(
                    event => {

                        if (
                            !pageResult.events
                                .includes(event)
                        ) {

                            pageResult.events
                                .push(event);
                        }
                    }
                );
            }

            /*
             * Marketing pixels.
             */
            pageResult.marketingPixels =
                networkData.marketingPixels.map(
                    pixel => ({

                        ...pixel,

                        pageUrl:

                            pageUrl,

                        pageName:

                            pageResult.pageName
                    })
                );

            /*
             * Network errors.
             */
            pageResult.errors.push(
                ...networkData.networkErrors.map(
                    error => ({

                        pageUrl,

                        pageName:
                            pageResult.pageName,

                        error:
                            error.error ||
                            "Network error"
                    })
                )
            );

            /*
             * Find internal links.
             */
            pageResult.internalLinks =
                await this.getPageLinks(
                    baseUrl
                );

            /*
             * =================================================
             * CTA VALIDATION
             * =================================================
             *
             * Perform CTA validation after page-load
             * validation.
             *
             * No fixed CTA limit.
             */
            pageResult.ctaValidations =
                await this.validateCTAs(
                    pageUrl,
                    pageResult.pageName,
                    baseUrl
                );

            /*
             * CTA tracking failures are reported in the CTA Validation
             * section and must NOT make Page Validation fail.
             */

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        this.postAdobeWait
                    )
            );

            console.log(
                "Adobe:",
                pageResult.adobeTagPresent
                    ? "YES"
                    : "NO",
                "| Hits:",
                pageResult.adobeHits.length,
                "| Marketing Pixels:",
                pageResult.marketingPixels.length,
                "| CTAs:",
                pageResult.ctaValidations.length,
                "| Errors:",
                pageResult.errors.length
            );

            this.mergePageResult(
                pageResult
            );

            return pageResult;

        } catch (error) {

            pageResult.errors.push({

                pageUrl,

                pageName:
                    pageResult.pageName,

                error:
                    error.message ||
                    String(error)
            });

            this.mergePageResult(
                pageResult
            );

            console.log(
                "Page scan failed:",
                error.message ||
                error
            );

            return pageResult;
        }
    }

    /* =========================================================
       SELECTED URL VALIDATION
       ========================================================= */

    async scanSelectedUrls(urls) {

        if (!Array.isArray(urls) || urls.length === 0) {
            throw new Error(
                "At least one URL is required."
            );
        }

        const normalizedUrls = [];
        const seen = new Set();

        urls.forEach(url => {
            const normalized = this.normalizeUrl(url);

            if (
                normalized &&
                !seen.has(normalized)
            ) {
                seen.add(normalized);
                normalizedUrls.push(normalized);
            }
        });

        if (normalizedUrls.length === 0) {
            throw new Error(
                "No valid URLs were provided."
            );
        }

        await this.createDriver();

        /*
         * Reset results for a fresh selected-URL validation run.
         */
        this.results = {
            pages: [],
            adobePages: [],
            adobeHits: [],
            marketingPixels: [],
            errors: [],
            eVars: new Set(),
            props: new Set(),
            events: new Set(),
            reportSuites: new Set(),
            ctaValidations: [],
            totalNetworkRequests: 0
        };

        this.visited.clear();
        this.queue = [];

        console.log("");
        console.log("Starting selected URL validation...");
        console.log("URLs to validate:", normalizedUrls.length);
        console.log("");

        /*
         * scanPage() expects a base URL for its internal-link
         * discovery logic. Selected URL mode deliberately does
         * NOT follow those links, so the first supplied URL is
         * sufficient as the base.
         */
        const baseUrl = normalizedUrls[0];

        for (
            let index = 0;
            index < normalizedUrls.length;
            index++
        ) {

            const currentUrl = normalizedUrls[index];

            console.log("");
            console.log(
                `URL ${index + 1}/${normalizedUrls.length}: ${currentUrl}`
            );

            try {

                const pageResult =
                    await this.scanPage(
                        currentUrl,
                        baseUrl
                    );

                /*
                 * Important:
                 * Do not add discovered internal links to a queue.
                 * This is what prevents the old full-site crawler
                 * behavior and keeps validation limited to user URLs.
                 */
                this.visited.add(currentUrl);

                // scanPage() already merges the page into this.results.
                // Do not merge it a second time here, otherwise every
                // selected URL appears twice in the report/summary.

            } catch (error) {

                console.error(
                    "URL validation failed:",
                    currentUrl,
                    error && error.message
                        ? error.message
                        : error
                );

                /*
                 * Keep a page-level error in the report rather than
                 * stopping validation of the remaining URLs.
                 */
                const failedPage = {
                    url: currentUrl,
                    title: "",
                    pageName: "",
                    adobeTagPresent: false,
                    adobeHits: [],
                    eVars: {},
                    props: {},
                    events: [],
                    marketingPixels: [],
                    errors: [
                        error && error.message
                            ? error.message
                            : String(error)
                    ],
                    internalLinks: [],
                    ctaValidations: []
                };

                this.mergePageResult(
                    failedPage
                );
            }

            console.log(
                `Completed ${index + 1}/${normalizedUrls.length}`
            );
        }

        console.log("");
        console.log(
            "Selected URL validation completed."
        );
        console.log(
            "Validated:",
            normalizedUrls.length,
            "URLs"
        );

        return this.results;
    }

    /* =========================================================
       MAIN CRAWL
       ========================================================= */

    async scan(
        startUrl,
        maxPages
    ) {

        if (!startUrl) {

            throw new Error(
                "Starting URL is required."
            );
        }

        maxPages =
            maxPages ||
            this.maxPages ||
            25;

        if (
            maxPages < 1
        ) {

            maxPages = 25;
        }

        await this.createDriver();

        /*
         * Reset results for a fresh scan.
         */
        this.results = {

            pages: [],

            adobePages: [],

            adobeHits: [],

            marketingPixels: [],

            errors: [],

            eVars: new Set(),

            props: new Set(),

            events: new Set(),

            reportSuites: new Set(),

            ctaValidations: [],

            totalNetworkRequests: 0
        };

        this.visited.clear();

        this.queue = [];

        const baseUrl =
            this.normalizeUrl(
                startUrl
            );

        this.queue.push(
            baseUrl
        );

        console.log("");
        console.log(
            "Starting crawl..."
        );

        console.log(
            "Base URL:",
            baseUrl
        );

        console.log(
            "Maximum pages:",
            maxPages
        );

        console.log("");

        while (
            this.queue.length > 0 &&
            this.visited.size < maxPages
        ) {

            const currentUrl =
                this.queue.shift();

            const normalizedUrl =
                this.normalizeUrl(
                    currentUrl
                );

            if (
                !normalizedUrl ||
                this.visited.has(
                    normalizedUrl
                )
            ) {

                continue;
            }

            if (
                !this.isSameDomain(
                    normalizedUrl,
                    baseUrl
                )
            ) {

                continue;
            }

            this.visited.add(
                normalizedUrl
            );

            const pageResult =
                await this.scanPage(
                    normalizedUrl,
                    baseUrl
                );

            /*
             * Add discovered internal links
             * to the crawl queue.
             */
            for (
                const link
                of pageResult.internalLinks
            ) {

                if (
                    !this.visited.has(link) &&
                    !this.queue.includes(link) &&
                    this.visited.size +
                        this.queue.length <
                        maxPages
                ) {

                    this.queue.push(
                        link
                    );
                }
            }

            console.log(
                "Visited:",
                this.visited.size,
                "| Queue remaining:",
                this.queue.length
            );
        }

        console.log("");
        console.log(
            "Crawl completed. Visited:",
            this.visited.size
        );

        return this.results;
    }

    /* =========================================================
       RESULTS
       ========================================================= */

    getResults() {

        return this.results;
    }

    getSummary() {

        const totalPages =
            this.results.pages.length;

        const adobePages =
            this.results.pages.filter(
                page =>
                    page.adobeTagPresent
            ).length;

        const pagesWithoutAdobe =
            totalPages -
            adobePages;

        const uniqueMarketingVendors =
            new Set(
                this.results.marketingPixels.map(
                    pixel =>
                        pixel.name
                )
            ).size;

        const internalLinks =
            this.results.pages.reduce(
                (
                    total,
                    page
                ) =>
                    total +
                    (
                        Array.isArray(
                            page.internalLinks
                        )
                            ? page.internalLinks.length
                            : 0
                    ),
                0
            );

        return {

            totalPages,

            adobePages,

            pagesWithoutAdobe,

            adobeHits:
                this.results.adobeHits.length,

            marketingVendors:
                uniqueMarketingVendors,

            marketingPixels:
                this.results.marketingPixels.length,

            internalLinks,

            errors:
                this.results.errors.length,

            eVars:
                this.results.eVars.size,

            props:
                this.results.props.size,

            events:
                this.results.events.size,

            reportSuites:
                this.results.reportSuites.size,

            ctaValidations:
                this.results.ctaValidations.length,

            ctaPassed:
                this.results.ctaValidations.filter(
                    cta =>
                        cta.validation === "PASS" ||
                        cta.validation === "Yes"
                ).length,

            ctaFailed:
                this.results.ctaValidations.filter(
                    cta =>
                        cta.validation === "FAIL" ||
                        cta.validation === "No"
                ).length,

            ctaNotValidated:
                this.results.ctaValidations.filter(
                    cta =>
                        cta.validation === "NOT_VALIDATED"
                ).length,

            detectionRate:

                totalPages > 0

                    ? (
                        (
                            adobePages /
                            totalPages
                        ) *
                        100
                    ).toFixed(2)

                    : "0.00"
        };
    }
}

module.exports = SiteCrawler;