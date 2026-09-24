const readline = require("readline");
const path = require("path");
const fs = require("fs");

const SiteCrawler = require("./scanner/siteCrawler");
const PreSalesJourneyValidator = require("./scanner/preSalesJourneyValidator");
const reportGenerator = require("./reports/reportGenerator");
const preSalesReportGenerator = require("./reports/preSalesReportGenerator");

loadDotEnv();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function loadDotEnv() {
    const envPath = path.join(__dirname, ".env");
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
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

function ask(question) {
    return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

function line() {
    console.log("==========================================================");
}

function menu() {
    line();
    console.log("        ADOBE WEBSITE ANALYTICS VALIDATOR");
    line();
    console.log("");
    console.log("1. Adobe Analytics & CTA Validation");
    console.log("2. Pre-Sales Journey Validation");
    console.log("0. Exit");
    console.log("");
}

async function askTestingUrl() {
    while (true) {
        const url = await ask("Enter testing URL: ");
        try {
            new URL(url);
            return url;
        } catch (_) {
            console.log("Invalid URL. Please enter a complete URL including https://");
        }
    }
}

async function askChoice(title, choices) {
    console.log(`\n${title}`);
    choices.forEach((choice, index) => console.log(`${index + 1}. ${choice.label}`));
    while (true) {
        const option = await ask("Select option: ");
        const index = Number(option) - 1;
        if (Number.isInteger(index) && choices[index]) return choices[index].value;
        console.log(`Invalid option. Please enter 1-${choices.length}.`);
    }
}

async function askPreSalesInputs() {
    const hubId = await ask("\nPlease enter testing account Hub ID: ");
    const paymentMode = await askChoice("Payment mode:", [
        { label: "Pay later", value: "payLater" },
        { label: "Pay Today", value: "payToday" }
    ]);
    let payLaterPeriod = null;
    if (paymentMode === "payLater") {
        payLaterPeriod = await askChoice("Pay Later period:", [
            { label: "36-month", value: "36" },
            { label: "24-month", value: "24" },
            { label: "12-month", value: "12" }
        ]);
    }
    const simType = await askChoice("SIM type:", [
        { label: "eSIM", value: "eSIM" },
        { label: "Physical SIM", value: "Physical SIM" }
    ]);
    return { hubId, paymentMode, payLaterPeriod, simType };
}

async function runAdobe() {
    const startUrl = await askTestingUrl();
    const crawler = new SiteCrawler({
        maxPages: 25,
        maxAdobeWait: 60000,
        postAdobeWait: 4000,
        ctaClickWait: 15000,
        ctaPollInterval: 250
    });
    try {
        const results = await crawler.scan(startUrl, 25);
        const output = path.join(__dirname, "reports", "output");
        fs.mkdirSync(output, { recursive: true });
        const reportPath = await reportGenerator.generateHTML(results || crawler.getResults(), output);
        console.log(`\nReport: ${reportPath}`);
    } finally {
        await crawler.close();
    }
}

async function runPreSales() {
    const inputs = await askPreSalesInputs();
    const validator = new PreSalesJourneyValidator({
        startUrl: process.env.PRESALES_START_URL,
        maxAdobeWait: 60000,
        networkQuietTime: 4000,
        pollInterval: 250,
        credentials: {
            hubId: inputs.hubId,
            hubPassword: process.env.HUB_PASSWORD
        },
        journeyConfig: require("./config/preSalesJourney.json"),
        paymentOptionPrompt: async () => inputs.paymentMode === "payLater" ? "1" : "2",
        payLaterPeriod: inputs.payLaterPeriod,
        simType: inputs.simType
    });

    let result;
    let journeyError = null;
    try {
        result = await validator.run();
    } catch (error) {
        journeyError = error;
        result = validator.result;
        console.error(`\nJourney stopped: ${error.message || error}`);
        console.error("A report will still be generated with all data captured before the failure.");
    }

    const output = path.join(__dirname, "reports", "output");
    fs.mkdirSync(output, { recursive: true });
    const reportPath = await preSalesReportGenerator.generatePreSalesHTML(result, output);

    console.log("");
    line();
    console.log("             PRE-SALES JOURNEY SUMMARY");
    line();
    console.log(`Status                 : ${result.summary.status}`);
    console.log(`Pages visited          : ${result.summary.pagesVisited}`);
    console.log(`Adobe /b/ss hits       : ${result.summary.adobeHits}`);
    console.log(`Ecommerce events       : ${result.summary.ecommerceEvents}`);
    console.log(`Product records        : ${result.summary.productsCaptured}`);
    console.log(`Order records          : ${result.summary.ordersCaptured}`);
    console.log(`Errors                 : ${result.errors.length}`);
    console.log(`Report                 : ${reportPath}`);
    line();
    console.log("");

    if (journeyError) {
        console.log("Journey validation ended with an error, but the report was generated successfully.");
    }
}

async function main() {
    try {
        while (true) {
            menu();
            const option = await ask("Select option: ");
            if (option === "1") await runAdobe();
            else if (option === "2") await runPreSales();
            else if (option === "0") break;
            else console.log("Invalid option. Please enter 1, 2 or 0.");
        }
    } catch (error) {
        console.log("");
        line();
        console.error(error.stack || error);
        line();
    } finally {
        rl.close();
    }
}

main();
