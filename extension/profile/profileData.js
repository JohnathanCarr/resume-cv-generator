// Profile data helpers, pure (no DOM): the extras' types and the education
// migration for old saves.

// Value and label of each extras type (Certifications & achievements).
export const EXTRA_TYPES = [
    ['research', 'Research'],
    ['program', 'Program'],
    ['certification', 'Certification'],
    ['license', 'License'],
    ['award', 'Award'],
    ['publication', 'Publication'],
    ['leadership', 'Leadership'],
    ['volunteer', 'Volunteer'],
    ['other', 'Other']
];

// Education was a single object before multi-entry support; convert
// legacy saves to a one-element array so nothing is lost.
export function migrateEducation(education) {
    if (Array.isArray(education)) return education;
    if (!education || typeof education !== 'object') return [];
    const hasContent = Object.values(education).some(v => v && String(v).trim());
    if (!hasContent) return [];
    return [{
        id: Date.now().toString(),
        institution: education.university || '',
        degreeType: education.degreeType || '',
        major: education.major || '',
        minor: education.minor || '',
        location: education.location || '',
        start: education.start || '',
        end: education.end || '',
        gpa: education.gpa || '',
        honors: education.honors || '',
        coursework: education.coursework || ''
    }];
}
