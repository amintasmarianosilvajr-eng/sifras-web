const fs = require('fs');

const file = 'c:\\Users\\user\\Desktop\\Sifras_Web\\operacional.html';
let html = fs.readFileSync(file, 'utf8');

// The exact string to replace in the header-title:
const oldLogoHTML = `<div class="logo-container" style="margin: 0; padding: 0; border: none; display: flex; align-items: center; gap: 15px;">
                        <div class="logo-icon" style="background: var(--primary); color: var(--bg-dark); width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; border-radius: 12px; font-weight: 800; font-size: 1.5rem; font-family: 'Outfit';">F</div>
                        <div class="logo-text" style="font-size: 1.5rem; line-height: 1;">FLUXO<span style="display: inline; color: var(--primary); margin-left: 5px;">ALFA</span></div>
                    </div>`;

const newLogoHTML = `<div class="logo-container" style="margin: 0; padding: 0; border: none; display: flex; align-items: center; justify-content: center;">
                        <img src="logo.png" alt="Fluxo Alfa Logo" style="height: 70px; border-radius: 12px; box-shadow: 0 5px 15px rgba(0,0,0,0.6);">
                    </div>`;

// Safely replace the exact block if found
if (html.includes(oldLogoHTML)) {
    html = html.replace(oldLogoHTML, newLogoHTML);
    fs.writeFileSync(file, html);
    console.log('Fixed the logo specifically in the top header!');
} else {
    console.log('Could not find the exact string. Trying regex fallback.');
    const regexFallback = /<div class="header-title"[\s\S]*?<div class="logo-container"[^>]*>[\s\S]*?<div class="logo-text"[\s\S]*?<\/div>\s*<\/div>/;
    
    html = html.replace(regexFallback, (match) => {
        return match.replace(/<div class="logo-container"[\s\S]*?<\/div>(\s*<\/div>\s*)$/, newLogoHTML + '$1');
    });

    // Forced manual fallback
    const startStr = `<div class="header-title" style="display: flex; align-items: center; gap: 25px;">`;
    const endStr = `<div style="height: 40px; width: 2px; background: var(--card-border);"></div>`;
    const startIndex = html.indexOf(startStr);
    const endIndex = html.indexOf(endStr, startIndex);

    if (startIndex !== -1 && endIndex !== -1) {
        const replacement = startStr + '\n' + newLogoHTML + '\n                    ' + endStr;
        html = html.substring(0, startIndex) + replacement + html.substring(endIndex + endStr.length);
        fs.writeFileSync(file, html);
        console.log('Fixed logo via brute substring replacement.');
    }
}
