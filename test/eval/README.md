# Prompt evals

Runs the generation endpoints over a small set of profiles × job postings and
scores each output against a fixed rubric, so prompt changes can be compared.

```bash
node test/eval/run.js --label my-change            # everything (≈30 docs, ~$1)
node test/eval/run.js --profiles david --jobs 02   # one pair, quick check
node test/eval/run.js --only cover --label x       # one document type
node test/eval/run.js --label x --baseline         # also copy the summary to baselines/
node test/eval/run.js --rescore test/eval/runs/<dir>  # re-apply a changed rubric to saved outputs (no API calls)
```

The pipeline (`extension/generation/`) runs in-process; no server is needed.
The key comes from `OPENAI_API_KEY` or `test/eval/.env`. Full outputs land in
`runs/<timestamp>-<label>/` (gitignored); `baselines/` holds committed
summaries to compare against.

- `profiles/` — synthetic profiles (committed) and `profiles/local/` for real ones (gitignored)
- `jobs/` — postings; line 2 is `Company · Location`, which `run.js` uses to know the company
- `score.js` — the rubric. Resume: shape, sections, word budget and page fill,
  bullet length, education completeness, mustInclude honoured, no fabricated
  numbers, JD keyword coverage, action-verb bullets. Cover letter: length,
  paragraphs, names the company, buzzword and AI-tell lints, no fabricated
  numbers, grounded in ≥2 profile items, sentence variety, em-dash restraint,
  JD keyword coverage.

What the rubric cannot check: whether company facts in a cover letter are
true. Read a few per run.
