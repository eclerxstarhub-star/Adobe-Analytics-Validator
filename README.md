# Adobe Analytics Validator - eClerx

The Adobe Analytics Validator is an automation-based validation tool developed by the eClerx team to support sitewide Adobe Analytics tracking validation and StarHub Pre-Sales journey validation.

The tool combines Selenium-based browser automation with Adobe Analytics network-call validation to help identify tracking issues, page-level implementation gaps, CTA tracking issues, and journey-level Analytics problems with reduced manual effort.

---

## Key Capabilities

### 1. Adobe Analytics Tagging & CTA Validation

Validates Adobe Analytics implementation across selected website pages.

The validation includes:

- Adobe Analytics `/b/ss` network-call detection
- Page-level Analytics validation
- `pageName` validation
- eVars validation
- Props validation
- Events validation
- Products validation
- CTA tracking validation
- Adobe hit details and captured parameters
- Page URLs and validation errors
- HTML-based validation reporting

This flow is intended for **sitewide or selected-URL Analytics validation** and can be used to identify tracking issues across different pages and user interactions.

---

### 2. StarHub Pre-Sales Journey Validation

Automates the StarHub Pre-Sales journey and validates Adobe Analytics implementation throughout the journey.

The journey includes activities such as:

- Login
- Navigation to Mobile Plans
- Device selection
- iPhone 17 Pro Max product identification
- Payment option selection
- SIM selection
- Product and checkout journey validation
- Adobe Analytics capture at different journey stages

The validator captures the Analytics data generated during page loads and user interactions and associates the captured data with the corresponding journey step.

---

## Pre-Sales Device Selection

During the Pre-Sales journey, the validator:

1. Navigates to the Mobile Plans page.
2. Opens **See more devices**.
3. Identifies iPhone 17 Pro Max product cards using the page's actual OutSystems product-card structure.
4. Randomly selects an available device.
5. Checks the resulting Product Detail Page for availability.
6. If the selected device is unavailable or out of stock, the validator returns to the product listing and attempts another selection.
7. The validator supports multiple selection attempts before stopping the device-selection process.

The selected device and its availability status are captured in the execution output and included in the generated report.

---

## Adobe Analytics Capture

Adobe Analytics hits are captured through Selenium Chrome performance logs.

The validator monitors Adobe `/b/ss` network requests generated during the journey.

Captured information can include:

- Page Name
- Adobe Analytics Events
- Products
- eVars
- Props
- Order ID
- Revenue
- Request URL
- POST data
- Journey/page URL
- Timestamp information

Page-load validation uses an extended wait period to allow asynchronous Adobe Analytics requests to complete, while action-level validation monitors the network for tracking calls generated after user interactions.

---

## Validation Reports

The tool generates detailed reports containing the captured validation information.

