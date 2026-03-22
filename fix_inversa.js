const fs = require('fs');
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(pathJs, 'utf8');

if (!js.includes('let globalSystemPower = false;')) {
    js = js.replace(/let executionMode = 'REAL';/, "let executionMode = 'REAL';\nlet globalSystemPower = false;");
}

const masterToggleRegex = /function masterToggle\(\)\s*\{[\s\S]*?(?=\nfunction updateMasterToggleUI)/;
const masterToggleFn = `function masterToggle() {
    const slot1 = activeSlots[1];
    const btn = document.getElementById('master-toggle-btn');
    
    if (!globalSystemPower) {
        globalSystemPower = true;
        btn.innerHTML = 'DESCONECTAR';
        btn.style.background = 'rgba(255, 102, 0, 0.15)';
        btn.style.borderColor = '#ff6600';
        btn.style.color = '#ff6600';
        btn.style.animation = 'blink 1.5s infinite';
        addLog('[COMANDO_MESTRE] Conexão Global com a Binance ESTABELECIDA. Plataforma Energizada.', 'system');
        
        if (slot1.key && slot1.secret) syncBinanceBalance();
    } else {
        addLog('[COMANDO_MESTRE] Encerrando Conexão Global...', 'system');
        if (slot1.monitoring || currentTrade) emergencyStop();
        if (slot1.connected) disconnectSlot(1);
        
        globalSystemPower = false;
        btn.innerHTML = 'CONECTAR';
        btn.style.background = 'rgba(0,255,136,0.15)';
        btn.style.borderColor = 'var(--accent-green)';
        btn.style.color = 'var(--accent-green)';
        btn.style.animation = 'none';
        
        const headerPnl = document.getElementById('header-realtime-pnl');
        if (headerPnl) {
            headerPnl.innerHTML = 'Aguardando...';
            headerPnl.style.color = 'var(--text-muted)';
            if (headerPnl.previousElementSibling) headerPnl.previousElementSibling.textContent = 'PNL ATUAL';
        }
    }
}`;
js = js.replace(masterToggleRegex, masterToggleFn);

const connectRegex = /function connectSlot\(id\) \{/;
js = js.replace(connectRegex, `function connectSlot(id) {
    if (!globalSystemPower && id === 1) {
        addLog('⚠️ ACESSO NEGADO: Ligue a "Conexão Global" no botão do TOPO primeiro.', 'error');
        return;
    }`);

const sync1 = /if \(!slot\.connected \|\| !slot\.key \|\| !slot\.secret \|\| currentTrade\) return;/g;
js = js.replace(sync1, `if (!globalSystemPower || !slot.key || !slot.secret || currentTrade) return;`);

const recupeRegex = /addLog\(\`\[MÓDULO DE RECUPERAÇÃO\]/g;
const recupeRep = `globalSystemPower = true;
            document.getElementById('master-toggle-btn').innerHTML = 'DESCONECTAR';
            document.getElementById('master-toggle-btn').style.background = 'rgba(255, 102, 0, 0.15)';
            document.getElementById('master-toggle-btn').style.color = '#ff6600';
            document.getElementById('master-toggle-btn').style.borderColor = '#ff6600';
            syncBinanceBalance();
            addLog(\`[MÓDULO DE RECUPERAÇÃO]\``;
if (!js.includes('globalSystemPower = true;\n            document.getElementById(\'master-toggle-btn\')')) {
    js = js.replace(recupeRegex, recupeRep);
}

fs.writeFileSync(pathJs, js);
console.log('OK');
