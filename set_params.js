const fs = require('fs');
const path = require('path');

const dir = 'c:\\Users\\user\\Desktop\\Sifras_Web';

// 1. Atualizar script_alfa.js
const jsPath = path.join(dir, 'script_alfa.js');
if (fs.existsSync(jsPath)) {
    let js = fs.readFileSync(jsPath, 'utf8');

    // Mudar GROWTH_WINDOW para 15000 (15 segundos)
    js = js.replace(/GROWTH_WINDOW: \d+,/g, 'GROWTH_WINDOW: 15000,');
    
    // Mudar GROWTH_THRESHOLD para 0.15 (só para ter certeza)
    js = js.replace(/GROWTH_THRESHOLD: [\d.]+,/g, 'GROWTH_THRESHOLD: 0.15,');
    
    // Mudar TARGET_PROFIT para 0.4
    js = js.replace(/TARGET_PROFIT: [\d.]+,/g, 'TARGET_PROFIT: 0.4,');
    
    // Mudar STOP_LOSS para 2.0
    js = js.replace(/STOP_LOSS: [\d.]+,/g, 'STOP_LOSS: 2.0,');

    // Mudar o For Loop para rastrear de 1 a 9 (Rank #2 ao #10)
    js = js.replace(/for \(let i = 1; i < 15; i\+\+\) {/g, 'for (let i = 1; i < 10; i++) {');

    // Atualizar strings de Logs
    js = js.replace(/em 20s \(Rank/g, 'em 15s (Rank');

    fs.writeFileSync(jsPath, js);
}

// 2. Atualizar operacional.html
const htmlPath = path.join(dir, 'operacional.html');
if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');

    // Atualizar badges Header (Lucro Alvo = 0.4%)
    html = html.replace(/<span class="value" id="target-profit">[\s\S]*?<\/span>/, '<span class="value" id="target-profit">0.40%</span>');
    
    // Atualizar badge Target Progress (Meta = 0.4%, Loss = 2.0%)
    html = html.replace(/<span>-1\.00%<\/span>/, '<span>-2.00%</span>');
    html = html.replace(/<span id="target-label">META \([\s\S]*?\)<\/span>/, '<span id="target-label">META (+0.40%)</span>');

    fs.writeFileSync(htmlPath, html);
}

console.log("Parâmetros do Motor Alfa ajustados com sucesso!");
