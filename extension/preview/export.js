// Downloads: the cover letter as a jsPDF file (window.jspdf, a bundled plain
// script), the resume through print.html and Chrome's print dialog, and the
// file names both start from. The app asks for the name (promptForFilename)
// and shows the status messages.

// Characters no OS accepts in a file name become spaces; length capped.
export function sanitizeFilename(name) {
    return String(name || '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.]+|[\s.]+$/g, '')
        .slice(0, 120);
}

// "Name - Company - Resume", leaving out whatever is unknown.
export function suggestFilename(name, company, kind) {
    return sanitizeFilename([name, company, kind === 'resume' ? 'Resume' : 'Cover Letter'].filter(Boolean).join(' - '));
}

// Builds the cover letter PDF from the preview's .letter-content element
// (its .letter-body paragraphs are the letter) and returns it as a Blob.
export function buildCoverLetterPdf(letterElement, profile) {
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
    doc.text(profile.name, leftMargin, currentY);
    currentY += lineHeight;

    doc.setFontSize(11);
    doc.setFont('times', 'normal');

    // Add contact info
    const contactLines = profile.contact.split('\n');
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

    // The letter's own paragraphs, from the preview markup
    const letterBodyDiv = letterElement.querySelector('.letter-body');
    let letterContent = '';
    if (letterBodyDiv) {
        const paragraphs = letterBodyDiv.querySelectorAll('p');
        letterContent = Array.from(paragraphs).map(p => p.textContent.trim()).filter(text => text).join('\n\n');
    } else {
        letterContent = (letterElement.textContent || '')
            .replace(/Your generated cover letter will appear here\.\.\./, '')
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
    doc.text(profile.name, leftMargin, currentY);

    return doc.output('blob');
}

// Saves a Blob to the Downloads folder with chrome.downloads, or through a
// link click if that fails or the API is missing. Resolves once handed off.
export function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const viaLink = () => {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.downloads) {
            chrome.downloads.download({
                url: url,
                filename: filename,
                saveAs: false // Download directly to Downloads folder
            }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Download failed:', chrome.runtime.lastError);
                    viaLink();
                } else {
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
                resolve();
            });
        } else {
            viaLink();
            resolve();
        }
    });
}

// The resume page to print: the unmarked markup (preview highlights never
// reach the PDF), else what the preview shows.
export function printableResumePage(cleanHtml, renderedHtml) {
    const holder = document.createElement('div');
    holder.innerHTML = cleanHtml || renderedHtml || '';
    return holder.querySelector('.resume-page') || document.querySelector('.resume-content .resume-page');
}

// Opens the resume in print.html, where Chrome's print dialog saves it as a
// text-based PDF. The markup goes through session storage (an extension page
// cannot be handed a document directly); the title is the name Chrome
// proposes for "Save as PDF".
export async function openResumePrintView(page, title) {
    await chrome.storage.session.set({
        printJob: { html: page.outerHTML, title }
    });
    await chrome.tabs.create({ url: chrome.runtime.getURL('print.html'), active: true });
}
