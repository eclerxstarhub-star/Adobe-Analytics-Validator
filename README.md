# Adobe Validator - StarHub Pre-Sales Journey

## Run

1. Open a terminal in this project folder.
2. Run `npm install`.
3. Run `node app.js`.
4. Select `2` for the automated Pre-Sales Journey.

The project contains two separate flows:

- `1. Adobe Analytics Tagging & CTA Validation` - existing selected-URL scanner and CTA validation.
- `2. StarHub Pre-Sales Journey Validation` - login-based journey validation with Adobe `/b/ss` network capture and a dedicated HTML/JSON report.

## Pre-Sales device selection

The journey starts from the login page, reaches the Mobile Plans page, clicks `See more devices`, and identifies the iPhone 17 Pro Max product cards using the actual OutSystems `.product-item-card` structure. It does not depend on an `href` being present on the card.

The validator randomly selects an iPhone 17 Pro Max card. If the resulting PDP visibly reports an out-of-stock/unavailable state, it returns to the PLP and tries another selection, up to 8 attempts. The selected device and availability status are printed in the terminal and stored in the report.

The PDP then randomly selects available color/storage options, asks for the payment option, and continues through the configured Pre-Sales journey.

## Adobe capture

Adobe hits are collected from Selenium Chrome performance logs. Page loads use the longer Adobe wait window; action tracking polls for asynchronous `/b/ss` requests before continuing. Captured hit details include page name, events, products, eVars, props, order ID, revenue, request URL and POST data where available.

## Reports

Pre-Sales output is written to `reports/output/`:

- `preSalesJourneyReport.html` - human-readable journey report.
- `preSalesJourneyReport.json` - complete machine-readable captured result.

The report contains journey selections, page-level validation, CTA/option/popup actions, ecommerce events with values and URLs, ecommerce event summary, product-level validation, order-level validation, complete Adobe hit details, visited URLs and errors.
