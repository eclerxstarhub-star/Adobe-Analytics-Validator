const signatures =
    require("../config/pixelSignatures");

class PixelScanner {

    scan(requests) {

        const vendors = {};

        for (const request of requests) {

            if (
                !request ||
                !request.url
            ) {
                continue;
            }

            const url =
                request.url.toLowerCase();

            // Adobe is NOT a third-party marketing pixel
            // in this report.
            if (
                url.includes("/b/ss/")
            ) {
                continue;
            }

            for (const signature of signatures) {

                const matched =
                    signature.patterns.some(
                        pattern =>
                            url.includes(
                                pattern.toLowerCase()
                            )
                    );

                if (matched) {

                    if (
                        !vendors[signature.name]
                    ) {

                        vendors[signature.name] = {
                            name:
                                signature.name,
                            requests: 0,
                            urls: []
                        };

                    }

                    vendors[
                        signature.name
                    ].requests++;

                    if (
                        vendors[
                            signature.name
                        ].urls.length < 10
                    ) {

                        vendors[
                            signature.name
                        ].urls.push(
                            request.url
                        );

                    }

                    break;
                }

            }

        }

        return Object.values(vendors)
            .sort(
                (a, b) =>
                    b.requests - a.requests
            );

    }

}

module.exports =
    new PixelScanner();