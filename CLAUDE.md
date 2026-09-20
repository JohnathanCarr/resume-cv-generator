# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (MV3, no build step) that generates tailored resumes and cover letters from a saved profile and a pasted job description by calling the OpenAI API directly with the user's own key. Users seed their profile by uploading their existing resume PDF, which is parsed entirely in the browser with no LLM call. Nothing runs outside the browser.

## Commands

There is no bundler, linter, or test runner. Files in `extension/` are loaded straight from disk.

```bash
# Syntax-check without running
node --check extension/app.js extension/print.js
node --input-type=module -e "import('./extension/generation/pipeline.js').then(m => console.log(Object.keys(m)))"

# Prompt evals (in-process, no server; ~$1 for the full set, key from OPENAI_API_KEY or test/eval/.env)
node test/eval/run.js --profiles david --jobs 02   # one pair
node test/eval/run.js --label my-change --baseline # full set, summary copied to test/eval/baselines/

# Extension: chrome://extensions → Developer mode → Load unpacked → select extension/
# After editing app.js/manifest.json click ↻ on the extension card; app.html/styles.css only need a tab refresh.

# Parser harness (exercise resumeParser.js against fixtures without the extension)
python3 -m http.server 8790      # from repo root
# open http://localhost:8790/test/parser.html — pick a fixture or upload any PDF
```

Regenerate a synthetic fixture PDF from its HTML source with headless Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$PWD/test/fixtures/<name>.pdf" "file://$PWD/test/fixtures/<name>.html"
```

Real resumes for regression testing go in `test/fixtures/local/` (gitignored). Never commit a PDF with real contact details.

## Architecture

```
extension/app.html ──► extension/app.js (CoverLetterApp) ──► chrome.storage.local
        │                     │  ├─ resumeParser.js  (PDF → profile, pure functions, pdf.js)
        │                     │  ├─ profileMerge.js  (additive dedup merge)
        │                     │  └─ generation/      (ES modules, lazily imported)
        │                     │       ├─ pipeline.js  ──► openai.js (fetch) ──► api.openai.com
        │                     │       └─ matchAnalysis / companyResearch / resume / coverLetter / config
        │                     └─ chrome.storage.session.printJob ──► extension/print.html (window.print → Save as PDF)
        └─ extension/styles.css (25 numbered sections; tokens in Section 1)
```

**Data model.** `profile` lives in `chrome.storage.local` and is the single source of truth: `name, contact (multi-line text), location, summary, education[], skills[], experiences[], projects[], extras[]`. Entry arrays carry `id` and (experiences/projects) `mustInclude`. `extras[].type` is one of `CoverLetterApp.EXTRA_TYPES`. `uploadedResume` (base64 PDF + metadata) is stored under its own storage key so profile saves stay small. `education` was a single object before multi-entry support; `migrateEducation()` in `loadData()` converts legacy saves.

**Repeated UI is built in JS, not HTML.** Static sections live in `app.html`; every per-item card (education, experience, project, extras, skill tag) is a template string in `createXElement()` in `app.js`. If a card looks wrong, the markup is there, not in `app.html`.

**Upload → autofill flow.** `handleResumeUpload()` validates and stores the PDF, then `autofillFromResume()` runs `ResumeParser.parse()` and `ProfileMerge.merge()`. Merge is additive: new items appended, matching items (normalised keys: institution+degree, company+title, project name, title+organisation) enriched by filling blanks and unioning bullets; ids and `mustInclude` are preserved; scalars are never overwritten. Re-uploading the same resume is a no-op. Parser warnings surface in `#profile-status` (the Profile tab has its own status element; `#generation-status` is in the Generate tab).

**Resume parser (`resumeParser.js`).** Stages: positioned lines from pdf.js → body font size + section split via `SECTION_SYNONYMS` dictionary → per-section parsers. Non-obvious facts it depends on:
- `page.commonObjs` (font names → bold/italic) is empty until `page.getOperatorList()` has run.
- CSS list markers are **not** in the PDF text stream; bullets are detected by indent (x > left margin) or an explicit glyph. Wrapped lines are re-joined using pdf.js `hasEOL` when the generator emits it, otherwise by right-margin proximity.
- Unknown all-caps bold headings become kind `unknown`; `looksLikeEntryList()` decides whether to file them as extras of type `other` or skip with a warning. Add new heading variants to `SECTION_SYNONYMS` rather than widening the fallback.
- Skills sections are either lists or prose; `parseSkills()` joins wrapped bullets first, then in prose mode keeps only fragments that pass `looksLikeSkill()` (capitalised/acronym, single token with `./+/#/-`, or in `KNOWN_SKILLS`).

**Generation.** `extension/generation/` is plain ES modules with no Node or DOM dependency, so the same files run in the extension page and under Node for evals. `app.js` is a classic script and reaches them through `this.generation()`, a cached dynamic `import()`. `openai.js` is a fetch wrapper with the SDK's call shape (`chat.completions.create`, `responses.create`); there is no `openai` npm dependency anywhere. Prompts are string interpolation (`formatEducation()` / `formatExtras()` helpers in `profileText.js`) against the model pinned in `generation/config.js`. The extension renders resume JSON in `formatResume()` with **inline styles and hardcoded pt sizes** because the same `.resume-page` markup is copied into `print.html`, which does not load `styles.css`; resume output styling is edited in `formatResume()`, page geometry (`@page`, margins) in `print.html`. `downloadResumePDF()` stores the markup in `chrome.storage.session` and opens `print.html`, whose `print.js` consumes it once, sets `document.title` (Chrome's proposed filename) and calls `window.print()`. Model output and profile fields are inserted into `innerHTML` unescaped.

**Styling.** `styles.css` Section 1 defines spacing/radius/font tokens and light/dark colour tokens (`[data-theme="dark"]`). Form controls (`input`, `textarea`, `select`) do not inherit `color` or `font-family` — any rule that themes a control's background must also set those, or it renders Chrome's black-on-monospace defaults in dark mode. The four "+ Add ___" buttons are the only `.btn-secondary` that are direct children of `.section`; target them with `.section > .btn-secondary`.

## Conventions

- Conventional Commits, small focused commits on a feature branch, one PR per phase. Scopes in use: `profile`, `parser`, `generation`, `extension`, `onboarding`, `settings`, `prompts`, `eval`, `docs`. CSS that changes what users see is `fix`, not `style`.
- Merge PRs with "Create a merge commit" or "Rebase and merge" so individual commits stay in history.
- The project directory path contains a colon (`RS:CV_Generator`), which breaks `npx`; run any CLI via `node node_modules/...` instead.

## Onboarding

First run is detected two ways: `chrome.runtime.onInstalled` (reason `install`) in `background.js` opens the app tab and seeds `onboarding` in `chrome.storage.local`; `app.js` `init()` treats a missing/false `onboarding.seen` as first run and starts the tour. Dev reloads of an unpacked extension do not fire `onInstalled`; reset by deleting the `onboarding` storage key or use the header "?" button, which replays the tour on demand. The tour (`extension/onboarding.js`) is a spotlight + tooltip sequence over real elements, switching tabs and scrolling as it goes; Skip and Escape always exit. The Getting Started checklist card on the Profile tab ticks itself from live state (resume uploaded, name set, key saved, first document generated; the key line shows OpenAI's verification result) and hides when complete.

## Generation pipeline (current)

Key handling: the extension stores the OpenAI key in `chrome.storage.local` (`apiKey`; masked in Settings, replace-only) and passes it to the pipeline functions, which send it as `Authorization: Bearer` to `api.openai.com` only (the manifest's sole non-local host permission). `createClient(apiKey)` builds a per-call client and `safeErrorMessage` scrubs key-shaped strings from errors; `verifyKey()` makes one tiny call so Settings can show Verified. Errors carry `.status` (401 = rejected key) and `.code` (`timeout`, `network`, `output_truncated`).

Model: one pinned model in `extension/generation/config.js` (`gpt-5.6-terra`; verification uses `gpt-5.6-luna`). GPT-5 models reject `temperature`/`max_tokens` — use `reasoning_effort` and `max_completion_tokens`. All generation goes through `generateStructured()` with strict `json_schema` output; a `finish_reason: length` is surfaced as an error.

Per document, in `extension/generation/` (orchestrated by `pipeline.js`):
1. `matchAnalysis.js` — reads the posting against the profile (rendered with stable ids `exp:3`, `proj:5`, `edu:1`, `extra:6`, `skill:Go`) and returns company, role, seniority, `about_company` (posting-only), every requirement with supporting ids and strength (strong/partial/none), and the posting's exact ATS keywords. Replaces the old regexes, which had reported companies like "a Analyst" and "ions". Returned as `matchAnalysis`; the extension keeps it on `lastMatchAnalysis` for the deferred Match panel.
2. `companyResearch.js` (cover letters, when `research` is on) — Responses API with the hosted `web_search` tool, at most `RESEARCH.maxSearches` searches at `low` context; produces a brief (what they build / care about / current priorities / context) with a URL per fact, or `found:false` and a note. The extension caches briefs per company for 30 days in `companyBriefs` and sends the cache as `briefCache`. Each search bills a tool call plus ~13K input tokens; research roughly quadruples a cover letter's cost.
3. `resume.js` — no-fabrication rules (select/rephrase only, no number not in the profile), ATS rules (posting's exact term where the skill exists, relevance-ordered skill lines, past-tense verb-led bullets), and a **material-relative budget**: target ≈ 115% of the profile's words + headers, capped at a page. `pipeline.js` adds one trim pass if over `maxWords` and one expand pass if well under target with bullets unused. `trimResumeForOnePage()` (which truncated bullets mid-sentence) is gone. The extension measures the rendered `.resume-page` against 1056px and re-requests once with a tighter `budget.maxWords` on overflow.
4. `coverLetter.js` — hard rules (nothing about the candidate outside the profile, nothing about the company outside the brief/posting, partial matches described as such, never refer to the profile as a document), two exemplar paragraphs for voice, ~300 words in 3–4 paragraphs, and a `claims[]` output where every claim names its source; `unsourcedClaims()` validates, `pipeline.js` does one repair pass, and any remaining unsourced claims are returned and shown in the status line.

Evals: `test/eval/` (see its README). Run before and after any prompt change; `--rescore` re-applies a changed rubric to saved outputs without API calls. Baselines in `test/eval/baselines/`. Known rubric limits: it cannot check whether company facts are true, and `pageFill` is relative to the profile's material, so thin profiles score full marks for short resumes.

**Deferred: Match panel.** `matchAnalysis` is stored but not shown. Next: a panel beside the preview listing each requirement with ✓/◐/✗ and the profile evidence, so users fix their profile rather than the output. Also worth doing: run match analysis and company research concurrently (research only needs the company name, which a cheap first pass could extract) to cut cover-letter latency from ~50s.
