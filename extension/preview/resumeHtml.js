// Resume HTML, pure (no DOM): the same markup is shown in the preview,
// measured off-screen for the one-page limit, and copied into print.html for
// the PDF, which does not load styles.css, so all styling is inline with
// hardcoded pt sizes. data-kind marks the line kinds layout.js measures.
//
// Escaping contract: text inside resumeContent must already be HTML-escaped
// (highlight.js output, or escapeResume() for raw data); the profile's own
// fields (name, contact line, education fallback) are escaped here. Profile
// text and model output can hold markup: a pasted posting can steer what the
// model returns.

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


    // Single-source rendering with exact measurements for pixel-perfect preview/PDF match
    const baseFont = "'Times New Roman', serif";
    const headerFontSize = "18pt";
    const contactFontSize = "11pt";
    const sectionHeaderSize = "11pt";
    const bodyFontSize = "10pt";
    const lineHeight = "1.25";
    const sectionSpacing = "0.8em";
    const entrySpacing = "0.6em";

    // Sections after the summary and skills, in the resume's chosen order
    // (composed resumes choose; everything else keeps education first).
    const sections = {
        education: `
            <!-- Education Section -->
            ${eduList.length > 0 ? `
            <div class="resume-section" style="margin-bottom: ${sectionSpacing};">
            <h2 style="
                margin: 0 0 0.4em 0;
                font-size: ${sectionHeaderSize};
                font-weight: bold;
                text-transform: uppercase;
                border-bottom: 1pt solid #000;
                padding-bottom: 2pt;
            ">Education</h2>
            ${eduList.map(edu => `
            <div class="education-entry" style="margin-bottom: ${entrySpacing};">
                <div style="display: flex; justify-content: space-between; align-items: baseline;">
                    <span style="font-size: ${contactFontSize}; font-weight: bold;">
                    ${edu.school}${edu.location ? ` – ${edu.location}` : ''}
                    </span>
                    <span style="font-size: ${contactFontSize};">
                    ${edu.dates}
                    </span>
                </div>
                ${edu.degree ? `<div style="font-size: ${contactFontSize}; font-style: italic; margin: 0.1em 0;">${edu.degree}</div>` : ''}
                ${edu.major ? `<div style="font-size: ${contactFontSize}; font-weight: bold;">Major: ${edu.major}</div>` : ''}
                ${edu.minor ? `<div style="font-size: ${contactFontSize}; font-weight: bold;">Minor: ${edu.minor}</div>` : ''}
                ${edu.gpa ? `<div style="font-size: ${contactFontSize}; margin: 0.2em 0 0 0;">GPA: ${edu.gpa}</div>` : ''}
                ${(edu.honors || edu.coursework) ? `
                <div data-kind="coursework" style="font-size: ${bodyFontSize}; margin: 0.3em 0 0 0;">
                    ${edu.honors ? `• ${edu.honors}<br>` : ''}
                    ${edu.coursework ? `• Relevant Coursework: ${edu.coursework}` : ''}
                </div>` : ''}
            </div>`).join('')}
            </div>` : ''}
`,
        experience: `
            <!-- Experience Section -->
            ${resume.experience && resume.experience.length > 0 ? `
            <div class="resume-section" style="margin-bottom: ${sectionSpacing};">
                <h2 style="
                    margin: 0 0 0.4em 0;
                    font-size: ${sectionHeaderSize};
                    font-weight: bold;
                    text-transform: uppercase;
                    border-bottom: 1pt solid #000;
                    padding-bottom: 2pt;
                ">Experience</h2>
                ${resume.experience.map(exp => `
                    <div class="experience-entry" style="margin-bottom: ${entrySpacing};">
                        <div style="display: flex; justify-content: space-between; align-items: baseline;">
                            <span style="font-size: ${contactFontSize}; font-weight: bold;">
                                ${exp.company}${exp.location ? ` – ${exp.location}` : ''}
                            </span>
                            <span style="font-size: ${contactFontSize};">
                                ${formatDates(exp.dates)}
                            </span>
                        </div>
                        <div style="font-size: ${contactFontSize}; font-style: italic; margin: 0.1em 0 0.2em 0;">
                            ${exp.title}
                        </div>
                        <ul style="
                            margin: 0;
                            padding-left: 1.2em;
                            font-size: ${bodyFontSize};
                            line-height: ${lineHeight};
                        ">
                            ${exp.bullets.map(bullet => `<li data-kind="bullet" style="margin-bottom: 0.1em;">${bullet}</li>`).join('')}
                        </ul>
                    </div>
                `).join('')}
            </div>` : ''}
`,
        projects: `
            <!-- Projects Section -->
            ${resume.projects && resume.projects.length > 0 ? `
            <div class="resume-section" style="margin-bottom: ${sectionSpacing};">
                <h2 style="
                    margin: 0 0 0.4em 0;
                    font-size: ${sectionHeaderSize};
                    font-weight: bold;
                    text-transform: uppercase;
                    border-bottom: 1pt solid #000;
                    padding-bottom: 2pt;
                ">Projects</h2>
                ${resume.projects.map(proj => `
                    <div class="project-entry" style="margin-bottom: ${entrySpacing};">
                        <div data-kind="projectHeader" style="font-size: ${contactFontSize}; font-weight: bold; margin-bottom: 0.1em;">
                            ${proj.name}${proj.link ? ` | ${proj.link}` : ''}
                        </div>
                        <ul style="
                            margin: 0;
                            padding-left: 1.2em;
                            font-size: ${bodyFontSize};
                            line-height: ${lineHeight};
                        ">
                            ${proj.bullets.map(bullet => `<li data-kind="bullet" style="margin-bottom: 0.1em;">${bullet}</li>`).join('')}
                        </ul>
                    </div>
                `).join('')}
            </div>` : ''}
`,
        extras: `
                                ${
                (
                    (resume.programs && resume.programs.length > 0) ||
                    (resume.certifications && resume.certifications.length > 0)
                ) ? `
                    <!-- Programs/Certifications Section -->
                    <div class="resume-section">
                    <h2 style="
                        margin: 0 0 0.4em 0;
                        font-size: ${sectionHeaderSize};
                        font-weight: bold;
                        text-transform: uppercase;
                        border-bottom: 1pt solid #000;
                        padding-bottom: 2pt;
                    ">${extrasHeading(resume)}</h2>
                    ${[...(resume.programs || []), ...(resume.certifications || [])].map(line => `
                    <div data-kind="extra" style="font-size: ${bodyFontSize}; margin-bottom: 0.2em; line-height: 1.3;">${line}</div>`).join('')}
                    </div>
                ` : ''
                }
`
    };
    const order = Array.isArray(resume.sectionOrder) && resume.sectionOrder.length
        ? resume.sectionOrder.filter(k => sections[k] !== undefined)
        : ['education', 'experience', 'projects', 'extras'];

    let formatted = `
        <div class="resume-page" style="
            font-family: ${baseFont};
            color: #000;
            line-height: ${lineHeight};
            font-variant-ligatures: none;
            max-width: 7.5in;
            margin: 0 auto;
            padding: 0.5in;
            background: white;
            min-height: 10in;
            box-sizing: border-box;
        ">
            <!-- Header Section -->
            <div class="resume-header" style="text-align: center; margin-bottom: ${sectionSpacing};">
                <h1 style="
                    margin: 0 0 0.2em 0;
                    font-size: ${headerFontSize};
                    font-weight: bold;
                    letter-spacing: 0.5pt;
                ">${escapeHTML(profile.name)}</h1>
                <div style="
                    margin: 0;
                    font-size: ${contactFontSize};
                    line-height: 1.3;
                ">${formatContactLine(profile)}</div>
                ${resume.summary ? `<div data-kind="summary" style="
                    margin: 0.3em 0 0 0;
                    font-size: ${contactFontSize};
                    font-weight: bold;
                ">${resume.summary}</div>` : ''}
            </div>

            <!-- Skills Section -->
            ${resume.skills && resume.skills.length > 0 ? `
            <div class="resume-section" style="margin-bottom: ${sectionSpacing};">
                <h2 style="
                    margin: 0 0 0.4em 0;
                    font-size: ${sectionHeaderSize};
                    font-weight: bold;
                    text-transform: uppercase;
                    border-bottom: 1pt solid #000;
                    padding-bottom: 2pt;
                ">Skills</h2>
                <div style="font-size: ${bodyFontSize};">
                    ${formatSkills(resume.skills)}
                </div>
            </div>` : ''}
            ${order.map(k => sections[k]).join('')}
        </div>
    `;

    return formatted;
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
            return `<p data-kind="skills" style="margin: 0 0 0.2em 0; line-height: 1.3;"><strong>${skillLine.slice(0, at)}:</strong> ${skillLine.slice(at + 1).trim()}</p>`;
        }).join('');
    } else {
        // Fallback: group skills manually
        return `<p style="margin: 0; line-height: 1.3;"><strong>Technical Skills:</strong> ${skills.join(', ')}</p>`;
    }
}

// The extras section's heading, from a vocabulary ATS parsers recognise: one
// type's standard name, or "Additional Information" for a mix. Older entries
// without types fall back on which list they carry.
const EXTRA_HEADINGS = {
    certification: 'Certifications',
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
