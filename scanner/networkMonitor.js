class NetworkMonitor {

    constructor() {
        this.requests = [];
        this.failedRequests = [];
        this.runtimeErrors = [];
    }

    reset() {

        this.requests = [];
        this.failedRequests = [];
        this.runtimeErrors = [];

    }

    async collect(driver) {

        let logs = [];

        try {

            logs =
                await driver.manage()
                    .logs()
                    .get("performance");

        }
        catch (error) {

            return;

        }

        for (const entry of logs) {

            try {

                const message =
                    JSON.parse(entry.message).message;

                if (
                    message.method ===
                    "Network.requestWillBeSent"
                ) {

                    const params =
                        message.params;

                    if (
                        params &&
                        params.request &&
                        params.request.url
                    ) {

                        this.requests.push({
                            url: params.request.url,
                            method:
                                params.request.method || "GET",
                            type:
                                params.type || "",
                            timestamp:
                                params.timestamp || Date.now()
                        });

                    }

                }

                if (
                    message.method ===
                    "Network.loadingFailed"
                ) {

                    const params =
                        message.params || {};

                    this.failedRequests.push({
                        requestId:
                            params.requestId || "",
                        errorText:
                            params.errorText || "Unknown network error",
                        type:
                            params.type || ""
                    });

                }

                if (
                    message.method ===
                    "Runtime.exceptionThrown"
                ) {

                    const details =
                        message.params &&
                        message.params.exceptionDetails;

                    if (details) {

                        this.runtimeErrors.push({
                            text:
                                details.text ||
                                "JavaScript exception",
                            url:
                                details.url || "",
                            lineNumber:
                                details.lineNumber || "",
                            columnNumber:
                                details.columnNumber || ""
                        });

                    }

                }

            }
            catch (error) {

                // Ignore malformed performance entries

            }

        }

    }

    async collectBrowserLogs(driver) {

        let logs = [];

        try {

            logs =
                await driver.manage()
                    .logs()
                    .get("browser");

        }
        catch (error) {

            return;

        }

        for (const log of logs) {

            if (
                log.level === "SEVERE"
            ) {

                this.runtimeErrors.push({
                    text: log.message || "Browser console error",
                    url: "",
                    lineNumber: "",
                    columnNumber: ""
                });

            }

        }

    }

    getRequests() {
        return this.requests;
    }

    getFailedRequests() {
        return this.failedRequests;
    }

    getRuntimeErrors() {
        return this.runtimeErrors;
    }

}

module.exports =
    new NetworkMonitor();