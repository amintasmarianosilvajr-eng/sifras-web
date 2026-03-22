const fs = require('fs');
const path = require('path');

const dir = 'c:\\Users\\user\\Desktop\\Sifras_Web';

// 1. Ajustar script_alfa.js
const jsPath = path.join(dir, 'script_alfa.js');
if (fs.existsSync(jsPath)) {
    let js = fs.readFileSync(jsPath, 'utf8');
    // Troca qualquer array de iteração [1, 2] para iterar apenas sobre o slot [1]
    js = js.replace(/\[1, 2\]\.forEach/g, '[1].forEach');
    js = js.replace(/\[1, 2\]\.filter/g, '[1].filter');
    fs.writeFileSync(jsPath, js);
}

// 2. Ajustar style_alfa.css
const cssPath = path.join(dir, 'style_alfa.css');
if (fs.existsSync(cssPath)) {
    let css = fs.readFileSync(cssPath, 'utf8');
    // Altera o grid para ter apenas 1 coluna para preencher a tela com requinte
    css = css.replace(/\.slots-container { display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; }/g, '.slots-container { display: flex; flex-direction: column; gap: 3rem; }');
    // Fallback genérico caso a linha exata mude
    css = css.replace(/grid-template-columns: 1fr 1fr;/g, 'grid-template-columns: 1fr;');
    fs.writeFileSync(cssPath, css);
}

// 3. Ajustar operacional.html
const htmlPath = path.join(dir, 'operacional.html');
if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    
    // Remover o Slot 2 do DOM inteiro até o fechamento do conteiner
    html = html.replace(/<!-- Slot 2 -->[\s\S]*?<div class="pdf-container"/, '<div class="pdf-container"');
    
    // Remover o botão PDF 2
    html = html.replace(/<button class="btn-pdf" id="download-pdf-2"[\s\S]*?<\/button>/, '');
    
    // Ajustar grid do PDF container para 1 coluna
    html = html.replace(/grid-template-columns: 1fr 1fr; gap: 10px;/g, 'grid-template-columns: 1fr; gap: 10px;');
    
    // Mudar os labels textuais
    html = html.replace(/2 SLOTS ATIVOS/g, 'TERMINAL ÚNICO');
    html = html.replace(/SLOT #01/g, 'CHAVE CENTRAL API');
    html = html.replace(/PDF SLOT 1/g, 'EMITIR ÚLTIMO PDF DE LUCRO');

    fs.writeFileSync(htmlPath, html);
    console.log("Slot 2 removido permanentemente. Operacional exclusivo com 1 slot.");
}
