# Prompt evals

Runs the generation endpoints over a small set of profiles × job postings and
scores each output against a fixed rubric, so prompt changes can be compared.

```bash
node test/eval/run.js --label my-change            # everything (≈30 docs, ~$1)
node test/eval/run.js --profiles david --jobs 02   # one pair, quick check
node test/eval/run.js --only cover --label x       # one document type
node test/eval/run.js --label x --baseline         # also copy the summary to baselines/
node test/eval/run.js --rescore test/eval/runs/<dir>  # re-apply a changed rubric to saved outputs (no API calls)
node test/eval/run.js --only resume --judge --label x  # add the recruiter judge (one extra call per resume)
node test/eval/run.js --rubric v1 ...                  # the old edit-list resume rubric instead of v2
node test/eval/run.js --only resume --engine compose --judge --label x  # tailoring v2's composer instead of edit-list tailoring
```

The pipeline (`extension/generation/`) runs in-process; no server is needed.
The key comes from `OPENAI_API_KEY` or `test/eval/.env`. Full outputs land in
`runs/<timestamp>-<label>/` (gitignored); `baselines/` holds committed
summaries to compare against.

- `profiles/` — synthetic profiles (committed) and `profiles/local/` for real ones (gitignored)
- `jobs/` — postings; line 2 is `Company · Location`, which `run.js` uses to know the company
- `scoreV2.mjs` — **resume rubric v2** (default; `design/tailoring-v2.md`).
  Scores any resume in `formatResume()`'s shape against the profile, posting
  and match analysis, so it measures today's edit-list tailoring and the v2
  composer alike. Truth: no numbers or tools the profile lacks (posting
  keywords copied onto the page are checked by name; a keyword's alias
  counts as support), jobs and schools exactly as in the profile and newest
  first, skills only from the profile ("posting wording (profile wording)"
  passes if either is in the profile). Match: coverage of the core keywords
  the profile supports, a resume line backing each supported required
  qualification, acronym and full form both present, matched skills used in
  bullets (70% is full marks), met hard requirements stated, a summary. Page:
  fits, and fills ≥ 90% (by the layout estimate). Never: no keyword more than
  three times, no filler phrases, parse-safe when rendered with the real
  template. Skill group labels ("Cloud & DevOps:") are headings, so the tools
  check reads only the skill items. `judge.mjs` (`--judge`) adds a recruiter judge: relevance,
  tailoring, specificity, readability and credibility, 1–5 each, scored
  strictly, with a note on the biggest weakness.
- `score.js` — the cover-letter rubric, and the v1 resume rubric
  (`--rubric v1`). Resume v1 (tailoring, scored against the baseline it
  edited): shape, jobs and education untouched, summary only if the upload had
  one, no fabricated numbers, core keyword coverage of what the profile can
  honestly reach, no keyword more than three times, fits one page (by the
  layout estimate), at most 12 edits, no edits
  rejected after the repair pass, unedited lines byte-identical. Eval profiles
  have no uploaded resume; `evalBaseline()` in `run.js` uses the profile minus
  some held-back material, which becomes the swap pool. Cover letter: length,
  paragraphs, names the company, buzzword and AI-tell lints, no fabricated
  numbers, grounded in ≥2 profile items, sentence variety, em-dash restraint,
  JD keyword coverage.

What the rubric cannot check: whether company facts in a cover letter are
true. Read a few per run.
