# 🚀 AI Cover Letter & Resume Generator

**Generate hyper-personalized cover letters and resumes that bypass AI detection and land interviews.**

Transform your job applications with AI-powered documents that sound like strategic business pitches, not typical applications. This Chrome extension creates sophisticated, tailored content that makes you stand out from the crowd.

## ✨ What This Does

- 🎯 **Hyper-Tailored Cover Letters**: Research companies and craft insider observations
- 📄 **Professional Resumes**: ATS-optimized, one-page layouts that fill completely  
- 🧠 **AI Detection Proof**: Avoids all telltale AI writing patterns
- ⚡ **Instant PDF Downloads**: One-click download straight to Downloads folder
- 💾 **Smart Profile Management**: Upload your existing resume to autofill your profile, autosave, comprehensive data tracking
- 🔒 **100% Private**: All data stays on your device, secure local proxy
- 🎨 **Professional Formatting**: Clean, ATS-friendly business documents

## 🎯 What Makes This Different

**Traditional applications sound like this:**
> "I am excited to apply for this position. I am passionate about your company and believe I would be a great fit..."

**Our AI-generated content sounds like this:**
> "Your recent Series C funding and expansion into enterprise automation signals a critical inflection point where technical debt could either accelerate or constrain growth. My experience architecting scalable systems positions me to help you navigate this transition..."

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
   - **Generate Cover Letter** → Strategic business pitch
   - **Generate Resume** → ATS-optimized, one-page format
4. **Download PDF** → Instant download to Downloads folder

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
- **Local Proxy**: Secures API key and manages OpenAI communications
- **Advanced AI**: Sophisticated prompting for consultant-level output

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
- **Professionals** who want consultant-level application materials
- **Anyone** tired of generic, AI-detected cover letters and resumes

## 📈 Results You Can Expect

- **Higher response rates** from personalized, research-backed content
- **ATS-friendly resumes** that pass automated screening
- **Professional formatting** that looks hand-crafted
- **Instant generation** - documents ready in 30-60 seconds
- **Unlimited customization** - different documents for different roles

## 🔧 Advanced Configuration

### Custom API Settings
- Edit `proxy/server.js` to modify AI models or parameters
- Adjust timeout settings for different generation speeds
- Customize prompts for different writing styles

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