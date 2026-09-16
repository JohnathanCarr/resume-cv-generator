# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (MV3, no build step) plus a local Node/Express proxy that generates tailored resumes and cover letters from a saved profile and a pasted job description via the OpenAI API. Users seed their profile by uploading their existing resume PDF, which is parsed entirely in the browser with no LLM call.

## Commands

There is no bundler, linter, or test runner. Files in `extension/` are loaded straight from disk.

```bash
# Proxy (needed only for Generate and resume-PDF download)
cd proxy && npm install          # first time; Puppeteer downloads Chromium (allowScripts is set in package.json)
cd proxy && npm start            # http://localhost:8787, reads OPENAI_API_KEY from proxy/.env
curl -s http://localhost:8787/health

# Syntax-check the proxy without starting it
node --check proxy/server.js

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

Real resumes for regression testing go in `test/fixtures/local/` (gitignored). Never commit a PDF with real contact details; `proxy/_debug_server_resume.pdf` is a tracked legacy exception that should eventually be `git rm --cached`.

## Architecture

```
extension/app.html ──► extension/app.js (CoverLetterApp) ──► chrome.storage.local
        │                     │  ├─ resumeParser.js  (PDF → profile, pure functions, pdf.js)
        │                     │  └─ profileMerge.js  (additive dedup merge)
        │                     └─ fetch localhost:8787 ──► proxy/server.js ──► OpenAI
        │                                                       └─ /pdf/fromHtml (Puppeteer)
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

**Generation.** The proxy builds prompts by string interpolation (`formatEducation()` / `formatExtras()` helpers) and calls `gpt-4-turbo` in `json_object` mode. The resume response is post-processed by `trimResumeForOnePage()`. The extension renders resume JSON in `formatResume()` with **inline styles and hardcoded pt sizes** because the same HTML is POSTed to `/pdf/fromHtml` for Puppeteer; resume output styling is edited there, not in `styles.css`. Model output and profile fields are inserted into `innerHTML` unescaped.

**Styling.** `styles.css` Section 1 defines spacing/radius/font tokens and light/dark colour tokens (`[data-theme="dark"]`). Form controls (`input`, `textarea`, `select`) do not inherit `color` or `font-family` — any rule that themes a control's background must also set those, or it renders Chrome's black-on-monospace defaults in dark mode. The four "+ Add ___" buttons are the only `.btn-secondary` that are direct children of `.section`; target them with `.section > .btn-secondary`.

## Conventions

- Conventional Commits, small focused commits on a feature branch, one PR per phase. Scopes in use: `profile`, `parser`, `proxy`, `extension`, `settings`, `prompts`, `docs`. CSS that changes what users see is `fix`, not `style`.
- Merge PRs with "Create a merge commit" or "Rebase and merge" so individual commits stay in history.
- The project directory path contains a colon (`RS:CV_Generator`), which breaks `npx`; run Puppeteer/other CLIs via `node node_modules/...` instead.

## Onboarding

First run is detected two ways: `chrome.runtime.onInstalled` (reason `install`) in `background.js` opens the app tab and seeds `onboarding` in `chrome.storage.local`; `app.js` `init()` treats a missing/false `onboarding.seen` as first run and starts the tour. Dev reloads of an unpacked extension do not fire `onInstalled`; reset by deleting the `onboarding` storage key or use the header "?" button, which replays the tour on demand. The tour (`extension/onboarding.js`) is a spotlight + tooltip sequence over real elements, switching tabs and scrolling as it goes; Skip and Escape always exit. The Getting Started checklist card on the Profile tab ticks itself from live state (resume uploaded, name set, proxy reachable with a key via `/health`, first document generated) and hides when complete.

## Next up: prompt and key-handling rewrite

Decisions made: the API key moves into the extension UI (masked after entry, replace-only, no viewing), sent to the proxy per request; the app targets **one** OpenAI model (current mid-tier workhorse, pinned in one config constant) with heavy prompt engineering — no OpenRouter or multi-provider. Planned commit sequence:

```
feat(settings): add API key panel with masked display and replace-only rotation
refactor(proxy): read API key from request header; drop .env and add key verification endpoint
chore(proxy): pin model in config and update SDK
test(prompts): add eval set of profiles × job postings with a scoring rubric
refactor(prompts): structured job-posting extraction replaces regex company/role detection
refactor(prompts): strict JSON schemas and lower temperatures for both endpoints
feat(prompts): no-fabrication rules and few-shot voice guidance for cover letters
feat(prompts): word-budget loop for one-page resumes
docs: settings, key storage, and model choice
```

Once the settings panel exists, add a tour step that points at it and switch the checklist's key item from the `/health` probe to the stored key.

Prompt-side problems this sequence addresses: company/role are extracted from job text with fragile regexes that fall back to literal `[COMPANY NAME]`; the cover-letter prompt licenses the model to "enhance or extrapolate" experiences; a strict `json_schema` is defined in `server.js` but never used; temperatures are 0.8/0.9; "AI detection avoidance" is a phrase ban-list rather than few-shot voice guidance; one-page fit is enforced by truncating bullets after the fact. Build the eval set before changing prompts and run it before/after every change. Phase 2 (uploaded resume as layout reference) depends on a vision-capable model, which the mid-tier choice preserves.
