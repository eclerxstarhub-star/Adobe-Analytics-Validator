const { Builder, By, Key, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");

class PreSalesJourneyValidator {
    constructor(options = {}) {
        this.startUrl = options.startUrl || "https://starhubltd-tst1.outsystemsenterprise.com/personal/login";
        this.credentials = options.credentials || {};
        this.config = options.journeyConfig || {};
        this.maxAdobeWait = options.maxAdobeWait || 60000;
        this.networkQuietTime = options.networkQuietTime || 4000;
        this.pollInterval = options.pollInterval || 250;
        this.driver = null;
        this.paymentOptionPrompt = options.paymentOptionPrompt || null;
        this.payLaterPeriod = options.payLaterPeriod || null;
        this.simType = options.simType || null;
        this.result = {
            startedAt: new Date().toISOString(),
            finishedAt: null,
            authentication: {},
            summary: {
                status: "NOT_RUN",
                steps: 0,
                passed: 0,
                failed: 0,
                adobeHits: 0,
                ecommerceEvents: 0,
                pagesVisited: 0,
                productsCaptured: 0,
                ordersCaptured: 0
            },
            pages: [],
            actions: [],
            products: [],
            orders: [],
            ecommerceEvents: [],
            hits: [],
            errors: [],
            selections: []
        };
        this.seenHitKeys = new Set();
        this.lastRecordedPageName = "";
    }

    async createDriver() {
        if (this.driver) return this.driver;
        const options = new chrome.Options();
        options.addArguments(
            "--start-maximized",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-popup-blocking",
            "--disable-notifications",
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-features=TranslateUI"
        );
        options.setLoggingPrefs({ performance: "ALL", browser: "ALL" });
        this.driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();
        return this.driver;
    }

    async close() {
        if (!this.driver) return;
        try { await this.driver.quit(); } catch (_) {}
        this.driver = null;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async drainPerformanceLogs() {
        try {
            return await this.driver.manage().logs().get("performance");
        } catch (_) {
            return [];
        }
    }

    parsePerformanceLog(log) {
        try {
            const parsed = JSON.parse(log.message);
            return parsed.message || parsed;
        } catch (_) {
            return null;
        }
    }

    parseParameterPairs(text) {
        const entries = [];
        if (!text) return entries;
        let value = String(text);
        try {
            if (/^https?:/i.test(value)) {
                const u = new URL(value);
                for (const [key, val] of u.searchParams.entries()) entries.push([key, val]);
            } else {
                value = value.replace(/^\?/, "");
                const params = new URLSearchParams(value);
                for (const [key, val] of params.entries()) entries.push([key, val]);
            }
        } catch (_) {}
        return entries;
    }

    parseHit(url, postData = "", requestId = "") {
        const entries = [
            ...this.parseParameterPairs(url),
            ...this.parseParameterPairs(postData)
        ];
        const params = {};
        for (const [key, value] of entries) {
            params[key] = value;
        }

        let reportSuite = "";
        let pathName = "";
        try {
            const u = new URL(url);
            pathName = u.pathname;
            const parts = u.pathname.split("/");
            const b = parts.findIndex(x => x.toLowerCase() === "b");
            if (b >= 0 && parts[b + 1] && parts[b + 1].toLowerCase() === "ss" && parts[b + 2]) {
                reportSuite = parts[b + 2];
            }
        } catch (_) {}

        const eventObjects = [];
        for (const [key, value] of entries) {
            if (key.toLowerCase() === "events") {
                for (const token of String(value).split(",")) {
                    const t = token.trim();
                    if (!t) continue;
                    const parts = t.split(":");
                    eventObjects.push({ name: parts[0].trim(), value: parts.slice(1).join(":").trim() });
                }
            }
            if (/^event\d+$/i.test(key)) {
                eventObjects.push({ name: key, value: value || "1" });
            }
        }

        const eVars = {};
        const props = {};
        for (const [key, value] of entries) {
            if (/^v\d+$/i.test(key) || /^evar\d+$/i.test(key)) eVars[key.toLowerCase()] = value;
            if (/^c\d+$/i.test(key) || /^prop\d+$/i.test(key)) props[key.toLowerCase()] = value;
        }

        const products = params.products || "";
        const pageName = params.pageName || params.gn || params.v1 || "";
        const orderId = params.purchaseID || params.purchaseId || params.transactionID || params.orderId || params.oid || "";
        const revenue = params.purchaseamount || params.purchaseAmount || params.revenue || params.amount || "";

        return {
            timestamp: new Date().toISOString(),
            requestId: requestId || "",
            url,
            pathName,
            reportSuite,
            pageName,
            events: eventObjects.map(x => x.name),
            eventDetails: eventObjects,
            eVars,
            props,
            products,
            orderId,
            revenue,
            rawQuery: params,
            postData: postData || ""
        };
    }

    async collectAdobeHits() {
        const hits = [];
        const logs = await this.drainPerformanceLogs();
        for (const log of logs) {
            const msg = this.parsePerformanceLog(log);
            if (!msg || msg.method !== "Network.requestWillBeSent") continue;
            const request = msg.params && msg.params.request;
            if (!request || !request.url || !/\/b\/ss\//i.test(request.url)) continue;
            const hit = this.parseHit(request.url, request.postData || "", msg.params.requestId || "");
            const key = `${hit.requestId}|${hit.url}|${hit.postData}`;
            if (this.seenHitKeys.has(key)) continue;
            this.seenHitKeys.add(key);
            hits.push(hit);
        }
        return hits;
    }

    async captureAdobeWindow(label, options = {}) {
        const timeout = options.timeout || (options.isPageLoad ? this.maxAdobeWait : Math.min(this.maxAdobeWait, 20000));
        const quietTime = options.quietTime || this.networkQuietTime;
        const start = Date.now();
        let lastHitAt = null;
        const hits = [];

        while (Date.now() - start < timeout) {
            const batch = await this.collectAdobeHits();
            if (batch.length) {
                hits.push(...batch);
                lastHitAt = Date.now();
            }
            if (hits.length && lastHitAt && Date.now() - lastHitAt >= quietTime) break;
            await this.sleep(this.pollInterval);
        }

        if (hits.length) {
            this.addHitData(hits);
        }
        return hits;
    }

    async waitForElement(locator, timeout = 60000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            try {
                const elements = await this.driver.findElements(locator);
                for (const element of elements) {
                    if (await element.isDisplayed() && await element.isEnabled()) return element;
                }
            } catch (_) {}
            await this.sleep(300);
        }
        throw new Error(`Element not found within ${timeout}ms: ${JSON.stringify(locator)}`);
    }

    async visibleElements(locator) {
        const elements = await this.driver.findElements(locator);
        const visible = [];
        for (const element of elements) {
            try {
                if (await element.isDisplayed() && await element.isEnabled()) visible.push(element);
            } catch (_) {}
        }
        return visible;
    }

    async textOf(element) {
        try { return (await element.getText()).replace(/\s+/g, " ").trim(); } catch (_) { return ""; }
    }

    async clickElement(element, label) {
        await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", element);
        await this.sleep(400);
        try {
            await element.click();
        } catch (_) {
            await this.driver.executeScript("arguments[0].click();", element);
        }
        console.log(`    Payment selection clicked: ${label}`);
    }

    async clickText(text, options = {}) {
        const exact = options.exact !== false;
        const escaped = JSON.stringify(String(text));
        const xpath = exact
            ? `//*[self::a or self::button or @role='button' or self::label][normalize-space(.)=${escaped}]`
            : `//*[self::a or self::button or @role='button' or self::label][contains(normalize-space(.),${escaped})]`;
        const elements = await this.visibleElements(By.xpath(xpath));
        if (!elements.length) return null;
        await this.clickElement(elements[0], text);
        return elements[0];
    }

    async waitForUrlPrefix(prefix, timeout = 60000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const url = await this.driver.getCurrentUrl();
            if (url.toLowerCase().startsWith(prefix.toLowerCase())) return url;
            await this.sleep(400);
        }
        throw new Error(`Timed out waiting for URL prefix: ${prefix}\nCurrent URL: ${await this.driver.getCurrentUrl()}`);
    }

    async waitForPageReady(timeout = 60000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            try {
                const state = await this.driver.executeScript("return document.readyState");
                if (state === "complete" || state === "interactive") return;
            } catch (_) {}
            await this.sleep(250);
        }
    }

    async getPageName() {
        try {
            return await this.driver.executeScript(`
                try {
                    const layers = [
                        window.adobeDataLayer,
                        window.dataLayer
                    ];

                    for (const layer of layers) {
                        if (!Array.isArray(layer)) continue;

                        for (let i = layer.length - 1; i >= 0; i--) {
                            const x = layer[i];

                            if (!x || typeof x !== "object") {
                                continue;
                            }

                            if (x.pageName) {
                                return String(x.pageName).trim();
                            }

                            if (x.page && x.page.pageName) {
                                return String(x.page.pageName).trim();
                            }

                            if (x.pageData && x.pageData.pageName) {
                                return String(x.pageData.pageName).trim();
                            }

                            if (x.analytics && x.analytics.pageName) {
                                return String(x.analytics.pageName).trim();
                            }
                        }
                    }
                } catch (e) {}

                return "";
            `);
        } catch (_) {
            return "";
        }
    }

    async waitForPageName(previousPageName = "", timeout = 3500) {
        const start = Date.now();
        let current = "";

        while (Date.now() - start < timeout) {
            current = String(
                await this.getPageName()
            ).trim();

            if (current) {
                if (!previousPageName || current !== previousPageName) {
                    return current;
                }
            }

            await this.sleep(250);
        }

        return current;
    }

    async recordPage(name, expectedPrefix = "") {
        await this.waitForPageReady();

        const url = await this.driver.getCurrentUrl();
        const title = await this.driver.getTitle().catch(() => "");

        this.currentPageUrl = url;

        const previousPageName =
            this.lastRecordedPageName ||
            "";

        /*
         * For navigation-based journeys the dataLayer can update
         * slightly after document.readyState becomes complete.
         * Give it a short window to expose the pageName.
         */
        const dataLayerPageName =
            await this.waitForPageName(
                previousPageName,
                3500
            );

        /*
         * Capture any new Adobe hits generated by this page.
         */
        const hits =
            await this.captureAdobeWindow(
                `${name} pageLoad`,
                {
                    isPageLoad: true
                }
            );

        /*
         * Prefer the pageName from the latest Adobe hit that
         * belongs to this page. If the page-load hit was already
         * consumed during the preceding CTA capture, use the
         * recent global hit buffer as a fallback.
         */
        const hitPageName =
            [...hits]
                .reverse()
                .map(hit =>
                    String(
                        hit && hit.pageName
                            ? hit.pageName
                            : ""
                    ).trim()
                )
                .find(Boolean) ||
            [...this.result.hits]
                .slice(-10)
                .reverse()
                .map(hit =>
                    String(
                        hit && hit.pageName
                            ? hit.pageName
                            : ""
                    ).trim()
                )
                .find(Boolean) ||
            "";

        let pageName = "";

        /*
         * When the dataLayer has changed from the previous page,
         * treat that as the strongest indication of the current
         * page. This prevents a previous-page Adobe hit captured
         * during a CTA transition from being reused.
         */
        if (
            dataLayerPageName &&
            (
                !previousPageName ||
                dataLayerPageName !== previousPageName
            )
        ) {
            pageName =
                dataLayerPageName;
        } else if (
            hitPageName
        ) {
            pageName =
                hitPageName;
        } else if (
            dataLayerPageName
        ) {
            pageName =
                dataLayerPageName;
        }

        this.lastRecordedPageName =
            pageName ||
            previousPageName ||
            "";

        const allPageHits =
            hits.length > 0
                ? hits
                : (
                    hitPageName
                        ? this.result.hits
                            .slice(-10)
                            .filter(hit =>
                                String(
                                    hit &&
                                    hit.pageName
                                        ? hit.pageName
                                        : ""
                                ).trim() ===
                                hitPageName
                            )
                        : []
                );

        const events =
            [
                ...new Set(
                    allPageHits.flatMap(
                        hit =>
                            Array.isArray(
                                hit.events
                            )
                                ? hit.events
                                : []
                    )
                )
            ];

        const page = {
            step: name,
            url,
            expectedPrefix,
            title,
            pageName,
            pageLoadCaptured:
                hits.length > 0 ||
                !!hitPageName,
            adobeHitCount:
                hits.length > 0
                    ? hits.length
                    : allPageHits.length,
            eventsFound: events,
            status:
                hits.length > 0 ||
                !!pageName
                    ? "PASS"
                    : "FAIL",
            hits: allPageHits
        };

        this.result.pages.push(page);

        return page;
    }

    recordAction(action, label, value, hits, pageUrl) {
        const eventNames = [...new Set(hits.flatMap(h => h.events))];
        const actionRecord = {
            action,
            label,
            value: value || "",
            pageUrl,
            timestamp: new Date().toISOString(),
            adobeHitCount: hits.length,
            events: eventNames,
            hits
        };
        this.result.actions.push(actionRecord);
        return actionRecord;
    }

    addHitData(hits) {
        for (const hit of hits) {
            this.result.hits.push(hit);
            for (const event of hit.eventDetails || []) {
                this.result.ecommerceEvents.push({
                    event: event.name,
                    value: event.value,
                    pageName: hit.pageName,
                    pageUrl: this.currentPageUrl || hit.url,
                    timestamp: hit.timestamp,
                    products: hit.products,
                    orderId: hit.orderId,
                    revenue: hit.revenue,
                    hitUrl: hit.url
                });
            }
            if (hit.products) {
                this.result.products.push({
                    pageUrl: this.currentPageUrl || hit.url,
                    pageName: hit.pageName,
                    products: hit.products,
                    events: hit.events,
                    eVars: hit.eVars,
                    props: hit.props,
                    timestamp: hit.timestamp
                });
            }
            if (hit.orderId || hit.revenue || hit.events.some(e => /purchase|order.?success/i.test(e))) {
                this.result.orders.push({
                    pageUrl: this.currentPageUrl || hit.url,
                    pageName: hit.pageName,
                    orderId: hit.orderId,
                    revenue: hit.revenue,
                    products: hit.products,
                    events: hit.events,
                    eVars: hit.eVars,
                    props: hit.props,
                    timestamp: hit.timestamp
                });
            }
        }
    }

    async navigateAndRecord(name, prefix, url) {
        await this.drainPerformanceLogs();
        await this.driver.get(url);
        await this.waitForUrlPrefix(prefix);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        return this.recordPage(name, prefix);
    }

    async clickAndRecord(name, clickFn, targetPrefix = "", actionLabel = "") {
        await this.drainPerformanceLogs();
        await clickFn();
        const hits = await this.captureAdobeWindow(name);
        if (targetPrefix) await this.waitForUrlPrefix(targetPrefix);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        this.recordAction("CTA", actionLabel || name, "", hits, this.currentPageUrl);
        return hits;
    }

    async login() {
        console.log("\n[1] Login");
        await this.navigateAndRecord("Login Page", this.config.startUrl || this.startUrl, this.config.startUrl || this.startUrl);

        const email = await this.waitForElement(By.css("input[type='email'],input[name*='email'],input[id*='email'],input[name*='user'],input[id*='user'],input[type='text']"));
        const password = await this.waitForElement(By.css("input[type='password']"));
        await email.clear();
        await email.sendKeys(this.credentials.hubId || "");
        await password.clear();
        await password.sendKeys(this.credentials.hubPassword || "");

        const buttons = await this.visibleElements(By.xpath("//button[normalize-space(.)='Login' or .//*[normalize-space(.)='Login']] | //input[@type='submit']"));
        if (buttons.length) await this.clickAndRecord("Login CTA", () => this.clickElement(buttons[0], "Login"), this.config.homeUrlPrefix, "Login");
        else {
            await this.drainPerformanceLogs();
            await password.sendKeys(Key.ENTER);
            const hits = await this.captureAdobeWindow("Login CTA");
            this.recordAction("CTA", "Login", "", hits, await this.driver.getCurrentUrl());
        }

        await this.waitForUrlPrefix(this.config.homeUrlPrefix);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        console.log("    Login successful. Landed on: " + this.currentPageUrl);
        this.result.authentication = { status: "SUCCESS", account: "Test Account" };
    }

    async stepHome() {
        console.log("\n[2] Mobile Plans / Landing");
        await this.recordPage("Mobile Plans / Landing", this.config.homeUrlPrefix);
        const cta = await this.visibleElements(By.xpath("//*[self::a or self::button or @role='button'][contains(normalize-space(.),'See more devices')]")).then(x => x[0]);
        if (!cta) throw new Error("CTA 'See more devices' was not found.");
        await this.clickAndRecord("See More Devices CTA", () => this.clickElement(cta, "See more devices"), this.config.deviceListingPrefix, "See more devices");
        await this.waitForUrlPrefix(this.config.deviceListingPrefix);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Mobile Device Listing", this.config.deviceListingPrefix);
    }

    async isCurrentProductOutOfStock() {
        try {
            const state = await this.driver.executeScript(() => {
                const visible = el => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.display !== "none" &&
                        style.visibility !== "hidden" &&
                        rect.width > 0 &&
                        rect.height > 0;
                };

                const selectors = [
                    "[data-container]",
                    "button",
                    "label",
                    "span",
                    "div",
                    "p"
                ];

                const negativePattern = /(?:out\s*of\s*stock|sold\s*out|currently\s*unavailable|not\s*available|unavailable|no\s*stock)/i;
                const positivePattern = /(?:add\s*to\s*(?:cart|basket)|buy\s*now|available\s*now)/i;

                const matches = [];
                for (const selector of selectors) {
                    for (const el of Array.from(document.querySelectorAll(selector))) {
                        if (!visible(el)) continue;
                        const text = String(el.innerText || el.textContent || "")
                            .replace(/\s+/g, " ")
                            .trim();
                        if (!text || text.length > 180) continue;
                        if (negativePattern.test(text)) matches.push(text);
                    }
                }

                const addToCart = Array.from(document.querySelectorAll("button,a,[role='button']"))
                    .some(el => visible(el) && positivePattern.test(String(el.innerText || el.textContent || "")));

                return {
                    negativeMatches: [...new Set(matches)].slice(0, 20),
                    addToCart
                };
            });

            if (state.addToCart) return false;
            return state.negativeMatches.length > 0;
        } catch (_) {
            return false;
        }
    }

    async findIphone17ProMaxCards(timeout = 90000) {
        const start = Date.now();
        let lastCount = 0;

        while (Date.now() - start < timeout) {
            try {
                await this.driver.executeScript("window.scrollTo(0, document.body.scrollHeight);");
                await this.sleep(1200);
                await this.driver.executeScript("window.scrollTo(0, 0);");
            } catch (_) {}

            const cards = await this.driver.executeScript(() => {
                const normalize = value => String(value || "")
                    .replace(/\s+/g, " ")
                    .trim();

                const result = [];
                const nodes = Array.from(document.querySelectorAll(".product-item-card"));

                nodes.forEach((card, index) => {
                    const text = normalize(card.innerText || card.textContent || "");
                    const modelNode = card.querySelector(".content-section .f-h6, .content-section span.f-h6");
                    const model = normalize(modelNode ? modelNode.innerText || modelNode.textContent : "");
                    const image = card.querySelector("img");
                    const imageSrc = normalize(image ? image.getAttribute("src") : "");

                    const combined = `${model} ${text} ${imageSrc}`.toLowerCase();
                    if (!combined.includes("iphone 17")) return;

                    const proMax = combined.includes("iphone 17 pro max") || combined.includes("iphone-17-pro-max");
                    if (!proMax) return;

                    result.push({
                        index,
                        model: model || "iPhone 17 Pro Max",
                        text: text.slice(0, 300),
                        imageSrc,
                        hasContentClickTarget: !!card.querySelector(".content-section > div[style*='cursor'], .image-section > div[style*='cursor']")
                    });
                });

                return result;
            }).catch(() => []);

            lastCount = cards.length;
            if (cards.length) return cards;
            await this.sleep(1800);
        }

        return [];
    }

    async chooseDevice() {
        console.log("\n[3] Mobile Device Listing -> Random iPhone 17 Pro Max");

        const maxAttempts = 8;
        const attemptedModels = new Set();
        let lastError = "";

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            console.log(`    Device selection attempt ${attempt}/${maxAttempts}`);

            await this.waitForPageReady(90000);

            if (!this.config.deviceListingPrefix ||
                !(await this.driver.getCurrentUrl()).toLowerCase().startsWith(this.config.deviceListingPrefix.toLowerCase())) {
                await this.driver.get(this.config.deviceListingPrefix);
                await this.waitForUrlPrefix(this.config.deviceListingPrefix, 90000);
                await this.recordPage("Mobile Device Listing - Retry", this.config.deviceListingPrefix);
            }

            const cards = await this.findIphone17ProMaxCards(90000);

            if (!cards.length) {
                throw new Error(
                    "No iPhone 17 Pro Max product cards were found on the device listing page. " +
                    "The PLP uses .product-item-card cards, but no matching iPhone 17 Pro Max card was rendered."
                );
            }

            let availablePool = cards.filter(card => !attemptedModels.has(card.model));
            if (!availablePool.length) availablePool = cards;

            const selected = availablePool[Math.floor(Math.random() * availablePool.length)];
            attemptedModels.add(selected.model);

            console.log(`    Found ${cards.length} iPhone 17 Pro Max card(s).`);
            console.log(`    Selected device: ${selected.model}`);
            if (selected.imageSrc) console.log(`    Device image: ${selected.imageSrc}`);

            this.result.selections.push({
                type: "Device Attempt",
                value: selected.model,
                url: selected.imageSrc || "",
                attempt
            });

            await this.drainPerformanceLogs();

            const clicked = await this.driver.executeScript((cardIndex) => {
                const cards = Array.from(document.querySelectorAll(".product-item-card"));
                const card = cards[cardIndex];
                if (!card) return false;

                const candidates = [
                    card.querySelector(".content-section > div[style*='cursor']"),
                    card.querySelector(".image-section > div[style*='cursor']"),
                    card.querySelector(".content-section"),
                    card.querySelector(".image-section")
                ].filter(Boolean);

                const target = candidates[0];
                if (!target) return false;

                target.scrollIntoView({ behavior: "instant", block: "center" });
                target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
                return true;
            }, selected.index).catch(() => false);

            if (!clicked) {
                lastError = `iPhone 17 Pro Max card '${selected.model}' was detected but could not be clicked.`;
                console.log(`    ${lastError}`);
                continue;
            }

            console.log("    CTA clicked: iPhone 17 Pro Max product card");

            const clickHits = await this.captureAdobeWindow("iPhone 17 Pro Max prodClick", {
                timeout: Math.min(this.maxAdobeWait, 30000),
                quietTime: Math.min(this.networkQuietTime, 2500)
            });

            this.recordAction(
                "PRODUCT_CLICK",
                "iPhone 17 Pro Max",
                selected.model,
                clickHits,
                await this.driver.getCurrentUrl()
            );

            try {
                await this.waitForUrlPrefix(this.config.productPdpPrefix, 90000);
            } catch (navigationError) {
                lastError = navigationError.message || String(navigationError);
                console.log(`    Navigation did not reach the expected iPhone 17 Pro Max PDP.`);
                console.log(`    Current URL: ${await this.driver.getCurrentUrl()}`);
                await this.driver.get(this.config.deviceListingPrefix);
                await this.waitForUrlPrefix(this.config.deviceListingPrefix, 90000);
                continue;
            }

            this.currentPageUrl = await this.driver.getCurrentUrl();
            const pdpPage = await this.recordPage("iPhone 17 Pro Max PDP", this.config.productPdpPrefix);

            const outOfStock = await this.isCurrentProductOutOfStock();
            if (outOfStock) {
                console.log(`    OUT OF STOCK: ${selected.model}`);
                this.result.selections.push({
                    type: "Device Availability",
                    value: `${selected.model} - OUT OF STOCK`,
                    url: this.currentPageUrl,
                    attempt
                });

                this.result.actions.push({
                    action: "DEVICE_RETRY",
                    label: "Out of stock - return to PLP",
                    value: selected.model,
                    pageUrl: this.currentPageUrl,
                    timestamp: new Date().toISOString(),
                    adobeHitCount: pdpPage.adobeHitCount,
                    events: pdpPage.eventsFound || [],
                    hits: pdpPage.hits || []
                });

                await this.driver.get(this.config.deviceListingPrefix);
                await this.waitForUrlPrefix(this.config.deviceListingPrefix, 90000);
                await this.waitForPageReady(90000);
                continue;
            }

            console.log(`    IN STOCK: ${selected.model}`);
            console.log(`    PDP URL: ${this.currentPageUrl}`);
            this.result.selections.push({
                type: "Device Availability",
                value: `${selected.model} - IN STOCK`,
                url: this.currentPageUrl,
                attempt
            });

            return;
        }

        throw new Error(
            lastError ||
            `Could not find an in-stock iPhone 17 Pro Max after ${maxAttempts} attempts.`
        );
    }

    async choosePdpOptions() {
        console.log("\n[4] iPhone 17 Pro Max PDP");
        const radioGroups = await this.getRadioGroups();
        let colorGroup = radioGroups.find(g => /color|colour/i.test(g.key));
        let sizeGroup = radioGroups.find(g => /storage|size|capacity|gb/i.test(g.key) && g !== colorGroup);
        const usedGroups = new Set();

        if (colorGroup) {
            await this.selectRadioFromGroup(colorGroup, "Color");
            usedGroups.add(colorGroup.key);
        }
        if (sizeGroup && !usedGroups.has(sizeGroup.key)) {
            await this.selectRadioFromGroup(sizeGroup, "Size/Storage");
            usedGroups.add(sizeGroup.key);
        }

        if (!colorGroup || !sizeGroup) {
            const fallbackGroups = radioGroups.filter(g => !usedGroups.has(g.key) && !/payment|pay|monthly/i.test(g.key));
            if (!colorGroup && fallbackGroups.length) {
                colorGroup = fallbackGroups.shift();
                await this.selectRadioFromGroup(colorGroup, "Color/Variant");
                usedGroups.add(colorGroup.key);
            }
            if (!sizeGroup && fallbackGroups.length) {
                sizeGroup = fallbackGroups.shift();
                await this.selectRadioFromGroup(sizeGroup, "Size/Storage");
                usedGroups.add(sizeGroup.key);
            }
        }

        const paymentChoice = this.paymentOptionPrompt ? await this.paymentOptionPrompt() : "2";
        const payLater = String(paymentChoice).trim() === "1";
        const label = payLater ? "Pay Later - Monthly" : "Pay Today";
        console.log(`    Payment option selected: ${label}`);
        this.result.selections.push({ type: "Payment Option", value: label });

        let paymentOption = null;
        const paymentStart = Date.now();
        while (Date.now() - paymentStart < 60000) {
            try {
                if (payLater) {
                    // Pay Later is represented by the tenure options in the supplied PDP markup.
                    // Select the requested tenure directly instead of searching for a visible
                    // element named "Pay Later - Monthly".
                    const period = String(this.payLaterPeriod || "").trim();
                    if (!["12", "24", "36"].includes(period)) {
                        throw new Error(`Invalid Pay Later period: ${period || "not provided"}. Expected 12, 24, or 36.`);
                    }
                    const periodCandidates = await this.driver.findElements(
                        By.css(`[aa_linktext="${period}-month"]`)
                    );
                    for (const candidate of periodCandidates) {
                        if (await candidate.isDisplayed().catch(() => false)) {
                            paymentOption = candidate;
                            break;
                        }
                    }
                } else {
                    const candidates = await this.driver.findElements(
                        By.css('[aa_linktext="Pay today"], .shop-option.paymentoption-selection-option')
                    );
                    for (const candidate of candidates) {
                        try {
                            if (!(await candidate.isDisplayed())) continue;
                            const candidateText = (await candidate.getText()).replace(/\s+/g, " ").trim().toLowerCase();
                            const linkText = ((await candidate.getAttribute("aa_linktext")) || "").trim().toLowerCase();
                            if (linkText === "pay today" || candidateText === "pay today" || candidateText.includes("pay today")) {
                                paymentOption = candidate;
                                break;
                            }
                        } catch (_) {}
                    }
                }
            } catch (_) {}
            if (paymentOption) break;
            await this.sleep(500);
        }

        if (!paymentOption) {
            const missingLabel = payLater
                ? `${label} (${this.payLaterPeriod || "36"}-month)`
                : label;
            throw new Error(`Payment option '${missingLabel}' was not found on PDP.`);
        }

        console.log(`    Payment option found on PDP: ${label}`);
        await this.drainPerformanceLogs();
        await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", paymentOption);
        await this.sleep(500);
        try {
            await paymentOption.click();
        } catch (_) {
            await this.driver.executeScript("arguments[0].click();", paymentOption);
        }

        console.log(`    Payment selection clicked: ${label}`);
        const paymentHits = await this.captureAdobeWindow("Payment option selection", {
            timeout: Math.min(this.maxAdobeWait, 30000),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });
        this.recordAction("OPTION", "Payment Option", label, paymentHits, await this.driver.getCurrentUrl());
        console.log("    Payment selection recorded. Looking for PDP Next CTA...");

        const nextStart = Date.now();
        let nextButton = null;
        while (Date.now() - nextStart < 60000) {
            try {
                const candidates = await this.driver.findElements(By.css("#b5-b16-NextCTA button"));
                for (const button of candidates) {
                    try {
                        if (!(await button.isDisplayed()) || !(await button.isEnabled())) continue;
                        const ariaDisabled = (await button.getAttribute("aria-disabled")) || "";
                        const disabled = await button.getAttribute("disabled");
                        if (disabled !== null || ariaDisabled.toLowerCase() === "true") continue;
                        const text = (await button.getText()).replace(/\s+/g, " ").trim();
                        if (/^next$/i.test(text) || /\bnext\b/i.test(text)) {
                            nextButton = button;
                            break;
                        }
                    } catch (_) {}
                }
            } catch (_) {}
            if (nextButton) break;
            await this.sleep(500);
        }

        if (!nextButton) {
            throw new Error("Next CTA was not found or did not become enabled on the iPhone PDP within 60 seconds.");
        }

        const nextOuterHTML = await nextButton.getAttribute("outerHTML").catch(() => "");
        const nextText = (await nextButton.getText()).replace(/\s+/g, " ").trim();
        const nextId = (await nextButton.getAttribute("id")) || "";
        const nextClass = (await nextButton.getAttribute("class")) || "";

        console.log(`    PDP CTA found: ${nextText || "Next"}`);
        console.log(`    Next CTA selector: #b5-b16-NextCTA button`);
        console.log(`    Next CTA outerHTML captured: ${nextOuterHTML ? "YES" : "NO"}`);

        this.result.selections.push({
            type: "PDP Next CTA",
            value: nextText || "Next",
            selector: "#b5-b16-NextCTA button",
            id: nextId,
            className: nextClass,
            outerHTML: nextOuterHTML,
            pageUrl: await this.driver.getCurrentUrl()
        });

        await this.drainPerformanceLogs();
        await this.clickElement(nextButton, "Next - iPhone");

        const nextHits = await this.captureAdobeWindow("Next - iPhone / scAdd", {
            timeout: Math.min(this.maxAdobeWait, 30000),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });

        const scAddHits = nextHits.filter(hit =>
            (hit.events || []).some(event => /^scAdd$/i.test(String(event))) ||
            (hit.eventDetails || []).some(event => /^scAdd$/i.test(String(event.name)))
        );

        const latestHit = nextHits.length ? nextHits[nextHits.length - 1] : null;
        const latestHitHasScAdd = !!latestHit && (
            (latestHit.events || []).some(event => /^scAdd$/i.test(String(event))) ||
            (latestHit.eventDetails || []).some(event => /^scAdd$/i.test(String(event.name)))
        );

        const nextAction = this.recordAction(
            "CTA",
            "Next - iPhone",
            label,
            nextHits,
            await this.driver.getCurrentUrl()
        );

        nextAction.nextCta = {
            selector: "#b5-b16-NextCTA button",
            text: nextText || "Next",
            id: nextId,
            className: nextClass,
            outerHTML: nextOuterHTML
        };
        nextAction.scAddCaptured = scAddHits.length > 0;
        nextAction.scAddHitCount = scAddHits.length;
        nextAction.latestHitHasScAdd = latestHitHasScAdd;
        nextAction.scAddHits = scAddHits;

        this.result.selections.push({
            type: "PDP scAdd Validation",
            value: scAddHits.length ? "scAdd captured" : "scAdd not captured",
            scAddCaptured: scAddHits.length > 0,
            scAddHitCount: scAddHits.length,
            latestHitHasScAdd,
            hits: scAddHits
        });

        console.log(`    Next CTA clicked. Adobe /b/ss hits captured: ${nextHits.length}`);
        console.log(`    scAdd captured from Next CTA flow: ${scAddHits.length > 0 ? "YES" : "NO"}`);

        await this.waitForUrlPrefix(this.config.intentPrefix, 90000);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Intent Selection", this.config.intentPrefix);
    }

    async getRadioGroups() {
        const radios = await this.driver.findElements(By.css("input[type='radio']"));
        const groups = new Map();
        for (const radio of radios) {
            try {
                if (!(await radio.isDisplayed()) || !(await radio.isEnabled())) continue;
                const name = (await radio.getAttribute("name")) || "";
                const id = (await radio.getAttribute("id")) || "";
                const key = `${name}|${id}` || `radio-${groups.size}`;
                const label = await this.findRadioLabel(radio);
                if (!label) continue;
                const groupKey = name || (await radio.getAttribute("data-group")) || id || key;
                if (!groups.has(groupKey)) groups.set(groupKey, []);
                groups.get(groupKey).push({ radio, label });
            } catch (_) {}
        }
        return [...groups.entries()].map(([key, options]) => ({ key, options }));
    }

    async findRadioLabel(radio) {
        const id = await radio.getAttribute("id").catch(() => "");
        if (id) {
            const labels = await this.driver.findElements(By.css(`label[for="${id.replace(/"/g, '\\"')}"]`));
            if (labels.length) return this.textOf(labels[0]);
        }
        return this.driver.executeScript("return arguments[0].parentElement ? arguments[0].parentElement.innerText : '';", radio)
            .then(x => String(x || "").replace(/\s+/g, " ").trim())
            .catch(() => "");
    }

    async selectRadioFromGroup(group, type) {
        const selected = group.options[Math.floor(Math.random() * group.options.length)];
        const value = selected.label;
        console.log(`    Selected ${type}: ${value}`);
        this.result.selections.push({ type, value });
        await this.drainPerformanceLogs();
        await this.clickElement(selected.radio, `${type} - ${value}`);
        const hits = await this.captureAdobeWindow(`${type} selection`);
        this.recordAction("OPTION", type, value, hits, await this.driver.getCurrentUrl());
    }

    async findOptionCandidates(keywords) {
        const elements = await this.visibleElements(By.xpath("//*[self::label or self::button or @role='button']"));
        const out = [];
        for (const el of elements) {
            const text = (await this.textOf(el)).toLowerCase();
            const cls = (await el.getAttribute("class").catch(() => ""))?.toLowerCase() || "";
            const attrText = `${text} ${cls}`;
            if (!attrText.trim()) continue;
            if (keywords.some(k => attrText.includes(k))) out.push(el);
        }
        return out.filter((el, i, arr) => arr.findIndex(x => x === el) === i).slice(0, 30);
    }

    async getPdpNextCta() {
        const start = Date.now();
        while (Date.now() - start < 60000) {
            try {
                const byContainer = await this.driver.findElements(By.css("#b5-b16-NextCTA button"));
                for (const element of byContainer) {
                    if (!(await element.isDisplayed()) || !(await element.isEnabled())) continue;
                    const text = (await this.textOf(element)).toLowerCase();
                    if (text === "next" || text.includes("next")) return element;
                }
            } catch (_) {}
            try {
                const fallback = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][normalize-space(.)='Next' or contains(normalize-space(.),'Next')]")).then(x => x[0]);
                if (fallback) return fallback;
            } catch (_) {}
            await this.sleep(500);
        }
        return null;
    }

    async getOuterHTML(element) {
        try {
            return await this.driver.executeScript("return arguments[0].outerHTML;", element);
        } catch (_) {
            return "";
        }
    }

    async clickNextToIntent() {
        const next = await this.getPdpNextCta();
        if (!next) throw new Error("Next CTA was not found after iPhone PDP/payment selection.");

        const nextOuterHTML = await this.getOuterHTML(next);
        const nextText = await this.textOf(next);
        const nextId = await next.getAttribute("id").catch(() => "");
        const nextClass = await next.getAttribute("class").catch(() => "");

        console.log(`    PDP Next CTA found: ${nextText || "Next"}`);
        console.log(`    PDP Next CTA id: ${nextId || "N/A"}`);
        console.log(`    PDP Next CTA outerHTML captured: ${nextOuterHTML ? "YES" : "NO"}`);

        await this.drainPerformanceLogs();
        await this.clickElement(next, "Next - iPhone");

        const hits = await this.captureAdobeWindow("Next to Intent - scAdd", {
            timeout: Math.min(this.maxAdobeWait, 30000),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });

        const scAddHits = hits.filter(hit => hit.events.some(event => /^scadd$/i.test(event)));
        const scAddCaptured = scAddHits.length > 0;
        const latestHit = hits.length ? hits[hits.length - 1] : null;
        const latestHitHasScAdd = !!(latestHit && latestHit.events.some(event => /^scadd$/i.test(event)));

        const action = this.recordAction("CTA", "Next - iPhone", "", hits, await this.driver.getCurrentUrl());
        action.outerHTML = nextOuterHTML;
        action.element = {
            tagName: "BUTTON",
            id: nextId || "",
            className: nextClass || "",
            text: nextText || "Next"
        };
        action.expectedEvent = "scAdd";
        action.scAddCaptured = scAddCaptured;
        action.latestHitHasScAdd = latestHitHasScAdd;
        action.scAddHitCount = scAddHits.length;
        action.scAddHits = scAddHits;

        this.result.selections.push({
            type: "PDP Next CTA",
            value: nextText || "Next",
            outerHTML: nextOuterHTML,
            scAddCaptured,
            latestHitHasScAdd,
            scAddHitCount: scAddHits.length
        });

        console.log(`    b/ss hits captured after PDP Next: ${hits.length}`);
        console.log(`    scAdd captured: ${scAddCaptured ? "YES" : "NO"}`);
        console.log(`    Latest b/ss hit contains scAdd: ${latestHitHasScAdd ? "YES" : "NO"}`);

        if (!scAddCaptured) {
            console.log("    WARNING: PDP Next CTA was clicked, but no captured b/ss hit contained scAdd.");
        }

        await this.waitForUrlPrefix(this.config.intentPrefix);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Intent Selection", this.config.intentPrefix);
    }

    async findClickableByText(text, timeout = 60000) {
        const target = String(text || '').trim();
        const start = Date.now();
        while (Date.now() - start < timeout) {
            try {
                const xpath = `//*[self::button or self::a or @role='button' or self::label][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),${JSON.stringify(target.toLowerCase())})]`;
                const elements = await this.visibleElements(By.xpath(xpath));
                if (elements.length) return elements[0];
            } catch (_) {}
            await this.sleep(500);
        }
        return null;
    }

    async getNextCtaOnCurrentPage(timeout = 60000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            try {
                const candidates = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][normalize-space(.)='Next' or contains(normalize-space(.),'Next') or contains(normalize-space(.),'Continue') or contains(normalize-space(.),'Proceed')]")).then(x => x.slice(0, 20));
                for (const element of candidates) {
                    const text = await this.textOf(element);
                    if (/^(next|continue|proceed)(\b|\s)/i.test(text) || /\bnext\b/i.test(text)) return element;
                }
            } catch (_) {}
            await this.sleep(500);
        }
        return null;
    }

    async chooseIntent() {
        console.log("\n[5] Signup for New / Select Line");
        await this.waitForPageReady(90000);
        this.currentPageUrl = await this.driver.getCurrentUrl();

        const maxLineMessage = await this.driver.findElements(By.xpath("//*[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'reached the maximum of mobile lines allowed by imda')]")).then(async elements => {
            for (const element of elements) if (await element.isDisplayed().catch(() => false)) return element;
            return null;
        }).catch(() => null);

        if (maxLineMessage) {
            console.log("    Maximum mobile-line limit detected. Selecting a random existing StarHub number.");
            const options = await this.visibleElements(By.css(".number-selection-option"));
            if (!options.length) throw new Error("Maximum mobile-line limit displayed, but no existing StarHub number options were found.");
            const selected = options[Math.floor(Math.random() * options.length)];
            const value = await this.textOf(selected);
            this.result.selections.push({ type: "Existing StarHub Number", value: value || "Random existing StarHub number", outerHTML: await this.getOuterHTML(selected), pageUrl: this.currentPageUrl });
            await this.drainPerformanceLogs();
            await this.clickElement(selected, "Random existing StarHub number");
            const hits = await this.captureAdobeWindow("Existing StarHub number selection", { timeout: Math.min(this.maxAdobeWait, 30000), quietTime: Math.min(this.networkQuietTime, 2500) });
            this.recordAction("OPTION", "Existing StarHub Number", value, hits, await this.driver.getCurrentUrl());
        } else {
            const signup = await this.driver.wait(async () => {
                try {
                    const elements = await this.driver.findElements(By.xpath("//div[contains(@class,'number-card-detail_v2')][.//span[normalize-space()='Sign up for a new line']]") );
                    for (const element of elements) if (await element.isDisplayed()) return element;
                } catch (_) {}
                return false;
            }, 60000);
            if (!signup) throw new Error("'Sign up for a new line' option was not found on the Intent Selection page.");
            const value = await this.textOf(signup);
            this.result.selections.push({ type: "Intent", value, outerHTML: await this.getOuterHTML(signup), pageUrl: this.currentPageUrl });
            await this.drainPerformanceLogs();
            if (!/\bselected\b/i.test(await signup.getAttribute("class").catch(() => ""))) await this.clickElement(signup, "Sign up for a new line");
            const hits = await this.captureAdobeWindow("Signup for new selection", { timeout: Math.min(this.maxAdobeWait, 30000), quietTime: Math.min(this.networkQuietTime, 2500) });
            this.recordAction("OPTION", "Sign up for a new line", value, hits, await this.driver.getCurrentUrl());
        }

        const next = await this.getNextCtaOnCurrentPage(60000);
        if (!next) throw new Error("Next CTA was not found after intent/existing-number selection.");
        const nextText = await this.textOf(next);
        this.result.selections.push({ type: "Intent Next CTA", value: nextText || "Next", outerHTML: await this.getOuterHTML(next), pageUrl: this.currentPageUrl });
        await this.drainPerformanceLogs();
        await this.clickElement(next, "Next - Intent Selection");
        const nextHits = await this.captureAdobeWindow("Intent Next CTA", { timeout: Math.min(this.maxAdobeWait, 30000), quietTime: Math.min(this.networkQuietTime, 2500) });
        this.recordAction("CTA", "Next - Intent Selection", nextText || "Next", nextHits, await this.driver.getCurrentUrl());
    }

    async chooseStarPlan() {
        console.log("\n[6] Mobile Plan Selection");

        const card = await this.driver.wait(async () => {
            try {
                const cards = await this.visibleElements(By.css(".sn-plan-card"));
                for (const c of cards) {
                    const text = await this.textOf(c);
                    if (/5G Unlimited\+ Plus/i.test(text)) return c;
                }
            } catch (_) {}
            return false;
        }, 60000);

        if (!card) throw new Error("Mobile plan card '5G Unlimited+ Plus' was not found.");

        const cardText = await this.textOf(card);
        const cardHTML = await card.getAttribute("outerHTML");
        console.log("    Mobile plan found: 5G Unlimited+ Plus");
        console.log("    Plan card outerHTML captured: " + (cardHTML ? "YES" : "NO"));

        const selectPlan = await card.findElements(By.xpath(".//button[.//span[normalize-space()='Select plan'] or normalize-space()='Select plan']"));
        if (!selectPlan.length) throw new Error("'Select plan' CTA was not found inside the 5G Unlimited+ Plus plan card.");

        const cta = selectPlan[0];
        const ctaHTML = await cta.getAttribute("outerHTML");
        console.log("    Select plan CTA outerHTML captured: " + (ctaHTML ? "YES" : "NO"));

        this.result.selections.push({
            type: "Mobile Plan",
            value: "5G Unlimited+ Plus"
        });

        await this.drainPerformanceLogs();
        await this.clickElement(cta, "Select plan - 5G Unlimited+ Plus");

        const hits = await this.captureAdobeWindow("Mobile Plan Select plan", {
            timeout: Math.min(this.maxAdobeWait, 30000),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });

        this.recordAction("CTA", "Select plan", "5G Unlimited+ Plus", hits, await this.driver.getCurrentUrl());
        console.log("    Select plan clicked. Adobe /b/ss hits captured: " + hits.length);

        await this.waitForUrlPrefix(this.config.simPrefix, 90000);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("SIM Selection Popup", this.config.simPrefix);
        console.log("    Landed on SIM Selection page: " + this.currentPageUrl);
    }

    async chooseSim() {
        console.log("\n[7] SIM Selection Popup");

        const requestedSim = String(this.simType || "").trim().toLowerCase();
        if (!requestedSim) {
            throw new Error("SIM type was not provided at journey start. Please select eSIM or Physical SIM.");
        }

        const wantsEsim = requestedSim === "1" || requestedSim === "esim" || requestedSim === "e-sim";
        const wantsPhysical = requestedSim === "2" || requestedSim === "physical sim" || requestedSim === "physical-sim" || requestedSim === "physical";
        if (!wantsEsim && !wantsPhysical) {
            throw new Error(`Invalid SIM type provided at journey start: '${this.simType}'. Expected eSIM or Physical SIM.`);
        }

        await this.driver.wait(async () => {
            const title = await this.driver.findElements(By.xpath("//*[contains(@class,'overlay-modal-title') and contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'select your choice of sim')]")).catch(() => []);
            const radios = await this.driver.findElements(By.css("input[type='radio'][id*='eSIM'], input[type='radio'][id*='PhysicalSIM']")).catch(() => []);
            return title.length > 0 || radios.length > 0;
        }, 60000, "SIM selection popup did not appear");

        const selectedOption = wantsEsim
            ? { value: "eSIM", container: "#b3-b1-b2-eSim_Container", radio: "#b3-b1-b2-eSIM-input" }
            : { value: "Physical SIM", container: "#b3-b1-b2-PhysicalSIM_Container", radio: "#b3-b1-b2-PhysicalSIM-input" };

        let selectedRadio = (await this.driver.findElements(By.css(selectedOption.radio)).catch(() => []))[0];
        if (!selectedRadio) {
            const labelText = wantsEsim ? "eSIM" : "Physical SIM";
            const fallback = await this.driver.findElements(By.xpath(`//input[@type='radio' and (contains(@id,'eSIM') or contains(@id,'PhysicalSIM'))][ancestor::*[contains(normalize-space(.),'${labelText}')]]`)).catch(() => []);
            selectedRadio = fallback[0];
        }
        if (!selectedRadio) {
            throw new Error(`SIM option '${selectedOption.value}' was not found in the SIM Selection popup.`);
        }

        console.log(`    SIM option requested at journey start: ${selectedOption.value}`);
        await this.drainPerformanceLogs();
        const alreadySelected = await selectedRadio.isSelected().catch(() => false);
        if (!alreadySelected) {
            const containers = await this.driver.findElements(By.css(selectedOption.container)).catch(() => []);
            if (containers.length) {
                await this.driver.executeScript("arguments[0].scrollIntoView({block:'center'});", containers[0]).catch(() => {});
                await this.driver.executeScript("arguments[0].click();", containers[0]).catch(() => {});
            } else {
                await this.driver.executeScript("arguments[0].click();", selectedRadio).catch(() => {});
            }
        }

        await this.driver.wait(async () => await selectedRadio.isSelected().catch(() => false), 15000, `SIM option '${selectedOption.value}' was not selected`);
        console.log(`    SIM selected: ${selectedOption.value}`);
        this.result.selections.push({ type: "SIM", value: selectedOption.value });

        const simHits = await this.captureAdobeWindow("SIM selection", { waitMs: 5000, drainBefore: false });
        this.recordAction("POPUP_OPTION", "SIM", selectedOption.value, simHits, await this.driver.getCurrentUrl());
        console.log("    SIM selection recorded. Adobe /b/ss hits captured: " + simHits.length);

        const nextXPath = "//div[contains(@class,'overlay-modal-footer')]//button[.//div[normalize-space()='Next'] or normalize-space()='Next']";
        await this.driver.wait(async () => {
            const buttons = await this.driver.findElements(By.xpath(nextXPath)).catch(() => []);
            return buttons.length > 0 && await buttons[0].isEnabled().catch(() => false);
        }, 30000, "SIM selection Next CTA did not become enabled after selecting the SIM option");

        const next = (await this.driver.findElements(By.xpath(nextXPath)))[0];
        console.log("    Next CTA found: Next");
        await this.drainPerformanceLogs();
        await this.clickElement(next, "Next - SIM Selection");
        const nextHits = await this.captureAdobeWindow("SIM Selection Next");
        this.recordAction("CTA", "Next", "SIM Selection", nextHits, await this.driver.getCurrentUrl());
        console.log("    SIM Next clicked. Adobe /b/ss hits captured: " + nextHits.length);

        await this.waitForUrlPrefix(this.config.suggestionPrefix, 90000);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Security / Add-ons", this.config.suggestionPrefix);
    }

    async chooseSecurityAndWatch() {
    console.log("\n[8] Security / Add-ons");

    const watchText = "Watch S11 46mm AL";
    const watchCardXPath = "//div[contains(@class,'product-item-card')][.//*[normalize-space()='Watch S11 46mm AL']]";
    let watch = null;
    const watchStart = Date.now();

    while (Date.now() - watchStart < 30000) {
        try {
            const candidates = await this.visibleElements(By.xpath(watchCardXPath));
            if (candidates.length) {
                watch = candidates[0];
                break;
            }
        } catch (_) {}
        await this.sleep(500);
    }

    if (!watch) throw new Error("Watch S11 46mm AL upsell was not found.");

    console.log("    Upsell found: Watch S11 46mm AL");
    this.result.selections.push({ type: "Upsell", value: watchText });
    await this.drainPerformanceLogs();
    await this.clickElement(watch, watchText);

    const watchClickHits = await this.captureAdobeWindow("Watch upsell click");
    this.recordAction("CTA", watchText, watchText, watchClickHits, await this.driver.getCurrentUrl());

    await this.waitForUrlPrefix(this.config.watchPrefix, 90000);
    this.currentPageUrl = await this.driver.getCurrentUrl();
    await this.recordPage("Watch S11 46mm AL PDP", this.config.watchPrefix);
    console.log("    Watch PDP loaded.");

    const addToCartXPath = "//button[contains(@class,'add-to-cart-button')][.//span[normalize-space()='Add to cart']]";
    let addToCart = null;
    const addToCartStart = Date.now();

    while (Date.now() - addToCartStart < 30000) {
        try {
            const candidates = await this.visibleElements(By.xpath(addToCartXPath));
            for (const candidate of candidates) {
                const text = (await this.textOf(candidate)).replace(/\s+/g, " ").trim().toLowerCase();
                if (text === "add to cart") {
                    addToCart = candidate;
                    break;
                }
            }
            if (addToCart) break;
        } catch (_) {}
        await this.sleep(500);
    }

    if (!addToCart) throw new Error("Add to cart CTA was not found on Watch PDP.");
    console.log("    Add to cart CTA found. Pay Today is already selected.");

    await this.drainPerformanceLogs();
    await this.clickElement(addToCart, "Add to cart - Watch");
    const addToCartHits = await this.captureAdobeWindow("Watch Add to cart");
    this.recordAction("CTA", "Add to cart", watchText, addToCartHits, await this.driver.getCurrentUrl());
    console.log("    Add to cart clicked. Adobe /b/ss hits captured: " + addToCartHits.length);

    await this.waitForUrlPrefix(this.config.suggestionPrefix, 90000);
    this.currentPageUrl = await this.driver.getCurrentUrl();
    await this.recordPage("Security / Add-ons", this.config.suggestionPrefix);
    console.log("    Returned to Security / Add-ons.");

    const securityCardsXPath = "//div[contains(@class,'protection-item')][.//input[@type='checkbox']]";
    let securityCards = [];
    const securityStart = Date.now();

    while (Date.now() - securityStart < 60000) {
        try {
            securityCards = await this.visibleElements(By.xpath(securityCardsXPath));
            if (securityCards.length >= 2) break;
        } catch (_) {}
        await this.sleep(500);
    }

    if (securityCards.length < 2) {
        throw new Error("Could not find at least two security/add-on products from the provided protection-item structure.");
    }

    const securityOptions = [];
    for (const card of securityCards) {
        try {
            const checkbox = (await card.findElements(By.css("input[type='checkbox']")))[0];
            if (!checkbox) continue;

            const nameElements = await card.findElements(
                By.xpath(".//span[contains(@class,'fw-bold') and @data-expression]")
            ).catch(() => []);

            let label = "";
            if (nameElements.length) label = await this.textOf(nameElements[0]);
            if (!label) {
                const text = await this.textOf(card);
                label = text.split(/\$|\d+\.\d{2}/)[0].replace(/\s+/g, " ").trim();
            }
            if (!label) continue;

            securityOptions.push({ element: card, checkbox, text: label });
        } catch (_) {}
    }

    if (securityOptions.length < 2) {
        throw new Error("Could not identify at least two security/add-on products.");
    }

    const selectedSecurity = securityOptions
        .sort(() => Math.random() - 0.5)
        .slice(0, 2);

    console.log("    Selecting 2 random Security / Add-on products after returning from Watch PDP.");

    for (const item of selectedSecurity) {
        const label = item.text;
        await this.drainPerformanceLogs();

        await this.driver.executeScript(
            "arguments[0].scrollIntoView({block:'center',inline:'center'});",
            item.checkbox
        ).catch(() => {});
        await this.sleep(300);

        const alreadySelected = await item.checkbox.isSelected().catch(() => false);
        if (!alreadySelected) {
            try {
                await item.checkbox.click();
            } catch (_) {
                await this.driver.executeScript("arguments[0].click();", item.checkbox).catch(() => {});
            }
        }

        await this.sleep(500);
        console.log(`    Security option selected: ${label}`);

        const hits = await this.captureAdobeWindow("Security selection");
        this.result.selections.push({ type: "Security Add-on", value: label });
        this.recordAction("OPTION", "Security Add-on", label, hits, await this.driver.getCurrentUrl());
    }

    await this.sleep(1500);

    let continueCta = null;
    const continueStart = Date.now();
    const continueXPath = "//div[contains(@class,'grid-content-10columns')]//button[contains(@class,'skip-button') and contains(@class,'btn-primary')][.//span[normalize-space()='Continue']]";

    while (Date.now() - continueStart < 30000) {
        try {
            const candidates = await this.driver.findElements(By.xpath(continueXPath));
            for (const candidate of candidates) {
                try {
                    if (await candidate.isDisplayed() && await candidate.isEnabled()) {
                        continueCta = candidate;
                        break;
                    }
                } catch (_) {}
            }
            if (continueCta) break;
        } catch (_) {}
        await this.sleep(500);
    }

    if (!continueCta) throw new Error("Security / Add-ons Continue CTA was not found after selecting security products.");

    console.log("    Continue CTA found.");

    await this.driver.executeScript(
        "arguments[0].scrollIntoView({block:'center',inline:'center'});",
        continueCta
    ).catch(() => {});
    await this.sleep(500);
    await this.drainPerformanceLogs();

    try {
        await continueCta.click();
    } catch (_) {
        await this.driver.executeScript("arguments[0].click();", continueCta);
    }

    const continueHits = await this.captureAdobeWindow("Security / Add-ons Continue");
    this.recordAction("CTA", "Continue", "Security / Add-ons", continueHits, await this.driver.getCurrentUrl());
    console.log("    Security Continue clicked. Adobe /b/ss hits captured: " + continueHits.length);

    await this.waitForUrlPrefix(this.config.reviewOrderPrefix, 90000);
    this.currentPageUrl = await this.driver.getCurrentUrl();
    await this.recordPage("Review Order / Cart", this.config.reviewOrderPrefix);

    const cartViewStart = Date.now();
    let cartViewHits = [];
    while (Date.now() - cartViewStart < 15000) {
        const hits = await this.captureAdobeWindow("Cart View", { waitMs: 1000, drainBefore: false });
        const matchingHits = hits.filter(hit =>
            (hit.events || []).some(event => /cart.?view|scview/i.test(String(event)))
        );
        if (matchingHits.length) {
            cartViewHits = matchingHits;
            break;
        }
        await this.sleep(500);
    }

    if (cartViewHits.length) {
        const cartViewEvents = [...new Set(cartViewHits.flatMap(hit => hit.events || []))];
        this.recordAction("EVENT", "Cart View", "Review Order / Cart", cartViewHits, await this.driver.getCurrentUrl());
        console.log("    Cart View event captured: " + cartViewEvents.join(", "));
    } else {
        console.log("    Cart View event was not captured after landing on Review Order / Cart.");
    }
}

    async chooseMobileNumber() {
        console.log("\n[9] Cart Page – Proceed to Checkout CTA Validation");
        const next = await this.visibleElements(By.xpath("//button[@id='b3-BtnCheckoutWeb']")).then(x => x[0]);
        if (next) {
            await this.drainPerformanceLogs();
            await this.clickElement(next, "Proceed to checkout");
            const hits = await this.captureAdobeWindow("Proceed to checkout");
            const checkoutStartHits = hits.filter(hit =>
                (hit.events || []).some(event => /checkout.?start|sccheckout/i.test(String(event)))
            );
            this.recordAction("CTA", "Proceed to checkout", "", hits, await this.driver.getCurrentUrl());
            if (checkoutStartHits.length) {
                const checkoutStartEvents = [...new Set(checkoutStartHits.flatMap(hit => hit.events || []))];
                this.recordAction("EVENT", "Checkout Start", "Proceed to checkout", checkoutStartHits, await this.driver.getCurrentUrl());
                console.log("    Checkout Start event captured: " + checkoutStartEvents.join(", "));
            } else {
                console.log("    Checkout Start event was not captured after Proceed to checkout.");
            }
        } else {
            await this.driver.get(this.config.mobileNumberPrefix);
        }
        // Wait for the actual checkout page transition before searching for number cards.
        await this.waitForUrlPrefix(this.config.mobileNumberPrefix, 90000);
        await this.driver.wait(
            until.urlContains("/personal/checkout/your-mobile-number"),
            90000,
            "Your Mobile Number page was not reached after Proceed to checkout."
        );
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Checkout - Mobile Number", this.config.mobileNumberPrefix);
        console.log("    Mobile Number pageLoad recorded: " + this.currentPageUrl);

        const numberOptionsXPath = "//div[contains(@class,'number-selection-option')]";
        let numberOptions = [];
        const numberWaitStart = Date.now();
        while (Date.now() - numberWaitStart < 30000) {
            try {
                const candidates = await this.driver.findElements(By.xpath(numberOptionsXPath));
                numberOptions = [];
                for (const candidate of candidates) {
                    try {
                        if (await candidate.isDisplayed()) numberOptions.push(candidate);
                    } catch (_) {}
                }
                if (numberOptions.length) break;
            } catch (_) {}
            await this.sleep(500);
        }
        if (!numberOptions.length) throw new Error("No mobile number options were found after waiting for the page to render.");

        const selected = numberOptions[Math.floor(Math.random() * numberOptions.length)];
        const value = await this.textOf(selected);

        await this.driver.executeScript(
            "arguments[0].scrollIntoView({block:'center',inline:'center'});",
            selected
        ).catch(() => {});
        await this.drainPerformanceLogs();
        await this.clickElement(selected, `Mobile Number - ${value}`);

        console.log(`    Mobile number selected: ${value}`);
        this.result.selections.push({ type: "Mobile Number", value });

        const hits = await this.captureAdobeWindow("Mobile number selection");
        this.recordAction("OPTION", "Mobile Number", value, hits, await this.driver.getCurrentUrl());

        const cont = await this.driver.wait(
            until.elementLocated(By.xpath("//button[contains(@class,'add-plan-btn')][.//span[normalize-space()='Next']]")),
            this.timeout
        );

        await this.driver.wait(
            async () => {
                const disabled = await cont.getAttribute("disabled");
                return !disabled && await cont.isEnabled();
            },
            this.timeout,
            "Next CTA remained disabled after mobile number selection."
        );

        await this.drainPerformanceLogs();
        await this.clickElement(cont, "Next - Mobile Number");
        const nextHits = await this.captureAdobeWindow("Next after mobile number");
        this.recordAction("CTA", "Next - Mobile Number", "", nextHits, await this.driver.getCurrentUrl());
        await this.waitForUrlPrefix(this.config.reviewDetailPrefix);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Checkout - Review Detail", this.config.reviewDetailPrefix);
    }

    async deliveryFlow() {
        console.log("\n[10] Delivery + Date/Time Popup");

        await this.driver.wait(
            async () => {
                try {
                    return await this.driver.executeScript("return document.readyState === 'complete';");
                } catch (_) {
                    return false;
                }
            },
            60000,
            "Review Detail page did not finish loading."
        );

        await this.driver.wait(
            until.elementLocated(By.xpath("//*[normalize-space()='Select delivery options and review']")),
            60000,
            "Delivery section did not render on Review Detail page."
        );

        const standardInputXPath = "//input[@type='radio' and @value='standard_delivery']";
        let standardInput = null;
        const deliveryStart = Date.now();
        while (Date.now() - deliveryStart < 60000) {
            try {
                const inputs = await this.driver.findElements(By.xpath(standardInputXPath));
                for (const input of inputs) {
                    if (await input.isDisplayed()) {
                        standardInput = input;
                        break;
                    }
                }
                if (standardInput) break;
            } catch (_) {}
            await this.sleep(1000);
        }
        if (!standardInput) throw new Error("Standard delivery option was not found after waiting for the Review Detail page to render.");

        const standardOption = await standardInput.findElement(
            By.xpath("ancestor::div[contains(@class,'delivery-available-item')][1]")
        );
        await this.driver.executeScript(
            "arguments[0].scrollIntoView({block:'center',inline:'center'});",
            standardOption
        ).catch(() => {});
        await this.drainPerformanceLogs();
        await this.clickElement(standardOption, "Standard Delivery");
        const standardHits = await this.captureAdobeWindow("Standard delivery selection");
        this.recordAction("POPUP_OPTION", "Delivery", "Standard Delivery", standardHits, await this.driver.getCurrentUrl());

        // Wait for the Standard Delivery popup/interface to render.
        await this.driver.wait(
            until.elementLocated(By.xpath("//*[normalize-space()='Select an address']")),
            60000,
            "Standard delivery address interface did not render."
        );

        const selectedAddress = await this.driver.wait(
            until.elementLocated(By.css("input[type='radio'][name*='rdo_Address'][checked], input[type='radio'][value][checked]")),
            60000,
            "No pre-selected delivery address was found."
        );
        if (!(await selectedAddress.isSelected().catch(() => false))) {
            await this.driver.executeScript("arguments[0].click();", selectedAddress);
        }
        console.log("    Existing delivery address is selected.");

        const dateCta = await this.driver.wait(
            until.elementLocated(By.xpath("//button[.//*[normalize-space()='Next, select date & time'] or normalize-space()='Next, select date & time']")),
            60000,
            "'Next, select date & time' CTA was not found."
        );
        await this.driver.wait(async () => await dateCta.isDisplayed() && await dateCta.isEnabled(), 30000);
        await this.drainPerformanceLogs();
        await this.clickElement(dateCta, "Next, select date & time");
        const dateOpenHits = await this.captureAdobeWindow("Delivery date popup");
        this.recordAction("CTA", "Next, select date & time", "", dateOpenHits, await this.driver.getCurrentUrl());

        await this.driver.wait(
            until.elementLocated(By.css("[popupnameattribute='Delivery Timeslot']")),
            60000,
            "Delivery Timeslot popup did not open."
        );
        await this.driver.wait(
            until.elementLocated(By.css("select[id*='dd_DeliveryDate']")),
            60000,
            "Delivery date dropdown was not found."
        );

        const target = new Date();
        target.setHours(0, 0, 0, 0);
        target.setDate(target.getDate() + 2);
        const targetDateLabel = target.toLocaleDateString("en-US", {
            day: "numeric",
            month: "long",
            year: "numeric"
        });

        const dateSelect = await this.driver.findElement(By.css("select[id*='dd_DeliveryDate']"));
        const dateResult = await this.driver.executeScript(`
    const select = arguments[0];
    const target = new Date(arguments[1]);
    const day = String(target.getDate());
    const month = target.toLocaleDateString('en-US', { month: 'long' });
    const year = String(target.getFullYear());
    const wantedDayFirst = (day + ' ' + month + ' ' + year).toLowerCase();
    const wantedMonthFirst = (month + ' ' + day + ', ' + year).toLowerCase();
    const isoDate = year + '-' + String(target.getMonth() + 1).padStart(2, '0') + '-' + String(target.getDate()).padStart(2, '0');
    let index = -1;
    for (let i = 0; i < select.options.length; i++) {
        const option = select.options[i];
        const text = String(option.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const value = String(option.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (
            text.includes(wantedDayFirst) ||
            text.includes(wantedMonthFirst) ||
            value.includes(isoDate)
        ) {
            index = i;
            break;
        }
        const parsed = new Date(text);
        if (
            !Number.isNaN(parsed.getTime()) &&
            parsed.getFullYear() === target.getFullYear() &&
            parsed.getMonth() === target.getMonth() &&
            parsed.getDate() === target.getDate()
        ) {
            index = i;
            break;
        }
    }
    if (index < 0) return { index: -1, options: Array.from(select.options).map(o => o.textContent.trim()) };
    select.selectedIndex = index;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('input', { bubbles: true }));
    return { index, value: select.options[index].textContent.trim() };
`, dateSelect, target.getTime());
if (!dateResult || dateResult.index < 0) {
            throw new Error(`Could not find delivery date for +2 days (${targetDateLabel}). Available dates: ${dateResult?.options?.join(' | ') || 'none'}`);
        }
        console.log(`    Delivery date selected: ${dateResult.value}`);
        this.result.selections.push({ type: "Delivery Date", value: dateResult.value });
        const dateHits = await this.captureAdobeWindow("Delivery date selection");
        this.recordAction("POPUP_OPTION", "Delivery Date", dateResult.value, dateHits, await this.driver.getCurrentUrl());

        const timeCandidates = await this.visibleElements(By.xpath("//*[contains(@class,'selection-tab')][.//*[contains(normalize-space(.),'am') or contains(normalize-space(.),'pm')]]"));
        if (!timeCandidates.length) throw new Error("No delivery time slots were found.");
        const timeChoice = timeCandidates[Math.floor(Math.random() * timeCandidates.length)];
        const timeValue = await this.textOf(timeChoice);
        await this.drainPerformanceLogs();
        await this.clickElement(timeChoice, `Delivery time - ${timeValue}`);
        console.log(`    Delivery time selected: ${timeValue}`);
        this.result.selections.push({ type: "Delivery Time", value: timeValue });
        const timeHits = await this.captureAdobeWindow("Delivery time selection");
        this.recordAction("POPUP_OPTION", "Delivery Time", timeValue, timeHits, await this.driver.getCurrentUrl());

        const confirm = await this.driver.wait(
            until.elementLocated(By.css("#b3-b80-b14-ConfirmButton")),
            30000,
            "Confirm CTA was not found in delivery date/time popup."
        );
        await this.driver.wait(async () => await confirm.isDisplayed() && await confirm.isEnabled(), 30000);
        await this.drainPerformanceLogs();
        await this.clickElement(confirm, "Confirm delivery date/time");
        const confirmHits = await this.captureAdobeWindow("Delivery confirmation");
        this.recordAction("CTA", "Confirm delivery date/time", `${dateResult.value} ${timeValue}`, confirmHits, await this.driver.getCurrentUrl());

        await this.driver.wait(async () => {
            try { return (await this.driver.findElements(By.css("[popupnameattribute='Delivery Timeslot']"))).length === 0; }
            catch (_) { return false; }
        }, 60000, "Delivery Timeslot popup did not close after confirmation.");
        await this.driver.wait(until.elementLocated(By.css("#b3-Ack")), 60000, "Review Detail agreement section did not render after delivery confirmation.");
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Checkout - Review Detail After Delivery", this.config.reviewDetailPrefix);
    }

    async confirmAndPay() {
        console.log("\n[11] Confirm and Pay + CVV");
        const ack = await this.visibleElements(By.css("#b3-Ack"));
        if (!ack.length) throw new Error("Required T&Cs checkbox #b3-Ack was not found.");
        if (!(await ack[0].isSelected().catch(() => false))) {
            await this.drainPerformanceLogs();
            await this.clickElement(ack[0], "T&Cs checkbox");
            const ackHits = await this.captureAdobeWindow("T&Cs checkbox");
            this.recordAction("CHECKBOX", "b3-Ack", "Selected", ackHits, await this.driver.getCurrentUrl());
        }
        const confirmPay = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'confirm and pay')]")).then(x => x[0]);
        if (!confirmPay) throw new Error("Confirm and Pay CTA was not found.");
        await this.drainPerformanceLogs();
        await this.clickElement(confirmPay, "Confirm and Pay");
        const urlBeforePay = await this.driver.getCurrentUrl();
        const payHits = await this.captureAdobeWindow("Confirm and Pay");
        this.recordAction("CTA", "Confirm and Pay", "", payHits, await this.driver.getCurrentUrl());

        console.log("    Confirm and Pay clicked. Waiting for the site to reload/navigate to the next page...");
        await this.driver.wait(async () => {
            try {
                const currentUrl = await this.driver.getCurrentUrl();
                return currentUrl !== urlBeforePay;
            } catch (_) {
                return false;
            }
        }, 60000, "Site did not navigate after Confirm and Pay.");

        await this.waitForPageReady(60000);
        await this.sleep(2000);
        const postPayPageLoadHits = await this.captureAdobeWindow("Post Confirm and Pay pageLoad", { isPageLoad: true });
        this.recordAction(
            "PAGE_LOAD",
            "Post Confirm and Pay",
            postPayPageLoadHits.length ? "pageLoad captured" : "pageLoad not captured",
            postPayPageLoadHits,
            await this.driver.getCurrentUrl()
        );
        console.log("    Next page loaded after Confirm and Pay.");

        const successAlreadyReached = (await this.driver.getCurrentUrl()).toLowerCase().includes("checkout-success");
        if (!successAlreadyReached) {
            const intermediateCta = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'done') or contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'confirm')]")).then(elements => elements.find(async element => {
                return await element.isDisplayed().catch(() => false);
            }));
            if (intermediateCta) {
                await this.drainPerformanceLogs();
                await this.clickElement(intermediateCta, "Done/Confirm");
                const intermediateHits = await this.captureAdobeWindow("Done/Confirm");
                this.recordAction("CTA", "Done/Confirm", "", intermediateHits, await this.driver.getCurrentUrl());
                console.log("    Done/Confirm CTA clicked. Waiting for success page...");
            } else {
                console.log("    No intermediate Done/Confirm CTA found; continuing with direct success-page flow.");
            }
        }
    }

    async threeDsAndSuccess() {
        console.log("\n[12] 3DS + Order Success");
        const currentUrl = (await this.driver.getCurrentUrl()).toLowerCase();
        if (!currentUrl.includes("checkout-success")) {
            await this.driver.wait(async () => {
                const url = (await this.driver.getCurrentUrl()).toLowerCase();
                return url.includes("checkout-success") || url.includes("3ds") || url.includes("three");
            }, 120000, "Neither 3DS nor success page was reached after Confirm and Pay.");
        }
        const afterPayUrl = (await this.driver.getCurrentUrl()).toLowerCase();
        if (afterPayUrl.includes("checkout-success")) {
            this.currentPageUrl = await this.driver.getCurrentUrl();
            const successPage = await this.recordPage("Order Success", this.config.successPrefix);
            const allSuccessHits = successPage.hits;
            this.result.orders.push(...[]);
            console.log("    Direct order success page reached: " + this.currentPageUrl);
            return;
        }
        await this.waitForUrlPrefix(this.config.threeDsPrefix, 60000);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("3DS Loading Page", this.config.threeDsPrefix);
        const submit = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'submit') or contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'proceed')]")).then(x => x[0]);
        if (!submit) throw new Error("3DS Submit CTA was not found.");
        await this.drainPerformanceLogs();
        await this.clickElement(submit, "3DS Submit");
        const submitHits = await this.captureAdobeWindow("3DS Submit");
        this.recordAction("CTA", "3DS Submit", "", submitHits, await this.driver.getCurrentUrl());
        await this.waitForUrlPrefix(this.config.successPrefix, 120000);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        const successPage = await this.recordPage("Order Success", this.config.successPrefix);
        const allSuccessHits = successPage.hits;
        const orderCandidates = this.result.orders.filter(x => x.pageUrl && x.pageUrl.toLowerCase().includes("checkout-success"));
        if (!orderCandidates.length && allSuccessHits.length) {
            for (const hit of allSuccessHits) {
                if (hit.orderId || hit.revenue || hit.products || hit.events.length) {
                    this.result.orders.push({
                        pageUrl: this.currentPageUrl,
                        pageName: hit.pageName,
                        orderId: hit.orderId,
                        revenue: hit.revenue,
                        products: hit.products,
                        events: hit.events,
                        eVars: hit.eVars,
                        props: hit.props,
                        timestamp: hit.timestamp
                    });
                }
            }
        }
        console.log("    Order success page reached: " + this.currentPageUrl);
    }

    async run() {
        await this.createDriver();
        try {
            this.result.summary.steps = 12;
            await this.login();
            await this.stepHome();
            await this.chooseDevice();
            await this.choosePdpOptions();
            await this.chooseIntent();
            await this.chooseStarPlan();
            await this.chooseSim();
            await this.chooseSecurityAndWatch();
            await this.chooseMobileNumber();
            await this.deliveryFlow();
            await this.confirmAndPay();
            await this.threeDsAndSuccess();

            this.result.summary.pagesVisited = this.result.pages.length;
            this.result.summary.adobeHits = this.result.hits.length;
            this.result.summary.ecommerceEvents = this.result.ecommerceEvents.length;
            this.result.summary.productsCaptured = this.result.products.length;
            this.result.summary.ordersCaptured = this.result.orders.length;
            this.result.summary.passed = this.result.pages.filter(p => p.status === "PASS").length;
            this.result.summary.failed = this.result.pages.filter(p => p.status === "FAIL").length;
            this.result.summary.status = this.result.summary.failed === 0 && this.result.errors.length === 0 ? "PASS" : "FAIL";
            this.result.finishedAt = new Date().toISOString();
            return this.result;
        } catch (error) {
            this.result.errors.push({
                timestamp: new Date().toISOString(),
                step: this.result.pages.length + 1,
                error: error.message || String(error),
                currentUrl: this.driver ? await this.driver.getCurrentUrl().catch(() => "") : ""
            });
            this.result.summary.status = "FAIL";
            this.result.summary.pagesVisited = this.result.pages.length;
            this.result.summary.adobeHits = this.result.hits.length;
            this.result.summary.ecommerceEvents = this.result.ecommerceEvents.length;
            this.result.summary.productsCaptured = this.result.products.length;
            this.result.summary.ordersCaptured = this.result.orders.length;
            this.result.finishedAt = new Date().toISOString();
            throw error;
        } finally {
            await this.close();
        }
    }
}

module.exports = PreSalesJourneyValidator;
