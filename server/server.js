const express = require("express");
const path = require("path");
const fs = require("fs");

const PreSalesJourneyValidator = require("../scanner/preSalesJourneyValidator");
const preSalesReportGenerator = require("../reports/preSalesReportGenerator");

const app = express();
const PORT = Number(process.env.PORT || 3000);

let currentJob = null;
let activeValidator = null;
let monitorTimer = null;
let shutdownInProgress = false;
let uncaughtHandling = false;

loadDotEnv();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/reports", express.static(path.join(__dirname, "..", "reports", "output")));

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

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (process.env[key] === undefined) process.env[key] = value;
    }
}

function createJob(inputs) {
    return {
        id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
    };
}

function addJobLog(job, message, level = "INFO") {
    if (!job) return;
    job.logs.push({
        timestamp: new Date().toISOString(),
        level,
        message: String(message)
    });

    if (job.logs.length > 500) {
        job.logs.splice(0, job.logs.length - 500);
    }
}

function updateSummary(job, result) {
    if (!job || !result) return;

    const summary = result.summary || {};
    job.summary = {
        journey: summary.status || "-",
        adobe: Number(summary.adobeHits || 0) > 0 ? "PASS" : "-",
        cta: "-",
        pagesVisited: Number(summary.pagesVisited || (result.pages || []).length || 0),
        adobeHits: Number(summary.adobeHits || (result.hits || []).length || 0),
        errors: Array.isArray(result.errors) ? result.errors.length : Number(summary.failed || 0)
    };
}

function syncValidatorState(job, validator) {
    if (!job || !validator || !validator.result) return;

    const result = validator.result;
    const pages = Array.isArray(result.pages) ? result.pages : [];

    if (pages.length > job.pages.length) {
        for (let i = job.pages.length; i < pages.length; i += 1) {
            const page = pages[i];
            job.pages.push({
                step: page.step || `Page ${i + 1}`,
                url: page.url || "",
                pageName: page.pageName || "",
                status: page.status || "PASS",
                adobeHitCount: page.adobeHitCount || 0,
                eventsFound: page.eventsFound || []
            });

            addJobLog(
                job,
                `${page.step || `Page ${i + 1}`} completed - ${page.url || ""}`,
                page.status === "FAIL" ? "ERROR" : "INFO"
            );
        }
    }

    const currentUrl = validator.currentPageUrl || "";
    if (currentUrl) {
        job.currentPage = {
            url: currentUrl,
            step: job.pages.length ? job.pages[job.pages.length - 1].step : "Starting journey",
            status: "RUNNING"
        };
    }

    updateSummary(job, result);
}

function syncCompletedState(job, result) {
    if (!job || !result) return;

    const pages = Array.isArray(result.pages) ? result.pages : [];
    job.pages = pages.map(page => ({
        step: page.step || "",
        url: page.url || "",
        pageName: page.pageName || "",
        status: page.status || "PASS",
        adobeHitCount: page.adobeHitCount || 0,
        eventsFound: page.eventsFound || []
    }));

    job.currentPage = null;
    updateSummary(job, result);
}

function startValidatorMonitor(job, validator) {
    stopValidatorMonitor();

    monitorTimer = setInterval(() => {
        try {
            syncValidatorState(job, validator);
        } catch (error) {
            addJobLog(job, `Monitor error: ${error.message || error}`, "WARN");
        }
    }, 500);
}

function stopValidatorMonitor() {
    if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
    }
}

function normalizeResultForReport(result, reason, termination = "") {
    const safeResult = result || {
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
    };

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
        const alreadyLogged = safeResult.errors.some(
            error => String(error.error || "") === String(reason)
        );

        if (!alreadyLogged) {
            safeResult.errors.push({
                timestamp: new Date().toISOString(),
                step: safeResult.pages.length + 1,
                error: reason,
                currentUrl: activeValidator && activeValidator.currentPageUrl
                    ? activeValidator.currentPageUrl
                    : ""
            });
        }
    }

    safeResult.finishedAt = new Date().toISOString();
    return safeResult;
}

async function generateFailureReport(job, result, reason, termination = "PAGE_OR_EXECUTION_FAILURE") {
    if (!job) return null;

    const reportResult = normalizeResultForReport(result, reason, termination);
    const output = path.join(__dirname, "..", "reports", "output");
    fs.mkdirSync(output, { recursive: true });

    const reportPath = await preSalesReportGenerator.generatePreSalesHTML(
        reportResult,
        output,
        { uniqueFile: true }
    );

    job.reportPath = `/reports/${path.basename(reportPath)}`;
    job.finishedAt = reportResult.finishedAt;
    job.error = reason || null;
    job.status = "FAILED";
    syncCompletedState(job, reportResult);

    addJobLog(job, `Failure report generated: ${job.reportPath}`, "INFO");
    return job.reportPath;
}

async function runPreSalesJourney(job) {
    job.status = "RUNNING";
    job.startedAt = new Date().toISOString();
    addJobLog(job, "Pre-Sales journey started.");

    const paymentMode = job.inputs.paymentMode === "Pay Later" ? "payLater" : "payToday";

    const validator = new PreSalesJourneyValidator({
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

    let result;
    let journeyError = null;

    try {
        result = await validator.run();
        syncCompletedState(job, result);

        const output = path.join(__dirname, "..", "reports", "output");
        fs.mkdirSync(output, { recursive: true });

        const reportPath = await preSalesReportGenerator.generatePreSalesHTML(
            result,
            output,
            { uniqueFile: true }
        );

        job.reportPath = `/reports/${path.basename(reportPath)}`;
        job.status = result.summary && result.summary.status === "FAIL" ? "FAILED" : "COMPLETED";
        job.finishedAt = result.finishedAt || new Date().toISOString();
        job.error = job.status === "FAILED" && result.errors && result.errors.length
            ? result.errors[result.errors.length - 1].error
            : null;

        addJobLog(job, `Validation finished with status ${job.status}.`);
        addJobLog(job, `Report generated: ${job.reportPath}`);
    } catch (error) {
        journeyError = error;
        result = validator.result;

        const reason = error && error.message
            ? error.message
            : String(error);

        addJobLog(job, `Journey stopped: ${reason}`, "ERROR");

        try {
            await generateFailureReport(
                job,
                result,
                reason,
                "PAGE_OR_EXECUTION_FAILURE"
            );
        } catch (reportError) {
            job.status = "FAILED";
            job.finishedAt = new Date().toISOString();
            job.error = `${reason} | Report generation failed: ${reportError.message || reportError}`;
            addJobLog(job, `Report generation failed: ${reportError.message || reportError}`, "ERROR");
        }
    } finally {
        stopValidatorMonitor();
        activeValidator = null;

        if (journeyError) {
            job.status = "FAILED";
        }
    }
}

function serializeJob(job) {
    if (!job) return null;

    const startedAt = job.startedAt ? new Date(job.startedAt) : null;
    const finishedAt = job.finishedAt ? new Date(job.finishedAt) : null;
    let duration = null;

    if (startedAt) {
        const endTime = finishedAt || new Date();
        const totalSeconds = Math.max(
            0,
            Math.floor((endTime.getTime() - startedAt.getTime()) / 1000)
        );
        duration = `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
    }

    let currentStep = "Waiting to start";
    if (job.status === "QUEUED") currentStep = "Job queued";
    if (job.status === "RUNNING") currentStep = job.currentPage && job.currentPage.step
        ? job.currentPage.step
        : "Executing Selenium journey";
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
    };
}

function findLatestReport() {
    const output = path.join(__dirname, "..", "reports", "output");
    if (!fs.existsSync(output)) return null;

    const reports = fs.readdirSync(output)
        .filter(name => name.toLowerCase().endsWith(".html"))
        .map(name => {
            const fullPath = path.join(output, name);
            return {
                name,
                mtime: fs.statSync(fullPath).mtimeMs
            };
        })
        .sort((a, b) => b.mtime - a.mtime);

    return reports.length ? `/reports/${encodeURIComponent(reports[0].name)}` : null;
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/api/reports/latest", (req, res) => {
    res.json({
        success: true,
        reportPath: currentJob && currentJob.reportPath
            ? currentJob.reportPath
            : findLatestReport()
    });
});

app.post("/api/jobs", (req, res) => {
    const { mode, hubId, paymentMode, paymentPeriod, simType } = req.body;

    if (mode && mode !== "presales") {
        return res.status(400).json({
            success: false,
            error: "Only Pre-Sales Journey Validation is currently supported."
        });
    }

    if (!hubId || !paymentMode || !simType) {
        return res.status(400).json({
            success: false,
            error: "Hub ID, payment mode, and SIM type are required."
        });
    }

    if (
        currentJob &&
        ["QUEUED", "RUNNING"].includes(currentJob.status)
    ) {
        return res.status(409).json({
            success: false,
            error: "Another journey is currently running. Please wait."
        });
    }

    currentJob = createJob({
        hubId,
        paymentMode,
        paymentPeriod: paymentMode === "Pay Later" ? paymentPeriod || null : null,
        simType
    });

    addJobLog(currentJob, "Job created and queued.");

    runPreSalesJourney(currentJob).catch(async error => {
        const reason = error && error.message ? error.message : String(error);
        addJobLog(currentJob, `Unexpected journey error: ${reason}`, "ERROR");

        if (activeValidator && activeValidator.result) {
            try {
                await generateFailureReport(
                    currentJob,
                    activeValidator.result,
                    reason,
                    "UNEXPECTED_SERVER_EXECUTION_ERROR"
                );
            } catch (reportError) {
                currentJob.status = "FAILED";
                currentJob.finishedAt = new Date().toISOString();
                currentJob.error = `${reason} | Report generation failed: ${reportError.message || reportError}`;
            }
        } else {
            currentJob.status = "FAILED";
            currentJob.finishedAt = new Date().toISOString();
            currentJob.error = reason;
        }
    });

    return res.status(202).json({
        success: true,
        message: "Selenium journey queued successfully.",
        jobId: currentJob.id,
        status: currentJob.status,
        startedAt: currentJob.startedAt
    });
});

app.get("/api/jobs/:jobId", (req, res) => {
    if (!currentJob || currentJob.id !== req.params.jobId) {
        return res.status(404).json({
            success: false,
            error: "Job not found."
        });
    }

    syncValidatorState(currentJob, activeValidator);
    return res.json(serializeJob(currentJob));
});

app.post("/api/journeys", (req, res) => {
    const { hubId, paymentMode, paymentPeriod, simType } = req.body;

    if (!hubId || !paymentMode || !simType) {
        return res.status(400).json({
            success: false,
            message: "Hub ID, payment mode, and SIM type are required."
        });
    }

    if (currentJob && ["QUEUED", "RUNNING"].includes(currentJob.status)) {
        return res.status(409).json({
            success: false,
            message: "Another journey is currently running. Please wait."
        });
    }

    currentJob = createJob({
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
    });
});

app.get("/api/journeys/current", (req, res) => {
    return res.json({
        success: true,
        job: currentJob ? serializeJob(currentJob) : null
    });
});

const server = app.listen(PORT, () => {
    console.log(`Web server running at http://localhost:${PORT}`);
});

async function gracefulShutdown(signal) {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    console.log(`\n${signal} received. Preparing safe shutdown...`);

    try {
        stopValidatorMonitor();

        if (
            currentJob &&
            ["QUEUED", "RUNNING"].includes(currentJob.status) &&
            activeValidator
        ) {
            syncValidatorState(currentJob, activeValidator);

            const reason = `Execution interrupted because the server received ${signal}.`;
            addJobLog(currentJob, reason, "ERROR");

            try {
                const reportPath = await generateFailureReport(
                    currentJob,
                    activeValidator.result,
                    reason,
                    "SERVER_STOP"
                );
                console.log(`Partial validation report generated: ${reportPath}`);
            } catch (reportError) {
                console.error("Unable to generate interruption report:", reportError);
            }

            try {
                await activeValidator.close();
            } catch (closeError) {
                console.error("Unable to close Selenium driver:", closeError);
            }
        }
    } catch (error) {
        console.error("Graceful shutdown report handling failed:", error);
    } finally {
        try {
            await new Promise(resolve => server.close(resolve));
        } catch (_) {}

        process.exit(0);
    }
}

process.on("SIGINT", () => {
    void gracefulShutdown("SIGINT");
});

process.on("SIGTERM", () => {
    void gracefulShutdown("SIGTERM");
});

process.on("uncaughtException", async error => {
    console.error("Uncaught exception:", error);
    if (uncaughtHandling) return;
    uncaughtHandling = true;

    if (activeValidator && currentJob) {
        try {
            await generateFailureReport(
                currentJob,
                activeValidator.result,
                `Uncaught server exception: ${error.message || error}`,
                "UNCAUGHT_EXCEPTION"
            );
        } catch (reportError) {
            console.error("Uncaught exception report generation failed:", reportError);
        }
    }

    await gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", async reason => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    console.error("Unhandled rejection:", error);
    if (uncaughtHandling) return;
    uncaughtHandling = true;

    if (activeValidator && currentJob) {
        try {
            await generateFailureReport(
                currentJob,
                activeValidator.result,
                `Unhandled server rejection: ${error.message || error}`,
                "UNHANDLED_REJECTION"
            );
        } catch (reportError) {
            console.error("Unhandled rejection report generation failed:", reportError);
        }
    }

    await gracefulShutdown("UNHANDLED_REJECTION");
});
