const fs = require('fs');
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(pathJs, 'utf8');

// 1. Modificar syncBinanceBalance para reportar erros abertamente e logar sucessos
const syncStartRegex = /async function syncBinanceBalance\(\) \{[\s\S]*?try \{/g;
js = js.replace(syncStartRegex, `async function syncBinanceBalance() {
    const slot = activeSlots[1];
    if (!globalSystemPower) { console.log('Sync Negado: System Off'); return; }
    if (!slot.key || !slot.secret) { addLog('⚠️ Tentativa de Espelhamento de Capital sem Chaves. Salve as chaves ("1. CONECTAR").', 'error'); return; }
    
    try {
        addLog('[SISTEMA] Solicitando Espelhamento Direto da Binance (Spot)...', 'system');`);

const syncCatchRegex = /catch \(e\) \{\s*console\.error\("Erro ao sincronizar Saldo Estimado:", e\);\s*\}/g;
js = js.replace(syncCatchRegex, `catch (e) {
        addLog(\`❌ FALHA DE ESPELHAMENTO: \${e.message}. Verifique sua internet ou permissão de API IP.\`, 'error');
        console.error("Erro ao sincronizar Saldo Estimado:", e);
    }`);

const dataJsonRegex = /const data = await res\.json\(\);/g;
js = js.replace(dataJsonRegex, `const data = await res.json();
        if(!data.balances) {
            addLog(\`❌ Binance rejeitou espelhamento. Cod: \${data.code} Msg: \${data.msg}\`, 'error');
        }`);

// 2. Garantir que updateActiveTradeMonitor nao tenha string bugada
// Vamos checar e tentar forçar o fallback para garantir q PNL capital e % estão perfeitos
js = js.replace(/headerPnl\.innerHTML = \`\<strong style="color: \${pnlColor}"[\s\S]*?\`;/g, 
`headerPnl.innerHTML = \`<span style="color: \${pnlColor}; font-weight: 800; font-size: 1.0rem;">\${pnl >= 0 ? '+' : ''}\${pnl.toFixed(2)}%</span> <span style="font-size: 0.7em; color: var(--text-muted)">($\${capitalDollStr})</span>\`;`);

fs.writeFileSync(pathJs, js);
console.log('Logs de Diagnostico de Saldo injetados no Motor!');
