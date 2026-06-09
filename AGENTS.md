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
