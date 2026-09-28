const {
    Builder,
    By,
    Key,
    until
} = require("selenium-webdriver"), chrome = require("selenium-webdriver/chrome");
class PreSalesJourneyValidator {
    constructor(t = {}) {
        this.startUrl = t.startUrl || "https://starhubltd-tst.outsystemsenterprise.com/personal/login", this.credentials = t.credentials || {}, this.config = t.journeyConfig || {}, this.maxAdobeWait = t.maxAdobeWait || 6e4, this.networkQuietTime = t.networkQuietTime || 4e3, this.pollInterval = t.pollInterval || 250, this.timeout = t.timeout || 9e4, this.driver = null, this.paymentOptionPrompt = t.paymentOptionPrompt || null, this.payLaterPeriod = t.payLaterPeriod || null, this.simType = t.simType || null, this.result = {
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
        }, this.seenHitKeys = new Set, this.lastRecordedPageName = ""
    }
    async createDriver() {
        if (this.driver) return this.driver;
        const t = new chrome.Options;
        return t.addArguments("--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--window-size=1920,1080", "--disable-popup-blocking", "--disable-notifications", "--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-features=TranslateUI"), t.setLoggingPrefs({
            performance: "ALL",
            browser: "ALL"
        }), this.driver = await new Builder().forBrowser("chrome").setChromeOptions(t).build(), this.driver
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
        return new Promise(e => setTimeout(e, t))
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
            return JSON.parse(t.message).message
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
                a = i.findIndex(t => "b" === t.toLowerCase());
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
        return {
            timestamp: new Date().toISOString(),
            requestId: i || "",
            url: t,
            pathName: n,
            reportSuite: s,
            pageName: r.pageName || r.gn || r.v1 || "",
            events: o.map(t => t.name),
            eventDetails: o,
            eVars: c,
            props: l,
            products: r.products || "",
            orderId: r.purchaseID || r.purchaseId || r.transactionID || r.orderId || r.oid || "",
            revenue: r.purchaseamount || r.purchaseAmount || r.revenue || r.amount || "",
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
            t.length && (n.push(...t), s = Date.now()), n.length && s && Date.now() - s >= a ? void 0 : await this.sleep(this.pollInterval)
        }
        return n.length && this.addHitData(n), n
    }
    async waitForElement(t, e = 6e4) {
        const i = Date.now();
        for (; Date.now() - i < e;) {
            try {
                const e = await this.driver.findElements(t);
                for (const t of e)
                    if (await t.isDisplayed().catch(() => !1) && await t.isEnabled().catch(() => !1)) return t
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
    async clickElement(t, e = "") {
        await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", t).catch(() => {}), await this.sleep(400);
        try {
            await t.click()
        } catch (e) {
            await this.driver.executeScript("arguments[0].click();", t)
        }
    }
    async waitForUrlPrefix(t, e = 6e4) {
        const i = Date.now();
        for (; Date.now() - i < e;) {
            try {
                const e = await this.driver.getCurrentUrl();
                if (e && e.toLowerCase().startsWith(t.toLowerCase())) return e
            } catch (t) {}
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
            return await this.driver.executeScript(`try{const layers=[window.adobeDataLayer,window.dataLayer];for(const layer of layers){if(!Array.isArray(layer))continue;for(let i=layer.length-1;i>=0;i--){const x=layer[i];if(!x||typeof x!=="object")continue;if(x.pageName)return String(x.pageName).trim();if(x.page&&x.page.pageName)return String(x.page.pageName).trim();if(x.pageData&&x.pageData.pageName)return String(x.pageData.pageName).trim();if(x.analytics&&x.analytics.pageName)return String(x.analytics.pageName).trim()}}}catch(e){}return""`)
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
        await this.waitForPageReady();
        const i = await this.driver.getCurrentUrl(),
            a = await this.driver.getTitle().catch(() => "");
        this.currentPageUrl = i;
        const r = this.lastRecordedPageName || "",
            s = await this.waitForPageName(r, 3500),
            n = await this.captureAdobeWindow(`${t} pageLoad`, {
                isPageLoad: true
            }),
            o = [...n].reverse().map(t => String(t && t.pageName ? t.pageName : "").trim()).find(Boolean) || [...this.result.hits].slice(-10).reverse().map(t => String(t && t.pageName ? t.pageName : "").trim()).find(Boolean) || "";
        let c = "";
        !s || r && s === r ? o ? c = o : s && (c = s) : c = s, this.lastRecordedPageName = c || r || "";
        const l = n.length ? n : o ? this.result.hits.slice(-10).filter(t => String(t && t.pageName ? t.pageName : "").trim() === o) : [],
            d = [...new Set(l.flatMap(t => Array.isArray(t.events) ? t.events : []))];
        return this.result.pages.push({
            step: t,
            url: i,
            expectedPrefix: e,
            title: a,
            pageName: c,
            pageLoadCaptured: n.length > 0 || !!o,
            adobeHitCount: n.length ? n.length : l.length,
            eventsFound: d,
            status: n.length || c ? "PASS" : "FAIL",
            hits: l
        }), this.result.pages[this.result.pages.length - 1]
    }
    recordAction(t, e, i, a, r) {
        const s = [...new Set((a || []).flatMap(t => t.events || []))],
            n = {
                action: t,
                label: e,
                value: i || "",
                pageUrl: r || this.currentPageUrl || "",
                timestamp: new Date().toISOString(),
                adobeHitCount: (a || []).length,
                events: s,
                hits: a || []
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
            }), (e.orderId || e.revenue || e.events.some(t => /purchase|order.?success/i.test(t))) && this.result.orders.push({
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
        await this.drainPerformanceLogs(), await this.driver.get(i), await this.waitForUrlPrefix(e), this.currentPageUrl = await this.driver.getCurrentUrl();
        return this.recordPage(t, e)
    }
    async clickAndRecord(t, e, i = "", a = "") {
        await this.drainPerformanceLogs(), await e();
        const r = await this.captureAdobeWindow(t);
        return i && await this.waitForUrlPrefix(i), this.currentPageUrl = await this.driver.getCurrentUrl(), this.recordAction("CTA", a || t, "", r, this.currentPageUrl), r
    }

    async login() {
        console.log("\n[1] Login");
        const t = this.config.startUrl || this.startUrl;
        await this.drainPerformanceLogs(), await this.driver.get(t), await this.waitForUrlPrefix(t, 9e4), await this.waitForPageReady(3e4);
        let e = null,
            i = null;
        const a = Date.now();
        for (; Date.now() - a < 3e4 && !e && !i;) {
            try {
                await this.driver.switchTo().defaultContent();
                let t = await this.driver.findElements(By.css("input"));
                for (const a of t) {
                    if (!await a.isDisplayed().catch(() => !1)) continue;
                    const t = ((await a.getAttribute("type").catch(() => "")) + " " + (await a.getAttribute("name").catch(() => "")) + " " + (await a.getAttribute("id").catch(() => "")) + " " + (await a.getAttribute("placeholder").catch(() => "")) + " " + (await a.getAttribute("autocomplete").catch(() => ""))).toLowerCase(),
                        r = (await a.getAttribute("type").catch(() => "")).toLowerCase();
                    "password" !== r && !e && (/email|user.?name|hub.?id|login|account/.test(t) || "text" === r) && (e = a), "password" === r && !i && (i = a)
                }
                if (!e || !i) {
                    const a = await this.driver.findElements(By.css("iframe"));
                    for (const r of a) {
                        if (e && i) break;
                        try {
                            await this.driver.switchTo().defaultContent(), await this.driver.switchTo().frame(r);
                            const t = await this.driver.findElements(By.css("input"));
                            for (const a of t) {
                                if (!await a.isDisplayed().catch(() => !1)) continue;
                                const t = ((await a.getAttribute("type").catch(() => "")) + " " + (await a.getAttribute("name").catch(() => "")) + " " + (await a.getAttribute("id").catch(() => "")) + " " + (await a.getAttribute("placeholder").catch(() => "")) + " " + (await a.getAttribute("autocomplete").catch(() => ""))).toLowerCase(),
                                    r = (await a.getAttribute("type").catch(() => "")).toLowerCase();
                                "password" !== r && !e && (/email|user.?name|hub.?id|login|account/.test(t) || "text" === r) && (e = a), "password" === r && !i && (i = a)
                            }
                        } catch (t) {
                            await this.driver.switchTo().defaultContent().catch(() => {})
                        }
                    }
                }
            } catch (t) {}
            if (!e || !i) await this.sleep(500)
        }
        if (!e || !i) {
            await this.driver.switchTo().defaultContent().catch(() => {});
            const t = await this.driver.executeScript("return document.body?document.body.innerText:''").catch(() => "");
            this.result.selections.push({
                type: "Login Diagnostics",
                url: await this.driver.getCurrentUrl(),
                title: await this.driver.getTitle().catch(() => ""),
                bodyText: String(t).slice(0, 5000)
            });
            throw new Error(`Login fields not found. Username: ${e?"FOUND":"NOT FOUND"}, Password: ${i?"FOUND":"NOT FOUND"}, URL: ${await this.driver.getCurrentUrl()}`)
        }
        await e.clear(), await e.sendKeys(this.credentials.hubId || ""), await i.clear(), await i.sendKeys(this.credentials.hubPassword || "");
        const r = await this.visibleElements(By.xpath("//button[normalize-space(.)='Login' or .//*[normalize-space(.)='Login'] or contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login')] | //input[@type='submit']")).then(t => t[0]).catch(() => null);
        await this.drainPerformanceLogs();
        if (r) await this.clickElement(r, "Login");
        else await i.sendKeys(Key.ENTER);
        const s = await this.captureAdobeWindow("Login CTA", {
            timeout: 2e4,
            quietTime: 2500
        });
        this.recordAction("CTA", "Login", "", s, await this.driver.getCurrentUrl()), await this.driver.switchTo().defaultContent().catch(() => {}), await this.waitForUrlPrefix(this.config.homeUrlPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl();
        const n = await this.captureAdobeWindow("Login Page pageLoad", {
                timeout: 15e3,
                quietTime: 2500
            }),
            o = [...n].reverse().map(t => String(t && t.pageName ? t.pageName : "").trim()).find(Boolean) || "";
        this.result.pages.push({
            step: "Login Page",
            url: t,
            expectedPrefix: t,
            title: await this.driver.getTitle().catch(() => ""),
            pageName: o,
            pageLoadCaptured: n.length > 0,
            adobeHitCount: n.length,
            eventsFound: [...new Set(n.flatMap(t => t.events || []))],
            status: n.length || o ? "PASS" : "FAIL",
            hits: n
        }), this.result.authentication = {
            status: "SUCCESS",
            account: "Test Account"
        }, console.log("    Login successful. Landed on: " + this.currentPageUrl)
    }

    async stepHome() {
        console.log("\n[2] Mobile Plans / Landing"), await this.recordPage("Mobile Plans / Landing", this.config.homeUrlPrefix);
        const t = await this.visibleElements(By.xpath("//*[self::a or self::button or @role='button'][contains(normalize-space(.),'See more devices')]")).then(t => t[0]);
        if (!t) throw new Error("CTA 'See more devices' was not found.");
        await this.clickAndRecord("See More Devices CTA", () => this.clickElement(t, "See more devices"), this.config.deviceListingPrefix, "See more devices"), await this.recordPage("Mobile Device Listing", this.config.deviceListingPrefix)
    }
    async isCurrentProductOutOfStock() {
        try {
            return await this.driver.executeScript(() => {
                const t = t => {
                        if (!t) return !1;
                        const e = getComputedStyle(t),
                            i = t.getBoundingClientRect();
                        return "none" !== e.display && "hidden" !== e.visibility && i.width > 0 && i.height > 0
                    },
                    e = /(?:out\s*of\s*stock|sold\s*out|currently\s*unavailable|not\s*available|unavailable|no\s*stock)/i,
                    a = /(?:add\s*to\s*(?:cart|basket)|buy\s*now|available\s*now)/i,
                    r = [];
                for (const e of ["[data-container]", "button", "label", "span", "div", "p"])
                    for (const i of document.querySelectorAll(e)) {
                        if (!t(i)) continue;
                        const t = String(i.innerText || i.textContent || "").replace(/\s+/g, " ").trim();
                        t && t.length <= 180 && e.test(t) && r.push(t)
                    }
                return !Array.from(document.querySelectorAll("button,a,[role='button']")).some(e => t(e) && a.test(String(e.innerText || e.textContent || ""))) && r.length > 0
            })
        } catch (t) {
            return !1
        }
    }
    async findIphone17ProMaxCards(t = 9e4) {
        const e = Date.now();
        for (; Date.now() - e < t;) {
            const t = await this.driver.executeScript(() => {
                const t = t => String(t || "").replace(/\s+/g, " ").trim(),
                    e = [];
                return Array.from(document.querySelectorAll(".product-item-card")).forEach((i, a) => {
                    const r = t(i.innerText || i.textContent || ""),
                        s = i.querySelector(".content-section .f-h6, .content-section span.f-h6"),
                        n = t(s ? s.innerText || s.textContent : ""),
                        o = i.querySelector("img"),
                        c = t(o ? o.getAttribute("src") : ""),
                        l = `${n} ${r} ${c}`.toLowerCase();
                    l.includes("iphone 17") && (l.includes("iphone 17 pro max") || l.includes("iphone-17-pro-max")) && e.push({
                        index: a,
                        model: n || "iPhone 17 Pro Max",
                        text: r.slice(0, 300),
                        imageSrc: c
                    })
                }), e
            }).catch(() => []);
            if (t.length) return t;
            await this.driver.executeScript("window.scrollTo(0,document.body.scrollHeight)").catch(() => {}), await this.sleep(1200), await this.driver.executeScript("window.scrollTo(0,0)").catch(() => {}), await this.sleep(1200)
        }
        return []
    }
    async chooseDevice() {
        console.log("\n[3] Mobile Device Listing -> Random iPhone 17 Pro Max");
        const t = new Set;
        let e = "";
        for (let i = 1; i <= 8; i++) {
            console.log(`    Device selection attempt ${i}/8`), await this.waitForPageReady(9e4);
            (await this.driver.getCurrentUrl()).toLowerCase().startsWith(this.config.deviceListingPrefix.toLowerCase()) || (await this.driver.get(this.config.deviceListingPrefix), await this.waitForUrlPrefix(this.config.deviceListingPrefix, 9e4));
            const a = await this.findIphone17ProMaxCards(9e4);
            if (!a.length) throw new Error("No iPhone 17 Pro Max product cards were found.");
            let r = a.filter(e => !t.has(e.model));
            r.length || (r = a);
            const s = r[Math.floor(Math.random() * r.length)];
            t.add(s.model), this.result.selections.push({
                type: "Device Attempt",
                value: s.model,
                attempt: i
            }), await this.drainPerformanceLogs();
            const n = await this.driver.executeScript(t => {
                const e = Array.from(document.querySelectorAll(".product-item-card"))[t];
                if (!e) return !1;
                const i = [e.querySelector(".content-section > div[style*='cursor']"), e.querySelector(".image-section > div[style*='cursor']"), e.querySelector(".content-section"), e.querySelector(".image-section")].filter(Boolean)[0];
                return !!i && (i.scrollIntoView({
                    block: "center"
                }), i.click(), !0)
            }, s.index).catch(() => !1);
            if (!n) {
                e = `iPhone 17 Pro Max card '${s.model}' could not be clicked.`;
                continue
            }
            const o = await this.captureAdobeWindow("iPhone 17 Pro Max prodClick", {
                timeout: 3e4,
                quietTime: 2500
            });
            this.recordAction("PRODUCT_CLICK", "iPhone 17 Pro Max", s.model, o, await this.driver.getCurrentUrl());
            try {
                await this.waitForUrlPrefix(this.config.productPdpPrefix, 9e4)
            } catch (t) {
                e = t.message || String(t), await this.driver.get(this.config.deviceListingPrefix), await this.waitForUrlPrefix(this.config.deviceListingPrefix, 9e4);
                continue
            }
            this.currentPageUrl = await this.driver.getCurrentUrl();
            const c = await this.recordPage("iPhone 17 Pro Max PDP", this.config.productPdpPrefix);
            if (!await this.isCurrentProductOutOfStock()) return this.result.selections.push({
                type: "Device Availability",
                value: `${s.model} - IN STOCK`,
                url: this.currentPageUrl,
                attempt: i
            });
            this.result.selections.push({
                type: "Device Availability",
                value: `${s.model} - OUT OF STOCK`,
                url: this.currentPageUrl,
                attempt: i
            }), await this.driver.get(this.config.deviceListingPrefix), await this.waitForUrlPrefix(this.config.deviceListingPrefix, 9e4), await this.waitForPageReady(9e4)
        }
        throw new Error(e || "Could not find an in-stock iPhone 17 Pro Max after 8 attempts.")
    }
    async getRadioGroups() {
        const t = await this.driver.findElements(By.css("input[type='radio']")),
            e = new Map;
        for (const i of t) try {
            if (!await i.isDisplayed() || !await i.isEnabled()) continue;
            const t = await i.getAttribute("name") || "",
                a = await i.getAttribute("id") || "",
                r = t || await i.getAttribute("data-group") || a;
            if (!r) continue;
            const s = await this.findRadioLabel(i);
            s && (e.has(r) || e.set(r, []), e.get(r).push({
                radio: i,
                label: s
            }))
        } catch (t) {}
        return [...e.entries()].map(([t, e]) => ({
            key: t,
            options: e
        }))
    }
    async findRadioLabel(t) {
        const e = await t.getAttribute("id").catch(() => "");
        if (e) {
            const t = await this.driver.findElements(By.css(`label[for="${e.replace(/"/g,'\\"')}"]`));
            if (t.length) return this.textOf(t[0])
        }
        return this.driver.executeScript("return arguments[0].parentElement?arguments[0].parentElement.innerText:'';", t).then(t => String(t || "").replace(/\s+/g, " ").trim()).catch(() => "")
    }
    async selectRadioFromGroup(t, e) {
        const i = t.options[Math.floor(Math.random() * t.options.length)],
            a = i.label;
        this.result.selections.push({
            type: e,
            value: a
        }), await this.drainPerformanceLogs(), await this.clickElement(i.radio, `${e} - ${a}`);
        const r = await this.captureAdobeWindow(`${e} selection`);
        this.recordAction("OPTION", e, a, r, await this.driver.getCurrentUrl())
    }
    async choosePdpOptions() {
        console.log("\n[4] iPhone 17 Pro Max PDP");
        const t = await this.getRadioGroups();
        let e = t.find(t => /color|colour/i.test(t.key)),
            i = t.find(t => /storage|size|capacity|gb/i.test(t.key) && t !== e),
            a = new Set;
        if (e && (await this.selectRadioFromGroup(e, "Color"), a.add(e.key)), i && !a.has(i.key) && (await this.selectRadioFromGroup(i, "Size/Storage"), a.add(i.key)), !e || !i) {
            const r = t.filter(t => !a.has(t.key) && !/payment|pay|monthly/i.test(t.key));
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
                    if (!["12", "24", "36"].includes(t)) throw new Error(`Invalid Pay Later period: ${t}`);
                    for (const e of await this.driver.findElements(By.css(`[aa_linktext="${t}-month"]`)))
                        if (await e.isDisplayed().catch(() => !1)) {
                            o = e;
                            break
                        }
                } else
                    for (const t of await this.driver.findElements(By.css('[aa_linktext="Pay today"],.shop-option.paymentoption-selection-option'))) try {
                        const e = (await t.getText()).replace(/\s+/g, " ").trim().toLowerCase(),
                            i = (await t.getAttribute("aa_linktext") || "").trim().toLowerCase();
                        if (await t.isDisplayed() && (i === "pay today" || e === "pay today" || e.includes("pay today"))) {
                            o = t;
                            break
                        }
                    } catch (t) {}
            } catch (t) {}
            if (o) break;
            await this.sleep(500)
        }
        if (!o) throw new Error(`Payment option '${n}' was not found on PDP.`);
        await this.drainPerformanceLogs(), await this.clickElement(o, n);
        const l = await this.captureAdobeWindow("Payment option selection", {
            timeout: 3e4,
            quietTime: 2500
        });
        this.recordAction("OPTION", "Payment Option", n, l, await this.driver.getCurrentUrl());
        let d = null;
        const h = Date.now();
        for (; Date.now() - h < 6e4;) {
            try {
                for (const t of await this.driver.findElements(By.css("#b5-b16-NextCTA button")))
                    if (await t.isDisplayed().catch(() => !1) && await t.isEnabled().catch(() => !1)) {
                        const e = await t.getAttribute("aria-disabled") || "",
                            i = await t.getAttribute("disabled");
                        if (null === i && "true" !== e.toLowerCase()) {
                            const e = (await t.getText()).replace(/\s+/g, " ").trim();
                            if (/\bnext\b/i.test(e)) {
                                d = t;
                                break
                            }
                        }
                    }
            } catch (t) {}
            if (d) break;
            await this.sleep(500)
        }
        if (!d) throw new Error("Next CTA was not found or did not become enabled on the iPhone PDP.");
        const u = await d.getAttribute("outerHTML").catch(() => ""),
            w = (await d.getText()).replace(/\s+/g, " ").trim(),
            g = await d.getAttribute("id") || "",
            p = await d.getAttribute("class") || "";
        this.result.selections.push({
            type: "PDP Next CTA",
            value: w || "Next",
            selector: "#b5-b16-NextCTA button",
            id: g,
            className: p,
            outerHTML: u
        }), await this.drainPerformanceLogs(), await this.clickElement(d, "Next - iPhone");
        const m = await this.captureAdobeWindow("Next - iPhone / scAdd", {
                timeout: 3e4,
                quietTime: 2500
            }),
            f = m.filter(t => (t.events || []).some(t => /^scAdd$/i.test(t)) || (t.eventDetails || []).some(t => /^scAdd$/i.test(t.name)));
        const y = this.recordAction("CTA", "Next - iPhone", n, m, await this.driver.getCurrentUrl());
        y.nextCta = {
            selector: "#b5-b16-NextCTA button",
            text: w || "Next",
            id: g,
            className: p,
            outerHTML: u
        }, y.scAddCaptured = f.length > 0, y.scAddHitCount = f.length, y.scAddHits = f, this.result.selections.push({
            type: "PDP scAdd Validation",
            value: f.length ? "scAdd captured" : "scAdd not captured",
            scAddCaptured: f.length > 0,
            scAddHitCount: f.length,
            hits: f
        }), await this.waitForUrlPrefix(this.config.intentPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Intent Selection", this.config.intentPrefix)
    }
    async getNextCtaOnCurrentPage(t = 6e4) {
        const e = Date.now();
        for (; Date.now() - e < t;) {
            try {
                const t = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][normalize-space(.)='Next' or contains(normalize-space(.),'Next') or contains(normalize-space(.),'Continue') or contains(normalize-space(.),'Proceed')]"));
                for (const e of t) {
                    const t = await this.textOf(e);
                    if (/\b(next|continue|proceed)\b/i.test(t)) return e
                }
            } catch (t) {}
            await this.sleep(500)
        }
        return null
    }
    async chooseIntent() {
        console.log("\n[5] Signup for New / Select Line"), await this.waitForPageReady(9e4), this.currentPageUrl = await this.driver.getCurrentUrl();
        const t = await this.driver.findElements(By.xpath("//*[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'reached the maximum of mobile lines allowed by imda')]")).then(async t => {
            for (const e of t)
                if (await e.isDisplayed().catch(() => !1)) return e;
            return null
        }).catch(() => null);
        if (t) {
            const e = await this.visibleElements(By.css(".number-selection-option"));
            if (!e.length) throw new Error("Maximum mobile-line limit displayed, but no existing StarHub number options were found.");
            const i = e[Math.floor(Math.random() * e.length)],
                a = await this.textOf(i);
            this.result.selections.push({
                type: "Existing StarHub Number",
                value: a
            }), await this.drainPerformanceLogs(), await this.clickElement(i, "Existing StarHub Number");
            const r = await this.captureAdobeWindow("Existing StarHub number selection");
            this.recordAction("OPTION", "Existing StarHub Number", a, r, await this.driver.getCurrentUrl())
        } else {
            const t = await this.driver.wait(async () => {
                const t = await this.driver.findElements(By.xpath("//div[contains(@class,'number-card-detail_v2')][.//span[normalize-space()='Sign up for a new line']]"));
                for (const e of t)
                    if (await e.isDisplayed().catch(() => !1)) return e;
                return !1
            }, 6e4);
            if (!t) throw new Error("'Sign up for a new line' option was not found.");
            const e = await this.textOf(t);
            this.result.selections.push({
                type: "Intent",
                value: e
            }), await this.drainPerformanceLogs(), await this.clickElement(t, "Sign up for a new line");
            const i = await this.captureAdobeWindow("Signup for new selection");
            this.recordAction("OPTION", "Sign up for a new line", e, i, await this.driver.getCurrentUrl())
        }
        const e = await this.getNextCtaOnCurrentPage(6e4);
        if (!e) throw new Error("Next CTA was not found after intent selection.");
        const i = await this.textOf(e);
        await this.drainPerformanceLogs(), await this.clickElement(e, "Next - Intent Selection");
        const a = await this.captureAdobeWindow("Intent Next CTA");
        this.recordAction("CTA", "Next - Intent Selection", i || "Next", a, await this.driver.getCurrentUrl())
    }
    async chooseStarPlan() {
        console.log("\n[6] Mobile Plan Selection");
        const t = await this.driver.wait(async () => {
            for (const e of await this.visibleElements(By.css(".sn-plan-card")))
                if (/5G Unlimited\+ Plus/i.test(await this.textOf(e))) return e;
            return !1
        }, 6e4);
        if (!t) throw new Error("Mobile plan card '5G Unlimited+ Plus' was not found.");
        const e = await t.findElements(By.xpath(".//button[.//span[normalize-space()='Select plan'] or normalize-space()='Select plan']"));
        if (!e.length) throw new Error("'Select plan' CTA was not found.");
        this.result.selections.push({
            type: "Mobile Plan",
            value: "5G Unlimited+ Plus"
        }), await this.drainPerformanceLogs(), await this.clickElement(e[0], "Select plan - 5G Unlimited+ Plus");
        const i = await this.captureAdobeWindow("Mobile Plan Select plan", {
            timeout: 3e4,
            quietTime: 2500
        });
        this.recordAction("CTA", "Select plan", "5G Unlimited+ Plus", i, await this.driver.getCurrentUrl()), await this.waitForUrlPrefix(this.config.simPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("SIM Selection Popup", this.config.simPrefix)
    }
    async chooseSim() {
        console.log("\n[7] SIM Selection Popup");
        const t = String(this.simType || "").trim().toLowerCase(),
            e = "1" === t || "esim" === t || "e-sim" === t;
        if (!e && !["2", "physical sim", "physical-sim", "physical"].includes(t)) throw new Error(`Invalid SIM type: ${this.simType}. Expected eSIM or Physical SIM.`);
        await this.driver.wait(async () => {
            const t = await this.driver.findElements(By.xpath("//*[contains(@class,'overlay-modal-title') and contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'select your choice of sim')]")),
                e = await this.driver.findElements(By.css("input[type='radio'][id*='eSIM'],input[type='radio'][id*='PhysicalSIM']"));
            return t.length > 0 || e.length > 0
        }, 6e4, "SIM selection popup did not appear");
        const i = e ? {
            value: "eSIM",
            container: "#b3-b1-b2-eSim_Container",
            radio: "#b3-b1-b2-eSIM-input"
        } : {
            value: "Physical SIM",
            container: "#b3-b1-b2-PhysicalSIM_Container",
            radio: "#b3-b1-b2-PhysicalSIM-input"
        };
        let a = (await this.driver.findElements(By.css(i.radio)).catch(() => []))[0];
        if (!a) throw new Error(`SIM option '${i.value}' was not found.`);
        if (!await a.isSelected().catch(() => !1)) {
            const t = await this.driver.findElements(By.css(i.container)).catch(() => []);
            t.length ? await this.driver.executeScript("arguments[0].click();", t[0]) : await this.driver.executeScript("arguments[0].click();", a)
        }
        await this.driver.wait(() => a.isSelected().catch(() => !1), 15e3, `SIM option '${i.value}' was not selected`), this.result.selections.push({
            type: "SIM",
            value: i.value
        });
        const r = await this.captureAdobeWindow("SIM selection", {
            timeout: 1e4
        });
        this.recordAction("POPUP_OPTION", "SIM", i.value, r, await this.driver.getCurrentUrl());
        const s = "//div[contains(@class,'overlay-modal-footer')]//button[.//div[normalize-space()='Next'] or normalize-space()='Next']";
        await this.driver.wait(async () => {
            const t = await this.driver.findElements(By.xpath(s));
            return t.length > 0 && await t[0].isEnabled().catch(() => !1)
        }, 3e4);
        const n = (await this.driver.findElements(By.xpath(s)))[0];
        await this.drainPerformanceLogs(), await this.clickElement(n, "Next - SIM Selection");
        const o = await this.captureAdobeWindow("SIM Selection Next");
        this.recordAction("CTA", "Next", "SIM Selection", o, await this.driver.getCurrentUrl()), await this.waitForUrlPrefix(this.config.suggestionPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Security / Add-ons", this.config.suggestionPrefix)
    }
    async chooseSecurityAndWatch() {
        console.log("\n[8] Security / Add-ons");
        const t = "Watch S11 46mm AL";
        let e = null;
        const i = Date.now();
        for (; Date.now() - i < 3e4;) {
            const i = await this.visibleElements(By.xpath("//div[contains(@class,'product-item-card')][.//*[normalize-space()='Watch S11 46mm AL']]"));
            if (i.length) {
                e = i[0];
                break
            }
            await this.sleep(500)
        }
        if (!e) throw new Error("Watch S11 46mm AL upsell was not found.");
        await this.drainPerformanceLogs(), await this.clickElement(e, t);
        const a = await this.captureAdobeWindow("Watch upsell click");
        this.recordAction("CTA", t, t, a, await this.driver.getCurrentUrl()), await this.waitForUrlPrefix(this.config.watchPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Watch S11 46mm AL PDP", this.config.watchPrefix);
        const r = await this.visibleElements(By.xpath("//button[contains(@class,'add-to-cart-button')][.//span[normalize-space()='Add to cart']]")).then(t => t[0]);
        if (!r) throw new Error("Add to cart CTA was not found on Watch PDP.");
        await this.drainPerformanceLogs(), await this.clickElement(r, "Add to cart - Watch");
        const s = await this.captureAdobeWindow("Watch Add to cart");
        this.recordAction("CTA", "Add to cart", t, s, await this.driver.getCurrentUrl()), await this.waitForUrlPrefix(this.config.suggestionPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Security / Add-ons", this.config.suggestionPrefix);
        let n = [];
        const o = Date.now();
        for (; Date.now() - o < 6e4;) {
            n = await this.visibleElements(By.xpath("//div[contains(@class,'protection-item')][.//input[@type='checkbox']]"));
            if (n.length) break;
            await this.sleep(500)
        }
        if (!n.length) throw new Error("No security/add-on products were found.");
        const c = n.filter(async () => !1),
            l = [];
        for (const t of n) try {
            const e = (await t.findElements(By.css("input[type='checkbox']")))[0],
                i = await t.findElements(By.xpath(".//span[contains(@class,'fw-bold') and @data-expression]")),
                a = i.length ? await this.textOf(i[0]) : (await this.textOf(t)).split(/\$|\d+\.\d{2}/)[0].replace(/\s+/g, " ").trim();
            e && a && l.push({
                element: t,
                checkbox: e,
                text: a
            })
        } catch (t) {}
        const d = l.filter(t => !t.checkbox),
            h = l.sort(() => Math.random() - .5).slice(0, Math.min(2, l.length));
        for (const t of h)
            if (!await t.checkbox.isSelected().catch(() => !1)) {
                await this.driver.executeScript("arguments[0].scrollIntoView({block:'center'});", t.checkbox).catch(() => {});
                try {
                    await t.checkbox.click()
                } catch (e) {
                    await this.driver.executeScript("arguments[0].click();", t.checkbox)
                }
                const e = await this.captureAdobeWindow("Security selection");
                this.result.selections.push({
                    type: "Security Add-on",
                    value: t.text
                }), this.recordAction("OPTION", "Security Add-on", t.text, e, await this.driver.getCurrentUrl())
            }
        const u = await this.visibleElements(By.xpath("//div[contains(@class,'grid-content-10columns')]//button[contains(@class,'skip-button') and contains(@class,'btn-primary')][.//span[normalize-space()='Continue']]")).then(t => t[0]);
        if (!u) throw new Error("Security / Add-ons Continue CTA was not found.");
        await this.drainPerformanceLogs(), await this.clickElement(u, "Continue");
        const w = await this.captureAdobeWindow("Security / Add-ons Continue");
        this.recordAction("CTA", "Continue", "Security / Add-ons", w, await this.driver.getCurrentUrl()), await this.waitForUrlPrefix(this.config.reviewOrderPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Review Order / Cart", this.config.reviewOrderPrefix);
        const g = await this.captureAdobeWindow("Cart View", {
            timeout: 1e4
        });
        const p = g.filter(t => (t.events || []).some(t => /cart.?view|scview/i.test(String(t))));
        p.length && this.recordAction("EVENT", "Cart View", "Review Order / Cart", p, await this.driver.getCurrentUrl())
    }
    async chooseMobileNumber() {
        console.log("\n[9] Cart Page – Proceed to Checkout CTA Validation");
        const t = await this.visibleElements(By.css("#b3-BtnCheckoutWeb")).then(t => t[0]);
        if (t) {
            await this.drainPerformanceLogs(), await this.clickElement(t, "Proceed to checkout");
            const e = await this.captureAdobeWindow("Proceed to checkout"),
                i = e.filter(t => (t.events || []).some(t => /checkout.?start|sccheckout/i.test(String(t))));
            this.recordAction("CTA", "Proceed to checkout", "", e, await this.driver.getCurrentUrl()), i.length && this.recordAction("EVENT", "Checkout Start", "Proceed to checkout", i, await this.driver.getCurrentUrl())
        } else await this.driver.get(this.config.mobileNumberPrefix);
        await this.waitForUrlPrefix(this.config.mobileNumberPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Checkout - Mobile Number", this.config.mobileNumberPrefix);
        const e = await this.visibleElements(By.xpath("//div[contains(@class,'number-selection-option')]"));
        if (!e.length) throw new Error("No mobile number options were found.");
        const i = e[Math.floor(Math.random() * e.length)],
            a = await this.textOf(i);
        await this.drainPerformanceLogs(), await this.clickElement(i, `Mobile Number - ${a}`), this.result.selections.push({
            type: "Mobile Number",
            value: a
        });
        const r = await this.captureAdobeWindow("Mobile number selection");
        this.recordAction("OPTION", "Mobile Number", a, r, await this.driver.getCurrentUrl());
        const s = await this.driver.wait(until.elementLocated(By.xpath("//button[contains(@class,'add-plan-btn')][.//span[normalize-space()='Next']]")), this.timeout);
        await this.driver.wait(async () => !await s.getAttribute("disabled") && await s.isEnabled(), this.timeout, "Next CTA remained disabled after mobile number selection."), await this.drainPerformanceLogs(), await this.clickElement(s, "Next - Mobile Number");
        const n = await this.captureAdobeWindow("Next after mobile number");
        this.recordAction("CTA", "Next - Mobile Number", "", n, await this.driver.getCurrentUrl()), await this.waitForUrlPrefix(this.config.reviewDetailPrefix, 9e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Checkout - Review Detail", this.config.reviewDetailPrefix)
    }
    async deliveryFlow() {
        console.log("\n[10] Delivery + Date/Time Popup"), await this.driver.wait(until.elementLocated(By.xpath("//*[normalize-space()='Select delivery options and review']")), 6e4);
        const t = await this.driver.wait(until.elementLocated(By.xpath("//input[@type='radio' and @value='standard_delivery']")), 6e4);
        await this.clickElement(t, "Standard Delivery");
        const e = await this.captureAdobeWindow("Standard delivery selection");
        this.recordAction("POPUP_OPTION", "Delivery", "Standard Delivery", e, await this.driver.getCurrentUrl()), await this.driver.wait(until.elementLocated(By.xpath("//*[normalize-space()='Select an address']")), 6e4);
        const i = await this.driver.wait(until.elementLocated(By.css("input[type='radio'][name*='rdo_Address'][checked],input[type='radio'][value][checked]")), 6e4);
        await i.isSelected().catch(() => !1) || await this.driver.executeScript("arguments[0].click();", i);
        const a = await this.driver.wait(until.elementLocated(By.xpath("//button[.//*[normalize-space()='Next, select date & time'] or normalize-space()='Next, select date & time']")), 6e4);
        await this.clickElement(a, "Next, select date & time");
        const r = await this.captureAdobeWindow("Delivery date popup");
        this.recordAction("CTA", "Next, select date & time", "", r, await this.driver.getCurrentUrl()), await this.driver.wait(until.elementLocated(By.css("select[id*='dd_DeliveryDate']")), 6e4);
        const s = new Date;
        s.setHours(0, 0, 0, 0), s.setDate(s.getDate() + 2);
        const n = await this.driver.findElement(By.css("select[id*='dd_DeliveryDate']")),
            o = await this.driver.executeScript((t, e) => {
                const i = t,
                    a = new Date(e),
                    r = String(a.getDate()),
                    s = a.toLocaleDateString("en-US", {
                        month: "long"
                    }).toLowerCase(),
                    n = String(a.getFullYear()),
                    o = (r + " " + s + " " + n).toLowerCase(),
                    c = (s + " " + r + ", " + n).toLowerCase(),
                    l = n + "-" + String(a.getMonth() + 1).padStart(2, "0") + "-" + r.padStart(2, "0");
                let d = -1;
                for (let t = 0; t < i.options.length; t++) {
                    const e = i.options[t],
                        a = String(e.textContent || "").replace(/\s+/g, " ").trim().toLowerCase(),
                        r = String(e.value || "").replace(/\s+/g, " ").trim().toLowerCase();
                    if (a.includes(o) || a.includes(c) || r.includes(l)) {
                        d = t;
                        break
                    }
                    const s = new Date(a);
                    if (!Number.isNaN(s.getTime()) && s.getFullYear() === new Date(e).getFullYear() && s.getMonth() === new Date(e).getMonth() && s.getDate() === new Date(e).getDate()) {
                        d = t;
                        break
                    }
                }
                return d < 0 ? {
                    index: -1,
                    options: Array.from(i.options).map(t => t.textContent.trim())
                } : (i.selectedIndex = d, i.dispatchEvent(new Event("change", {
                    bubbles: !0
                })), i.dispatchEvent(new Event("input", {
                    bubbles: !0
                })), {
                    index: d,
                    value: i.options[d].textContent.trim()
                })
            }, n, s.getTime());
        if (!o || o.index < 0) throw new Error("Could not find delivery date for +2 days.");
        this.result.selections.push({
            type: "Delivery Date",
            value: o.value
        });
        const c = await this.captureAdobeWindow("Delivery date selection");
        this.recordAction("POPUP_OPTION", "Delivery Date", o.value, c, await this.driver.getCurrentUrl());
        const l = await this.visibleElements(By.xpath("//*[contains(@class,'selection-tab')][.//*[contains(normalize-space(.),'am') or contains(normalize-space(.),'pm')]]"));
        if (!l.length) throw new Error("No delivery time slots were found.");
        const d = l[Math.floor(Math.random() * l.length)],
            h = await this.textOf(d);
        await this.drainPerformanceLogs(), await this.clickElement(d, `Delivery time - ${h}`);
        const u = await this.captureAdobeWindow("Delivery time selection");
        this.recordAction("POPUP_OPTION", "Delivery Time", h, u, await this.driver.getCurrentUrl());
        const w = await this.driver.wait(until.elementLocated(By.css("#b3-b80-b14-ConfirmButton")), 3e4);
        await this.clickElement(w, "Confirm delivery date/time");
        const g = await this.captureAdobeWindow("Delivery confirmation");
        this.recordAction("CTA", "Confirm delivery date/time", `${o.value} ${h}`, g, await this.driver.getCurrentUrl()), await this.driver.wait(until.elementLocated(By.css("#b3-Ack")), 6e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Checkout - Review Detail After Delivery", this.config.reviewDetailPrefix)
    }
    async confirmAndPay() {
        console.log("\n[11] Confirm and Pay + CVV");
        const t = await this.visibleElements(By.css("#b3-Ack"));
        if (!t.length) throw new Error("Required T&Cs checkbox #b3-Ack was not found.");
        if (!await t[0].isSelected().catch(() => !1)) {
            await this.drainPerformanceLogs(), await this.clickElement(t[0], "T&Cs checkbox");
            const e = await this.captureAdobeWindow("T&Cs checkbox");
            this.recordAction("CHECKBOX", "b3-Ack", "Selected", e, await this.driver.getCurrentUrl())
        }
        const e = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'confirm and pay')]")).then(t => t[0]).catch(() => null);
        if (!e) throw new Error("Confirm and Pay CTA was not found.");
        await this.drainPerformanceLogs(), await this.clickElement(e, "Confirm and Pay");
        const i = await this.driver.getCurrentUrl(),
            a = await this.captureAdobeWindow("Confirm and Pay");
        this.recordAction("CTA", "Confirm and Pay", "", a, await this.driver.getCurrentUrl()), await this.driver.wait(async () => await this.driver.getCurrentUrl() !== i, 6e4, "Site did not navigate after Confirm and Pay."), await this.waitForPageReady(6e4), await this.sleep(2e3);
        const r = await this.captureAdobeWindow("Post Confirm and Pay pageLoad", {
            isPageLoad: true
        });
        this.recordAction("PAGE_LOAD", "Post Confirm and Pay", r.length ? "pageLoad captured" : "pageLoad not captured", r, await this.driver.getCurrentUrl());
        if (!(await this.driver.getCurrentUrl()).toLowerCase().includes("checkout-success")) {
            const t = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'done') or contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'confirm')]")).then(t => t[0]).catch(() => null);
            if (t) {
                await this.drainPerformanceLogs(), await this.clickElement(t, "Done/Confirm");
                const e = await this.captureAdobeWindow("Done/Confirm");
                this.recordAction("CTA", "Done/Confirm", "", e, await this.driver.getCurrentUrl())
            }
        }
    }
    async threeDsAndSuccess() {
        console.log("\n[12] 3DS + Order Success");
        await this.driver.wait(async () => {
            const t = (await this.driver.getCurrentUrl()).toLowerCase();
            return t.includes("checkout-success") || t.includes("3ds") || t.includes("three")
        }, 12e4, "Neither 3DS nor success page was reached after Confirm and Pay.");
        if ((await this.driver.getCurrentUrl()).toLowerCase().includes("checkout-success")) {
            this.currentPageUrl = await this.driver.getCurrentUrl();
            await this.recordPage("Order Success", this.config.successPrefix);
            return console.log("    Direct order success page reached: " + this.currentPageUrl)
        }
        await this.waitForUrlPrefix(this.config.threeDsPrefix, 6e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("3DS Loading Page", this.config.threeDsPrefix);
        const t = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'submit') or contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'proceed')]")).then(t => t[0]).catch(() => null);
        if (!t) throw new Error("3DS Submit CTA was not found.");
        await this.drainPerformanceLogs(), await this.clickElement(t, "3DS Submit");
        const e = await this.captureAdobeWindow("3DS Submit");
        this.recordAction("CTA", "3DS Submit", "", e, await this.driver.getCurrentUrl()), await this.waitForUrlPrefix(this.config.successPrefix, 12e4), this.currentPageUrl = await this.driver.getCurrentUrl(), await this.recordPage("Order Success", this.config.successPrefix), console.log("    Order success page reached: " + this.currentPageUrl)
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
            this.result.summary.pagesVisited = this.result.pages.length, this.result.summary.adobeHits = this.result.hits.length, this.result.summary.ecommerceEvents = this.result.ecommerceEvents.length, this.result.summary.productsCaptured = this.result.products.length, this.result.summary.ordersCaptured = this.result.orders.length, this.result.summary.passed = this.result.pages.filter(t => "PASS" === t.status).length, this.result.summary.failed = this.result.pages.filter(t => "FAIL" === t.status).length, this.result.summary.status = 0 === this.result.summary.failed && 0 === this.result.errors.length ? "PASS" : "FAIL", this.result.finishedAt = new Date().toISOString();
            return this.result
        } catch (t) {
            this.result.errors.push({
                timestamp: new Date().toISOString(),
                step: this.result.pages.length + 1,
                error: t.message || String(t),
                currentUrl: this.driver ? await this.driver.getCurrentUrl().catch(() => "") : ""
            }), this.result.summary.status = "FAIL", this.result.summary.pagesVisited = this.result.pages.length, this.result.summary.adobeHits = this.result.hits.length, this.result.summary.ecommerceEvents = this.result.ecommerceEvents.length, this.result.summary.productsCaptured = this.result.products.length, this.result.summary.ordersCaptured = this.result.orders.length, this.result.finishedAt = new Date().toISOString();
            throw t
        } finally {
            await this.close()
        }
    }
}
module.exports = PreSalesJourneyValidator;