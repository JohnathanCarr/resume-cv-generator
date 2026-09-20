// Plain-text renderings of profile sections shared by the generation prompts.

function formatEducation(profile) {
  const list = Array.isArray(profile.education)
    ? profile.education
    : (profile.education && typeof profile.education === 'object' ? [profile.education] : []);
  const lines = list.map(edu => {
    const school = edu.institution || edu.university || '';
    const degree = [edu.degreeType, edu.major ? `in ${edu.major}` : ''].filter(Boolean).join(' ');
    let line = [degree, school].filter(Boolean).join(', ') || 'Not specified';
    if (edu.location) line += ` (${edu.location})`;
    if (edu.start && edu.end) line += ` ${edu.start} - ${edu.end}`;
    else if (edu.end) line += ` ${edu.end}`;
    if (edu.minor) line += `; Minor: ${edu.minor}`;
    if (edu.gpa) line += `; GPA: ${edu.gpa}`;
    if (edu.honors) line += `; Honors: ${edu.honors}`;
    if (edu.coursework) line += `; Coursework: ${edu.coursework}`;
    return line;
  });
  return lines.length ? lines.join('\n') : 'Not specified';
}

function formatExperiences(profile) {
  if (!Array.isArray(profile.experiences) || !profile.experiences.length) return 'None listed';
  return profile.experiences.map(exp => {
    let s = `${exp.title} at ${exp.company} (${exp.start} - ${exp.end}, ${exp.location})`;
    if (exp.description) s += `\nRole: ${exp.description}`;
    if (exp.bullets?.length) s += `\nKey Achievements: ${exp.bullets.join('; ')}`;
    return s;
  }).join('\n\n');
}

function formatProjects(profile) {
  if (!Array.isArray(profile.projects) || !profile.projects.length) return 'None listed';
  return profile.projects.map(proj => {
    let s = proj.name;
    if (proj.description) s += `\nDescription: ${proj.description}`;
    if (proj.bullets?.length) s += `\nKey Details: ${proj.bullets.join('; ')}`;
    return s;
  }).join('\n\n');
}

function formatExtras(profile) {
  if (!Array.isArray(profile.extras) || !profile.extras.length) return 'None';
  return profile.extras.map(extra => {
    let line = `[${extra.type || 'other'}] ${extra.title || ''}`;
    if (extra.organization) line += ` at ${extra.organization}`;
    if (extra.start && extra.end) line += ` (${extra.start} - ${extra.end})`;
    else if (extra.end) line += ` (${extra.end})`;
    if (extra.description) line += `\nDescription: ${extra.description}`;
    return line;
  }).join('\n\n');
}

export { formatEducation, formatExperiences, formatProjects, formatExtras };
