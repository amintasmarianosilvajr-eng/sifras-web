const fs = require('fs');
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(pathJs, 'utf8');

// 1. Remover o Deadlock no masterToggle (permitir ligar independente das chaves fisicas existirem)
const masterToggleRegex = /function masterToggle\(\) \{[\s\S]*?(?=\nfunction updateMasterToggleUI)/;
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
        
        // Cobre o caso em que ja havia chave (via cache). Se nao tiver, ele apenas ignora.
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

// 2. Modificar updateActiveTradeMonitor para exibir PNL Capital e Percentual
const updateActiveMonitorRegex = /const pnlValueUsdt = \(\(currentPrice - currentTrade\.buyPrice\) \* currentTrade\.qty\)\.toFixed\(4\);[\s\S]*?headerPnl\.style\.color = pnlColor;/g;
const updateActiveMonitorFn = `const pnlValueUsdt = ((currentPrice - currentTrade.buyPrice) * currentTrade.qty).toFixed(4);
        
        if (headerPnl) {
            headerLabel.textContent = 'PNL DA OPERAÇÃO';
            headerPnl.innerHTML = \`<strong style="color: \${pnlColor}">\${pnl >= 0 ? '+' : ''}\${pnl.toFixed(2)}%</strong> <span style="font-size: 0.7em; color: var(--text-muted)">($\${pnlValueUsdt})</span>\`;
            headerPnl.style.color = pnlColor;
        }`;

// Precisamos atualizar o updateActiveTradeMonitor para injetar Em % e Capital
// Vamos usar RegExp mais geral caso mude minimamente
js = js.replace(/headerPnl\.innerHTML = \`(?:<span|<\/span|strong|style|[\s\$A-Za-z\{\}\%\.\+\-\_])*?\`;[\s\S]*?headerPnl\.style\.color = pnlColor;/g, `headerLabel.textContent = 'PNL DA OPERAÇÃO (AO VIVO)';
            const capitalDoll = ((currentPrice - currentTrade.buyPrice) * currentTrade.qty).toFixed(2);
            headerPnl.innerHTML = \`<strong style="color: \${pnlColor}">\${pnl >= 0 ? '+' : ''}\${pnl.toFixed(2)}%</strong> <span style="font-size: 0.6em; color: var(--text-muted)">($\${capitalDoll})</span>\`;
            headerPnl.style.color = pnlColor;`);

fs.writeFileSync(pathJs, js);
console.log('Deadlock fixed & Dual PNL format installed!');
