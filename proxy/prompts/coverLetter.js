// Cover letter generation prompt and output schema.
//
// The letter is grounded three ways: the match analysis says which
// requirements the candidate can honestly speak to; the company brief says
// what may be said about the employer; and every sentence that makes a
// claim must name its source so the server can check it.

'use strict';

const { renderProfileWithIds } = require('./matchAnalysis');

const COVER_LETTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    coverLetter: { type: 'string', description: 'The complete letter as one string. Paragraphs separated by a blank line. No salutation block or signature — just the body paragraphs.' },
    claims: {
      type: 'array',
      description: 'Every sentence that states something about the candidate or the company, with where it came from.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sentence: { type: 'string', description: 'The sentence exactly as it appears in the letter.' },
          source: { type: 'string', description: 'A profile id (exp:3, proj:5, edu:1, extra:6, skill:Go), "job posting", or a URL from the company brief.' }
        },
        required: ['sentence', 'source']
      }
    }
  },
  required: ['coverLetter', 'claims']
};

const SYSTEM = `You write cover letters for a specific person applying to a specific job. The letter must read as if that person wrote it on a good day: plain, direct, concrete, and honest.

Hard rules:
1. Nothing about the candidate that is not in their profile. No new metrics, tools, responsibilities, outcomes, or soft skills. You may rephrase and select; you may not add.
2. Nothing about the company that is not in the company brief or the job posting. If the brief is thin, say less about the company rather than guessing.
3. Only claim requirements the match analysis marks strong or partial, and describe partial ones honestly (related experience, coursework, a project) rather than as full experience.
4. Every sentence that says something about the candidate or the company goes in "claims" with its source. Sentences of pure transition or intent ("I'd like to talk about the role") need no claim.
5. Use the company's full name at least once.
6. The profile is your source, not a subject. Never write "I list", "my profile", "my resume shows", or otherwise refer to the document. Skills are mentioned the way people mention them: "I've worked mostly in Python and SQL", "most of my Kubernetes time has been on upgrades".

Voice — write like these, not like a press release:

  "I've spent the last two years on the payments API at Stripe, mostly on the unglamorous parts: idempotency, retries, and the on-call rotation that follows from getting those wrong. The idempotency layer I built cut duplicate charges by 94%. I'm proud of that number, but I'm prouder that the pager went quiet."

  "Your posting mentions the dashboards should be ones people actually open. That's the part of analytics I care about most. At Boeing I replaced a weekly manual report with a Tableau dashboard; the test I used for whether it worked was whether the ops leads stopped asking me for the numbers. They did."

Notice: short and long sentences mixed, specific nouns, first person, one idea per paragraph, no adjectives doing the work of evidence, and nothing the reader would have to take on faith.

Avoid: buzzwords (passionate, leverage, synergy, dynamic, robust, seamless, spearheaded, impactful, results-driven, cutting-edge), consultant framing (multiplier, unlock value, competitive advantage, inflection point, operating rhythm), stacked triples ("fast, reliable, and scalable"), rhetorical questions, "I am writing to express", "I am excited to", "I believe I would be", and any sentence that could be pasted into a letter for a different company.`;

function buildCoverLetterMessages({ profile, jobText, match, matchText, briefText }) {
  const roleName = match.role || 'the role';
  const companyName = match.company || 'the company (unnamed in the posting)';

  const user = `Write a cover letter from ${profile.name} for the ${roleName} position at ${companyName}.

Shape:
- About 300 words (never under 250 or over 350), three or four paragraphs, body only (no address block, greeting, or sign-off).
- Paragraph 1: which role, and one specific reason this company or this problem — drawn from the brief or the posting. Not a compliment; a reason.
- Middle paragraph(s): two or three of the posting's requirements that the candidate genuinely meets, each backed by a concrete example from the profile. Where the match is partial, say what the actual experience is.
- Last paragraph: what the candidate would want to work on first, and a plain ask for a conversation. No "doing you a favor" posture, no hard sell.

The posting's exact wording matters to screening software: where the candidate genuinely has a listed skill or tool, use the posting's term for it.

JOB POSTING:
${jobText}

MATCH ANALYSIS:
${matchText}

COMPANY BRIEF:
${briefText}

CANDIDATE PROFILE (cite these ids in claims):
${renderProfileWithIds(profile)}`;

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user }
  ];
}

// Which sources a claim may cite. Profile ids, "job posting", and any URL that
// appears in the brief.
function allowedSources(profile, brief) {
  const ids = new Set(['job posting']);
  for (const e of profile.education || []) ids.add(`edu:${e.id}`);
  for (const x of profile.experiences || []) ids.add(`exp:${x.id}`);
  for (const p of profile.projects || []) ids.add(`proj:${p.id}`);
  for (const x of profile.extras || []) ids.add(`extra:${x.id}`);
  for (const s of profile.skills || []) ids.add(`skill:${s}`);
  const urls = new Set();
  for (const key of ['what_they_care_about', 'current_priorities', 'challenges_or_context']) {
    for (const it of (brief && brief[key]) || []) if (it.source_url) urls.add(it.source_url);
  }
  return { ids, urls };
}

function normaliseSource(s) {
  return String(s || '').trim().toLowerCase().replace(/\/$/, '');
}

// Returns the claims whose source is not something we can trace.
function unsourcedClaims(claims, profile, brief) {
  const { ids, urls } = allowedSources(profile, brief);
  const idSet = new Set([...ids].map(normaliseSource));
  const urlSet = new Set([...urls].map(normaliseSource));
  const bad = [];
  for (const c of claims || []) {
    const parts = String(c.source || '').split(/\s*[,;]\s*/).map(normaliseSource).filter(Boolean);
    if (!parts.length) { bad.push(c); continue; }
    const ok = parts.every(p => idSet.has(p) || urlSet.has(p) || p === 'job posting');
    if (!ok) bad.push(c);
  }
  return bad;
}

module.exports = { buildCoverLetterMessages, COVER_LETTER_SCHEMA, unsourcedClaims };
