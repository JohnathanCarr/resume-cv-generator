// node --test 'test/unit/*.test.mjs'
// The resume and cover-letter HTML (extension/preview/), pure, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHTML, escapeResume, formatResume, formatContactLine, formatSkills, formatDates, extrasHeading } from '../../extension/preview/resumeHtml.js';
import { textProblems, STANDARD_HEADINGS } from '../../extension/preview/parseSafety.js';
import { resumeDocToSchema } from '../../extension/generation/baseline.js';
import { formatCoverLetter } from '../../extension/preview/coverLetterHtml.js';
import { sanitizeFilename, suggestFilename } from '../../extension/preview/export.js';

const EVIL = '<img src=x onerror=alert(1)>';
const profile = {
  name: 'Dana Diaz',
  location: 'Austin, TX',
  contact: 'dana@example.com\n(555) 010-0199\nhttps://www.linkedin.com/in/dana\ngithub.com/dana\nundefined',
  education: [{ institution: 'State University', degreeType: 'BS', major: 'CS', start: '2016', end: '2020', gpa: '3.8', honors: '', coursework: 'Databases' }]
};
const resume = {
  summary: 'Backend engineer.',
  skills: ['Languages: Go, Rust', 'Tools: Docker'],
  education: [{ school: 'State University', location: 'Austin', dates: 'May 2020', degree: 'BS', major: 'CS', coursework: 'Databases, Networks' }],
  experience: [{ company: 'Harbor Health', location: 'Remote', dates: '2022 – Present', title: 'Engineer', bullets: ['Built the API', 'Cut deploys to 8 minutes'] }],
  projects: [{ name: 'tidepool', link: 'github.com/dana/tidepool', bullets: ['A job queue'] }],
  certifications: ['AWS Developer']
};

test('escapeHTML escapes the five HTML-significant characters', () => {
  assert.equal(escapeHTML(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
  assert.equal(escapeHTML(null), '');
});

test('escapeResume escapes every string, from data or JSON text', () => {
  const data = { name: EVIL, list: [EVIL, 3, null], nested: { x: '<b>' } };
  const out = escapeResume(data);
  assert.equal(out.list[1], 3);
  assert.equal(out.list[2], null);
  assert.equal(out.nested.x, '&lt;b&gt;');
  assert.deepEqual(escapeResume(JSON.stringify(data)), out);
  assert.equal(escapeResume('not json <b>'), 'not json &lt;b&gt;');
});

test('formatResume never lets markup through, from the profile or the content', () => {
  const html = formatResume(escapeResume({ ...resume, experience: [{ ...resume.experience[0], bullets: [EVIL] }] }),
    { ...profile, name: EVIL, contact: EVIL, location: EVIL });
  assert.ok(!html.includes('<img'), 'raw markup reached the page');
  assert.ok(html.includes('&lt;img'), 'escaped text missing');
  // Already-escaped content is not escaped twice.
  assert.ok(!html.includes('&amp;lt;'));
});

test('formatResume keeps the page geometry the one-page measurement relies on', () => {
  const html = formatResume(escapeResume(resume), profile);
  for (const rule of ['max-width: 7.5in', 'padding: 0.5in', 'line-height: 1.25', 'min-height: 10in', "font-family: 'Times New Roman', serif"]) {
    assert.ok(html.includes(rule), `missing ${rule}`);
  }
  for (const size of ['18pt', '11pt', '10pt']) assert.ok(html.includes(`font-size: ${size}`), `missing ${size}`);
  // layout.js measures these line kinds by their data-kind tags.
  for (const kind of ['summary', 'skills', 'coursework', 'bullet', 'projectHeader', 'extra']) {
    assert.ok(html.includes(`data-kind="${kind}"`), `missing data-kind ${kind}`);
  }
  assert.equal((html.match(/data-kind="bullet"/g) || []).length, 3);
});

test('formatResume leaves out empty sections and falls back to the profile education', () => {
  const html = formatResume(escapeResume({ experience: resume.experience }), profile);
  assert.ok(!html.includes('>Skills</h2>'));
  assert.ok(!html.includes('>Projects</h2>'));
  assert.ok(!html.includes('data-kind="summary"'));
  assert.ok(html.includes('>Education</h2>') && html.includes('State University'), 'profile education not used');
  assert.ok(html.includes('2016 – 2020') && !html.includes('Graduation Date'), 'education dates not in the shared style');
});

test('formatResume reports unreadable content instead of throwing', () => {
  const original = console.error;
  console.error = () => {};
  try {
    assert.match(formatResume('{not json', profile), /Error formatting resume content/);
  } finally {
    console.error = original;
  }
});

test('formatContactLine puts the location first and keeps links visible', () => {
  assert.equal(formatContactLine(profile), 'Austin, TX | dana@example.com | (555) 010-0199 | linkedin.com/in/dana | github.com/dana');
});

test('formatSkills splits each group at its first colon only', () => {
  const html = formatSkills(['Languages: Go, <span title="Original: a: b">Rust</span>']);
  assert.ok(html.startsWith('<p data-kind="skills"'));
  assert.ok(html.includes('<strong>Languages:</strong> Go, <span title="Original: a: b">Rust</span>'));
  assert.ok(formatSkills(['Go', 'Rust']).includes('<strong>Technical Skills:</strong> Go, Rust'));
});

test('formatCoverLetter builds the letter around the model text, escaped', () => {
  const date = { toLocaleDateString: () => 'October 28, 2026' };
  const html = formatCoverLetter(`I am applying for the role ${EVIL}.\n\nshort\n\nI build backend\nservices in Go.`, profile, date);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('October 28, 2026'));
  assert.ok(html.includes('Dear Hiring Manager,') && html.includes('Sincerely,'));
  const paragraphs = html.match(/<div class="letter-body">([\s\S]*?)<\/div>/)[1].match(/<p /g);
  assert.equal(paragraphs.length, 2, 'the 5-character fragment should be dropped');
  assert.ok(html.includes('I build backend services in Go.'), 'line breaks inside a paragraph should be joined');
});

test('file names: unsafe characters removed, unknown parts left out', () => {
  assert.equal(sanitizeFilename('Dana / Co: "Resume"?'), 'Dana Co Resume');
  assert.equal(sanitizeFilename('  ..draft..  '), 'draft');
  assert.equal(sanitizeFilename('a'.repeat(200)).length, 120);
  assert.equal(suggestFilename('Dana Diaz', 'Northwind Labs', 'resume'), 'Dana Diaz - Northwind Labs - Resume');
  assert.equal(suggestFilename('Dana Diaz', undefined, 'cover'), 'Dana Diaz - Cover Letter');
});

test('every heading formatResume writes is a standard one', () => {
  const html = formatResume(escapeResume({ ...resume, summary: '', programs: ['Hackathon winner'], extraTypes: ['award'] }), profile);
  const headings = [...html.matchAll(/>([^<>]+)<\/h2>/g)].map(m => m[1]);
  assert.deepEqual(headings, ['Skills', 'Education', 'Experience', 'Projects', 'Awards']);
  assert.ok(headings.every(h => STANDARD_HEADINGS.includes(h)));
  assert.ok(html.includes('font-variant-ligatures: none'), 'ligatures not turned off');
});

test('the extras heading follows the types it holds', () => {
  assert.equal(extrasHeading({ extraTypes: ['certification', 'certification'] }), 'Certifications');
  assert.equal(extrasHeading({ extraTypes: ['volunteer'] }), 'Volunteer Experience');
  assert.equal(extrasHeading({ extraTypes: ['award', 'leadership'] }), 'Additional Information');
  assert.equal(extrasHeading({ certifications: ['AWS'] }), 'Certifications');
  assert.equal(extrasHeading({ programs: ['Bootcamp'] }), 'Additional Information');
  const schema = resumeDocToSchema({ extras: [{ title: 'AWS Developer', type: 'certification' }, { title: '', type: 'award' }] });
  assert.deepEqual(schema.extraTypes, ['certification'], 'types must line up with the programs lines');
});

test('dates share one style and are never invented', () => {
  const cases = {
    'May 2022 - Present': 'May 2022 – Present',
    'Jan. 2020 – Dec 2021': 'Jan 2020 – Dec 2021',
    'September 2019 to June 2021': 'Sep 2019 – Jun 2021',
    'Sept 2021 - current': 'Sep 2021 – Present',
    '05/2022 - 08/2023': 'May 2022 – Aug 2023',
    '2018-2022': '2018 – 2022',
    'Jun 2023-Aug 2023': 'Jun 2023 – Aug 2023',
    '2016': '2016',
    // Unreadable text stays as written.
    'Summer 2023': 'Summer 2023',
    'Expected May 2026': 'Expected May 2026',
    '03-2022': '03-2022',
    'Jan 2020 - Mar 2021 - May 2022': 'Jan 2020 - Mar 2021 - May 2022',
    '': ''
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(formatDates(input), want, input);
  assert.ok(formatResume(escapeResume(resume), profile).includes('2022 – Present'));
});

test('textProblems flags ligatures and private-use glyphs', () => {
  assert.deepEqual(textProblems('Plain text, no tricks.'), []);
  assert.match(textProblems('Pro\uFB01cient')[0], /ligature/);
  assert.match(textProblems('icon \uE001 here')[0], /private-use/);
});

test('sections follow the resume\'s order; unknown names are ignored', () => {
  const heads = (r) => [...formatResume(escapeResume(r), profile).matchAll(/>([^<>]+)<\/h2>/g)].map(m => m[1]);
  assert.deepEqual(heads({ ...resume, summary: '' }), ['Skills', 'Education', 'Experience', 'Projects', 'Certifications']);
  assert.deepEqual(heads({ ...resume, summary: '', sectionOrder: ['experience', 'projects', 'nope', 'education', 'extras'] }), ['Skills', 'Experience', 'Projects', 'Education', 'Certifications']);
});

test('licenses get a standard heading, alone or with certifications', () => {
  assert.equal(extrasHeading({ extraTypes: ['license'] }), 'Licenses');
  assert.equal(extrasHeading({ extraTypes: ['license', 'certification'] }), 'Licenses & Certifications');
  assert.ok(STANDARD_HEADINGS.includes('Licenses & Certifications'));
});
