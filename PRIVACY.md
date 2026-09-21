# Resume Studio — Privacy Policy

_Last updated: 2026-09-21_

Resume Studio is a Chrome extension that writes tailored resumes and cover letters from a profile you build and a job posting you paste. It is designed so that your data stays in your browser and the only outside service it ever contacts is OpenAI, using an API key you provide.

## What the extension stores

Everything below is kept in Chrome's extension storage (`chrome.storage.local`) on your own computer. It is not sent to us — there is no server of ours — and it is not synced anywhere by the extension.

- **Your profile**: name, contact details, location, summary, education, skills, work experience, projects, certifications and achievements.
- **The resume PDF you upload** to fill in your profile, and the text extracted from it. The PDF is parsed entirely inside the browser; no part of it is sent anywhere for parsing.
- **Your OpenAI API key**, so you do not have to enter it every time. It is shown masked in Settings and can be replaced or removed there.
- **Generated documents and working data**: the last generated resume and the job posting it was made for, company research briefs (cached for up to 30 days), and your preferences (theme, toggles, keywords you chose to skip).

The extension uses local extension storage only; it does not use Chrome's synced storage, so this data is not copied to your other devices by the extension.

## Where your data goes

When you generate a document, the extension sends the following **directly to OpenAI's API (`api.openai.com`)** over HTTPS, authenticated with your key:

- the job posting you pasted,
- the relevant parts of your profile,
- for resume revisions, the previous resume,
- for cover letters with **Research the company** enabled, the company name, role and posting, which OpenAI's hosted web-search tool uses to look up public information about the employer.

OpenAI's handling of that data is governed by [OpenAI's API data usage policies](https://openai.com/policies/api-data-usage-policies) and your agreement with them. You pay OpenAI directly for usage; Resume Studio has no account, subscription or payment of its own.

The extension makes no other network requests. It contains no analytics, telemetry, crash reporting, advertising or tracking of any kind, and we never see your profile, your documents or your key.

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage`, `unlimitedStorage` | Keep your profile, uploaded resume PDF and generated documents in the browser. `unlimitedStorage` is needed because an uploaded PDF can exceed the default storage quota. |
| `downloads` | Save the cover letter PDF to your Downloads folder when you click **Cover Letter PDF**. |
| Host access to `https://api.openai.com/*` | Call the OpenAI API with your key. This is the only site the extension can contact. |

## Deleting your data

Removing the extension from Chrome deletes everything it stored. You can also remove your API key from Settings at any time, or clear individual profile entries in the Profile tab.

## Changes

If this policy changes, the date at the top is updated and the new version is published at the same address before it takes effect.

## Contact

Questions about this policy: open an issue at <https://github.com/JohnathanCarr/resume-cv-generator/issues>.
