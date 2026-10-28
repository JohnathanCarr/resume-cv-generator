// The Profile tab's editors: the personal-information fields, the skill
// tags, and a card per education, experience, project and extra entry, each
// saved as it is typed. Cards are template strings (escapeHTML on every
// value); the data is app.profile, saved with app.saveData().
import { escapeHTML } from '../preview/resumeHtml.js';
import { EXTRA_TYPES } from './profileData.js';

export class ProfileEditor {
    constructor(app) {
        this.app = app;
    }

    // Wires the tab's own controls. Call once.
    setup() {
        document.getElementById('save-profile')?.addEventListener('click', () => {
            this.saveProfile();
        });

        // Skills management
        document.getElementById('skills-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addSkill(e.target.value.trim());
                e.target.value = '';
            }
        });

        // Education, experience and project management
        document.getElementById('add-education')?.addEventListener('click', () => {
            this.addEducation();
        });

        document.getElementById('add-experience')?.addEventListener('click', () => {
            this.addExperience();
        });

        document.getElementById('add-project')?.addEventListener('click', () => {
            this.addProject();
        });

        document.getElementById('add-extra')?.addEventListener('click', () => {
            this.addExtra();
        });

        // Profile field updates
        document.getElementById('profile-name')?.addEventListener('input', (e) => {
            this.app.profile.name = e.target.value;
            this.app.renderChecklist();
        });

        document.getElementById('profile-contact')?.addEventListener('input', (e) => {
            this.app.profile.contact = e.target.value;
        });

        document.getElementById('profile-location')?.addEventListener('input', (e) => {
            this.app.profile.location = e.target.value;
        });

        document.getElementById('profile-summary')?.addEventListener('input', (e) => {
            this.app.profile.summary = e.target.value;
        });
    }

    renderFields() {
        // Safely set profile field values
        const setFieldValue = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.value = value || '';
        };

        setFieldValue('profile-name', this.app.profile.name);
        setFieldValue('profile-contact', this.app.profile.contact);
        setFieldValue('profile-location', this.app.profile.location);
        setFieldValue('profile-summary', this.app.profile.summary);
    }

    renderSections() {
        this.renderEducation();
        this.renderSkills();
        this.renderExperiences();
        this.renderProjects();
        this.renderExtras();
    }

    // Card fields have placeholders, not <label>s: give each an accessible
    // name from its placeholder ("Start Date", "Job Title"), minus examples.
    labelFields(root) {
        root.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
            if (el.labels?.length || el.hasAttribute('aria-label')) return;
            const name = el.placeholder.replace(/\s*\(e\.g\..*$/i, '').replace(/\.{3}$|…$/, '').trim();
            if (name) el.setAttribute('aria-label', name);
        });
    }

    renderSkills() {
        const container = document.getElementById('skills-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.app.profile.skills.forEach((skill, index) => {
            const skillEl = document.createElement('div');
            skillEl.className = 'skill-tag';
            const remove = document.createElement('button');
            remove.className = 'skill-remove';
            remove.dataset.index = String(index);
            remove.setAttribute('aria-label', `Remove ${skill}`);
            remove.textContent = '×';
            skillEl.append(skill, remove);
            container.appendChild(skillEl);
        });

        // Add event listeners for remove buttons
        container.querySelectorAll('.skill-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.removeSkill(parseInt(e.target.dataset.index));
            });
        });
    }

    addSkill(skill) {
        if (skill && !this.app.profile.skills.includes(skill)) {
            this.app.profile.skills.push(skill);
            this.renderSkills();
            this.app.saveData();
        }
    }

    removeSkill(index) {
        this.app.profile.skills.splice(index, 1);
        this.renderSkills();
        this.app.saveData();
    }

    renderExperiences() {
        const container = document.getElementById('experiences-container');
        if (!container) return;
        
        container.innerHTML = '';

        this.app.profile.experiences.forEach((exp, index) => {
            const expEl = this.createExperienceElement(exp, index);
            container.appendChild(expEl);
        });
    }

    createExperienceElement(exp, index) {
        const esc = escapeHTML;
        const div = document.createElement('div');
        div.className = 'experience-card';
        div.innerHTML = `
            <div class="card-header">
                <div class="card-title">
                    <input type="text" placeholder="Job Title" value="${esc(exp.title)}" data-field="title" data-index="${index}">
                    <input type="text" placeholder="Company" value="${esc(exp.company)}" data-field="company" data-index="${index}">
                    <div class="input-row input-row-3">
                        <input type="text" placeholder="Start Date" value="${esc(exp.start)}" data-field="start" data-index="${index}">
                        <input type="text" placeholder="End Date" value="${esc(exp.end)}" data-field="end" data-index="${index}">
                        <input type="text" placeholder="Location" value="${esc(exp.location)}" data-field="location" data-index="${index}">
                    </div>
                    <textarea placeholder="Role description (what you did in this role)..." style="margin-top: 0.5rem; min-height: 60px;" data-field="description" data-index="${index}">${esc(exp.description)}</textarea>
                </div>
                <div class="card-actions">
                    <label class="must-include-label">
                        <input type="checkbox" class="must-include-exp" data-index="${index}" ${exp.mustInclude ? 'checked' : ''}>
                        Must include
                    </label>
                    <button class="btn btn-secondary btn-sm add-bullet" data-index="${index}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        Add achievement
                    </button>
                    <button class="btn btn-danger btn-sm remove-experience" data-index="${index}">Remove</button>
                </div>
            </div>
            <div class="bullet-list" data-index="${index}">
                <label>Key achievements</label>
                ${(exp.bullets || []).map((bullet, bulletIndex) => `
                    <div class="bullet-item">
                        <input type="text" placeholder="Specific achievement with metrics if possible..." value="${esc(bullet)}" data-bullet-index="${bulletIndex}">
                        <button class="bullet-remove" data-exp-index="${index}" data-bullet-index="${bulletIndex}" aria-label="Remove achievement ${bulletIndex + 1}">&times;</button>
                    </div>
                `).join('')}
            </div>
        `;

        // Add event listeners
        div.querySelectorAll('input[data-field], textarea[data-field]').forEach(input => {
            input.addEventListener('input', (e) => {
                const field = e.target.dataset.field;
                const expIndex = parseInt(e.target.dataset.index);
                this.app.profile.experiences[expIndex][field] = e.target.value;
                this.app.saveData();
            });
        });

        div.querySelectorAll('input[data-bullet-index]').forEach(input => {
            input.addEventListener('input', (e) => {
                const expIndex = index;
                const bulletIndex = parseInt(e.target.dataset.bulletIndex);
                this.app.profile.experiences[expIndex].bullets[bulletIndex] = e.target.value;
                this.app.saveData();
            });
        });

        div.querySelector('.add-bullet').addEventListener('click', () => {
            this.addExperienceBullet(index);
        });

        div.querySelector('.remove-experience').addEventListener('click', () => {
            this.removeExperience(index);
        });

        div.querySelector('.must-include-exp').addEventListener('change', (e) => {
            this.app.profile.experiences[index].mustInclude = e.target.checked;
            this.app.saveData();
        });

        div.querySelectorAll('.bullet-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const expIndex = parseInt(e.target.dataset.expIndex);
                const bulletIndex = parseInt(e.target.dataset.bulletIndex);
                this.removeExperienceBullet(expIndex, bulletIndex);
            });
        });

        this.labelFields(div);
        return div;
    }

    renderEducation() {
        const container = document.getElementById('education-container');
        if (!container) return;

        container.innerHTML = '';

        this.app.profile.education.forEach((edu, index) => {
            container.appendChild(this.createEducationElement(edu, index));
        });
    }

    createEducationElement(edu, index) {
        const esc = escapeHTML;
        const div = document.createElement('div');
        div.className = 'experience-card';
        div.innerHTML = `
            <div class="card-header">
                <div class="card-title">
                    <input type="text" placeholder="Institution (e.g., Stanford University)" value="${esc(edu.institution)}" data-field="institution" data-index="${index}">
                    <div class="input-row input-row-2">
                        <input type="text" placeholder="Degree Type (e.g., Bachelor of Science)" value="${esc(edu.degreeType)}" data-field="degreeType" data-index="${index}">
                        <input type="text" placeholder="Major (e.g., Computer Science)" value="${esc(edu.major)}" data-field="major" data-index="${index}">
                    </div>
                    <div class="input-row input-row-2">
                        <input type="text" placeholder="Minor (optional)" value="${esc(edu.minor)}" data-field="minor" data-index="${index}">
                        <input type="text" placeholder="Location (e.g., Stanford, CA)" value="${esc(edu.location)}" data-field="location" data-index="${index}">
                    </div>
                    <div class="input-row input-row-3">
                        <input type="text" placeholder="Start Year" value="${esc(edu.start)}" data-field="start" data-index="${index}">
                        <input type="text" placeholder="End Year" value="${esc(edu.end)}" data-field="end" data-index="${index}">
                        <input type="text" placeholder="GPA (e.g., 3.8/4.0)" value="${esc(edu.gpa)}" data-field="gpa" data-index="${index}">
                    </div>
                    <div class="input-row input-row-2">
                        <input type="text" placeholder="Honors (e.g., Dean's List, Magna Cum Laude)" value="${esc(edu.honors)}" data-field="honors" data-index="${index}">
                        <input type="text" placeholder="Relevant Coursework" value="${esc(edu.coursework)}" data-field="coursework" data-index="${index}">
                    </div>
                </div>
                <div class="card-actions">
                    <button class="btn btn-danger btn-sm remove-education" data-index="${index}">Remove</button>
                </div>
            </div>
        `;

        div.querySelectorAll('input[data-field]').forEach(input => {
            input.addEventListener('input', (e) => {
                this.app.profile.education[index][e.target.dataset.field] = e.target.value;
                this.app.saveData();
            });
        });

        div.querySelector('.remove-education').addEventListener('click', () => {
            this.removeEducation(index);
        });

        this.labelFields(div);
        return div;
    }

    addEducation() {
        this.app.profile.education.push({
            id: Date.now().toString(),
            institution: '',
            degreeType: '',
            major: '',
            minor: '',
            location: '',
            start: '',
            end: '',
            gpa: '',
            honors: '',
            coursework: ''
        });
        this.renderEducation();
        this.app.saveData();
    }

    removeEducation(index) {
        this.app.profile.education.splice(index, 1);
        this.renderEducation();
        this.app.saveData();
    }

    addExperience() {
        const newExp = {
            id: Date.now().toString(),
            title: '',
            company: '',
            start: '',
            end: '',
            location: '',
            description: '',
            bullets: [],
            mustInclude: false
        };
        this.app.profile.experiences.push(newExp);
        this.renderExperiences();
        this.app.saveData();
    }

    removeExperience(index) {
        this.app.profile.experiences.splice(index, 1);
        this.renderExperiences();
        this.app.saveData();
    }

    addExperienceBullet(expIndex) {
        if (!this.app.profile.experiences[expIndex].bullets) {
            this.app.profile.experiences[expIndex].bullets = [];
        }
        this.app.profile.experiences[expIndex].bullets.push('');
        this.renderExperiences();
        this.app.saveData();
    }

    removeExperienceBullet(expIndex, bulletIndex) {
        this.app.profile.experiences[expIndex].bullets.splice(bulletIndex, 1);
        this.renderExperiences();
        this.app.saveData();
    }

    renderProjects() {
        const container = document.getElementById('projects-container');
        if (!container) return;
        
        container.innerHTML = '';

        this.app.profile.projects.forEach((project, index) => {
            const projectEl = this.createProjectElement(project, index);
            container.appendChild(projectEl);
        });
    }

    createProjectElement(project, index) {
        const esc = escapeHTML;
        const div = document.createElement('div');
        div.className = 'project-card';
        div.innerHTML = `
            <div class="card-header">
                <div class="card-title">
                    <input type="text" placeholder="Project Name" value="${esc(project.name)}" data-field="name" data-index="${index}">
                    <textarea placeholder="Project description (what it does, technologies used)..." style="margin-top: 0.5rem; min-height: 60px;" data-field="description" data-index="${index}">${esc(project.description)}</textarea>
                </div>
                <div class="card-actions">
                    <label class="must-include-label">
                        <input type="checkbox" class="must-include-proj" data-index="${index}" ${project.mustInclude ? 'checked' : ''}>
                        Must include
                    </label>
                    <button class="btn btn-secondary btn-sm add-bullet" data-index="${index}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        Add detail
                    </button>
                    <button class="btn btn-danger btn-sm remove-project" data-index="${index}">Remove</button>
                </div>
            </div>
            <div class="bullet-list" data-index="${index}">
                <label>Key details / achievements</label>
                ${(project.bullets || []).map((bullet, bulletIndex) => `
                    <div class="bullet-item">
                        <input type="text" placeholder="Technical detail, impact, or achievement..." value="${esc(bullet)}" data-bullet-index="${bulletIndex}">
                        <button class="bullet-remove" data-proj-index="${index}" data-bullet-index="${bulletIndex}" aria-label="Remove detail ${bulletIndex + 1}">&times;</button>
                    </div>
                `).join('')}
            </div>
        `;

        // Add event listeners
        div.querySelectorAll('input[data-field], textarea[data-field]').forEach(input => {
            input.addEventListener('input', (e) => {
                const field = e.target.dataset.field;
                this.app.profile.projects[index][field] = e.target.value;
                this.app.saveData();
            });
        });

        div.querySelectorAll('input[data-bullet-index]').forEach(input => {
            input.addEventListener('input', (e) => {
                const bulletIndex = parseInt(e.target.dataset.bulletIndex);
                this.app.profile.projects[index].bullets[bulletIndex] = e.target.value;
                this.app.saveData();
            });
        });

        div.querySelector('.add-bullet').addEventListener('click', () => {
            this.addProjectBullet(index);
        });

        div.querySelector('.remove-project').addEventListener('click', () => {
            this.removeProject(index);
        });

        div.querySelector('.must-include-proj').addEventListener('change', (e) => {
            this.app.profile.projects[index].mustInclude = e.target.checked;
            this.app.saveData();
        });

        div.querySelectorAll('.bullet-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const projIndex = parseInt(e.target.dataset.projIndex);
                const bulletIndex = parseInt(e.target.dataset.bulletIndex);
                this.removeProjectBullet(projIndex, bulletIndex);
            });
        });

        this.labelFields(div);
        return div;
    }

    addProject() {
        const newProject = {
            id: Date.now().toString(),
            name: '',
            description: '',
            bullets: [],
            mustInclude: false
        };
        this.app.profile.projects.push(newProject);
        this.renderProjects();
        this.app.saveData();
    }

    removeProject(index) {
        this.app.profile.projects.splice(index, 1);
        this.renderProjects();
        this.app.saveData();
    }

    addProjectBullet(projIndex) {
        if (!this.app.profile.projects[projIndex].bullets) {
            this.app.profile.projects[projIndex].bullets = [];
        }
        this.app.profile.projects[projIndex].bullets.push('');
        this.renderProjects();
        this.app.saveData();
    }

    removeProjectBullet(projIndex, bulletIndex) {
        this.app.profile.projects[projIndex].bullets.splice(bulletIndex, 1);
        this.renderProjects();
        this.app.saveData();
    }

    // Extras Management
    renderExtras() {
        const container = document.getElementById('extras-container');
        if (!container) return;
        
        container.innerHTML = '';

        this.app.profile.extras.forEach((extra, index) => {
            const extraEl = this.createExtraElement(extra, index);
            container.appendChild(extraEl);
        });
    }

    createExtraElement(extra, index) {
        const esc = escapeHTML;
        const div = document.createElement('div');
        div.className = 'experience-card';
        div.innerHTML = `
            <div class="card-header">
                <div class="card-title">
                    <input type="text" placeholder="Title/Type (e.g., Research Assistant, Certification)" value="${esc(extra.title)}" data-field="title" data-index="${index}">
                    <input type="text" placeholder="Organization/Institution" value="${esc(extra.organization)}" data-field="organization" data-index="${index}">
                    <div class="input-row input-row-3">
                        <select data-field="type" data-index="${index}" aria-label="Type">
                            ${EXTRA_TYPES.map(([value, label]) =>
                                `<option value="${value}" ${extra.type === value ? 'selected' : ''}>${label}</option>`
                            ).join('')}
                        </select>
                        <input type="text" placeholder="Start Date" value="${esc(extra.start)}" data-field="start" data-index="${index}">
                        <input type="text" placeholder="End Date (or 'Present')" value="${esc(extra.end)}" data-field="end" data-index="${index}">
                    </div>
                    <textarea placeholder="Description of the experience, achievement, or certification..." style="margin-top: 0.5rem; min-height: 80px;" data-field="description" data-index="${index}">${esc(extra.description)}</textarea>
                </div>
                <div class="card-actions">
                    <button class="btn btn-danger btn-sm remove-extra" data-index="${index}">Remove</button>
                </div>
            </div>
        `;

        // Add event listeners
        div.querySelectorAll('input[data-field], textarea[data-field], select[data-field]').forEach(input => {
            input.addEventListener('input', (e) => {
                const field = e.target.dataset.field;
                const extraIndex = parseInt(e.target.dataset.index);
                this.app.profile.extras[extraIndex][field] = e.target.value;
                this.app.saveData();
            });
            
            input.addEventListener('change', (e) => {
                const field = e.target.dataset.field;
                const extraIndex = parseInt(e.target.dataset.index);
                this.app.profile.extras[extraIndex][field] = e.target.value;
                this.app.saveData();
            });
        });

        div.querySelector('.remove-extra').addEventListener('click', () => {
            this.removeExtra(index);
        });

        this.labelFields(div);
        return div;
    }

    addExtra() {
        const newExtra = {
            id: Date.now().toString(),
            title: '',
            organization: '',
            type: 'program',
            start: '',
            end: '',
            description: ''
        };
        this.app.profile.extras.push(newExtra);
        this.renderExtras();
        this.app.saveData();
    }

    removeExtra(index) {
        this.app.profile.extras.splice(index, 1);
        this.renderExtras();
        this.app.saveData();
    }

    saveProfile() {
        this.app.saveData();
        this.app.showStatus('Profile saved successfully!', 'success');
        setTimeout(() => {
            const statusEl = document.getElementById('generation-status');
            if (statusEl) {
                statusEl.textContent = '';
            }
        }, 3000);
    }
}
