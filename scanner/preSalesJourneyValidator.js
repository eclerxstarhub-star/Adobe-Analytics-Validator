const {
    Builder: Builder,
    By: By,
    Key: Key,
    until: until
} = require("selenium-webdriver"), chrome = require("selenium-webdriver/chrome");
class PreSalesJourneyValidator {
    constructor(t = {}) {
        this.startUrl = t.startUrl || "https://starhubltd-tst1.outsystemsenterprise.com/personal/login", this.credentials = t.credentials || {}, this.config = t.journeyConfig || {}, this.maxAdobeWait = t.maxAdobeWait || 6e4, this.networkQuietTime = t.networkQuietTime || 4e3, this.pollInterval = t.pollInterval || 250, this.driver = null, this.paymentOptionPrompt = t.paymentOptionPrompt || null, this.payLaterPeriod = t.payLaterPeriod || null, this.simType = t.simType || null, this.result = {
            startedAt: (new Date).toISOString(),
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
        }, this.seenHitKeys = new Set, this.lastRecordedPageName = "", this.currentPageUrl = "", this.currentStep = "Starting journey", this.currentAction = "", this.currentCTA = ""
    }
    async createDriver() {
        if (this.driver) return this.driver;
        const t = new chrome.Options;
        return t.addArguments("--start-maximized", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-popup-blocking", "--disable-notifications", "--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-features=TranslateUI"), t.setLoggingPrefs({
            performance: "ALL",
            browser: "ALL"
        }), this.driver = await (new Builder).forBrowser("chrome").setChromeOptions(t).build(), this.driver
    }
    async close() {
        if (this.driver) {
            try {
                await this.driver.quit()
            } catch (t) {}
            this.driver = null
        }
    }
    async sleep(t) {
        return new Promise((e => setTimeout(e, t)))
    }
    async drainPerformanceLogs() {
        try {
            return await this.driver.manage().logs().get("performance")
        } catch (t) {
            return []
        }
    }
    parsePerformanceLog(t) {
        try {
            const e = JSON.parse(t.message);
            return e.message || e
        } catch (t) {
            return null
        }
    }
    parseParameterPairs(t) {
        const e = [];
        if (!t) return e;
        let i = String(t);
        try {
            if (/^https?:/i.test(i)) {
                const t = new URL(i);
                for (const [i, a] of t.searchParams.entries()) e.push([i, a])
            } else {
                i = i.replace(/^\?/, "");
                const t = new URLSearchParams(i);
                for (const [i, a] of t.entries()) e.push([i, a])
            }
        } catch (t) {}
        return e
    }
    parseHit(t, e = "", i = "") {
        const a = [...this.parseParameterPairs(t), ...this.parseParameterPairs(e)],
            r = {};
        for (const [t, e] of a) r[t] = e;
        let s = "",
            n = "";
        try {
            const e = new URL(t);
            n = e.pathname;
            const i = e.pathname.split("/"),
                a = i.findIndex((t => "b" === t.toLowerCase()));
            a >= 0 && i[a + 1] && "ss" === i[a + 1].toLowerCase() && i[a + 2] && (s = i[a + 2])
        } catch (t) {}
        const o = [];
        for (const [t, e] of a) {
            if ("events" === t.toLowerCase())
                for (const t of String(e).split(",")) {
                    const e = t.trim();
                    if (!e) continue;
                    const i = e.split(":");
                    o.push({
                        name: i[0].trim(),
                        value: i.slice(1).join(":").trim()
                    })
                }
            /^event\d+$/i.test(t) && o.push({
                name: t,
                value: e || "1"
            })
        }
        const c = {},
            l = {};
        for (const [t, e] of a)(/^v\d+$/i.test(t) || /^evar\d+$/i.test(t)) && (c[t.toLowerCase()] = e), (/^c\d+$/i.test(t) || /^prop\d+$/i.test(t)) && (l[t.toLowerCase()] = e);
        const d = r.products || "",
            h = r.pageName || r.gn || r.v1 || "",
            u = r.purchaseID || r.purchaseId || r.transactionID || r.orderId || r.oid || "",
            w = r.purchaseamount || r.purchaseAmount || r.revenue || r.amount || "";
        return {
            timestamp: (new Date).toISOString(),
            requestId: i || "",
            url: t,
            pathName: n,
            reportSuite: s,
            pageName: h,
            events: o.map((t => t.name)),
            eventDetails: o,
            eVars: c,
            props: l,
            products: d,
            orderId: u,
            revenue: w,
            rawQuery: r,
            postData: e || ""
        }
    }
    async collectAdobeHits() {
        const t = [],
            e = await this.drainPerformanceLogs();
        for (const i of e) {
            const e = this.parsePerformanceLog(i);
            if (!e || "Network.requestWillBeSent" !== e.method) continue;
            const a = e.params && e.params.request;
            if (!a || !a.url || !/\/b\/ss\//i.test(a.url)) continue;
            const r = this.parseHit(a.url, a.postData || "", e.params.requestId || ""),
                s = `${r.requestId}|${r.url}|${r.postData}`;
            this.seenHitKeys.has(s) || (this.seenHitKeys.add(s), t.push(r))
        }
        return t
    }
    async captureAdobeWindow(t, e = {}) {
        const i = e.timeout || (e.isPageLoad ? this.maxAdobeWait : Math.min(this.maxAdobeWait, 2e4)),
            a = e.quietTime || this.networkQuietTime,
            r = Date.now();
        let s = null;
        const n = [];
        for (; Date.now() - r < i;) {
            const t = await this.collectAdobeHits();
            if (t.length && (n.push(...t), s = Date.now()), n.length && s && Date.now() - s >= a) break;
            await this.sleep(this.pollInterval)
        }
        return n.length && this.addHitData(n), n
    }
    async waitForElement(t, e = 6e4) {
        const i = Date.now();
        for (; Date.now() - i < e;) {
            try {
                const e = await this.driver.findElements(t);
                for (const t of e)
                    if (await t.isDisplayed() && await t.isEnabled()) return t
            } catch (t) {}
            await this.sleep(300)
        }
        throw new Error(`Element not found within ${e}ms: ${JSON.stringify(t)}`)
    }
    async visibleElements(t) {
        const e = await this.driver.findElements(t),
            i = [];
        for (const t of e) try {
            await t.isDisplayed() && await t.isEnabled() && i.push(t)
        } catch (t) {}
        return i
    }
    async textOf(t) {
        try {
            return (await t.getText()).replace(/\s+/g, " ").trim()
        } catch (t) {
            return ""
        }
    }
    async clickElement(t, e) {
        await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", t), await this.sleep(400);
        try {
            await t.click()
        } catch (e) {
            await this.driver.executeScript("arguments[0].click();", t)
        }
        console.log(`    Payment selection clicked: ${e}`)
    }
    async clickText(t, e = {}) {
        const i = !1 !== e.exact,
            a = JSON.stringify(String(t)),
            r = i ? `//*[self::a or self::button or @role='button' or self::label][normalize-space(.)=${a}]` : `//*[self::a or self::button or @role='button' or self::label][contains(normalize-space(.),${a})]`,
            s = await this.visibleElements(By.xpath(r));
        return s.length ? (await this.clickElement(s[0], t), s[0]) : null
    }
    async waitForUrlPrefix(t, e = 6e4) {
        const i = Date.now();
        for (; Date.now() - i < e;) {
            const e = await this.driver.getCurrentUrl();
            if (e.toLowerCase().startsWith(t.toLowerCase())) return e;
            await this.sleep(400)
        }
        throw new Error(`Timed out waiting for URL prefix: ${t}\nCurrent URL: ${await this.driver.getCurrentUrl()}`)
    }
    async waitForPageReady(t = 6e4) {
        const e = Date.now();
        for (; Date.now() - e < t;) {
            try {
                const t = await this.driver.executeScript("return document.readyState");
                if ("complete" === t || "interactive" === t) return
            } catch (t) {}
            await this.sleep(250)
        }
    }
    async getPageName() {
        try {
            return await this.driver.executeScript('\n                try {\n                    const layers = [\n                        window.adobeDataLayer,\n                        window.dataLayer\n                    ];\n\n                    for (const layer of layers) {\n                        if (!Array.isArray(layer)) continue;\n\n                        for (let i = layer.length - 1; i >= 0; i--) {\n                            const x = layer[i];\n\n                            if (!x || typeof x !== "object") {\n                                continue;\n                            }\n\n                            if (x.pageName) {\n                                return String(x.pageName).trim();\n                            }\n\n                            if (x.page && x.page.pageName) {\n                                return String(x.page.pageName).trim();\n                            }\n\n                            if (x.pageData && x.pageData.pageName) {\n                                return String(x.pageData.pageName).trim();\n                            }\n\n                            if (x.analytics && x.analytics.pageName) {\n                                return String(x.analytics.pageName).trim();\n                            }\n                        }\n                    }\n                } catch (e) {}\n\n                return "";\n            ')
        } catch (t) {
            return ""
        }
    }
    async waitForPageName(t = "", e = 3500) {
        const i = Date.now();
        let a = "";
        for (; Date.now() - i < e;) {
            if (a = String(await this.getPageName()).trim(), a && (!t || a !== t)) return a;
            await this.sleep(250)
        }
        return a
    }
    async recordPage(t, e = "") {
        this.currentStep = t, this.currentAction = "", this.currentCTA = "", await this.waitForPageReady();
        const i = await this.driver.getCurrentUrl(),
            a = await this.driver.getTitle().catch((() => ""));
        this.currentPageUrl = i;
        const r = this.lastRecordedPageName || "",
            s = await this.waitForPageName(r, 3500),
            n = await this.captureAdobeWindow(`${t} pageLoad`, {
                isPageLoad: !0
            }),
            o = [...n].reverse().map((t => String(t && t.pageName ? t.pageName : "").trim())).find(Boolean) || [...this.result.hits].slice(-10).reverse().map((t => String(t && t.pageName ? t.pageName : "").trim())).find(Boolean) || "";
        let c = "";
        !s || r && s === r ? o ? c = o : s && (c = s) : c = s, this.lastRecordedPageName = c || r || "";
        const l = n.length > 0 ? n : o ? this.result.hits.slice(-10).filter((t => String(t && t.pageName ? t.pageName : "").trim() === o)) : [],
            d = [...new Set(l.flatMap((t => Array.isArray(t.events) ? t.events : [])))],
            h = {
                step: t,
                url: i,
                expectedPrefix: e,
                title: a,
                pageName: c,
                pageLoadCaptured: n.length > 0 || !!o,
                adobeHitCount: n.length > 0 ? n.length : l.length,
                eventsFound: d,
                status: n.length > 0 || c ? "PASS" : "FAIL",
                hits: l
            };
        return this.result.pages.push(h), h
    }
    recordAction(t, e, i, a, r) {
        this.currentAction = t, this.currentCTA = e || t;
        const s = [...new Set(a.flatMap((t => t.events)))],
            n = {
                action: t,
                label: e,
                value: i || "",
                pageUrl: r,
                timestamp: (new Date).toISOString(),
                adobeHitCount: a.length,
                events: s,
                hits: a
            };
        return this.result.actions.push(n), n
    }
    addHitData(t) {
        for (const e of t) {
            this.result.hits.push(e);
            for (const t of e.eventDetails || []) this.result.ecommerceEvents.push({
                event: t.name,
                value: t.value,
                pageName: e.pageName,
                pageUrl: this.currentPageUrl || e.url,
                timestamp: e.timestamp,
                products: e.products,
                orderId: e.orderId,
                revenue: e.revenue,
                hitUrl: e.url
            });
            e.products && this.result.products.push({
                pageUrl: this.currentPageUrl || e.url,
                pageName: e.pageName,
                products: e.products,
                events: e.events,
                eVars: e.eVars,
                props: e.props,
                timestamp: e.timestamp
            }), (e.orderId || e.revenue || e.events.some((t => /purchase|order.?success/i.test(t)))) && this.result.orders.push({
                pageUrl: this.currentPageUrl || e.url,
                pageName: e.pageName,
                orderId: e.orderId,
                revenue: e.revenue,
                products: e.products,
                events: e.events,
                eVars: e.eVars,
                props: e.props,
                timestamp: e.timestamp
            })
        }
    }
    async navigateAndRecord(t, e, i) {
        this.currentStep = t, this.currentAction = "", this.currentCTA = "", await this.drainPerformanceLogs(), await this.driver.get(i), await this.waitForUrlPrefix(e), this.currentPageUrl = await this.driver.getCurrentUrl();
        return this.recordPage(t, e)
    }
    async clickAndRecord(t, e, i = "", a = "") {
        this.currentAction = "CTA", this.currentCTA = a || t, await this.drainPerformanceLogs(), await e();
        const r = await this.captureAdobeWindow(t);
        return i && await this.waitForUrlPrefix(i), this.currentPageUrl = await this.driver.getCurrentUrl(), this.recordAction("CTA", a || t, "", r, this.currentPageUrl), r
    }
    async login() {
        console.log("\n[1] Login"), await this.navigateAndRecord("Login Page", this.config.startUrl || this.startUrl, this.config.startUrl || this.startUrl);
        const t = await this.waitForElement(By.css("input[type='email'],input[name*='email'],input[id*='email'],input[name*='user'],input[id*='user'],input[type='text']")),
            e = await this.waitForElement(By.css("input[type='password']"));
        await t.clear(), await t.sendKeys(this.credentials.hubId || ""), await e.clear(), await e.sendKeys(this.credentials.hubPassword || "");
        const i = await this.visibleElements(By.xpath("//button[normalize-space(.)='Login' or .//*[normalize-space(.)='Login']] | //input[@type='submit']"));
        if (i.length) await this.clickAndRecord("Login CTA", (() => this.clickElement(i[0], "Login")), this.config.homeUrlPrefix, "Login");
        else {
            await this.drainPerformanceLogs(), await e.sendKeys(Key.ENTER);
            const t = await this.captureAdobeWindow("Login CTA");
            this.recordAction("CTA", "Login", "", t, await this.driver.getCurrentUrl())
        }
        await this.waitForUrlPrefix(this.config.homeUrlPrefix), this.currentPageUrl = await this.driver.getCurrentUrl(), console.log("    Login successful. Landed on: " + this.currentPageUrl), this.result.authentication = {
            status: "SUCCESS",
            account: "Test Account"
        }
    }
    async stepHome() {
        console.log("\n[2] Mobile Plans / Landing"), await this.recordPage("Mobile Plans / Landing", this.config.homeUrlPrefix);
        const t = await this.visibleElements(By.xpath("//*[self::a or self::button or @role='button'][contains(normalize-space(.),'See more devices')]")).then((t => t[0]));
        if (!t) throw new Error("CTA 'See more devices' was not found.");
        await this.clickAndRecord("See More Devices CTA", (() => this.clickElement(t, "See more devices")), this.config.deviceListingPrefix, "See more devices"), await this.waitForUrlPrefix(this.config.deviceListingPrefix), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Mobile Device Listing", this.config.deviceListingPrefix)
    }
    async isCurrentProductOutOfStock() {
        try {
            const t = await this.driver.executeScript((() => {
                const t = t => {
                        if (!t) return !1;
                        const e = window.getComputedStyle(t),
                            i = t.getBoundingClientRect();
                        return "none" !== e.display && "hidden" !== e.visibility && i.width > 0 && i.height > 0
                    },
                    e = ["[data-container]", "button", "label", "span", "div", "p"],
                    i = /(?:out\s*of\s*stock|sold\s*out|currently\s*unavailable|not\s*available|unavailable|no\s*stock)/i,
                    a = /(?:add\s*to\s*(?:cart|basket)|buy\s*now|available\s*now)/i,
                    r = [];
                for (const a of e)
                    for (const e of Array.from(document.querySelectorAll(a))) {
                        if (!t(e)) continue;
                        const a = String(e.innerText || e.textContent || "").replace(/\s+/g, " ").trim();
                        !a || a.length > 180 || i.test(a) && r.push(a)
                    }
                const s = Array.from(document.querySelectorAll("button,a,[role='button']")).some((e => t(e) && a.test(String(e.innerText || e.textContent || ""))));
                return {
                    negativeMatches: [...new Set(r)].slice(0, 20),
                    addToCart: s
                }
            }));
            return !t.addToCart && t.negativeMatches.length > 0
        } catch (t) {
            return !1
        }
    }
    async findIphone17ProMaxCards(t = 9e4) {
        const e = Date.now();
        let i = 0;
        for (; Date.now() - e < t;) {
            try {
                await this.driver.executeScript("window.scrollTo(0, document.body.scrollHeight);"), await this.sleep(1200), await this.driver.executeScript("window.scrollTo(0, 0);")
            } catch (t) {}
            const t = await this.driver.executeScript((() => {
                const t = t => String(t || "").replace(/\s+/g, " ").trim(),
                    e = [];
                return Array.from(document.querySelectorAll(".product-item-card")).forEach(((i, a) => {
                    const r = t(i.innerText || i.textContent || ""),
                        s = i.querySelector(".content-section .f-h6, .content-section span.f-h6"),
                        n = t(s ? s.innerText || s.textContent : ""),
                        o = i.querySelector("img"),
                        c = t(o ? o.getAttribute("src") : ""),
                        l = `${n} ${r} ${c}`.toLowerCase();
                    if (!l.includes("iphone 17")) return;
                    (l.includes("iphone 17 pro max") || l.includes("iphone-17-pro-max")) && e.push({
                        index: a,
                        model: n || "iPhone 17 Pro Max",
                        text: r.slice(0, 300),
                        imageSrc: c,
                        hasContentClickTarget: !!i.querySelector(".content-section > div[style*='cursor'], .image-section > div[style*='cursor']")
                    })
                })), e
            })).catch((() => []));
            if (i = t.length, t.length) return t;
            await this.sleep(1800)
        }
        return []
    }
    async chooseDevice() {
        console.log("\n[3] Mobile Device Listing -> Random iPhone 17 Pro Max");
        const t = new Set;
        let e = "";
        for (let i = 1; i <= 8; i++) {
            console.log(`    Device selection attempt ${i}/8`), await this.waitForPageReady(9e4), this.config.deviceListingPrefix && (await this.driver.getCurrentUrl()).toLowerCase().startsWith(this.config.deviceListingPrefix.toLowerCase()) || (await this.driver.get(this.config.deviceListingPrefix), await this.waitForUrlPrefix(this.config.deviceListingPrefix, 9e4), await this.recordPage("Mobile Device Listing - Retry", this.config.deviceListingPrefix));
            const a = await this.findIphone17ProMaxCards(9e4);
            if (!a.length) throw new Error("No iPhone 17 Pro Max product cards were found on the device listing page. The PLP uses .product-item-card cards, but no matching iPhone 17 Pro Max card was rendered.");
            let r = a.filter((e => !t.has(e.model)));
            r.length || (r = a);
            const s = r[Math.floor(Math.random() * r.length)];
            t.add(s.model), console.log(`    Found ${a.length} iPhone 17 Pro Max card(s).`), console.log(`    Selected device: ${s.model}`), s.imageSrc && console.log(`    Device image: ${s.imageSrc}`), this.result.selections.push({
                type: "Device Attempt",
                value: s.model,
                url: s.imageSrc || "",
                attempt: i
            }), await this.drainPerformanceLogs();
            if (!await this.driver.executeScript((t => {
                    const e = Array.from(document.querySelectorAll(".product-item-card"))[t];
                    if (!e) return !1;
                    const i = [e.querySelector(".content-section > div[style*='cursor']"), e.querySelector(".image-section > div[style*='cursor']"), e.querySelector(".content-section"), e.querySelector(".image-section")].filter(Boolean)[0];
                    return !!i && (i.scrollIntoView({
                        behavior: "instant",
                        block: "center"
                    }), i.dispatchEvent(new MouseEvent("click", {
                        bubbles: !0,
                        cancelable: !0,
                        view: window
                    })), !0)
                }), s.index).catch((() => !1))) {
                e = `iPhone 17 Pro Max card '${s.model}' was detected but could not be clicked.`, console.log(`    ${e}`);
                continue
            }
            console.log("    CTA clicked: iPhone 17 Pro Max product card");
            const n = await this.captureAdobeWindow("iPhone 17 Pro Max prodClick", {
                timeout: Math.min(this.maxAdobeWait, 3e4),
                quietTime: Math.min(this.networkQuietTime, 2500)
            });
            this.recordAction("PRODUCT_CLICK", "iPhone 17 Pro Max", s.model, n, await this.driver.getCurrentUrl());
            try {
                await this.waitForUrlPrefix(this.config.productPdpPrefix, 9e4)
            } catch (t) {
                e = t.message || String(t), console.log("    Navigation did not reach the expected iPhone 17 Pro Max PDP."), console.log(`    Current URL: ${await this.driver.getCurrentUrl()}`), await this.driver.get(this.config.deviceListingPrefix), await this.waitForUrlPrefix(this.config.deviceListingPrefix, 9e4);
                continue
            }
            this.currentPageUrl = await this.driver.getCurrentUrl();
            const o = await this.recordPage("iPhone 17 Pro Max PDP", this.config.productPdpPrefix);
            if (!await this.isCurrentProductOutOfStock()) return console.log(`    IN STOCK: ${s.model}`), console.log(`    PDP URL: ${this.currentPageUrl}`), void this.result.selections.push({
                type: "Device Availability",
                value: `${s.model} - IN STOCK`,
                url: this.currentPageUrl,
                attempt: i
            });
            console.log(`    OUT OF STOCK: ${s.model}`), this.result.selections.push({
                type: "Device Availability",
                value: `${s.model} - OUT OF STOCK`,
                url: this.currentPageUrl,
                attempt: i
            }), this.result.actions.push({
                action: "DEVICE_RETRY",
                label: "Out of stock - return to PLP",
                value: s.model,
                pageUrl: this.currentPageUrl,
                timestamp: (new Date).toISOString(),
                adobeHitCount: o.adobeHitCount,
                events: o.eventsFound || [],
                hits: o.hits || []
            }), await this.driver.get(this.config.deviceListingPrefix), await this.waitForUrlPrefix(this.config.deviceListingPrefix, 9e4), await this.waitForPageReady(9e4)
        }
        throw new Error(e || "Could not find an in-stock iPhone 17 Pro Max after 8 attempts.")
    }
    async choosePdpOptions() {
        console.log("\n[4] iPhone 17 Pro Max PDP");
        const t = await this.getRadioGroups();
        let e = t.find((t => /color|colour/i.test(t.key))),
            i = t.find((t => /storage|size|capacity|gb/i.test(t.key) && t !== e));
        const a = new Set;
        if (e && (await this.selectRadioFromGroup(e, "Color"), a.add(e.key)), i && !a.has(i.key) && (await this.selectRadioFromGroup(i, "Size/Storage"), a.add(i.key)), !e || !i) {
            const r = t.filter((t => !a.has(t.key) && !/payment|pay|monthly/i.test(t.key)));
            !e && r.length && (e = r.shift(), await this.selectRadioFromGroup(e, "Color/Variant"), a.add(e.key)), !i && r.length && (i = r.shift(), await this.selectRadioFromGroup(i, "Size/Storage"), a.add(i.key))
        }
        const r = this.paymentOptionPrompt ? await this.paymentOptionPrompt() : "2",
            s = "1" === String(r).trim(),
            n = s ? "Pay Later - Monthly" : "Pay Today";
        console.log(`    Payment option selected: ${n}`), this.result.selections.push({
            type: "Payment Option",
            value: n
        });
        let o = null;
        const c = Date.now();
        for (; Date.now() - c < 6e4;) {
            try {
                if (s) {
                    const t = String(this.payLaterPeriod || "").trim();
                    if (!["12", "24", "36"].includes(t)) throw new Error(`Invalid Pay Later period: ${t||"not provided"}. Expected 12, 24, or 36.`);
                    const e = await this.driver.findElements(By.css(`[aa_linktext="${t}-month"]`));
                    for (const t of e)
                        if (await t.isDisplayed().catch((() => !1))) {
                            o = t;
                            break
                        }
                } else {
                    const t = await this.driver.findElements(By.css('[aa_linktext="Pay today"], .shop-option.paymentoption-selection-option'));
                    for (const e of t) try {
                        if (!await e.isDisplayed()) continue;
                        const t = (await e.getText()).replace(/\s+/g, " ").trim().toLowerCase();
                        if ("pay today" === (await e.getAttribute("aa_linktext") || "").trim().toLowerCase() || "pay today" === t || t.includes("pay today")) {
                            o = e;
                            break
                        }
                    } catch (t) {}
                }
            } catch (t) {}
            if (o) break;
            await this.sleep(500)
        }
        if (!o) {
            const t = s ? `${n} (${this.payLaterPeriod||"36"}-month)` : n;
            throw new Error(`Payment option '${t}' was not found on PDP.`)
        }
        console.log(`    Payment option found on PDP: ${n}`), await this.drainPerformanceLogs(), await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", o), await this.sleep(500);
        try {
            await o.click()
        } catch (t) {
            await this.driver.executeScript("arguments[0].click();", o)
        }
        console.log(`    Payment selection clicked: ${n}`);
        const l = await this.captureAdobeWindow("Payment option selection", {
            timeout: Math.min(this.maxAdobeWait, 3e4),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });
        this.recordAction("OPTION", "Payment Option", n, l, await this.driver.getCurrentUrl()), console.log("    Payment selection recorded. Looking for PDP Next CTA...");
        const d = Date.now();
        let h = null;
        for (; Date.now() - d < 6e4;) {
            try {
                const t = await this.driver.findElements(By.css("#b5-b16-NextCTA button"));
                for (const e of t) try {
                    if (!await e.isDisplayed() || !await e.isEnabled()) continue;
                    const t = await e.getAttribute("aria-disabled") || "";
                    if (null !== await e.getAttribute("disabled") || "true" === t.toLowerCase()) continue;
                    const i = (await e.getText()).replace(/\s+/g, " ").trim();
                    if (/^next$/i.test(i) || /\bnext\b/i.test(i)) {
                        h = e;
                        break
                    }
                } catch (t) {}
            } catch (t) {}
            if (h) break;
            await this.sleep(500)
        }
        if (!h) throw new Error("Next CTA was not found or did not become enabled on the iPhone PDP within 60 seconds.");
        const u = await h.getAttribute("outerHTML").catch((() => (""))),
            w = (await h.getText()).replace(/\s+/g, " ").trim(),
            g = await h.getAttribute("id") || "",
            p = await h.getAttribute("class") || "";
        console.log(`    PDP CTA found: ${w||"Next"}`), console.log("    Next CTA selector: #b5-b16-NextCTA button"), console.log("    Next CTA outerHTML captured: " + (u ? "YES" : "NO")), this.result.selections.push({
            type: "PDP Next CTA",
            value: w || "Next",
            selector: "#b5-b16-NextCTA button",
            id: g,
            className: p,
            outerHTML: u,
            pageUrl: await this.driver.getCurrentUrl()
        }), await this.drainPerformanceLogs(), await this.clickElement(h, "Next - iPhone");
        const m = await this.captureAdobeWindow("Next - iPhone / scAdd", {
                timeout: Math.min(this.maxAdobeWait, 3e4),
                quietTime: Math.min(this.networkQuietTime, 2500)
            }),
            f = m.filter((t => (t.events || []).some((t => /^scAdd$/i.test(String(t)))) || (t.eventDetails || []).some((t => /^scAdd$/i.test(String(t.name)))))),
            y = m.length ? m[m.length - 1] : null,
            v = !!y && ((y.events || []).some((t => /^scAdd$/i.test(String(t)))) || (y.eventDetails || []).some((t => /^scAdd$/i.test(String(t.name))))),
            b = this.recordAction("CTA", "Next - iPhone", n, m, await this.driver.getCurrentUrl());
        b.nextCta = {
            selector: "#b5-b16-NextCTA button",
            text: w || "Next",
            id: g,
            className: p,
            outerHTML: u
        }, b.scAddCaptured = f.length > 0, b.scAddHitCount = f.length, b.latestHitHasScAdd = v, b.scAddHits = f, this.result.selections.push({
            type: "PDP scAdd Validation",
            value: f.length ? "scAdd captured" : "scAdd not captured",
            scAddCaptured: f.length > 0,
            scAddHitCount: f.length,
            latestHitHasScAdd: v,
            hits: f
        }), console.log(`    Next CTA clicked. Adobe /b/ss hits captured: ${m.length}`), console.log("    scAdd captured from Next CTA flow: " + (f.length > 0 ? "YES" : "NO")), await this.waitForUrlPrefix(this.config.intentPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Intent Selection", this.config.intentPrefix)
    }
    async getRadioGroups() {
        const t = await this.driver.findElements(By.css("input[type='radio']")),
            e = new Map;
        for (const i of t) try {
            if (!await i.isDisplayed() || !await i.isEnabled()) continue;
            const t = await i.getAttribute("name") || "",
                a = await i.getAttribute("id") || "",
                r = `${t}|${a}` || `radio-${e.size}`,
                s = await this.findRadioLabel(i);
            if (!s) continue;
            const n = t || await i.getAttribute("data-group") || a || r;
            e.has(n) || e.set(n, []), e.get(n).push({
                radio: i,
                label: s
            })
        } catch (t) {}
        return [...e.entries()].map((([t, e]) => ({
            key: t,
            options: e
        })))
    }
    async findRadioLabel(t) {
        const e = await t.getAttribute("id").catch((() => ("")));
        if (e) {
            const t = await this.driver.findElements(By.css(`label[for="${e.replace(/"/g,'\\"')}"]`));
            if (t.length) return this.textOf(t[0])
        }
        return this.driver.executeScript("return arguments[0].parentElement ? arguments[0].parentElement.innerText : '';", t).then((t => String(t || "").replace(/\s+/g, " ").trim())).catch((() => ""))
    }
    async selectRadioFromGroup(t, e) {
        const i = t.options[Math.floor(Math.random() * t.options.length)],
            a = i.label;
        console.log(`    Selected ${e}: ${a}`), this.result.selections.push({
            type: e,
            value: a
        }), await this.drainPerformanceLogs(), await this.clickElement(i.radio, `${e} - ${a}`);
        const r = await this.captureAdobeWindow(`${e} selection`);
        this.recordAction("OPTION", e, a, r, await this.driver.getCurrentUrl())
    }
    async findOptionCandidates(t) {
        const e = await this.visibleElements(By.xpath("//*[self::label or self::button or @role='button']")),
            i = [];
        for (const a of e) {
            const e = `${(await this.textOf(a)).toLowerCase()} ${(await a.getAttribute("class").catch((()=>(""))))?.toLowerCase()||""}`;
            e.trim() && (t.some((t => e.includes(t))) && i.push(a))
        }
        return i.filter(((t, e, i) => i.findIndex((e => e === t)) === e)).slice(0, 30)
    }
    async getPdpNextCta() {
        const t = Date.now();
        for (; Date.now() - t < 6e4;) {
            try {
                const t = await this.driver.findElements(By.css("#b5-b16-NextCTA button"));
                for (const e of t) {
                    if (!await e.isDisplayed() || !await e.isEnabled()) continue;
                    const t = (await this.textOf(e)).toLowerCase();
                    if ("next" === t || t.includes("next")) return e
                }
            } catch (t) {}
            try {
                const t = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][normalize-space(.)='Next' or contains(normalize-space(.),'Next')]")).then((t => t[0]));
                if (t) return t
            } catch (t) {}
            await this.sleep(500)
        }
        return null
    }
    async getOuterHTML(t) {
        try {
            return await this.driver.executeScript("return arguments[0].outerHTML;", t)
        } catch (t) {
            return ""
        }
    }
    async clickNextToIntent() {
        const t = await this.getPdpNextCta();
        if (!t) throw new Error("Next CTA was not found after iPhone PDP/payment selection.");
        const e = await this.getOuterHTML(t),
            i = await this.textOf(t),
            a = await t.getAttribute("id").catch((() => (""))),
            r = await t.getAttribute("class").catch((() => ("")));
        console.log(`    PDP Next CTA found: ${i||"Next"}`), console.log(`    PDP Next CTA id: ${a||"N/A"}`), console.log("    PDP Next CTA outerHTML captured: " + (e ? "YES" : "NO")), await this.drainPerformanceLogs(), await this.clickElement(t, "Next - iPhone");
        const s = await this.captureAdobeWindow("Next to Intent - scAdd", {
                timeout: Math.min(this.maxAdobeWait, 3e4),
                quietTime: Math.min(this.networkQuietTime, 2500)
            }),
            n = s.filter((t => t.events.some((t => /^scadd$/i.test(t))))),
            o = n.length > 0,
            c = s.length ? s[s.length - 1] : null,
            l = !(!c || !c.events.some((t => /^scadd$/i.test(t)))),
            d = this.recordAction("CTA", "Next - iPhone", "", s, await this.driver.getCurrentUrl());
        d.outerHTML = e, d.element = {
            tagName: "BUTTON",
            id: a || "",
            className: r || "",
            text: i || "Next"
        }, d.expectedEvent = "scAdd", d.scAddCaptured = o, d.latestHitHasScAdd = l, d.scAddHitCount = n.length, d.scAddHits = n, this.result.selections.push({
            type: "PDP Next CTA",
            value: i || "Next",
            outerHTML: e,
            scAddCaptured: o,
            latestHitHasScAdd: l,
            scAddHitCount: n.length
        }), console.log(`    b/ss hits captured after PDP Next: ${s.length}`), console.log("    scAdd captured: " + (o ? "YES" : "NO")), console.log("    Latest b/ss hit contains scAdd: " + (l ? "YES" : "NO")), o || console.log("    WARNING: PDP Next CTA was clicked, but no captured b/ss hit contained scAdd."), await this.waitForUrlPrefix(this.config.intentPrefix), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Intent Selection", this.config.intentPrefix)
    }
    async findClickableByText(t, e = 6e4) {
        const i = String(t || "").trim(),
            a = Date.now();
        for (; Date.now() - a < e;) {
            try {
                const t = `//*[self::button or self::a or @role='button' or self::label][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),${JSON.stringify(i.toLowerCase())})]`,
                    e = await this.visibleElements(By.xpath(t));
                if (e.length) return e[0]
            } catch (t) {}
            await this.sleep(500)
        }
        return null
    }
    async getNextCtaOnCurrentPage(t = 6e4) {
        const e = Date.now();
        for (; Date.now() - e < t;) {
            try {
                const t = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][normalize-space(.)='Next' or contains(normalize-space(.),'Next') or contains(normalize-space(.),'Continue') or contains(normalize-space(.),'Proceed')]")).then((t => t.slice(0, 20)));
                for (const e of t) {
                    const t = await this.textOf(e);
                    if (/^(next|continue|proceed)(\b|\s)/i.test(t) || /\bnext\b/i.test(t)) return e
                }
            } catch (t) {}
            await this.sleep(500)
        }
        return null
    }
    async chooseIntent() {
        console.log("\n[5] Signup for New / Select Line"), await this.waitForPageReady(9e4), this.currentPageUrl = await this.driver.getCurrentUrl();
        if (await this.driver.findElements(By.xpath("//*[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'reached the maximum of mobile lines allowed by imda')]")).then((async t => {
                for (const e of t)
                    if (await e.isDisplayed().catch((() => !1))) return e;
                return null
            })).catch((() => null))) {
            console.log("    Maximum mobile-line limit detected. Selecting a random existing StarHub number.");
            const t = await this.visibleElements(By.css(".number-selection-option"));
            if (!t.length) throw new Error("Maximum mobile-line limit displayed, but no existing StarHub number options were found.");
            const e = t[Math.floor(Math.random() * t.length)],
                i = await this.textOf(e);
            this.result.selections.push({
                type: "Existing StarHub Number",
                value: i || "Random existing StarHub number",
                outerHTML: await this.getOuterHTML(e),
                pageUrl: this.currentPageUrl
            }), await this.drainPerformanceLogs(), await this.clickElement(e, "Random existing StarHub number");
            const a = await this.captureAdobeWindow("Existing StarHub number selection", {
                timeout: Math.min(this.maxAdobeWait, 3e4),
                quietTime: Math.min(this.networkQuietTime, 2500)
            });
            this.recordAction("OPTION", "Existing StarHub Number", i, a, await this.driver.getCurrentUrl())
        } else {
            const t = await this.driver.wait((async () => {
                try {
                    const t = await this.driver.findElements(By.xpath("//div[contains(@class,'number-card-detail_v2')][.//span[normalize-space()='Sign up for a new line']]"));
                    for (const e of t)
                        if (await e.isDisplayed()) return e
                } catch (t) {}
                return !1
            }), 6e4);
            if (!t) throw new Error("'Sign up for a new line' option was not found on the Intent Selection page.");
            const e = await this.textOf(t);
            this.result.selections.push({
                type: "Intent",
                value: e,
                outerHTML: await this.getOuterHTML(t),
                pageUrl: this.currentPageUrl
            }), await this.drainPerformanceLogs(), /\bselected\b/i.test(await t.getAttribute("class").catch((() => ("")))) || await this.clickElement(t, "Sign up for a new line");
            const i = await this.captureAdobeWindow("Signup for new selection", {
                timeout: Math.min(this.maxAdobeWait, 3e4),
                quietTime: Math.min(this.networkQuietTime, 2500)
            });
            this.recordAction("OPTION", "Sign up for a new line", e, i, await this.driver.getCurrentUrl())
        }
        const t = await this.getNextCtaOnCurrentPage(6e4);
        if (!t) throw new Error("Next CTA was not found after intent/existing-number selection.");
        const e = await this.textOf(t);
        this.result.selections.push({
            type: "Intent Next CTA",
            value: e || "Next",
            outerHTML: await this.getOuterHTML(t),
            pageUrl: this.currentPageUrl
        }), await this.drainPerformanceLogs(), await this.clickElement(t, "Next - Intent Selection");
        const i = await this.captureAdobeWindow("Intent Next CTA", {
            timeout: Math.min(this.maxAdobeWait, 3e4),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });
        this.recordAction("CTA", "Next - Intent Selection", e || "Next", i, await this.driver.getCurrentUrl())
    }
    async chooseStarPlan() {
        console.log("\n[6] Mobile Plan Selection");
        const t = await this.driver.wait((async () => {
            try {
                const t = await this.visibleElements(By.css(".sn-plan-card"));
                for (const e of t) {
                    const t = await this.textOf(e);
                    if (/5G Unlimited\+ Plus/i.test(t)) return e
                }
            } catch (t) {}
            return !1
        }), 6e4);
        if (!t) throw new Error("Mobile plan card '5G Unlimited+ Plus' was not found.");
        await this.textOf(t);
        const e = await t.getAttribute("outerHTML");
        console.log("    Mobile plan found: 5G Unlimited+ Plus"), console.log("    Plan card outerHTML captured: " + (e ? "YES" : "NO"));
        const i = await t.findElements(By.xpath(".//button[.//span[normalize-space()='Select plan'] or normalize-space()='Select plan']"));
        if (!i.length) throw new Error("'Select plan' CTA was not found inside the 5G Unlimited+ Plus plan card.");
        const a = i[0],
            r = await a.getAttribute("outerHTML");
        console.log("    Select plan CTA outerHTML captured: " + (r ? "YES" : "NO")), this.result.selections.push({
            type: "Mobile Plan",
            value: "5G Unlimited+ Plus"
        }), await this.drainPerformanceLogs(), await this.clickElement(a, "Select plan - 5G Unlimited+ Plus");
        const s = await this.captureAdobeWindow("Mobile Plan Select plan", {
            timeout: Math.min(this.maxAdobeWait, 3e4),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });
        this.recordAction("CTA", "Select plan", "5G Unlimited+ Plus", s, await this.driver.getCurrentUrl()), console.log("    Select plan clicked. Adobe /b/ss hits captured: " + s.length), await this.waitForUrlPrefix(this.config.simPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("SIM Selection Popup", this.config.simPrefix), console.log("    Landed on SIM Selection page: " + this.currentPageUrl)
    }
    async chooseSim() {
        console.log("\n[7] SIM Selection Popup");
        const t = String(this.simType || "").trim().toLowerCase();
        if (!t) throw new Error("SIM type was not provided at journey start. Please select eSIM or Physical SIM.");
        const e = "1" === t || "esim" === t || "e-sim" === t;
        if (!e && !("2" === t || "physical sim" === t || "physical-sim" === t || "physical" === t)) throw new Error(`Invalid SIM type provided at journey start: '${this.simType}'. Expected eSIM or Physical SIM.`);
        await this.driver.wait((async () => {
            const t = await this.driver.findElements(By.xpath("//*[contains(@class,'overlay-modal-title') and contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'select your choice of sim')]")).catch((() => [])),
                e = await this.driver.findElements(By.css("input[type='radio'][id*='eSIM'], input[type='radio'][id*='PhysicalSIM']")).catch((() => []));
            return t.length > 0 || e.length > 0
        }), 6e4, "SIM selection popup did not appear");
        const i = e ? {
            value: "eSIM",
            container: "#b3-b1-b2-eSim_Container",
            radio: "#b3-b1-b2-eSIM-input"
        } : {
            value: "Physical SIM",
            container: "#b3-b1-b2-PhysicalSIM_Container",
            radio: "#b3-b1-b2-PhysicalSIM-input"
        };
        let a = (await this.driver.findElements(By.css(i.radio)).catch((() => [])))[0];
        if (!a) {
            const t = e ? "eSIM" : "Physical SIM",
                i = await this.driver.findElements(By.xpath(`//input[@type='radio' and (contains(@id,'eSIM') or contains(@id,'PhysicalSIM'))][ancestor::*[contains(normalize-space(.),'${t}')]]`)).catch((() => []));
            a = i[0]
        }
        if (!a) throw new Error(`SIM option '${i.value}' was not found in the SIM Selection popup.`);
        console.log(`    SIM option requested at journey start: ${i.value}`), await this.drainPerformanceLogs();
        if (!await a.isSelected().catch((() => !1))) {
            const t = await this.driver.findElements(By.css(i.container)).catch((() => []));
            t.length ? (await this.driver.executeScript("arguments[0].scrollIntoView({block:'center'});", t[0]).catch((() => {})), await this.driver.executeScript("arguments[0].click();", t[0]).catch((() => {}))) : await this.driver.executeScript("arguments[0].click();", a).catch((() => {}))
        }
        await this.driver.wait((async () => await a.isSelected().catch((() => !1))), 15e3, `SIM option '${i.value}' was not selected`), console.log(`    SIM selected: ${i.value}`), this.result.selections.push({
            type: "SIM",
            value: i.value
        });
        const r = await this.captureAdobeWindow("SIM selection", {
            waitMs: 5e3,
            drainBefore: !1
        });
        this.recordAction("POPUP_OPTION", "SIM", i.value, r, await this.driver.getCurrentUrl()), console.log("    SIM selection recorded. Adobe /b/ss hits captured: " + r.length);
        const s = "//div[contains(@class,'overlay-modal-footer')]//button[.//div[normalize-space()='Next'] or normalize-space()='Next']";
        await this.driver.wait((async () => {
            const t = await this.driver.findElements(By.xpath(s)).catch((() => []));
            return t.length > 0 && await t[0].isEnabled().catch((() => !1))
        }), 3e4, "SIM selection Next CTA did not become enabled after selecting the SIM option");
        const n = (await this.driver.findElements(By.xpath(s)))[0];
        console.log("    Next CTA found: Next"), await this.drainPerformanceLogs(), await this.clickElement(n, "Next - SIM Selection");
        const o = await this.captureAdobeWindow("SIM Selection Next");
        this.recordAction("CTA", "Next", "SIM Selection", o, await this.driver.getCurrentUrl()), console.log("    SIM Next clicked. Adobe /b/ss hits captured: " + o.length), await this.waitForUrlPrefix(this.config.suggestionPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Security / Add-ons", this.config.suggestionPrefix)
    }
    async chooseSecurityAndWatch() {
        console.log("\n[8] Security / Add-ons");
        const t = "Watch S11 46mm AL";
        let e = null;
        const i = Date.now();
        for (; Date.now() - i < 3e4;) {
            try {
                const t = await this.visibleElements(By.xpath("//div[contains(@class,'product-item-card')][.//*[normalize-space()='Watch S11 46mm AL']]"));
                if (t.length) {
                    e = t[0];
                    break
                }
            } catch (t) {}
            await this.sleep(500)
        }
        if (!e) throw new Error("Watch S11 46mm AL upsell was not found.");
        console.log("    Upsell found: Watch S11 46mm AL"), this.result.selections.push({
            type: "Upsell",
            value: t
        }), await this.drainPerformanceLogs(), await this.clickElement(e, t);
        const a = await this.captureAdobeWindow("Watch upsell click");
        this.recordAction("CTA", t, t, a, await this.driver.getCurrentUrl()), await this.waitForUrlPrefix(this.config.watchPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Watch S11 46mm AL PDP", this.config.watchPrefix), console.log("    Watch PDP loaded.");
        let r = null;
        const s = Date.now();
        for (; Date.now() - s < 3e4;) {
            try {
                const t = await this.visibleElements(By.xpath("//button[contains(@class,'add-to-cart-button')][.//span[normalize-space()='Add to cart']]"));
                for (const e of t) {
                    if ("add to cart" === (await this.textOf(e)).replace(/\s+/g, " ").trim().toLowerCase()) {
                        r = e;
                        break
                    }
                }
                if (r) break
            } catch (t) {}
            await this.sleep(500)
        }
        if (!r) throw new Error("Add to cart CTA was not found on Watch PDP.");
        console.log("    Add to cart CTA found. Pay Today is already selected."), await this.drainPerformanceLogs(), await this.clickElement(r, "Add to cart - Watch");
        const n = await this.captureAdobeWindow("Watch Add to cart");
        this.recordAction("CTA", "Add to cart", t, n, await this.driver.getCurrentUrl()), console.log("    Add to cart clicked. Adobe /b/ss hits captured: " + n.length), await this.waitForUrlPrefix(this.config.suggestionPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Security / Add-ons", this.config.suggestionPrefix), console.log("    Returned to Security / Add-ons.");
        let o = [];
        const c = Date.now();
        for (; Date.now() - c < 6e4;) {
            try {
                if (o = await this.visibleElements(By.xpath("//div[contains(@class,'protection-item')][.//input[@type='checkbox']]")), o.length >= 2) break
            } catch (t) {}
            await this.sleep(500)
        }
        if (o.length < 2) throw new Error("Could not find at least two security/add-on products from the provided protection-item structure.");
        const l = [];
        for (const t of o) try {
            const e = (await t.findElements(By.css("input[type='checkbox']")))[0];
            if (!e) continue;
            const i = await t.findElements(By.xpath(".//span[contains(@class,'fw-bold') and @data-expression]")).catch((() => []));
            let a = "";
            if (i.length && (a = await this.textOf(i[0])), !a) {
                a = (await this.textOf(t)).split(/\$|\d+\.\d{2}/)[0].replace(/\s+/g, " ").trim()
            }
            if (!a) continue;
            l.push({
                element: t,
                checkbox: e,
                text: a
            })
        } catch (t) {}
        if (l.length < 2) throw new Error("Could not identify at least two security/add-on products.");
        const d = l.sort((() => Math.random() - .5)).slice(0, 2);
        console.log("    Selecting 2 random Security / Add-on products after returning from Watch PDP.");
        for (const t of d) {
            const e = t.text;
            await this.drainPerformanceLogs(), await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", t.checkbox).catch((() => {})), await this.sleep(300);
            if (!await t.checkbox.isSelected().catch((() => !1))) try {
                await t.checkbox.click()
            } catch (e) {
                await this.driver.executeScript("arguments[0].click();", t.checkbox).catch((() => {}))
            }
            await this.sleep(500), console.log(`    Security option selected: ${e}`);
            const i = await this.captureAdobeWindow("Security selection");
            this.result.selections.push({
                type: "Security Add-on",
                value: e
            }), this.recordAction("OPTION", "Security Add-on", e, i, await this.driver.getCurrentUrl())
        }
        await this.sleep(1500);
        let h = null;
        const u = Date.now();
        for (; Date.now() - u < 3e4;) {
            try {
                const t = await this.driver.findElements(By.xpath("//div[contains(@class,'grid-content-10columns')]//button[contains(@class,'skip-button') and contains(@class,'btn-primary')][.//span[normalize-space()='Continue']]"));
                for (const e of t) try {
                    if (await e.isDisplayed() && await e.isEnabled()) {
                        h = e;
                        break
                    }
                } catch (t) {}
                if (h) break
            } catch (t) {}
            await this.sleep(500)
        }
        if (!h) throw new Error("Security / Add-ons Continue CTA was not found after selecting security products.");
        console.log("    Continue CTA found."), await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", h).catch((() => {})), await this.sleep(500), await this.drainPerformanceLogs();
        try {
            await h.click()
        } catch (t) {
            await this.driver.executeScript("arguments[0].click();", h)
        }
        const w = await this.captureAdobeWindow("Security / Add-ons Continue");
        this.recordAction("CTA", "Continue", "Security / Add-ons", w, await this.driver.getCurrentUrl()), console.log("    Security Continue clicked. Adobe /b/ss hits captured: " + w.length), await this.waitForUrlPrefix(this.config.reviewOrderPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Review Order / Cart", this.config.reviewOrderPrefix);
        const g = Date.now();
        let p = [];
        for (; Date.now() - g < 15e3;) {
            const t = (await this.captureAdobeWindow("Cart View", {
                waitMs: 1e3,
                drainBefore: !1
            })).filter((t => (t.events || []).some((t => /cart.?view|scview/i.test(String(t))))));
            if (t.length) {
                p = t;
                break
            }
            await this.sleep(500)
        }
        if (p.length) {
            const t = [...new Set(p.flatMap((t => t.events || [])))];
            this.recordAction("EVENT", "Cart View", "Review Order / Cart", p, await this.driver.getCurrentUrl()), console.log("    Cart View event captured: " + t.join(", "))
        } else console.log("    Cart View event was not captured after landing on Review Order / Cart.")
    }
    async chooseMobileNumber() {
        console.log("\n[9] Cart Page – Proceed to Checkout CTA Validation");
        const t = await this.visibleElements(By.xpath("//button[@id='b3-BtnCheckoutWeb']")).then((t => t[0]));
        if (t) {
            await this.drainPerformanceLogs(), await this.clickElement(t, "Proceed to checkout");
            const e = await this.captureAdobeWindow("Proceed to checkout"),
                i = e.filter((t => (t.events || []).some((t => /checkout.?start|sccheckout/i.test(String(t))))));
            if (this.recordAction("CTA", "Proceed to checkout", "", e, await this.driver.getCurrentUrl()), i.length) {
                const t = [...new Set(i.flatMap((t => t.events || [])))];
                this.recordAction("EVENT", "Checkout Start", "Proceed to checkout", i, await this.driver.getCurrentUrl()), console.log("    Checkout Start event captured: " + t.join(", "))
            } else console.log("    Checkout Start event was not captured after Proceed to checkout.")
        } else await this.driver.get(this.config.mobileNumberPrefix);
        await this.waitForUrlPrefix(this.config.mobileNumberPrefix, 9e4), await this.driver.wait(until.urlContains("/personal/checkout/your-mobile-number"), 9e4, "Your Mobile Number page was not reached after Proceed to checkout."), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Checkout - Mobile Number", this.config.mobileNumberPrefix), console.log("    Mobile Number pageLoad recorded: " + this.currentPageUrl);
        let e = [];
        const i = Date.now();
        for (; Date.now() - i < 3e4;) {
            try {
                const t = await this.driver.findElements(By.xpath("//div[contains(@class,'number-selection-option')]"));
                e = [];
                for (const i of t) try {
                    await i.isDisplayed() && e.push(i)
                } catch (t) {}
                if (e.length) break
            } catch (t) {}
            await this.sleep(500)
        }
        if (!e.length) throw new Error("No mobile number options were found after waiting for the page to render.");
        const a = e[Math.floor(Math.random() * e.length)],
            r = await this.textOf(a);
        await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", a).catch((() => {})), await this.drainPerformanceLogs(), await this.clickElement(a, `Mobile Number - ${r}`), console.log(`    Mobile number selected: ${r}`), this.result.selections.push({
            type: "Mobile Number",
            value: r
        });
        const s = await this.captureAdobeWindow("Mobile number selection");
        this.recordAction("OPTION", "Mobile Number", r, s, await this.driver.getCurrentUrl());
        const n = await this.driver.wait(until.elementLocated(By.xpath("//button[contains(@class,'add-plan-btn')][.//span[normalize-space()='Next']]")), this.timeout);
        await this.driver.wait((async () => !await n.getAttribute("disabled") && await n.isEnabled()), this.timeout, "Next CTA remained disabled after mobile number selection."), await this.drainPerformanceLogs(), await this.clickElement(n, "Next - Mobile Number");
        const o = await this.captureAdobeWindow("Next after mobile number");
        this.recordAction("CTA", "Next - Mobile Number", "", o, await this.driver.getCurrentUrl()), await this.waitForUrlPrefix(this.config.reviewDetailPrefix), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Checkout - Review Detail", this.config.reviewDetailPrefix)
    }
    async deliveryFlow() {
        console.log("\n[10] Delivery + Date/Time Popup"), await this.driver.wait((async () => {
            try {
                return await this.driver.executeScript("return document.readyState === 'complete';")
            } catch (t) {
                return !1
            }
        }), 6e4, "Review Detail page did not finish loading."), await this.driver.wait(until.elementLocated(By.xpath("//*[normalize-space()='Select delivery options and review']")), 6e4, "Delivery section did not render on Review Detail page.");
        let t = null;
        const e = Date.now();
        for (; Date.now() - e < 6e4;) {
            try {
                const e = await this.driver.findElements(By.xpath("//input[@type='radio' and @value='standard_delivery']"));
                for (const i of e)
                    if (await i.isDisplayed()) {
                        t = i;
                        break
                    } if (t) break
            } catch (t) {}
            await this.sleep(1e3)
        }
        if (!t) throw new Error("Standard delivery option was not found after waiting for the Review Detail page to render.");
        const i = await t.findElement(By.xpath("ancestor::div[contains(@class,'delivery-available-item')][1]"));
        await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", i).catch((() => {})), await this.drainPerformanceLogs(), await this.clickElement(i, "Standard Delivery");
        const a = await this.captureAdobeWindow("Standard delivery selection");
        this.recordAction("POPUP_OPTION", "Delivery", "Standard Delivery", a, await this.driver.getCurrentUrl()), await this.driver.wait(until.elementLocated(By.xpath("//*[normalize-space()='Select an address']")), 6e4, "Standard delivery address interface did not render.");
        const r = await this.driver.wait(until.elementLocated(By.css("input[type='radio'][name*='rdo_Address'][checked], input[type='radio'][value][checked]")), 6e4, "No pre-selected delivery address was found.");
        await r.isSelected().catch((() => !1)) || await this.driver.executeScript("arguments[0].click();", r), console.log("    Existing delivery address is selected.");
        const s = await this.driver.wait(until.elementLocated(By.xpath("//button[.//*[normalize-space()='Next, select date & time'] or normalize-space()='Next, select date & time']")), 6e4, "'Next, select date & time' CTA was not found.");
        await this.driver.wait((async () => await s.isDisplayed() && await s.isEnabled()), 3e4), await this.drainPerformanceLogs(), await this.clickElement(s, "Next, select date & time");
        const n = await this.captureAdobeWindow("Delivery date popup");
        this.recordAction("CTA", "Next, select date & time", "", n, await this.driver.getCurrentUrl()), await this.driver.wait(until.elementLocated(By.css("[popupnameattribute='Delivery Timeslot']")), 6e4, "Delivery Timeslot popup did not open."), await this.driver.wait(until.elementLocated(By.css("select[id*='dd_DeliveryDate']")), 6e4, "Delivery date dropdown was not found.");
        const o = new Date;
        o.setHours(0, 0, 0, 0), o.setDate(o.getDate() + 2);
        const c = o.toLocaleDateString("en-US", {
                day: "numeric",
                month: "long",
                year: "numeric"
            }),
            l = await this.driver.findElement(By.css("select[id*='dd_DeliveryDate']")),
            d = await this.driver.executeScript("\n    const select = arguments[0];\n    const target = new Date(arguments[1]);\n    const day = String(target.getDate());\n    const month = target.toLocaleDateString('en-US', { month: 'long' });\n    const year = String(target.getFullYear());\n    const wantedDayFirst = (day + ' ' + month + ' ' + year).toLowerCase();\n    const wantedMonthFirst = (month + ' ' + day + ', ' + year).toLowerCase();\n    const isoDate = year + '-' + String(target.getMonth() + 1).padStart(2, '0') + '-' + String(target.getDate()).padStart(2, '0');\n    let index = -1;\n    for (let i = 0; i < select.options.length; i++) {\n        const option = select.options[i];\n        const text = String(option.textContent || '').replace(/s+/g, ' ').trim().toLowerCase();\n        const value = String(option.value || '').replace(/s+/g, ' ').trim().toLowerCase();\n        if (text.includes(wantedDayFirst) || text.includes(wantedMonthFirst) || value.includes(isoDate)) { index = i; break; }\n        const parsed = new Date(text);\n        if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() === target.getFullYear() && parsed.getMonth() === target.getMonth() && parsed.getDate() === target.getDate()) { index = i; break; }\n    }\n    if (index < 0) return { index: -1, options: Array.from(select.options).map(o => o.textContent.trim()) };\n    select.selectedIndex = index;\n    select.dispatchEvent(new Event('change', { bubbles: true }));\n    select.dispatchEvent(new Event('input', { bubbles: true }));\n    return { index, value: select.options[index].textContent.trim() };\n", l, o.getTime());
        if (!d || d.index < 0) throw new Error(`Could not find delivery date for +2 days (${c}). Available dates: ${d?.options?.join(" | ")||"none"}`);
        console.log(`    Delivery date selected: ${d.value}`), this.result.selections.push({
            type: "Delivery Date",
            value: d.value
        });
        const h = await this.captureAdobeWindow("Delivery date selection");
        this.recordAction("POPUP_OPTION", "Delivery Date", d.value, h, await this.driver.getCurrentUrl());
        const u = await this.visibleElements(By.xpath("//*[contains(@class,'selection-tab')][.//*[contains(normalize-space(.),'am') or contains(normalize-space(.),'pm')]]"));
        if (!u.length) throw new Error("No delivery time slots were found.");
        const w = u[Math.floor(Math.random() * u.length)],
            g = await this.textOf(w);
        await this.drainPerformanceLogs(), await this.clickElement(w, `Delivery time - ${g}`), console.log(`    Delivery time selected: ${g}`), this.result.selections.push({
            type: "Delivery Time",
            value: g
        });
        const p = await this.captureAdobeWindow("Delivery time selection");
        this.recordAction("POPUP_OPTION", "Delivery Time", g, p, await this.driver.getCurrentUrl());
        const m = await this.driver.wait(until.elementLocated(By.css("#b3-b80-b14-ConfirmButton")), 3e4, "Confirm CTA was not found in delivery date/time popup.");
        await this.driver.wait((async () => await m.isDisplayed() && await m.isEnabled()), 3e4), await this.drainPerformanceLogs(), await this.clickElement(m, "Confirm delivery date/time");
        const f = await this.captureAdobeWindow("Delivery confirmation");
        this.recordAction("CTA", "Confirm delivery date/time", `${d.value} ${g}`, f, await this.driver.getCurrentUrl()), await this.driver.wait((async () => {
            try {
                return 0 === (await this.driver.findElements(By.css("[popupnameattribute='Delivery Timeslot']"))).length
            } catch (t) {
                return !1
            }
        }), 6e4, "Delivery Timeslot popup did not close after confirmation."), await this.driver.wait(until.elementLocated(By.css("#b3-Ack")), 6e4, "Review Detail agreement section did not render after delivery confirmation."), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Checkout - Review Detail After Delivery", this.config.reviewDetailPrefix)
    }
    async confirmAndPay() {
        console.log("\n[11] Confirm and Pay + CVV");
        const t = await this.visibleElements(By.css("#b3-Ack"));
        if (!t.length) throw new Error("Required T&Cs checkbox #b3-Ack was not found.");
        if (!await t[0].isSelected().catch((() => !1))) {
            await this.drainPerformanceLogs(), await this.clickElement(t[0], "T&Cs checkbox");
            const e = await this.captureAdobeWindow("T&Cs checkbox");
            this.recordAction("CHECKBOX", "b3-Ack", "Selected", e, await this.driver.getCurrentUrl())
        }
        const e = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'confirm and pay')]")).then((t => t[0]));
        if (!e) throw new Error("Confirm and Pay CTA was not found.");
        await this.drainPerformanceLogs(), await this.clickElement(e, "Confirm and Pay");
        const i = await this.driver.getCurrentUrl(),
            a = await this.captureAdobeWindow("Confirm and Pay");
        this.recordAction("CTA", "Confirm and Pay", "", a, await this.driver.getCurrentUrl()), console.log("    Confirm and Pay clicked. Waiting for the site to reload/navigate to the next page..."), await this.driver.wait((async () => {
            try {
                return await this.driver.getCurrentUrl() !== i
            } catch (t) {
                return !1
            }
        }), 6e4, "Site did not navigate after Confirm and Pay."), await this.waitForPageReady(6e4), await this.sleep(2e3);
        const r = await this.captureAdobeWindow("Post Confirm and Pay pageLoad", {
            isPageLoad: !0
        });
        this.recordAction("PAGE_LOAD", "Post Confirm and Pay", r.length ? "pageLoad captured" : "pageLoad not captured", r, await this.driver.getCurrentUrl()), console.log("    Next page loaded after Confirm and Pay.");
        if (!(await this.driver.getCurrentUrl()).toLowerCase().includes("checkout-success")) {
            const t = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'done') or contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'confirm')]")).then((t => t.find((async t => await t.isDisplayed().catch((() => !1))))));
            if (t) {
                await this.drainPerformanceLogs(), await this.clickElement(t, "Done/Confirm");
                const e = await this.captureAdobeWindow("Done/Confirm");
                this.recordAction("CTA", "Done/Confirm", "", e, await this.driver.getCurrentUrl()), console.log("    Done/Confirm CTA clicked. Waiting for success page...")
            } else console.log("    No intermediate Done/Confirm CTA found; continuing with direct success-page flow.")
        }
    }
    async threeDsAndSuccess() {
        console.log("\n[12] 3DS + Order Success");
        (await this.driver.getCurrentUrl()).toLowerCase().includes("checkout-success") || await this.driver.wait((async () => {
            const t = (await this.driver.getCurrentUrl()).toLowerCase();
            return t.includes("checkout-success") || t.includes("3ds") || t.includes("three")
        }), 12e4, "Neither 3DS nor success page was reached after Confirm and Pay.");
        if ((await this.driver.getCurrentUrl()).toLowerCase().includes("checkout-success")) {
            this.currentPageUrl = await this.driver.getCurrentUrl();
            (await this.recordPage("Order Success", this.config.successPrefix)).hits;
            return this.result.orders.push(), void console.log("    Direct order success page reached: " + this.currentPageUrl)
        }
        await this.waitForUrlPrefix(this.config.threeDsPrefix, 6e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("3DS Loading Page", this.config.threeDsPrefix);
        const t = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'submit') or contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'proceed')]")).then((t => t[0]));
        if (!t) throw new Error("3DS Submit CTA was not found.");
        await this.drainPerformanceLogs(), await this.clickElement(t, "3DS Submit");
        const e = await this.captureAdobeWindow("3DS Submit");
        this.recordAction("CTA", "3DS Submit", "", e, await this.driver.getCurrentUrl()), await this.waitForUrlPrefix(this.config.successPrefix, 12e4), this.currentPageUrl = await this.driver.getCurrentUrl();
        const i = (await this.recordPage("Order Success", this.config.successPrefix)).hits;
        if (!this.result.orders.filter((t => t.pageUrl && t.pageUrl.toLowerCase().includes("checkout-success"))).length && i.length)
            for (const t of i)(t.orderId || t.revenue || t.products || t.events.length) && this.result.orders.push({
                pageUrl: this.currentPageUrl,
                pageName: t.pageName,
                orderId: t.orderId,
                revenue: t.revenue,
                products: t.products,
                events: t.events,
                eVars: t.eVars,
                props: t.props,
                timestamp: t.timestamp
            });
        console.log("    Order success page reached: " + this.currentPageUrl)
    }
    async run() {
        await this.createDriver();
        try {
            return this.result.summary.steps = 12, await this.login(), await this.stepHome(), await this.chooseDevice(), await this.choosePdpOptions(), await this.chooseIntent(), await this.chooseStarPlan(), await this.chooseSim(), await this.chooseSecurityAndWatch(), await this.chooseMobileNumber(), await this.deliveryFlow(), await this.confirmAndPay(), await this.threeDsAndSuccess(), this.result.summary.pagesVisited = this.result.pages.length, this.result.summary.adobeHits = this.result.hits.length, this.result.summary.ecommerceEvents = this.result.ecommerceEvents.length, this.result.summary.productsCaptured = this.result.products.length, this.result.summary.ordersCaptured = this.result.orders.length, this.result.summary.passed = this.result.pages.filter((t => "PASS" === t.status)).length, this.result.summary.failed = this.result.pages.filter((t => "FAIL" === t.status)).length, this.result.summary.status = 0 === this.result.summary.failed && 0 === this.result.errors.length ? "PASS" : "FAIL", this.result.finishedAt = (new Date).toISOString(), this.result
        } catch (t) {
            throw this.result.errors.push({
                timestamp: (new Date).toISOString(),
                step: this.result.pages.length + 1,
                error: t.message || String(t),
                currentUrl: this.driver ? await this.driver.getCurrentUrl().catch((() => "")) : ""
            }), this.result.summary.status = "FAIL", this.result.summary.pagesVisited = this.result.pages.length, this.result.summary.adobeHits = this.result.hits.length, this.result.summary.ecommerceEvents = this.result.ecommerceEvents.length, this.result.summary.productsCaptured = this.result.products.length, this.result.summary.ordersCaptured = this.result.orders.length, this.result.finishedAt = (new Date).toISOString(), t
        } finally {
            await this.close()
        }
    }
}
module.exports = PreSalesJourneyValidator;