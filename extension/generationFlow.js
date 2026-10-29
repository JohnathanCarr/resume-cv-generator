// The generation flow shared by the cover letter and the resume. runGeneration()
// owns everything the two have in common: input checks, locking the page,
// step timing, the ATS keyword check, and the endings (done, cancelled,
// failed with Retry). A kind (COVER_LETTER, RESUME) supplies only what
// differs: an extra input check, a step before the keyword check, the
// generation itself, and its labels.
//
// The flow talks to the app (ResumeStudioApp) for UI and state: status
// messages, the error dialog, the progress strip, the keyword dialog,
// storage and the generation modules.
import { PAGE_PX, measureResumeHeight, measureLayout } from './preview/measure.js';

// A kind is { label, downloadButton, logLabel, errorPrefix, failedStatus,
// retry(app), missingInput?(app), prepare?(run), generate(run, checked) }.
// generate() returns the closing status { message, type }. run is
// { app, jobText, timed(name, fn), detail(name, parts) }.
export async function runGeneration(app, kind) {
    const jobText = document.getElementById('job-text').value.trim();
    if (!jobText) { app.showError('Please enter a job description.', false); return; }
    if (!app.profile.name) { app.showError('Please complete your profile first.', false); return; }
    const missing = kind.missingInput?.(app);
    if (missing) { app.showError(missing, false); return; }
    if (!app.requireApiKeyForGeneration()) return;

    app.showLoading();
    let outcome = 'failed';
    let timer = null;
    const run = {
        app,
        jobText,
        timed: (name, fn) => timer ? timer.step(name, fn) : fn(),
        detail: (name, parts) => timer?.detail(name, parts)
    };

    try {
        const { createTimer } = await app.generation();
        timer = createTimer();
        await kind.prepare?.(run);
        const checked = await checkKeywords(run);
        if (!checked) { outcome = 'cancelled'; app.progress.hide(); app.showStatus('Cancelled.', 'error'); return; }

        const { message, type } = await kind.generate(run, checked);
        app.showStatus(message, type);
        app.progress.done();
        outcome = 'done';
        app.recordFirstGeneration();
        const downloadBtn = document.getElementById(kind.downloadButton);
        if (downloadBtn) downloadBtn.disabled = false;
    } catch (error) {
        console.error(kind.logLabel, error);
        app.progress.fail();
        app.showError(`${kind.errorPrefix}${error.message}`, () => kind.retry(app));
        app.showStatus(kind.failedStatus, 'error');
    } finally {
        app.hideLoading();
        await reportTiming(app, timer, `${kind.label} ${outcome}`);
    }
}

// Reads the posting, then asks about any ATS terms the profile does not
// mention. Returns { match, profile, added } to generate with, or null if
// the user cancelled. Accepted terms are saved to the profile's skills.
export async function checkKeywords({ app, jobText, timed }) {
    app.showStatus('Reading the posting…', 'loading');
    app.progress.mark(0, 0.25, 2500);
    const { analyzeJob, missingKeywords, applyKeywords } = await app.generation();
    const match = await timed('read posting', () => analyzeJob(app.apiKey.value, { profile: app.profile, jobText }));
    const missing = missingKeywords(match, app.profile);
    if (!missing.length) return { match, profile: app.profile, added: [] };

    // The bar freezes, rather than disappearing, while the dialog is open.
    app.progress.pause();
    app.setPageInert(false);
    const choice = await timed('keyword check (you)', () => app.promptForKeywords(missing));
    app.setPageInert(true);
    app.progress.resume();
    if (!choice) return null;

    const applied = applyKeywords(match, app.profile, choice.accepted);
    if (applied.added.length) {
        app.profile = applied.profile;
        app.renderSkills();
        await app.saveData();
    }
    return { match: applied.match, profile: app.profile, added: applied.added };
}

// One console line per run, also kept on lastApiCall for Save logs.
async function reportTiming(app, timer, label) {
    if (!timer || !timer.steps.length) return;
    const { formatTimings } = await app.generation();
    const total = timer.totalMs();
    console.info(`[timing] ${label}: ${formatTimings(timer.steps, total)}`);
    if (app.lastApiCall) app.lastApiCall.timings = { steps: timer.steps, totalMs: total };
}

export const COVER_LETTER = {
    label: 'cover letter',
    downloadButton: 'download-pdf',
    logLabel: 'Generation error:',
    errorPrefix: 'Failed to generate cover letter: ',
    failedStatus: 'Generation failed',
    retry: (app) => app.generateCoverLetter(),

    async generate({ app, jobText, timed, detail }, checked) {
        app.showStatus('Generating cover letter...', 'loading');

        const requestData = {
            profile: checked.profile,
            jobText: jobText,
            research: app.researchEnabled,
            briefCache: app.companyBriefs,
            match: checked.match
        };

        app.lastApiCall = {
            request: requestData,
            timestamp: new Date().toISOString()
        };

        const { generateCoverLetter } = await app.generation();
        app.progress.mark(0.3, 0.85, app.researchEnabled ? 12000 : 7000);
        const result = await timed('cover letter', () => generateCoverLetter(app.apiKey.value, requestData));
        detail('cover letter', result.metadata?.timings);
        app.lastApiCall.response = result;
        app.lastMatchAnalysis = result.matchAnalysis || null; // kept for the Match panel (not yet shown)
        // Only fresh web research is cached; a posting-only brief must not
        // stand in for research on the next letter to this company.
        if (result.metadata?.briefSource === 'research' && result.companyBrief?.company) await app.cacheBrief(result.companyBrief);

        app.displayCoverLetter(result.coverLetter);
        app.switchToCoverLetterView();
        await app.saveData();

        return { message: app.describeCoverLetterResult(result), type: 'success' };
    }
};

export const RESUME = {
    label: 'resume',
    downloadButton: 'download-resume-pdf',
    logLabel: 'Resume generation error:',
    errorPrefix: 'Failed to generate resume: ',
    failedStatus: 'Resume generation failed',
    retry: (app) => app.generateResume(),

    missingInput: (app) => app.uploadedResume ? null
        : 'Upload your current resume in the Profile tab first. Its layout sets the page the generator writes to.',

    async prepare({ app, timed }) {
        if (!(await timed('load resume', () => app.ensureBaseline()))) {
            throw new Error('your uploaded resume could not be read. Try uploading it again in the Profile tab.');
        }
    },

    async generate({ app, jobText, timed, detail }, checked) {
        const { match, profile } = checked;

        // The resume is written for this posting from the whole profile. One
        // page is a hard limit, planned from the start: measure how the upload
        // lays out at print size (fonts, widths, line heights) and hand that to
        // the pipeline, which budgets the page and trims to fit.
        app.showStatus('Writing your resume for this posting…', 'loading');
        const { resumeDocToSchema } = await app.generation();
        const layout = await timed('measure layout', () => measureLayout(resumeDocToSchema(app.baselineResume.resume), app.profile));
        app.progress.mark(0.3, 0.7, 9000);
        let result = await timed('compose', () => app.requestResume({ profile, jobText, match, baseline: app.baselineResume, layout }));
        detail('compose', result.metadata?.timings);

        // Confirm on the real layout. The pipeline works from per-line
        // estimates; if the result still spills over, trim again locally with
        // the measured error folded in (no model call; twice at most).
        app.progress.mark(0.75, 0.9, 4000);
        let height = await timed('measure page', () => measureResumeHeight(result.resumeContent, app.profile));
        let refits = 0;
        while (height > PAGE_PX && refits < 2) {
            app.showStatus('Fitting it to one page…', 'loading');
            app.progress.mark(0.75, 0.9, 4000);
            const step = `refit ${refits + 1}`;
            const { refitComposedResume } = await app.generation();
            const measuredPx = height;
            result = await timed(step, () => refitComposedResume(result, { profile, layout, baseline: app.baselineResume, measuredPx }));
            detail(step, result.metadata?.timings);
            height = await timed('measure page', () => measureResumeHeight(result.resumeContent, app.profile));
            refits++;
        }
        const overflow = height / PAGE_PX;
        app.switchTab('generate');
        app.switchToResumeView();
        await timed('render preview', () => app.renderResumePreview(result));

        app.lastApiCall.response = result;
        app.lastMatchAnalysis = result.matchAnalysis || null; // kept for the Match panel (not yet shown)
        app.switchToResumeView();

        await app.saveData();
        await app.rememberResume(result, jobText);

        return {
            message: app.describeResumeResult(result, { overflow, added: checked.added }),
            type: overflow > 1 ? 'error' : 'success'
        };
    }
};
