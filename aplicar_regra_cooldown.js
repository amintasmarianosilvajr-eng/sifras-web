const fs = require('fs');

const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(pathJs, 'utf8');

// 1. Remover o bloco que Forçava a recompra ignorando o Cooldown
const regexReposicaoBlock = /\/\/\s*5\. REPOSICIONAR IMEDIATAMENTE[\s\S]*?\} catch \(e\) \{[\s\S]*?closingTrade = false;\s*\}/g;

const newReposicaoEnd = `// 5. MOTOR LIVRE (Cooldown Aplicado)
    addLog('[SISTEMA ALFA] Motor Livre. Aguardando nova janela orgânica respeitando limite de Cooldown (3x).', 'system');
    closingTrade = false;`;

js = js.replace(regexReposicaoBlock, newReposicaoEnd);

// 2. Remover a condição que ignorava o cooldown (if (!isReposition))
const oldCooldownCond = `// Cooldown por moeda só se NÃO for reposição automática
    if (!isReposition) {
        const inCooldown = monitoringSlots.some(id =>
            operationHistory[id].slice(-CONFIG.COOLDOWN_OPERATIONS).some(op => op.symbol === symbolShort)
        );
        if (inCooldown) {
            addLog(\`[SISTEMA ALFA] Ativo \${symbolShort} atingiu limite de reentradas por janela operacional (Ignorando).\`, 'system');
            return;
        }
    }`;

const newCooldownCond = `// Blindagem Absoluta: Cooldown Mandatório de 3 Operações
    const inCooldown = monitoringSlots.some(id =>
        operationHistory[id].slice(-CONFIG.COOLDOWN_OPERATIONS).some(op => op.symbol === symbolShort)
    );
    if (inCooldown) {
        addLog(\`[SISTEMA ALFA] Ativo \${symbolShort} retido preventivamente pela regra de Cooldown (3 Operações).\`, 'system');
        return;
    }`;

js = js.replace(oldCooldownCond, newCooldownCond);

fs.writeFileSync(pathJs, js);
console.log('Regra restrita de Cooldown aplicada, bypass removido com sucesso!');
