function decode(value) {

    try {

        return decodeURIComponent(value);

    }
    catch (error) {

        return value;

    }
}

function parseAdobeHit(url) {

    if (
        !url ||
        !url.includes("/b/ss/")
    ) {
        return null;
    }

    let parsed;

    try {

        parsed =
            new URL(url);

    }
    catch (error) {

        return null;

    }

    const params =
        parsed.searchParams;

    const reportSuitePath =
        parsed.pathname.split("/b/ss/")[1] || "";

    const reportSuite =
        reportSuitePath.split("/")[0] || "";

    const eVars = {};
    const props = {};
    const events = [];

    for (const [key, value] of params.entries()) {

        if (
            /^v\d+$/i.test(key)
        ) {

            eVars[key] =
                decode(value);

        }

        if (
            /^c\d+$/i.test(key)
        ) {

            props[key] =
                decode(value);

        }

        if (
            /^event\d+$/i.test(key)
        ) {

            events.push(
                key
            );

        }

        if (
            key.toLowerCase() === "events"
        ) {

            const eventValues =
                decode(value)
                    .split(",");

            for (const event of eventValues) {

                if (event.trim()) {

                    events.push(
                        event.trim()
                    );

                }

            }

        }

    }

    return {

        url,

        reportSuite,

        pageName:
            decode(
                params.get("pageName") || ""
            ),

        channel:
            decode(
                params.get("ch") || ""
            ),

        server:
            decode(
                params.get("server") || ""
            ),

        pageUrl:
            decode(
                params.get("g") || ""
            ),

        currency:
            decode(
                params.get("cc") || ""
            ),

        eVars,

        props,

        events: [
            ...new Set(events)
        ],

        timestamp:
            new Date().toISOString()

    };

}

module.exports = {
    parseAdobeHit
};