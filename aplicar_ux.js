const fs = require('fs');

const pathHtml = 'c:\\Users\\user\\Desktop\\Sifras_Web\\operacional.html';
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';

// --- 1. Ajustes no HTML ---
let html = fs.readFileSync(pathHtml, 'utf8');

const oldHeaderStats = `<div class="stat-badge">
                        <span class="label">LUCRO ALVO</span>
                        <span class="value" id="target-profit">0.40%</span>
                    </div>
                    <div class="stat-badge">
                        <span class="label">VOLATILIDADE</span>
                        <span class="value">0.1% / 10s</span>
                    </div>`;

const newHeaderStats = `<div class="stat-badge" style="min-width: 150px; background: rgba(0,0,0,0.4); border-color: var(--card-border);">
                        <span class="label" style="color: var(--text-muted);">PNL ATUAL</span>
                        <span class="value" id="header-realtime-pnl" style="color: var(--text-muted);">Aguardando...</span>
                    </div>`;

html = html.replace(oldHeaderStats, newHeaderStats);
fs.writeFileSync(pathHtml, html);


// --- 2. Ajustes no JS ---
let js = fs.readFileSync(pathJs, 'utf8');

// Transferir ciclo++ para o momento em que a operação Abre (ExecuteTrade)
js = js.replace(/currentTrade = { symbol: symbolShort, buyPrice: coin\.price, fullSymbol: coin\.symbol, targetPrice: tp };/, 
    `currentTrade = { symbol: symbolShort, buyPrice: coin.price, fullSymbol: coin.symbol, targetPrice: tp };\n    cycleCount++; // Incrementa no inicio da operação visualmente`);

// Retirar ciclo++ do momento que ela fecha, mas manter log de ciclo
js = js.replace(/cycleCount\+\+;\n    addLog\(\`🔄 USDT obtido! Operação \$\{cycleCount\}\/\\$\{MAX_CYCLE_OPS\} concluída.\`, 'system'\);/, 
    `addLog(\`🔄 USDT obtido! Cota \${cycleCount}/\${MAX_CYCLE_OPS} concluída.\`, 'system');`);

// Ajustar log defasado (Op cycleCount+1) no ExecuteTrade
js = js.replace(/Op \$\{cycleCount \+ 1\}/g, `Op \${cycleCount}`);

// Refletir o PNL no HEADER na Função 'updateActiveTradeMonitor'
const oldPnlUpdate = `if \\(elPl\\) \\{
        elPl\\.textContent = \\\`\\$\\{\\(pnl >= 0 \\? '\\+' : ''\\)\\}\\$\\{pnl\\.toFixed\\(2\\)\\}\\%\`;
        elPl\\.style\\.color = pnl >= 0 ? 'var\\(--accent-green\\)' : 'var\\(--danger\\)';
    }`;
const newPnlUpdate = `if (elPl) {
        elPl.textContent = \`\${(pnl >= 0 ? '+' : '')}\${pnl.toFixed(2)}%\`;
        elPl.style.color = pnl >= 0 ? 'var(--accent-green)' : 'var(--danger)';
    }
    const headerPnl = document.getElementById('header-realtime-pnl');
    if (headerPnl) {
        headerPnl.textContent = elPl.textContent;
        headerPnl.style.color = elPl.style.color;
    }`;
js = js.replace(new RegExp(oldPnlUpdate, 'g'), newPnlUpdate);

// Resetar PNL no HEADER quando fecha
const oldCardHidden = `document\\.getElementById\\('active-trade-card'\\)\\.classList\\.add\\('hidden'\\);`;
const newCardHidden = `document.getElementById('active-trade-card').classList.add('hidden');
    const headerPnl = document.getElementById('header-realtime-pnl');
    if (headerPnl) {
        headerPnl.textContent = 'Aguardando...';
        headerPnl.style.color = 'var(--text-muted)';
    }`;
js = js.replace(new RegExp(oldCardHidden, 'g'), newCardHidden);

fs.writeFileSync(pathJs, js);
console.log('UI/UX Ajustada com Sucesso - PNL Global + Ciclo Sync');
