// Heuristic resume parser.
//
// Reads a PDF with pdf.js and turns it into the profile shape used by the
// app, with no network or LLM calls. It relies on positioned text runs
// (x/y, font size, bold/italic from the font name) to find the header
// block, section headings, entries and bullets. Conventional single-column
// resumes parse well; multi-column or table-based layouts degrade because
// pdf.js emits their text out of reading order.
//
// Exposes window.ResumeParser = { parse(pdfjsLib, arrayBuffer) }.

(function (global) {
    'use strict';

    // ── Regexes ────────────────────────────────────────────────────────────

    const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
    const YEAR = '(?:19|20)\\d{2}';
    const DATE = `(?:${MONTH}\\s+${YEAR}|\\d{1,2}\\/${YEAR}|${YEAR})`;
    const DATE_END = `(?:${DATE}|Present|Current|Now|Ongoing|Today)`;
    const DATE_RANGE_RE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|through|until)\\s*(${DATE_END})`, 'i');
    const SINGLE_DATE_RE = new RegExp(`(?:(?:Expected|Anticipated|Graduated|Graduating|Graduation(?:\\s+Date)?|Class\\s+of)\\s*:?\\s*)?(${DATE})`, 'i');

    const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
    const PHONE_RE = /(?:\+?\d{1,2}[\s.-])?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
    const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+\/?/i;
    const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i;
    const URL_RE = /(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)*\.(?:dev|io|com|me|net|org|app|co|tech|ai)\b(?:\/[\w./-]*)?/i;
    // "City, ST" anywhere, or "City, State" only when a separator or the end follows
    // (otherwise "President, Women in Computing" would read as a location).
    const LOCATION_ST_RE = /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*),\s*([A-Z]{2})\b/;
    const LOCATION_FULL_RE = /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?=\s*(?:$|[|•·;(]|[–—-]\s|\d))/;
    const matchLocation = (text) => text.match(LOCATION_ST_RE) || text.match(LOCATION_FULL_RE);
    const REMOTE_RE = /\b(Remote|Hybrid|On-site|Onsite)\b/i;

    const BULLET_CHARS = /^[•●◦▪▫■□‣○◆◇➢➤►▶\-–—*·]\s*/;
    const SEPARATOR_RE = /\s*(?:\||•|·|\s[–—]\s|\s-\s)\s*/;

    const DEGREE_RE = /\b(Bachelor(?:'s)?(?:\s+of\s+[A-Za-z]+)?|Master(?:'s)?(?:\s+of\s+[A-Za-z]+)?|Doctor(?:ate)?(?:\s+of\s+[A-Za-z]+)?|Associate(?:'s)?(?:\s+of\s+[A-Za-z]+)?|B\.?S\.?(?:c\.?)?|B\.?A\.?|B\.?Eng\.?|B\.?B\.?A\.?|B\.?F\.?A\.?|M\.?S\.?(?:c\.?)?|M\.?A\.?|M\.?Eng\.?|M\.?B\.?A\.?|M\.?F\.?A\.?|Ph\.?D\.?|A\.?A\.?|A\.?S\.?|J\.?D\.?|M\.?D\.?)(?![A-Za-z])/;
    const INSTITUTION_RE = /\b(University|College|Institute|School|Academy|Polytechnic|Universidad|Université)\b/i;
    const GPA_RE = /GPA\s*:?\s*([0-4]\.\d{1,2}(?:\s*\/\s*4(?:\.0+)?)?)/i;
    const MINOR_RE = /\bMinor(?:\s+in)?\s*:?\s*([^,|;•–—\n]+)/i;
    const MAJOR_RE = /\bMajor(?:\s+in)?\s*:?\s*([^,|;•–—\n]+)/i;
    const COURSEWORK_RE = /\b(?:Relevant\s+)?Course(?:work|s)\s*:?\s*(.+)/i;
    const HONORS_RE = /\b(Dean'?s\s+List|cum\s+laude|Honou?rs?\b|Scholar(?:ship)?|Distinction|Valedictorian|Salutatorian)/i;

    const TITLE_KW_RE = /\b(Engineer|Developer|Intern(?:ship)?|Manager|Analyst|Assistant|Associate|Lead|Director|Consultant|Designer|Scientist|Researcher|Specialist|Coordinator|Teaching|Fellow|Founder|Co-?Founder|President|Officer|Administrator|Technician|Tutor|Instructor|Architect|Head|Chief|Contributor|Sensei|Mentor|Ambassador|Representative|Volunteer|Clerk|Cashier|Server|Barista|Programmer|Apprentice|Trainee|Student|Freelance|Facilitator|Organizer|Captain|Treasurer|Secretary|Chair|Member|Editor|Writer|Nurse|Teacher|Professor|Pharmacist|Accountant|Auditor|Recruiter|Advisor|Strategist|Operator)\b/i;
    const COMPANY_KW_RE = /\b(Inc\.?|LLC|L\.L\.C\.|Corp\.?|Corporation|Ltd\.?|Limited|Co\.|Company|University|College|Institute|Labs?|Laboratory|Technologies|Group|Bank|Studios?|Partners|Foundation|Hospital|Clinic|Agency|Ventures|Consulting|Industries|AI)\b/;

    // ── Section heading dictionary ─────────────────────────────────────────
    // Keys are canonical section kinds; values are heading synonyms after
    // normalisation (lowercase, "&" → "and", punctuation stripped).

    const SECTION_SYNONYMS = {
        summary: ['summary', 'professional summary', 'career summary', 'profile', 'professional profile', 'objective', 'career objective', 'about', 'about me', 'overview'],
        skills: ['skills', 'technical skills', 'core skills', 'key skills', 'skills and interests', 'skills and expertise', 'technical expertise', 'technologies', 'tools and technologies', 'core competencies', 'competencies', 'areas of expertise', 'technical proficiencies', 'proficiencies', 'languages and tools', 'skills summary', 'skills and tools', 'tech stack'],
        education: ['education', 'education and honors', 'education and training', 'academic background', 'academics', 'academic history', 'educational background', 'education and certifications'],
        experience: ['experience', 'work experience', 'professional experience', 'employment', 'employment history', 'work history', 'career history', 'relevant experience', 'professional background', 'internships', 'internship experience', 'industry experience', 'experience and internships'],
        projects: ['projects', 'personal projects', 'technical projects', 'selected projects', 'academic projects', 'key projects', 'project experience', 'projects and research', 'notable projects', 'software projects', 'portfolio'],
        certification: ['certifications', 'certificates', 'certifications and licenses', 'licenses and certifications', 'licenses', 'professional certifications', 'training and certifications', 'courses and certifications'],
        award: ['awards', 'honors', 'honors and awards', 'awards and honors', 'awards and recognition', 'achievements', 'accomplishments', 'recognition', 'scholarships'],
        publication: ['publications', 'papers', 'research publications', 'publications and presentations', 'presentations', 'conferences'],
        research: ['research', 'research experience', 'research projects', 'academic research'],
        leadership: ['leadership', 'leadership experience', 'leadership and activities', 'activities', 'extracurricular activities', 'extracurriculars', 'involvement', 'campus involvement', 'organizations', 'clubs and organizations', 'activities and interests', 'student organizations', 'affiliations', 'professional affiliations', 'memberships'],
        volunteer: ['volunteer', 'volunteering', 'volunteer experience', 'volunteer work', 'community service', 'community involvement', 'service'],
        program: ['programs', 'programs and certifications', 'training', 'professional development', 'bootcamps', 'courses', 'additional experience', 'additional information', 'additional', 'interests', 'hobbies', 'languages', 'other']
    };

    const SYNONYM_LOOKUP = new Map();
    for (const [kind, names] of Object.entries(SECTION_SYNONYMS)) {
        for (const name of names) SYNONYM_LOOKUP.set(name, kind);
    }

    const EXTRA_KINDS = new Set(['certification', 'award', 'publication', 'research', 'leadership', 'volunteer', 'program']);

    // ── Small helpers ──────────────────────────────────────────────────────

    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    // Joins a wrapped continuation onto the previous text, re-attaching hyphenated breaks.
    const joinWrapped = (prev, next) => /\w-$/.test(prev) ? prev + next : `${prev} ${next}`;
    const endsSentence = (s) => /[.!?]["')\]]?$/.test(clean(s));
    const stripTrailingPunct = (s) => clean(s).replace(/[\s,;:|•·–—-]+$/g, '').replace(/^[\s,;:|•·–—-]+/g, '');
    const normalizeHeading = (s) => clean(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const isAllCaps = (s) => /[A-Z]/.test(s) && s === s.toUpperCase();
    const wordCount = (s) => clean(s).split(' ').filter(Boolean).length;

    function fontFlags(fontName) {
        const n = String(fontName || '');
        return {
            bold: /bold|black|heavy|semibold|demibold|extrabold|ultrabold/i.test(n),
            italic: /italic|oblique/i.test(n)
        };
    }

    // ── Stage 1: positioned lines from pdf.js ──────────────────────────────

    async function extractLines(pdfjsLib, data) {
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        const lines = [];
        let pageWidth = 612;
        let pageHeight = 792;

        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const viewport = page.getViewport({ scale: 1 });
            pageWidth = viewport.width;
            pageHeight = viewport.height;

            // Font objects are only populated once the operator list is built.
            await page.getOperatorList();
            const content = await page.getTextContent();

            const fontCache = new Map();
            const resolveFont = (id) => {
                if (fontCache.has(id)) return fontCache.get(id);
                let flags = { bold: false, italic: false };
                try {
                    const font = page.commonObjs.get(id);
                    flags = fontFlags(font && font.name);
                } catch (_) { /* font not resolvable; assume regular */ }
                fontCache.set(id, flags);
                return flags;
            };

            const items = content.items
                .filter(it => it.str && it.str.trim())
                .map(it => {
                    const size = Math.abs(it.transform[3]) || it.height || 10;
                    const flags = resolveFont(it.fontName);
                    return {
                        text: it.str,
                        x: it.transform[4],
                        y: it.transform[5],
                        w: it.width,
                        size,
                        bold: flags.bold,
                        italic: flags.italic,
                        hasEOL: !!it.hasEOL
                    };
                })
                .sort((a, b) => (b.y - a.y) || (a.x - b.x));

            let current = null;
            for (const it of items) {
                const tolerance = Math.max(2, it.size * 0.45);
                if (current && Math.abs(current.y - it.y) <= tolerance) {
                    current.items.push(it);
                } else {
                    current = { y: it.y, items: [it], page: p };
                    lines.push(current);
                }
            }
        }

        // Flatten each line's items into text, segments and style flags.
        const out = [];
        for (const line of lines) {
            line.items.sort((a, b) => a.x - b.x);
            let text = '';
            let segments = [];
            let seg = '';
            let prevEnd = null;
            let boldChars = 0, italicChars = 0, totalChars = 0, maxSize = 0;
            let hasEOL = false;

            for (const it of line.items) {
                const gap = prevEnd === null ? 0 : it.x - prevEnd;
                if (prevEnd !== null) {
                    if (gap > it.size * 2.5) {
                        segments.push(clean(seg));
                        seg = '';
                        text += ' ';
                    } else if (gap > it.size * 0.12 && !/\s$/.test(text) && !/^\s/.test(it.text)) {
                        text += ' ';
                        seg += ' ';
                    }
                }
                text += it.text;
                seg += it.text;
                prevEnd = it.x + it.w;
                const n = it.text.trim().length;
                totalChars += n;
                if (it.bold) boldChars += n;
                if (it.italic) italicChars += n;
                maxSize = Math.max(maxSize, it.size);
                hasEOL = hasEOL || it.hasEOL;
            }
            segments.push(clean(seg));
            segments = segments.filter(Boolean);

            const cleaned = clean(text);
            if (!cleaned) continue;
            out.push({
                text: cleaned,
                segments,
                x: line.items[0].x,
                xEnd: Math.max(...line.items.map(i => i.x + i.w)),
                y: line.y,
                page: line.page,
                size: maxSize,
                bold: totalChars > 0 && boldChars / totalChars >= 0.5,
                italic: totalChars > 0 && italicChars / totalChars >= 0.5,
                hasEOL
            });
        }

        return { lines: out, pages: pdf.numPages, pageWidth, pageHeight };
    }

    // ── Stage 2: layout metrics + section detection ────────────────────────

    function bodyFontSize(lines) {
        const weights = new Map();
        for (const l of lines) {
            const key = Math.round(l.size * 2) / 2;
            weights.set(key, (weights.get(key) || 0) + l.text.length);
        }
        let best = 10, bestW = -1;
        for (const [size, w] of weights) if (w > bestW) { best = size; bestW = w; }
        return best;
    }

    function headingKind(line, bodySize, leftMargin) {
        const raw = line.text.replace(/:$/, '');
        if (raw.length > 45 || wordCount(raw) > 5) return null;
        if (/\d/.test(raw)) return null;
        const norm = normalizeHeading(raw);
        if (!norm) return null;

        const styled = line.bold || line.size > bodySize + 0.5 || isAllCaps(raw);
        const known = SYNONYM_LOOKUP.get(norm);
        if (known && (styled || line.x <= leftMargin + 2)) return known;

        // Unknown but heading-shaped: all caps, bold, at the left margin.
        if (!known && isAllCaps(raw) && line.bold && line.x <= leftMargin + 2 && wordCount(raw) <= 4) {
            return 'program';
        }
        return null;
    }

    function splitSections(lines, bodySize) {
        const leftMargin = Math.min(...lines.map(l => l.x));
        const sections = [];
        let header = [];
        let current = null;

        for (const line of lines) {
            const kind = headingKind(line, bodySize, leftMargin);
            if (kind) {
                current = { kind, heading: line.text, lines: [] };
                sections.push(current);
            } else if (current) {
                current.lines.push(line);
            } else {
                header.push(line);
            }
        }
        return { header, sections, leftMargin };
    }

    // ── Stage 3: header block (name, contact, location, summary) ───────────

    function parseHeader(headerLines, allLines) {
        const result = { name: '', contact: '', location: '', summary: '' };
        if (!headerLines.length) return result;

        const firstPage = headerLines.filter(l => l.page === 1);
        const pool = firstPage.length ? firstPage : headerLines;
        const nameLine = pool.reduce((best, l) => {
            if (EMAIL_RE.test(l.text) || PHONE_RE.test(l.text)) return best;
            if (wordCount(l.text) > 5) return best;
            return (!best || l.size > best.size) ? l : best;
        }, null);
        if (nameLine) result.name = stripTrailingPunct(nameLine.text);

        const contactLines = [];
        const rest = [];
        let email = '', phone = '', linkedin = '', github = '', website = '';

        for (const line of headerLines) {
            if (line === nameLine) continue;
            let text = line.text;
            let matched = false;

            const e = text.match(EMAIL_RE);
            if (e && !email) { email = e[0]; matched = true; }
            const li = text.match(LINKEDIN_RE);
            if (li && !linkedin) { linkedin = li[0]; matched = true; }
            const gh = text.match(GITHUB_RE);
            if (gh && !github) { github = gh[0]; matched = true; }
            const ph = text.match(PHONE_RE);
            if (ph && !phone) { phone = ph[0]; matched = true; }

            let scrubbed = text
                .replace(EMAIL_RE, ' ')
                .replace(LINKEDIN_RE, ' ')
                .replace(GITHUB_RE, ' ')
                .replace(PHONE_RE, ' ');
            const url = scrubbed.match(URL_RE);
            if (url && !website) { website = url[0]; matched = true; scrubbed = scrubbed.replace(URL_RE, ' '); }

            if (!result.location) {
                const loc = matchLocation(scrubbed);
                if (loc) { result.location = clean(loc[0]); matched = true; }
            }

            if (matched) continue;
            const continues = rest.length && !endsSentence(rest[rest.length - 1]);
            if (wordCount(text) >= 8 || (continues && wordCount(text) >= 2)) {
                if (continues) rest[rest.length - 1] = joinWrapped(rest[rest.length - 1], text);
                else rest.push(text);
            }
        }

        if (email) contactLines.push(`Email: ${email}`);
        if (phone) contactLines.push(`Phone: ${phone}`);
        if (linkedin) contactLines.push(`LinkedIn: ${linkedin.replace(/^https?:\/\/(www\.)?/i, '')}`);
        if (github) contactLines.push(`GitHub: ${github.replace(/^https?:\/\/(www\.)?/i, '')}`);
        if (website) contactLines.push(`Website: ${website.replace(/^https?:\/\/(www\.)?/i, '')}`);
        result.contact = contactLines.join('\n');
        result.summary = clean(rest.join(' '));

        return result;
    }

    // ── Stage 4: entry grouping shared by experience / projects / extras ───

    function isBulletLine(line, leftMargin) {
        return BULLET_CHARS.test(line.text) || (line.x > leftMargin + 4 && !line.bold);
    }

    function stripBullet(text) {
        return clean(text.replace(BULLET_CHARS, ''));
    }

    // Splits section lines into entries: { header: [lines], bullets: [strings], body: [strings] }.
    // A new entry starts at a non-bullet line that follows bullets, or at a
    // non-bullet line carrying a date range when the current header already has one.
    function groupEntries(lines, leftMargin, rightMargin, opts = {}) {
        const entries = [];
        let entry = null;
        let prevBullet = null;
        const maxHeader = opts.maxHeaderLines || 3;
        // Generators that emit hasEOL mark wrapped lines precisely; otherwise
        // fall back to "previous line reached the right margin".
        const trustEOL = !!opts.trustEOL;

        const newEntry = (line) => {
            entry = { header: [line], bullets: [], body: [] };
            entries.push(entry);
            prevBullet = null;
        };

        for (const line of lines) {
            const bullet = isBulletLine(line, leftMargin);
            const hasDate = DATE_RANGE_RE.test(line.text);

            if (!entry) { newEntry(line); continue; }

            if (bullet) {
                const text = stripBullet(line.text);
                const explicit = BULLET_CHARS.test(line.text);
                const prevText = prevBullet ? entry.bullets[entry.bullets.length - 1] : '';
                const nearRight = prevBullet && prevBullet.xEnd > rightMargin - (rightMargin - leftMargin) * 0.12;
                const continuation = trustEOL ? prevBullet && prevBullet.hasEOL : nearRight;
                const wrapped = prevBullet && !explicit && (
                    /^[a-z]/.test(text) ||
                    (!endsSentence(prevText) && continuation)
                );
                if (wrapped) {
                    entry.bullets[entry.bullets.length - 1] = joinWrapped(prevText, text);
                } else {
                    entry.bullets.push(text);
                }
                prevBullet = { hasEOL: line.hasEOL, xEnd: line.xEnd };
                continue;
            }

            // Non-bullet line.
            const headerHasDate = entry.header.some(l => DATE_RANGE_RE.test(l.text));
            if (entry.bullets.length > 0) {
                newEntry(line);
            } else if (hasDate && headerHasDate) {
                newEntry(line);
            } else if (opts.boldStartsEntry && line.bold && entry.header.length >= 1 && !hasDate) {
                newEntry(line);
            } else if (entry.header.length < maxHeader) {
                entry.header.push(line);
            } else {
                entry.body.push(line.text);
            }
        }
        return entries;
    }

    function extractDates(text) {
        const r = text.match(DATE_RANGE_RE);
        if (r) return { start: clean(r[1]), end: clean(r[2]), rest: clean(text.replace(DATE_RANGE_RE, ' ')) };
        const s = text.match(SINGLE_DATE_RE);
        if (s) return { start: '', end: clean(s[1]), rest: clean(text.replace(SINGLE_DATE_RE, ' ')) };
        return { start: '', end: '', rest: clean(text) };
    }

    function extractLocation(text) {
        const loc = matchLocation(text);
        if (loc) return { location: clean(loc[0]), rest: clean(text.replace(loc[0], ' ')) };
        const rem = text.match(REMOTE_RE);
        if (rem) return { location: clean(rem[0]), rest: clean(text.replace(REMOTE_RE, ' ')) };
        return { location: '', rest: clean(text) };
    }

    function splitPieces(text) {
        return text.split(SEPARATOR_RE).map(stripTrailingPunct).filter(p => p && !/^(at|for|with)$/i.test(p));
    }

    // ── Stage 5: section parsers ───────────────────────────────────────────

    function parseExperience(section, leftMargin, rightMargin, trustEOL) {
        const entries = groupEntries(section.lines, leftMargin, rightMargin, { trustEOL });
        const out = [];

        for (const e of entries) {
            let start = '', end = '', location = '';
            const pieces = []; // { text, bold, italic, lineIndex }

            e.header.forEach((line, idx) => {
                let text = line.text;
                const d = extractDates(text);
                if (d.start || d.end) { start = start || d.start; end = end || d.end; }
                text = d.rest;
                const l = extractLocation(text);
                if (l.location && !location) location = l.location;
                text = l.rest;
                for (const p of splitPieces(text)) {
                    pieces.push({ text: p, bold: line.bold, italic: line.italic, lineIndex: idx });
                }
            });

            if (!pieces.length) continue;

            const scored = pieces.map(p => ({
                ...p,
                titleScore: (TITLE_KW_RE.test(p.text) ? 3 : 0) + (p.italic ? 1 : 0),
                companyScore: (COMPANY_KW_RE.test(p.text) ? 2 : 0) + (p.bold ? 1 : 0)
            }));

            let title = '', company = '';
            const remaining = [...scored];

            const bestTitle = remaining.reduce((b, p) => (p.titleScore - p.companyScore) > (b ? (b.titleScore - b.companyScore) : 0) ? p : b, null);
            if (bestTitle) { title = bestTitle.text; remaining.splice(remaining.indexOf(bestTitle), 1); }

            const bestCompany = remaining.reduce((b, p) => (p.companyScore - p.titleScore) > (b ? (b.companyScore - b.titleScore) : -1) ? p : b, null);
            if (bestCompany) { company = bestCompany.text; remaining.splice(remaining.indexOf(bestCompany), 1); }

            // Fallbacks when no keyword hit: bold line → company, the other → title.
            if (!title && remaining.length) {
                const pick = remaining.find(p => p.italic) || remaining.find(p => !p.bold) || remaining[0];
                title = pick.text; remaining.splice(remaining.indexOf(pick), 1);
            }
            if (!company && remaining.length) {
                const pick = remaining.find(p => p.bold) || remaining[0];
                company = pick.text; remaining.splice(remaining.indexOf(pick), 1);
            }
            if (!title && company && pieces.length === 1) { title = company; company = ''; }

            const description = clean([...remaining.map(p => p.text), ...e.body].join(' '));

            out.push({
                title: stripTrailingPunct(title),
                company: stripTrailingPunct(company),
                start, end, location,
                description,
                bullets: e.bullets.map(stripTrailingPunct).filter(Boolean)
            });
        }
        return out;
    }

    function parseProjects(section, leftMargin, rightMargin, trustEOL) {
        const entries = groupEntries(section.lines, leftMargin, rightMargin, { boldStartsEntry: true, maxHeaderLines: 2, trustEOL });
        const out = [];
        for (const e of entries) {
            const first = e.header[0];
            const d = extractDates(first.text);
            const pieces = splitPieces(d.rest);
            if (!pieces.length) continue;
            const name = pieces[0];
            const tail = pieces.slice(1);
            const extraHeader = e.header.slice(1).map(l => extractDates(l.text).rest);
            const description = clean([...tail, ...extraHeader, ...e.body].join(' | '));
            out.push({
                name: stripTrailingPunct(name),
                description,
                bullets: e.bullets.map(stripTrailingPunct).filter(Boolean)
            });
        }
        return out;
    }

    function parseEducation(section, leftMargin, rightMargin) {
        // Entries begin at institution-looking lines; everything until the next one belongs to it.
        const groups = [];
        let group = null;
        for (const line of section.lines) {
            const startsEntry = INSTITUTION_RE.test(line.text) && !isBulletLine(line, leftMargin) && (line.bold || !group);
            if (startsEntry || !group) {
                group = [];
                groups.push(group);
            }
            group.push(line);
        }

        const out = [];
        for (const g of groups) {
            const edu = { institution: '', degreeType: '', major: '', minor: '', location: '', start: '', end: '', gpa: '', honors: '', coursework: '' };
            const leftovers = [];

            for (const line of g) {
                let text = stripBullet(line.text);

                const gpa = text.match(GPA_RE);
                if (gpa && !edu.gpa) { edu.gpa = clean(gpa[1]); text = clean(text.replace(GPA_RE, ' ')); }

                const cw = text.match(COURSEWORK_RE);
                if (cw && !edu.coursework) { edu.coursework = stripTrailingPunct(cw[1]); continue; }

                const minor = text.match(MINOR_RE);
                if (minor) { if (!edu.minor) edu.minor = stripTrailingPunct(minor[1]); text = clean(text.replace(MINOR_RE, ' ')); }

                const major = text.match(MAJOR_RE);
                if (major) { if (!edu.major) edu.major = stripTrailingPunct(major[1]); text = clean(text.replace(MAJOR_RE, ' ')); }
                if (!text) continue;

                const d = extractDates(text);
                if ((d.start || d.end) && !edu.end) {
                    edu.start = d.start; edu.end = d.end;
                    text = d.rest.replace(/\b(Expected|Anticipated|Graduated|Graduating|Graduation(?:\s+Date)?|Class\s+of)\s*:?\s*/i, '');
                }
                text = stripTrailingPunct(text);

                if (INSTITUTION_RE.test(text) && !edu.institution) {
                    const l = extractLocation(text);
                    if (l.location) edu.location = l.location;
                    const pieces = splitPieces(l.rest);
                    edu.institution = pieces.find(p => INSTITUTION_RE.test(p)) || pieces[0] || '';
                    const others = pieces.filter(p => p !== edu.institution);
                    if (others.length) leftovers.push(others.join(', '));
                    continue;
                }

                const deg = text.match(DEGREE_RE);
                if (deg && !edu.degreeType) {
                    const after = text.slice(deg.index + deg[0].length);
                    const inMatch = after.match(/^\s*(?:in|of)\s+([^,|;•(]+)/i);
                    edu.degreeType = clean(deg[0]);
                    if (inMatch && !edu.major) edu.major = stripTrailingPunct(inMatch[1]);
                    else if (!edu.major) {
                        const comma = after.match(/^\s*,\s*([^,|;•(]+)/);
                        if (comma) edu.major = stripTrailingPunct(comma[1]);
                    }
                    const restText = stripTrailingPunct(after.replace(inMatch ? inMatch[0] : '', ' '));
                    if (restText && HONORS_RE.test(restText) && !edu.honors) edu.honors = restText;
                    else if (restText) leftovers.push(restText);
                    continue;
                }

                const h = text.match(HONORS_RE);
                if (h) {
                    const val = stripTrailingPunct(text.replace(/^Honou?rs?\s*:\s*/i, ''));
                    edu.honors = edu.honors ? `${edu.honors}; ${val}` : val;
                    continue;
                }

                if (text) leftovers.push(text);
            }

            if (!edu.institution && leftovers.length) edu.institution = stripTrailingPunct(leftovers.shift());
            if (!edu.honors && leftovers.length) edu.honors = leftovers.join('; ');
            if (edu.institution || edu.degreeType) out.push(edu);
        }
        return out;
    }

    function parseSkills(section) {
        const skills = [];
        const seen = new Set();
        const LEAD_RE = /^(?:Proficient|Proficiency|Experienced|Experience|Familiar|Familiarity|Knowledge|Skilled|Comfortable|Working knowledge|Exposure)\s+(?:in|with|of)\s+/i;

        // "Label:" prefixes. After a separator the label may contain spaces
        // ("Frameworks & Tools:"); after plain whitespace only a single token
        // is taken so "JavaScript Frameworks/Libs:" keeps "JavaScript".
        const CATEGORY_RE = /(?:(?:^|[,;|•·])\s*[A-Za-z][\w\/&()' -]{1,40}:\s*|\s+[A-Za-z][\w\/&()'-]{1,30}:\s*)/g;

        for (const line of section.lines) {
            let text = stripBullet(line.text);
            // "Languages: Python, Java; Tools: Git" → drop every "Label:" prefix.
            text = text.replace(CATEGORY_RE, ', ');
            // "AWS (SQS, Lambda)" → "AWS, SQS, Lambda"
            text = text.replace(/\(([^)]*)\)/g, ', $1, ');

            for (let item of text.split(/\s*[,|•·;]\s*|\s{2,}|\s\/\s|\s+and\s+/i)) {
                item = stripTrailingPunct(item.replace(LEAD_RE, '')).replace(/\.$/, '');
                item = item.replace(/^\((.*)\)$/, '$1');
                if (!item || item.length > 50 || wordCount(item) > 5) continue;
                const key = item.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                skills.push(item);
            }
        }
        return skills;
    }

    function parseExtras(section, leftMargin, rightMargin, trustEOL) {
        const out = [];
        // Every non-continuation line is its own item; bullets count as items here.
        let prev = null;
        for (const line of section.lines) {
            const explicitBullet = BULLET_CHARS.test(line.text);
            const text = stripBullet(line.text);
            const nearRight = prev && prev.xEnd > rightMargin - (rightMargin - leftMargin) * 0.12;
            const wrapped = prev && !explicitBullet && !line.bold && (
                /^[a-z]/.test(text) || (trustEOL ? prev.hasEOL : (line.x > leftMargin + 4 && nearRight))
            );
            if (wrapped && out.length) {
                const last = out[out.length - 1];
                last.description = clean(`${last.description} ${text}`);
                prev = line;
                continue;
            }

            const d = extractDates(text);
            const l = extractLocation(d.rest);
            const pieces = l.rest.split(/\s*,\s*/).flatMap(splitPieces).filter(Boolean);
            if (!pieces.length) { prev = line; continue; }

            let titleIdx = 0;
            let orgIdx = pieces.findIndex((p, i) => i > 0 && COMPANY_KW_RE.test(p));
            if (orgIdx < 0) orgIdx = pieces.findIndex((p, i) => i > 0 && !/^\d/.test(p));
            // "Food Lifeline – Warehouse Volunteer": the role is the second piece.
            if (orgIdx > 0 && TITLE_KW_RE.test(pieces[orgIdx]) && !TITLE_KW_RE.test(pieces[0])) {
                titleIdx = orgIdx; orgIdx = 0;
            }
            const title = pieces[titleIdx];
            const organization = orgIdx >= 0 && orgIdx !== titleIdx ? pieces[orgIdx] : '';
            const rest = pieces.filter((p, i) => i !== titleIdx && i !== orgIdx);

            out.push({
                title: stripTrailingPunct(title),
                organization: stripTrailingPunct(organization),
                type: section.kind,
                start: d.start,
                end: d.end,
                description: clean(rest.join(', '))
            });
            prev = line;
        }
        return out;
    }

    // ── Entry point ────────────────────────────────────────────────────────

    async function parse(pdfjsLib, data) {
        const { lines, pages } = await extractLines(pdfjsLib, data);
        const warnings = [];

        const profile = {
            name: '', contact: '', location: '', summary: '',
            education: [], skills: [], experiences: [], projects: [], extras: []
        };

        if (!lines.length) {
            warnings.push('No selectable text found. Scanned PDFs are not supported.');
            return { profile, meta: { pages, sections: [], warnings } };
        }

        const bodySize = bodyFontSize(lines);
        const { header, sections, leftMargin } = splitSections(lines, bodySize);
        const rightMargin = Math.max(...lines.map(l => l.xEnd));
        const trustEOL = lines.some(l => l.hasEOL);

        Object.assign(profile, parseHeader(header, lines));

        for (const section of sections) {
            switch (section.kind) {
                case 'summary':
                    profile.summary = clean([profile.summary, ...section.lines.map(l => l.text)].join(' '));
                    break;
                case 'skills':
                    profile.skills.push(...parseSkills(section));
                    break;
                case 'education':
                    profile.education.push(...parseEducation(section, leftMargin, rightMargin));
                    break;
                case 'experience':
                    profile.experiences.push(...parseExperience(section, leftMargin, rightMargin, trustEOL));
                    break;
                case 'projects':
                    profile.projects.push(...parseProjects(section, leftMargin, rightMargin, trustEOL));
                    break;
                default:
                    if (EXTRA_KINDS.has(section.kind)) {
                        profile.extras.push(...parseExtras(section, leftMargin, rightMargin, trustEOL));
                    } else {
                        warnings.push(`Unrecognised section "${section.heading}" was skipped.`);
                    }
            }
        }

        if (!sections.length) {
            warnings.push('No section headings were recognised; only the header block was parsed.');
        }

        return {
            profile,
            meta: { pages, bodySize, sections: sections.map(s => `${s.heading} → ${s.kind}`), warnings }
        };
    }

    global.ResumeParser = { parse };
})(typeof window !== 'undefined' ? window : globalThis);
