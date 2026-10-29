# Resume Studio

Resume Studio is a Manifest V3 Chrome extension that writes a one-page resume tailored to a job posting from the user's profile, and a matching cover letter. It runs entirely in the browser and calls the OpenAI API directly with the user's own key. There is no backend: the profile, the uploaded resume and generated documents stay in the extension's local storage, and the generation code lives in plain ES modules inside the extension.

**Stack:** JavaScript, Chrome Extensions (MV3), OpenAI API, pdf.js, jsPDF, node:test

![The Generate tab: job posting on the left, tailored resume preview on the right with changes highlighted](store/screenshot-generate.jpg)

## How it works

### Profile and baseline

The user uploads their existing resume as a PDF. `resumeParser.js` reads it in the browser with pdf.js and heuristics: text positions, font size and weight, and a dictionary of section headings. There is no model call. The parsed result does two things:

- It is merged into the profile additively. New items are appended, matching items have their blanks filled in, and nothing the user entered is overwritten.
- It is frozen as the **baseline**, a snapshot of the uploaded resume that every tailored resume starts from. Only a new upload replaces it, and profile edits never change it.

### Generation pipeline

The pipeline is in `extension/generation/`, orchestrated by `pipeline.js`. Every model call goes through a small fetch wrapper (`openai.js`, no SDK), and every generation call asks for strict JSON-schema output. The model, the reasoning effort per call and the research limits are pinned in `config.js`.

1. **Match analysis** (`matchAnalysis.js`). The posting is read against the profile, which is given to the model with stable ids (`exp:3`, `proj:5`, `skill:Go`). The result lists the company, the role, every requirement with the profile items that support it (strong, partial or none) and the posting's ATS keywords, each marked core or supporting.

2. **Keyword check** (`keywords.js`). Core keywords that appear nowhere in the profile, at most 8, are shown to the user as checkboxes. The ones they tick are added to their profile skills before anything is written, so the profile stays the only source of material.

   ![The keyword check dialog listing posting keywords missing from the profile](store/screenshot-keywords.jpg)

3. **Company research** (`companyResearch.js`, optional). This uses the Responses API with OpenAI's hosted web search, capped at 3 searches for a cover letter and 1 for a resume. It produces a short brief where every fact carries its source URL, or `found: false` when nothing credible turns up. Briefs are cached per company for 30 days.

4. **Resume: composed from the whole profile** (`compose.js`, `composePrompt.js`). The model writes a one-page resume for the posting from the entire profile: a summary aimed at the role, skills grouped and ordered for the posting, the most relevant jobs, projects and extras, bullets rewritten in the posting's terms, and the section order. Every summary and bullet line cites the profile lines it comes from, and `validateComposition()` checks in code that it adds no number, tool, company or credential those lines don't have. Titles, employers, dates and education always come from the profile. Lines that still fail after two repair passes are removed, and `fitComposition()` trims to one page without dropping a job or the evidence for a required qualification. A company brief (cached, or one web search when research is on) only decides which experience to lead with. The uploaded resume is still required: its layout sets the page, and the preview can show it for comparison.

5. **Cover letter** (`coverLetter.js`). The prompt allows nothing about the candidate outside the profile and nothing about the company outside the posting or the brief. Along with the letter, the model returns a `claims` list naming the source of each factual sentence (a profile id, "job posting" or a brief URL). Claims that cite an unknown source trigger one repair attempt, and any left after that are reported to the user in the status line rather than hidden.

### One page

The one-page limit is planned before the resume is written, not fixed afterwards. The extension renders the uploaded resume off-screen at print size. For each kind of line it measures font, width, line height and spacing, and measures text with a canvas (`layout.js`). The prompt gives the model the page's budget: how many lines of body text fit after every job, school and heading, and how many characters a line holds.

If the composed resume is still too long, `fitComposition()` removes whole items in a fixed order: extras from the end, then extra project bullets and whole projects, then the oldest jobs' later bullets. Every job keeps at least one bullet, and a bullet that proves a required qualification is never removed. It never cuts a line in half.

Finally the extension measures the real rendered result. If that still spills over, it trims again locally with the measured error folded in (no model call), at most twice.

### Preview and export

`highlight.js` builds two versions of the resume. The preview underlines in green the words that are new compared with the profile, and hovering one shows the profile line it came from. A toggle shows the uploaded PDF for comparison. Above the preview, a collapsible match report lists the posting's screening requirements (work authorization, clearance, licenses, location…), each required and preferred qualification with the profile items that show it, and the key keywords: on the resume, in the profile but not on this page, or not in the profile at all. Gaps are reported, never added, and there is no "ATS score". Work authorization and security clearance are optional profile fields, and License is an extras type, so those screening requirements can be stated when they apply. The clean version, without highlights, is what gets printed. Generated text is HTML-escaped before rendering.

The resume PDF comes from a print view (`print.html`) through Chrome's Save as PDF, so it is a text PDF that applicant tracking systems can read. The cover letter PDF is generated with jsPDF.

## Testing

Unit tests cover the code that runs without the API: the baseline snapshot, the keyword check, the composition validator, page fitting, line wrapping, the preview diff, the match report, and the resume and cover-letter HTML (escaping, and the page geometry the one-page measurement depends on). They make no network calls.

```bash
node --test 'test/unit/*.test.mjs'
```

The smoke test runs the real extension page in headless Chrome with the `chrome` API and OpenAI stubbed (nothing is sent or billed) and clicks through the main flows: a resume and a cover letter end to end, the keyword dialog (continue and cancel), both downloads with the file-name dialog, a failed generation and Retry, Settings, the theme toggle and the tour. It fails on any console error. It also checks that the resume is parse-safe for applicant tracking systems (standard headings, reading order, no tables, images or ligatures), prints it through the real print view to a PDF and reads the PDF's text back the way a parser would, and compares the resume's measured page height with `test/smoke/expected.json` so layout drift is caught. It takes a few seconds and needs Google Chrome.

```bash
./scripts/smoke.sh            # run it
./scripts/smoke.sh --update   # record a new page height after an intended layout change
```

Each generation also logs where its time went, one line in the DevTools console (`[timing] resume done: read posting 3.2s · compose 24.1s (research 4.8s, compose 10.9s, repair 1 8.0s) · …`); **Save logs** includes the same breakdown.

The prompt eval set in `test/eval/` runs the real pipeline in Node against 2 synthetic profiles and 5 job postings, then scores each document against a fixed rubric. For resumes the rubric (v2) checks truth (no invented numbers or tools, jobs and schools as in the profile), match (keyword coverage, proof for each required qualification, acronym pairs, a summary), the page (fits and fills it) and what to never do (keyword stuffing, filler); an optional recruiter judge adds a model's read. For cover letters it checks length, grounding in the profile, buzzwords and invented numbers. Summaries are saved under `test/eval/baselines/` so prompt changes can be compared. A full run costs about $1 and needs an OpenAI key in `OPENAI_API_KEY` or `test/eval/.env`.

```bash
node test/eval/run.js --profiles david --jobs 02           # one profile and posting
node test/eval/run.js --label my-change --baseline         # full set, saves a summary
node test/eval/run.js --rescore test/eval/runs/<dir>       # re-score saved outputs, no API calls
```

See `test/eval/README.md` for the full rubric.

The PDF parser is checked by hand. Serve the repo root (`python3 -m http.server 8790`), open `http://localhost:8790/test/parser.html` and pick one of the synthetic resume PDFs in `test/fixtures/`.

## Install from source

1. Clone the repository: `git clone https://github.com/JohnathanCarr/resume-cv-generator.git`
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder, not the repository root.
4. Click the extension's toolbar icon. The app opens in its own tab and starts a short first-run tour.

After editing `app.js`, `manifest.json` or anything in `generation/`, click the reload icon on the extension's card. Changes to `app.html` or `styles.css` only need a tab refresh.

## API key setup

1. Create a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). The account needs credits, because generation is billed to it.
2. In the extension, open Settings (the gear icon), paste the key and click **Save key**.
3. Settings shows **Verified** once a test call to OpenAI succeeds.

Once saved, the key is shown masked: it can be replaced or removed, but not viewed.

Generation is billed to that OpenAI account, and use of the API is subject to [OpenAI's usage policies](https://openai.com/policies/usage-policies). Resume Studio charges nothing. Generated documents are drafts: AI can get details wrong, so read each one before sending it. Settings repeats this under the key, and the preview shows a reminder.

## Privacy

Everything is stored in `chrome.storage.local` on the user's machine: the profile, the uploaded PDF, the API key, the last generated resume and cached company briefs. The only network host the extension can reach is `api.openai.com`, its only host permission. When generating, it sends OpenAI the job posting, the profile, and the company name and posting (for research). The uploaded resume is never sent: neither the PDF nor its parsed text. There is no analytics or tracking. The full policy is in [PRIVACY.md](PRIVACY.md).

## Troubleshooting

**The extension won't load.** Make sure Developer mode is on and that you selected the `extension/` folder rather than the repository root. Errors appear on the extension's card in `chrome://extensions`.

**The key shows an error instead of Verified.** "OpenAI rejected this key" means the key is wrong or revoked: create a new one and use **Replace key**. "Could not reach OpenAI" is a network problem; some corporate networks block `api.openai.com`.

**Generation fails.** Check that the key shows Verified and that the OpenAI account has credits and isn't rate-limited. If the model runs out of room ("The model ran out of room before finishing") the request is retried once automatically; if it still fails, run it again. The full error is in the console of the extension tab (F12).

**"Upload your current resume in the Profile tab first."** The resume is written from your whole profile, but your uploaded resume's layout sets the page, so a resume needs a PDF upload; cover letters don't.

**Upload filled in little or nothing.** The parser needs a PDF with selectable text; scanned PDFs have none. Multi-column and table layouts parse poorly because their text comes out of the PDF in the wrong order. Section headings it doesn't recognise are reported in the status message and either filed under extras or skipped.

**The resume PDF has a date or URL printed on it.** In the print dialog, open **More settings** and turn off **Headers and footers**.

## File structure

```
resume-cv-generator/
├── extension/                # Load this folder in Chrome
│   ├── manifest.json         # MV3 manifest: storage, unlimitedStorage, downloads, api.openai.com
│   ├── app.html, app.js      # App shell: storage, tabs, upload, preview, wiring the modules below
│   ├── styles.css
│   ├── background.js         # Opens or focuses the app tab
│   ├── onboarding.js         # The guided tour and its steps (TOUR_STEPS)
│   ├── theme.js              # Light/dark theme
│   ├── resumeParser.js       # PDF → profile, heuristic, no model call
│   ├── profileMerge.js       # Additive profile merge
│   ├── print.html, print.js  # Resume print view (Save as PDF)
│   ├── generationFlow.js     # The generate flow both documents share (keyword check, progress, errors)
│   ├── dialogs.js            # Dialogs: focus trap, Escape, page lock, error/keyword/file-name prompts
│   ├── profile/              # Profile tab editors and profile data helpers
│   ├── settings.js           # The API key dialog
│   ├── gettingStarted.js     # First-run tour start and the Getting Started checklist
│   ├── preview/              # Resume and cover-letter HTML, page measurement, PDF downloads
│   ├── generation/           # Pipeline, prompts, validators, layout model, OpenAI client
│   ├── icons/
│   └── jspdf.min.js, pdf.min.js, pdf.worker.min.js   # Bundled libraries
├── test/
│   ├── unit/                 # node:test unit tests
│   ├── smoke/                # Headless smoke test of the real app (stubbed chrome + OpenAI)
│   ├── eval/                 # Prompt eval set: profiles, postings, rubric, baselines
│   ├── fixtures/             # Synthetic resume PDFs and their HTML sources
│   └── parser.html           # Parser test page
├── store/                    # Chrome Web Store listing copy, icon source, screenshots
├── scripts/                  # package.sh (store zip), screenshots.sh, smoke.sh
├── LICENSE
├── PRIVACY.md
├── QUICK_START.md
└── CLAUDE.md                 # Architecture notes for contributors
```

## License

[MIT](LICENSE). The bundled libraries keep their own licenses: pdf.js (Apache 2.0) and jsPDF (MIT), with notices at the top of each file in `extension/`. The bundled fonts, Fraunces and Space Grotesk, are under the SIL Open Font License 1.1 (`extension/fonts/`). Use of the OpenAI API is subject to [OpenAI's usage policies](https://openai.com/policies/usage-policies).
