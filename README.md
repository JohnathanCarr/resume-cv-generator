# 🚀 Resume Studio — AI Cover Letter & Resume Generator

**Tailored, honest resumes and cover letters for every job you apply to — built only from your own experience.**

A Chrome extension, nothing else to install. You upload your resume once, keep a complete profile, paste a job posting, and get a one-page ATS-friendly resume and a plainly written cover letter that match the posting's actual requirements. Nothing is invented: every claim traces back to your profile, and everything said about the company comes from the posting or from cited research.

It uses your own OpenAI API key, so you pay OpenAI directly for what you generate (a few cents per document) and nothing goes through anyone else's server.

## ✨ What This Does

- 🎯 **Reads the posting properly**: extracts every requirement and checks which parts of your profile support it before writing a word
- 🔍 **Researches the company** (optional, cover letters): a few web searches for what they build and what they care about, every fact with its source; if nothing reliable turns up, the letter sticks to the posting
- 📄 **ATS-friendly resumes**: one page, standard sections, the posting's exact terms where you genuinely have the skill, no invented numbers
- ✍️ **Cover letters that sound like a person**: 250–350 words, specific, no buzzwords, no "I am excited to apply"
- 💾 **Smart profile management**: upload your existing resume to autofill your profile, autosave, everything editable
- 🔒 **Private by construction**: your profile lives in this browser's extension storage; the only outside service it ever talks to is OpenAI, with your key

## 🎯 What Makes This Different

**Traditional applications sound like this:**
> "I am excited to apply for this position. I am passionate about your company and believe I would be a great fit..."

**This sounds like this:**
> "At Stripe I designed the idempotency layer for the payments API, which cut duplicate charges by 94% across 40 million daily requests. I also led the migration of 12 services from Kubernetes 1.21 to 1.28 with zero downtime. My observability work has been through a tracing dashboard and an open-source project rather than an on-call ownership role, which is the part of this job I'd want to grow into first."

Every sentence there came from the candidate's profile, and the letter says so where the match is partial.

## 🚀 Install

Until the extension is on the Chrome Web Store, load it from source. Takes about two minutes.

### 1. Get the code
- Click the green **Code** button → **Download ZIP**, and extract it somewhere you'll keep it (Chrome loads the extension from this folder, so don't delete it afterwards)
- or `git clone https://github.com/JohnathanCarr/resume-cv-generator.git`

### 2. Load it in Chrome
1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the **`extension`** folder inside the project (not the project folder itself)
5. Click the extension's icon in the toolbar — it opens in its own tab and walks you through the first steps

### 3. Add your OpenAI API key
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys), sign in, and **Create new secret key**
2. In the extension, click the **gear icon** in the header
3. Paste the key and click **Save key** — the panel shows **Verified** once OpenAI confirms it works

Your key is stored only in this browser's extension storage and sent directly to OpenAI when you verify or generate. Once saved it can be replaced or removed, but never viewed. You need an OpenAI account with credits; generation is billed to it per document.

## 🎯 How to Use

### First Time Setup
1. **Upload your current resume** (PDF) with the **Upload Resume** button next to Personal Information. Your skills, education, experience, projects and extras are parsed locally (no AI call) and filled in for you. The PDF is kept so you can view it any time.
2. **Review and complete your Profile**:
   - Personal info and summary
   - Education (one entry per institution)
   - Skills
   - Work experiences with achievements
   - Projects with technical details
   - Certifications & achievements (certifications, awards, research, publications, leadership, volunteering)

   Uploading another resume later only **adds** what is new — nothing you entered is removed.

### Generate Documents
1. **Go to the Generate tab**
2. **Paste any job description**
3. **Choose your document**:
   - **Generate Cover Letter** → 250–350 words, grounded in your profile and the posting. Leave **Research the company** ticked for a few web searches about the employer (roughly $0.05–0.10 per letter, cached per company for 30 days); untick it to use the posting only.
   - **Generate Resume** → one page, ATS-friendly, sized to how much material your profile actually has
4. **Save it**:
   - **Cover Letter PDF** downloads straight to your Downloads folder
   - **Resume PDF** opens a print view; choose **Save as PDF** as the destination. The result is a real text PDF (not an image), so applicant tracking systems can read it.

The status line under the buttons tells you what happened: how many searches the research used, whether any sentence couldn't be traced to your profile, and whether your profile is what's keeping the resume short.

### Pro Tips
- **Mark items "Must Include"** to guarantee they appear on resumes
- **Classify extras** as Research/Program/Certification for better placement
- **Keep your profile complete** — list every skill you have, not just the ones on one resume; each generated document picks what fits the job
- **Different jobs = different documents** — each is tailored specifically

## 📋 What You Need

- **Google Chrome** (or another Chromium browser that loads unpacked extensions)
- **OpenAI API account** with credits

## 🛠️ Troubleshooting

**❌ Extension won't load**
- Enable "Developer mode" in `chrome://extensions/`
- Make sure you selected the `extension` folder, not the project folder
- Check for error messages on the extension's card

**❌ Key shows an error instead of Verified**
- *OpenAI rejected this key* — the key is wrong, revoked, or from a different account; create a new one and use **Replace key**
- *Could not reach OpenAI* — check your connection; corporate networks sometimes block `api.openai.com`

**❌ "Failed to generate" errors**
- Open Settings (gear icon) and check the key shows **Verified**
- Check your OpenAI account has credits and hasn't hit a rate limit
- *The model ran out of room before finishing* — try again, or shorten a very long job posting
- Open the browser console on the extension tab (F12) for the full error

**❌ Resume PDF has a date or URL printed on it**
- In the print dialog, open **More settings** and untick **Headers and footers**. The page uses zero margins so this shouldn't happen, but some Chrome versions ignore that.

**❌ Generic/poor quality output**
- Fill out a complete profile with detailed experiences
- Include specific achievements and metrics — the generator won't invent any
- The resume only gets as long as your profile has material; add coursework, projects or certifications to fill a page

## 🏗️ Architecture

```
Chrome extension ──→ api.openai.com (with your key)
```

That's it. The extension page holds the UI, your data (in `chrome.storage.local`) and the generation pipeline:

1. **Match analysis** — a structured read of the posting against your profile: company, role, every requirement with the profile items that support it and how strongly, and the posting's exact ATS keywords
2. **Company research** (cover letters, optional) — OpenAI's hosted web search, at most a few searches, every fact with its URL
3. **The document** — generated against a strict output schema with no-fabrication rules; resumes get a trim or expand pass to fit the page, cover letters get a repair pass for any sentence that can't be traced to a source

The model, per-call reasoning effort and research limits are pinned in `extension/generation/config.js`.

## 📊 Data Privacy & Security

- ✅ **All data stays local** — profile, uploaded resume and generated documents live in Chrome's extension storage on this device
- ✅ **One outside service** — the only network calls are to `api.openai.com`, and only when you verify a key or generate; that's the extension's only host permission
- ✅ **API key never exposed** — stored in the extension, never displayed once saved
- ✅ **Uploaded resume stays on your device** — parsed in the browser, never sent to the AI (your *profile* is sent when you generate)
- ✅ **No accounts, no tracking, no analytics**

## 🔧 Advanced Configuration

### Model and prompts
- The model, reasoning effort per call and research limits live in `extension/generation/config.js`
- Prompts live in `extension/generation/` — `matchAnalysis.js`, `companyResearch.js`, `resume.js`, `coverLetter.js`
- Before changing a prompt, run the eval set (`test/eval/README.md`) so you can compare before and after; it runs the same code the extension does

### Extension customization
- Modify `extension/styles.css` for the app's look; resume output styling is inline in `formatResume()` in `app.js`, page geometry in `print.html`
- Reload the extension in Chrome after editing `app.js`, `manifest.json` or anything in `generation/`; `app.html` and `styles.css` only need a tab refresh

## 📝 File Structure

```
resume-cv-generator/
├── extension/               # The whole product — load this folder in Chrome
│   ├── manifest.json        # Extension configuration (MV3)
│   ├── app.html / app.js    # Main application UI and logic
│   ├── styles.css           # App styling
│   ├── background.js        # Opens the app tab, seeds first-run state
│   ├── onboarding.js        # First-run tour
│   ├── theme.js             # Light/dark theme
│   ├── resumeParser.js      # Heuristic PDF → profile parser (no AI)
│   ├── profileMerge.js      # Additive profile merge with dedup
│   ├── print.html / print.js# Resume print view (Save as PDF)
│   ├── generation/          # OpenAI client, prompts and pipeline
│   ├── jspdf.min.js         # Cover letter PDF
│   └── pdf.min.js           # pdf.js for reading uploaded resumes
├── test/
│   ├── parser.html          # Parser harness against fixture PDFs
│   ├── fixtures/            # Synthetic resume PDFs
│   └── eval/                # Prompt evals: profiles × postings, scored by rubric
├── CLAUDE.md                # Architecture notes for contributors
└── README.md                # This file
```

## 📄 License

This project is provided for educational and personal use. Please comply with OpenAI's usage policies when using their API.

## 🆘 Need Help?

1. Check the troubleshooting section above
2. Open the browser console on the extension tab (F12) for errors
3. Open an issue on GitHub with the error text (never paste your API key)
