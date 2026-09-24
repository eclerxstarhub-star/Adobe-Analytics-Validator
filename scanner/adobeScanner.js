const payloadParser =
    require("./payloadParser");

class AdobeScanner {

    scan(requests) {

        const adobeHits = [];

        for (const request of requests) {

            if (
                !request ||
                !request.url
            ) {
                continue;
            }

            if (
                request.url.includes("/b/ss/")
            ) {

                const hit =
                    payloadParser.parseAdobeHit(
                        request.url
                    );

                if (hit) {

                    adobeHits.push(hit);

                }

            }

        }

        return adobeHits;
    }

    getSummary(hits) {

        const reportSuites =
            new Set();

        const eVars =
            new Set();

        const props =
            new Set();

        const events =
            new Set();

        for (const hit of hits) {

            if (hit.reportSuite) {

                reportSuites.add(
                    hit.reportSuite
                );

            }

            Object.keys(
                hit.eVars || {}
            ).forEach(
                item => eVars.add(item)
            );

            Object.keys(
                hit.props || {}
            ).forEach(
                item => props.add(item)
            );

            (hit.events || []).forEach(
                item => events.add(item)
            );

        }

        return {

            reportSuites:
                [...reportSuites].sort(),

            eVars:
                [...eVars].sort(
                    (a, b) =>
                        parseInt(a.substring(1)) -
                        parseInt(b.substring(1))
                ),

            props:
                [...props].sort(
                    (a, b) =>
                        parseInt(a.substring(1)) -
                        parseInt(b.substring(1))
                ),

            events:
                [...events].sort(),

            hitCount:
                hits.length

        };

    }

}

module.exports =
    new AdobeScanner();