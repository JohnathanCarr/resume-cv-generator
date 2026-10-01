// ATS keyword gap check. The match analysis returns the posting's exact ATS
// keywords, each marked core or supporting, whether or not the candidate has
// them; this module finds the core ones the profile does not mention at all
// so the extension can ask the user whether they apply. Supporting terms are
// never asked about: they are mirrored when the candidate has them, but a
// long list of soft skills and passing mentions buries the terms that matter.
// Pure functions, no DOM, no API calls.
//
// Terms the user confirms are appended to profile.skills — the profile stays
// the single source of truth, so the resume prompt's no-fabrication rule still
// holds: the model only ever sees skills the user has vouched for.

// Lower-case, keep the characters that distinguish real terms (c++, c#, .net,
// node.js, ci/cd), collapse everything else to single spaces.
function normalizeTerm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Everything in the profile a keyword could legitimately be found in.
function profileCorpus(profile) {
  const parts = [profile.summary, ...(profile.skills || [])];
  for (const e of profile.education || []) parts.push(e.degreeType, e.major, e.minor, e.honors, e.coursework);
  for (const x of [...(profile.experiences || []), ...(profile.projects || [])]) {
    parts.push(x.title, x.name, x.description, ...(x.bullets || []));
  }
  for (const x of profile.extras || []) parts.push(x.title, x.organization, x.description);
  return ' ' + normalizeTerm(parts.filter(Boolean).join(' ')) + ' ';
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// Whole-term match so "Go" does not match "Google" but "React" matches
// "React Native". Separators between words in the term are already spaces.
function corpusHas(corpus, term) {
  if (!term) return true;
  return new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(term)}([^a-z0-9+#]|$)`).test(corpus);
}

// At most this many terms are asked about per posting.
const MAX_ASKED = 8;

// The match's keyword terms in posting order. Plain strings (matches from
// before keywords carried an importance) count as core.
function keywordTerms(match, { coreOnly = false } = {}) {
  return ((match && match.keywords) || [])
    .map(k => (typeof k === 'string' ? { term: k, importance: 'core' } : k || {}))
    .filter(k => !coreOnly || k.importance === 'core')
    .map(k => String(k.term || '').trim())
    .filter(Boolean);
}

// Core keywords that appear nowhere in the profile, in the posting's wording,
// deduplicated case-insensitively, in posting order, capped at `limit`.
function missingKeywords(match, profile, { limit = MAX_ASKED } = {}) {
  const corpus = profileCorpus(profile);
  const seen = new Set();
  const out = [];
  for (const kw of keywordTerms(match, { coreOnly: true })) {
    const term = normalizeTerm(kw);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    if (!corpusHas(corpus, term)) out.push(kw);
    if (out.length >= limit) break;
  }
  return out;
}

// Adds the accepted keywords to the profile's skills and patches the match so
// downstream prompts see the new evidence: any requirement that names an
// accepted term gains `skill:<term>` and, if it had nothing before, becomes a
// partial match (the user vouched for the skill, not for meeting the bar).
// Returns new objects; the inputs are not mutated.
function applyKeywords(match, profile, accepted) {
  const existing = new Set((profile.skills || []).map(normalizeTerm));
  const added = [];
  for (const kw of accepted || []) {
    const term = normalizeTerm(kw);
    if (!term || existing.has(term)) continue;
    existing.add(term);
    added.push(String(kw).trim());
  }
  const nextProfile = { ...profile, skills: [...(profile.skills || []), ...added] };

  const nextMatch = match && {
    ...match,
    requirements: (match.requirements || []).map(r => {
      const text = normalizeTerm(r.text);
      const hits = added.filter(kw => corpusHas(` ${text} `, normalizeTerm(kw))).map(kw => `skill:${kw}`);
      if (!hits.length) return r;
      const evidence = [...new Set([...(r.evidence || []), ...hits])];
      return { ...r, evidence, strength: r.strength === 'none' ? 'partial' : r.strength };
    })
  };
  return { profile: nextProfile, match: nextMatch, added };
}

export { missingKeywords, applyKeywords, keywordTerms, normalizeTerm, MAX_ASKED };
