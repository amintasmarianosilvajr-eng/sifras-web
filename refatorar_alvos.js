const fs = require('fs');
const path = require('path');

const dir = 'c:\\Users\\user\\Desktop\\Sifras_Web';

// 1. Modificar operacional.html
const htmlPath = path.join(dir, 'operacional.html');
if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');

    // Remover o ranking-card e analysis-card antigos
    html = html.replace(/<div class="card ranking-card">[\s\S]*?<\/div>[\s\n]*<!-- Alfa Indicator Logic View -->/g, '<!-- Removed Ranking -->\n\n');
    html = html.replace(/<div class="card analysis-card">[\s\S]*?<\/div>\s*/g, '');

    // Injetar o novo Dynamic Targets Card logo antes das Logs (ou onde for melhor).
    // O html tem: <div class="bottom-grid"> \n <!-- Logs --> ...
    // Vamos substituir a bottom-grid inteira para acomodar
    const newDynamicBlock = `
                    <!-- Monitoramento Dinâmico de Mercado (Ranks #2 ao #10) -->
                    <div class="card dynamic-targets-card">
                        <div class="card-header">
                            <h3>Espectro de Oportunidades (Rank #2 ao #10)</h3>
                            <span class="time-update" id="last-update">Sincronizando Módulo...</span>
                        </div>
                        <div class="targets-grid" id="dynamic-targets-grid">
                            <div class="loading">Recuperando trilhos de dados da Binance...</div>
                        </div>
                    </div>
    `;
    
    // A bottom-grid tinha: logs-card e empty area. Vamos colocar o dynamic targets acima dos logs
    html = html.replace(/<div class="bottom-grid">/g, '<div class="bottom-grid">\n' + newDynamicBlock);

    // Como deletamos a structure antiga e o ranking list estava na bottom-grid, 
    // a regex acima limpou o ranking list perfeitamente se ele estava fora ou dentro. 
    // Verificar se sobrou <div class="card ranking-card">
    html = html.replace(/<!-- Ranking -->[\s\S]*?<div class="card ranking-card">[\s\S]*?<\/div>[\s\S]*?<\/div>/g, '');

    fs.writeFileSync(htmlPath, html);
}

// 2. Modificar script_alfa.js
const jsPath = path.join(dir, 'script_alfa.js');
if (fs.existsSync(jsPath)) {
    let js = fs.readFileSync(jsPath, 'utf8');

    // Substituir updateUI
    const newUpdateUI = `function updateUI(ranking) {
    const timeEl = document.getElementById('last-update');
    if(timeEl) timeEl.textContent = new Date().toLocaleTimeString();
    
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (let i = 1; i < 10; i++) {
        const coin = ranking[i];
        if (!coin) continue;
        const pos = i + 1;
        
        let badge = '';
        if (pos === 4) badge = '<span class="badge badge-ind" style="background:var(--card-border); color:#fff; font-size:0.6rem; padding: 4px 8px;">IND</span>';
        if (pos === 2 || pos === 6) badge = '<span class="badge badge-target" style="background:var(--primary); color:var(--bg-dark); font-size:0.6rem; padding: 4px 8px;">ALVO</span>';

        const card = document.createElement('div');
        card.className = 'target-slot-card';
        card.innerHTML = \`
            <div class="ts-header">
                <span class="ts-pos">#\${pos}</span>
                \${badge}
            </div>
            <div class="ts-coin">\${coin.symbol.replace('USDT', '')}</div>
            <div class="ts-vol \${coin.vol >= 0 ? 'up' : 'down'}">\${coin.vol >= 0 ? '+' : ''}\${coin.vol.toFixed(2)}%</div>
        \`;
        grid.appendChild(card);
    }
}`;
    js = js.replace(/function updateUI\(ranking\) {[\s\S]*?}/, newUpdateUI);

    // Limpar as atualizações de DOM na analyzeFluxoAlfa para evitar crash (Cannot set properties of null)
    js = js.replace(/document\.getElementById\('alfa-4'\)\.textContent =.*?;/g, '');
    js = js.replace(/document\.getElementById\('alfa-2'\)\.textContent =.*?;/g, '');
    js = js.replace(/document\.getElementById\('alfa-6'\)\.textContent =.*?;/g, '');
    js = js.replace(/document\.getElementById\('prox-2'\)\.textContent =.*?;/g, '');
    js = js.replace(/document\.getElementById\('prox-6'\)\.textContent =.*?;/g, '');
    
    // O decision-box também sumiu
    js = js.replace(/const box = document\.getElementById\('decision-box'\);[\s\S]*?if \(target\) {/g, 'if (target) {');
    js = js.replace(/box\.classList\.add\('active'\);/g, '');
    js = js.replace(/box\.textContent = .*?;/g, '');
    js = js.replace(/} else {[\s\S]*?box\.classList\.remove\('active'\);[\s\S]*?box\.textContent = .*?;[\s\S]*?}/g, '}');

    fs.writeFileSync(jsPath, js);
}

// 3. Modificar style_alfa.css
const cssPath = path.join(dir, 'style_alfa.css');
if (fs.existsSync(cssPath)) {
    let css = fs.readFileSync(cssPath, 'utf8');

    const newCss = `
/* ======== TARGET SLOTS GRID ======== */
.dynamic-targets-card {
    background: var(--sidebar-bg);
    border: 1px solid var(--card-border);
}
.targets-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 15px;
    margin-top: 15px;
}
.target-slot-card {
    background: var(--bg-dark);
    border: 1px solid var(--card-border);
    border-radius: 15px;
    padding: 15px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    transition: transform 0.2s;
    box-shadow: 0 4px 10px rgba(0,0,0,0.3);
}
.target-slot-card:hover {
    transform: translateY(-3px);
    border-color: var(--primary);
    box-shadow: 0 5px 15px var(--accent-glow);
}
.ts-header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
}
.ts-pos {
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--text-sidebar);
}
.ts-coin {
    font-family: 'Outfit';
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--text-main);
    margin-bottom: 5px;
}
.ts-vol {
    font-size: 1rem;
    font-weight: 800;
}
.ts-vol.up { color: var(--primary); }
.ts-vol.down { color: var(--card-border); }
`;
    // Anexar no final
    css += newCss;
    
    // Ajustar bottom-grid para comportar os logs perfeitamente
    css = css.replace(/\.bottom-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 2.5rem; }/, '.bottom-grid { display: flex; flex-direction: column; gap: 2.5rem; }');

    fs.writeFileSync(cssPath, css);
}

console.log("Refatoração dinâmica dos alvos concluída!");
