// The resume template's measurements, in one place: formatResume() renders
// with them and generation/layout.js estimates page height from them, so the
// page budget follows the template. Compact, single column, ATS-safe: a
// sans-serif face, 0.5in margins, 10.5pt body, ruled 11pt section headings.
// Pure.

export const TEMPLATE = {
    font: 'Arial, Helvetica, sans-serif',
    pageWidthIn: 8.5,
    marginIn: 0.5,
    namePt: 18,
    contactPt: 9.5,
    headingPt: 11,
    entryPt: 10.5,        // company / school / project header lines
    bodyPt: 10.5,         // bullets, summary, skills
    lineHeight: 1.2,
    headingGapPt: 3,      // under a heading's rule
    sectionGapPt: 6,      // after each section
    entryGapPt: 4,        // after each job, project or school
    bulletGapPt: 1,       // after each bullet
    bulletIndentEm: 1.1
};

const PX_PER_PT = 96 / 72;
export const pt = (n) => n * PX_PER_PT;

// Usable text width in px.
export const CONTENT_WIDTH_PX = (TEMPLATE.pageWidthIn - 2 * TEMPLATE.marginIn) * 96;
