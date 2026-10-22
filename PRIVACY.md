# Resume Studio — Privacy Policy

_Last updated: 2026-10-22_

Resume Studio is a Chrome extension that tailors your own resume to a job posting and writes cover letters, from a profile you build and a job posting you paste. It is designed so that your data stays in your browser and the only outside service it ever contacts is OpenAI, using an API key you provide.

## What the extension stores

Everything below is kept on your own computer, in Chrome's extension storage (`chrome.storage.local`) unless noted. It is not sent to us (there is no server of ours) and the extension does not sync it anywhere.

- **Your profile**: name, contact details, location, summary, education, skills, work experience, projects, certifications and achievements. Keywords you confirm in the keyword check are added to your skills.
- **The resume PDF you upload**, and a snapshot of its text as parsed, which every tailored resume starts from. The PDF is parsed entirely inside the browser; no part of it is sent anywhere for parsing.
- **Your OpenAI API key**, so you do not have to enter it every time. It is shown masked in Settings and can be replaced or removed there. Chrome stores it unencrypted in your browser profile, so anyone with access to your computer account could read it; we recommend a project-scoped key with a spending limit.
- **Generated documents and working data**: the last generated resume and the job posting it was made for, company research briefs (cached for up to 30 days), and your settings (the research toggle, onboarding progress). The light/dark theme choice is kept in the page's local storage.
- **While printing**: the resume being saved as PDF is held briefly in Chrome's session storage (`chrome.storage.session`) and removed as soon as the print view opens.

## Where your data goes

When you generate a document, the extension sends the following **directly to OpenAI's API (`api.openai.com`)** over HTTPS, authenticated with your key (verifying a key in Settings sends only a one-word test request):

- the job posting you pasted,
- your profile,
- for resumes, the text of your uploaded resume as parsed (never the PDF file itself),
- for cover letters with **Research the company** enabled, the company name, role and an excerpt of the posting, which OpenAI's hosted web-search tool uses to look up public information about the employer.

OpenAI is the only party your data is shared with. Its handling of that data is governed by [OpenAI's API data usage policies](https://openai.com/policies/api-data-usage-policies) and your agreement with them. You pay OpenAI directly for usage; Resume Studio has no account, subscription or payment of its own.

The extension makes no other network requests: it loads no remote scripts, fonts or images, and contains no analytics, telemetry, crash reporting, advertising or tracking of any kind. We never see your profile, your documents or your key. Documents you download are saved to your computer by Chrome.

## Limited Use

Resume Studio's use of user data complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/), including the Limited Use requirements. Your data is used only to generate the documents you ask for. It is not sold, not used for advertising, not used to determine creditworthiness or for lending, and not transferred to anyone other than OpenAI as described above.

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage`, `unlimitedStorage` | Keep your profile, uploaded resume PDF and generated documents in the browser. `unlimitedStorage` is needed because an uploaded PDF can exceed the default storage quota. |
| `downloads` | Save the cover letter PDF to your Downloads folder when you click **Cover Letter PDF**. |
| Host access to `https://api.openai.com/*` | Call the OpenAI API with your key. This is the only site the extension can contact. |

## Deleting your data

Removing the extension from Chrome deletes everything it stored. You can also remove your API key from Settings at any time, clear individual profile entries in the Profile tab, or upload a new resume to replace the stored one.

## Changes

If this policy changes, the date at the top is updated and the new version is published at the same address before it takes effect.

## Contact

Questions about this policy: open an issue at <https://github.com/JohnathanCarr/resume-cv-generator/issues>.
