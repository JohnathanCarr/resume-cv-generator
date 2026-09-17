// Resume generation prompt and output schema.

'use strict';

const { formatEducation, formatExperiences, formatProjects, formatExtras } = require('./profileText');

// Strict mode requires every property to be listed in `required`; optional
// text fields are typed as string-or-null. The extension's formatResume()
// treats null and empty string the same.
const nullableString = { type: ['string', 'null'] };

const RESUME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'One-line headline for the top of the resume.' },
    skills: { type: 'array', items: { type: 'string' }, description: 'Up to 4 category lines, e.g. "Languages: Go, TypeScript".' },
    education: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          school: { type: 'string' },
          degree: { type: 'string' },
          major: nullableString,
          minor: nullableString,
          location: nullableString,
          dates: nullableString,
          gpa: nullableString,
          honors: nullableString,
          coursework: nullableString
        },
        required: ['school', 'degree', 'major', 'minor', 'location', 'dates', 'gpa', 'honors', 'coursework']
      }
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          dates: nullableString,
          location: nullableString,
          bullets: { type: 'array', items: { type: 'string' } }
        },
        required: ['title', 'company', 'dates', 'location', 'bullets']
      }
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          link: nullableString,
          bullets: { type: 'array', items: { type: 'string' } }
        },
        required: ['name', 'link', 'bullets']
      }
    },
    programs: { type: 'array', items: { type: 'string' }, description: 'Certifications and achievements, one line each. Empty unless the profile lists some.' }
  },
  required: ['summary', 'skills', 'education', 'experience', 'projects', 'programs']
};

const SYSTEM = `You write one-page, ATS-friendly resumes for a specific person applying to a specific job.

Hard rules:
1. Nothing that is not in the profile. No new metrics, tools, employers, dates, responsibilities or outcomes. You may select, reorder, tighten and rephrase the candidate's own bullets; you may not add to them. If a number is not in the profile, the bullet has no number.
2. Applicant tracking systems match literal terms. Where the candidate genuinely has a skill or tool the posting names, use the posting's exact wording for it (and the profile's variant in parentheses if they differ, e.g. "CI/CD (GitHub Actions)"). Never add a term the candidate does not have.
3. Bullets: start with a past-tense action verb (past tense throughout, including the current role — it reads consistently and parses reliably), say what was done and what it produced, one line or two at most, no pronouns.
4. Skills: 3–4 category lines, most relevant to the posting first, using the posting's spelling of each term. Only skills from the profile.
5. Education: every institution in the profile, with the details given. Coursework only if the profile lists it; keep the 3–6 most relevant.
6. Programs/certifications: only what the profile lists under certifications & achievements; otherwise an empty list.
7. Keep to a single U.S. Letter page (≈ 600–750 words). Prefer cutting less relevant bullets over shortening relevant ones.`;

function buildResumeMessages({ profile, jobText, match, matchText }) {
  const roleName = match.role || 'the role';
  const companyName = match.company || 'the company';
  const mustIncludeExperiences = (profile.experiences || []).filter(exp => exp.mustInclude);
  const mustIncludeProjects = (profile.projects || []).filter(proj => proj.mustInclude);

  const user = `Create a targeted, one-page resume for the ${roleName} role at ${companyName}.

Selection:
• Include every experience and project marked mustInclude. Then rank the rest by how many of the posting's requirements they evidence (see the match analysis), then recency.
• Experience: 3–4 bullets per role for relevant roles, 1–2 for less relevant ones. Projects: 2–3 bullets each.
• The summary is one line: the candidate's actual level and specialty in the posting's terms, no adjectives.
• Rewrite bullets to lead with what the posting asks for, but every fact in a bullet must already be in the profile's version of it.

JOB POSTING:
${jobText}

MATCH ANALYSIS (use this to decide what to include and which exact keywords to mirror):
${matchText}

CANDIDATE PROFILE:
Name: ${profile.name}
Location: ${profile.location || 'Not specified'}
Summary (adapt to the role; do not copy verbatim): ${profile.summary || 'None provided'}
Education (one line per institution; include every institution):
${formatEducation(profile)}

Skills: ${profile.skills ? profile.skills.join(', ') : 'None listed'}

Must-Include Experiences: ${mustIncludeExperiences.map(e => `${e.title} at ${e.company}`).join('; ') || 'None'}
Experiences:
${formatExperiences(profile)}

Must-Include Projects: ${mustIncludeProjects.map(p => p.name).join('; ') || 'None'}
Projects:
${formatProjects(profile)}

Certifications & achievements (certifications, awards, research, publications, leadership, volunteering, programs):
${formatExtras(profile)}`;

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user }
  ];
}

module.exports = { buildResumeMessages, RESUME_SCHEMA };
