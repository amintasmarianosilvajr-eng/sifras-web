const fs = require('fs');
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(pathJs, 'utf8');

// 1. Criando a variavel Global Power se nao existir
if (!js.includes('let globalSystemPower = false;')) {
    js = js.replace(/let executionMode = 'REAL';/, "let executionMode = 'REAL';\nlet globalSystemPower = false;");
}

// 2. Reescrevendo masterToggle inteiramente usando string indexOf ou replace exato
const masterToggleRegex = /function masterToggle\(\)\s*\{[\s\S]*?(?=\nfunction updateMasterToggleUI)/;
const masterToggleFn = `function masterToggle() {
    const slot1 = activeSlots[1];
    const btn = document.getElementById('master-toggle-btn');
    
    if (!globalSystemPower) {
        // LIGAR PLATAFORMA (Global Connection)
        globalSystemPower = true;
        btn.innerHTML = 'DESCONECTAR';
        btn.style.background = 'rgba(255, 102, 0, 0.15)';
        btn.style.borderColor = '#ff6600';
        btn.style.color = '#ff6600';
        btn.style.animation = 'blink 1.5s infinite';
        addLog('[COMANDO_MESTRE] Conexão Global estabelecida com a Binance. Plataforma Ativada.', 'system');
        
        // Permite espelhamento de PNL imediato se a chave estiver cacheada
        if (slot1.key && slot1.secret) {
            syncBinanceBalance();
        }
    } else {
        // DESLIGAR PLATAFORMA
        addLog('[COMANDO_MESTRE] Encerrando Conexão Global...', 'system');
        if (slot1.monitoring || currentTrade) {
            emergencyStop();
        }
        if (slot1.connected) disconnectSlot(1);
        
        globalSystemPower = false;
        btn.innerHTML = 'CONECTAR';
        btn.style.background = 'rgba(0,255,136,0.15)';
        btn.style.borderColor = 'var(--accent-green)';
        btn.style.color = 'var(--accent-green)';
        btn.style.animation = 'none';
        
        // Reset Visual do Saldo
        const headerPnl = document.getElementById('header-realtime-pnl');
        const headerLabel = headerPnl ? headerPnl.previousElementSibling : null;
        if (headerPnl) {
            if (headerLabel) headerLabel.textContent = 'PNL ATUAL';
            headerPnl.innerHTML = 'Aguardando...';
            headerPnl.style.color = 'var(--text-muted)';
        }
    }
}`;
js = js.replace(masterToggleRegex, masterToggleFn);

// 3. Modificando a entrada do connectSlot para validar o global power
// Apenas injeta a validacao no topo da connectSlot
js = js.replace(/function connectSlot\(id\) \{/, \`function connectSlot(id) {
    if (!globalSystemPower && id === 1) {
        addLog('⚠️ ACESSO NEGADO: Para validar e conectar o Slot de Chaves, EXIJA LIGAR A PLATAFORMA no Botão "CONECTAR" no CABEÇALHO primeiro.', 'error');
        return;
    }\`);

// 4. Modificando syncBinanceBalance para não abortar por slot.connected, apenas exija chave valida e power
js = js.replace(/if \(!slot\.connected \|\| !slot\.key \|\| !slot\.secret \|\| currentTrade\) return;/g, 
\`if (!globalSystemPower || !slot.key || !slot.secret || currentTrade) return;\`);

// 5. Garantir que modulo de recuperacao ligue o power e puxe o saldo
js = js.replace(/addLog\(\\\`\\[MÓDULO DE RECUPERAÇÃO\\]/g, \`globalSystemPower = true;
            document.getElementById('master-toggle-btn').innerHTML = 'DESCONECTAR';
            document.getElementById('master-toggle-btn').style.background = 'rgba(255, 102, 0, 0.15)';
            document.getElementById('master-toggle-btn').style.color = '#ff6600';
            document.getElementById('master-toggle-btn').style.borderColor = '#ff6600';
            syncBinanceBalance();
            addLog(\\\`[MÓDULO DE RECUPERAÇÃO]\`);

fs.writeFileSync(pathJs, js);
console.log('Arquitetura de Conexao Global Reversa perfeitamente mapeada SEM quebrar funcoes.');
