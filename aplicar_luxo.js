const fs = require('fs');
const path = require('path');

const dir = 'c:\\Users\\user\\Desktop\\Sifras_Web';
const files = fs.readdirSync(dir);
const htmlFiles = files.filter(f => f.endsWith('.html'));

// Expressão regular ampla para capturar todos os emojis, símbolos astronômicos, geométricos, setas decorativas etc.
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{1F1E6}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{2934}\u{2935}⚡🔥🎯📦🏁🔎🏆]/gu;

// PALETA EXCLUSIVA:
// #8AA6A3 (Sage Text/Borders)
// #BAD9D3 (Mint / Light text)
// #F2D64B (Golden High)
// #D9A648 (Bronze High)
// #734E20 (Dark Brown Base)

// 1. Processar HTMLs (Remover Emojis e Substituir variáveis do Dashboard/Admin)
htmlFiles.forEach(file => {
    const fullPath = path.join(dir, file);
    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Strip emojis
    content = content.replace(emojiRegex, '');
    
    // Retoque de luxo: Ajustar o Tailwind no Dashboard e Admin
    if (file === 'dashboard.html' || file === 'admin.html') {
        content = content.replace(/--bg-deep: #05080c;/g, '--bg-deep: #734E20;');
        content = content.replace(/--accent-cyan: #00f5ff;/g, '--accent-cyan: #F2D64B;');
        content = content.replace(/--accent-emerald: #00ff9f;/g, '--accent-emerald: #BAD9D3;');
        content = content.replace(/--accent-ruby: #ff2a6d;/g, '--accent-ruby: #D9A648;');
        content = content.replace(/--glass-bg: rgba\(10, 15, 25, 0\.[0-9]+\);/g, '--glass-bg: #8AA6A3;');
        content = content.replace(/--glass-border: rgba\(255, 255, 255, 0\.05\);/g, '--glass-border: #D9A648;');
        content = content.replace(/background: rgba\(0, 0, 0, 0.5\);/g, 'background: #734E20;');
        
        // Remove a opacidade agressiva e ajusta a fonte para cores pasteis
        content = content.replace(/text-slate-500/g, 'text-[#734E20]');
        content = content.replace(/text-slate-400/g, 'text-[#D9A648]');
        content = content.replace(/text-white/g, 'text-[#BAD9D3]');
        content = content.replace(/text-black/g, 'text-[#734E20]');
        content = content.replace(/bg-white\/5/g, 'bg-[#BAD9D3]/10');
        content = content.replace(/border-white\/5/g, 'border-[#D9A648]/30');
    }
    
    fs.writeFileSync(fullPath, content);
});

// 2. Refatorar o CSS Puro (style_alfa.css usado pelo Operacional)
const cssPath = path.join(dir, 'style_alfa.css');
if (fs.existsSync(cssPath)) {
    let css = fs.readFileSync(cssPath, 'utf8');
    css = css.replace(/--bg-dark: #0a0b10;/g, '--bg-dark: #734E20;');
    css = css.replace(/--sidebar-bg: #11121a;/g, '--sidebar-bg: #8AA6A3;');
    css = css.replace(/--card-bg: rgba\(255, 255, 255, 0.03\);/g, '--card-bg: #8AA6A3;');
    css = css.replace(/--card-border: rgba\(255, 255, 255, 0.08\);/g, '--card-border: #D9A648;');
    css = css.replace(/--primary: #0070f3;/g, '--primary: #D9A648;');
    css = css.replace(/--accent-purple: #7928ca;/g, '--accent-purple: #F2D64B;');
    css = css.replace(/--accent-green: #00dfd8;/g, '--accent-green: #F2D64B;');
    
    css = css.replace(/--text-main: #ffffff;/g, '--text-main: #BAD9D3;');
    css = css.replace(/--text-dim: #a1a1a6;/g, '--text-dim: #734E20;');
    css = css.replace(/--danger: #ff4d4d;/g, '--danger: #F2D64B;'); // Substitui o vermelho pelo ouro, mantendo na paleta
    css = css.replace(/--glow-blue: rgba\(0, 112, 243, 0.3\);/g, '--glow-blue: rgba(217, 166, 72, 0.3);');
    css = css.replace(/--glow-green: rgba\(0, 223, 216, 0.3\);/g, '--glow-green: rgba(242, 214, 75, 0.3);');
    
    // Melhorar refinamento geral de cards
    css = css.replace(/border-radius: 20px;/g, 'border-radius: 8px;'); // Cantos menos redondos para visual maduro/luxury
    css = css.replace(/border-radius: 15px;/g, 'border-radius: 6px;');
    css = css.replace(/border-radius: 12px;/g, 'border-radius: 4px;');
    css = css.replace(/border-radius: 10px;/g, 'border-radius: 2px;');
    css = css.replace(/box-shadow: 0 4px 15px rgba\(0, 0, 0, 0\.3\);/g, 'box-shadow: 0 4px 20px rgba(115, 78, 32, 0.15);');
    
    fs.writeFileSync(cssPath, css);
}

console.log('Filtro de Luxo (Ouro/Sálvia/Marrom) aplicado com sucesso a todo o front-end!');
