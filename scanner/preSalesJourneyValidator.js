const {
    Builder,
    By,
    Key,
    until
} = require("selenium-webdriver"), chrome = require("selenium-webdriver/chrome");

class PreSalesJourneyValidator {
    constructor(t = {}) {
        this.credentials = t.credentials || {};
        this.config = t.journeyConfig || {};
        const e = this.config.environments || {},
            i = String(t.startUrl || process.env.PRESALES_START_URL || "").trim();
        let r = "";
        if (i) try {
            r = new URL(i).origin
        } catch (t) {
            r = i.replace(/\/+$/, "")
        } else {
            const i = String(t.environment || process.env.PRESALES_ENV || "").toLowerCase();
            i && e[i] && (r = String(e[i]).replace(/\/+$/, ""))
        }
        if (!r) throw new Error("Pre-Sales Website URL is required. Enter TST1, TST, or HFD URL.");
        const a = r.replace(/\/+$/, ""),
            s = Object.entries(e).find(([, t]) => a.toLowerCase() === String(t).replace(/\/+$/, "").toLowerCase());
        this.environment = s ? s[0] : "custom";
        this.baseUrl = a;
        this.startUrl = `${a}/personal/login`;
        this.homeUrlPrefix = `${a}/personal/store/mobile-plans`;
        this.deviceListingPrefix = `${a}/personal/store/mobile/devices`;
        this.productPdpPrefix = `${a}/personal/store/mobile/devices/apple/iphone-17-pro-max`;
        this.intentPrefix = `${a}/personal/store/intent-selection`;
        this.starPlanPrefix = `${a}/personal/store/product-starplan`;
        this.simPrefix = `${a}/personal/store/sim-selection`;
        this.suggestionPrefix = `${a}/personal/store/product-suggestion-SN-UD`;
        this.watchPrefix = `${a}/personal/store/mobile/tablets-watches/apple/watch-s11-46mm-al`;
        this.reviewOrderPrefix = `${a}/personal/revieworder`;
        this.mobileNumberPrefix = `${a}/personal/checkout/your-mobile-number`;
        this.reviewDetailPrefix = `${a}/personal/checkout/reviewdetail`;
        this.threeDsPrefix = `${a}/TorpedoPayment/ThreeDSLoadingPageForWeb`;
        this.successPrefix = `${a}/personal/checkout-success`;
        this.timeout = t.timeout || 9e4;
        this.maxAdobeWait = t.maxAdobeWait || 6e4;
        this.networkQuietTime = t.networkQuietTime || 4e3;
        this.pollInterval = t.pollInterval || 250;
        this.driver = null;
        this.currentPageUrl = "";
        this.currentStep = "";
        this.currentAction = "";
        this.currentCTA = "";
        this.currentCta = "";
        this.paymentOptionPrompt = t.paymentOptionPrompt || null;
        this.payLaterPeriod = t.payLaterPeriod || null;
        this.simType = t.simType || null;
        this.lastRecordedPageName = "";
        this.seenHitKeys = new Set;
        this.logger = t.logger || null;
        this.onProgress = "function" === typeof t.onProgress ? t.onProgress : null;
        this.result = {
            startedAt: new Date().toISOString(),
            finishedAt: null,
            authentication: {},
            environment: this.environment,
            baseUrl: this.baseUrl,
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
            selections: [],
            currentPage: {
                name: "",
                url: "",
                action: "",
                cta: ""
            },
            currentPageUrl: "",
            currentStep: "",
            currentAction: "",
            currentCTA: "",
            currentUrl: ""
        };
        this.log(`Selected Pre-Sales Environment: ${this.environment.toUpperCase()}`);
        this.log(`Selected Pre-Sales Website URL: ${this.baseUrl}`);
        this.log(`Journey start URL: ${this.startUrl}`);
    }
    log(...t) {
        const e = t.map(t => "string" === typeof t ? t : JSON.stringify(t)).join(" ");
        console.log(e);
        if (this.logger) try {
            this.logger(e)
        } catch (t) {}
        if (this.onProgress) try {
            this.onProgress()
        } catch (t) {}
    }
    progress() {
        if (this.onProgress) try {
            this.onProgress()
        } catch (t) {}
    }
    
    async createDriver(){
const options=new chrome.Options();
const headless="true"===String(process.env.SELENIUM_HEADLESS||"").toLowerCase()||"true"===String(process.env.RENDER||"").toLowerCase();
if(headless)options.addArguments("--headless=new");
options.addArguments("--start-maximized");
options.addArguments("--disable-notifications");
options.addArguments("--disable-popup-blocking");
options.addArguments("--disable-dev-shm-usage");
options.addArguments("--no-sandbox");
options.addArguments("--proxy-server=direct://");
options.addArguments("--proxy-bypass-list=*");
this.driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
this.log(`Chrome mode: ${headless?"HEADLESS":"VISIBLE"}`);
return this.driver;
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
                for (const [i, r] of t.searchParams.entries()) e.push([i, r])
            } else {
                i = i.replace(/^\?/, "");
                const t = new URLSearchParams(i);
                for (const [i, r] of t.entries()) e.push([i, r])
            }
        } catch (t) {}
        return e;
    }
    parseHit(t, e = "", i = "") {
        const r = [...this.parseParameterPairs(t), ...this.parseParameterPairs(e)],
            a = {};
        for (const [t, e] of r) a[t] = e;
        let s = "",
            n = "";
        try {
            const e = new URL(t);
            n = e.pathname;
            const i = e.pathname.split("/"),
                r = i.findIndex(t => "b" === t.toLowerCase());
            r >= 0 && i[r + 1] && "ss" === i[r + 1].toLowerCase() && i[r + 2] && (s = i[r + 2]);
        } catch (t) {}
        const o = [];
        for (const [t, e] of r) {
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
            if (/^event\d+$/i.test(t)) o.push({
                name: t,
                value: e || "1"
            });
        }
        const c = {},
            l = {};
        for (const [t, e] of r) {
            if (/^v\d+$/i.test(t) || /^evar\d+$/i.test(t)) c[t.toLowerCase()] = e;
            if (/^c\d+$/i.test(t) || /^prop\d+$/i.test(t)) l[t.toLowerCase()] = e;
        }
        return {
            timestamp: new Date().toISOString(),
            requestId: i || "",
            url: t,
            pathName: n,
            reportSuite: s,
            pageName: a.pageName || a.gn || a.v1 || "",
            events: o.map(t => t.name),
            eventDetails: o,
            eVars: c,
            props: l,
            products: a.products || "",
            orderId: a.purchaseID || a.purchaseId || a.transactionID || a.orderId || a.oid || "",
            revenue: a.purchaseamount || a.purchaseAmount || a.revenue || a.amount || "",
            rawQuery: a,
            postData: e || ""
        };
    }
    async collectAdobeHits() {
        const t = [],
            e = await this.drainPerformanceLogs();
        for (const i of e) {
            const e = this.parsePerformanceLog(i);
            if (!e || "Network.requestWillBeSent" !== e.method) continue;
            const r = e.params && e.params.request;
            if (!r || !r.url || !/\/b\/ss\//i.test(r.url)) continue;
            const a = this.parseHit(r.url, r.postData || "", e.params.requestId || ""),
                s = `${a.requestId}|${a.url}|${a.postData}`;
            if (!this.seenHitKeys.has(s)) {
                this.seenHitKeys.add(s);
                t.push(a)
            }
        }
        return t;
    }
    async captureAdobeWindow(t, e = {}) {
        const i = e.timeout || (e.isPageLoad ? this.maxAdobeWait : Math.min(this.maxAdobeWait, 2e4)),
            r = e.quietTime || this.networkQuietTime,
            a = Date.now();
        let s = null;
        const n = [];
        for (; Date.now() - a < i;) {
            const t = await this.collectAdobeHits();
            if (t.length) {
                n.push(...t);
                s = Date.now()
            }
            if (n.length && s && Date.now() - s >= r) break;
            await this.sleep(this.pollInterval);
        }
        if (n.length) this.addHitData(n);
        return n;
    }
    async waitForElement(t, e = 6e4) {
        const i = Date.now();
        for (; Date.now() - i < e;) {
            try {
                const e = await this.driver.findElements(t);
                for (const t of e)
                    if (await t.isDisplayed() && await t.isEnabled()) return t;
            } catch (t) {}
            await this.sleep(300);
        }
        throw new Error(`Element not found within ${e}ms: ${JSON.stringify(t)}`);
    }
    async visibleElements(t) {
        const e = await this.driver.findElements(t),
            i = [];
        for (const t of e) try {
            if (await t.isDisplayed() && await t.isEnabled()) i.push(t)
        } catch (t) {}
        return i;
    }
    async textOf(t) {
        try {
            return (await t.getText()).replace(/\s+/g, " ").trim()
        } catch (t) {
            return ""
        }
    }
    async clickElement(t, e) {
        await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", t);
        await this.sleep(400);
        try {
            await t.click()
        } catch (i) {
            await this.driver.executeScript("arguments[0].click();", t)
        }
        this.log(`     Payment selection clicked: ${e}`);
    }
    async clickText(t, e = {}) {
        const i = !1 !== e.exact,
            r = JSON.stringify(String(t)),
            a = i ? `//*[self::a or self::button or @role='button' or self::label][normalize-space(.)=${r}]` : `//*[self::a or self::button or @role='button' or self::label][contains(normalize-space(.),${r})]`,
            s = await this.visibleElements(By.xpath(a));
        return s.length ? (await this.clickElement(s[0], t), s[0]) : null;
    }
    async waitForUrlPrefix(t, e = 6e4) {
        const i = Date.now();
        for (; Date.now() - i < e;) {
            const e = await this.driver.getCurrentUrl();
            if (e.toLowerCase().startsWith(t.toLowerCase())) return e;
            await this.sleep(400);
        }
        throw new Error(`Timed out waiting for URL prefix: ${t}\nCurrent URL: ${await this.driver.getCurrentUrl()}`);
    }
    async waitForPageReady(t = 6e4) {
        const e = Date.now();
        for (; Date.now() - e < t;) {
            try {
                const t = await this.driver.executeScript("return document.readyState");
                if ("complete" === t || "interactive" === t) return
            } catch (t) {}
            await this.sleep(250);
        }
    }
    
   async getPageName(){
return await this.driver.executeScript(`
(function(){
try{
var dl=window.dataLayerSH;
if(!dl){
return {pageName:"",event:"",length:0,error:"dataLayerSH not found"};
}
if(!Array.isArray(dl)){
return {pageName:"",event:"",length:0,error:"dataLayerSH is not an array"};
}
for(var i=dl.length-1;i>=0;i--){
var x=dl[i];
if(x&&x.event==="pageViewed"&&x.page&&x.page.pageName){
return {
pageName:String(x.page.pageName).trim(),
event:String(x.event),
length:dl.length,
error:""
};
}
}
for(var j=dl.length-1;j>=0;j--){
var y=dl[j];
if(y&&y.page&&y.page.pageName){
return {
pageName:String(y.page.pageName).trim(),
event:String(y.event||""),
length:dl.length,
error:""
};
}
}
return {pageName:"",event:"",length:dl.length,error:"pageName not found"};
}catch(e){
return {pageName:"",event:"",length:0,error:String(e&&e.message||e)};
}
})()
`);
}

    async waitForPageName(t = "", e = 5e3) {
        const i = Date.now();
        let r = "";
        for (; Date.now() - i < e;) {
            const e = String(await this.getPageName()).trim();
            if (e && (r = e, !t || e !== t)) return e;
            await this.sleep(250);
        }
        return r;
    }
    
    async recordPage(t,e=""){
this.currentStep=t;
this.currentAction="";
this.currentCTA="";
this.currentCta="";
this.progress();
await this.waitForPageReady();
const i=await this.driver.getCurrentUrl(),r=await this.driver.getTitle().catch(()=> "");
this.currentPageUrl=i;
this.result.currentPage={name:t,url:i,action:"",cta:""};
this.result.currentPageUrl=i;
this.result.currentStep=t;
this.result.currentAction="";
this.result.currentCTA="";
this.result.currentUrl=i;

let c="";
for(let a=0;a<14&&!c;a++){
c=String(await this.getPageName().catch(()=> "")||"").trim();
if(!c)await this.sleep(250);
}

const n=await this.captureAdobeWindow(`${t} pageLoad`,{isPageLoad:true});
const o=[...n].reverse().map(t=>String(t&&t.pageName?t.pageName:"").trim()).find(Boolean)||[...this.result.hits].slice(-10).reverse().map(t=>String(t&&t.pageName?t.pageName:"").trim()).find(Boolean)||"";
if(!c)c=o;
this.lastRecordedPageName=c||"";

const l=n.length?n:o?this.result.hits.slice(-10).filter(t=>String(t&&t.pageName?t.pageName:"").trim()===o):[];
const h=[...new Set(l.flatMap(t=>Array.isArray(t.events)?t.events:[]))];
const d={
step:t,
url:i,
expectedPrefix:e,
title:r,
pageName:c||null,
pageLoadCaptured:n.length>0||!!o,
adobeHitCount:n.length>0?n.length:l.length,
eventsFound:h,
status:n.length>0||!!c?"PASS":"FAIL",
hits:l
};

this.result.pages.push(d);
this.progress();
return d;
}

    recordAction(t,e,i,r,a){
this.currentAction=t||"";
this.currentCTA=e||"";
this.currentCta=this.currentCTA;
this.currentPageUrl=a||this.currentPageUrl;
this.result.currentPage={
name:this.currentStep,
url:this.currentPageUrl,
action:this.currentAction,
cta:this.currentCTA
};
this.result.currentPageUrl=this.currentPageUrl;
this.result.currentStep=this.currentStep;
this.result.currentAction=this.currentAction;
this.result.currentCTA=this.currentCTA;
this.result.currentUrl=this.currentPageUrl;
const s=[...new Set(r.flatMap(t=>t.events||[]))],
n={
action:this.currentAction,
label:this.currentCTA,
value:i||"",
pageUrl:a||this.currentPageUrl,
timestamp:new Date().toISOString(),
adobeHitCount:r.length,
events:s,
hits:r
};
this.result.actions.push(n);
this.progress();
return n;
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
            if (e.products) this.result.products.push({
                pageUrl: this.currentPageUrl || e.url,
                pageName: e.pageName,
                products: e.products,
                events: e.events,
                eVars: e.eVars,
                props: e.props,
                timestamp: e.timestamp
            });
            if (e.orderId || e.revenue || e.events.some(t => /purchase|order.?success/i.test(t))) this.result.orders.push({
                pageUrl: this.currentPageUrl || e.url,
                pageName: e.pageName,
                orderId: e.orderId,
                revenue: e.revenue,
                products: e.products,
                events: e.events,
                eVars: e.eVars,
                props: e.props,
                timestamp: e.timestamp
            });
        }
        this.progress();
    }
    async navigateAndRecord(t, e, i) {
        this.currentStep = t;
        this.currentAction = "";
        this.currentCTA = "";
        this.currentCta = "";
        this.currentPageUrl = i;
        this.progress();
        this.result.currentPage = {
            name: t,
            url: i,
            action: "",
            cta: ""
        };
        this.result.currentPageUrl = i;
        this.result.currentStep = t;
        this.result.currentAction = "";
        this.result.currentCTA = "";
        this.result.currentUrl = i;
        await this.drainPerformanceLogs();
        await this.driver.get(i);
        await this.waitForUrlPrefix(e);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        this.result.currentPage.url = this.currentPageUrl;
        this.result.currentPageUrl = this.currentPageUrl;
        this.result.currentUrl = this.currentPageUrl;
        return this.recordPage(t, e);
    }
    async clickAndRecord(t, e, i = "", r = "") {
        this.currentAction = "CTA";
        this.currentCTA = r || t;
        this.currentCta = this.currentCTA;
        this.result.currentPage = {
            name: this.currentStep,
            url: this.currentPageUrl,
            action: this.currentAction,
            cta: this.currentCTA
        };
        this.result.currentPageUrl = this.currentPageUrl;
        this.result.currentStep = this.currentStep;
        this.result.currentAction = this.currentAction;
        this.result.currentCTA = this.currentCTA;
        this.result.currentUrl = this.currentPageUrl;
        this.progress();
        await this.drainPerformanceLogs();
        await e();
        const a = await this.captureAdobeWindow(t);
        if (i) await this.waitForUrlPrefix(i);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        this.result.currentPage.url = this.currentPageUrl;
        this.result.currentPageUrl = this.currentPageUrl;
        this.result.currentUrl = this.currentPageUrl;
        return this.recordAction("CTA", r || t, "", a, this.currentPageUrl), a;
    }
    async login() {
        this.log("\n[1] Login");
        await this.drainPerformanceLogs();
        const t = String(this.credentials.hubId || "").trim(),
            e = String(this.credentials.hubPassword || "");
        if (!t) throw new Error("Hub ID was not provided to the Pre-Sales validator.");
        if (!e) throw new Error("Hub password was not provided to the Pre-Sales validator. Please configure HUB_PASSWORD in the server environment.");
        this.log(`    Hub ID provided: ${t?"YES":"NO"}`);
        this.log(`    Hub Password provided: ${e?"YES":"NO"}`);
        this.log(`    Login URL: ${this.startUrl}`);
        const i = async () => {
            await this.drainPerformanceLogs();
            this.log(`    Navigating to login page: ${this.startUrl}`);
            await this.driver.get(this.startUrl);
            await this.waitForPageReady(3e4);
            await this.sleep(2e3);
            const t = await this.driver.getCurrentUrl(),
                e = await this.driver.getTitle().catch(() => "");
            this.log(`    Login page final URL: ${t}`);
            this.log(`    Login page title: ${e||"N/A"}`);
            return {
                url: t,
                title: e
            };
        };
        let r = await i();
        if (/_error\.html/i.test(r.url)) {
            this.log("    WARNING: TST site redirected Selenium to /_error.html.");
            await this.sleep(3e3);
            r = await i()
        }
        if (/_error\.html/i.test(r.url)) {
            let i = "",
                a = "";
            try {
                i = await this.driver.findElement(By.css("body")).getText()
            } catch (t) {}
            try {
                a = await this.driver.getPageSource()
            } catch (t) {}
            this.result.authentication = {
                status: "FAILED",
                account: "Test Account",
                reason: "Environment redirected to /_error.html before login fields were available",
                url: r.url,
                title: r.title,
                hubIdProvided: !!t,
                hubPasswordProvided: !!e,
                errorPageText: String(i || "").replace(/\s+/g, " ").slice(0, 1e3)
            };
            throw new Error(`Login page redirected to /_error.html. URL: ${r.url}. Title: ${r.title||"N/A"}`);
        }
        const a = async (t, e = 3e4) => {
            const i = Date.now();
            for (; Date.now() - i < e;) {
                try {
                    for (const e of t) {
                        const t = await this.driver.findElements(By.css(e));
                        for (const e of t) try {
                            if (await e.isDisplayed() && await e.isEnabled()) return e
                        } catch (t) {}
                    }
                } catch (t) {}
                try {
                    const e = await this.driver.findElements(By.css("iframe"));
                    for (const i of e) try {
                        await this.driver.switchTo().defaultContent();
                        await this.driver.switchTo().frame(i);
                        for (const e of t) {
                            const t = await this.driver.findElements(By.css(e));
                            for (const e of t) try {
                                if (await e.isDisplayed() && await e.isEnabled()) return e
                            } catch (t) {}
                        }
                        await this.driver.switchTo().defaultContent();
                    } catch (t) {
                        try {
                            await this.driver.switchTo().defaultContent()
                        } catch (t) {}
                    }
                } catch (t) {}
                await this.sleep(500);
            }
            return null;
        };
        const s = await a(["input[type='email']", "input[name*='email' i]", "input[id*='email' i]", "input[name*='user' i]", "input[id*='user' i]", "input[autocomplete='username']", "input[type='text']"]),
            n = await a(["input[type='password']", "input[autocomplete='current-password']"]);
        try {
            await this.driver.switchTo().defaultContent()
        } catch (t) {}
        const o = await this.driver.getCurrentUrl(),
            c = await this.driver.getTitle().catch(() => "");
        this.log(`    Login form URL: ${o}`);
        this.log(`    Login form title: ${c||"N/A"}`);
        this.log(`    Username field: ${s?"FOUND":"NOT FOUND"}`);
        this.log(`    Password field: ${n?"FOUND":"NOT FOUND"}`);
        if (/_error\.html/i.test(o)) throw new Error(`Login fields unavailable because environment redirected to /_error.html: ${o}`);
        if (!s || !n) {
            let t = "";
            try {
                t = await this.driver.findElement(By.css("body")).getText()
            } catch (t) {}
            throw new Error(`Login fields not found. Username: ${s?"FOUND":"NOT FOUND"}, Password: ${n?"FOUND":"NOT FOUND"}, URL: ${o}. Body: ${String(t||"").replace(/\s+/g," ").slice(0,1000)}`);
        }
        this.log("    Entering Hub ID...");
        await s.clear();
        await s.sendKeys(t);
        this.log("    Entering Hub password...");
        await n.clear();
        await n.sendKeys(e);
        const l = await this.visibleElements(By.xpath("//button[normalize-space(.)='Login' or .//*[normalize-space(.)='Login']] | //input[@type='submit']"));
        await this.drainPerformanceLogs();
        if (l.length) await this.clickElement(l[0], "Login");
        else await n.sendKeys(Key.ENTER);
        const h = await this.captureAdobeWindow("Login CTA");
        this.recordAction("CTA", "Login", "", h, await this.driver.getCurrentUrl());
        await this.sleep(1500);
        const d = await this.driver.getCurrentUrl();
        this.log(`    Post-login URL: ${d}`);
        if (/_error\.html/i.test(d)) throw new Error(`Login redirected to _error.html after credentials were submitted: ${d}`);
        await this.waitForUrlPrefix(this.homeUrlPrefix, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        this.log("    Login successful. Landed on: " + this.currentPageUrl);
        this.result.authentication = {
            status: "SUCCESS",
            account: "Test Account",
            url: this.currentPageUrl,
            hubIdProvided: true,
            hubPasswordProvided: true
        };
    }
    async stepHome() {
        this.log("\n[2] Mobile Plans / Landing");
        await this.recordPage("Mobile Plans / Landing", this.homeUrlPrefix);
        const t = (await this.visibleElements(By.xpath("//*[self::a or self::button or @role='button'][contains(normalize-space(.),'See more devices')]")))[0];
        if (!t) throw new Error("CTA 'See more devices' was not found.");
        await this.clickAndRecord("See More Devices CTA", () => this.clickElement(t, "See more devices"), this.deviceListingPrefix, "See more devices");
        await this.waitForUrlPrefix(this.deviceListingPrefix);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Mobile Device Listing", this.deviceListingPrefix);
    }
    async isCurrentProductOutOfStock() {
        try {
            const t = await this.driver.executeScript(() => {
                const t = t => {
                        if (!t) return false;
                        const e = window.getComputedStyle(t),
                            i = t.getBoundingClientRect();
                        return "none" !== e.display && "hidden" !== e.visibility && i.width > 0 && i.height > 0
                    },
                    e = ["[data-container]", "button", "label", "span", "div", "p"],
                    i = /(?:out\s*of\s*stock|sold\s*out|currently\s*unavailable|not\s*available|unavailable|no\s*stock)/i,
                    r = /(?:add\s*to\s*(?:cart|basket)|buy\s*now|available\s*now)/i,
                    a = [];
                for (const r of e)
                    for (const e of Array.from(document.querySelectorAll(r))) {
                        if (!t(e)) continue;
                        const r = String(e.innerText || e.textContent || "").replace(/\s+/g, " ").trim();
                        !r || r.length > 180 || i.test(r) && a.push(r)
                    }
                const s = Array.from(document.querySelectorAll("button,a,[role='button']")).some(e => t(e) && r.test(String(e.innerText || e.textContent || "")));
                return {
                    negativeMatches: [...new Set(a)].slice(0, 20),
                    addToCart: s
                }
            });
            return !t.addToCart && t.negativeMatches.length > 0;
        } catch (t) {
            return false
        }
    }
    async findIphone17ProMaxCards(t = 9e4) {
        const e = Date.now();
        let i = 0;
        for (; Date.now() - e < t;) {
            try {
                await this.driver.executeScript("window.scrollTo(0,document.body.scrollHeight);");
                await this.sleep(1200);
                await this.driver.executeScript("window.scrollTo(0,0);")
            } catch (t) {}
            const t = await this.driver.executeScript(() => {
                const t = t => String(t || "").replace(/\s+/g, " ").trim(),
                    e = [];
                return Array.from(document.querySelectorAll(".product-item-card")).forEach((i, r) => {
                    const a = t(i.innerText || i.textContent || ""),
                        s = i.querySelector(".content-section .f-h6,.content-section span.f-h6"),
                        n = t(s ? s.innerText || s.textContent : ""),
                        o = i.querySelector("img"),
                        c = t(o ? o.getAttribute("src") : ""),
                        l = `${n} ${a} ${c}`.toLowerCase();
                    l.includes("iphone 17") && (l.includes("iphone 17 pro max") || l.includes("iphone-17-pro-max")) && e.push({
                        index: r,
                        model: n || "iPhone 17 Pro Max",
                        text: a.slice(0, 300),
                        imageSrc: c,
                        hasContentClickTarget: !!i.querySelector(".content-section > div[style*='cursor'],.image-section > div[style*='cursor']")
                    })
                }), e
            }).catch(() => []);
            if (i = t.length, t.length) return t;
            await this.sleep(1800);
        }
        return [];
    }
    async chooseDevice() {
        this.log("\n[3] Mobile Device Listing -> Random iPhone 17 Pro Max");
        const t = new Set;
        let e = "";
        for (let i = 1; i <= 8; i++) {
            this.log(`    Device selection attempt ${i}/8`);
            await this.waitForPageReady(9e4);
            if (!this.deviceListingPrefix || (await this.driver.getCurrentUrl()).toLowerCase().startsWith(this.deviceListingPrefix.toLowerCase())) {} else {
                await this.driver.get(this.deviceListingPrefix);
                await this.waitForUrlPrefix(this.deviceListingPrefix, 9e4);
                await this.recordPage("Mobile Device Listing - Retry", this.deviceListingPrefix)
            }
            const r = await this.findIphone17ProMaxCards(9e4);
            if (!r.length) throw new Error("No iPhone 17 Pro Max product cards were found on the device listing page.");
            let a = r.filter(e => !t.has(e.model));
            a.length || (a = r);
            const s = a[Math.floor(Math.random() * a.length)];
            t.add(s.model);
            this.log(`    Found ${r.length} iPhone 17 Pro Max card(s).`);
            this.log(`    Selected device: ${s.model}`);
            if (s.imageSrc) this.log(`    Device image: ${s.imageSrc}`);
            this.result.selections.push({
                type: "Device Attempt",
                value: s.model,
                url: s.imageSrc || "",
                attempt: i
            });
            await this.drainPerformanceLogs();
            const n = await this.driver.executeScript(t => {
                const e = Array.from(document.querySelectorAll(".product-item-card"))[t];
                if (!e) return false;
                const i = [e.querySelector(".content-section > div[style*='cursor']"), e.querySelector(".image-section > div[style*='cursor']"), e.querySelector(".content-section"), e.querySelector(".image-section")].filter(Boolean)[0];
                return !!i && (i.scrollIntoView({
                    behavior: "instant",
                    block: "center"
                }), i.dispatchEvent(new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    view: window
                })), true)
            }, s.index).catch(() => false);
            if (!n) {
                e = `iPhone 17 Pro Max card '${s.model}' was detected but could not be clicked.`;
                this.log(`    ${e}`);
                continue
            }
            this.log("    CTA clicked: iPhone 17 Pro Max product card");
            const o = await this.captureAdobeWindow("iPhone 17 Pro Max prodClick", {
                timeout: Math.min(this.maxAdobeWait, 3e4),
                quietTime: Math.min(this.networkQuietTime, 2500)
            });
            this.recordAction("PRODUCT_CLICK", "iPhone 17 Pro Max", s.model, o, await this.driver.getCurrentUrl());
            try {
                await this.waitForUrlPrefix(this.productPdpPrefix, 9e4)
            } catch (t) {
                e = t.message || String(t);
                this.log("    Navigation did not reach the expected iPhone 17 Pro Max PDP.");
                await this.driver.get(this.deviceListingPrefix);
                await this.waitForUrlPrefix(this.deviceListingPrefix, 9e4);
                continue
            }
            this.currentPageUrl = await this.driver.getCurrentUrl();
            const c = await this.recordPage("iPhone 17 Pro Max PDP", this.productPdpPrefix);
            if (!await this.isCurrentProductOutOfStock()) {
                this.log(`    IN STOCK: ${s.model}`);
                this.result.selections.push({
                    type: "Device Availability",
                    value: `${s.model} - IN STOCK`,
                    url: this.currentPageUrl,
                    attempt: i
                });
                return
            }
            this.log(`    OUT OF STOCK: ${s.model}`);
            this.result.selections.push({
                type: "Device Availability",
                value: `${s.model} - OUT OF STOCK`,
                url: this.currentPageUrl,
                attempt: i
            });
            this.result.actions.push({
                action: "DEVICE_RETRY",
                label: "Out of stock - return to PLP",
                value: s.model,
                pageUrl: this.currentPageUrl,
                timestamp: new Date().toISOString(),
                adobeHitCount: c.adobeHitCount,
                events: c.eventsFound || [],
                hits: c.hits || []
            });
            await this.driver.get(this.deviceListingPrefix);
            await this.waitForUrlPrefix(this.deviceListingPrefix, 9e4);
        }
        throw new Error(e || "Could not find an in-stock iPhone 17 Pro Max after 8 attempts.");
    }
    async choosePdpOptions() {
        this.log("\n[4] iPhone 17 Pro Max PDP");
        const t = await this.getRadioGroups();
        let e = t.find(t => /color|colour/i.test(t.key)),
            i = t.find(t => /storage|size|capacity|gb/i.test(t.key) && t !== e);
        const r = new Set;
        if (e && (await this.selectRadioFromGroup(e, "Color"), r.add(e.key)), i && !r.has(i.key) && (await this.selectRadioFromGroup(i, "Size/Storage"), r.add(i.key)), !e || !i) {
            const a = t.filter(t => !r.has(t.key) && !/payment|pay|monthly/i.test(t.key));
            !e && a.length && (e = a.shift(), await this.selectRadioFromGroup(e, "Color/Variant"), r.add(e.key));
            !i && a.length && (i = a.shift(), await this.selectRadioFromGroup(i, "Size/Storage"), r.add(i.key));
        }
        const a = this.paymentOptionPrompt ? await this.paymentOptionPrompt() : "2",
            s = "1" === String(a).trim(),
            n = s ? "Pay Later - Monthly" : "Pay Today";
        this.log(`    Payment option selected: ${n}`);
        this.result.selections.push({
            type: "Payment Option",
            value: n
        });
        let o = null;
        const c = Date.now();
        for (; Date.now() - c < 6e4;) {
            try {
                const t = s ? await this.driver.findElements(By.css(`[aa_linktext="${String(this.payLaterPeriod||"").trim()}-month"]`)) : await this.driver.findElements(By.css('[aa_linktext="Pay today"],.shop-option.paymentoption-selection-option'));
                for (const e of t) try {
                    if (!await e.isDisplayed() || !await e.isEnabled()) continue;
                    const t = (await e.getText()).replace(/\s+/g, " ").trim().toLowerCase(),
                        i = (await e.getAttribute("aa_linktext") || "").replace(/\s+/g, " ").trim().toLowerCase();
                    if (s) {
                        const r = String(this.payLaterPeriod || "").trim();
                        if (!["12", "24", "36"].includes(r)) throw new Error(`Invalid Pay Later period: ${r||"not provided"}. Expected 12, 24, or 36 months.`);
                        if (i === `${r}-month` || t.includes(`${r}-month`) || t.includes(`${r} month`)) {
                            o = e;
                            break
                        }
                    } else if ("pay today" === i || "pay today" === t || t.includes("pay today")) {
                        o = e;
                        break
                    }
                } catch (t) {}
            } catch (t) {}
            if (o) break;
            if (s && !["12", "24", "36"].includes(String(this.payLaterPeriod || "").trim())) break;
            await this.sleep(500);
        }
        if (!o) {
            const t = String(this.payLaterPeriod || "").trim();
            throw new Error(`Payment option '${s?`${n} (${t||"36"}-month)`:n}' was not found on PDP.`)
        }
        this.log(`    Payment option found on PDP: ${n}`);
        const l = await o.getAttribute("outerHTML").catch(() => ""),
            h = (await o.getText()).replace(/\s+/g, " ").trim(),
            d = await o.getAttribute("id").catch(() => "") || "",
            u = await o.getAttribute("class").catch(() => "") || "";
        this.result.selections.push({
            type: "Payment Option Element",
            value: n,
            text: h || n,
            id: d,
            className: u,
            outerHTML: l,
            pageUrl: await this.driver.getCurrentUrl()
        });
        await this.drainPerformanceLogs();
        await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", o);
        await this.sleep(500);
        try {
            await o.click()
        } catch (t) {
            await this.driver.executeScript("arguments[0].click();", o)
        }
        this.log(`     Payment selection clicked: ${n}`);
        const w = await this.captureAdobeWindow("Payment option selection", {
            timeout: Math.min(this.maxAdobeWait, 3e4),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });
        this.recordAction("OPTION", "Payment Option", n, w, await this.driver.getCurrentUrl());
        this.log("    Payment selection recorded. Looking for PDP Next CTA...");
        let m = null,
            g = Date.now();
        for (; Date.now() - g < 6e4;) {
            try {
                const t = await this.driver.findElements(By.css("#b5-b16-NextCTA button"));
                for (const e of t) try {
                    if (!await e.isDisplayed() || !await e.isEnabled()) continue;
                    const t = await e.getAttribute("aria-disabled") || "";
                    if (null !== await e.getAttribute("disabled") || "true" === t.toLowerCase()) continue;
                    const i = (await e.getText()).replace(/\s+/g, " ").trim();
                    if (/^next$/i.test(i) || /\bnext\b/i.test(i)) {
                        m = e;
                        break
                    }
                } catch (t) {}
            } catch (t) {}
            if (m) break;
            await this.sleep(500);
        }
        if (!m) throw new Error("Next CTA was not found or did not become enabled on the iPhone PDP within 60 seconds.");
        const p = await m.getAttribute("outerHTML").catch(() => ""),
            f = (await m.getText()).replace(/\s+/g, " ").trim(),
            P = await m.getAttribute("id").catch(() => "") || "",
            y = await m.getAttribute("class").catch(() => "") || "",
            v = await this.driver.getCurrentUrl();
        this.result.selections.push({
            type: "PDP Next CTA",
            value: f || "Next",
            selector: "#b5-b16-NextCTA button",
            id: P,
            className: y,
            outerHTML: p,
            pageUrl: v
        });
        await this.drainPerformanceLogs();
        await this.clickElement(m, "Next - iPhone");
        const b = await this.captureAdobeWindow("Next - iPhone / scAdd", {
            timeout: Math.min(this.maxAdobeWait, 3e4),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });
        const x = b.filter(t => (t.events || []).some(t => /^scAdd$/i.test(String(t))) || (t.eventDetails || []).some(t => /^scAdd$/i.test(String(t.name))));
        const S = b.length ? b[b.length - 1] : null,
            A = !!S && ((S.events || []).some(t => /^scAdd$/i.test(String(t))) || (S.eventDetails || []).some(t => /^scAdd$/i.test(String(t.name))));
        const q = this.recordAction("CTA", "Next - iPhone", n, b, await this.driver.getCurrentUrl());
        q.nextCta = {
            selector: "#b5-b16-NextCTA button",
            text: f || "Next",
            id: P,
            className: y,
            outerHTML: p
        };
        q.scAddCaptured = x.length > 0;
        q.scAddHitCount = x.length;
        q.latestHitHasScAdd = A;
        q.scAddHits = x;
        this.result.selections.push({
            type: "PDP scAdd Validation",
            value: x.length ? "scAdd captured" : "scAdd not captured",
            scAddCaptured: x.length > 0,
            scAddHitCount: x.length,
            latestHitHasScAdd: A,
            hits: x
        });
        this.log(`    Next CTA clicked. Adobe /b/ss hits captured: ${b.length}`);
        this.log("    scAdd captured from Next CTA flow: " + (x.length ? "YES" : "NO"));
        await this.waitForUrlPrefix(this.intentPrefix, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Intent Selection", this.intentPrefix);
    }
    async getRadioGroups() {
        const t = await this.driver.findElements(By.css("input[type='radio']")),
            e = new Map;
        for (const i of t) try {
            if (!await i.isDisplayed() || !await i.isEnabled()) continue;
            const t = await i.getAttribute("name") || "",
                r = await i.getAttribute("id") || "",
                a = `${t}|${r}`,
                s = await this.findRadioLabel(i),
                n = t || await i.getAttribute("data-group") || r || a;
            if (!s) continue;
            e.has(n) || e.set(n, []);
            e.get(n).push({
                radio: i,
                label: s
            });
        } catch (t) {}
        return [...e.entries()].map(([t, e]) => ({
            key: t,
            options: e
        }));
    }
    async findRadioLabel(t) {
        const e = await t.getAttribute("id").catch(() => "");
        const i = e ? await this.driver.findElements(By.css(`label[for="${e.replace(/"/g,'\\"')}"]`)) : [];
        if (i.length) return this.textOf(i[0]);
        return this.driver.executeScript("return arguments[0].parentElement?arguments[0].parentElement.innerText:'';", t).then(t => String(t || "").replace(/\s+/g, " ").trim()).catch(() => "");
    }
    async selectRadioFromGroup(t, e) {
        if (!t || !t.options || !t.options.length) throw new Error(`No options found for ${e}.`);
        const i = t.options[Math.floor(Math.random() * t.options.length)],
            r = i.label;
        this.log(`    Selected ${e}: ${r}`);
        this.result.selections.push({
            type: e,
            value: r
        });
        await this.drainPerformanceLogs();
        await this.clickElement(i.radio, `${e} - ${r}`);
        const a = await this.captureAdobeWindow(`${e} selection`);
        this.recordAction("OPTION", e, r, a, await this.driver.getCurrentUrl());
    }
    async findOptionCandidates(t) {
        const e = await this.visibleElements(By.xpath("//*[self::label or self::button or @role='button']")),
            i = [];
        for (const r of e) {
            const e = `${(await this.textOf(r)).toLowerCase()} ${(await r.getAttribute("class").catch(()=>""))?.toLowerCase()||""}`;
            if (e.trim() && t.some(t => e.includes(t))) i.push(r);
        }
        return i.filter((t, e, i) => i.findIndex(e => e === t) === e).slice(0, 30);
    }
    async getPdpNextCta() {
        const t = Date.now();
        for (; Date.now() - t < 6e4;) {
            try {
                const t = await this.driver.findElements(By.css("#b5-b16-NextCTA button"));
                for (const e of t)
                    if (await e.isDisplayed() && await e.isEnabled()) {
                        const t = (await this.textOf(e)).toLowerCase();
                        if ("next" === t || t.includes("next")) return e
                    }
            } catch (t) {}
            try {
                const t = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][normalize-space(.)='Next' or contains(normalize-space(.),'Next')]"));
                if (t.length) return t[0];
            } catch (t) {}
            await this.sleep(500);
        }
        return null;
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
            r = await t.getAttribute("id").catch(() => "") || "",
            a = await t.getAttribute("class").catch(() => "") || "";
        this.log(`    PDP Next CTA found: ${i||"Next"}`);
        this.log(`    PDP Next CTA id: ${r||"N/A"}`);
        await this.drainPerformanceLogs();
        await this.clickElement(t, "Next - iPhone");
        const s = await this.captureAdobeWindow("Next to Intent - scAdd", {
            timeout: Math.min(this.maxAdobeWait, 3e4),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });
        const n = s.filter(t => (t.events || []).some(t => /^scadd$/i.test(String(t))) || (t.eventDetails || []).some(t => /^scadd$/i.test(String(t.name)))),
            o = n.length > 0,
            c = s.length ? s[s.length - 1] : null,
            l = !!c && ((c.events || []).some(t => /^scadd$/i.test(String(t))) || (c.eventDetails || []).some(t => /^scadd$/i.test(String(t.name))));
        const h = this.recordAction("CTA", "Next - iPhone", "", s, await this.driver.getCurrentUrl());
        h.outerHTML = e;
        h.element = {
            tagName: "BUTTON",
            id: r,
            className: a,
            text: i || "Next"
        };
        h.expectedEvent = "scAdd";
        h.scAddCaptured = o;
        h.latestHitHasScAdd = l;
        h.scAddHitCount = n.length;
        h.scAddHits = n;
        this.result.selections.push({
            type: "PDP Next CTA",
            value: i || "Next",
            outerHTML: e,
            scAddCaptured: o,
            latestHitHasScAdd: l,
            scAddHitCount: n.length
        });
        this.log(`    b/ss hits captured after PDP Next: ${s.length}`);
        this.log("    scAdd captured: " + (o ? "YES" : "NO"));
        await this.waitForUrlPrefix(this.intentPrefix);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Intent Selection", this.intentPrefix);
    }
    async findClickableByText(t, e = 6e4) {
        const i = String(t || "").trim().toLowerCase(),
            r = Date.now();
        for (; Date.now() - r < e;) {
            try {
                const t = `//*[self::button or self::a or @role='button' or self::label][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),${JSON.stringify(i)})]`,
                    e = await this.visibleElements(By.xpath(t));
                if (e.length) return e[0];
            } catch (t) {}
            await this.sleep(500);
        }
        return null;
    }
    async getNextCtaOnCurrentPage(t = 6e4) {
        const e = Date.now();
        for (; Date.now() - e < t;) {
            try {
                const t = await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][normalize-space(.)='Next' or contains(normalize-space(.),'Next') or contains(normalize-space(.),'Continue') or contains(normalize-space(.),'Proceed')]"));
                for (const e of t) {
                    const t = await this.textOf(e);
                    if (/^(next|continue|proceed)(\b|\s)/i.test(t) || /\bnext\b/i.test(t)) return e
                }
            } catch (t) {}
            await this.sleep(500);
        }
        return null;
    }
    async chooseIntent() {
        this.log("\n[5] Signup for New / Select Line");
        await this.waitForPageReady(9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        this.currentStep = "Signup for New / Intent Selection";
        this.result.currentPage = {
            name: this.currentStep,
            url: this.currentPageUrl,
            action: "",
            cta: ""
        };
        this.result.currentPageUrl = this.currentPageUrl;
        this.result.currentStep = this.currentStep;
        this.result.currentAction = "";
        this.result.currentCTA = "";
        this.result.currentUrl = this.currentPageUrl;
        this.progress();
        const t = await this.driver.findElements(By.xpath("//*[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'reached the maximum of mobile lines allowed by imda')]")).then(async t => {
            for (const e of t)
                if (await e.isDisplayed().catch(() => false)) return e;
            return null
        }).catch(() => null);
        if (t) {
            this.log("    Maximum mobile-line limit detected. Selecting a random existing StarHub number.");
            const t = await this.visibleElements(By.css(".number-selection-option"));
            if (!t.length) throw new Error("Maximum mobile-line limit displayed, but no existing StarHub number options were found.");
            const e = t[Math.floor(Math.random() * t.length)],
                i = await this.textOf(e);
            this.result.selections.push({
                type: "Existing StarHub Number",
                value: i || "Random existing StarHub number",
                outerHTML: await this.getOuterHTML(e),
                pageUrl: this.currentPageUrl
            });
            await this.drainPerformanceLogs();
            await this.clickElement(e, "Random existing StarHub number");
            const r = await this.captureAdobeWindow("Existing StarHub number selection", {
                timeout: Math.min(this.maxAdobeWait, 3e4),
                quietTime: Math.min(this.networkQuietTime, 2500)
            });
            this.recordAction("OPTION", "Existing StarHub Number", i, r, await this.driver.getCurrentUrl());
        } else {
            let t = null;
            try {
                const e = await this.driver.findElements(By.xpath("//div[contains(@class,'number-card-detail_v2')][.//span[normalize-space()='Sign up for a new line']]"));
                for (const i of e)
                    if (await i.isDisplayed()) {
                        t = i;
                        break
                    }
            } catch (t) {}
            if (t) {
                const e = await this.textOf(t);
                this.log("    'Sign up for a new line' found. Selecting it.");
                this.result.selections.push({
                    type: "Intent",
                    value: e,
                    outerHTML: await this.getOuterHTML(t),
                    pageUrl: this.currentPageUrl
                });
                await this.drainPerformanceLogs();
                if (!/\bselected\b/i.test(await t.getAttribute("class").catch(() => ""))) await this.clickElement(t, "Sign up for a new line");
                const i = await this.captureAdobeWindow("Signup for new selection", {
                    timeout: Math.min(this.maxAdobeWait, 3e4),
                    quietTime: Math.min(this.networkQuietTime, 2500)
                });
                this.recordAction("OPTION", "Sign up for a new line", e, i, await this.driver.getCurrentUrl());
            } else {
                this.log("    'Sign up for a new line' was not found. Selecting a random existing line instead.");
                let t = [];
                for (const e of [".number-selection-option", ".number-card-detail_v2", "[class*='number-selection']", "[class*='number-card']"]) try {
                    t.push(...await this.visibleElements(By.css(e)))
                } catch (t) {}
                t = t.filter((t, e, i) => i.findIndex(e => e === t) === e);
                if (!t.length) try {
                    t = await this.visibleElements(By.xpath("//*[self::label or self::button or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'mobile number') or contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'existing number') or contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'select number')]"))
                } catch (t) {}
                if (!t.length) throw new Error("Neither 'Sign up for a new line' nor an existing selectable mobile line was found on the Intent Selection page.");
                const e = t[Math.floor(Math.random() * t.length)],
                    i = await this.textOf(e);
                this.log(`    Existing line selected: ${i||"Random available line"}`);
                this.result.selections.push({
                    type: "Existing StarHub Number",
                    value: i || "Random existing line",
                    outerHTML: await this.getOuterHTML(e),
                    pageUrl: this.currentPageUrl
                });
                await this.drainPerformanceLogs();
                await this.clickElement(e, "Random existing line");
                const r = await this.captureAdobeWindow("Existing line selection", {
                    timeout: Math.min(this.maxAdobeWait, 3e4),
                    quietTime: Math.min(this.networkQuietTime, 2500)
                });
                this.recordAction("OPTION", "Existing StarHub Number", i, r, await this.driver.getCurrentUrl());
            }
        }
        const e = await this.getNextCtaOnCurrentPage(6e4);
        if (!e) throw new Error("Next CTA was not found after intent/existing-number selection.");
        const i = await this.textOf(e);
        this.result.selections.push({
            type: "Intent Next CTA",
            value: i || "Next",
            outerHTML: await this.getOuterHTML(e),
            pageUrl: this.currentPageUrl
        });
        await this.drainPerformanceLogs();
        await this.clickElement(e, "Next - Intent Selection");
        const r = await this.captureAdobeWindow("Intent Next CTA", {
            timeout: Math.min(this.maxAdobeWait, 3e4),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });
        this.recordAction("CTA", "Next - Intent Selection", i || "Next", r, await this.driver.getCurrentUrl());
        await this.waitForUrlPrefix(this.starPlanPrefix, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        this.log("    Mobile Plan Selection URL: " + this.currentPageUrl);
        await this.recordPage("Mobile Plan Selection", this.starPlanPrefix);
    }
    async chooseStarPlan() {
        this.log("\n[6] Mobile Plan Selection");
        await this.waitForUrlPrefix(this.starPlanPrefix, 9e4);
        await this.waitForPageReady(9e4);
        const t = Date.now();
        let e = null;
        for (; Date.now() - t < 6e4;) {
            try {
                const t = await this.visibleElements(By.xpath("//div[contains(@class,'sn-plan-card')][.//div[contains(@class,'plan-name')]//span[normalize-space()='Unlimited+ Plus']"));
                if (t.length) {
                    e = t[0];
                    break
                }
            } catch (t) {}
            try {
                const t = await this.visibleElements(By.xpath("//div[contains(@class,'sn-plan-card')][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'unlimited+ plus')]"));
                if (t.length) {
                    e = t[0];
                    break
                }
            } catch (t) {}
            await this.sleep(500);
        }
        if (!e) throw new Error("Mobile plan card '5G Unlimited+ Plus' was not found.");
        const i = await this.getOuterHTML(e),
            r = await this.textOf(e);
        this.log("    Mobile plan found: 5G Unlimited+ Plus");
        let a = await e.findElements(By.xpath(".//button[.//span[normalize-space()='Select plan'] or normalize-space()='Select plan']")).catch(() => []);
        if (!a.length) try {
            a = await this.visibleElements(By.xpath("//div[contains(@class,'sn-plan-card')][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'unlimited+ plus')]//button[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'select plan')]"))
        } catch (t) {}
        if (!a.length) throw new Error("The 'Select plan' CTA was not found inside the 5G Unlimited+ Plus plan card.");
        const s = a[0],
            n = await this.getOuterHTML(s),
            o = await this.textOf(s),
            c = await s.getAttribute("id").catch(() => "") || "",
            l = await s.getAttribute("class").catch(() => "") || "";
        this.result.selections.push({
            type: "Mobile Plan",
            value: "5G Unlimited+ Plus",
            planName: "Unlimited+ Plus",
            outerHTML: i,
            ctaOuterHTML: n,
            ctaId: c,
            ctaClass: l,
            pageUrl: await this.driver.getCurrentUrl()
        });
        await this.drainPerformanceLogs();
        await this.clickElement(s, "Select plan - 5G Unlimited+ Plus");
        const h = await this.captureAdobeWindow("Mobile Plan Select plan", {
            timeout: Math.min(this.maxAdobeWait, 3e4),
            quietTime: Math.min(this.networkQuietTime, 2500)
        });
        this.recordAction("CTA", "Select plan", "5G Unlimited+ Plus", h, await this.driver.getCurrentUrl());
        await this.waitForUrlPrefix(this.simPrefix, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("SIM Selection Popup", this.simPrefix);
    }
    async chooseSim() {
        this.log("\n[7] SIM Selection Popup");
        const t = String(this.simType || "").trim().toLowerCase();
        if (!t) throw new Error("SIM type was not provided at journey start. Please select eSIM or Physical SIM.");
        const e = "1" === t || "esim" === t || "e-sim" === t;
        if (!e && !["2", "physical sim", "physical-sim", "physical"].includes(t)) throw new Error(`Invalid SIM type provided at journey start: '${this.simType}'. Expected eSIM or Physical SIM.`);
        await this.driver.wait(async () => {
            const t = await this.driver.findElements(By.xpath("//*[contains(@class,'overlay-modal-title') and contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'select your choice of sim')]")).catch(() => []),
                e = await this.driver.findElements(By.css("input[type='radio'][id*='eSIM'],input[type='radio'][id*='PhysicalSIM']")).catch(() => []);
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
        let r = (await this.driver.findElements(By.css(i.radio)).catch(() => []))[0];
        if (!r) r = (await this.driver.findElements(By.xpath(`//input[@type='radio' and (contains(@id,'eSIM') or contains(@id,'PhysicalSIM'))]`)).catch(() => []))[0];
        if (!r) throw new Error(`SIM option '${i.value}' was not found in the SIM Selection popup.`);
        if (!await r.isSelected().catch(() => false)) {
            const t = await this.driver.findElements(By.css(i.container)).catch(() => []);
            if (t.length) await this.driver.executeScript("arguments[0].click();", t[0]).catch(() => {});
            else await this.driver.executeScript("arguments[0].click();", r).catch(() => {});
        }
        await this.driver.wait(async () => await r.isSelected().catch(() => false), 15e3, `SIM option '${i.value}' was not selected`);
        this.log(`    SIM selected: ${i.value}`);
        this.result.selections.push({
            type: "SIM",
            value: i.value
        });
        const a = await this.captureAdobeWindow("SIM selection");
        this.recordAction("POPUP_OPTION", "SIM", i.value, a, await this.driver.getCurrentUrl());
        const s = "//div[contains(@class,'overlay-modal-footer')]//button[.//div[normalize-space()='Next'] or normalize-space()='Next']";
        await this.driver.wait(async () => {
            const t = await this.driver.findElements(By.xpath(s)).catch(() => []);
            return t.length > 0 && await t[0].isEnabled().catch(() => false)
        }, 3e4, "SIM selection Next CTA did not become enabled");
        const n = (await this.driver.findElements(By.xpath(s)))[0];
        await this.drainPerformanceLogs();
        await this.clickElement(n, "Next - SIM Selection");
        const o = await this.captureAdobeWindow("SIM Selection Next");
        this.recordAction("CTA", "Next", "SIM Selection", o, await this.driver.getCurrentUrl());
        await this.waitForUrlPrefix(this.suggestionPrefix, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Security / Add-ons", this.suggestionPrefix);
    }
    async chooseSecurityAndWatch() {
        this.log("\n[8] Security / Add-ons");
        const t = "Watch S11 46mm AL";
        let e = null;
        for (let i = Date.now(); Date.now() - i < 3e4;) {
            try {
                const t = await this.visibleElements(By.xpath("//div[contains(@class,'product-item-card')][.//*[normalize-space()='Watch S11 46mm AL']]"));
                if (t.length) {
                    e = t[0];
                    break
                }
            } catch (t) {}
            await this.sleep(500);
        }
        if (!e) throw new Error("Watch S11 46mm AL upsell was not found.");
        this.result.selections.push({
            type: "Upsell",
            value: t
        });
        await this.drainPerformanceLogs();
        await this.clickElement(e, t);
        const r = await this.captureAdobeWindow("Watch upsell click");
        this.recordAction("CTA", t, t, r, await this.driver.getCurrentUrl());
        await this.waitForUrlPrefix(this.watchPrefix, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Watch S11 46mm AL PDP", this.watchPrefix);
        let a = null;
        for (let i = Date.now(); Date.now() - i < 3e4;) {
            try {
                const t = await this.visibleElements(By.xpath("//button[contains(@class,'add-to-cart-button')][.//span[normalize-space()='Add to cart']]"));
                if (t.length) {
                    a = t[0];
                    break
                }
            } catch (t) {}
            await this.sleep(500);
        }
        if (!a) throw new Error("Add to cart CTA was not found on Watch PDP.");
        await this.drainPerformanceLogs();
        await this.clickElement(a, "Add to cart - Watch");
        const n = await this.captureAdobeWindow("Watch Add to cart");
        this.recordAction("CTA", "Add to cart", t, n, await this.driver.getCurrentUrl());
        await this.waitForUrlPrefix(this.suggestionPrefix, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Security / Add-ons", this.suggestionPrefix);
        let o = [];
        for (let i = Date.now(); Date.now() - i < 6e4;) {
            try {
                o = await this.visibleElements(By.xpath("//div[contains(@class,'protection-item')][.//input[@type='checkbox']]"));
                if (o.length >= 2) break
            } catch (t) {}
            await this.sleep(500);
        }
        if (o.length < 2) throw new Error("Could not find at least two security/add-on products.");
        const c = [];
        for (const t of o) try {
            const e = (await t.findElements(By.css("input[type='checkbox']")))[0];
            if (!e) continue;
            const i = await t.findElements(By.xpath(".//span[contains(@class,'fw-bold') and @data-expression]")).catch(() => []);
            let r = i.length ? await this.textOf(i[0]) : "";
            if (!r) r = (await this.textOf(t)).split(/\$|\d+\.\d{2}/)[0].replace(/\s+/g, " ").trim();
            if (r) c.push({
                element: t,
                checkbox: e,
                text: r
            });
        } catch (t) {}
        if (c.length < 2) throw new Error("Could not identify at least two security/add-on products.");
        const l = c.sort(() => Math.random() - .5).slice(0, 2);
        for (const t of l) {
            await this.drainPerformanceLogs();
            await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", t.checkbox).catch(() => {});
            if (!await t.checkbox.isSelected().catch(() => false)) try {
                await t.checkbox.click()
            } catch (e) {
                await this.driver.executeScript("arguments[0].click();", t.checkbox).catch(() => {})
            }
            this.log(`    Security option selected: ${t.text}`);
            const e = await this.captureAdobeWindow("Security selection");
            this.result.selections.push({
                type: "Security Add-on",
                value: t.text
            });
            this.recordAction("OPTION", "Security Add-on", t.text, e, await this.driver.getCurrentUrl());
        }
        let h = null;
        for (let i = Date.now(); Date.now() - i < 3e4;) {
            try {
                const t = await this.driver.findElements(By.xpath("//div[contains(@class,'grid-content-10columns')]//button[contains(@class,'skip-button') and contains(@class,'btn-primary')][.//span[normalize-space()='Continue']]"));
                if (t.length && await t[0].isDisplayed() && await t[0].isEnabled()) {
                    h = t[0];
                    break
                }
            } catch (t) {}
            await this.sleep(500);
        }
        if (!h) throw new Error("Security / Add-ons Continue CTA was not found.");
        await this.drainPerformanceLogs();
        await this.clickElement(h, "Continue");
        const d = await this.captureAdobeWindow("Security / Add-ons Continue");
        this.recordAction("CTA", "Continue", "Security / Add-ons", d, await this.driver.getCurrentUrl());
        await this.waitForUrlPrefix(this.reviewOrderPrefix, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Review Order / Cart", this.reviewOrderPrefix);
    }
    async chooseMobileNumber() {
        this.log("\n[9] Cart Page – Proceed to Checkout CTA Validation");
        const t = (await this.visibleElements(By.xpath("//button[@id='b3-BtnCheckoutWeb']")))[0];
        if (t) {
            await this.drainPerformanceLogs();
            await this.clickElement(t, "Proceed to checkout");
            const e = await this.captureAdobeWindow("Proceed to checkout");
            const i = e.filter(t => (t.events || []).some(t => /checkout.?start|sccheckout/i.test(String(t))));
            this.recordAction("CTA", "Proceed to checkout", "", e, await this.driver.getCurrentUrl());
            if (i.length) this.recordAction("EVENT", "Checkout Start", "Proceed to checkout", i, await this.driver.getCurrentUrl());
        } else await this.driver.get(this.mobileNumberPrefix);
        await this.waitForUrlPrefix(this.mobileNumberPrefix, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Checkout - Mobile Number", this.mobileNumberPrefix);
        let e = [];
        for (let i = Date.now(); Date.now() - i < 3e4;) {
            try {
                e = await this.visibleElements(By.xpath("//div[contains(@class,'number-selection-option')]"));
                if (e.length) break
            } catch (t) {}
            await this.sleep(500);
        }
        if (!e.length) throw new Error("No mobile number options were found after waiting for the page to render.");
        const r = e[Math.floor(Math.random() * e.length)],
            a = await this.textOf(r);
        await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", r).catch(() => {});
        await this.drainPerformanceLogs();
        await this.clickElement(r, `Mobile Number - ${a}`);
        this.result.selections.push({
            type: "Mobile Number",
            value: a
        });
        const s = await this.captureAdobeWindow("Mobile number selection");
        this.recordAction("OPTION", "Mobile Number", a, s, await this.driver.getCurrentUrl());
        const n = await this.driver.wait(until.elementLocated(By.xpath("//button[contains(@class,'add-plan-btn')][.//span[normalize-space()='Next']]")), this.timeout);
        await this.driver.wait(async () => !await n.getAttribute("disabled") && await n.isEnabled(), this.timeout, "Next CTA remained disabled after mobile number selection.");
        await this.drainPerformanceLogs();
        await this.clickElement(n, "Next - Mobile Number");
        const o = await this.captureAdobeWindow("Next after mobile number");
        this.recordAction("CTA", "Next - Mobile Number", "", o, await this.driver.getCurrentUrl());
        await this.waitForUrlPrefix(this.reviewDetailPrefix, 9e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Checkout - Review Detail", this.reviewDetailPrefix);
    }
    async deliveryFlow() {
        this.log("\n[10] Delivery + Date/Time Popup");
        await this.waitForPageReady(6e4);
        let t = null;
        for (let i = Date.now(); Date.now() - i < 6e4;) {
            try {
                const e = await this.driver.findElements(By.xpath("//input[@type='radio' and @value='standard_delivery']"));
                for (const i of e)
                    if (await i.isDisplayed()) {
                        t = i;
                        break
                    } if (t) break
            } catch (t) {}
            await this.sleep(1e3);
        }
        if (!t) throw new Error("Standard delivery option was not found.");
        const e = await t.findElement(By.xpath("ancestor::div[contains(@class,'delivery-available-item')][1]"));
        await this.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", e).catch(() => {});
        await this.drainPerformanceLogs();
        await this.clickElement(e, "Standard Delivery");
        const i = await this.captureAdobeWindow("Standard delivery selection");
        this.recordAction("POPUP_OPTION", "Delivery", "Standard Delivery", i, await this.driver.getCurrentUrl());
        const r = await this.driver.wait(until.elementLocated(By.xpath("//*[normalize-space()='Select an address']")), 6e4, "Standard delivery address interface did not render.");
        const a = await this.driver.wait(until.elementLocated(By.css("input[type='radio'][name*='rdo_Address'][checked],input[type='radio'][value][checked]")), 6e4, "No pre-selected delivery address was found.");
        if (!await a.isSelected().catch(() => false)) await this.driver.executeScript("arguments[0].click();", a);
        const s = await this.driver.wait(until.elementLocated(By.xpath("//button[.//*[normalize-space()='Next, select date & time'] or normalize-space()='Next, select date & time']")), 6e4, "'Next, select date & time' CTA was not found.");
        await this.driver.wait(async () => await s.isDisplayed() && await s.isEnabled(), 3e4);
        await this.drainPerformanceLogs();
        await this.clickElement(s, "Next, select date & time");
        const n = await this.captureAdobeWindow("Delivery date popup");
        this.recordAction("CTA", "Next, select date & time", "", n, await this.driver.getCurrentUrl());
        await this.driver.wait(until.elementLocated(By.css("[popupnameattribute='Delivery Timeslot']")), 6e4, "Delivery Timeslot popup did not open.");
        const o = new Date;
        o.setHours(0, 0, 0, 0);
        o.setDate(o.getDate() + 2);
        const c = await this.driver.findElement(By.css("select[id*='dd_DeliveryDate']"));
        const l = await this.driver.executeScript("const s=arguments[0],d=new Date(arguments[1]),day=String(d.getDate()),month=d.toLocaleDateString('en-US',{month:'long'}),year=String(d.getFullYear()),iso=year+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');let x=-1;for(let i=0;i<s.options.length;i++){const o=s.options[i],t=String(o.textContent||'').replace(/\\s+/g,' ').trim().toLowerCase(),v=String(o.value||'').toLowerCase();if(t.includes((day+' '+month+' '+year).toLowerCase())||t.includes((month+' '+day+', '+year).toLowerCase())||v.includes(iso)){x=i;break}}if(x<0)return{index:-1,options:Array.from(s.options).map(o=>o.textContent.trim())};s.selectedIndex=x;s.dispatchEvent(new Event('change',{bubbles:true}));s.dispatchEvent(new Event('input',{bubbles:true}));return{index:x,value:s.options[x].textContent.trim()}", c, o.getTime());
        if (!l || l.index < 0) throw new Error("Could not find delivery date for +2 days.");
        this.log(`    Delivery date selected: ${l.value}`);
        this.result.selections.push({
            type: "Delivery Date",
            value: l.value
        });
        const h = await this.captureAdobeWindow("Delivery date selection");
        this.recordAction("POPUP_OPTION", "Delivery Date", l.value, h, await this.driver.getCurrentUrl());
        const d = await this.visibleElements(By.xpath("//*[contains(@class,'selection-tab')][.//*[contains(normalize-space(.),'am') or contains(normalize-space(.),'pm')]]"));
        if (!d.length) throw new Error("No delivery time slots were found.");
        const u = d[Math.floor(Math.random() * d.length)],
            w = await this.textOf(u);
        await this.drainPerformanceLogs();
        await this.clickElement(u, `Delivery time - ${w}`);
        this.result.selections.push({
            type: "Delivery Time",
            value: w
        });
        const g = await this.captureAdobeWindow("Delivery time selection");
        this.recordAction("POPUP_OPTION", "Delivery Time", w, g, await this.driver.getCurrentUrl());
        const m = await this.driver.wait(until.elementLocated(By.css("#b3-b80-b14-ConfirmButton")), 3e4, "Confirm CTA was not found in delivery date/time popup.");
        await this.driver.wait(async () => await m.isDisplayed() && await m.isEnabled(), 3e4);
        await this.drainPerformanceLogs();
        await this.clickElement(m, "Confirm delivery date/time");
        const p = await this.captureAdobeWindow("Delivery confirmation");
        this.recordAction("CTA", "Confirm delivery date/time", `${l.value} ${w}`, p, await this.driver.getCurrentUrl());
        await this.driver.wait(async () => 0 === (await this.driver.findElements(By.css("[popupnameattribute='Delivery Timeslot']"))).length, 6e4, "Delivery Timeslot popup did not close.");
        await this.driver.wait(until.elementLocated(By.css("#b3-Ack")), 6e4, "Review Detail agreement section did not render.");
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("Checkout - Review Detail After Delivery", this.reviewDetailPrefix);
    }
    async confirmAndPay() {
        this.log("\n[11] Confirm and Pay + CVV");
        const t = await this.visibleElements(By.css("#b3-Ack"));
        if (!t.length) throw new Error("Required T&Cs checkbox #b3-Ack was not found.");
        if (!await t[0].isSelected().catch(() => false)) {
            await this.drainPerformanceLogs();
            await this.clickElement(t[0], "T&Cs checkbox");
            const e = await this.captureAdobeWindow("T&Cs checkbox");
            this.recordAction("CHECKBOX", "b3-Ack", "Selected", e, await this.driver.getCurrentUrl())
        }
        const e = (await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'confirm and pay')]")))[0];
        if (!e) throw new Error("Confirm and Pay CTA was not found.");
        await this.drainPerformanceLogs();
        await this.clickElement(e, "Confirm and Pay");
        const i = await this.driver.getCurrentUrl(),
            r = await this.captureAdobeWindow("Confirm and Pay");
        this.recordAction("CTA", "Confirm and Pay", "", r, await this.driver.getCurrentUrl());
        await this.driver.wait(async () => await this.driver.getCurrentUrl() !== i, 6e4, "Site did not navigate after Confirm and Pay.");
        await this.waitForPageReady(6e4);
        await this.sleep(2e3);
        const a = await this.captureAdobeWindow("Post Confirm and Pay pageLoad", {
            isPageLoad: true
        });
        this.recordAction("PAGE_LOAD", "Post Confirm and Pay", a.length ? "pageLoad captured" : "pageLoad not captured", a, await this.driver.getCurrentUrl());
    }
    async threeDsAndSuccess() {
        this.log("\n[12] 3DS + Order Success");
        let t = (await this.driver.getCurrentUrl()).toLowerCase();
        if (t.includes("checkout-success")) {
            this.currentPageUrl = await this.driver.getCurrentUrl();
            await this.recordPage("Order Success", this.successPrefix);
            this.log("    Direct order success page reached: " + this.currentPageUrl);
            return
        }
        await this.driver.wait(async () => {
            const t = (await this.driver.getCurrentUrl()).toLowerCase();
            return t.includes("checkout-success") || t.includes("3ds") || t.includes("three")
        }, 12e4, "Neither 3DS nor success page was reached after Confirm and Pay.");
        t = (await this.driver.getCurrentUrl()).toLowerCase();
        if (t.includes("checkout-success")) {
            this.currentPageUrl = await this.driver.getCurrentUrl();
            await this.recordPage("Order Success", this.successPrefix);
            return
        }
        await this.waitForUrlPrefix(this.threeDsPrefix, 6e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.recordPage("3DS Loading Page", this.threeDsPrefix);
        const e = (await this.visibleElements(By.xpath("//*[self::button or self::a or @role='button'][contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'submit') or contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'proceed')]")))[0];
        if (!e) throw new Error("3DS Submit CTA was not found.");
        await this.drainPerformanceLogs();
        await this.clickElement(e, "3DS Submit");
        const i = await this.captureAdobeWindow("3DS Submit");
        this.recordAction("CTA", "3DS Submit", "", i, await this.driver.getCurrentUrl());
        await this.waitForUrlPrefix(this.successPrefix, 12e4);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        const r = (await this.recordPage("Order Success", this.successPrefix)).hits;
        if (!this.result.orders.some(t => t.pageUrl && t.pageUrl.toLowerCase().includes("checkout-success")) && r.length)
            for (const t of r)
                if (t.orderId || t.revenue || t.products || t.events.length) this.result.orders.push({
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
        this.log("    Order success page reached: " + this.currentPageUrl);
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
            this.result.summary.passed = this.result.pages.filter(t => "PASS" === t.status).length;
            this.result.summary.failed = this.result.pages.filter(t => "FAIL" === t.status).length;
            this.result.summary.status = 0 === this.result.summary.failed && 0 === this.result.errors.length ? "PASS" : "FAIL";
            this.result.finishedAt = new Date().toISOString();
            this.progress();
            return this.result;
        } catch (t) {
            this.result.errors.push({
                timestamp: new Date().toISOString(),
                step: this.result.pages.length + 1,
                error: t.message || String(t),
                currentUrl: this.driver ? await this.driver.getCurrentUrl().catch(() => "") : ""
            });
            this.result.summary.status = "FAIL";
            this.result.summary.pagesVisited = this.result.pages.length;
            this.result.summary.adobeHits = this.result.hits.length;
            this.result.summary.ecommerceEvents = this.result.ecommerceEvents.length;
            this.result.summary.productsCaptured = this.result.products.length;
            this.result.summary.ordersCaptured = this.result.orders.length;
            this.result.finishedAt = new Date().toISOString();
            this.log(`    Journey failed: ${t.message||String(t)}`);
            this.progress();
            throw t;
        } finally {
            await this.close()
        }
    }
}

module.exports = PreSalesJourneyValidator;