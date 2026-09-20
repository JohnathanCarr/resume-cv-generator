// Local PDF renderer. Generation runs inside the extension (extension/generation/);
// this server exists only to turn the rendered resume HTML into a PDF with
// Puppeteer until the extension can do that itself.
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 8787;

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

app.use(timeout(120000));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
  console.log(`Resume PDF server running on http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log('Generation now runs inside the extension; this server only renders resume PDFs.');
});

module.exports = app;
