// Cover letter HTML for the preview, pure (no DOM). The PDF is built from
// this markup's .letter-body paragraphs (preview/export.js).
import { escapeHTML } from './resumeHtml.js';

// letter: the model's text, paragraphs separated by blank lines. Lines of
// 10 characters or fewer are dropped as stray fragments.
export function formatCoverLetter(coverLetter, profile, date = new Date()) {
    // Clean and properly format the cover letter
    const cleanLetter = coverLetter.trim();
    
    // Split into paragraphs using double line breaks
    const paragraphs = cleanLetter.split(/\n\n+/)
        .map(p => p.replace(/\n/g, ' ').trim())
        .filter(p => p.length > 10); // Filter out very short lines
    
    let formatted = `
        <div class="letter-header">
            <p><strong>${escapeHTML(profile.name)}</strong></p>
            <p>${escapeHTML(profile.contact || '').replace(/\n/g, '<br>')}</p>
        </div>
        
        <div class="letter-date">
            <p>${date.toLocaleDateString('en-US', { 
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
            formatted += `<p style="margin-bottom: 1.5em; text-align: justify; line-height: 1.6;">${escapeHTML(paragraph)}</p>`;
        }
    });

    formatted += `
        </div>
        
        <div class="letter-closing" style="margin-top: 2em;">
            <p>Sincerely,</p>
            <br>
            <p>${escapeHTML(profile.name)}</p>
        </div>
    `;

    return formatted;
}
