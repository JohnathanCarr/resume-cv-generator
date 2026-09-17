# 🚀 AI Cover Letter & Resume Generator

**Tailored, honest resumes and cover letters for every job you apply to — built only from your own experience.**

A Chrome extension plus a small local server. You upload your resume once, keep a complete profile, paste a job posting, and get a one-page ATS-friendly resume and a plainly written cover letter that match the posting's actual requirements. Nothing is invented: every claim traces back to your profile, and everything said about the company comes from the posting or from cited research.

## ✨ What This Does

- 🎯 **Reads the posting properly**: extracts every requirement and checks which parts of your profile support it before writing a word
- 🔍 **Researches the company** (optional, cover letters): a few web searches for what they build and what they care about, every fact with its source; if nothing reliable turns up, the letter sticks to the posting
- 📄 **ATS-friendly resumes**: one page, standard sections, the posting's exact terms where you genuinely have the skill, no invented numbers
- ✍️ **Cover letters that sound like a person**: 250–350 words, specific, no buzzwords, no "I am excited to apply"
- ⚡ **Instant PDF Downloads**: One-click download straight to Downloads folder
- 💾 **Smart Profile Management**: Upload your existing resume to autofill your profile, autosave, comprehensive data tracking
- 🔒 **100% Private**: All data stays on your device, secure local proxy
- 🎨 **Professional Formatting**: Clean, ATS-friendly business documents

## 🎯 What Makes This Different

**Traditional applications sound like this:**
> "I am excited to apply for this position. I am passionate about your company and believe I would be a great fit..."

**This sounds like this:**
> "At Stripe I designed the idempotency layer for the payments API, which cut duplicate charges by 94% across 40 million daily requests. I also led the migration of 12 services from Kubernetes 1.21 to 1.28 with zero downtime. My observability work has been through a tracing dashboard and an open-source project rather than an on-call ownership role, which is the part of this job I'd want to grow into first."

Every sentence there came from the candidate's profile, and the letter says so where the match is partial.

## 🚀 Quick Start (Any Operating System)

### Step 1: Download This Project
- **Click the green "Code" button** → "Download ZIP"
- **Extract** to your desired location (Desktop, Documents, etc.)
- **Remember the folder location** for the next steps

### Step 2: Get Your OpenAI API Key
1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click **"Create new secret key"**
4. **Copy the key** (starts with `sk-proj-` or `sk-`)
5. Keep this secure - you'll need it in Step 4

### Step 3: Run Setup (Choose Your OS)

**🪟 Windows Users:**
1. Navigate to the project folder
2. **Double-click** `setup.bat`
3. Wait for installation to complete

**🍎 Mac Users:**
1. Open **Terminal** in the project folder
2. Run: `./setup.sh`
3. Wait for installation to complete

**🐧 Linux Users:**
1. Open **Terminal** in the project folder  
2. Run: `bash setup.sh`
3. Wait for installation to complete

### Step 4: Start the Server (Choose Your OS)

**🪟 Windows:** Double-click `start-proxy.bat`

**🍎 Mac:** Run `./start-proxy.sh` in Terminal

**🐧 Linux:** Run `bash start-proxy.sh` in Terminal

**Keep this window open** while using the extension!

### Step 5: Install Chrome Extension
1. Open **Google Chrome**
2. Go to `chrome://extensions/`
3. Enable **"Developer mode"** (toggle in top-right)
4. Click **"Load unpacked"**
5. Select the **`extension`** folder (inside the project)
6. **Click the extension icon** to start!

### Step 6: Add Your API Key
1. In the extension, click the **gear icon** in the header
2. **Paste** the key from Step 2 and click **Save key**
3. The panel shows **Verified** once the local server confirms it works

Your key is stored only in this browser's extension storage and sent to the local server on each request. Once saved it can be replaced or removed, but never viewed.

## 🎯 How to Use

### First Time Setup
1. **Upload your current resume** (PDF) with the **Upload Resume** button next to Personal Information. Your skills, education, experience, projects and extras are parsed locally (no AI call) and filled in for you. The PDF is kept so you can view it any time.
2. **Review and complete your Profile**:
   - Personal info and summary
   - Education (one entry per institution)
   - Skills
   - Work experiences with achievements
   - Projects with technical details
   - Certifications & achievements (certifications, awards, research, publications, leadership, volunteering)

   Uploading another resume later only **adds** what is new — nothing you entered is removed.

### Generate Documents
1. **Go to Generate tab**
2. **Paste any job description**
3. **Choose your document**:
   - **Generate Cover Letter** → 250–350 words, grounded in your profile and the posting. Leave **Research the company** ticked for a few web searches about the employer (roughly $0.05–0.10 per letter, cached per company for 30 days); untick it to use the posting only.
   - **Generate Resume** → one page, ATS-friendly, sized to how much material your profile actually has
4. **Download PDF** → Instant download to Downloads folder

The status line under the buttons tells you what happened: how many searches the research used, whether any sentence couldn't be traced to your profile, and whether your profile is what's keeping the resume short.

### Pro Tips
- **Mark items "Must Include"** to guarantee they appear on resumes
- **Classify extras** as Research/Program/Certification for better placement
- **Keep your profile complete** — list every skill you have, not just the ones on one resume; each generated document picks what fits the job
- **Different jobs = different documents** - each is tailored specifically

## 📋 What You Need

- **Node.js** (v14+) - [Download here](https://nodejs.org/)
- **Google Chrome** browser
- **OpenAI API account** with credits

## 🛠️ Troubleshooting

### Setup Issues

**❌ "Node.js not found"**
- Install Node.js from [nodejs.org](https://nodejs.org/)
- **Restart** your terminal/command prompt
- Try the setup script again

**❌ "Permission denied" (Mac/Linux)**
- Run: `chmod +x setup.sh start-proxy.sh`
- Or use: `bash setup.sh` and `bash start-proxy.sh`

**❌ Setup script won't run (Windows)**
- Right-click script → "Run as administrator"
- Or open Command Prompt as admin and run manually

### Usage Issues

**❌ "Failed to generate" errors**
- Check proxy is running (should see "Server running on http://localhost:8787")
- Open Settings (gear icon) and check the key shows **Verified**; use **Replace key** if not
- Check OpenAI account has credits
- Try restarting the proxy server

**❌ Extension won't load**
- Enable "Developer mode" in `chrome://extensions/`
- Make sure you selected the `extension` folder, not root folder
- Check for error messages in Chrome extensions page

**❌ PDF downloads not working**
- Check Chrome's download settings
- Ensure extension has "downloads" permission
- Try refreshing the extension

**❌ Generic/poor quality output**
- Fill out complete profile with detailed experiences
- Include specific achievements and metrics
- Try different job descriptions to test variety

## 🏗️ Architecture

```
Chrome Extension ──→ Local Proxy ──→ OpenAI (model pinned in proxy/config.js)
     (UI)           (localhost:8787)
```

- **Extension**: Handles UI, data storage, and user interactions
- **Local Proxy**: Receives your key with each request, runs the match analysis, company research and generation calls, and renders resume PDFs
- **Model**: One pinned OpenAI model (`proxy/config.js`). Each document is two or three calls: a structured read of the posting against your profile, optional company research, then the document itself with a strict output schema

## 📊 Data Privacy & Security

- ✅ **All data stays local** - stored in Chrome's secure storage
- ✅ **API key never exposed** - stored in the extension, sent only to your local server, never displayed once saved
- ✅ **No cloud accounts** required - everything runs on your device
- ✅ **Uploaded resume stays on your device** — parsed in the browser, never sent to the AI
- ✅ **No tracking** or analytics - completely private

## 🎯 Perfect For

- **Job seekers** who want professional, tailored documents
- **Students** applying for internships and entry-level roles
- **Career changers** who need to reposition their experience
- **Professionals** who want application materials that hold up in the interview
- **Anyone** tired of generic, AI-detected cover letters and resumes

## 📈 Results You Can Expect

- **Higher response rates** from personalized, research-backed content
- **ATS-friendly resumes** that pass automated screening
- **Professional formatting** that looks hand-crafted
- **Instant generation** - documents ready in 30-60 seconds
- **Unlimited customization** - different documents for different roles

## 🔧 Advanced Configuration

### Model and prompts
- The model, reasoning effort per call and research limits live in `proxy/config.js`
- Prompts live in `proxy/prompts/` — `matchAnalysis.js`, `companyResearch.js`, `resume.js`, `coverLetter.js`
- Before changing a prompt, run the eval set (`test/eval/README.md`) so you can compare before and after

### Extension Customization
- Modify `extension/styles.css` for different UI themes
- Edit `extension/app.js` for additional features
- Reload extension in Chrome after changes

## 📝 File Structure

```
ai-cover-letter-generator/
├── extension/          # Chrome extension files
│   ├── app.html       # Main application UI
│   ├── app.js         # Application logic
│   ├── styles.css     # Styling and print CSS
│   ├── background.js  # Extension background script
│   ├── manifest.json  # Extension configuration
│   ├── resumeParser.js # Heuristic PDF → profile parser (no AI)
│   ├── profileMerge.js # Additive profile merge with dedup
│   ├── jspdf.min.js   # PDF generation library
│   └── pdf.min.js     # pdf.js for reading uploaded resumes
├── proxy/             # Local server
│   ├── server.js      # API proxy server
│   └── package.json   # Dependencies
├── setup.sh           # Mac/Linux setup script
├── setup.bat          # Windows setup script
├── start-proxy.sh     # Mac/Linux server start
├── start-proxy.bat    # Windows server start
└── README.md          # This file
```

## 🚀 Ready to Ship

This project is production-ready with:
- ✅ **Cross-platform compatibility** (Windows, Mac, Linux)
- ✅ **Automated setup** with dependency management
- ✅ **Secure API key handling** 
- ✅ **Professional documentation**
- ✅ **Error handling and validation**
- ✅ **Comprehensive troubleshooting guides**

## 📄 License

This project is provided for educational and personal use. Please comply with OpenAI's usage policies when using their API.

---

**🎯 Ready to generate documents that actually get you interviews? Let's go!**

## 🆘 Need Help?

1. **Check the troubleshooting section** above
2. **Verify your setup** matches the instructions  
3. **Check browser console** (F12) for errors
4. **Check proxy logs** in the terminal for API issues
5. **Use "Save Logs"** in the extension for debugging

**Transform your job applications today!** 🚀