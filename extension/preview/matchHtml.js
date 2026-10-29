// The match report beside the resume preview: how the posting's requirements,
// screening requirements and key keywords line up with the profile, from the
// match analysis (generation/matchAnalysis.js) and the result's keyword
// coverage. It reports what the posting asks for and where the profile shows
// it; it never claims an "ATS score" or a pass. Pure, no DOM; every string
// from the posting, the model or the profile is escaped.

import { escapeHTML } from './resumeHtml.js';
import { corpusHas, profileCorpus, normalizeTerm } from '../generation/keywords.js';

const STRENGTH = {
    strong: ['✓', 'Shown', 'match-yes'],
    partial: ['◐', 'Partly shown', 'match-partial'],
    none: ['✗', 'Not in your profile', 'match-no']
};
const MET = {
    yes: ['✓', 'Met', 'match-yes'],
    no: ['✗', 'Not met', 'match-no'],
    unknown: ['?', 'Not in your profile', 'match-unknown']
};
const HARD_HINT = {
    work_authorization: 'Work authorization',
    sponsorship: 'Work authorization',
    clearance: 'Security clearance',
    license: 'Extras → License',
    certification: 'Extras → Certification'
};

// A readable name for an evidence id: "Software Engineer II, Stripe".
export function evidenceName(id, profile) {
    const [kind, ...rest] = String(id).trim().replace(/^\[\s*|\s*\]$/g, '').split(':');
    const ref = rest.join(':');
    const find = (list) => (list || []).find(x => String(x.id) === ref);
    if (kind === 'skill') return ref;
    if (kind === 'profile') return { location: 'Location', workauthorization: 'Work authorization', clearance: 'Security clearance', summary: 'Summary' }[ref.toLowerCase()] || ref;
    if (kind === 'exp') { const x = find(profile.experiences); return x ? [x.title, x.company].filter(Boolean).join(', ') : ''; }
    if (kind === 'proj') return find(profile.projects)?.name || '';
    if (kind === 'edu') { const x = find(profile.education); return x ? [x.degreeType, x.institution].filter(Boolean).join(', ') : ''; }
    if (kind === 'extra') return find(profile.extras)?.title || '';
    return '';
}

const status = ([icon, label, cls]) =>
    `<span class="match-status ${cls}" title="${label}"><span aria-hidden="true">${icon}</span><span class="sr-only">${label}</span></span>`;

function evidenceList(ids, profile) {
    const names = [...new Set((ids || []).map(id => evidenceName(id, profile)).filter(Boolean))];
    return names.length ? `<span class="match-evidence">${names.map(escapeHTML).join(' · ')}</span>` : '';
}

// match: the match analysis; coverage: metadata.coverage ({ before, after }).
// Returns '' when there is nothing to report.
export function formatMatchReport(match, profile, coverage = null) {
    if (!match) return '';
    const p = profile || {};
    const reqs = (match.requirements || []).filter(r => r && r.text);
    const hard = (match.hard_requirements || []).filter(h => h && h.text);
    const after = coverage?.after;
    const coreKw = (match.keywords || []).filter(k => k && (typeof k === 'string' || k.importance === 'core')).map(k => (typeof k === 'string' ? { term: k, alias: '' } : k));
    const core = coreKw.map(k => k.term);
    const missing = new Set(after?.missing || []);
    const corpus = profileCorpus(p);
    const inProfile = (k) => corpusHas(corpus, normalizeTerm(k.term)) || (!!k.alias && corpusHas(corpus, normalizeTerm(k.alias)));
    const onResume = core.filter(t => !missing.has(t));
    const left = coreKw.filter(k => missing.has(k.term) && inProfile(k)).map(k => k.term);
    const gaps = coreKw.filter(k => missing.has(k.term) && !inProfile(k)).map(k => k.term);

    const required = reqs.filter(r => r.kind === 'required');
    const shown = required.filter(r => r.strength !== 'none').length;
    const summaryParts = [];
    if (required.length) summaryParts.push(`${shown} of ${required.length} required qualifications shown`);
    if (core.length) summaryParts.push(`${onResume.length} of ${core.length} key keywords`);
    const unmetHard = hard.filter(h => h.met !== 'yes').length;
    if (unmetHard) summaryParts.push(`${unmetHard} screening question${unmetHard === 1 ? '' : 's'} to check`);

    const reqRows = (list) => list.map(r => `
        <li>${status(STRENGTH[r.strength] || STRENGTH.none)}<span class="match-text">${escapeHTML(r.text)}</span>${evidenceList(r.evidence, p)}</li>`).join('');
    const sections = [];
    if (hard.length) {
        sections.push(`
        <h3>Screening requirements</h3>
        <ul class="match-list">${hard.map(h => {
            const hint = h.met === 'unknown' && HARD_HINT[h.type] ? `<span class="match-hint">If it applies to you, add it in your profile (${HARD_HINT[h.type]}).</span>` : '';
            return `
            <li>${status(MET[h.met] || MET.unknown)}<span class="match-text">${escapeHTML(h.text)}</span>${evidenceList(h.evidence, p)}${hint}</li>`;
        }).join('')}
        </ul>`);
    }
    if (required.length) sections.push(`<h3>Required</h3><ul class="match-list">${reqRows(required)}</ul>`);
    const preferred = reqs.filter(r => r.kind !== 'required');
    if (preferred.length) sections.push(`<h3>Preferred</h3><ul class="match-list">${reqRows(preferred)}</ul>`);
    if (core.length) {
        sections.push(`
        <h3>Key keywords</h3>
        ${onResume.length ? `<p class="match-chips"><span class="match-chips-label">On your resume:</span> ${onResume.map(t => `<span class="match-chip match-yes">${escapeHTML(t)}</span>`).join(' ')}</p>` : ''}
        ${left.length ? `<p class="match-chips"><span class="match-chips-label">In your profile, not on this page:</span> ${left.map(t => `<span class="match-chip match-partial">${escapeHTML(t)}</span>`).join(' ')}</p>` : ''}
        ${gaps.length ? `<p class="match-chips"><span class="match-chips-label">Not in your profile:</span> ${gaps.map(t => `<span class="match-chip match-no">${escapeHTML(t)}</span>`).join(' ')}</p>
        <p class="match-hint">Gaps are never added for you. If you do have one, add it to your profile and generate again.</p>` : ''}`);
    }
    if (!sections.length) return '';
    return `
    <details class="match-report">
        <summary>How this resume matches the posting${summaryParts.length ? `: <span class="match-summary">${summaryParts.join(' · ')}</span>` : ''}</summary>
        <div class="match-body">${sections.join('')}</div>
    </details>`;
}
