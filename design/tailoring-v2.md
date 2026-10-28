# Tailoring v2: compose a truthful, ATS-legible resume from the whole profile

Status: agreed 2026-10-28. The 1.1.1 release waits for all of it.

## Why

Today's tailoring (`generation/tailor.js`) edits the uploaded resume with a short, narrow edit list: 3–10 edits, rewrites only to add a posting term, no structure changes, no company input. It reliably avoids fabrication but changes too little. Users enter their whole history in the profile so each resume can be built from the best-fitting material; v2 does that.

The ATS research (`design/research/ats-research.md`) sets the target. Formatting does not get resumes auto-rejected; knockout questions do. What decides visibility is literal recruiter search (skills, titles), AI graders that check each required and preferred qualification against cited resume text (Workday HiredScore, Greenhouse, Ashby, iCIMS), and a clean text layer. So the goal is not keyword density: it is **every requirement the user really meets, in the posting's words, with a line of proof, in plain parseable text.**

## Decisions

- Rewrite bullets freely (wording, emphasis, combine or split) as long as every claim stays true to its source.
- Add a tailored 2–3 line summary even if the upload has none. Reorder bullets, choose and order sections for the posting.
- Pull the most relevant jobs, projects, experience bullets, skills and extras from the whole profile.
- Implied descriptions and soft skills the profile supports are allowed. Nothing is invented.
- Company tailoring means emphasising experience close to their product and tech stack, cheaply. The company is not named in the summary.
- One page only, filled to at least 90%.
- Past job titles never change; jobs stay newest first. The posting's title may appear in the summary only when the profile supports it.
- The profile gains optional work authorization, clearance and license fields so hard requirements can be stated.
- The uploaded resume stays required (layout measurement, Original view) but is no longer the only source.
- No strength setting. Later, separately: click-to-edit in the preview with a one-page guard.

## Pipeline

1. **Posting analysis v2**: required and preferred qualifications, core and supporting skills, the posting's title, hard requirements (license, clearance, degree, work authorization, location) and acronym/full-form pairs, each with its span in the posting.
2. **Company brief**: product and tech stack only. Posting first, then cached research, then at most one short search when research is on.
3. **Compose**: one structured model call over the whole profile. Every output line cites source ids (`exp:3.b2`, `proj:5`, `skill:Go`, `extra:2`).
4. **Validate** in code (checks below), repair once or twice, then fit to one page.
5. **Render** with the parse-safe template.
6. **Report** to the user: posting keywords covered, the requirement → line map, and gaps the profile does not cover.

## Checks the code enforces

Numbers refer to the checklist in `design/research/ats-research.md`.

**Truth** [7, 15, 21]: every line cites a source; numbers in a line appear in its sources; tools and technologies appear in the cited sources or the profile's skills; skills only from the profile; titles, employers and dates copied from the profile by code; dates never gain a month the source lacks.

**Match** [11–19]: each core skill the profile supports appears verbatim at least once (unsupported ones reported as gaps, never inserted); every supported required qualification maps to a specific line; at least 70% of matched skills also appear in a bullet; acronym and full form once each for key terms; hard requirements the user meets stated explicitly; most relevant role and bullets first.

**Never** [20, 22, 24]: no term more than about three times; no hidden or zero-size text; a banned-phrase lint for generic filler; no "ATS score" or pass guarantees in the UI.

**Parse safety** [1–10]: single column with DOM order equal to reading order; no tables, images, SVG or canvas in the resume; contact details and URLs as visible text; no ligatures or private-use characters; headings from a fixed vocabulary (Summary, Skills, Experience, Projects, Education, Certifications); one date style (`Mar 2022 – Present`, year only allowed for education); small file; a round-trip check of the text extracted from a real Chrome PDF export.

## Pull requests

1. Parse-safe template and export checks (improves today's output on its own).
2. Posting analysis v2, with unit tests.
3. Eval rubric v2 aligned with the checks, plus a baseline of today's generator.
4. Composition schema and validator (truth, match, never-do), pure code with unit tests.
5. Composition prompt and pipeline beside the old path; switch once evals beat the baseline.
6. Company product and tech-stack brief.
7. UI: coverage, requirement map, gaps, highlights with source hovers; profile fields for authorization, clearance and licenses.
8. Remove the old edit-list path; docs.
