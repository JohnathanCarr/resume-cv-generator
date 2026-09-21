# Chrome Web Store listing

Everything the Developer Dashboard asks for, in the order it asks. Paste from here.
Screenshots and the icon are rendered by `scripts/screenshots.sh` and `store/icon.svg`.

## Store listing

**Name:** Resume Studio

**Summary** (132 characters max):
Tailored, ATS-friendly resumes and cover letters from your own profile and a job posting. Bring your own OpenAI key; nothing else.

**Category:** Productivity → Workflow & Planning

**Language:** English

**Description:**

Resume Studio writes a one-page resume and a cover letter for a specific job, from a profile you control, using your own OpenAI API key.

HOW IT WORKS
1. Upload your current resume (PDF). It is parsed in the browser — no upload anywhere — to fill in your profile: education, skills, experience, projects, certifications. Review and add anything missing.
2. Paste a job posting.
3. Generate. The posting is read against your profile first: every requirement is matched to the evidence you actually have, and the posting's exact keywords are collected.

WHAT YOU GET
• Resumes that pass applicant tracking systems: one page, standard sections, the posting's own terms wherever you genuinely have the skill, past-tense action bullets, no invented numbers or tools.
• A keyword check before writing: terms the posting looks for that your profile never mentions are listed for you to confirm. Tick the ones you have and they are added to your profile; the rest are never asked about again.
• Revisions, not rewrites: the next resume starts from your last one and changes only what the new posting needs, so wording you liked stays put.
• Cover letters that sound like a person: 250–350 words, specific, every claim traceable to your profile or the posting. Optionally researches the employer with a few web searches and cites each fact.
• Real PDFs, not images, so ATS software can read them.

YOUR DATA
Your profile, uploaded resume and documents live in this browser's extension storage. The extension talks to exactly one outside service: OpenAI's API, with your key, when you click Generate. There are no accounts, no servers of ours, no analytics.

YOU NEED
• An OpenAI API key (platform.openai.com). You pay OpenAI directly for usage — typically a few cents per resume and $0.05–0.20 per cover letter with research on. Resume Studio itself is free and open source: github.com/JohnathanCarr/resume-cv-generator

## Privacy

**Single purpose description:**
Generates tailored resumes and cover letters from the user's saved profile and a pasted job posting, using the user's own OpenAI API key.

**Permission justifications:**

- `storage` — Keeps the user's profile, generated documents and settings in the browser between sessions.
- `unlimitedStorage` — The user's uploaded resume PDF is stored alongside the profile so it can be re-parsed; PDFs can exceed the default 10 MB storage quota.
- `downloads` — Saves the generated cover letter as a PDF to the user's Downloads folder when they click "Cover Letter PDF".
- Host permission `https://api.openai.com/*` — Sends the job posting and the user's profile to OpenAI's API, authenticated with the user's own key, to generate the documents. This is the only network endpoint the extension contacts.

**Remote code:** No, I am not using remote code. (All scripts ship in the package; the OpenAI API returns data, not code.)

**Data usage — what is collected:**
- Personally identifiable information (name, contact details, employment history — the user's own profile, entered by them)
- Authentication information (the user's OpenAI API key)
- Website content — no. Web history — no. Location — no (a free-text location the user types into their profile, not device location).

**Certifications** (tick all three):
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/JohnathanCarr/resume-cv-generator/blob/main/PRIVACY.md

## Distribution

- **Visibility:** Unlisted for the first review; switch to Public once the store install has been tested.
- **Pricing:** Free.
- **Regions:** All regions.

## Submission notes for the reviewer (Review → "Notes for reviewers")

The extension requires the tester's own OpenAI API key (Settings → gear icon); without one it opens, parses an uploaded PDF and edits the profile, but Generate stops with a prompt to add a key. `store/screenshots.html` in the source repository renders the app with a fictional profile if a key-free walkthrough is preferred.
