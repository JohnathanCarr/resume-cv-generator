const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const { GENERATION_MODEL, VERIFY_MODEL, REASONING, MAX_COMPLETION_TOKENS } = require('./config');
const { analyzeMatch, renderMatchForPrompt } = require('./prompts/matchAnalysis');
const { buildResumeMessages, RESUME_SCHEMA, resumeBudget } = require('./prompts/resume');
const { buildCoverLetterMessages, COVER_LETTER_SCHEMA, unsourcedClaims } = require('./prompts/coverLetter');
const { researchCompany, briefFromPostingOnly, renderBriefForPrompt } = require('./prompts/companyResearch');

const app = express();
const PORT = 8787;

// The API key is supplied by the extension on every request as
// "Authorization: Bearer sk-...". It is never stored, logged or echoed here.
function requireApiKey(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing API key. Add your OpenAI key in the extension\'s Settings.' });
  }
  req.openai = new OpenAI({ apiKey: match[1] });
  next();
}

// OpenAI errors carry the key in some messages' request details; strip anything key-shaped.
function safeErrorMessage(error) {
  return String(error && error.message || 'Unknown error').replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***');
}

// Middleware
app.use(cors({
  origin: (origin, cb) => {
    // Allow extension origins and localhost in dev
    if (!origin) return cb(null, true);
    if (origin.startsWith('chrome-extension://')) return cb(null, true);
    if (/^http:\/\/localhost(:\d+)?$/i.test(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.use(express.json({ limit: '10mb' }));

// Request timeout middleware
const timeout = (ms) => (req, res, next) => {
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' });
    }
  }, ms);
  
  res.on('finish', () => clearTimeout(timer));
  next();
};

app.use(timeout(120000)); // 2 minute timeout for comprehensive resume generation

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Confirms a key works with one minimal request. Returns the model that answered.
app.post('/verifyKey', requireApiKey, async (req, res) => {
  try {
    const completion = await req.openai.chat.completions.create({
      model: VERIFY_MODEL,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      max_completion_tokens: MAX_COMPLETION_TOKENS.verify,
      reasoning_effort: REASONING.verify
    });
    res.json({ ok: true, model: completion.model });
  } catch (error) {
    const status = error.status === 401 ? 401 : 502;
    const message = error.status === 401
      ? 'OpenAI rejected this key. Check it and try again.'
      : `Could not reach OpenAI: ${safeErrorMessage(error)}`;
    res.status(status).json({ ok: false, error: message });
  }
});

// Words in every string of a generated resume.
function resumeWordCount(resume) {
  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    else if (typeof v === 'string') n += v.trim().split(/\s+/).filter(Boolean).length;
  };
  walk(resume);
  return n;
}

function bulletCount(resume) {
  return [...(resume.experience || []), ...(resume.projects || [])].reduce((a, e) => a + (e.bullets || []).length, 0);
}

// Runs one generation call with a strict schema and returns the parsed object.
async function generateStructured(openai, { messages, schema, schemaName, maxTokens }) {
  const completion = await openai.chat.completions.create({
    model: GENERATION_MODEL,
    reasoning_effort: REASONING.generate,
    max_completion_tokens: maxTokens,
    messages,
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }
  });
  const choice = completion.choices[0];
  if (choice.finish_reason === 'length') {
    throw Object.assign(new Error('The model ran out of room before finishing. Try again or shorten the job posting.'), { code: 'output_truncated' });
  }
  return { data: JSON.parse(choice.message.content), usage: completion.usage };
}

// Resume generation endpoint
app.post('/generateResume', requireApiKey, async (req, res) => {
  const startTime = Date.now();
  try {
    const { profile, jobText, budget: budgetOverride = {} } = req.body;
    if (!profile || !jobText) {
      return res.status(400).json({ error: 'Missing required fields: profile and jobText' });
    }
    console.log(`[${new Date().toISOString()}] Resume generation request started`);
    // The extension may pass budget.maxWords after measuring a rendered page that overflowed.
    const budget = resumeBudget(profile, budgetOverride);

    // Structured read of the posting against the profile; replaces regex guessing.
    const match = await analyzeMatch(req.openai, { profile, jobText });
    const matchText = renderMatchForPrompt(match);
    console.log(`Match: ${match.company || '(unnamed company)'} — ${match.role || '(unnamed role)'}; ${match.requirements.length} requirements, ${match.requirements.filter(r => r.strength !== 'none').length} supported`);

    const messages = buildResumeMessages({ profile, jobText, match, matchText, budget });
    let { data: resume } = await generateStructured(req.openai, {
      messages, schema: RESUME_SCHEMA, schemaName: 'resume', maxTokens: MAX_COMPLETION_TOKENS.resume
    });

    // Over the ceiling: one pass asking for whole bullets to be dropped, not truncated.
    let words = resumeWordCount(resume);
    let trimmed = false;
    if (words > budget.maxWords) {
      console.log(`Resume is ${words} words (max ${budget.maxWords}); requesting a trim`);
      const repair = await generateStructured(req.openai, {
        messages: [
          ...messages,
          { role: 'assistant', content: JSON.stringify(resume) },
          { role: 'user', content: `That is ${words} words; the maximum is ${budget.maxWords}. Remove the least relevant whole bullets (and coursework if needed) until it is under ${budget.maxWords} words. Do not shorten bullets mid-sentence and do not change anything else.` }
        ],
        schema: RESUME_SCHEMA, schemaName: 'resume', maxTokens: MAX_COMPLETION_TOKENS.resume
      });
      resume = repair.data;
      words = resumeWordCount(resume);
      trimmed = true;
    }

    const availableBullets = [...(profile.experiences || []), ...(profile.projects || [])].reduce((a, e) => a + (e.bullets || []).length, 0);

    // Well under target with material left over: one pass asking for more of the profile.
    let expanded = false;
    if (!trimmed && words < budget.targetWords * 0.7 && bulletCount(resume) < availableBullets) {
      console.log(`Resume is ${words} words with ${bulletCount(resume)}/${availableBullets} bullets used (target ${budget.targetWords}); requesting an expansion`);
      const expand = await generateStructured(req.openai, {
        messages: [
          ...messages,
          { role: 'assistant', content: JSON.stringify(resume) },
          { role: 'user', content: `That is ${words} words and uses ${bulletCount(resume)} of the profile's ${availableBullets} bullets; the target is about ${budget.targetWords} words. Add the most relevant of the remaining profile bullets, roles, projects, coursework or certifications until you are near the target (never over ${budget.maxWords}). Only material from the profile; do not lengthen existing bullets with new detail.` }
        ],
        schema: RESUME_SCHEMA, schemaName: 'resume', maxTokens: MAX_COMPLETION_TOKENS.resume
      });
      resume = expand.data;
      words = resumeWordCount(resume);
      expanded = true;
    }

    // Never show certifications the profile does not have.
    if (!(Array.isArray(profile.extras) && profile.extras.length)) resume.programs = [];
    const endTime = Date.now();
    console.log(`[${new Date().toISOString()}] Resume generated successfully in ${endTime - startTime}ms (${words} words, ${bulletCount(resume)}/${availableBullets} bullets)`);
    return res.json({
      resumeContent: resume,
      matchAnalysis: match,
      metadata: {
        generatedAt: new Date().toISOString(),
        processingTime: endTime - startTime,
        words,
        budget,
        usedBullets: bulletCount(resume),
        availableBullets,
        trimmed,
        expanded
      }
    });
  } catch (error) {
    console.error('Error generating resume:', safeErrorMessage(error));
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate resume', message: safeErrorMessage(error), code: error.code, timestamp: new Date().toISOString() });
    }
  }
});

// Cover letter generation endpoint
//
// Body: { profile, jobText, research?: boolean (default true), briefCache?: { [companyLower]: brief } }
// The extension caches briefs per company; a cached brief for the matched
// company is reused instead of searching again.
app.post('/generateCoverLetter', requireApiKey, async (req, res) => {
  const startTime = Date.now();
  try {
    const { profile, jobText, research = true, briefCache = {} } = req.body;
    if (!profile || !jobText) {
      return res.status(400).json({ error: 'Missing required fields: profile and jobText' });
    }
    console.log(`[${new Date().toISOString()}] Cover letter generation request started`);

    const match = await analyzeMatch(req.openai, { profile, jobText });
    const matchText = renderMatchForPrompt(match);
    console.log(`Match: ${match.company || '(unnamed company)'} — ${match.role || '(unnamed role)'}; ${match.requirements.length} requirements, ${match.requirements.filter(r => r.strength !== 'none').length} supported`);

    // Company brief: cached → researched → posting-only.
    let brief;
    let briefSource = 'posting';
    const cacheKey = (match.company || '').trim().toLowerCase();
    if (cacheKey && briefCache && briefCache[cacheKey]) {
      brief = briefCache[cacheKey];
      briefSource = 'cache';
    } else if (research && match.company) {
      try {
        brief = await researchCompany(req.openai, { company: match.company, role: match.role, aboutCompany: match.about_company, jobText });
        briefSource = 'research';
        console.log(`Research: ${match.company} — found=${brief.found}, searches=${brief.searches}`);
      } catch (error) {
        console.warn('Research failed, continuing with the posting only:', safeErrorMessage(error));
        brief = briefFromPostingOnly({ company: match.company, aboutCompany: match.about_company });
      }
    } else {
      brief = briefFromPostingOnly({ company: match.company, aboutCompany: match.about_company });
    }
    const briefText = renderBriefForPrompt(brief);

    const messages = buildCoverLetterMessages({ profile, jobText, match, matchText, briefText });
    let { data } = await generateStructured(req.openai, {
      messages, schema: COVER_LETTER_SCHEMA, schemaName: 'cover_letter', maxTokens: MAX_COMPLETION_TOKENS.coverLetter
    });

    // Every claim must trace to the profile, the posting, or the brief. One
    // repair pass; whatever is still unsourced is reported, not hidden.
    let bad = unsourcedClaims(data.claims, profile, brief);
    let repaired = false;
    if (bad.length) {
      console.log(`Cover letter: ${bad.length} unsourced claim(s); requesting a repair`);
      const repair = await generateStructured(req.openai, {
        messages: [
          ...messages,
          { role: 'assistant', content: JSON.stringify(data) },
          { role: 'user', content: `These sentences make claims that cannot be traced to the profile, the job posting, or the company brief:\n${bad.map(c => `- "${c.sentence}" (cited: ${c.source || 'nothing'})`).join('\n')}\n\nRewrite the letter so each of them is either removed or replaced with something you can source, keep everything else, and return the full letter and claims again.` }
        ],
        schema: COVER_LETTER_SCHEMA, schemaName: 'cover_letter', maxTokens: MAX_COMPLETION_TOKENS.coverLetter
      });
      data = repair.data;
      bad = unsourcedClaims(data.claims, profile, brief);
      repaired = true;
    }

    const endTime = Date.now();
    console.log(`[${new Date().toISOString()}] Cover letter generated successfully in ${endTime - startTime}ms`);
    res.json({
      coverLetter: data.coverLetter,
      claims: data.claims,
      unsourcedClaims: bad,
      matchAnalysis: match,
      companyBrief: brief,
      metadata: {
        generatedAt: new Date().toISOString(),
        processingTime: endTime - startTime,
        briefSource,
        searches: briefSource === 'research' ? brief.searches : 0,
        repaired
      }
    });
  } catch (error) {
    console.error('Error generating cover letter:', safeErrorMessage(error));
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate cover letter', message: safeErrorMessage(error), code: error.code, timestamp: new Date().toISOString() });
    }
  }
});


// === Resume PDF snapshot endpoint (unified render) ===
const puppeteer = require("puppeteer");

app.post("/pdf/fromHtml", async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: "Missing HTML content" });

  try {
    const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
    });

    await browser.close();

    // --- Server-side diagnostics (helps us confirm what we’re sending)
    const headAscii = pdf.slice(0, 8).toString("ascii");
    const headHex = pdf.slice(0, 16).toString("hex").replace(/(..)/g, "$1 ").trim();
    console.log("[fromHtml] PDF head(ascii) =", JSON.stringify(headAscii)); // should start with "%PDF-"
    console.log("[fromHtml] PDF head(hex)   =", headHex);
    console.log("[fromHtml] PDF length      =", pdf.length);

    // --- Ground-truth copy to disk (temporary debug)
    try { require("fs").writeFileSync("./_debug_server_resume.pdf", pdf); } catch {}

    // --- Send raw bytes without charset (use end(), not send())
    const headers = {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="Resume.pdf"',
      "Content-Length": pdf.length
    };
    res.writeHead(200, headers);
    res.end(pdf);
  } catch (err) {
    console.error("PDF generation error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to render PDF", details: err.message });
    }
  }
});



// Start server
app.listen(PORT, () => {
  console.log(`Cover Letter Proxy server running on http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log('API keys are supplied per request by the extension (Settings → OpenAI API key).');
});

module.exports = app;
