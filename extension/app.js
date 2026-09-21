// Cover Letter Generator App Logic

class CoverLetterApp {
    static EXTRA_TYPES = [
        ['research', 'Research'],
        ['program', 'Program'],
        ['certification', 'Certification'],
        ['award', 'Award'],
        ['publication', 'Publication'],
        ['leadership', 'Leadership'],
        ['volunteer', 'Volunteer'],
        ['other', 'Other']
    ];

    constructor() {
        this.profile = {
            name: '',
            contact: '',
            location: '',
            summary: '',
            education: [],
            skills: [],
            experiences: [],
            projects: [],
            extras: []
        };
        this.currentView = 'cover-letter'; // 'cover-letter' or 'resume'
        this.uploadedResume = null; // { name, size, uploadedAt, dataBase64 }
        this.onboarding = null;     // { seen, installedAt, completedAt?, checklistDismissed?, firstGeneratedAt? }
        this.apiKey = null;         // { value, last4, savedAt, verifiedAt?, verifyError? } — value is never rendered
        this.companyBriefs = {};    // { [companyLower]: brief } — cached research, expires after 30 days
        this.researchEnabled = true;
        this.lastApiCall = null;
        this.lastResume = null;      // { resumeContent, jobText, company, role, generatedAt } — base for the next revision
        this.reuseResume = true;     // "Revise the last resume" toggle
        this.ignoredKeywords = [];   // posting terms the user said do not apply; never asked about again
        
        // Initialize after a brief delay to ensure DOM is ready
        setTimeout(() => this.init(), 100);
    }

    async init() {
        // Wait for DOM to be fully loaded
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve);
            });
        }
        
        await this.loadData();
        this.setupEventListeners();
        this.setupAutosave();
        this.renderProfile();
        this.restoreLastResume();
        this.maybeStartOnboarding();
        this.renderChecklist();
    }

    // Data Management
    async loadData() {
        try {
        const result = await chrome.storage.local.get(['profile', 'uploadedResume', 'onboarding', 'apiKey', 'companyBriefs', 'researchEnabled', 'lastResume', 'reuseResume', 'ignoredKeywords']);
        this.onboarding = result.onboarding || null;
        this.apiKey = result.apiKey || null;
        this.companyBriefs = this.pruneBriefs(result.companyBriefs || {});
        this.researchEnabled = result.researchEnabled !== false;
        this.lastResume = result.lastResume && result.lastResume.resumeContent ? result.lastResume : null;
        this.reuseResume = result.reuseResume !== false;
        this.ignoredKeywords = Array.isArray(result.ignoredKeywords) ? result.ignoredKeywords : [];
        if (result.uploadedResume) {
            this.uploadedResume = result.uploadedResume;
        }
        if (result.profile) {
            // shallow merge first
            this.profile = { 
                ...this.profile,
                ...result.profile
            };
            this.profile.education = this.migrateEducation(result.profile.education);
            }
        }  catch (e) { console.error('Error loading data:', e); }
    }


    async saveData() {
        try {
            await chrome.storage.local.set({
                profile: this.profile
            });
        } catch (error) {
            console.error('Error saving data:', error);
        }
    }

    setupAutosave() {
        let saveTimeout;
        const autosave = () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                this.saveData();
            }, 1000); // 1 second debounce
        };

        // Autosave on profile field changes
        const profileFields = [
            'profile-name',
            'profile-contact',
            'profile-location',
            'profile-summary'
        ];
        profileFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('input', autosave);
            }
        });

        // Autosave on job text changes
        const jobTextArea = document.getElementById('job-text');
        if (jobTextArea) {
            jobTextArea.addEventListener('input', autosave);
        }
    }

    // Event Listeners
    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Profile management
        document.getElementById('save-profile')?.addEventListener('click', () => {
            this.saveProfile();
        });

        // Guided tour replay
        document.getElementById('help-tour')?.addEventListener('click', () => {
            this.startTour();
        });

        // Company research toggle
        const researchToggle = document.getElementById('research-company');
        if (researchToggle) {
            researchToggle.checked = this.researchEnabled;
            researchToggle.addEventListener('change', (e) => {
                this.researchEnabled = e.target.checked;
                chrome.storage.local.set({ researchEnabled: this.researchEnabled }).catch?.(() => {});
            });
        }

        // Revise-the-last-resume toggle (row is hidden until a resume exists)
        const reuseToggle = document.getElementById('reuse-resume');
        if (reuseToggle) {
            reuseToggle.checked = this.reuseResume;
            reuseToggle.addEventListener('change', (e) => {
                this.reuseResume = e.target.checked;
                chrome.storage.local.set({ reuseResume: this.reuseResume }).catch?.(() => {});
            });
        }
        this.renderReuseRow();

        // Keyword check modal: resolved by promptForKeywords()
        document.getElementById('keywords-close')?.addEventListener('click', () => this.resolveKeywords(null));
        document.getElementById('keywords-cancel')?.addEventListener('click', () => this.resolveKeywords(null));
        document.getElementById('keywords-continue')?.addEventListener('click', () => this.resolveKeywords(this.readKeywordChoices()));
        document.getElementById('keywords-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'keywords-modal') this.resolveKeywords(null);
        });
        document.getElementById('ignored-keywords-reset')?.addEventListener('click', async () => {
            this.ignoredKeywords = [];
            await chrome.storage.local.set({ ignoredKeywords: [] });
            this.renderSettings();
        });

        // Settings / API key
        document.getElementById('open-settings')?.addEventListener('click', () => this.openSettings());
        document.getElementById('settings-close')?.addEventListener('click', () => this.closeSettings());
        document.getElementById('settings-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal') this.closeSettings();
        });
        document.getElementById('api-key-save')?.addEventListener('click', () => this.saveApiKey());
        document.getElementById('api-key-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.saveApiKey(); }
        });
        document.getElementById('api-key-replace')?.addEventListener('click', () => this.renderSettings({ replacing: true }));
        document.getElementById('api-key-cancel')?.addEventListener('click', () => this.renderSettings());
        document.getElementById('api-key-remove')?.addEventListener('click', () => this.removeApiKey());

        document.getElementById('checklist-dismiss')?.addEventListener('click', () => {
            this.saveOnboarding({ checklistDismissed: true });
            this.renderChecklist();
        });

        // Resume upload
        document.getElementById('upload-resume')?.addEventListener('click', () => {
            document.getElementById('resume-file').click();
        });

        document.getElementById('resume-file')?.addEventListener('change', (e) => {
            this.handleResumeUpload(e.target.files[0]);
            e.target.value = ''; // allow re-selecting the same file
        });

        document.getElementById('view-resume')?.addEventListener('click', () => {
            this.viewUploadedResume();
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

        // Cover letter generation
        document.getElementById('generate-btn')?.addEventListener('click', () => {
            this.generateCoverLetter();
        });

        document.getElementById('download-pdf')?.addEventListener('click', () => {
            this.downloadPDF();
        });

        // Resume generation
        document.getElementById('generate-resume-btn')?.addEventListener('click', () => {
            this.generateResume();
        });

        document.getElementById('download-resume-pdf')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.downloadResumePDF();
            return false; // extra belt & suspenders
        });

        // Error handling
        document.getElementById('retry-btn')?.addEventListener('click', () => {
            this.hideError();
            this.generateCoverLetter();
        });

        document.getElementById('save-logs-btn')?.addEventListener('click', () => {
            this.saveLogs();
        });

        document.querySelector('.modal-close')?.addEventListener('click', () => {
            this.hideError();
        });

        // Profile field updates
        document.getElementById('profile-name')?.addEventListener('input', (e) => {
            this.profile.name = e.target.value;
            this.renderChecklist();
        });

        document.getElementById('profile-contact')?.addEventListener('input', (e) => {
            this.profile.contact = e.target.value;
        });

        document.getElementById('profile-location')?.addEventListener('input', (e) => {
            this.profile.location = e.target.value;
        });

        document.getElementById('profile-summary')?.addEventListener('input', (e) => {
            this.profile.summary = e.target.value;
        });
    }

    // UI Management
    switchTab(tabName) {
        try {
            // Update tab buttons
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            const activeTabBtn = document.querySelector(`[data-tab="${tabName}"]`);
            if (activeTabBtn) activeTabBtn.classList.add('active');

            // Update tab content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            const activeTabContent = document.getElementById(`${tabName}-tab`);
            if (activeTabContent) activeTabContent.classList.add('active');

            if (tabName === 'profile') this.renderChecklist();
        } catch (error) {
            console.error('Error switching tabs:', error);
        }
    }

    // ---- ATS keyword check ----------------------------------------------------

    // Reads the posting, then asks about any ATS terms the profile does not
    // mention. Returns { match, profile, added } to generate with, or null if
    // the user cancelled. Accepted terms are saved to the profile's skills.
    async checkKeywords(jobText) {
        this.showStatus('Reading the posting…', 'loading');
        const { analyzeJob, missingKeywords, applyKeywords } = await this.generation();
        const match = await analyzeJob(this.apiKey.value, { profile: this.profile, jobText });
        const missing = missingKeywords(match, this.profile, { ignored: this.ignoredKeywords });
        if (!missing.length) return { match, profile: this.profile, added: [] };

        this.hideLoading();
        const choice = await this.promptForKeywords(missing);
        this.showLoading();
        if (!choice) return null;

        const applied = applyKeywords(match, this.profile, choice.accepted);
        if (applied.added.length) {
            this.profile = applied.profile;
            this.renderSkills();
            await this.saveData();
        }
        if (choice.remember) {
            const rejected = missing.filter(kw => !choice.accepted.includes(kw));
            if (rejected.length) {
                this.ignoredKeywords = [...new Set([...this.ignoredKeywords, ...rejected])];
                await chrome.storage.local.set({ ignoredKeywords: this.ignoredKeywords });
            }
        }
        return { match: applied.match, profile: this.profile, added: applied.added };
    }

    promptForKeywords(keywords) {
        const list = document.getElementById('keywords-list');
        const modal = document.getElementById('keywords-modal');
        if (!list || !modal) return Promise.resolve({ accepted: [], remember: false });
        list.innerHTML = '';
        keywords.forEach((kw, i) => {
            const label = document.createElement('label');
            label.className = 'keyword-chip';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.dataset.index = String(i);
            label.appendChild(input);
            label.appendChild(document.createTextNode(kw));
            list.appendChild(label);
        });
        this._keywordOptions = keywords;
        const remember = document.getElementById('keywords-remember');
        if (remember) remember.checked = true;
        modal.classList.remove('hidden');
        return new Promise((resolve) => { this._keywordResolve = resolve; });
    }

    readKeywordChoices() {
        const accepted = [...document.querySelectorAll('#keywords-list input:checked')]
            .map(el => this._keywordOptions[Number(el.dataset.index)]).filter(Boolean);
        return { accepted, remember: Boolean(document.getElementById('keywords-remember')?.checked) };
    }

    resolveKeywords(choice) {
        document.getElementById('keywords-modal')?.classList.add('hidden');
        const resolve = this._keywordResolve;
        this._keywordResolve = null;
        if (resolve) resolve(choice);
    }

    // ---- Last resume (base for revisions) --------------------------------------

    renderReuseRow() {
        const row = document.getElementById('reuse-resume-row');
        const hint = document.getElementById('reuse-resume-hint');
        if (!row) return;
        row.classList.toggle('hidden', !this.lastResume);
        if (hint && this.lastResume) {
            const target = [this.lastResume.role, this.lastResume.company].filter(Boolean).join(' at ');
            hint.textContent = target ? `(last: ${target})` : '';
        }
    }

    async rememberResume(result, jobText) {
        this.lastResume = {
            resumeContent: result.resumeContent,
            jobText,
            company: result.matchAnalysis?.company || '',
            role: result.matchAnalysis?.role || '',
            generatedAt: result.metadata?.generatedAt || new Date().toISOString()
        };
        this.renderReuseRow();
        try {
            await chrome.storage.local.set({ lastResume: this.lastResume });
        } catch (error) {
            console.error('Error saving last resume:', error);
        }
    }

    // Puts the last resume back in the preview after a reload, without
    // switching tabs, so it can be downloaded or revised straight away.
    restoreLastResume() {
        if (!this.lastResume) return;
        const previewEl = document.querySelector('.resume-content');
        if (!previewEl) return;
        previewEl.innerHTML = this.formatResume(this.lastResume.resumeContent);
        this.lastRenderedResumeHTML = previewEl.innerHTML;
        this.lastApiCall = { request: { jobText: this.lastResume.jobText }, response: { resumeContent: this.lastResume.resumeContent }, timestamp: this.lastResume.generatedAt };
        this.switchToResumeView();
        const downloadBtn = document.getElementById('download-resume-pdf');
        if (downloadBtn) downloadBtn.disabled = false;
    }

    showLoading() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    }

    hideLoading() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }

    showError(message, canRetry = true) {
        const errorMessage = document.getElementById('error-message');
        const retryBtn = document.getElementById('retry-btn');
        const errorModal = document.getElementById('error-modal');
        
        if (errorMessage) errorMessage.textContent = message;
        if (retryBtn) retryBtn.style.display = canRetry ? 'inline-flex' : 'none';
        if (errorModal) errorModal.classList.remove('hidden');
    }

    hideError() {
        const errorModal = document.getElementById('error-modal');
        if (errorModal) errorModal.classList.add('hidden');
    }

    // Status shown inside the Profile tab (the generation status lives in the Generate tab).
    showProfileStatus(message, type = 'loading') {
        const statusEl = document.getElementById('profile-status');
        if (!statusEl) return;
        clearTimeout(this._profileStatusTimer);
        statusEl.textContent = message;
        statusEl.className = `status-message status-${type}`;
        statusEl.classList.remove('hidden');
        if (type !== 'loading') {
            this._profileStatusTimer = setTimeout(() => statusEl.classList.add('hidden'), 8000);
        }
    }

    showStatus(message, type = 'loading') {
        const statusEl = document.getElementById('generation-status');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = `status-message status-${type}`;
            statusEl.classList.remove('hidden');
            
            // Auto-hide success messages after 3 seconds
            if (type === 'success') {
                setTimeout(() => {
                    statusEl.classList.add('hidden');
                }, 3000);
            }
        }
    }

    // Profile Management
    renderProfile() {
        // Safely set profile field values
        const setFieldValue = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.value = value || '';
        };
        
        setFieldValue('profile-name', this.profile.name);
        setFieldValue('profile-contact', this.profile.contact);
        setFieldValue('profile-location', this.profile.location);
        setFieldValue('profile-summary', this.profile.summary);
        
        this.renderUploadedResume();
        this.renderChecklist();
        this.renderEducation();
        this.renderSkills();
        this.renderExperiences();
        this.renderProjects();
        this.renderExtras();
    }

    renderSkills() {
        const container = document.getElementById('skills-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.profile.skills.forEach((skill, index) => {
            const skillEl = document.createElement('div');
            skillEl.className = 'skill-tag';
            skillEl.innerHTML = `
                ${skill}
                <button class="skill-remove" data-index="${index}">&times;</button>
            `;
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
        if (skill && !this.profile.skills.includes(skill)) {
            this.profile.skills.push(skill);
            this.renderSkills();
            this.saveData();
        }
    }

    removeSkill(index) {
        this.profile.skills.splice(index, 1);
        this.renderSkills();
        this.saveData();
    }

    renderExperiences() {
        const container = document.getElementById('experiences-container');
        if (!container) return;
        
        container.innerHTML = '';

        this.profile.experiences.forEach((exp, index) => {
            const expEl = this.createExperienceElement(exp, index);
            container.appendChild(expEl);
        });
    }

    createExperienceElement(exp, index) {
        const div = document.createElement('div');
        div.className = 'experience-card glass-elevated';
        div.innerHTML = `
            <div class="card-header">
                <div class="card-title">
                    <input type="text" placeholder="Job Title" value="${exp.title || ''}" data-field="title" data-index="${index}">
                    <input type="text" placeholder="Company" value="${exp.company || ''}" data-field="company" data-index="${index}">
                    <div class="input-row input-row-3">
                        <input type="text" placeholder="Start Date" value="${exp.start || ''}" data-field="start" data-index="${index}">
                        <input type="text" placeholder="End Date" value="${exp.end || ''}" data-field="end" data-index="${index}">
                        <input type="text" placeholder="Location" value="${exp.location || ''}" data-field="location" data-index="${index}">
                    </div>
                    <textarea placeholder="Role description (what you did in this role)..." style="margin-top: 0.5rem; min-height: 60px;" data-field="description" data-index="${index}">${(exp.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                </div>
                <div class="card-actions">
                    <label class="must-include-label">
                        <input type="checkbox" class="must-include-exp" data-index="${index}" ${exp.mustInclude ? 'checked' : ''}>
                        Must Include
                    </label>
                    <button class="btn btn-secondary btn-sm btn-ripple add-bullet" data-index="${index}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        Add Achievement
                    </button>
                    <button class="btn btn-danger btn-sm btn-ripple remove-experience" data-index="${index}">Remove</button>
                </div>
            </div>
            <div class="bullet-list" data-index="${index}">
                <label>Key Achievements</label>
                ${(exp.bullets || []).map((bullet, bulletIndex) => `
                    <div class="bullet-item">
                        <input type="text" placeholder="Specific achievement with metrics if possible..." value="${bullet}" data-bullet-index="${bulletIndex}">
                        <button class="bullet-remove" data-exp-index="${index}" data-bullet-index="${bulletIndex}">&times;</button>
                    </div>
                `).join('')}
            </div>
        `;

        // Add event listeners
        div.querySelectorAll('input[data-field], textarea[data-field]').forEach(input => {
            input.addEventListener('input', (e) => {
                const field = e.target.dataset.field;
                const expIndex = parseInt(e.target.dataset.index);
                this.profile.experiences[expIndex][field] = e.target.value;
                this.saveData();
            });
        });

        div.querySelectorAll('input[data-bullet-index]').forEach(input => {
            input.addEventListener('input', (e) => {
                const expIndex = index;
                const bulletIndex = parseInt(e.target.dataset.bulletIndex);
                this.profile.experiences[expIndex].bullets[bulletIndex] = e.target.value;
                this.saveData();
            });
        });

        div.querySelector('.add-bullet').addEventListener('click', () => {
            this.addExperienceBullet(index);
        });

        div.querySelector('.remove-experience').addEventListener('click', () => {
            this.removeExperience(index);
        });

        div.querySelector('.must-include-exp').addEventListener('change', (e) => {
            this.profile.experiences[index].mustInclude = e.target.checked;
            this.saveData();
        });

        div.querySelectorAll('.bullet-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const expIndex = parseInt(e.target.dataset.expIndex);
                const bulletIndex = parseInt(e.target.dataset.bulletIndex);
                this.removeExperienceBullet(expIndex, bulletIndex);
            });
        });

        return div;
    }

    // Education was a single object before multi-entry support; convert
    // legacy saves to a one-element array so nothing is lost.
    migrateEducation(education) {
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

    renderEducation() {
        const container = document.getElementById('education-container');
        if (!container) return;

        container.innerHTML = '';

        this.profile.education.forEach((edu, index) => {
            container.appendChild(this.createEducationElement(edu, index));
        });
    }

    createEducationElement(edu, index) {
        const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const div = document.createElement('div');
        div.className = 'experience-card glass-elevated';
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
                    <button class="btn btn-danger btn-sm btn-ripple remove-education" data-index="${index}">Remove</button>
                </div>
            </div>
        `;

        div.querySelectorAll('input[data-field]').forEach(input => {
            input.addEventListener('input', (e) => {
                this.profile.education[index][e.target.dataset.field] = e.target.value;
                this.saveData();
            });
        });

        div.querySelector('.remove-education').addEventListener('click', () => {
            this.removeEducation(index);
        });

        return div;
    }

    addEducation() {
        this.profile.education.push({
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
        this.saveData();
    }

    removeEducation(index) {
        this.profile.education.splice(index, 1);
        this.renderEducation();
        this.saveData();
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
        this.profile.experiences.push(newExp);
        this.renderExperiences();
        this.saveData();
    }

    removeExperience(index) {
        this.profile.experiences.splice(index, 1);
        this.renderExperiences();
        this.saveData();
    }

    addExperienceBullet(expIndex) {
        if (!this.profile.experiences[expIndex].bullets) {
            this.profile.experiences[expIndex].bullets = [];
        }
        this.profile.experiences[expIndex].bullets.push('');
        this.renderExperiences();
        this.saveData();
    }

    removeExperienceBullet(expIndex, bulletIndex) {
        this.profile.experiences[expIndex].bullets.splice(bulletIndex, 1);
        this.renderExperiences();
        this.saveData();
    }

    renderProjects() {
        const container = document.getElementById('projects-container');
        if (!container) return;
        
        container.innerHTML = '';

        this.profile.projects.forEach((project, index) => {
            const projectEl = this.createProjectElement(project, index);
            container.appendChild(projectEl);
        });
    }

    createProjectElement(project, index) {
        const div = document.createElement('div');
        div.className = 'project-card glass-elevated';
        div.innerHTML = `
            <div class="card-header">
                <div class="card-title">
                    <input type="text" placeholder="Project Name" value="${project.name || ''}" data-field="name" data-index="${index}">
                    <textarea placeholder="Project description (what it does, technologies used)..." style="margin-top: 0.5rem; min-height: 60px;" data-field="description" data-index="${index}">${(project.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                </div>
                <div class="card-actions">
                    <label class="must-include-label">
                        <input type="checkbox" class="must-include-proj" data-index="${index}" ${project.mustInclude ? 'checked' : ''}>
                        Must Include
                    </label>
                    <button class="btn btn-secondary btn-sm btn-ripple add-bullet" data-index="${index}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        Add Detail
                    </button>
                    <button class="btn btn-danger btn-sm btn-ripple remove-project" data-index="${index}">Remove</button>
                </div>
            </div>
            <div class="bullet-list" data-index="${index}">
                <label>Key Details / Achievements</label>
                ${(project.bullets || []).map((bullet, bulletIndex) => `
                    <div class="bullet-item">
                        <input type="text" placeholder="Technical detail, impact, or achievement..." value="${bullet}" data-bullet-index="${bulletIndex}">
                        <button class="bullet-remove" data-proj-index="${index}" data-bullet-index="${bulletIndex}">&times;</button>
                    </div>
                `).join('')}
            </div>
        `;

        // Add event listeners
        div.querySelectorAll('input[data-field], textarea[data-field]').forEach(input => {
            input.addEventListener('input', (e) => {
                const field = e.target.dataset.field;
                this.profile.projects[index][field] = e.target.value;
                this.saveData();
            });
        });

        div.querySelectorAll('input[data-bullet-index]').forEach(input => {
            input.addEventListener('input', (e) => {
                const bulletIndex = parseInt(e.target.dataset.bulletIndex);
                this.profile.projects[index].bullets[bulletIndex] = e.target.value;
                this.saveData();
            });
        });

        div.querySelector('.add-bullet').addEventListener('click', () => {
            this.addProjectBullet(index);
        });

        div.querySelector('.remove-project').addEventListener('click', () => {
            this.removeProject(index);
        });

        div.querySelector('.must-include-proj').addEventListener('change', (e) => {
            this.profile.projects[index].mustInclude = e.target.checked;
            this.saveData();
        });

        div.querySelectorAll('.bullet-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const projIndex = parseInt(e.target.dataset.projIndex);
                const bulletIndex = parseInt(e.target.dataset.bulletIndex);
                this.removeProjectBullet(projIndex, bulletIndex);
            });
        });

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
        this.profile.projects.push(newProject);
        this.renderProjects();
        this.saveData();
    }

    removeProject(index) {
        this.profile.projects.splice(index, 1);
        this.renderProjects();
        this.saveData();
    }

    addProjectBullet(projIndex) {
        if (!this.profile.projects[projIndex].bullets) {
            this.profile.projects[projIndex].bullets = [];
        }
        this.profile.projects[projIndex].bullets.push('');
        this.renderProjects();
        this.saveData();
    }

    removeProjectBullet(projIndex, bulletIndex) {
        this.profile.projects[projIndex].bullets.splice(bulletIndex, 1);
        this.renderProjects();
        this.saveData();
    }

    // Extras Management
    renderExtras() {
        const container = document.getElementById('extras-container');
        if (!container) return;
        
        container.innerHTML = '';

        this.profile.extras.forEach((extra, index) => {
            const extraEl = this.createExtraElement(extra, index);
            container.appendChild(extraEl);
        });
    }

    createExtraElement(extra, index) {
        const div = document.createElement('div');
        div.className = 'experience-card glass-elevated';
        div.innerHTML = `
            <div class="card-header">
                <div class="card-title">
                    <input type="text" placeholder="Title/Type (e.g., Research Assistant, Certification)" value="${extra.title || ''}" data-field="title" data-index="${index}">
                    <input type="text" placeholder="Organization/Institution" value="${extra.organization || ''}" data-field="organization" data-index="${index}">
                    <div class="input-row input-row-3">
                        <select data-field="type" data-index="${index}">
                            ${CoverLetterApp.EXTRA_TYPES.map(([value, label]) =>
                                `<option value="${value}" ${extra.type === value ? 'selected' : ''}>${label}</option>`
                            ).join('')}
                        </select>
                        <input type="text" placeholder="Start Date" value="${extra.start || ''}" data-field="start" data-index="${index}">
                        <input type="text" placeholder="End Date (or 'Present')" value="${extra.end || ''}" data-field="end" data-index="${index}">
                    </div>
                    <textarea placeholder="Description of the experience, achievement, or certification..." style="margin-top: 0.5rem; min-height: 80px;" data-field="description" data-index="${index}">${(extra.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                </div>
                <div class="card-actions">
                    <button class="btn btn-danger btn-sm btn-ripple remove-extra" data-index="${index}">Remove</button>
                </div>
            </div>
        `;

        // Add event listeners
        div.querySelectorAll('input[data-field], textarea[data-field], select[data-field]').forEach(input => {
            input.addEventListener('input', (e) => {
                const field = e.target.dataset.field;
                const extraIndex = parseInt(e.target.dataset.index);
                this.profile.extras[extraIndex][field] = e.target.value;
                this.saveData();
            });
            
            input.addEventListener('change', (e) => {
                const field = e.target.dataset.field;
                const extraIndex = parseInt(e.target.dataset.index);
                this.profile.extras[extraIndex][field] = e.target.value;
                this.saveData();
            });
        });

        div.querySelector('.remove-extra').addEventListener('click', () => {
            this.removeExtra(index);
        });

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
        this.profile.extras.push(newExtra);
        this.renderExtras();
        this.saveData();
    }

    removeExtra(index) {
        this.profile.extras.splice(index, 1);
        this.renderExtras();
        this.saveData();
    }

    saveProfile() {
        this.saveData();
                this.showStatus('Profile saved successfully!', 'success');
                setTimeout(() => {
                    const statusEl = document.getElementById('generation-status');
                    if (statusEl) {
                        statusEl.textContent = '';
                    }
                }, 3000);
    }

    // Settings / API key
    // The key value lives in chrome.storage.local and is only ever read back
    // to send to OpenAI; the UI shows the last four characters.
    openSettings() {
        this.renderSettings();
        document.getElementById('settings-modal')?.classList.remove('hidden');
        if (!this.apiKey) document.getElementById('api-key-input')?.focus();
    }

    closeSettings() {
        document.getElementById('settings-modal')?.classList.add('hidden');
        const input = document.getElementById('api-key-input');
        if (input) input.value = '';
    }

    renderSettings({ replacing = false } = {}) {
        const resetBtn = document.getElementById('ignored-keywords-reset');
        if (resetBtn) {
            const n = this.ignoredKeywords.length;
            resetBtn.disabled = n === 0;
            resetBtn.textContent = n ? `Ask again about ${n} skipped term${n === 1 ? '' : 's'}` : 'No skipped terms';
        }
        const saved = document.getElementById('api-key-saved');
        const entry = document.getElementById('api-key-entry');
        const cancel = document.getElementById('api-key-cancel');
        const input = document.getElementById('api-key-input');
        if (!saved || !entry) return;

        const hasKey = !!(this.apiKey && this.apiKey.value);
        saved.classList.toggle('hidden', !hasKey || replacing);
        entry.classList.toggle('hidden', hasKey && !replacing);
        cancel?.classList.toggle('hidden', !(hasKey && replacing));
        if (input) input.value = '';
        if (replacing) input?.focus();

        if (hasKey) {
            const masked = document.getElementById('api-key-masked');
            if (masked) masked.textContent = `sk-••••••••••••${this.apiKey.last4}`;
            this.renderApiKeyStatus();
        }
    }

    renderApiKeyStatus(override) {
        const el = document.getElementById('api-key-status');
        if (!el) return;
        const status = override || this.describeApiKeyStatus();
        el.textContent = status.text;
        el.className = `api-key-status${status.kind ? ` ${status.kind}` : ''}`;
    }

    describeApiKeyStatus() {
        if (!this.apiKey) return { text: '', kind: '' };
        if (this.apiKey.verifiedAt) {
            return { text: `Verified ${new Date(this.apiKey.verifiedAt).toLocaleDateString()}`, kind: 'ok' };
        }
        if (this.apiKey.verifyError) return { text: this.apiKey.verifyError, kind: 'error' };
        if (this.apiKey.verifyNote) return { text: this.apiKey.verifyNote, kind: '' };
        return { text: `Saved ${new Date(this.apiKey.savedAt).toLocaleDateString()} · not verified yet`, kind: '' };
    }

    async saveApiKey() {
        const input = document.getElementById('api-key-input');
        const value = (input?.value || '').trim();
        if (!value) { this.showError('Paste your API key first.', false); return; }
        if (!/^sk-[A-Za-z0-9_-]{10,}$/.test(value)) {
            this.showError('That does not look like an OpenAI API key (they start with "sk-").', false);
            return;
        }

        this.apiKey = { value, last4: value.slice(-4), savedAt: new Date().toISOString() };
        await this.persistApiKey();
        if (input) input.value = '';
        this.renderSettings();
        this.renderChecklist();

        this.renderApiKeyStatus({ text: 'Verifying…', kind: '' });
        await this.verifyApiKey();
        this.renderApiKeyStatus();
        this.renderChecklist();
    }

    async removeApiKey() {
        this.apiKey = null;
        try {
            await chrome.storage.local.remove('apiKey');
        } catch (error) {
            console.error('Error removing API key:', error);
        }
        this.renderSettings();
        this.renderChecklist();
    }

    async persistApiKey() {
        try {
            await chrome.storage.local.set({ apiKey: this.apiKey });
        } catch (error) {
            console.error('Error saving API key:', error);
        }
    }

    // The generation pipeline (extension/generation/) is an ES module; app.js is
    // a classic script, so it is imported on first use and cached.
    generation() {
        if (!this._generation) this._generation = import('./generation/pipeline.js');
        return this._generation;
    }

    // Makes one tiny OpenAI request with the key. A network failure is
    // reported as such, not treated as an invalid key.
    async verifyApiKey() {
        if (!this.apiKey) return;
        try {
            const { verifyKey } = await this.generation();
            const data = await verifyKey(this.apiKey.value);
            this.apiKey = { ...this.apiKey, verifiedAt: new Date().toISOString(), verifyError: null, verifyNote: null, model: data.model || null };
        } catch (error) {
            if (error.status === 401) {
                this.apiKey = { ...this.apiKey, verifiedAt: null, verifyNote: null, verifyError: error.message };
            } else {
                this.apiKey = { ...this.apiKey, verifiedAt: null, verifyError: null, verifyNote: `Saved, not verified: ${error.message}` };
            }
        }
        await this.persistApiKey();
    }

    requireApiKeyForGeneration() {
        if (this.apiKey?.value) return true;
        this.showError('Add your OpenAI API key in Settings (gear icon) before generating.', false);
        return false;
    }

    // Onboarding
    // First run = no onboarding record yet (installed before this feature) or
    // the background script seeded { seen: false } on install.
    maybeStartOnboarding() {
        const seen = this.onboarding && this.onboarding.seen;
        if (!seen) this.startTour();
    }

    async saveOnboarding(patch) {
        this.onboarding = { ...(this.onboarding || {}), ...patch };
        try {
            await chrome.storage.local.set({ onboarding: this.onboarding });
        } catch (error) {
            console.error('Error saving onboarding state:', error);
        }
    }

    markOnboardingSeen(skipped) {
        return this.saveOnboarding({ seen: true, completedAt: new Date().toISOString(), skipped: !!skipped });
    }

    // Getting Started checklist: ticks itself from live state and hides once
    // everything is done or the user dismisses it.
    checklistState() {
        return {
            resume: !!this.uploadedResume,
            name: !!(this.profile.name && this.profile.name.trim()),
            key: !!(this.apiKey && this.apiKey.value),
            generated: !!(this.onboarding && this.onboarding.firstGeneratedAt)
        };
    }

    renderChecklist() {
        const card = document.getElementById('getting-started');
        if (!card) return;
        const state = this.checklistState();
        const allDone = Object.values(state).every(Boolean);
        const dismissed = !!(this.onboarding && this.onboarding.checklistDismissed);

        if (allDone || dismissed) {
            card.classList.add('hidden');
            return;
        }

        card.querySelectorAll('li[data-item]').forEach(li => {
            li.classList.toggle('done', !!state[li.dataset.item]);
        });

        const hint = document.getElementById('checklist-key-hint');
        if (hint) {
            if (this.apiKey && this.apiKey.verifyError) hint.textContent = `— ${this.apiKey.verifyError}`;
            else if (this.apiKey && !this.apiKey.verifiedAt) hint.textContent = '— saved, not verified yet';
            else hint.textContent = '';
        }
        card.classList.remove('hidden');
    }

    recordFirstGeneration() {
        if (this.onboarding && this.onboarding.firstGeneratedAt) return;
        this.saveOnboarding({ firstGeneratedAt: new Date().toISOString() });
        this.renderChecklist();
    }

    tourSteps() {
        return [
            {
                target: null,
                title: 'Welcome to Resume Studio',
                body: `<p>Generate a tailored resume and cover letter for every job you apply to. It takes three steps:</p>
                       <ol>
                         <li><strong>Upload your current resume</strong> to fill in your profile automatically.</li>
                         <li><strong>Review and complete</strong> your profile — list every skill and experience you have, not just the ones on one resume.</li>
                         <li><strong>Paste a job description</strong> and generate.</li>
                       </ol>
                       <p>Generating needs an OpenAI API key (added in Settings); your profile and documents never leave this browser except to OpenAI when you generate.</p>`
            },
            {
                target: '#open-settings',
                title: 'Add your OpenAI API key',
                placement: 'bottom',
                body: '<p>Generating documents uses your own OpenAI account. Open Settings, paste a key from <code>platform.openai.com/api-keys</code>, and it is stored only in this browser. You can replace it later but never view it.</p>'
            },
            {
                target: '#upload-resume',
                tab: 'profile',
                title: 'Start with your resume',
                placement: 'bottom',
                body: '<p>Upload a PDF and your name, contact details, education, skills, experience and projects are filled in for you. Nothing is sent to the AI — parsing happens right here in the browser.</p><p>Upload a different resume later and only new items are added; nothing you entered is removed.</p>'
            },
            {
                target: '#skills-input',
                tab: 'profile',
                title: 'List every skill you have',
                placement: 'bottom',
                body: '<p>Your profile is the complete picture. Each generated resume picks the skills and experiences that fit the job, so the more you list here, the better the match.</p>'
            },
            {
                target: '#add-experience',
                tab: 'profile',
                title: 'Add and edit anything',
                placement: 'bottom',
                body: '<p>Every section has an Add button and every entry is editable. Tick <strong>Must Include</strong> on an experience or project to guarantee it appears on generated resumes.</p>'
            },
            {
                target: '#job-text',
                tab: 'generate',
                title: 'Paste the job description',
                placement: 'right',
                body: '<p>Include the title, company and requirements. The more of the posting you paste, the more precisely the documents are tailored.</p>'
            },
            {
                target: '.generation-buttons',
                tab: 'generate',
                title: 'Generate and download',
                placement: 'top',
                body: '<p>Cover letters are strategic pitches; resumes are one page and ATS-friendly. Both preview here and download as PDF.</p><p>You can replay this tour any time with the <strong>?</strong> button in the header.</p>'
            }
        ];
    }

    startTour() {
        if (typeof OnboardingTour === 'undefined') return;
        this.hideError();
        OnboardingTour.start(this.tourSteps(), {
            switchTab: (tab) => this.switchTab(tab),
            onFinish: ({ skipped }) => {
                this.markOnboardingSeen(skipped);
                this.switchTab('profile');
                window.scrollTo({ top: 0 });
            }
        });
    }

    // Company research cache
    pruneBriefs(briefs) {
        const maxAge = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const kept = {};
        for (const [key, brief] of Object.entries(briefs)) {
            const at = Date.parse(brief.researchedAt || 0);
            if (at && now - at < maxAge) kept[key] = brief;
        }
        return kept;
    }

    async cacheBrief(brief) {
        this.companyBriefs[brief.company.trim().toLowerCase()] = brief;
        try {
            await chrome.storage.local.set({ companyBriefs: this.companyBriefs });
        } catch (error) {
            console.error('Error caching company brief:', error);
        }
    }

    describeCoverLetterResult(result) {
        const meta = result.metadata || {};
        const parts = ['Cover letter generated'];
        if (meta.briefSource === 'research') {
            const n = meta.searches || 0;
            parts.push(`— researched ${result.companyBrief?.company || 'the company'} with ${n} web search${n === 1 ? '' : 'es'}`);
            if (result.companyBrief && !result.companyBrief.found) parts.push('(nothing reliable found; letter uses the posting only)');
        } else if (meta.briefSource === 'cache') {
            parts.push(`— used saved research for ${result.companyBrief?.company || 'the company'}`);
        }
        if (Array.isArray(result.unsourcedClaims) && result.unsourcedClaims.length) {
            parts.push(`· ${result.unsourcedClaims.length} sentence(s) could not be traced to your profile — check them before sending`);
        }
        return parts.join(' ') + '.';
    }

    // Resume Upload
    async handleResumeUpload(file) {
        if (!file) return;

        const MAX_BYTES = 20 * 1024 * 1024;
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (!isPdf) {
            this.showError('Please upload a PDF file.', false);
            return;
        }
        if (file.size > MAX_BYTES) {
            this.showError('That PDF is larger than 20 MB. Please upload a smaller file.', false);
            return;
        }

        try {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const magic = String.fromCharCode(...bytes.slice(0, 5));
            if (magic !== '%PDF-') {
                this.showError('That file does not look like a valid PDF.', false);
                return;
            }

            this.uploadedResume = {
                name: file.name,
                size: file.size,
                uploadedAt: new Date().toISOString(),
                dataBase64: this.bytesToBase64(bytes)
            };
            await this.saveUploadedResume();
            this.renderUploadedResume();

            await this.autofillFromResume(buffer);
        } catch (error) {
            console.error('Resume upload error:', error);
            this.showError(`Failed to upload resume: ${error.message}`);
        }
    }

    // Parse the uploaded PDF and fold the result into the profile additively.
    async autofillFromResume(buffer) {
        if (typeof pdfjsLib === 'undefined' || typeof ResumeParser === 'undefined' || typeof ProfileMerge === 'undefined') {
            this.showProfileStatus('Resume uploaded (parser unavailable).', 'success');
            return;
        }

        this.showProfileStatus('Reading your resume…', 'loading');
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
                ? chrome.runtime.getURL('pdf.worker.min.js')
                : 'pdf.worker.min.js';

        const { profile: parsed, meta } = await ResumeParser.parse(pdfjsLib, buffer);
        const { profile, report } = ProfileMerge.merge(this.profile, parsed);
        this.profile = profile;
        this.lastParseMeta = meta;

        this.renderProfile();
        await this.saveData();

        this.showProfileStatus(this.describeMergeReport(report, meta), 'success');
        if (meta.warnings.length) {
            console.warn('Resume parser warnings:', meta.warnings);
        }
    }

    describeMergeReport(report, meta) {
        const parts = [];
        const count = (label, r) => {
            if (!r) return;
            const bits = [];
            if (r.added) bits.push(`${r.added} new`);
            if (r.updated) bits.push(`${r.updated} updated`);
            if (bits.length) parts.push(`${label}: ${bits.join(', ')}`);
        };
        count('skills', report.skills);
        count('education', report.education);
        count('experience', report.experiences);
        count('projects', report.projects);
        count('extras', report.extras);

        const notes = meta.warnings.length ? ` ${meta.warnings.join(' ')}` : '';
        if (!parts.length) {
            return meta.warnings.length
                ? `Resume uploaded, but nothing could be parsed.${notes}`
                : 'Resume uploaded. Nothing new to add — your profile already has everything.';
        }
        return `Resume uploaded and profile updated (${parts.join('; ')}).${notes}`;
    }

    async saveUploadedResume() {
        try {
            await chrome.storage.local.set({ uploadedResume: this.uploadedResume });
        } catch (error) {
            console.error('Error saving uploaded resume:', error);
        }
    }

    renderUploadedResume() {
        const chip = document.getElementById('uploaded-resume');
        const label = document.getElementById('upload-resume-label');
        if (!chip) return;

        if (!this.uploadedResume) {
            chip.classList.add('hidden');
            if (label) label.textContent = 'Upload Resume';
            return;
        }

        const nameEl = document.getElementById('uploaded-resume-name');
        const metaEl = document.getElementById('uploaded-resume-meta');
        if (nameEl) nameEl.textContent = this.uploadedResume.name;
        if (metaEl) {
            const kb = Math.max(1, Math.round((this.uploadedResume.size || 0) / 1024));
            const date = this.uploadedResume.uploadedAt
                ? new Date(this.uploadedResume.uploadedAt).toLocaleDateString()
                : '';
            metaEl.textContent = `${kb} KB${date ? ` · ${date}` : ''}`;
        }
        chip.classList.remove('hidden');
        if (label) label.textContent = 'Replace Resume';
    }

    viewUploadedResume() {
        if (!this.uploadedResume?.dataBase64) {
            this.showError('No resume has been uploaded yet.', false);
            return;
        }
        const bytes = this.base64ToBytes(this.uploadedResume.dataBase64);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
            chrome.tabs.create({ url });
        } else {
            window.open(url, '_blank');
        }
        // Give the new tab time to load the blob before revoking
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    bytesToBase64(bytes) {
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    base64ToBytes(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    // Cover Letter Generation
    async generateCoverLetter() {
        const jobText = document.getElementById('job-text').value.trim();
        
        if (!jobText) {
            this.showError('Please enter a job description.', false);
            return;
        }

        if (!this.profile.name) {
            this.showError('Please complete your profile first.', false);
            return;
        }
        if (!this.requireApiKeyForGeneration()) return;

        this.showLoading();

        try {
            const checked = await this.checkKeywords(jobText);
            if (!checked) { this.showStatus('Cancelled.', 'error'); return; }
            this.showStatus('Generating cover letter...', 'loading');

            const requestData = {
                profile: checked.profile,
                jobText: jobText,
                research: this.researchEnabled,
                briefCache: this.companyBriefs,
                match: checked.match
            };

            this.lastApiCall = {
                request: requestData,
                timestamp: new Date().toISOString()
            };

            const { generateCoverLetter } = await this.generation();
            const result = await generateCoverLetter(this.apiKey.value, requestData);
            this.lastApiCall.response = result;
            this.lastMatchAnalysis = result.matchAnalysis || null; // kept for the Match panel (not yet shown)
            if (result.companyBrief && result.companyBrief.company) await this.cacheBrief(result.companyBrief);

            // Display the cover letter
            this.displayCoverLetter(result.coverLetter);
            this.switchToCoverLetterView();
            
            // Save data
            await this.saveData();

            this.showStatus(this.describeCoverLetterResult(result), 'success');
            this.recordFirstGeneration();
            const downloadBtn = document.getElementById('download-pdf');
            if (downloadBtn) downloadBtn.disabled = false;

        } catch (error) {
            console.error('Generation error:', error);
            this.showError(`Failed to generate cover letter: ${error.message}`);
            this.showStatus('Generation failed', 'error');
        } finally {
            this.hideLoading();
        }
    }

    displayCoverLetter(coverLetter) {
        // Switch to generate tab to ensure the preview element is visible
        this.switchTab('generate');
        
        // Wait a bit for tab switch to complete
        setTimeout(() => {
            const previewEl = document.querySelector('.letter-content');
            
            if (!previewEl) {
                console.error('Letter content element not found even after tab switch');
                return;
            }
            
            // Format the cover letter with proper structure
            const formattedLetter = this.formatCoverLetter(coverLetter);
            previewEl.innerHTML = formattedLetter;
        }, 100);
    }

    formatCoverLetter(coverLetter) {
        // Clean and properly format the cover letter
        const cleanLetter = coverLetter.trim();
        
        // Split into paragraphs using double line breaks
        const paragraphs = cleanLetter.split(/\n\n+/)
            .map(p => p.replace(/\n/g, ' ').trim())
            .filter(p => p.length > 10); // Filter out very short lines
        
        console.log('Formatting cover letter with', paragraphs.length, 'paragraphs');
        
        let formatted = `
            <div class="letter-header">
                <p><strong>${this.profile.name}</strong></p>
                <p>${this.profile.contact.replace(/\n/g, '<br>')}</p>
            </div>
            
            <div class="letter-date">
                <p>${new Date().toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                })}</p>
            </div>
            
            <p>Dear Hiring Manager,</p>
            
            <div class="letter-body">
        `;

        // Add each paragraph with proper spacing
        paragraphs.forEach((paragraph, index) => {
            if (paragraph.trim()) {
                console.log(`Paragraph ${index + 1}:`, paragraph.substring(0, 100) + '...');
                formatted += `<p style="margin-bottom: 1.5em; text-align: justify; line-height: 1.6;">${paragraph}</p>`;
            }
        });

        formatted += `
            </div>
            
            <div class="letter-closing" style="margin-top: 2em;">
                <p>Sincerely,</p>
                <br>
                <p>${this.profile.name}</p>
            </div>
        `;

        return formatted;
    }

    async downloadPDF() {
        try {
            // Show loading
            this.showStatus('Generating PDF...', 'loading');
            
            // Get the cover letter content
            const letterElement = document.querySelector('.letter-content');
            if (!letterElement) {
                throw new Error('No cover letter to download');
            }

            // Create PDF using jsPDF
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'in',
                format: 'letter'
            });

            // Set font
            doc.setFont('times', 'normal');
            doc.setFontSize(11);

            // Margins
            const leftMargin = 1;
            const rightMargin = 1;
            const topMargin = 0.75;
            const lineHeight = 0.2;
            const pageWidth = 8.5;
            const textWidth = pageWidth - leftMargin - rightMargin;

            let currentY = topMargin;

            // Add header (name and contact)
            doc.setFontSize(12);
            doc.setFont('times', 'bold');
            doc.text(this.profile.name, leftMargin, currentY);
            currentY += lineHeight;

            doc.setFontSize(11);
            doc.setFont('times', 'normal');
            
            // Add contact info
            const contactLines = this.profile.contact.split('\n');
            contactLines.forEach(line => {
                if (line.trim()) {
                    doc.text(line.trim(), leftMargin, currentY);
                    currentY += lineHeight;
                }
            });

            currentY += lineHeight; // Extra space

            // Add date
            const today = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
            doc.text(today, leftMargin, currentY);
            currentY += lineHeight * 2;

            // Add salutation
            doc.text('Dear Hiring Manager,', leftMargin, currentY);
            currentY += lineHeight * 2;

            // Get the actual generated cover letter from the formatted content
            const letterBodyDiv = letterElement.querySelector('.letter-body');
            let letterContent = '';
            
            if (letterBodyDiv) {
                // Extract just the paragraphs from the letter body
                const paragraphs = letterBodyDiv.querySelectorAll('p');
                letterContent = Array.from(paragraphs).map(p => p.textContent.trim()).filter(text => text).join('\n\n');
            } else {
                // Fallback: get all text and clean it
                letterContent = letterElement.textContent || letterElement.innerText;
                letterContent = letterContent
                    .replace(/Your generated cover letter will appear here\.\.\./, '')
                    .replace(/Harish Subburaj[\s\S]*?Dear Hiring Manager,/, '')
                    .replace(/Sincerely,[\s\S]*$/, '')
                    .trim();
            }

            // Split content into clean paragraphs
            const paragraphs = letterContent.split(/\n\s*\n/).filter(p => p.trim());

            // Add paragraphs with proper wrapping
            paragraphs.forEach(paragraph => {
                if (paragraph.trim()) {
                    const lines = doc.splitTextToSize(paragraph.trim(), textWidth);
                    lines.forEach(line => {
                        if (currentY > 10) { // If near bottom of page
                            doc.addPage();
                            currentY = topMargin;
                        }
                        doc.text(line, leftMargin, currentY);
                        currentY += lineHeight;
                    });
                    currentY += lineHeight; // Extra space between paragraphs
                }
            });

            // Add closing
            currentY += lineHeight;
            doc.text('Sincerely,', leftMargin, currentY);
            currentY += lineHeight * 3;
            doc.text(this.profile.name, leftMargin, currentY);

            // Generate filename
            const timestamp = new Date().toISOString().split('T')[0];
            const filename = `cover-letter-${timestamp}.pdf`;

            // Convert to blob
            const pdfBlob = doc.output('blob');
            
            // Create download URL
            const url = URL.createObjectURL(pdfBlob);
            
            // Use Chrome downloads API for direct download
            if (chrome && chrome.downloads) {
                chrome.downloads.download({
                    url: url,
                    filename: filename,
                    saveAs: false // Download directly to Downloads folder
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        console.error('Download failed:', chrome.runtime.lastError);
                        // Fallback to regular download
                        this.fallbackDownload(url, filename);
                    } else {
                        this.showStatus('PDF downloaded successfully!', 'success');
                        setTimeout(() => {
                            const statusEl = document.getElementById('generation-status');
                            if (statusEl) statusEl.textContent = '';
                        }, 3000);
                    }
                    
                    // Clean up
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                });
            } else {
                // Fallback for non-extension environment
                this.fallbackDownload(url, filename);
            }

        } catch (error) {
            console.error('PDF generation error:', error);
            this.showError('Failed to generate PDF. Please try again.');
            this.showStatus('PDF generation failed', 'error');
        }
    }

    fallbackDownload(url, filename) {
        // Fallback download method
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.showStatus('PDF downloaded successfully!', 'success');
        setTimeout(() => {
            const statusEl = document.getElementById('generation-status');
            if (statusEl) statusEl.textContent = '';
        }, 3000);
        
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Resume Generation Methods
   async generateResume() {
  const jobText = document.getElementById('job-text').value.trim();
  if (!jobText) { this.showError('Please enter a job description.', false); return; }
  if (!this.profile.name) { this.showError('Please complete your profile first.', false); return; }
  if (!this.requireApiKeyForGeneration()) return;

  this.showLoading();

  try {
    const checked = await this.checkKeywords(jobText);
    if (!checked) { this.showStatus('Cancelled.', 'error'); return; }
    const { match, profile } = checked;

    // Revise the last resume rather than starting over, unless the user opted out.
    const baseResume = this.reuseResume && this.lastResume ? this.lastResume.resumeContent : null;
    this.showStatus(baseResume ? 'Revising your resume…' : 'Generating resume...', 'loading');
    let result = await this.requestResume({ profile, jobText, match, baseResume });

    // The pipeline budgets by word count; only the rendered page knows whether it
    // actually fits. If it overflows, ask once more with a tighter ceiling — as a
    // revision of what it just produced, so the wording does not churn.
    let overflow = await this.renderResumeAndMeasure(result.resumeContent);
    let refit = false;
    if (overflow > 1.0 && result.metadata?.words) {
      const maxWords = Math.floor(result.metadata.words / overflow * 0.92);
      this.showStatus('Trimming to one page…', 'loading');
      const first = result.metadata;
      result = await this.requestResume({ profile, jobText, match, baseResume: result.resumeContent, budget: { maxWords } });
      result.metadata = { ...result.metadata, revised: first.revised, keptBullets: first.keptBullets, baseBullets: first.baseBullets };
      overflow = await this.renderResumeAndMeasure(result.resumeContent);
      refit = true;
    }

    this.lastApiCall.response = result;
    this.lastMatchAnalysis = result.matchAnalysis || null; // kept for the Match panel (not yet shown)
    this.switchToResumeView();

    await this.saveData();
    await this.rememberResume(result, jobText);

    this.showStatus(this.describeResumeResult(result, { overflow, refit, added: checked.added }), overflow > 1.0 ? 'error' : 'success');
    this.recordFirstGeneration();
    const downloadBtn = document.getElementById('download-resume-pdf');
    if (downloadBtn) downloadBtn.disabled = false;

  } catch (error) {
    console.error('Resume generation error:', error);
    this.showError(`Failed to generate resume: ${error.message}`);
    this.showStatus('Resume generation failed', 'error');
  } finally {
    this.hideLoading();
  }
}


    async requestResume(body) {
        this.lastApiCall = { request: body, timestamp: new Date().toISOString() };
        const { generateResume } = await this.generation();
        return generateResume(this.apiKey.value, body);
    }

    // Renders the resume and returns rendered height / one Letter page (1.0 = exactly fits).
    renderResumeAndMeasure(resumeContent) {
        return new Promise((resolve) => {
            const onRendered = () => {
                document.removeEventListener('resume-rendered', onRendered);
                const page = document.querySelector('.resume-content .resume-page');
                if (!page) return resolve(0);
                // 11in at CSS 96dpi. Padding is inside the page box, so scrollHeight is the whole thing.
                resolve(page.scrollHeight / 1056);
            };
            document.addEventListener('resume-rendered', onRendered);
            // A display:none container has no height; show the resume view before rendering.
            this.switchToResumeView();
            this.displayResume(resumeContent);
        });
    }

    describeResumeResult(result, { overflow, refit, added = [] }) {
        const meta = result.metadata || {};
        const parts = [];
        const verb = meta.revised ? 'revised' : 'generated';
        if (overflow > 1.0) {
            parts.push(`Resume ${verb}, but it still runs to ${overflow.toFixed(1)} pages — remove a bullet or two in your profile, or mark fewer items Must Include.`);
        } else {
            parts.push(refit ? `Resume ${verb} and trimmed to fit one page.` : `Resume ${verb}.`);
        }
        if (meta.revised && meta.baseBullets) {
            parts.push(`Kept ${meta.keptBullets} of ${meta.baseBullets} bullets from the previous version.`);
        }
        if (added.length) {
            parts.push(`Added to your skills: ${added.join(', ')}.`);
        }
        if (meta.words && meta.words < 450 && meta.usedBullets >= meta.availableBullets) {
            parts.push(`It uses everything in your profile (${meta.words} words); a full page is usually 550–700. Add more achievements, coursework, or certifications to your profile to fill it.`);
        }
        return parts.join(' ');
    }

    displayResume(resumeContent) {
        // Switch to generate tab to ensure the preview element is visible
        this.switchTab('generate');
        
        // Wait a bit for tab switch to complete
        setTimeout(() => {
            const previewEl = document.querySelector('.resume-content');
            
            if (!previewEl) {
                console.error('Resume content element not found even after tab switch');
                return;
            }
            
            // Format the resume with proper structure
            const formattedResume = this.formatResume(resumeContent);
            previewEl.innerHTML = formattedResume;

            // cache + log exactly what the user sees
            this.lastRenderedResumeHTML = previewEl.innerHTML;
            console.log('[PREVIEW] render len:', this.lastRenderedResumeHTML.length);
            console.log('[PREVIEW] head:', this.lastRenderedResumeHTML.slice(0, 180));

            // notify that the preview is ready (optional; useful to re-enable the PDF button)
            document.dispatchEvent(new CustomEvent('resume-rendered'));


            // cache + log the exact preview HTML we just rendered
            this.lastRenderedResumeHTML = previewEl.innerHTML;
            console.log('[PREVIEW] render len:', this.lastRenderedResumeHTML.length);
            document.dispatchEvent(new CustomEvent('resume-rendered'));
        }, 100);



    }

    formatResume(resumeContent) {
        // Parse the JSON resume content
        let resume;
        let eduList = [];
        try {
            resume = typeof resumeContent === 'string' ? JSON.parse(resumeContent) : resumeContent;
            console.log('Parsed resume data:', resume); // Debug log

            // Normalize education to a list of entries with consistent keys. The
            // model may return an array or a single object; fall back to the
            // profile's own entries when it returns nothing.
            const fromModel = Array.isArray(resume.education)
                ? resume.education
                : (resume.education ? [resume.education] : []);
            const source = fromModel.length ? fromModel : (this.profile.education || []);
            eduList = source.map(e => ({
                school: e.school || e.university || e.institution || '',
                location: e.location || '',
                dates: e.dates || e.graduation || (e.start && e.end ? `${e.start} - ${e.end}` : e.end || ''),
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

        let formatted = `
            <div class="resume-page" style="
                font-family: ${baseFont};
                color: #000;
                line-height: ${lineHeight};
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
                    ">${this.profile.name}</h1>
                    <div style="
                        margin: 0;
                        font-size: ${contactFontSize};
                        line-height: 1.3;
                    ">${this.formatContactLine()}</div>
                    ${resume.summary ? `<div style="
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
                    ">SKILLS & INTERESTS</h2>
                    <div style="font-size: ${bodyFontSize};">
                        ${this.formatSkillsComprehensive(resume.skills)}
                    </div>
                </div>` : ''}

               

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
                ">EDUCATION & HONORS</h2>
                ${eduList.map(edu => `
                <div class="education-entry" style="margin-bottom: ${entrySpacing};">
                    <div style="display: flex; justify-content: space-between; align-items: baseline;">
                        <span style="font-size: ${contactFontSize}; font-weight: bold;">
                        ${edu.school}${edu.location ? ` – ${edu.location}` : ''}
                        </span>
                        <span style="font-size: ${contactFontSize};">
                        ${edu.dates ? `Graduation Date: ${edu.dates}` : ''}
                        </span>
                    </div>
                    ${edu.degree ? `<div style="font-size: ${contactFontSize}; font-style: italic; margin: 0.1em 0;">${edu.degree}</div>` : ''}
                    ${edu.major ? `<div style="font-size: ${contactFontSize}; font-weight: bold;">Major: ${edu.major}</div>` : ''}
                    ${edu.minor ? `<div style="font-size: ${contactFontSize}; font-weight: bold;">Minor: ${edu.minor}</div>` : ''}
                    ${edu.gpa ? `<div style="font-size: ${contactFontSize}; margin: 0.2em 0 0 0;">GPA: ${edu.gpa}</div>` : ''}
                    ${(edu.honors || edu.coursework) ? `
                    <div style="font-size: ${bodyFontSize}; margin: 0.3em 0 0 0;">
                        ${edu.honors ? `• ${edu.honors}<br>` : ''}
                        ${edu.coursework ? `• Relevant Coursework: ${edu.coursework}` : ''}
                    </div>` : ''}
                </div>`).join('')}
                </div>` : ''}




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
                    ">EXPERIENCE</h2>
                    ${resume.experience.map(exp => `
                        <div class="experience-entry" style="margin-bottom: ${entrySpacing};">
                            <div style="display: flex; justify-content: space-between; align-items: baseline;">
                                <span style="font-size: ${contactFontSize}; font-weight: bold;">
                                    ${exp.company}${exp.location ? ` – ${exp.location}` : ''}
                                </span>
                                <span style="font-size: ${contactFontSize};">
                                    ${exp.dates || ''}
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
                                ${exp.bullets.map(bullet => `<li style="margin-bottom: 0.1em;">${bullet}</li>`).join('')}
                            </ul>
                        </div>
                    `).join('')}
                </div>` : ''}

                <!-- Projects Section -->
                ${resume.projects && resume.projects.length > 0 ? `
                <div class="resume-section" style="margin-bottom: ${sectionSpacing};">
                    <h2 style="
                        margin: 0 0 0.4em 0;
                        font-size: ${sectionHeaderSize};
                        font-weight: bold;
                        text-transform: uppercase;
                        border-bottom: 1pt solid #000;
                        padding-bottom: 2pt;6
                    ">PROJECTS</h2>
                    ${resume.projects.map(proj => `
                        <div class="project-entry" style="margin-bottom: ${entrySpacing};">
                            <div style="font-size: ${contactFontSize}; font-weight: bold; margin-bottom: 0.1em;">
                                ${proj.name}${proj.link ? ` | ${proj.link}` : ''}
                            </div>
                            <ul style="
                                margin: 0;
                                padding-left: 1.2em;
                                font-size: ${bodyFontSize};
                                line-height: ${lineHeight};
                            ">
                                ${proj.bullets.map(bullet => `<li style="margin-bottom: 0.1em;">${bullet}</li>`).join('')}
                            </ul>
                        </div>
                    `).join('')}
                </div>` : ''}

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
                        ">PROGRAMS / CERTIFICATIONS</h2>
                        <div style="font-size: ${bodyFontSize}; margin-bottom: 0.3em; line-height: 1.3;">
                            <strong>Paycom – Technology Summer Engagement Program – Austin, Texas</strong> – Jun 2025<br>
                            • Selected participant in Paycom’s multi-day tech immersion program. Completed workshops on secure documentation and compliance strategies.<br>
                            • Collaborated with a student team to design and pitch a feature concept to Paycom engineers, gaining feedback on Agile teamwork and presentation skills.
                        </div>
                        </div>
                    ` : ''
                    }
                    </div>
                </div>
            </div>
        `;

        return formatted;
    }

    formatContactLine() {
        const contactParts = [];
        
        // Add location first if available
        if (this.profile.location && this.profile.location.trim()) {
            contactParts.push(this.profile.location.trim());
        }
        
        // Parse contact information
        const lines = this.profile.contact.split('\n');
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed && trimmed !== 'undefined' && trimmed !== 'null') {
                if (trimmed.includes('@')) {
                    contactParts.push(trimmed); // Email
                } else if (trimmed.match(/\d{3}.*\d{3}.*\d{4}/)) {
                    contactParts.push(trimmed); // Phone
                } else if (trimmed.includes('linkedin.com')) {
                    contactParts.push(trimmed.includes('http') ? 'LinkedIn' : trimmed);
                } else if (trimmed.includes('github.com')) {
                    contactParts.push(trimmed.includes('http') ? 'GitHub' : trimmed);
                } else if (trimmed.length > 0) {
                    contactParts.push(trimmed);
                }
            }
        });
        
        // Filter out any empty or invalid parts
        const validParts = contactParts.filter(part => 
            part && part.trim() && part !== 'undefined' && part !== 'null'
        );
        
        return validParts.join(' | ');
    }

    formatSkillsComprehensive(skills) {
        // Format skills as comprehensive grouped lines like the sample
        if (Array.isArray(skills) && skills.length > 0 && typeof skills[0] === 'string' && skills[0].includes(':')) {
            // Skills already come grouped from API
            return skills.map(skillLine => 
                `<p style="margin: 0 0 0.2em 0; line-height: 1.3;"><strong>${skillLine.split(':')[0]}:</strong> ${skillLine.split(':')[1]}</p>`
            ).join('');
        } else {
            // Fallback: group skills manually
            return `<p style="margin: 0; line-height: 1.3;"><strong>Technical Skills:</strong> ${skills.join(', ')}</p>`;
        }
    }

    switchToResumeView() {
        this.currentView = 'resume';
        
        // Hide cover letter elements
        const coverLetterPreview = document.getElementById('cover-letter-preview');
        const downloadCoverLetterBtn = document.getElementById('download-pdf');
        
        if (coverLetterPreview) coverLetterPreview.classList.add('hidden');
        if (downloadCoverLetterBtn) downloadCoverLetterBtn.classList.add('hidden');
        
        // Show resume elements
        const resumePreview = document.getElementById('resume-preview');
        const downloadResumeBtn = document.getElementById('download-resume-pdf');
        const previewTitle = document.getElementById('preview-title');
        
        if (resumePreview) resumePreview.classList.remove('hidden');
        if (downloadResumeBtn) downloadResumeBtn.classList.remove('hidden');
        if (previewTitle) previewTitle.textContent = 'Resume Preview';
    }

    switchToCoverLetterView() {
        this.currentView = 'cover-letter';
        
        // Show cover letter elements
        const coverLetterPreview = document.getElementById('cover-letter-preview');
        const downloadCoverLetterBtn = document.getElementById('download-pdf');
        
        if (coverLetterPreview) coverLetterPreview.classList.remove('hidden');
        if (downloadCoverLetterBtn) downloadCoverLetterBtn.classList.remove('hidden');
        
        // Hide resume elements
        const resumePreview = document.getElementById('resume-preview');
        const downloadResumeBtn = document.getElementById('download-resume-pdf');
        const previewTitle = document.getElementById('preview-title');
        
        if (resumePreview) resumePreview.classList.add('hidden');
        if (downloadResumeBtn) downloadResumeBtn.classList.add('hidden');
        if (previewTitle) previewTitle.textContent = 'Cover Letter Preview';
    }

// Opens the rendered resume in print.html, where Chrome's print dialog saves
// it as a text-based PDF. The markup is passed through session storage (an
// extension page cannot be handed a document directly).
async downloadResumePDF() {
  try {
    const page = document.querySelector('.resume-content .resume-page');
    if (!page) throw new Error('No resume preview found.');

    const name = (this.profile.name || '').trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
    await chrome.storage.session.set({
      printJob: { html: page.outerHTML, title: name ? `${name} - Resume` : 'Resume' }
    });
    await chrome.tabs.create({ url: chrome.runtime.getURL('print.html'), active: true });

    this.showStatus('Print view opened — choose "Save as PDF" as the destination.', 'success');
  } catch (err) {
    console.error('Resume PDF error:', err);
    this.showError('Failed to open the resume for printing: ' + err.message);
  }
}



    async renderHTMLToPDF(doc, element) {
        // alias element as node so both names work safely
        const node = element;

        if (!node) {
            throw new Error('renderHTMLToPDF: no element/node passed');
        }

        
        console.log('[renderHTMLToPDF] got node?', !!node, 'len=', node?.innerHTML?.length);
        console.log('[renderHTMLToPDF] head=', node?.innerHTML?.slice(0, 180));
        // ... existing code ...


        // Professional resume PDF rendering with exact preview matching
        const leftMargin = 36; // 0.5 inch in points
        const rightMargin = 36;
        const topMargin = 54;
        const pageWidth = 612; // Letter size width in points
        const pageHeight = 792; // Letter size height in points
        const textWidth = pageWidth - leftMargin - rightMargin;
        
        let currentY = topMargin;
        
        // Extract and render each section
        const header = element.querySelector('.resume-header');
        if (header) {
            currentY = await this.renderSection(doc, header, currentY, leftMargin, textWidth);
        }
        
        const sections = element.querySelectorAll('.resume-section');
        for (const section of sections) {
            currentY = await this.renderSection(doc, section, currentY, leftMargin, textWidth);
        }
    }

    async renderSection(doc, section, startY, leftMargin, textWidth) {
        let currentY = startY;
        
        // Handle headers
        const h1 = section.querySelector('h1');
        const h2 = section.querySelector('h2');
        const h3Elements = section.querySelectorAll('h3');
        
        if (h1) {
            doc.setFont('times', 'bold');
            doc.setFontSize(18);
            const text = h1.textContent.trim();
            doc.text(text, leftMargin + (textWidth - doc.getTextWidth(text)) / 2, currentY);
            currentY += 20;
        }
        
        if (h2) {
            doc.setFont('times', 'bold');
            doc.setFontSize(11);
            const text = h2.textContent.trim();
            doc.text(text, leftMargin, currentY);
            doc.line(leftMargin, currentY + 3, leftMargin + textWidth, currentY + 3);
            currentY += 18;
        }
        
        // Handle paragraphs
        const paragraphs = section.querySelectorAll('p');
        paragraphs.forEach(p => {
            if (!p.closest('div[style*="flex"]')) { // Skip paragraphs inside flex containers
                doc.setFont('times', 'normal');
                doc.setFontSize(10);
                const text = p.textContent.trim();
                if (text) {
                    const lines = doc.splitTextToSize(text, textWidth);
                    lines.forEach(line => {
                        doc.text(line, leftMargin, currentY);
                        currentY += 12;
                    });
                }
            }
        });
        
        // Handle experience/project entries
        const entries = section.querySelectorAll('.experience-entry, .project-entry');
        entries.forEach(entry => {
            const titleLine = entry.querySelector('div[style*="flex"]');
            if (titleLine) {
                const title = titleLine.querySelector('span:first-child');
                const date = titleLine.querySelector('span:last-child');
                
                if (title) {
                    doc.setFont('times', 'bold');
                    doc.setFontSize(11);
                    doc.text(title.textContent.trim(), leftMargin, currentY);
                }
                
                if (date) {
                    doc.setFont('times', 'normal');
                    doc.setFontSize(11);
                    const dateText = date.textContent.trim();
                    const dateWidth = doc.getTextWidth(dateText);
                    doc.text(dateText, leftMargin + textWidth - dateWidth, currentY);
                }
                
                currentY += 14;
            }
            
            // Handle role/project title
            const roleTitle = entry.querySelector('div[style*="italic"]');
            if (roleTitle) {
                doc.setFont('times', 'italic');
                doc.setFontSize(11);
                doc.text(roleTitle.textContent.trim(), leftMargin, currentY);
                currentY += 12;
            }
            
            // Handle project name (non-italic)
            const projectTitle = entry.querySelector('div[style*="font-weight: bold"]:not([style*="italic"])');
            if (projectTitle && !roleTitle) {
                doc.setFont('times', 'bold');
                doc.setFontSize(11);
                doc.text(projectTitle.textContent.trim(), leftMargin, currentY);
                currentY += 12;
            }
            
            // Handle bullets
            const bullets = entry.querySelectorAll('li');
            bullets.forEach(bullet => {
                doc.setFont('times', 'normal');
                doc.setFontSize(10);
                const bulletText = `• ${bullet.textContent.trim()}`;
                const lines = doc.splitTextToSize(bulletText, textWidth - 20);
                lines.forEach((line, lineIndex) => {
                    doc.text(line, leftMargin + (lineIndex === 0 ? 0 : 20), currentY);
                    currentY += 12;
                });
            });
            
            currentY += 8; // Space between entries
        });
        
        currentY += 10; // Space between sections
        return currentY;
    }


    extractCompanyFromJob() {
        const jobText = document.getElementById('job-text')?.value || '';
        const companyMatch = jobText.match(/(?:company|organization|at|join)\s*:?\s*([A-Z][a-zA-Z\s&.,]+?)(?:\s|$|,|\.|!)/i) ||
                            jobText.match(/([A-Z][a-zA-Z\s&.,]{2,30})(?:\s+is\s+(?:seeking|looking|hiring))/i);
        return companyMatch ? companyMatch[1].trim().replace(/[.,!]$/, '') : '';
    }

    extractRoleFromJob() {
        const jobText = document.getElementById('job-text')?.value || '';
        const roleMatch = jobText.match(/(?:position|role|job title|title|hiring)\s*:?\s*([A-Z][a-zA-Z\s-]+?)(?:\s|$|,|\.|!|at)/i) ||
                         jobText.match(/(?:seeking|looking for|hiring)\s+(?:a|an)?\s*([A-Z][a-zA-Z\s-]+?)(?:\s+to|\s+who|$)/i);
        return roleMatch ? roleMatch[1].trim().replace(/[.,!-]$/, '') : '';
    }


    // Debug functionality
    saveLogs() {
        if (!this.lastApiCall) {
            this.showError('No recent API call to save logs for.', false);
            return;
        }

        const logs = {
            timestamp: this.lastApiCall.timestamp,
            request: this.lastApiCall.request,
            response: this.lastApiCall.response || 'No response received'
        };

        const dataStr = JSON.stringify(logs, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `cover-letter-logs-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
    }
}

// Initialize the app when DOM is loaded
function initApp() {
    try {
        new CoverLetterApp();
    } catch (error) {
        console.error('Failed to initialize Cover Letter App:', error);
        // Retry after a short delay
        setTimeout(initApp, 1000);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    // DOM is already loaded
    initApp();
}

//note for current version