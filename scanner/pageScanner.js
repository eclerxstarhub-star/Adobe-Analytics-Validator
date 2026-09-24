const networkMonitor =
    require("./networkMonitor");

const adobeScanner =
    require("./adobeScanner");

const pixelScanner =
    require("./pixelScanner");

const errorScanner =
    require("./errorScanner");

class PageScanner {

    constructor() {

        this.waitTime =
            8000;

    }

    async scan(driver, url) {

        networkMonitor.reset();

        const result = {

            url,
            finalUrl: url,
            title: "",
            loaded: false,

            links: [],

            adobe: {
                detected: false,
                hits: []
            },

            pixels: [],

            errors: {
                javascriptErrors: 0,
                consoleErrors: 0,
                networkFailures: 0,
                total: 0,
                details: {}
            }

        };

        try {

            await driver.get(url);

            result.loaded = true;

            try {

                result.finalUrl =
                    await driver.getCurrentUrl();

            }
            catch (error) {
                // Keep original URL
            }

            console.log(
                `Loaded: ${result.finalUrl}`
            );

            console.log(
                `Waiting ${this.waitTime / 1000} seconds for network calls...`
            );

            await this.wait(
                this.waitTime
            );

            try {

                result.title =
                    await driver.getTitle();

            }
            catch (error) {

                result.title =
                    "(no title)";

            }

            console.log(
                `Title : ${result.title || "(no title)"}`
            );

            /*
             * Collect performance logs after
             * the complete waiting period.
             */

            await networkMonitor.collect(
                driver
            );

            await networkMonitor.collectBrowserLogs(
                driver
            );

            const requests =
                networkMonitor.getRequests();

            /*
             * Adobe
             */

            const adobeHits =
                adobeScanner.scan(
                    requests
                );

            result.adobe.hits =
                adobeHits;

            result.adobe.detected =
                adobeHits.length > 0;

            /*
             * Marketing pixels
             */

            result.pixels =
                pixelScanner.scan(
                    requests
                );

            /*
             * Errors
             */

            result.errors =
                errorScanner.scan(
                    networkMonitor
                );

            /*
             * Internal links
             */

            result.links =
                await this.getInternalLinks(
                    driver,
                    result.finalUrl
                );

            if (result.adobe.detected) {

                console.log("");
                console.log(
                    "ADOBE ANALYTICS : DETECTED"
                );

                console.log(
                    `Adobe /b/ss/ hits : ${adobeHits.length}`
                );

                if (adobeHits[0]) {

                    console.log(
                        `Report Suite     : ${adobeHits[0].reportSuite || "N/A"}`
                    );

                    console.log(
                        `Page Name        : ${adobeHits[0].pageName || "N/A"}`
                    );

                }

            }
            else {

                console.log("");
                console.log(
                    "ADOBE ANALYTICS : NOT DETECTED"
                );

                console.log(
                    "No /b/ss/ request found."
                );

            }

            console.log(
                `Internal links found: ${result.links.length}`
            );

            console.log(
                `Marketing vendors found: ${result.pixels.length}`
            );

            console.log(
                `Errors: ${result.errors.total}`
            );

        }
        catch (error) {

            result.loaded = false;

            result.errors.total++;

            result.errors.details =
                result.errors.details || {};

            result.errors.details.page =
                error.message;

            console.log(
                `Page scan failed: ${error.message}`
            );

        }

        return result;

    }

    async getInternalLinks(
        driver,
        currentUrl
    ) {

        const links =
            new Set();

        let base;

        try {

            base =
                new URL(currentUrl);

        }
        catch (error) {

            return [];

        }

        let elements = [];

        try {

            elements =
                await driver.findElements({
                    css: "a[href]"
                });

        }
        catch (error) {

            return [];

        }

        for (const element of elements) {

            try {

                const href =
                    await element.getAttribute(
                        "href"
                    );

                if (!href) {
                    continue;
                }

                if (
                    href.startsWith(
                        "javascript:"
                    ) ||
                    href.startsWith("#") ||
                    href.startsWith("mailto:") ||
                    href.startsWith("tel:")
                ) {
                    continue;
                }

                let absolute;

                try {

                    absolute =
                        new URL(
                            href,
                            currentUrl
                        );

                }
                catch (error) {

                    continue;

                }

                if (
                    absolute.protocol !==
                    "http:" &&
                    absolute.protocol !==
                    "https:"
                ) {
                    continue;
                }

                /*
                 * Only same hostname.
                 */

                if (
                    absolute.hostname !==
                    base.hostname
                ) {
                    continue;
                }

                /*
                 * Remove tracking parameters.
                 */

                absolute.search = "";

                absolute.hash = "";

                let clean =
                    absolute.toString();

                if (
                    clean.endsWith("/")
                ) {

                    clean =
                        clean.slice(
                            0,
                            -1
                        );

                }

                links.add(clean);

            }
            catch (error) {

                // Ignore broken anchor
            }

        }

        return [...links];

    }

    async wait(ms) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );

    }

}

module.exports =
    new PageScanner();