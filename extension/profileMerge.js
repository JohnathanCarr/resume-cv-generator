// Additive profile merge.
//
// Folds a parsed resume into an existing profile without deleting anything
// the user already has: new items are appended, matching items are
// enriched (blank fields filled, bullets unioned), and existing ids and
// mustInclude flags are preserved. Scalars are only filled when empty.
//
// Exposes window.ProfileMerge = { merge(existing, parsed) }.

(function (global) {
    'use strict';

    const norm = (s) => String(s || '')
        .toLowerCase()
        .replace(/[.,;:'"()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const nonEmpty = (v) => v !== undefined && v !== null && String(v).trim() !== '';

    let idCounter = 0;
    const newId = () => `${Date.now()}-${idCounter++}`;

    // Fill blank scalar fields on target from source; report whether anything changed.
    function fillBlanks(target, source, fields) {
        let changed = false;
        for (const f of fields) {
            if (!nonEmpty(target[f]) && nonEmpty(source[f])) {
                target[f] = source[f];
                changed = true;
            }
        }
        return changed;
    }

    function unionStrings(existing, incoming) {
        const out = Array.isArray(existing) ? [...existing] : [];
        const seen = new Set(out.map(norm).filter(Boolean));
        let added = 0;
        for (const item of incoming || []) {
            const key = norm(item);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(String(item).trim());
            added++;
        }
        return { list: out, added };
    }

    // Generic keyed merge for arrays of entry objects.
    function mergeEntries(existing, incoming, keyOf, fields, opts = {}) {
        const out = Array.isArray(existing) ? existing.map(e => ({ ...e })) : [];
        const index = new Map();
        out.forEach((e, i) => { const k = keyOf(e); if (k) index.set(k, i); });

        let added = 0, updated = 0;
        for (const item of incoming || []) {
            const key = keyOf(item);
            const at = key ? index.get(key) : undefined;

            if (at === undefined) {
                const entry = { id: newId(), ...opts.defaults, ...item };
                if (opts.hasBullets) entry.bullets = (item.bullets || []).map(b => String(b).trim()).filter(Boolean);
                out.push(entry);
                if (key) index.set(key, out.length - 1);
                added++;
                continue;
            }

            const target = out[at];
            let changed = fillBlanks(target, item, fields);
            if (opts.hasBullets) {
                const u = unionStrings(target.bullets, item.bullets);
                if (u.added) { target.bullets = u.list; changed = true; }
            }
            if (changed) updated++;
        }
        return { list: out, added, updated };
    }

    function merge(existing, parsed) {
        const profile = { ...existing };
        const report = {};

        // Scalars: never overwrite what the user typed.
        for (const f of ['name', 'location', 'summary']) {
            if (!nonEmpty(profile[f]) && nonEmpty(parsed[f])) {
                profile[f] = parsed[f];
                report[f] = 'filled';
            }
        }

        // Contact is a free-text block; union its lines.
        const existingLines = String(profile.contact || '').split('\n').map(l => l.trim()).filter(Boolean);
        const contact = unionStrings(existingLines, String(parsed.contact || '').split('\n'));
        if (contact.added) {
            profile.contact = contact.list.join('\n');
            report.contact = { added: contact.added };
        }

        const skills = unionStrings(profile.skills, parsed.skills);
        profile.skills = skills.list;
        report.skills = { added: skills.added };

        const education = mergeEntries(
            profile.education, parsed.education,
            e => norm(e.institution) && `${norm(e.institution)}|${norm(e.degreeType)}`,
            ['degreeType', 'major', 'minor', 'location', 'start', 'end', 'gpa', 'honors', 'coursework']
        );
        profile.education = education.list;
        report.education = { added: education.added, updated: education.updated };

        const experiences = mergeEntries(
            profile.experiences, parsed.experiences,
            e => (norm(e.company) || norm(e.title)) && `${norm(e.company)}|${norm(e.title)}`,
            ['start', 'end', 'location', 'description'],
            { hasBullets: true, defaults: { mustInclude: false } }
        );
        profile.experiences = experiences.list;
        report.experiences = { added: experiences.added, updated: experiences.updated };

        const projects = mergeEntries(
            profile.projects, parsed.projects,
            p => norm(p.name),
            ['description'],
            { hasBullets: true, defaults: { mustInclude: false } }
        );
        profile.projects = projects.list;
        report.projects = { added: projects.added, updated: projects.updated };

        const extras = mergeEntries(
            profile.extras, parsed.extras,
            x => norm(x.title) && `${norm(x.title)}|${norm(x.organization)}`,
            ['organization', 'type', 'start', 'end', 'description'],
            { defaults: { type: 'other' } }
        );
        profile.extras = extras.list;
        report.extras = { added: extras.added, updated: extras.updated };

        return { profile, report };
    }

    global.ProfileMerge = { merge };
})(typeof window !== 'undefined' ? window : globalThis);
