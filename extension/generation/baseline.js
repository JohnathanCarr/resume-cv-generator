// The baseline resume: a frozen snapshot of what the user's uploaded resume
// parsed to. Generation edits this document for each posting; the profile is
// only the pool of extra material it may swap in. Re-uploading replaces it;
// editing the profile does not touch it.
//
// Pure functions, no DOM: the extension stores the snapshot under the
// `baselineResume` storage key, and the same code runs under Node for tests.

// Bump when the parser or the snapshot shape changes; the extension re-parses
// the stored PDF into a fresh snapshot when the stored version is older.
const BASELINE_VERSION = 1;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Stable ids by section and position (exp:1, proj:2, edu:1, extra:3). The
// snapshot is frozen, so positions never shift; bullets are addressed by
// index within their entry.
function withIds(list, prefix) {
  return (Array.isArray(list) ? list : []).map((item, i) => ({ ...item, id: `${prefix}:${i + 1}` }));
}

// parsed: the `profile` returned by ResumeParser.parse().
// source: { name, uploadedAt } of the uploaded PDF the snapshot came from.
function createBaseline(parsed, source = {}) {
  const p = parsed || {};
  return {
    version: BASELINE_VERSION,
    source: { name: str(source.name), uploadedAt: source.uploadedAt || null },
    createdAt: new Date().toISOString(),
    resume: {
      name: str(p.name),
      contact: str(p.contact),
      location: str(p.location),
      summary: str(p.summary),
      skills: (p.skills || []).map(str).filter(Boolean),
      education: withIds(p.education, 'edu'),
      experiences: withIds(p.experiences, 'exp').map(e => ({ ...e, bullets: (e.bullets || []).map(str).filter(Boolean) })),
      projects: withIds(p.projects, 'proj').map(e => ({ ...e, bullets: (e.bullets || []).map(str).filter(Boolean) })),
      extras: withIds(p.extras, 'extra')
    }
  };
}

// A stored snapshot is usable when it has the current version and any content.
function isCurrentBaseline(baseline) {
  return Boolean(baseline && baseline.version === BASELINE_VERSION && baseline.resume);
}

function hasSummary(baseline) {
  return Boolean(str(baseline?.resume?.summary));
}

const dates = (e) => [str(e.start), str(e.end)].filter(Boolean).join(' - ') || null;

// The snapshot in the generator's RESUME_SCHEMA shape, so it can be passed as
// `baseResume` (the CURRENT RESUME the model revises). summary is null when
// the uploaded resume has none, which tells the model not to write one.
function baselineToResume(baseline) {
  const r = baseline?.resume || {};
  const extraLine = (x) => [str(x.title), str(x.organization)].filter(Boolean).join(' – ')
    + (dates(x) ? ` (${dates(x)})` : '')
    + (str(x.description) ? `: ${str(x.description)}` : '');
  return {
    summary: str(r.summary) || null,
    skills: (r.skills || []).length ? [`Skills: ${r.skills.join(', ')}`] : [],
    education: (r.education || []).map(e => ({
      school: str(e.institution),
      degree: str(e.degreeType),
      major: str(e.major) || null,
      minor: str(e.minor) || null,
      location: str(e.location) || null,
      dates: dates(e),
      gpa: str(e.gpa) || null,
      honors: str(e.honors) || null,
      coursework: str(e.coursework) || null
    })),
    experience: (r.experiences || []).map(e => ({
      title: str(e.title),
      company: str(e.company),
      dates: dates(e),
      location: str(e.location) || null,
      bullets: e.bullets || []
    })),
    projects: (r.projects || []).map(p => ({ name: str(p.name), link: str(p.link) || null, bullets: p.bullets || [] })),
    programs: (r.extras || []).map(extraLine).filter(Boolean)
  };
}

export { BASELINE_VERSION, createBaseline, isCurrentBaseline, hasSummary, baselineToResume };
