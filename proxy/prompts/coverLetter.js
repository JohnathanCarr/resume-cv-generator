// Cover letter generation prompt and output schema.

'use strict';

const { formatEducation, formatExperiences, formatProjects, formatExtras } = require('./profileText');

const COVER_LETTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    coverLetter: { type: 'string', description: 'The complete letter as a single string with paragraphs separated by blank lines.' }
  },
  required: ['coverLetter']
};

const SYSTEM = `You are an elite executive cover letter consultant. You MUST follow ALL instructions precisely. You write consultant-level pitches that sound like strategic business proposals, NOT job applications. You NEVER use generic phrases, clichés, or beggar language. Every word must demonstrate unique value and insider knowledge.`;

function buildCoverLetterMessages({ profile, jobText, match, matchText }) {
  const roleName = match.role || 'the role';
  const companyName = match.company || 'the company';

  const user = `CRITICAL INSTRUCTIONS - FOLLOW EXACTLY:

Write a cover letter for ${companyName} for the ${roleName} role. This is NOT a typical job application - it's a strategic business pitch.

MANDATORY REQUIREMENTS:

1. Research the company first. Look into their culture, values, strategy, current market challenges, leadership statements, and any unique initiatives. Open the letter with an insider-level observation that only someone deeply engaged with the company would know. This should sound like I have studied them carefully, not like a generic compliment.

2. Do not restate my resume. My resume already lists my skills. Instead, the letter should:
• Identify the problems, bottlenecks, or goals the company is facing.
• Show how my specific experiences and skills directly solve those problems.
• Position me not as a candidate filling a role, but as a multiplier who will unlock new value for them.

3. Value proposition focus. Every line must show how I am a unique and confident addition who creates an edge they cannot find elsewhere. Do not use generic phrases like "I am passionate" or "I believe I am qualified." Write with the certainty of someone who already knows they will make a measurable impact.

4. Style and tone. The tone must be confident, professional, and natural. Write like a consultant pitching directly to the CEO — concise, sharp, authoritative, and persuasive. Do not sound like a job seeker begging for an opportunity. Sound like someone who is offering them a rare chance to gain a competitive advantage.

5. CRITICAL: Avoid ALL AI detection patterns.
• NEVER use em-dashes (—), hyphens (-), semicolons (;), or colons (:) anywhere in the letter body
• NEVER use phrases like "I am excited to," "I am passionate about," "team player," "fast learner," "I believe," "I feel"
• NEVER use "furthermore," "moreover," "additionally," "in addition," "consequently," "therefore"
• NEVER start sentences with "As a," "With my," "Through my," "Having worked"
• NEVER use superlatives like "extremely," "incredibly," "highly," "very," "really"
• Write with varied sentence lengths and natural human rhythm
• Use contractions occasionally (I've, you'll, we're) to sound more human
• Write like you're speaking directly to a business executive, not writing an essay

6. Structure of the cover letter (EXACTLY 4 paragraphs).
• Paragraph 1: One insider observation about ${companyName} (3-4 lines max). Show you understand their specific market position or recent developments.
• Paragraph 2: Get straight to business. Identify ONE specific challenge they face based on the job posting and how you solve it directly.
• Paragraph 3: Present your relevant experience with specific outcomes. You may enhance or extrapolate from the profile experiences to match job requirements. Add relevant soft skills that demonstrate leadership, problem-solving, or innovation.
• Paragraph 4: Strong close that positions hiring you as the obvious strategic decision. Sound like you're doing them a favor by considering their opportunity.

7. The final product should feel like the confident pitch of a lifetime. When finished, the reader should feel curious and eager to meet me, as if they would be missing out if they did not.

Use the facts from my profile below as a foundation. You may enhance experiences and add relevant soft skills to better match the job requirements, but keep it realistic and professional.

Job Post:
${jobText}

Match analysis (requirements and which of my profile items support each):
${matchText}

My Profile:
Name: ${profile.name}
Contact: ${profile.contact}
Summary: ${profile.summary || 'None provided'}
Education:
${formatEducation(profile)}
Skills: ${profile.skills ? profile.skills.join(', ') : 'None listed'}

Work Experience:
${formatExperiences(profile)}

Projects:
${formatProjects(profile)}

Certifications & Achievements:
${formatExtras(profile)}

CRITICAL OUTPUT REQUIREMENTS:
- Write EXACTLY 4 paragraphs as specified above
- Use confident, consultant-level language throughout
- NO generic phrases like "I am passionate" or "team player"
- NO dashes, semicolons, or colons in the letter body
- Sound like you're offering them a rare opportunity, not begging for a job
- Research-backed insights about ${companyName} specifically
- Separate paragraphs with a blank line`;

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user }
  ];
}

module.exports = { buildCoverLetterMessages, COVER_LETTER_SCHEMA };
