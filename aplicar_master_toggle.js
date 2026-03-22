const fs = require('fs');
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(pathJs, 'utf8');

// 1. Função Master Toggle Core (Acoplando Conexão, API e Monitoramento no Cabecalho)
const masterToggleFn = `
function masterToggle() {
    const slot1 = activeSlots[1];
    
    // Se o motor já está rodando (Monitoramento ativo ou Trade ativo)
    if (slot1.monitoring || currentTrade) {
        addLog('[COMANDO_MESTRE] Iniciando protocolo de interrupção...', 'system');
        emergencyStop(); // Já desliga tudo e zera variáveis
    } else {
        // Se estiver desligado -> Ligar
        addLog('[COMANDO_MESTRE] Energizando núcleo principal...', 'system');
        
        // 1. Validar e Conectar (se não conectado)
        if (!slot1.connected) {
            connectSlot(1);
        }
        
        // 2. Se a conexão passou, habilita monitoramento
        if (activeSlots[1].connected) {
            if (!activeSlots[1].monitoring) toggleMonitoring(1);
        } else {
            addLog('⚠️ Impossível conectar. Verifique Chaves API no Slot Inferior.', 'error');
        }
    }
}

function updateMasterToggleUI(isMonitoring) {
    const btn = document.getElementById('master-toggle-btn');
    if (!btn) return;
    if (isMonitoring) {
        btn.innerHTML = 'DESCONECTAR';
        btn.style.background = 'rgba(255,77,77,0.15)';
        btn.style.borderColor = 'var(--danger)';
        btn.style.color = 'var(--danger)';
        btn.style.animation = 'blink 1.5s infinite';
    } else {
        btn.innerHTML = 'CONECTAR';
        btn.style.background = 'rgba(0,255,136,0.15)';
        btn.style.borderColor = 'var(--accent-green)';
        btn.style.color = 'var(--accent-green)';
        btn.style.animation = 'none';
    }
}
`;

// Insert at the bottom if not exists
if (!js.includes('function masterToggle()')) {
    js += '\n' + masterToggleFn;
}

// 2. Atualizar UI após o emergencyStop (Desligou tudo)
const eStopTarget = `addLog(\`✅ SISTEMA PARADO. Ciclo resetado. Reinicie o monitoramento quando quiser.\`, 'system');`;
if (js.includes(eStopTarget) && !js.includes('updateMasterToggleUI(false); // Stop')) {
    js = js.replace(eStopTarget, eStopTarget + '\n    updateMasterToggleUI(false); // Stop');
}

// 3. Atualizar UI no toggleMonitoring
const toggleMonitorTarget = `btn.textContent = 'INICIAR MONITORAMENTO'; btn.classList.remove('on');`;
if (js.includes(toggleMonitorTarget) && !js.includes('updateMasterToggleUI(activeSlots[id].monitoring)')) {
    js = js.replace(/function toggleMonitoring\(id\) \{[\s\S]*?\}\s*\}/, match => {
        return match.replace(/}$/, `    updateMasterToggleUI(activeSlots[id].monitoring);\n}`);
    });
}

// 4. Se o usuário desconectar manualmente via botão no Slot
if (js.includes('const connBtn = document.querySelector') && !js.includes('updateMasterToggleUI(false); // Disconnect')) {
    js = js.replace(/function disconnectSlot\(id\) \{[\s\S]*?\}\s*\}/, match => {
        return match.replace(/}$/, `    updateMasterToggleUI(false); // Disconnect\n}`);
    });
}

fs.writeFileSync(pathJs, js);
console.log('Master Toggle acoplado perfeitamente no Cérebro do Motor!');
