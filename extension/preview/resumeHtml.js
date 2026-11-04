// Resume HTML, pure (no DOM): the same markup is shown in the preview,
// measured for the one-page limit and printed, always inside the page
// document of pageDoc.js, so all styling is inline. Sizes come from
// template.js, which layout.js also reads. data-kind marks the line kinds
// layout.js measures.
//
// Escaping contract: text inside resumeContent must already be HTML-escaped
// (highlight.js output, or escapeResume() for raw data); the profile's own
// fields (name, contact line, education fallback) are escaped here. Profile
// text and model output can hold markup: a pasted posting can steer what the
// model returns.

import { TEMPLATE } from './template.js';

export function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// A copy of resume data (or its JSON text) with every string escaped, for
// formatResume().
export function escapeResume(value) {
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { return escapeHTML(value); }
    }
    const walk = (v) => typeof v === 'string' ? escapeHTML(v)
        : Array.isArray(v) ? v.map(walk)
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
        : v;
    return walk(value);
}

// resumeContent: resume data in formatResume's shape (or its JSON text),
// already escaped. profile: the user's profile, for the header and the
// education fallback.
export function formatResume(resumeContent, profile) {
    // Parse the JSON resume content
    let resume;
    let eduList = [];
    try {
        resume = typeof resumeContent === 'string' ? JSON.parse(resumeContent) : resumeContent;

        // Normalize education to a list of entries with consistent keys. The
        // model may return an array or a single object; fall back to the
        // profile's own entries when it returns nothing.
        const fromModel = Array.isArray(resume.education)
            ? resume.education
            : (resume.education ? [resume.education] : []);
        const source = fromModel.length ? fromModel : escapeResume(profile.education || []);
        eduList = source.map(e => ({
            school: e.school || e.university || e.institution || '',
            location: e.location || '',
            dates: formatDates(e.dates || e.graduation || (e.start && e.end ? `${e.start} - ${e.end}` : e.end || '')),
            degree: e.degree || e.degreeType || '',
            major: e.major || '',
            minor: e.minor || '',
            gpa: e.gpa || '',
            honors: e.honors || '',
            coursework: e.coursework || ''
        })).filter(e => e.school || e.degree);
    } catch (error) {
        console.error('Error parsing resume content:', error);
        return `<p style="color: red;">Error formatting resume content</p>`;
    }


    const T = TEMPLATE;
    const px = (n) => `${n}pt`;
    // A heading from STANDARD_HEADINGS; uppercase is only how it looks.
    const heading = (text) => `<h2 style="margin: 0 0 ${px(T.headingGapPt)} 0; font-size: ${px(T.headingPt)}; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3pt; border-bottom: 0.75pt solid #000; padding-bottom: 1pt;">${text}</h2>`;
    const section = (text, body) => `<div class="resume-section" style="margin-bottom: ${px(T.sectionGapPt)};">${heading(text)}${body}</div>`;
    // Left text and right text on one line (company and dates, title and place).
    const row = (left, right, style) => `<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12pt; font-size: ${px(T.entryPt)}; ${style}"><span>${left}</span>${right ? `<span style="white-space: nowrap;">${right}</span>` : ''}</div>`;
    const bullets = (items, kind = 'bullet') => items.length ? `<ul style="margin: 0; padding-left: ${T.bulletIndentEm}em; font-size: ${px(T.bodyPt)};">${items.map(b => `<li data-kind="${kind}" style="margin-bottom: ${px(T.bulletGapPt)};">${b}</li>`).join('')}</ul>` : '';
    const entry = (cls, inner) => `<div class="${cls}" style="margin-bottom: ${px(T.entryGapPt)};">${inner}</div>`;

    const sections = {
        education: eduList.length ? section('Education', eduList.map(edu => {
            const degree = [edu.degree, edu.major, edu.minor ? `Minor in ${edu.minor}` : ''].filter(Boolean).join(', ');
            const details = [
                edu.gpa ? `<strong>GPA:</strong> ${edu.gpa}` : '',
                edu.honors ? `<strong>Honors:</strong> ${edu.honors}` : ''
            ].filter(Boolean);
            return entry('education-entry',
                row(`<strong>${edu.school}</strong>`, `<strong>${edu.dates}</strong>`, '')
                + (degree || edu.location ? row(`<em>${degree}</em>`, edu.location ? `<em>${edu.location}</em>` : '', '') : '')
                + bullets(details, 'extra')
                + (edu.coursework ? bullets([`<strong>Coursework:</strong> ${edu.coursework}`], 'coursework') : ''));
        }).join('')) : '',

        experience: (resume.experience || []).length ? section('Experience', resume.experience.map(exp => entry('experience-entry',
            row(`<strong>${cleanEmpty(exp.company)}</strong>`, `<strong>${formatDates(exp.dates)}</strong>`, '')
            + row(`<em>${cleanEmpty(exp.title)}</em>`, exp.location ? `<em>${cleanEmpty(exp.location)}</em>` : '', '')
            + bullets(exp.bullets || [])
        )).join('')) : '',

        projects: (resume.projects || []).length ? section('Projects', resume.projects.map(proj => {
            const { title, dates } = projectHeader(proj.name);
            // A link whose text is just the project's name adds nothing.
            const plain = (t) => String(t).replace(/<[^>]+>/g, '').toLowerCase().trim();
            const link = proj.link && !String(proj.name).split(/\s+\|\s+/).map(plain).includes(plain(proj.link)) ? `<div style="font-size: ${px(T.contactPt)};">${proj.link}</div>` : '';
            return entry('project-entry',
                `<div data-kind="projectHeader" style="display: flex; justify-content: space-between; align-items: baseline; gap: 12pt; font-size: ${px(T.entryPt)}; font-weight: bold;"><span>${title}</span>${dates ? `<span style="white-space: nowrap;">${formatDates(dates)}</span>` : ''}</div>`
                + link + bullets(proj.bullets || []));
        }).join('')) : '',

        extras: ((resume.programs || []).length || (resume.certifications || []).length)
            ? section(extrasHeading(resume), bullets([...(resume.programs || []), ...(resume.certifications || [])], 'extra'))
            : ''
    };
    const order = Array.isArray(resume.sectionOrder) && resume.sectionOrder.length
        ? resume.sectionOrder.filter(k => sections[k] !== undefined)
        : ['education', 'experience', 'projects', 'extras'];

    const formatted = `
        <div class="resume-page" style="
            font-family: ${T.font};
            color: #000;
            line-height: ${T.lineHeight};
            font-variant-ligatures: none;
            width: ${T.pageWidthIn}in;
            margin: 0 auto;
            padding: ${T.marginIn}in;
            background: white;
            min-height: 10.5in;
            box-sizing: border-box;
        ">
            <div class="resume-header" style="text-align: center; margin-bottom: ${px(T.sectionGapPt)};">
                <h1 style="margin: 0 0 2pt 0; font-size: ${px(T.namePt)}; font-weight: bold;">${escapeHTML(profile.name)}</h1>
                <div style="margin: 0; font-size: ${px(T.contactPt)};">${formatContactLine(profile)}</div>
            </div>
            ${resume.summary ? section('Summary', `<p data-kind="summary" style="margin: 0; font-size: ${px(T.bodyPt)};">${resume.summary}</p>`) : ''}
            ${(resume.skills || []).length ? section('Skills', `<div style="font-size: ${px(T.bodyPt)};">${formatSkills(resume.skills)}</div>`) : ''}
            ${order.map(k => sections[k]).join('')}
        </div>
    `;

    return formatted;
}

// Empty brackets a profile field can carry ("Acme Corp ( )") are dropped.
function cleanEmpty(text) {
    return String(text || '').replace(/\s*\(\s*\)/g, '').trim();
}

// A project header from "Name | stack | link text | dates": repeats of the
// name are dropped and a trailing date range moves to the right edge.
export function projectHeader(name) {
    const parts = String(name || '').split(/\s+\|\s+/).map(cleanEmpty).filter(Boolean);
    const plain = (t) => t.replace(/<[^>]+>/g, '').toLowerCase().trim();
    const seen = new Set();
    const kept = parts.filter(p => { const k = plain(p); if (seen.has(k)) return false; seen.add(k); return true; });
    let dates = '';
    if (kept.length > 1 && /\b(19|20)\d{2}\b|\bpresent\b/i.test(plain(kept[kept.length - 1])) && plain(kept[kept.length - 1]).length <= 24) dates = kept.pop();
    return { title: kept.join(' | '), dates };
}

// "Location | email | phone | linkedin.com/in/… | …", escaped. Links stay
// visible text (parsers read the text, not link targets); only the scheme and
// "www." are dropped.
export function formatContactLine(profile) {
    const contactParts = [];
    
    // Add location first if available
    if (profile.location && profile.location.trim()) {
        contactParts.push(profile.location.trim());
    }
    
    // Parse contact information
    const lines = profile.contact.split('\n');
    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed && trimmed !== 'undefined' && trimmed !== 'null') {
            if (trimmed.includes('@')) {
                contactParts.push(trimmed); // Email
            } else if (trimmed.match(/\d{3}.*\d{3}.*\d{4}/)) {
                contactParts.push(trimmed); // Phone
            } else if (/^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) {
                contactParts.push(trimmed.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, ''));
            } else if (trimmed.length > 0) {
                contactParts.push(trimmed);
            }
        }
    });
    
    // Filter out any empty or invalid parts
    const validParts = contactParts.filter(part => 
        part && part.trim() && part !== 'undefined' && part !== 'null'
    );
    
    return validParts.map(part => escapeHTML(part)).join(' | ');
}

// One line per skill group ("Languages: Go, Rust"), or one "Technical
// Skills" line for an ungrouped list.
export function formatSkills(skills) {
    // Format skills as comprehensive grouped lines like the sample
    if (Array.isArray(skills) && skills.length > 0 && typeof skills[0] === 'string' && skills[0].includes(':')) {
        // Skills already come grouped from API
        // Split at the first colon only: items may carry markup (preview
        // highlights with a title) that contains colons of its own.
        return skills.map(skillLine => {
            const at = skillLine.indexOf(':');
            return `<p data-kind="skills" style="margin: 0 0 1pt 0;"><strong>${skillLine.slice(0, at)}:</strong> ${skillLine.slice(at + 1).trim()}</p>`;
        }).join('');
    } else {
        // Fallback: group skills manually
        return `<p data-kind="skills" style="margin: 0;"><strong>Technical Skills:</strong> ${skills.join(', ')}</p>`;
    }
}

// The extras section's heading, from a vocabulary ATS parsers recognise: one
// type's standard name, or "Additional Information" for a mix. Older entries
// without types fall back on which list they carry.
const EXTRA_HEADINGS = {
    certification: 'Certifications',
    license: 'Licenses',
    award: 'Awards',
    publication: 'Publications',
    research: 'Research',
    leadership: 'Leadership',
    volunteer: 'Volunteer Experience',
    program: 'Programs'
};

export function extrasHeading(resume) {
    const types = [...new Set(resume.extraTypes || [])];
    if (types.length === 1 && EXTRA_HEADINGS[types[0]]) return EXTRA_HEADINGS[types[0]];
    if (types.length === 2 && types.includes('license') && types.includes('certification')) return 'Licenses & Certifications';
    if (!types.length && resume.certifications?.length && !resume.programs?.length) return 'Certifications';
    return 'Additional Information';
}

const DATE_LIKE = /^(\d{4}|present|current|now|ongoing|[A-Za-z]{3,9}\.?,?\s+\d{4}|\d{1,2}\/\d{4})$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// One date: "May 2022" / "May. 2022" / "September 2022" / "05/2022" → "May 2022";
// "2022" stays a year; "Present", "Current" and "Now" → "Present". Anything
// else comes back as written, so a month is never invented or lost.
function formatDate(text) {
    const t = String(text || '').trim();
    if (/^(present|current|now|ongoing)$/i.test(t)) return 'Present';
    if (/^\d{4}$/.test(t)) return t;
    let m = t.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
    if (m) {
        const i = MONTHS.findIndex(mon => m[1].toLowerCase().startsWith(mon.toLowerCase()));
        const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const word = m[1].toLowerCase();
        if (i >= 0 && (word.length === 3 || word === 'sept' || full[i] === word)) return `${MONTHS[i]} ${m[2]}`;
        return t;
    }
    m = t.match(/^(\d{1,2})\/(\d{4})$/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return `${MONTHS[+m[1] - 1]} ${m[2]}`;
    return t;
}

// A date or range in one style: "Mar 2022 – Present", "2018 – 2022". The
// range separator becomes a spaced en dash; unreadable text is kept as is.
export function formatDates(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    let parts = t.split(/\s+(?:-|–|—|to)\s+|\s*[–—]\s*/i);
    if (parts.length === 1) {
        // An unspaced hyphen is a range only between two dates ("2022-Present",
        // "Jun 2023-Aug 2023"), never inside one ("03-2022").
        const halves = t.split(/(?<=\d)-(?=[A-Za-z0-9])/);
        if (halves.length === 2 && halves.every(h => DATE_LIKE.test(h.trim()))) parts = halves;
    }
    if (parts.length > 2) return t;
    return parts.map(formatDate).join(' – ');
}
