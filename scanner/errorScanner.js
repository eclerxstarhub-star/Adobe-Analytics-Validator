class ErrorScanner {

    scan(networkMonitor) {

        const javascriptErrors =
            networkMonitor.getRuntimeErrors();

        const networkFailures =
            networkMonitor.getFailedRequests();

        return {

            javascriptErrors:
                javascriptErrors.length,

            consoleErrors:
                javascriptErrors.length,

            networkFailures:
                networkFailures.length,

            total:
                javascriptErrors.length +
                networkFailures.length,

            details: {

                javascript:
                    javascriptErrors,

                network:
                    networkFailures

            }

        };

    }

}

module.exports =
    new ErrorScanner();