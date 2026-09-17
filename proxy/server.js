const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const { GENERATION_MODEL, VERIFY_MODEL, REASONING, MAX_COMPLETION_TOKENS } = require('./config');
const { analyzeMatch, renderMatchForPrompt } = require('./prompts/matchAnalysis');
const { buildResumeMessages, RESUME_SCHEMA } = require('./prompts/resume');
const { buildCoverLetterMessages, COVER_LETTER_SCHEMA } = require('./prompts/coverLetter');

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

function truncateWords(s, maxWords = 20) {
  if (!s) return s;
  const parts = s.split(/\s+/);
  return parts.length <= maxWords ? s : parts.slice(0, maxWords).join(' ') + '…';
}
function capBullets(arr, maxCount, maxWords) {
  if (!Array.isArray(arr)) return arr;
  return arr.slice(0, maxCount).map(b => truncateWords(b, maxWords));
}
function approxCharCount(obj) {
  try { return JSON.stringify(obj).length; } catch { return 0; }
}
function trimResumeForOnePage(resume) {
  // Cap bullets per experience/project and bullet length
  if (Array.isArray(resume.experience)) {
    resume.experience = resume.experience.map(r => ({
      ...r,
      bullets: capBullets(r.bullets, 4, 22) // 3–4 bullets, ~22 words
    })).slice(0, 4); // cap number of roles (optional)
  }
  if (Array.isArray(resume.projects)) {
    resume.projects = resume.projects.map(p => ({
      ...p,
      bullets: capBullets(p.bullets, 3, 20) // 2–3 bullets, ~20 words
    })).slice(0, 3);
  }
  if (Array.isArray(resume.skills)) resume.skills = resume.skills.slice(0, 4); // 3–4 lines
  // Light global size guard (roughly keeps JSON small ~ one page when rendered)
  let size = approxCharCount(resume);
  const limit = 8000; // tune as needed for your renderer
  if (size > limit && Array.isArray(resume.experience)) {
    resume.experience = resume.experience.slice(0, 3);
    size = approxCharCount(resume);
  }
  return resume;
}

// profile.education is an array of institutions (older saves may still send
// a single object); render every entry as one line for the prompts.
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
    const { profile, jobText } = req.body;
    if (!profile || !jobText) {
      return res.status(400).json({ error: 'Missing required fields: profile and jobText' });
    }
    console.log(`[${new Date().toISOString()}] Resume generation request started`);

    // Structured read of the posting against the profile; replaces regex guessing.
    const match = await analyzeMatch(req.openai, { profile, jobText });
    const matchText = renderMatchForPrompt(match);
    console.log(`Match: ${match.company || '(unnamed company)'} — ${match.role || '(unnamed role)'}; ${match.requirements.length} requirements, ${match.requirements.filter(r => r.strength !== 'none').length} supported`);

    let { data: resume } = await generateStructured(req.openai, {
      messages: buildResumeMessages({ profile, jobText, match, matchText }),
      schema: RESUME_SCHEMA,
      schemaName: 'resume',
      maxTokens: MAX_COMPLETION_TOKENS.resume
    });

    // Never show certifications the profile does not have.
    if (!(Array.isArray(profile.extras) && profile.extras.length)) resume.programs = [];
    // Enforce one-page heuristics (caps bullets/counts/length)
    resume = trimResumeForOnePage(resume);

    const endTime = Date.now();
    console.log(`[${new Date().toISOString()}] Resume generated successfully in ${endTime - startTime}ms`);
    return res.json({
      resumeContent: resume,
      matchAnalysis: match,
      metadata: { generatedAt: new Date().toISOString(), processingTime: endTime - startTime }
    });
  } catch (error) {
    console.error('Error generating resume:', safeErrorMessage(error));
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate resume', message: safeErrorMessage(error), code: error.code, timestamp: new Date().toISOString() });
    }
  }
});

// Cover letter generation endpoint
app.post('/generateCoverLetter', requireApiKey, async (req, res) => {
  const startTime = Date.now();
  try {
    const { profile, jobText } = req.body;
    if (!profile || !jobText) {
      return res.status(400).json({ error: 'Missing required fields: profile and jobText' });
    }
    console.log(`[${new Date().toISOString()}] Cover letter generation request started`);

    const match = await analyzeMatch(req.openai, { profile, jobText });
    const matchText = renderMatchForPrompt(match);
    console.log(`Match: ${match.company || '(unnamed company)'} — ${match.role || '(unnamed role)'}; ${match.requirements.length} requirements, ${match.requirements.filter(r => r.strength !== 'none').length} supported`);

    const { data } = await generateStructured(req.openai, {
      messages: buildCoverLetterMessages({ profile, jobText, match, matchText }),
      schema: COVER_LETTER_SCHEMA,
      schemaName: 'cover_letter',
      maxTokens: MAX_COMPLETION_TOKENS.coverLetter
    });

    const endTime = Date.now();
    console.log(`[${new Date().toISOString()}] Cover letter generated successfully in ${endTime - startTime}ms`);
    res.json({
      coverLetter: data.coverLetter,
      matchAnalysis: match,
      metadata: { generatedAt: new Date().toISOString(), processingTime: endTime - startTime }
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
