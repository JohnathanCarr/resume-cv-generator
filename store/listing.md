# Chrome Web Store listing

Everything the Developer Dashboard asks for, in the order it asks. Paste from here.
Screenshots (`screenshot-*.jpg`: profile, generate, match report, keyword check; 1280×800, no alpha as the store requires) are rendered by `scripts/screenshots.sh`; the icon comes from `store/icon.svg`.

## Store listing

**Name:** Resume Studio

**Summary** (132 characters max):
Writes a one-page, ATS-friendly resume and cover letter for each job from your own profile. Bring your own OpenAI key.

**Category:** Productivity → Workflow & Planning

**Language:** English

**Description:**

Resume Studio writes a one-page resume and a matching cover letter for each job you apply to, from your own profile, built for applicant tracking systems (ATS). It uses your own OpenAI API key.

HOW IT WORKS
1. Upload your current resume (PDF). It is parsed in the browser, with no upload anywhere, to fill in your profile: education, skills, experience, projects, certifications. Then treat your profile like a library: add every skill, project and experience you have, not just the ones on one resume.
2. Paste a job posting.
3. Generate. The posting is read against your profile, the company is researched, and the resume is written from whatever fits this job best.

WHAT YOU GET
• A resume written for this job: a summary aimed at the role, skills in the posting's wording, and the jobs and projects that matter most for it, with bullets reworded to lead with what the posting cares about.
• True to your profile: every line cites the profile lines it came from, and the code checks that it adds no number, tool or credential they don't have. Your job titles, employers, dates and education are copied from your profile, never rewritten.
• You stay in control: tick Must include on your strongest job or project and it always appears. Hover any highlighted words in the preview to see your original wording, or switch to your original PDF with one click. The downloaded PDF has no highlights.
• A match report: each requirement in the posting and where your profile shows it, plus the key keywords you have and the ones you don't. Gaps are reported, never filled in for you.
• Built for one page: the page is measured and the least useful bullets go first. The preview matches the PDF line for line, and if a resume still runs over, it tells you.
• A keyword check before writing: the posting's key skills and tools that your profile never mentions (at most 8) are listed for you to confirm. Tick the ones you have and they are added to that document only; your profile doesn't change.
• Cover letters that sound like a person: 250–350 words, specific, every claim traceable to your profile, the posting or the company research.
• Real PDFs, not images, in a clean single-column layout that ATS software can read.

YOUR DATA
Your profile, uploaded resume and documents live in this browser's extension storage. The extension talks to exactly one outside service: OpenAI's API, with your key, when you click Generate. That includes OpenAI's web search, which looks up the employer using the company name, role and part of the posting. There are no accounts, no servers of ours, no analytics.

YOU NEED
• An OpenAI API key (platform.openai.com). You pay OpenAI directly for usage, typically 5–15 cents per document, and OpenAI's usage policies apply. Resume Studio itself is free and open source: github.com/JohnathanCarr/resume-cv-generator
• A few minutes to read what it writes. AI can get things wrong: check every resume and cover letter before you send it.

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
