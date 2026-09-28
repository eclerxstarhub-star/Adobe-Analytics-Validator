const {
    Builder,
    By,
    Key,
    until
} = require("selenium-webdriver"), chrome = require("selenium-webdriver/chrome");
class PreSalesJourneyValidator {
    constructor(t = {}) {
        this.startUrl = t.startUrl || "https://starhubltd-tst.outsystemsenterprise.com/personal/login", this.credentials = t.credentials || {}, this.config = t.journeyConfig || {}, this.maxAdobeWait = t.maxAdobeWait || 6e4, this.networkQuietTime = t.networkQuietTime || 4e3, this.pollInterval = t.pollInterval || 250, this.timeout = t.timeout || 9e4, this.driver = null, this.paymentOptionPrompt = t.paymentOptionPrompt || null, this.payLaterPeriod = t.payLaterPeriod || null, this.simType = t.simType || null, this.result = {
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
        }, this.seenHitKeys = new Set, this.lastRecordedPageName = ""
    }
    async createDriver() {
        if (this.driver) return this.driver;
        const t = new chrome.Options;
        return t.addArguments("--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--window-size=1920,1080", "--disable-popup-blocking", "--disable-notifications", "--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-features=TranslateUI"), t.setLoggingPrefs({
            performance: "ALL",
            browser: "ALL"
        }), this.driver = await (new Builder).forBrowser("chrome").setChromeOptions(t).build(), this.driver
    }
    async close() {
        if (this.driver) try {
            await this.driver.quit()
        } catch (t) {}
        this.driver = null
    }
    async sleep(t) {
        return new Promise(e => setTimeout(e, t))
    }
    async drainPerformanceLogs() {
        if (!this.driver) return [];
        try {
            return await this.driver.manage().logs().get("performance")
        } catch (t) {
            return []
        }
    }
    async getPerformanceLogs() {
        try {
            return await this.driver.manage().logs().get("performance")
        } catch (t) {
            return []
        }
    }
    parsePerformanceEntry(t) {
        try {
            return JSON.parse(t.message).message
        } catch (t) {
            return null
        }
    }
    parseAdobeRequest(t) {
        try {
            if (!t || "Network.requestWillBeSent" !== t.method) return null;
            const e = t.params && t.params.request;
            if (!e || !e.url || !e.url.includes("/b/ss")) return null;
            const i = new URL(e.url),
                a = new URLSearchParams(i.search),
                r = {
                    url: e.url,
                    method: e.method || "GET",
                    timestamp: new Date().toISOString(),
                    pageName: a.get("pageName") || a.get("gn") || "",
                    events: (a.get("events") || "").split(",").filter(Boolean),
                    products: a.get("products") || "",
                    evars: {},
                    props: {},
                    query: {}
                };
            for (const [t, e] of a.entries()) r.query[t] = e;
            for (const [t, e] of a.entries()) /^v\d+$/.test(t) ? r.evars[t] = e : /^c\d+$/.test(t) && (r.props[t] = e);
            return r
        } catch (t) {
            return null
        }
    }
    async collectAdobeHits() {
        const t = await this.getPerformanceLogs(),
            e = [];
        for (const i of t) {
            const t = this.parsePerformanceEntry(i),
                a = this.parseAdobeRequest(t);
            a && e.push(a)
        }
        return e
    }
    addHitData(t) {
        for (const e of t) {
            const i = `${e.method}|${e.url}|${e.timestamp}|${e.pageName}|${e.events.join(",")}|${e.products}`;
            this.seenHitKeys.has(i) || (this.seenHitKeys.add(i), this.result.hits.push(e), this.result.summary.adobeHits++, e.events.length && (this.result.summary.ecommerceEvents += e.events.length))
        }
    }
    async captureAdobeWindow(t, e = {}) {
        const i = e.timeout || (e.isPageLoad ? this.maxAdobeWait : Math.min(this.maxAdobeWait, 2e4)),
            a = e.quietTime || this.networkQuietTime,
            r = Date.now();
        let s = null;
        const n = [];
        for (; Date.now() - r < i;) {
            const t = await this.collectAdobeHits();
            t.length && (n.push(...t), s = Date.now()), n.length && s && Date.now() - s >= a || await this.sleep(this.pollInterval)
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
    async waitForUrlPrefix(t, e = 6e4) {
        const i = Date.now();
        for (; Date.now() - i < e;) {
            try {
                const e = await this.driver.getCurrentUrl();
                if (e && e.startsWith(t)) return e
            } catch (t) {}
            await this.sleep(500)
        }
        throw new Error(`URL did not reach expected prefix within ${e}ms: ${t}`)
    }
    async waitForPageReady(t = 3e4) {
        const e = Date.now();
        for (; Date.now() - e < t;) {
            try {
                const t = await this.driver.executeScript("return document.readyState");
                if ("complete" === t || "interactive" === t) return
            } catch (t) {}
            await this.sleep(250)
        }
    }
    async waitForPageName(t = "", e = 3500) {
        const i = Date.now();
        for (; Date.now() - i < e;) {
            try {
                const e = await this.collectAdobeHits(),
                    i = [...e].reverse().map(t => String(t && t.pageName ? t.pageName : "").trim()).find(Boolean);
                if (i && i !== t) return i
            } catch (t) {}
            await this.sleep(250)
        }
        return ""
    }
    async navigateAndRecord(t, e, i) {
        return await this.drainPerformanceLogs(), await this.driver.get(i), await this.waitForUrlPrefix(e), this.currentPageUrl = await this.driver.getCurrentUrl(), this.recordPage(t, e)
    }
    async recordPage(t, e = "") {
        await this.waitForPageReady();
        const i = await this.driver.getCurrentUrl(),
            a = await this.driver.getTitle().catch(() => "");
        this.currentPageUrl = i;
        const r = this.lastRecordedPageName || "",
            s = await this.waitForPageName(r, 3500),
            n = await this.captureAdobeWindow(`${t} pageLoad`, {
                isPageLoad: !0
            }),
            o = [...n].reverse().map(t => String(t && t.pageName ? t.pageName : "").trim()).find(Boolean) || [...this.result.hits].slice(-10).reverse().map(t => String(t && t.pageName ? t.pageName : "").trim()).find(Boolean) || "";
        let c = "";
        !s || r && s === r ? o ? c = o : s && (c = s) : c = s, this.lastRecordedPageName = c || r || "";
        const l = n.length > 0 ? n : o ? this.result.hits.slice(-10).filter(t => String(t && t.pageName ? t.pageName : "").trim() === o) : [],
            d = [...new Set(l.flatMap(t => Array.isArray(t.events) ? t.events : []))],
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
    recordAction(t, e, i, a, r = "") {
        const s = {
            type: t,
            name: e,
            selector: i,
            adobeHitCount: Array.isArray(a) ? a.length : 0,
            url: r || this.currentPageUrl || "",
            timestamp: (new Date).toISOString(),
            hits: Array.isArray(a) ? a : []
        };
        this.result.actions.push(s);
        return s
    }
    async clickElement(t, e = "") {
        await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", t).catch(() => {}), await this.sleep(300);
        try {
            await t.click()
        } catch (i) {
            await this.driver.executeScript("arguments[0].click();", t)
        }
        return !0
    }
    async clickAndRecord(t, e, i = "", a = "") {
        await this.drainPerformanceLogs();
        await e();
        const r = await this.captureAdobeWindow(t);
        return this.recordAction("CTA", a || t, i, r, await this.driver.getCurrentUrl()), r
    }
    async login() {
        console.log("\n[1] Login");
        const t = this.config.startUrl || this.startUrl;
        await this.drainPerformanceLogs();
        await this.driver.get(t);
        await this.waitForUrlPrefix(t, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.waitForPageReady(3e4);
        let e = null,
            i = null,
            r = "main";
        const s = Date.now();
        for (; Date.now() - s < 3e4 && !e && !i;) {
            try {
                await this.driver.switchTo().defaultContent();
                const t = await this.driver.findElements(By.css("input"));
                for (const a of t) {
                    if (!await a.isDisplayed().catch(() => !1)) continue;
                    const t = ((await a.getAttribute("type").catch(() => "")) + " " + (await a.getAttribute("name").catch(() => "")) + " " + (await a.getAttribute("id").catch(() => "")) + " " + (await a.getAttribute("placeholder").catch(() => "")) + " " + (await a.getAttribute("autocomplete").catch(() => ""))).toLowerCase(),
                        r = (await a.getAttribute("type").catch(() => "")).toLowerCase();
                    if (!e && "password" !== r && (/email|user.?name|hub.?id|login|account/.test(t) || "text" === r)) e = a;
                    if (!i && "password" === r) i = a
                }
                if (e && i) {
                    r = "main";
                    break
                }
                const frameEls = await this.driver.findElements(By.css("iframe"));
                for (let a = 0; a < frameEls.length && !e && !i; a++) try {
                    await this.driver.switchTo().defaultContent(), await this.driver.switchTo().frame(frameEls[a]);
                    const iframeInputs = await this.driver.findElements(By.css("input"));
                    for (const inputEl of iframeInputs) {
                        if (!await inputEl.isDisplayed().catch(() => !1)) continue;
                        const a = ((await inputEl.getAttribute("type").catch(() => "")) + " " + (await inputEl.getAttribute("name").catch(() => "")) + " " + (await inputEl.getAttribute("id").catch(() => "")) + " " + (await inputEl.getAttribute("placeholder").catch(() => "")) + " " + (await inputEl.getAttribute("autocomplete").catch(() => ""))).toLowerCase(),
                            s = (await inputEl.getAttribute("type").catch(() => "")).toLowerCase();
                        if (!e && "password" !== s && (/email|user.?name|hub.?id|login|account/.test(a) || "text" === s)) e = inputEl;
                        if (!i && "password" === s) i = inputEl;
                        if (e && i) {
                            r = `iframe-${a}`;
                            break
                        }
                    }
                } catch (t) {
                    await this.driver.switchTo().defaultContent().catch(() => {})
                }
            } catch (t) {}
            if (!(e && i)) await this.sleep(500)
        }
        if (!e || !i) {
            await this.driver.switchTo().defaultContent().catch(() => {});
            let t = "",
                a = "",
                s = [];
            try {
                t = await this.driver.executeScript("return document.body?document.body.innerText:''")
            } catch (t) {}
            try {
                a = await this.driver.getPageSource()
            } catch (t) {}
            try {
                s = await this.driver.findElements(By.css("input")).then(async t => Promise.all(t.slice(0, 30).map(async t => ({
                    type: await t.getAttribute("type").catch(() => ""),
                    name: await t.getAttribute("name").catch(() => ""),
                    id: await t.getAttribute("id").catch(() => ""),
                    placeholder: await t.getAttribute("placeholder").catch(() => ""),
                    visible: await t.isDisplayed().catch(() => !1)
                }))))
            } catch (t) {}
            this.result.selections.push({
                type: "Login Diagnostics",
                url: await this.driver.getCurrentUrl(),
                title: await this.driver.getTitle().catch(() => ""),
                bodyText: String(t || "").slice(0, 5000),
                pageSource: String(a || "").slice(0, 15000),
                inputs: s
            });
            throw new Error(`Login fields not found on Render. Username field: ${e?"FOUND":"NOT FOUND"}, Password field: ${i?"FOUND":"NOT FOUND"}, URL: ${await this.driver.getCurrentUrl()}`)
        }
        await e.clear(), await e.sendKeys(this.credentials.hubId || ""), await i.clear(), await i.sendKeys(this.credentials.hubPassword || "");
        const n = await this.visibleElements(By.xpath("//button[normalize-space(.)='Login' or .//*[normalize-space(.)='Login'] or contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login')] | //input[@type='submit']")).then(t => t[0]).catch(() => null);
        if (n) {
            await this.drainPerformanceLogs();
            await this.clickElement(n, "Login");
            const t = await this.captureAdobeWindow("Login CTA", {
                timeout: 2e4,
                quietTime: 2500
            });
            this.recordAction("CTA", "Login", "", t, await this.driver.getCurrentUrl())
        } else {
            await this.drainPerformanceLogs();
            await i.sendKeys(Key.ENTER);
            const t = await this.captureAdobeWindow("Login CTA", {
                timeout: 2e4,
                quietTime: 2500
            });
            this.recordAction("CTA", "Login", "", t, await this.driver.getCurrentUrl())
        }
        await this.driver.switchTo().defaultContent().catch(() => {});
        await this.waitForUrlPrefix(this.config.homeUrlPrefix, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        const o = await this.captureAdobeWindow("Login Page pageLoad", {
                timeout: 15e3,
                quietTime: 2500
            }),
            c = [...o].reverse().map(t => String(t && t.pageName ? t.pageName : "").trim()).find(Boolean) || "";
        this.result.pages.push({
            step: "Login Page",
            url: t,
            expectedPrefix: t,
            title: await this.driver.getTitle().catch(() => ""),
            pageName: c,
            pageLoadCaptured: o.length > 0,
            adobeHitCount: o.length,
            eventsFound: [...new Set(o.flatMap(t => t.events || []))],
            status: o.length > 0 || c ? "PASS" : "FAIL",
            hits: o
        }), console.log("    Login successful. Landed on: " + this.currentPageUrl), this.result.authentication = {
            status: "SUCCESS",
            account: "Test Account"
        }
    }
}