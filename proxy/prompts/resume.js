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

const SYSTEM = `You are a resume writer who creates truthful, concise, ATS-friendly
one-page resumes. Do NOT fabricate experiences, programs, or certifications.
Only use or lightly rephrase what is provided in the profile or job text.
Prefer measurable impact, clear verbs, and job-relevant keywords. Keep the
final result to a single U.S. Letter page when rendered with a typical resume
template (≈ 600–750 words total).`;

function buildResumeMessages({ profile, jobText, match, matchText }) {
  const roleName = match.role || 'the role';
  const companyName = match.company || 'the company';
  const mustIncludeExperiences = (profile.experiences || []).filter(exp => exp.mustInclude);
  const mustIncludeProjects = (profile.projects || []).filter(proj => proj.mustInclude);

  const user = `Create a targeted, one-page resume for the ${roleName} role at ${companyName}.
Strict rules:
• Do NOT invent or hallucinate content (programs, certs, jobs). If data is missing, omit the section.
• Keep to a single page worth of content (≈ 600–750 words max).
• Section order for new grads: Header → Skills → Education → Experience → Projects → (optional) Programs/Certifications.
• Bullet counts (upper bounds): Experience 3–4 bullets per role; Projects 2–3 bullets per project.
• Bullet length: ~12–22 words; be specific and outcome-oriented.
• Skills: 3–4 category lines max (Languages, Frameworks/Libs, Data/Databases, Cloud/DevOps/Tools).
• Education: keep accurate (degree, school, location, dates, GPA if provided); include 3–6 relevant courses if available.
• Programs/Certifications: include ONLY if provided in profile; otherwise leave the list empty.

Prioritize: “mustInclude” experiences/projects → role relevance → recency → quantified impact.

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
