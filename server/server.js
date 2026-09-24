const express = require("express"),
    path = require("path"),
    fs = require("fs");
const app = express();
const PORT = Number(process.env.PORT) || 3000,
    HOST = "0.0.0.0";
let PreSalesJourneyValidator = null,
    preSalesReportGenerator = null,
    SiteCrawler = null,
    reportGenerator = null;
let currentJob = null,
    activeValidator = null,
    activeCrawler = null,
    monitorTimer = null;
let shutdownInProgress = false,
    uncaughtHandling = false;
loadDotEnv();
app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/reports", express.static(path.join(__dirname, "..", "reports", "output")));

function loadRuntimeModules() {
    if (!PreSalesJourneyValidator) PreSalesJourneyValidator = require("../scanner/preSalesJourneyValidator");
    if (!preSalesReportGenerator) preSalesReportGenerator = require("../reports/preSalesReportGenerator");
    if (!SiteCrawler) SiteCrawler = require("../scanner/siteCrawler");
    if (!reportGenerator) reportGenerator = require("../reports/reportGenerator")
}

function loadDotEnv() {
    const envPath = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index < 1) continue;
        const key = trimmed.slice(0, index).trim();
        let value = trimmed.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (process.env[key] === undefined) process.env[key] = value
    }
}

function createJob(inputs) {
    return {
        id: `job-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        status: "QUEUED",
        startedAt: null,
        finishedAt: null,
        inputs,
        reportPath: null,
        error: null,
        logs: [],
        pages: [],
        currentPage: null,
        summary: null
    }
}

function addJobLog(job, message, level = "INFO") {
    if (!job) return;
    job.logs.push({
        timestamp: new Date().toISOString(),
        level,
        message: String(message)
    });
    if (job.logs.length > 500) job.logs.splice(0, job.logs.length - 500)
}

function updateSummary(job, result) {
    if (!job || !result) return;
    const summary = result.summary || {},
        pages = Array.isArray(result.pages) ? result.pages : [],
        hits = Array.isArray(result.hits) ? result.hits : [],
        errors = Array.isArray(result.errors) ? result.errors : [];
    job.summary = {
        journey: summary.status || "-",
        adobe: Number(summary.adobeHits || hits.length || 0) > 0 ? "PASS" : "-",
        cta: summary.cta || "-",
        pagesVisited: Number(summary.pagesVisited || pages.length || 0),
        adobeHits: Number(summary.adobeHits || hits.length || 0),
        errors: errors.length
    }
}

function syncValidatorState(job, validator) {
    if (!job || !validator || !validator.result) return;
    const result = validator.result,
        pages = Array.isArray(result.pages) ? result.pages : [];
    if (pages.length > job.pages.length) {
        for (let i = job.pages.length; i < pages.length; i += 1) {
            const page = pages[i];
            job.pages.push({
                step: page.step || `Page ${i+1}`,
                url: page.url || "",
                pageName: page.pageName || "",
                status: page.status || "PASS",
                adobeHitCount: page.adobeHitCount || 0,
                eventsFound: page.eventsFound || []
            });
            addJobLog(job, `${page.step||`Page ${i+1}`} completed - ${page.url||""}`, page.status === "FAIL" ? "ERROR" : "INFO")
        }
    }
    const currentUrl = validator.currentPageUrl || "";
    if (currentUrl || validator.currentStep) job.currentPage = {
        url: currentUrl,
        step: validator.currentStep || (job.pages.length ? job.pages[job.pages.length - 1].step : "Starting journey"),
        action: validator.currentAction || "",
        cta: validator.currentCTA || "",
        status: "RUNNING"
    }
    updateSummary(job, result)
}

function syncAnalyticsState(job, crawler) {
    if (!job || !crawler) return;
    let result = {};
    try {
        if (typeof crawler.getResults === "function") result = crawler.getResults() || {}
    } catch (error) {
        addJobLog(job, `Unable to read crawler results: ${error.message||error}`, "WARN");
        return
    }
    const pages = Array.isArray(result.pages) ? result.pages : [],
        adobeHits = Array.isArray(result.adobeHits) ? result.adobeHits : [],
        errors = Array.isArray(result.errors) ? result.errors : [],
        ctaValidations = Array.isArray(result.ctaValidations) ? result.ctaValidations : [];
    if (pages.length > job.pages.length) {
        for (let i = job.pages.length; i < pages.length; i += 1) {
            const page = pages[i];
            job.pages.push({
                step: page.step || page.name || `Page ${i+1}`,
                url: page.url || page.pageUrl || "",
                pageName: page.pageName || "",
                status: page.status || "PASS",
                adobeHitCount: Number(page.adobeHitCount || page.adobeHits && page.adobeHits.length || 0),
                eventsFound: Array.isArray(page.eventsFound) ? page.eventsFound : Array.isArray(page.events) ? page.events : []
            });
            addJobLog(job, `${page.step||page.name||`Page ${i+1}`} completed - ${page.url||page.pageUrl||""}`, page.status === "FAIL" ? "ERROR" : "INFO")
        }
    }
    const currentUrl = crawler.currentPageUrl || crawler.currentUrl || "",
        currentStep = crawler.currentStep || "",
        currentAction = crawler.currentAction || "",
        currentCTA = crawler.currentCTA || "";
    if (currentUrl || currentStep) job.currentPage = {
        url: currentUrl,
        step: currentStep || (pages.length ? pages[pages.length - 1].step || pages[pages.length - 1].name || `Page ${pages.length}` : "Starting sitewide validation"),
        action: currentAction,
        cta: currentCTA,
        status: "RUNNING"
    }
    job.summary = {
        journey: "-",
        adobe: adobeHits.length > 0 ? "PASS" : "-",
        cta: ctaValidations.length ? ctaValidations.every(item => item.status === "PASS") ? "PASS" : ctaValidations.some(item => item.status === "FAIL") ? "FAIL" : "-" : "-",
        pagesVisited: pages.length,
        adobeHits: adobeHits.length,
        errors: errors.length
    }
}

function syncCompletedState(job, result) {
    if (!job || !result) return;
    const pages = Array.isArray(result.pages) ? result.pages : [];
    job.pages = pages.map(page => ({
        step: page.step || page.name || "",
        url: page.url || page.pageUrl || "",
        pageName: page.pageName || "",
        status: page.status || "PASS",
        adobeHitCount: page.adobeHitCount || 0,
        eventsFound: page.eventsFound || page.events || []
    }));
    job.currentPage = null;
    updateSummary(job, result)
}

function startValidatorMonitor(job, validator) {
    stopValidatorMonitor();
    monitorTimer = setInterval(() => {
        try {
            syncValidatorState(job, validator)
        } catch (error) {
            addJobLog(job, `Monitor error: ${error.message||error}`, "WARN")
        }
    }, 500)
}

function startAnalyticsMonitor(job, crawler) {
    stopValidatorMonitor();
    monitorTimer = setInterval(() => {
        try {
            syncAnalyticsState(job, crawler)
        } catch (error) {
            addJobLog(job, `Analytics monitor error: ${error.message||error}`, "WARN")
        }
    }, 500)
}

function stopValidatorMonitor() {
    if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null
    }
}

function createEmptyResult() {
    return {
        startedAt: new Date().toISOString(),
        finishedAt: null,
        authentication: {},
        summary: {},
        pages: [],
        actions: [],
        products: [],
        orders: [],
        ecommerceEvents: [],
        hits: [],
        errors: [],
        selections: []
    }
}

function normalizePreSalesFailureResult(result, reason, termination) {
    const safeResult = result || createEmptyResult();
    safeResult.summary = safeResult.summary || {};
    safeResult.pages = Array.isArray(safeResult.pages) ? safeResult.pages : [];
    safeResult.actions = Array.isArray(safeResult.actions) ? safeResult.actions : [];
    safeResult.products = Array.isArray(safeResult.products) ? safeResult.products : [];
    safeResult.orders = Array.isArray(safeResult.orders) ? safeResult.orders : [];
    safeResult.ecommerceEvents = Array.isArray(safeResult.ecommerceEvents) ? safeResult.ecommerceEvents : [];
    safeResult.hits = Array.isArray(safeResult.hits) ? safeResult.hits : [];
    safeResult.errors = Array.isArray(safeResult.errors) ? safeResult.errors : [];
    safeResult.selections = Array.isArray(safeResult.selections) ? safeResult.selections : [];
    safeResult.summary.status = "FAIL";
    safeResult.summary.pagesVisited = safeResult.pages.length;
    safeResult.summary.adobeHits = safeResult.hits.length;
    safeResult.summary.ecommerceEvents = safeResult.ecommerceEvents.length;
    safeResult.summary.productsCaptured = safeResult.products.length;
    safeResult.summary.ordersCaptured = safeResult.orders.length;
    safeResult.summary.passed = safeResult.pages.filter(page => page.status === "PASS").length;
    safeResult.summary.failed = safeResult.pages.filter(page => page.status === "FAIL").length;
    safeResult.interrupted = true;
    safeResult.executionTerminationReason = reason || "Validation execution was interrupted.";
    safeResult.executionTerminationType = termination || "INTERRUPTED";
    if (reason) {
        const alreadyLogged = safeResult.errors.some(error => String(error.error || "") === String(reason));
        if (!alreadyLogged) safeResult.errors.push({
            timestamp: new Date().toISOString(),
            step: safeResult.pages.length + 1,
            error: reason,
            currentUrl: activeValidator && activeValidator.currentPageUrl ? activeValidator.currentPageUrl : ""
        })
    }
    safeResult.finishedAt = new Date().toISOString();
    return safeResult
}
async function generatePreSalesFailureReport(job, result, reason, termination = "PAGE_OR_EXECUTION_FAILURE") {
    if (!job) return null;
    loadRuntimeModules();
    const reportResult = normalizePreSalesFailureResult(result, reason, termination),
        output = path.join(__dirname, "..", "reports", "output");
    fs.mkdirSync(output, {
        recursive: true
    });
    const reportPath = await preSalesReportGenerator.generatePreSalesHTML(reportResult, output, {
        uniqueFile: true
    });
    job.reportPath = `/reports/${path.basename(reportPath)}`;
    job.finishedAt = reportResult.finishedAt;
    job.error = reason || null;
    job.status = "FAILED";
    syncCompletedState(job, reportResult);
    addJobLog(job, `Failure report generated: ${job.reportPath}`, "INFO");
    return job.reportPath
}
async function generateAnalyticsFailureReport(job, crawler, reason, termination = "PAGE_OR_EXECUTION_FAILURE") {
    if (!job) return null;
    loadRuntimeModules();
    let result = createEmptyResult();
    try {
        if (crawler && typeof crawler.getResults === "function") result = crawler.getResults() || createEmptyResult()
    } catch (_) {}
    result.pages = Array.isArray(result.pages) ? result.pages : [];
    result.hits = Array.isArray(result.hits) ? result.hits : [];
    result.adobeHits = Array.isArray(result.adobeHits) ? result.adobeHits : [];
    result.errors = Array.isArray(result.errors) ? result.errors : [];
    result.summary = result.summary || {};
    const duplicate = result.errors.some(error => String(error.error || "") === String(reason));
    if (!duplicate) result.errors.push({
        timestamp: new Date().toISOString(),
        error: reason,
        currentUrl: crawler && (crawler.currentPageUrl || crawler.currentUrl || "")
    });
    result.summary.status = "FAIL";
    result.summary.pagesVisited = result.pages.length;
    result.summary.adobeHits = result.adobeHits.length || result.hits.length;
    result.interrupted = true;
    result.executionTerminationReason = reason;
    result.executionTerminationType = termination;
    result.finishedAt = new Date().toISOString();
    const output = path.join(__dirname, "..", "reports", "output");
    fs.mkdirSync(output, {
        recursive: true
    });
    const reportPath = await reportGenerator.generateHTML(result, output);
    job.reportPath = `/reports/${path.basename(reportPath)}`;
    job.status = "FAILED";
    job.finishedAt = result.finishedAt;
    job.error = reason || null;
    syncCompletedState(job, result);
    addJobLog(job, `Analytics failure report generated: ${job.reportPath}`, "INFO");
    return job.reportPath
}
async function runAnalyticsValidation(job) {
    job.status = "RUNNING";
    job.startedAt = new Date().toISOString();
    addJobLog(job, "Sitewide Adobe Analytics validation started.");
    addJobLog(job, `Website URL: ${job.inputs.url}`);
    addJobLog(job, `Maximum pages: ${job.inputs.maxPages}`);
    addJobLog(job, "Initializing Selenium site crawler.");
    let crawler = null;
    try {
        loadRuntimeModules();
        crawler = new SiteCrawler({
            maxPages: job.inputs.maxPages,
            maxAdobeWait: 60000,
            postAdobeWait: 4000,
            ctaClickWait: 15000,
            ctaPollInterval: 250,
            validations: job.inputs.validations || {}
        });
        activeCrawler = crawler;
        startAnalyticsMonitor(job, crawler);
        addJobLog(job, "Selenium site crawler initialized.");
        addJobLog(job, "Starting website crawl and Adobe /b/ss validation.");
        const result = await crawler.scan(job.inputs.url, job.inputs.maxPages),
            finalResult = result || (typeof crawler.getResults === "function" ? crawler.getResults() : createEmptyResult()),
            output = path.join(__dirname, "..", "reports", "output");
        fs.mkdirSync(output, {
            recursive: true
        });
        addJobLog(job, "Website crawl completed. Generating Analytics report.");
        const reportPath = await reportGenerator.generateHTML(finalResult, output);
        job.reportPath = `/reports/${path.basename(reportPath)}`;
        job.finishedAt = finalResult && finalResult.finishedAt ? finalResult.finishedAt : new Date().toISOString();
        const resultStatus = finalResult && finalResult.summary ? String(finalResult.summary.status || "").toUpperCase() : "";
        job.status = resultStatus === "FAIL" ? "FAILED" : "COMPLETED";
        job.error = job.status === "FAILED" && Array.isArray(finalResult.errors) && finalResult.errors.length ? finalResult.errors[finalResult.errors.length - 1].error : null;
        syncCompletedState(job, finalResult);
        addJobLog(job, `Sitewide validation finished with status ${job.status}.`);
        addJobLog(job, `Report generated: ${job.reportPath}`)
    } catch (error) {
        const reason = error && error.message ? error.message : String(error);
        addJobLog(job, `Sitewide validation stopped: ${reason}`, "ERROR");
        try {
            await generateAnalyticsFailureReport(job, crawler, reason, "PAGE_OR_EXECUTION_FAILURE")
        } catch (reportError) {
            job.status = "FAILED";
            job.finishedAt = new Date().toISOString();
            job.error = `${reason} | Report generation failed: ${reportError.message||reportError}`;
            addJobLog(job, `Analytics report generation failed: ${reportError.message||reportError}`, "ERROR")
        }
    } finally {
        stopValidatorMonitor();
        activeCrawler = null;
        if (crawler) try {
            await crawler.close()
        } catch (closeError) {
            addJobLog(job, `Unable to close Analytics crawler: ${closeError.message||closeError}`, "WARN")
        }
    }
}
async function runPreSalesJourney(job) {
    job.status = "RUNNING";
    job.startedAt = new Date().toISOString();
    addJobLog(job, "Pre-Sales journey started.");
    let journeyError = null;
    try {
        loadRuntimeModules();
        const paymentMode = job.inputs.paymentMode === "Pay Later" ? "payLater" : "payToday",
            validator = new PreSalesJourneyValidator({
                startUrl: process.env.PRESALES_START_URL,
                maxAdobeWait: 60000,
                networkQuietTime: 4000,
                pollInterval: 250,
                credentials: {
                    hubId: job.inputs.hubId,
                    hubPassword: process.env.HUB_PASSWORD
                },
                journeyConfig: require("../config/preSalesJourney.json"),
                paymentOptionPrompt: async () => paymentMode === "payLater" ? "1" : "2",
                payLaterPeriod: paymentMode === "payLater" ? job.inputs.paymentPeriod : null,
                simType: job.inputs.simType
            });
        activeValidator = validator;
        startValidatorMonitor(job, validator);
        const result = await validator.run();
        syncCompletedState(job, result);
        const output = path.join(__dirname, "..", "reports", "output");
        fs.mkdirSync(output, {
            recursive: true
        });
        const reportPath = await preSalesReportGenerator.generatePreSalesHTML(result, output, {
            uniqueFile: true
        });
        job.reportPath = `/reports/${path.basename(reportPath)}`;
        job.status = result.summary && result.summary.status === "FAIL" ? "FAILED" : "COMPLETED";
        job.finishedAt = result.finishedAt || new Date().toISOString();
        job.error = job.status === "FAILED" && result.errors && result.errors.length ? result.errors[result.errors.length - 1].error : null;
        addJobLog(job, `Validation finished with status ${job.status}.`);
        addJobLog(job, `Report generated: ${job.reportPath}`)
    } catch (error) {
        journeyError = error;
        const result = activeValidator && activeValidator.result ? activeValidator.result : createEmptyResult(),
            reason = error && error.message ? error.message : String(error);
        addJobLog(job, `Journey stopped: ${reason}`, "ERROR");
        try {
            await generatePreSalesFailureReport(job, result, reason, "PAGE_OR_EXECUTION_FAILURE")
        } catch (reportError) {
            job.status = "FAILED";
            job.finishedAt = new Date().toISOString();
            job.error = `${reason} | Report generation failed: ${reportError.message||reportError}`;
            addJobLog(job, `Report generation failed: ${reportError.message||reportError}`, "ERROR")
        }
    } finally {
        stopValidatorMonitor();
        activeValidator = null;
        if (journeyError) job.status = "FAILED"
    }
}

function serializeJob(job) {
    if (!job) return null;
    const startedAt = job.startedAt ? new Date(job.startedAt) : null,
        finishedAt = job.finishedAt ? new Date(job.finishedAt) : null;
    let duration = null;
    if (startedAt) {
        const endTime = finishedAt || new Date(),
            totalSeconds = Math.max(0, Math.floor((endTime.getTime() - startedAt.getTime()) / 1000));
        duration = `${Math.floor(totalSeconds/60)}m ${totalSeconds%60}s`
    }
    let currentStep = "Waiting to start";
    if (job.status === "QUEUED") currentStep = "Job queued";
    if (job.status === "RUNNING") currentStep = job.currentPage && job.currentPage.step ? job.currentPage.step : job.inputs && job.inputs.mode === "analytics" ? "Executing sitewide Analytics validation" : "Executing Selenium journey";
    if (job.status === "COMPLETED") currentStep = "Validation completed";
    if (job.status === "FAILED") currentStep = "Validation failed";
    return {
        jobId: job.id,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.finishedAt,
        finishedAt: job.finishedAt,
        duration,
        currentStep,
        currentPage: job.currentPage,
        message: job.error || null,
        error: job.error || null,
        reportPath: job.reportPath,
        logs: job.logs || [],
        summary: job.summary || null,
        pages: job.pages || [],
        inputs: job.inputs
    }
}

function findLatestReport() {
    const output = path.join(__dirname, "..", "reports", "output");
    if (!fs.existsSync(output)) return null;
    const reports = fs.readdirSync(output).filter(name => name.toLowerCase().endsWith(".html")).map(name => ({
        name,
        mtime: fs.statSync(path.join(output, name)).mtimeMs
    })).sort((a, b) => b.mtime - a.mtime);
    return reports.length ? `/reports/${encodeURIComponent(reports[0].name)}` : null
}
app.get("/health", (req, res) => res.status(200).json({
    success: true,
    status: "UP",
    service: "Adobe Analytics Validator",
    port: PORT,
    timestamp: new Date().toISOString()
}));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
app.get("/api/reports/latest", (req, res) => res.json({
    success: true,
    reportPath: currentJob && currentJob.reportPath ? currentJob.reportPath : findLatestReport()
}));
app.post("/api/jobs", (req, res) => {
    const {
        mode,
        url,
        maxPages,
        validations,
        hubId,
        paymentMode,
        paymentPeriod,
        simType
    } = req.body;
    if (!mode || !["analytics", "presales"].includes(mode)) return res.status(400).json({
        success: false,
        error: "Please select a valid validation mode."
    });
    if (currentJob && ["QUEUED", "RUNNING"].includes(currentJob.status)) return res.status(409).json({
        success: false,
        error: "Another validation is currently running. Please wait."
    });
    if (mode === "analytics") {
        if (!url) return res.status(400).json({
            success: false,
            error: "Website URL is required."
        });
        try {
            new URL(url)
        } catch (_) {
            return res.status(400).json({
                success: false,
                error: "Please provide a valid website URL."
            })
        }
        const pages = Number(maxPages) || 25;
        if (!Number.isInteger(pages) || pages < 1 || pages > 100) return res.status(400).json({
            success: false,
            error: "Maximum Pages must be between 1 and 100."
        });
        currentJob = createJob({
            mode: "analytics",
            url,
            maxPages: pages,
            validations: validations || {
                pageLoad: true,
                eVars: true,
                props: true,
                events: true,
                products: true,
                cta: true
            }
        });
        addJobLog(currentJob, "Analytics validation job created and queued.");
        runAnalyticsValidation(currentJob).catch(async error => {
            const reason = error && error.message ? error.message : String(error);
            addJobLog(currentJob, `Unexpected Analytics execution error: ${reason}`, "ERROR");
            try {
                await generateAnalyticsFailureReport(currentJob, activeCrawler, reason, "UNEXPECTED_SERVER_EXECUTION_ERROR")
            } catch (reportError) {
                currentJob.status = "FAILED";
                currentJob.finishedAt = new Date().toISOString();
                currentJob.error = `${reason} | Report generation failed: ${reportError.message||reportError}`
            }
        });
        return res.status(202).json({
            success: true,
            message: "Adobe Analytics validation queued successfully.",
            jobId: currentJob.id,
            status: currentJob.status,
            startedAt: currentJob.startedAt
        })
    }
    if (!hubId || !paymentMode || !simType) return res.status(400).json({
        success: false,
        error: "Hub ID, payment mode, and SIM type are required."
    });
    currentJob = createJob({
        mode: "presales",
        hubId,
        paymentMode,
        paymentPeriod: paymentMode === "Pay Later" ? paymentPeriod || null : null,
        simType
    });
    addJobLog(currentJob, "Pre-Sales journey job created and queued.");
    runPreSalesJourney(currentJob).catch(async error => {
        const reason = error && error.message ? error.message : String(error);
        addJobLog(currentJob, `Unexpected Pre-Sales execution error: ${reason}`, "ERROR");
        try {
            await generatePreSalesFailureReport(currentJob, activeValidator ? activeValidator.result : null, reason, "UNEXPECTED_SERVER_EXECUTION_ERROR")
        } catch (reportError) {
            currentJob.status = "FAILED";
            currentJob.finishedAt = new Date().toISOString();
            currentJob.error = `${reason} | Report generation failed: ${reportError.message||reportError}`
        }
    });
    return res.status(202).json({
        success: true,
        message: "Selenium journey queued successfully.",
        jobId: currentJob.id,
        status: currentJob.status,
        startedAt: currentJob.startedAt
    })
});
app.get("/api/jobs/:jobId", (req, res) => {
    if (!currentJob || currentJob.id !== req.params.jobId) return res.status(404).json({
        success: false,
        error: "Job not found."
    });
    if (currentJob.inputs && currentJob.inputs.mode === "analytics") syncAnalyticsState(currentJob, activeCrawler);
    else syncValidatorState(currentJob, activeValidator);
    return res.json(serializeJob(currentJob))
});
app.post("/api/journeys", (req, res) => {
    const {
        hubId,
        paymentMode,
        paymentPeriod,
        simType
    } = req.body;
    if (!hubId || !paymentMode || !simType) return res.status(400).json({
        success: false,
        message: "Hub ID, payment mode, and SIM type are required."
    });
    if (currentJob && ["QUEUED", "RUNNING"].includes(currentJob.status)) return res.status(409).json({
        success: false,
        message: "Another journey is currently running. Please wait."
    });
    currentJob = createJob({
        mode: "presales",
        hubId,
        paymentMode,
        paymentPeriod: paymentMode === "Pay Later" ? paymentPeriod || null : null,
        simType
    });
    addJobLog(currentJob, "Journey created through /api/journeys.");
    void runPreSalesJourney(currentJob);
    return res.json({
        success: true,
        message: "Selenium journey started successfully.",
        jobId: currentJob.id,
        status: currentJob.status
    })
});
app.get("/api/journeys/current", (req, res) => res.json({
    success: true,
    job: currentJob ? serializeJob(currentJob) : null
}));
const server = app.listen(PORT, HOST, () => {
    console.log("==================================================");
    console.log("Adobe Analytics Validator server started");
    console.log(`Environment: ${process.env.NODE_ENV||"development"}`);
    console.log(`PORT: ${PORT}`);
    console.log(`HOST: ${HOST}`);
    console.log(`Health check: http://127.0.0.1:${PORT}/health`);
    console.log("==================================================")
});
server.on("error", error => console.error("Web server error:", error));
async function gracefulShutdown(signal) {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    console.log(`\n${signal} received. Preparing safe shutdown...`);
    try {
        stopValidatorMonitor();
        if (currentJob && ["QUEUED", "RUNNING"].includes(currentJob.status) && activeCrawler) {
            const reason = `Execution interrupted because the server received ${signal}.`;
            addJobLog(currentJob, reason, "ERROR");
            try {
                await generateAnalyticsFailureReport(currentJob, activeCrawler, reason, "SERVER_STOP");
                console.log(`Partial Analytics report generated: ${currentJob.reportPath}`)
            } catch (reportError) {
                console.error("Unable to generate Analytics interruption report:", reportError)
            }
            try {
                await activeCrawler.close()
            } catch (closeError) {
                console.error("Unable to close Analytics crawler:", closeError)
            }
        }
        if (currentJob && ["QUEUED", "RUNNING"].includes(currentJob.status) && activeValidator) {
            syncValidatorState(currentJob, activeValidator);
            const reason = `Execution interrupted because the server received ${signal}.`;
            addJobLog(currentJob, reason, "ERROR");
            try {
                const reportPath = await generatePreSalesFailureReport(currentJob, activeValidator.result, reason, "SERVER_STOP");
                console.log(`Partial validation report generated: ${reportPath}`)
            } catch (reportError) {
                console.error("Unable to generate interruption report:", reportError)
            }
            try {
                await activeValidator.close()
            } catch (closeError) {
                console.error("Unable to close Selenium driver:", closeError)
            }
        }
    } catch (error) {
        console.error("Graceful shutdown report handling failed:", error)
    } finally {
        activeValidator = null;
        activeCrawler = null;
        try {
            await new Promise(resolve => server.close(resolve))
        } catch (_) {}
        process.exit(0)
    }
}
process.on("SIGINT", () => {
    void gracefulShutdown("SIGINT")
});
process.on("SIGTERM", () => {
    void gracefulShutdown("SIGTERM")
});
process.on("uncaughtException", async error => {
    console.error("Uncaught exception:", error);
    if (uncaughtHandling) return;
    uncaughtHandling = true;
    if (currentJob && activeCrawler) try {
        await generateAnalyticsFailureReport(currentJob, activeCrawler, `Uncaught server exception: ${error.message||error}`, "UNCAUGHT_EXCEPTION")
    } catch (reportError) {
        console.error("Analytics exception report generation failed:", reportError)
    }
    if (currentJob && activeValidator && !activeCrawler) try {
        await generatePreSalesFailureReport(currentJob, activeValidator.result, `Uncaught server exception: ${error.message||error}`, "UNCAUGHT_EXCEPTION")
    } catch (reportError) {
        console.error("Pre-Sales exception report generation failed:", reportError)
    }
    await gracefulShutdown("UNCAUGHT_EXCEPTION")
});
process.on("unhandledRejection", async reason => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    console.error("Unhandled rejection:", error);
    if (uncaughtHandling) return;
    uncaughtHandling = true;
    if (currentJob && activeCrawler) try {
        await generateAnalyticsFailureReport(currentJob, activeCrawler, `Unhandled server rejection: ${error.message||error}`, "UNHANDLED_REJECTION")
    } catch (reportError) {
        console.error("Analytics rejection report generation failed:", reportError)
    }
    if (currentJob && activeValidator && !activeCrawler) try {
        await generatePreSalesFailureReport(currentJob, activeValidator.result, `Unhandled server rejection: ${error.message||error}`, "UNHANDLED_REJECTION")
    } catch (reportError) {
        console.error("Pre-Sales rejection report generation failed:", reportError)
    }
    await gracefulShutdown("UNHANDLED_REJECTION")
});