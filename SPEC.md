# SPEC.md — COLA Preflight

## Project Title

**COLA Preflight: AI-Powered Alcohol Label Verification**

## One-Sentence Summary

Build a beautiful, label-first, no-login single-page app that lets alcohol producers preflight-check their labels before COLA submission, while also demonstrating how TTB reviewers could use the same AI overlay engine to verify submitted applications faster.

---

# 1. Context

TTB reviews alcohol beverage labels before many products can be bottled or introduced into U.S. commerce. The approved label application is called a **Certificate of Label Approval**, or **COLA**. TTB’s public site says it processes nearly **180,000 COLA applications annually**. COLAs Online launched in **May 2003**. ([TTB][1])

The take-home brief describes a label review team handling high volume with a mix of experienced and less technical users. The key operational insight is that much of the work is visual matching:

```text
Does the label text match the application data?
Is the government warning present and exact?
Is the alcohol content shown correctly?
Are required fields visible?
```

The prototype should show how AI can reduce invalid submissions upstream and accelerate human review downstream.

---

# 2. Core Product Thesis

Most label errors should be caught **before** they enter the TTB review queue.

Therefore, the primary product is:

```text
COLA Preflight
A no-login public checker for producers/importers.
```

But the same engine should also demonstrate:

```text
Reviewer Mode
A TTB-facing view where agents compare application values against AI-extracted label values.
```

This is **one product with two modes**, not two separate apps.

```text
Applicant Mode = filter bad submissions before they reach TTB.
Reviewer Mode = accelerate agent review after submission.
```

---

# 3. Deliverable Requirements

Build a working prototype with:

1. Source code repository.
2. README with setup and run instructions.
3. Brief documentation of approach, tools, and assumptions.
4. Deployed application URL if possible.
5. Clean code.
6. Strong UX.
7. Thoughtful error handling.
8. Attention to stakeholder requirements.
9. Creative but scoped implementation.

The app should be optimized for a time-constrained take-home: a polished core experience is better than an ambitious incomplete system.

---

# 4. Technical Constraints

## Required

Use:

```text
HTML
CSS
JavaScript
```

No frontend framework.

Do **not** use:

```text
React
Vue
Svelte
Angular
jQuery
Tailwind
Bootstrap
```

A tiny serverless API endpoint is allowed and recommended for AI calls.

The browser UI should be framework-free.

---

# 5. Recommended File Structure

```text
/
  index.html
  styles.css
  app.js
  ai.js
  overlay.js
  scroll.js
  sampleData.js
  README.md
  SPEC.md

/api
  analyze-label.js
```

If the deployment platform does not support `/api/analyze-label.js`, adapt the API endpoint format to the platform, but keep the same request/response contract.

---

# 6. Product Modes

## 6.1 Applicant Mode

Default mode.

Audience:

```text
Producer / importer / bottler checking a label before submission.
```

Goal:

```text
Fix obvious issues before submitting a COLA application.
```

Tone:

```text
Helpful
Plain-language
Non-bureaucratic
No-login
Fast
```

Applicant Mode should show:

- Uploaded label image.
- AI overlay callouts.
- Green / amber / red statuses.
- Inline correction suggestions.
- No sidebar.
- No bottom drawer.
- No dashboard.
- No account system.
- No batch UI in v1.

## 6.2 Reviewer Mode

Secondary demo mode.

Audience:

```text
TTB compliance agent.
```

Goal:

```text
Compare application field values against label text faster.
```

Reviewer Mode should reuse the exact same label-stage UI but change the callout language.

It may show additional reviewer controls inside callout popovers:

```text
Accept AI
Override
Return for Correction
Copy reason
```

Reviewer Mode should include mock application data.

Do not build a full reviewer dashboard.

Do not build login, queue management, assignments, or audit backend.

---

# 7. UX Direction

The interface should feel like:

```text
Google Lens for COLA labels.
```

Not:

```text
A government form
A compliance dashboard
A portal
A table-heavy admin tool
```

The label image is the product.

Everything else is annotation.

---

# 8. Visual Layout

## 8.1 Overall Layout

Minimal topbar plus one central label stage.

```text
---------------------------------------------------------
| COLA Preflight                         No login needed |
|                      Applicant | Reviewer              |
|                                                       |
|                [ LARGE LABEL IMAGE ]                  |
|                                                       |
|   green callouts   overlays/pins   amber/red callouts |
|                                                       |
---------------------------------------------------------
```

## 8.2 Do Not Add

Do not add:

- Right sidebar.
- Bottom drawer.
- Full dashboard.
- Multi-page routing.
- Login.
- Navigation menu.
- Settings page.
- Batch upload UI.
- Analytics page.
- Data table as main UI.

## 8.3 Topbar

Topbar should be small and quiet.

Include:

```text
COLA Preflight
Check your label before submission
No login required
Applicant | Reviewer toggle
```

Mode toggle should be visually minimal.

---

# 9. Required User Flow

## 9.1 Applicant Flow

```text
1. User opens page.
2. User uploads or drops label image.
3. Label appears immediately.
4. App analyzes image.
5. Overlay callouts appear.
6. User sees pass / warning / error states directly on label.
7. User clicks red or amber callout.
8. Small correction bubble appears.
9. User can apply suggested correction or mark AI incorrect.
10. Local state updates.
11. Scroll model updates internally.
```

## 9.2 Reviewer Flow

```text
1. User toggles Reviewer Mode.
2. Same label remains visible.
3. Mock application data is compared to AI-extracted label data.
4. Overlays show matches and mismatches.
5. Reviewer can accept AI finding, override, or generate return reason.
```

---

# 10. Required Fields

The app must handle these label fields:

```js
const FIELD_IDS = [
  "brandName",
  "classType",
  "alcoholContent",
  "netContents",
  "bottlerProducer",
  "productOrigin",
  "governmentWarning",
]
```

Display labels:

```text
Brand Name
Class / Type
Alcohol Content
Net Contents
Bottler / Producer
Product Origin
Government Warning
```

---

# 11. Required Compliance Checks

## 11.1 Government Warning

The government warning is mandatory on alcohol beverages containing at least 0.5% alcohol by volume. TTB guidance states that the words **“GOVERNMENT WARNING”** must appear in capital letters and bold type, and that the statement must appear separate from other information as a continuous paragraph. ([TTB][2])

For this prototype, flag invalid if:

```text
Government Warning
```

is detected instead of:

```text
GOVERNMENT WARNING:
```

Required behavior:

```text
Detected: Government Warning
Status: invalid
Message: Heading must be “GOVERNMENT WARNING:” in ALL CAPS and bold.
Suggestion: GOVERNMENT WARNING:
```

## 11.2 Alcohol Content

Accept common forms:

```text
45% Alc./Vol.
45% ALC./VOL.
45% alcohol by volume
45% Alc./Vol. (90 Proof)
90 Proof
```

For distilled spirits, TTB states alcohol content must be stated as percentage alcohol by volume, and only “alc.” and “vol.” may be used as abbreviations for alcohol and volume. ([TTB][3])

## 11.3 Net Contents

Accept common forms:

```text
750 mL
750ml
1 L
12 FL OZ
```

## 11.4 Product Origin

For imports, country of origin can be required. In prototype mode, mark product origin as `warning` if uncertain.

## 11.5 Matching Logic

In Reviewer Mode, compare:

```text
Application value
vs
AI-extracted label value
```

Use forgiving matching for harmless differences:

```text
STONE'S THROW
Stone's Throw
```

should likely be treated as a soft match / acceptable normalization, not an automatic hard failure.

---

# 12. AI Strategy

## 12.1 Recommended Architecture

Use:

```text
Static SPA
+ tiny serverless proxy
+ vision model API
+ strict JSON response
```

Do not expose API keys in client-side JS.

```text
Browser
  POST /api/analyze-label
Serverless Function
  Calls vision model
  Returns strict JSON
Browser
  Renders overlays
```

OpenAI’s Responses API is recommended for new projects and supports native multimodal input. Image inputs can be passed as URLs, base64 data URLs, or file IDs. Structured Outputs can enforce a JSON schema for the response. ([OpenAI Platform][4])

## 12.2 Mock Mode Required

Implement mock AI first.

```js
const USE_MOCK_AI = true
```

When true:

- Do not call API.
- Use `sampleData.js`.
- Render a realistic result with:

  - 5 valid green fields
  - 1 amber warning
  - 1 red invalid government warning

This ensures the demo works offline and can be evaluated without credentials.

## 12.3 Optional Client-Side AI

Do not rely on browser-only AI for the main prototype.

Browser-side OCR is possible with Tesseract.js. It supports 100+ languages, orientation/script detection, and word/character bounding boxes in browser or Node. Transformers.js can run models directly in the browser and supports computer vision tasks through ONNX Runtime, including WebGPU when available. ([Tesseract.js][5])

But for this prototype, API-based vision is preferred for speed, accuracy, and implementation simplicity.

---

# 13. AI API Contract

## 13.1 Endpoint

```text
POST /api/analyze-label
```

## 13.2 Request

```json
{
  "imageBase64": "data:image/jpeg;base64,...",
  "mode": "applicant",
  "applicationData": null
}
```

Reviewer Mode request:

```json
{
  "imageBase64": "data:image/jpeg;base64,...",
  "mode": "reviewer",
  "applicationData": {
    "brandName": "OLD TOM DISTILLERY",
    "classType": "Kentucky Straight Bourbon Whiskey",
    "alcoholContent": "45% Alc./Vol. (90 Proof)",
    "netContents": "750 mL",
    "bottlerProducer": "Old Tom Distillery, LLC",
    "productOrigin": "Kentucky, USA",
    "governmentWarning": "GOVERNMENT WARNING:"
  }
}
```

## 13.3 Response

Return strict JSON:

```json
{
  "fields": [
    {
      "id": "brandName",
      "label": "Brand Name",
      "required": true,
      "aiValue": "OLD TOM DISTILLERY",
      "applicationValue": null,
      "userValue": null,
      "status": "valid",
      "confidence": 0.99,
      "box": {
        "x": 0.18,
        "y": 0.12,
        "w": 0.46,
        "h": 0.12
      },
      "message": "",
      "suggestion": "",
      "checks": []
    },
    {
      "id": "governmentWarning",
      "label": "Government Warning",
      "required": true,
      "aiValue": "Government Warning",
      "applicationValue": "GOVERNMENT WARNING:",
      "userValue": null,
      "status": "invalid",
      "confidence": 0.42,
      "box": {
        "x": 0.58,
        "y": 0.7,
        "w": 0.33,
        "h": 0.18
      },
      "message": "Heading must be “GOVERNMENT WARNING:” in ALL CAPS and bold.",
      "suggestion": "GOVERNMENT WARNING:",
      "checks": [
        {
          "id": "warning_heading_caps",
          "status": "invalid",
          "message": "Heading must be all caps and bold."
        }
      ]
    }
  ],
  "summary": {
    "total": 7,
    "valid": 5,
    "warning": 1,
    "invalid": 1,
    "corrected": 0
  }
}
```

## 13.4 Coordinate Rules

All boxes must be normalized relative to the image:

```text
x, y, w, h are 0 to 1.
```

Example:

```json
{
  "x": 0.58,
  "y": 0.7,
  "w": 0.33,
  "h": 0.18
}
```

---

# 14. AI Prompt

Use this prompt in the API endpoint:

```text
You are analyzing an alcohol beverage label for a COLA preflight review tool.

Extract required label fields and return strict JSON only.

Find these fields when present:
- brandName
- classType
- alcoholContent
- netContents
- bottlerProducer
- productOrigin
- governmentWarning

For each field:
- Return the exact visible text.
- Return a normalized bounding box relative to the image: x, y, w, h from 0 to 1.
- Return status: valid, warning, invalid, or unknown.
- Return confidence from 0 to 1.
- Return a short human-readable message.
- Return a suggested correction only when useful.

If mode is reviewer, compare the extracted label value against the supplied application value.
Use forgiving normalization for capitalization, punctuation, and obvious equivalent text, but do not ignore substantive differences.

Important rule:
The government warning heading must be exactly:
GOVERNMENT WARNING:

If the label says “Government Warning” or any other casing, mark governmentWarning invalid and suggest:
GOVERNMENT WARNING:

Do not invent text that is not visible.
If unsure, use status warning or unknown.
Return JSON only.
```

---

# 15. App State Model

Use one central state object.

```js
const state = {
  mode: "applicant", // applicant | reviewer

  image: {
    fileName: "",
    objectUrl: "",
    base64: "",
    naturalWidth: 0,
    naturalHeight: 0,
  },

  applicationData: {
    brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContent: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    bottlerProducer: "Old Tom Distillery, LLC",
    productOrigin: "Kentucky, USA",
    governmentWarning: "GOVERNMENT WARNING:",
  },

  fields: [],

  selectedFieldId: null,

  status: "idle", // idle | loading | analyzing | ready | error

  error: null,
}
```

Field model:

```js
{
  id: "governmentWarning",
  label: "Government Warning",
  required: true,

  aiValue: "Government Warning",
  applicationValue: "GOVERNMENT WARNING:",
  userValue: null,

  status: "invalid",
  // valid | warning | invalid | corrected | unknown

  originalStatus: null,

  confidence: 0.42,

  box: {
    x: 0.58,
    y: 0.70,
    w: 0.33,
    h: 0.18
  },

  message: "Heading must be “GOVERNMENT WARNING:” in ALL CAPS and bold.",
  suggestion: "GOVERNMENT WARNING:",

  checks: [
    {
      id: "warning_heading_caps",
      status: "invalid",
      message: "Heading must be all caps and bold."
    }
  ]
}
```

---

# 16. Scroll Data Model

Under the hood, serialize extracted state to simple Scroll text.

Do not show a bottom drawer in the UI.

But implement:

```js
toScroll(state)
```

Log Scroll to console after analysis and after correction.

Example:

```scroll
colaPreflight
 mode applicant
 imageName old-tom-label.jpg
 field brandName
  value OLD TOM DISTILLERY
  status valid
  confidence .99
  box .18 .12 .46 .12
 field classType
  value Kentucky Straight Bourbon Whiskey
  status valid
  confidence .98
  box .27 .36 .42 .12
 field alcoholContent
  value 45% Alc./Vol. (90 Proof)
  status valid
  confidence .96
  box .14 .58 .16 .08
 field netContents
  value 750 mL
  status valid
  confidence .98
  box .15 .67 .10 .05
 field bottlerProducer
  value Old Tom Distillery, LLC
  status valid
  confidence .97
  box .14 .74 .22 .11
 field productOrigin
  value Kentucky, USA
  status warning
  confidence .90
  issue Verify origin statement
  box .70 .30 .12 .08
 field governmentWarning
  value Government Warning
  status invalid
  confidence .42
  issue Must be "GOVERNMENT WARNING:" in ALL CAPS and bold
  suggestion GOVERNMENT WARNING:
  box .58 .70 .33 .18
```

Reviewer Mode Scroll example:

```scroll
colaPreflight
 mode reviewer
 application
  brandName OLD TOM DISTILLERY
  governmentWarning GOVERNMENT WARNING:
 field governmentWarning
  applicationValue GOVERNMENT WARNING:
  labelValue Government Warning
  status invalid
  action returnForCorrection
  reason Heading must be "GOVERNMENT WARNING:" in ALL CAPS and bold
```

---

# 17. UI Components

## 17.1 Topbar

```html
<header class="topbar">
  <div class="brand">
    <div class="mark">★</div>
    <div>
      <strong>COLA Preflight</strong>
      <span>Check your label before submission</span>
    </div>
  </div>

  <div class="mode-toggle">
    <button data-mode="applicant">Applicant</button>
    <button data-mode="reviewer">Reviewer</button>
  </div>

  <div class="privacy-note">No login required</div>
</header>
```

## 17.2 Stage

```html
<main class="app">
  <section id="stage" class="stage">
    <div id="dropzone" class="dropzone">
      <input id="fileInput" type="file" accept="image/*" hidden />
      <button id="uploadButton">Upload label</button>
      <p>Drop a label image here</p>
    </div>

    <div id="labelWrap" class="label-wrap hidden">
      <img id="labelImage" alt="Uploaded alcohol label" />
      <svg id="overlaySvg" aria-hidden="true"></svg>
      <div id="calloutLayer"></div>
      <div id="popoverLayer"></div>
    </div>
  </section>
</main>
```

---

# 18. Overlay Rendering

## 18.1 Required Overlay Elements

For each field:

1. Bounding box on the label.
2. Connector line from box to callout.
3. Callout card.
4. Confidence badge.
5. Status icon.
6. Optional correction popover.

## 18.2 Status Colors

```css
:root {
  --bg: #f7f5ef;
  --ink: #132033;
  --muted: #667085;

  --green: #1f9d55;
  --green-bg: #ecfdf3;

  --amber: #d99000;
  --amber-bg: #fff7e6;

  --red: #d92d20;
  --red-bg: #fff1f0;

  --blue: #3157ff;
  --blue-bg: #eef2ff;

  --card: rgba(255, 255, 255, 0.86);
  --shadow: 0 18px 50px rgba(16, 24, 40, 0.14);
}
```

## 18.3 Invalid Pulse

Invalid government-warning region must pulse.

```css
@keyframes pulseError {
  0% {
    transform: scale(0.9);
    opacity: 0.45;
  }
  70% {
    transform: scale(1.6);
    opacity: 0;
  }
  100% {
    transform: scale(1.6);
    opacity: 0;
  }
}
```

Add concentric red rings or glow behind the invalid region.

## 18.4 Responsive Coordinates

Use normalized coordinates.

Convert to pixels based on displayed image rect:

```js
function boxToPixels(box, imageRect) {
  return {
    x: box.x * imageRect.width,
    y: box.y * imageRect.height,
    w: box.w * imageRect.width,
    h: box.h * imageRect.height,
  }
}
```

Use `ResizeObserver` on the label wrapper.

Re-render overlays on:

```text
image load
window resize
mode change
state change
correction applied
```

---

# 19. Callout Placement

Hardcoded callout placement is acceptable for prototype.

Preferred:

```js
const CALLOUT_POSITIONS = {
  brandName: "left",
  classType: "left",
  alcoholContent: "left",
  netContents: "left",
  bottlerProducer: "left",
  productOrigin: "right",
  governmentWarning: "right",
}
```

Callout cards should avoid covering important label text when possible.

For a strong visual demo, left-side valid fields and right-side warning/error fields are acceptable.

---

# 20. Correction Popover

When user clicks amber or red callout, show a small floating correction popover.

## Applicant Mode Popover

```text
Suggest correction

AI found:
Government Warning

Correction:
GOVERNMENT WARNING:

[This is incorrect] [Apply fix]
```

Behavior:

- `Apply fix`

  - sets `userValue`
  - sets `originalStatus`
  - changes status to `corrected`
  - updates card color to blue/green-blue
  - updates Scroll serialization

- `This is incorrect`

  - marks field as `userFlagged`
  - keeps status visible
  - updates message to show user disputed AI finding

## Reviewer Mode Popover

```text
Government Warning mismatch

Application:
GOVERNMENT WARNING:

Label:
Government Warning

Recommended action:
Return for correction

[Accept AI] [Override] [Return for Correction]
```

Behavior:

- `Accept AI`

  - reviewer accepts field finding

- `Override`

  - reviewer can mark the AI finding wrong

- `Return for Correction`

  - stores action:

    ```js
    field.reviewerAction = "returnForCorrection"
    ```

  - shows generated reason

---

# 21. Mock Data

`sampleData.js` must include a realistic demo.

Use this mock result:

```js
export const mockAnalysis = {
  fields: [
    {
      id: "brandName",
      label: "Brand Name",
      required: true,
      aiValue: "OLD TOM DISTILLERY",
      applicationValue: "OLD TOM DISTILLERY",
      userValue: null,
      status: "valid",
      confidence: 0.99,
      box: { x: 0.18, y: 0.16, w: 0.48, h: 0.18 },
      message: "",
      suggestion: "",
      checks: [],
    },
    {
      id: "classType",
      label: "Class / Type",
      required: true,
      aiValue: "Kentucky Straight Bourbon Whiskey",
      applicationValue: "Kentucky Straight Bourbon Whiskey",
      userValue: null,
      status: "valid",
      confidence: 0.98,
      box: { x: 0.28, y: 0.38, w: 0.4, h: 0.12 },
      message: "",
      suggestion: "",
      checks: [],
    },
    {
      id: "alcoholContent",
      label: "Alcohol Content",
      required: true,
      aiValue: "45% Alc./Vol. (90 Proof)",
      applicationValue: "45% Alc./Vol. (90 Proof)",
      userValue: null,
      status: "valid",
      confidence: 0.96,
      box: { x: 0.12, y: 0.57, w: 0.18, h: 0.09 },
      message: "",
      suggestion: "",
      checks: [],
    },
    {
      id: "netContents",
      label: "Net Contents",
      required: true,
      aiValue: "750 mL",
      applicationValue: "750 mL",
      userValue: null,
      status: "valid",
      confidence: 0.98,
      box: { x: 0.14, y: 0.67, w: 0.12, h: 0.06 },
      message: "",
      suggestion: "",
      checks: [],
    },
    {
      id: "bottlerProducer",
      label: "Bottler / Producer",
      required: true,
      aiValue: "Old Tom Distillery, LLC",
      applicationValue: "Old Tom Distillery, LLC",
      userValue: null,
      status: "valid",
      confidence: 0.97,
      box: { x: 0.12, y: 0.74, w: 0.28, h: 0.12 },
      message: "",
      suggestion: "",
      checks: [],
    },
    {
      id: "productOrigin",
      label: "Product Origin",
      required: false,
      aiValue: "Kentucky, USA",
      applicationValue: "Kentucky, USA",
      userValue: null,
      status: "warning",
      confidence: 0.9,
      box: { x: 0.72, y: 0.3, w: 0.12, h: 0.08 },
      message: "Verify origin statement.",
      suggestion: "",
      checks: [
        {
          id: "origin_uncertain",
          status: "warning",
          message: "AI is not fully confident this is an origin statement.",
        },
      ],
    },
    {
      id: "governmentWarning",
      label: "Government Warning",
      required: true,
      aiValue: "Government Warning",
      applicationValue: "GOVERNMENT WARNING:",
      userValue: null,
      status: "invalid",
      confidence: 0.42,
      box: { x: 0.56, y: 0.68, w: 0.34, h: 0.2 },
      message: "Heading must be “GOVERNMENT WARNING:” in ALL CAPS and bold.",
      suggestion: "GOVERNMENT WARNING:",
      checks: [
        {
          id: "warning_heading_caps",
          status: "invalid",
          message: "Heading must be all caps and bold.",
        },
      ],
    },
  ],
  summary: {
    total: 7,
    valid: 5,
    warning: 1,
    invalid: 1,
    corrected: 0,
  },
}
```

---

# 22. Deterministic Local Validation

After AI response, run local validation.

Implement:

```js
function validateFields(fields, mode, applicationData) {
  return fields.map((field) => validateField(field, mode, applicationData))
}
```

Required local rule:

```js
function validateGovernmentWarning(field) {
  const value = normalizeWhitespace(field.aiValue || "")

  if (!value.includes("GOVERNMENT WARNING:")) {
    return {
      ...field,
      status: "invalid",
      message: "Heading must be “GOVERNMENT WARNING:” in ALL CAPS and bold.",
      suggestion: "GOVERNMENT WARNING:",
    }
  }

  return field
}
```

Do not trust AI output blindly.

---

# 23. README Requirements

README must include:

```text
# COLA Preflight

## What it is
No-login alcohol label preflight checker.

## Why
Reduces invalid COLA submissions and gives reviewers a faster visual verification layer.

## How to run
Open index.html or run a static server.

## Mock mode
USE_MOCK_AI = true works without API keys.

## API mode
Set USE_MOCK_AI = false and configure /api/analyze-label.

## Architecture
Vanilla HTML/CSS/JS, SVG overlays, normalized bounding boxes, Scroll serialization.

## Assumptions
Prototype only.
Not official TTB guidance.
Does not replace human review.
No data is stored in the prototype.

## Reviewer Mode
Demonstrates how the same extraction engine can help agents compare application fields to label text.

## Limitations
OCR/vision may be wrong.
Bounding boxes may be approximate.
Government warning validation is simplified.
```

---

# 24. Error Handling

Handle:

- no file uploaded
- unsupported file type
- image load failure
- API timeout
- invalid JSON response
- missing field boxes
- missing required fields
- model uncertainty
- network blocked

Show errors gently as small floating messages near top center.

Do not use blocking browser alerts unless unavoidable.

Example:

```text
Couldn’t analyze this label. You can still inspect it manually or try another image.
```

---

# 25. Performance Requirements

From stakeholder notes:

```text
If results take more than about 5 seconds, agents will not use it.
```

Prototype should:

- Show image instantly.
- Show analyzing state immediately.
- Use mock mode for instant demo.
- In API mode, aim for under 5 seconds.
- Timeout after 10 seconds.
- Keep UI usable while analyzing.

---

# 26. Accessibility Requirements

Minimum:

- Upload button is keyboard accessible.
- Mode toggle is keyboard accessible.
- Callouts have `tabindex="0"`.
- Escape closes popover.
- Status is not communicated by color alone; use icon and text.
- Image has alt text.
- Contrast should be readable.

---

# 27. Security / Privacy Requirements

Prototype:

- No login.
- No persistent storage required.
- Do not store uploaded labels unless user explicitly exports.
- Do not log base64 images.
- Do not expose API keys in frontend.
- Use serverless proxy for API calls.
- Include privacy note:

  ```text
  No login required. Prototype does not store labels.
  ```

---

# 28. Acceptance Criteria

The project is complete when:

1. App runs with plain HTML/CSS/JS.
2. No frontend framework is used.
3. User can upload or drag/drop a label image.
4. Label appears immediately and dominates the page.
5. Mock AI results render as visual overlays.
6. Field callouts connect to label regions with SVG lines.
7. Bounding boxes align with label regions.
8. Overlays remain aligned after resize.
9. Green valid callouts render correctly.
10. Amber warning callout renders correctly.
11. Red invalid callout renders correctly.
12. Invalid government-warning region pulses visually.
13. Applicant Mode is the default.
14. Reviewer Mode toggle exists.
15. Reviewer Mode compares mock application data to label values.
16. Applicant Mode uses helpful pre-submission language.
17. Reviewer Mode uses agent-facing language.
18. Clicking red/amber callout opens a correction popover.
19. Applicant can apply suggested correction.
20. Corrected field updates local state.
21. Reviewer can accept, override, or mark return-for-correction.
22. Scroll serializer exists.
23. Scroll serialization logs to console after analysis/correction.
24. API hook exists behind `USE_MOCK_AI = false`.
25. API key is never exposed in client code.
26. README explains setup, mock mode, API mode, assumptions, and limitations.
27. There is no right sidebar.
28. There is no bottom drawer.
29. There is no dashboard.
30. UI feels polished, minimal, and label-first.

---

# 29. Non-Goals

Do not build:

- Full COLAs Online integration.
- Authentication.
- User accounts.
- Batch upload UI.
- Reviewer queue.
- Database.
- Admin console.
- Audit log backend.
- Production compliance determination.
- Official legal advice system.
- Full TTB rule engine.

---

# 30. Build Order

## Phase 1: Static UI

Create:

```text
index.html
styles.css
app.js
```

Build:

- topbar
- applicant/reviewer toggle
- upload/drop zone
- label stage
- sample image fallback if useful

## Phase 2: Mock Overlay Engine

Build:

- `sampleData.js`
- callout cards
- SVG lines
- SVG boxes
- pulse error effect

## Phase 3: Responsive Overlay Math

Build:

- normalized coordinate conversion
- `ResizeObserver`
- overlay rerendering

## Phase 4: Interaction

Build:

- hover highlight
- click selection
- correction popover
- apply correction
- reviewer actions

## Phase 5: Scroll

Build:

- `toScroll(state)`
- console output after analysis and correction

## Phase 6: API Hook

Build:

- `ai.js`
- `analyzeLabel(imageBase64, mode, applicationData)`
- mock mode
- API mode
- error handling

## Phase 7: Polish

Improve:

- animation
- spacing
- typography
- mobile-ish responsiveness
- README
- comments
- deployed demo

---

# 31. Suggested `AGENTS.md`

Create this file for coding agents:

```md
# Agent Instructions

Build COLA Preflight as a vanilla HTML/CSS/JS single-page app.

No React, Vue, Svelte, Angular, jQuery, Tailwind, Bootstrap, or build system.

The app must be radically label-first. The uploaded label image is the main UI. All AI/compliance results appear as overlays connected to regions on the label.

Do not add:

- right sidebar
- bottom drawer
- dashboard
- login
- routing
- settings page
- batch upload
- database

Required:

- Applicant Mode
- Reviewer Mode
- upload/drop image
- mock AI data
- SVG overlay lines and boxes
- green/amber/red callouts
- pulsing red invalid government-warning region
- inline correction popover
- reviewer action popover
- Scroll serializer
- API hook hidden behind USE_MOCK_AI = false
- README

Applicant Mode helps producers fix labels before submission.
Reviewer Mode shows how TTB agents could compare application values to label values.

Prioritize beauty, simplicity, and correctness over features.
```

---

# 32. Final Product Story for README

Use this wording:

```md
COLA Preflight is a no-login pre-submission checker for alcohol beverage labels.

It helps producers and importers catch obvious COLA issues before submitting to TTB, reducing avoidable review burden. The same AI extraction layer can also support a reviewer mode, where TTB agents see application-vs-label matches, mismatches, and suggested correction reasons directly overlaid on the label image.

This prototype is intentionally minimal: the label is the interface.
```

---

# 33. Final North Star

The final prototype should make one thing obvious within five seconds:

```text
The AI found the important label fields,
put them directly on the label,
and clearly showed what passes, what needs review, and what must be fixed.
```

That is the whole app.

[1]: https://www.ttb.gov/about-ttb?utm_source=chatgpt.com "About the Alcohol and Tobacco Tax and Trade Bureau"
[2]: https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/ds-labeling-home/ds-health-warning?utm_source=chatgpt.com "Distilled Spirits Labeling: Health Warning Statement"
[3]: https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/ds-labeling-home/ds-alcohol-content?utm_source=chatgpt.com "Distilled Spirits Labeling: Alcohol Content"
[4]: https://platform.openai.com/docs/guides/responses-vs-chat-completions?utm_source=chatgpt.com "Migrate to the Responses API | OpenAI API"
[5]: https://tesseract.projectnaptha.com/?utm_source=chatgpt.com "Tesseract.js | Pure Javascript OCR for 100 Languages!"
