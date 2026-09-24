const {
    Builder,
    By,
    until
} = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
class SiteCrawler {
    constructor(options = {}) {
        this.driver = null;
        this.currentPageUrl = "";
        this.currentStep = "Starting crawl";
        this.currentAction = "";
        this.currentCTA = "";
        this.maxPages = options.maxPages || 25;
        this.maxAdobeWait = options.maxAdobeWait || 30000;
        this.postAdobeWait = options.postAdobeWait || 2000;
        this.ctaClickWait = options.ctaClickWait || 8000;
        this.ctaPollInterval = options.ctaPollInterval || 250;
        this.results = {
            pages: [],
            adobePages: [],
            adobeHits: [],
            marketingPixels: [],
            errors: [],
            eVars: {},
            props: {},
            events: {},
            reportSuites: {},
            ctaValidations: [],
            totalNetworkRequests: 0
        };
        this.visited = new Set;
        this.queue = []
    }
    async createDriver() {
        const options = new chrome.Options;
        options.addArguments("--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-notifications", "--disable-popup-blocking", "--window-size=1920,1080");
        options.setLoggingPrefs({
            performance: "ALL",
            browser: "ALL"
        });
        this.driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();
        return this.driver
    }
    async quitDriver() {
        if (this.driver) try {
            await this.driver.quit()
        } catch (error) {} finally {
            this.driver = null
        }
    }
    normalizeUrl(url) {
        if (!url) return "";
        try {
            const parsed = new URL(url);
            parsed.hash = "";
            return parsed.toString().replace(/\/$/, "")
        } catch (error) {
            return url.split("#")[0].replace(/\/$/, "")
        }
    }
    isSameDomain(url, baseUrl) {
        try {
            return new URL(url).hostname === new URL(baseUrl).hostname
        } catch (error) {
            return false
        }
    }
    isValidPageUrl(url) {
        if (!url) return false;
        try {
            const parsed = new URL(url),
                pathname = parsed.pathname.toLowerCase();
            return !!/^https?:$/.test(parsed.protocol) && !pathname.startsWith("/api/") && !pathname.includes("/api") && !pathname.endsWith(".pdf") && !pathname.endsWith(".jpg") && !pathname.endsWith(".jpeg") && !pathname.endsWith(".png") && !pathname.endsWith(".gif") && !pathname.endsWith(".svg") && !pathname.endsWith(".css") && !pathname.endsWith(".js") && !pathname.endsWith(".json") && !pathname.endsWith(".xml") && !pathname.endsWith(".zip")
        } catch (error) {
            return false
        }
    }
    isCheckoutSuccessUrl(url) {
        if (!url) return false;
        try {
            return new URL(url).pathname.toLowerCase().startsWith("/personal/checkout-success")
        } catch (error) {
            return false
        }
    }
    async getPerformanceLogs() {
        if (!this.driver) return [];
        try {
            return await this.driver.manage().logs().get("performance")
        } catch (error) {
            return []
        }
    }
    parsePerformanceLog(logEntry) {
        try {
            return JSON.parse(logEntry.message).message
        } catch (error) {
            return null
        }
    }
    extractAdobeData(url, postData = "", requestId = "") {
        if (!url || !url.includes("/b/ss/")) return null;
        try {
            const parsedUrl = new URL(url),
                params = new URLSearchParams(parsedUrl.search);
            if (postData) {
                const body = new URLSearchParams(postData);
                for (const [key, value] of body.entries()) params.set(key, value)
            }
            const suiteMatch = parsedUrl.pathname.match(/\/b\/ss\/([^/]+)/i),
                reportSuite = suiteMatch ? decodeURIComponent(suiteMatch[1]) : "",
                pageName = params.get("pageName") || params.get("gn") || "",
                products = params.get("products") || "",
                eventsRaw = params.get("events") || "",
                eVars = {},
                props = {},
                events = {};
            for (const [key, value] of params.entries()) {
                if (/^v\d+$/.test(key)) {
                    eVars[key] = value;
                    this.results.eVars[key] = value
                }
                if (/^c\d+$/.test(key)) {
                    props[key] = value;
                    this.results.props[key] = value
                }
                if (/^event\d+$/.test(key)) {
                    events[key] = value;
                    this.results.events[key] = value
                }
            }
            if (eventsRaw)
                for (const event of eventsRaw.split(",")) {
                    const eventName = event.trim();
                    if (eventName) {
                        events[eventName] = true;
                        this.results.events[eventName] = true
                    }
                }
            if (reportSuite) this.results.reportSuites[reportSuite] = (this.results.reportSuites[reportSuite] || 0) + 1;
            const hit = {
                url,
                requestId,
                reportSuite,
                pageName,
                products,
                events,
                eVars,
                props,
                timestamp: new Date().toISOString()
            };
            this.results.adobeHits.push(hit);
            if (pageName) this.results.adobePages.push({
                pageName,
                url,
                reportSuite,
                requestId
            });
            return hit
        } catch (error) {
            return null
        }
    }
    identifyMarketingPixel(url) {
        if (!url) return null;
        const signatures = [{
                name: "Meta",
                match: /facebook\.com\/tr|connect\.facebook\.net/i
            }, {
                name: "Google Analytics",
                match: /google-analytics\.com|googletagmanager\.com/i
            }, {
                name: "Google Ads",
                match: /googleadservices\.com|doubleclick\.net/i
            }, {
                name: "Pinterest",
                match: /pinimg\.com|pinterest\.com/i
            }, {
                name: "TikTok",
                match: /analytics\.tiktok\.com|tiktok\.com/i
            }, {
                name: "LinkedIn",
                match: /linkedin\.com\/insight/i
            }, {
                name: "Microsoft",
                match: /bat\.bing\.com/i
            }, {
                name: "Amazon",
                match: /amazon-adsystem\.com/i
            }],
            found = signatures.find(signature => signature.match.test(url));
        return found ? found.name : null
    }
    async collectNetworkData() {
        const logs = await this.getPerformanceLogs(),
            adobeHits = [];
        for (const logEntry of logs) {
            const message = this.parsePerformanceLog(logEntry);
            if (!message) continue;
            if (message.method === "Network.requestWillBeSent") {
                const request = message.params && message.params.request;
                if (!request || !request.url) continue;
                this.results.totalNetworkRequests += 1;
                const pixel = this.identifyMarketingPixel(request.url);
                if (pixel) this.results.marketingPixels.push({
                    vendor: pixel,
                    url: request.url,
                    timestamp: new Date().toISOString()
                });
                if (request.url.includes("/b/ss/")) {
                    const hit = this.extractAdobeData(request.url, request.postData || "", message.params.requestId || "");
                    if (hit) adobeHits.push(hit)
                }
            }
        }
        return adobeHits
    }
    async waitForAdobeHit(timeout = this.maxAdobeWait) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const hits = await this.collectNetworkData();
            if (hits.length) return hits;
            await new Promise(resolve => setTimeout(resolve, 250))
        }
        return []
    }
    async getPageNameFromDom() {
        if (!this.driver) return "";
        try {
            return await this.driver.executeScript(() => {
                try {
                    if (window.digitalData) {
                        if (window.digitalData.page && window.digitalData.page.pageInfo) return window.digitalData.page.pageInfo.pageName || window.digitalData.page.pageInfo.page_name || "";
                        if (window.digitalData.pageName) return window.digitalData.pageName
                    }
                    if (Array.isArray(window.dataLayer))
                        for (let i = window.dataLayer.length - 1; i >= 0; i -= 1) {
                            const item = window.dataLayer[i];
                            if (item && typeof item === "object") {
                                if (item.pageName) return item.pageName;
                                if (item.page && item.page.pageName) return item.page.pageName
                            }
                        }
                } catch (error) {
                    return ""
                }
                return ""
            })
        } catch (error) {
            return ""
        }
    }
    async getPageLinks(baseUrl) {
        if (!this.driver) return [];
        const links = await this.driver.findElements(By.css("a[href]")),
            urls = [];
        for (const link of links) try {
            const href = await link.getAttribute("href");
            if (!href) continue;
            const absoluteUrl = new URL(href, baseUrl).toString(),
                normalized = this.normalizeUrl(absoluteUrl);
            if (this.isSameDomain(normalized, baseUrl) && this.isValidPageUrl(normalized)) urls.push(normalized)
        } catch (error) {}
        return [...new Set(urls)]
    }
    async getCTAs() {
        if (!this.driver) return [];
        const selectors = ["a", "button", "input[type='button']", "input[type='submit']", "[role='button']"],
            elements = await this.driver.findElements(By.css(selectors.join(","))),
            ctas = [],
            occurrenceMap = new Map;
        for (let index = 0; index < elements.length; index += 1) {
            const element = elements[index];
            try {
                const tagName = (await element.getTagName()).toLowerCase(),
                    text = ((await element.getText()) || "").trim(),
                    ariaLabel = ((await element.getAttribute("aria-label")) || "").trim(),
                    title = ((await element.getAttribute("title")) || "").trim(),
                    name = ((await element.getAttribute("name")) || "").trim(),
                    id = ((await element.getAttribute("id")) || "").trim(),
                    href = ((await element.getAttribute("href")) || "").trim(),
                    className = ((await element.getAttribute("class")) || "").trim(),
                    label = text || ariaLabel || title || name || id;
                if (!label) continue;
                const fingerprint = [tagName, label, href, className].join("|"),
                    occurrence = (occurrenceMap.get(fingerprint) || 0) + 1;
                occurrenceMap.set(fingerprint, occurrence);
                ctas.push({
                    index,
                    tagName,
                    text,
                    ariaLabel,
                    title,
                    name,
                    id,
                    href,
                    className,
                    label,
                    fingerprint,
                    occurrence
                })
            } catch (error) {}
        }
        return ctas
    }
    normalizeAdobeEvent(eventName) {
        return String(eventName || "").trim().toLowerCase().replace(/^event/, "")
    }
    isEvent6(eventName) {
        return this.normalizeAdobeEvent(eventName) === "6"
    }
    hitHasEvent6(hit) {
        return !!(hit && hit.events) && Object.keys(hit.events).some(eventName => this.isEvent6(eventName))
    }
    getHitEVar24(hit) {
        return hit && hit.eVars ? hit.eVars.v24 || hit.eVars.eVar24 || "" : ""
    }
    async preparePageForCTAClick(pageUrl) {
        this.currentAction = "Preparing CTA";
        await this.driver.get(pageUrl);
        this.currentPageUrl = await this.driver.getCurrentUrl();
        await this.driver.wait(until.elementLocated(By.css("body")), 15000).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.collectNetworkData();
        await new Promise(resolve => setTimeout(resolve, this.postAdobeWait));
        await this.getPerformanceLogs()
    }
    async findCTAElement(cta) {
        const elements = await this.driver.findElements(By.css("a,button,input[type='button'],input[type='submit'],[role='button']"));
        if (typeof cta.index === "number" && elements[cta.index]) return elements[cta.index];
        let occurrence = 0;
        for (const element of elements) try {
            const tagName = (await element.getTagName()).toLowerCase(),
                text = ((await element.getText()) || "").trim(),
                ariaLabel = ((await element.getAttribute("aria-label")) || "").trim(),
                title = ((await element.getAttribute("title")) || "").trim(),
                name = ((await element.getAttribute("name")) || "").trim(),
                id = ((await element.getAttribute("id")) || "").trim(),
                href = ((await element.getAttribute("href")) || "").trim(),
                className = ((await element.getAttribute("class")) || "").trim(),
                label = text || ariaLabel || title || name || id,
                fingerprint = [tagName, label, href, className].join("|");
            if (fingerprint === cta.fingerprint && (occurrence += 1) === cta.occurrence) return element
        } catch (error) {}
        for (const element of elements) try {
            const name = ((await element.getAttribute("name")) || "").trim(),
                id = ((await element.getAttribute("id")) || "").trim(),
                text = ((await element.getText()) || "").trim();
            if (name === cta.name || id === cta.id || text === cta.text) return element
        } catch (error) {}
        return null
    }
    async collectCTAAdobeHits() {
        const start = Date.now(),
            hits = [],
            seen = new Set;
        while (Date.now() - start < this.ctaClickWait) {
            const currentHits = await this.collectNetworkData();
            for (const hit of currentHits) {
                const sameHitKey = [hit.requestId || "", hit.pageName || "", JSON.stringify(hit.eVars || {}), JSON.stringify(hit.events || {})].join("|");
                if (!seen.has(sameHitKey)) {
                    seen.add(sameHitKey);
                    hits.push(hit)
                }
            }
            if (hits.some(hit => this.getHitEVar24(hit) && this.hitHasEvent6(hit))) break;
            await new Promise(resolve => setTimeout(resolve, this.ctaPollInterval))
        }
        return hits
    }
    async validateCTAs(pageUrl, pageName, baseUrl) {
        const ctas = await this.getCTAs(),
            validations = [];
        for (const cta of ctas) {
            this.currentAction = "Validating CTA";
            this.currentCTA = cta.label || cta.text || "CTA";
            const validation = {
                pageUrl,
                pageName,
                label: cta.label,
                text: cta.text,
                href: cta.href,
                status: "NOT_VALIDATED",
                event6: false,
                eVar24: "",
                adobeHit: null,
                error: ""
            };
            try {
                await this.preparePageForCTAClick(pageUrl);
                this.currentAction = "Clicking CTA";
                this.currentCTA = cta.label || cta.text || "CTA";
                const element = await this.findCTAElement(cta);
                if (!element) {
                    validation.status = "FAIL";
                    validation.error = "CTA element was not found after page reload.";
                    validations.push(validation);
                    continue
                }
                await this.driver.executeScript("arguments[0].scrollIntoView({block:'center', inline:'center'});", element);
                await new Promise(resolve => setTimeout(resolve, 300));
                await element.click();
                this.currentAction = "Capturing Adobe hit";
                const hits = await this.collectCTAAdobeHits(),
                    validHit = hits.find(hit => this.getHitEVar24(hit) && this.hitHasEvent6(hit));
                if (validHit) {
                    validation.status = "PASS";
                    validation.event6 = true;
                    validation.eVar24 = this.getHitEVar24(validHit);
                    validation.adobeHit = validHit
                } else if (hits.length) {
                    validation.status = "FAIL";
                    validation.error = "No single Adobe hit contained both v24 and event6.";
                    validation.adobeHit = hits[hits.length - 1];
                    validation.event6 = hits.some(hit => this.hitHasEvent6(hit));
                    validation.eVar24 = hits.map(hit => this.getHitEVar24(hit)).find(Boolean) || ""
                } else {
                    validation.status = "FAIL";
                    validation.error = "No Adobe hit was captured after CTA click."
                }
            } catch (error) {
                validation.status = "FAIL";
                validation.error = error.message
            }
            validations.push(validation)
        }
        this.currentAction = "";
        this.currentCTA = "";
        this.results.ctaValidations.push(...validations);
        return validations
    }
    mergePageResult(pageResult) {
        this.results.pages.push(pageResult);
        if (pageResult.errors && pageResult.errors.length) this.results.errors.push(...pageResult.errors)
    }
    async scanPage(url, baseUrl) {
        const pageUrl = this.normalizeUrl(url),
            pageNumber = this.visited.size;
        this.currentPageUrl = pageUrl;
        this.currentStep = `Scanning page ${pageNumber}`;
        this.currentAction = "Loading page";
        this.currentCTA = "";
        const pageResult = {
            url: pageUrl,
            finalUrl: pageUrl,
            title: "",
            pageName: "",
            adobeHits: [],
            adobeTracked: false,
            reportSuite: "",
            eVars: {},
            props: {},
            events: {},
            marketingPixels: [],
            links: [],
            ctas: [],
            ctaValidations: [],
            errors: [],
            status: "PASS"
        };
        try {
            await this.driver.get(pageUrl);
            this.currentPageUrl = await this.driver.getCurrentUrl();
            this.currentAction = "Waiting for page";
            await this.driver.wait(until.elementLocated(By.css("body")), 15000);
            await new Promise(resolve => setTimeout(resolve, 1000));
            pageResult.title = await this.driver.getTitle();
            const actualLoadedUrl = this.normalizeUrl(await this.driver.getCurrentUrl());
            if (this.isCheckoutSuccessUrl(pageUrl) && actualLoadedUrl) pageResult.url = actualLoadedUrl;
            pageResult.finalUrl = actualLoadedUrl || pageResult.url;
            this.currentPageUrl = pageResult.finalUrl;
            this.currentAction = "Capturing Adobe Analytics";
            await this.collectNetworkData();
            await new Promise(resolve => setTimeout(resolve, this.postAdobeWait));
            await this.collectNetworkData();
            const pageAdobeHits = this.results.adobeHits.filter(hit => hit.url && (!pageResult.finalUrl || hit.url.includes(pageResult.finalUrl.split("?")[0]))),
                allRecentHits = this.results.adobeHits.slice(-20);
            pageResult.adobeHits = pageAdobeHits.length ? pageAdobeHits : allRecentHits;
            pageResult.adobeTracked = pageResult.adobeHits.length > 0;
            const latestHit = pageResult.adobeHits[pageResult.adobeHits.length - 1],
                domPageName = await this.getPageNameFromDom();
            pageResult.pageName = latestHit && latestHit.pageName || domPageName || "";
            if (latestHit) pageResult.reportSuite = latestHit.reportSuite || "", pageResult.eVars = latestHit.eVars || {}, pageResult.props = latestHit.props || {}, pageResult.events = latestHit.events || {};
            pageResult.marketingPixels = this.results.marketingPixels.slice(-100);
            this.currentAction = "Finding links and CTAs";
            pageResult.links = await this.getPageLinks(baseUrl);
            pageResult.ctas = await this.getCTAs();
            this.currentAction = "Validating CTAs";
            pageResult.ctaValidations = await this.validateCTAs(pageResult.url, pageResult.pageName, baseUrl);
            pageResult.status = "PASS"
        } catch (error) {
            pageResult.status = "FAIL";
            pageResult.errors.push(error.message);
            this.results.errors.push({
                url: pageResult.url,
                error: error.message
            });
            console.error(`[SiteCrawler] Page scan failed: ${pageResult.url}`);
            console.error(`[SiteCrawler] Error: ${error.stack||error.message}`)
        }
        this.mergePageResult(pageResult);
        this.currentPageUrl = pageResult.finalUrl || pageResult.url;
        this.currentStep = `Completed page ${pageNumber}`;
        this.currentAction = "";
        this.currentCTA = "";
        return pageResult
    }
    async scanSelectedUrls(urls) {
        const selectedUrls = [...new Set((urls || []).map(url => this.normalizeUrl(url)).filter(url => this.isValidPageUrl(url)))];
        if (!selectedUrls.length) throw new Error("No valid URLs were provided.");
        await this.createDriver();
        this.results = {
            pages: [],
            adobePages: [],
            adobeHits: [],
            marketingPixels: [],
            errors: [],
            eVars: {},
            props: {},
            events: {},
            reportSuites: {},
            ctaValidations: [],
            totalNetworkRequests: 0
        };
        this.visited = new Set;
        this.queue = [];
        this.currentStep = "Starting selected URL validation";
        this.currentAction = "";
        this.currentCTA = "";
        const baseUrl = selectedUrls[0];
        try {
            for (const url of selectedUrls) await this.scanPage(url, baseUrl)
        } finally {
            await this.quitDriver();
            this.currentAction = "";
            this.currentCTA = ""
        }
        return this.results
    }
    async scan(startUrl, maxPages = this.maxPages) {
        const baseUrl = this.normalizeUrl(startUrl);
        if (!this.isValidPageUrl(baseUrl)) throw new Error(`Invalid start URL: ${startUrl}`);
        await this.createDriver();
        this.results = {
            pages: [],
            adobePages: [],
            adobeHits: [],
            marketingPixels: [],
            errors: [],
            eVars: {},
            props: {},
            events: {},
            reportSuites: {},
            ctaValidations: [],
            totalNetworkRequests: 0
        };
        this.visited = new Set;
        this.queue = [baseUrl];
        this.currentStep = "Starting website crawl";
        this.currentPageUrl = baseUrl;
        this.currentAction = "";
        this.currentCTA = "";
        try {
            while (this.queue.length && this.visited.size < maxPages) {
                const currentUrl = this.queue.shift(),
                    normalizedUrl = this.normalizeUrl(currentUrl);
                if (this.visited.has(normalizedUrl)) continue;
                this.visited.add(normalizedUrl);
                this.currentStep = `Scanning page ${this.visited.size} of ${maxPages}`;
                this.currentPageUrl = normalizedUrl;
                this.currentAction = "Loading page";
                this.currentCTA = "";
                const pageResult = await this.scanPage(normalizedUrl, baseUrl),
                    links = pageResult.links || [];
                for (const link of links) {
                    const normalizedLink = this.normalizeUrl(link);
                    if (!this.visited.has(normalizedLink) && !this.queue.includes(normalizedLink) && this.isSameDomain(normalizedLink, baseUrl)) this.queue.push(normalizedLink)
                }
            }
            this.currentStep = `Website crawl completed (${this.results.pages.length} pages)`;
            this.currentAction = "";
            this.currentCTA = ""
        } finally {
            await this.quitDriver()
        }
        return this.results
    }
    async close() {
        if (this.driver) try {
            await this.driver.quit()
        } catch (error) {} finally {
            this.driver = null
        }
    }
    getResults() {
        return this.results
    }
    getSummary() {
        return {
            totalPages: this.results.pages.length,
            adobeTrackedPages: this.results.pages.filter(page => page.adobeTracked).length,
            totalAdobeHits: this.results.adobeHits.length,
            totalMarketingPixels: this.results.marketingPixels.length,
            totalErrors: this.results.errors.length,
            totalCTAs: this.results.ctaValidations.length,
            ctaPass: this.results.ctaValidations.filter(item => item.status === "PASS").length,
            ctaFail: this.results.ctaValidations.filter(item => item.status === "FAIL").length,
            reportSuites: Object.keys(this.results.reportSuites)
        }
    }
}
module.exports = SiteCrawler;