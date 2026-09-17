// Model configuration. One generation model, pinned; change it here only.
//
// gpt-5.6-terra is the mid-tier of the current family: strict JSON schema
// output, image input (needed for the Phase 2 layout-from-PDF work), and
// reasoning_effort in place of temperature (GPT-5 models reject temperature
// and use max_completion_tokens rather than max_tokens).
module.exports = {
  GENERATION_MODEL: 'gpt-5.6-terra',
  // Cheapest sibling, used only to confirm a key works.
  VERIFY_MODEL: 'gpt-5.6-luna',
  // Per-call reasoning budgets. Extraction is mechanical; writing benefits
  // from a little deliberation.
  REASONING: {
    verify: 'none',
    extract: 'low',
    generate: 'medium'
  },
  // Output caps (completion tokens, reasoning included).
  MAX_COMPLETION_TOKENS: {
    verify: 16,
    resume: 6000,
    coverLetter: 4000
  },
  // Company research via the hosted web-search tool (cover letters only).
  // Each search is billed separately and its results count as input tokens,
  // so the cap and context size are the main cost levers.
  RESEARCH: {
    maxSearches: 3,
    searchContextSize: 'low',
    // Briefs are cached by the extension for this long.
    cacheDays: 30
  }
};
