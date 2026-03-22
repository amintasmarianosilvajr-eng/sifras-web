const fs = require('fs');
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(pathJs, 'utf8');

// 1. Criar e introduzir a função de salvamento do Estado Global
const syncStateFn = `
function saveGlobalState() {
    const state = {
        cycleCount: cycleCount,
        cycleOnPause: cycleOnPause,
        cycleResumeTime: cycleResumeTime,
        totalProfitAcc: totalProfitAcc,
        operationHistory: operationHistory
    };
    localStorage.setItem('sifras_global_state', JSON.stringify(state));
}
`;

if (!js.includes('function saveGlobalState()')) {
    js += '\n' + syncStateFn;
}

// 2. Acoplar o saveGlobalState() em todos os lugares onde alteramos esses valores!
// A. No momento em que uma Venda é concluída com sucesso e incrementamos cycleCount, history e profit
const sellRegex = /cycleCount\+\+;\s*addLog\(\`🔄 USDT obtido! .*\`\)/g;
js = js.replace(sellRegex, `cycleCount++;
    addLog(\`🔄 USDT obtido! Operação \${cycleCount}/\${MAX_CYCLE_OPS} concluída.\`, 'system');
    saveGlobalState();`);
    
// B. No momento de Pausa do Ciclo
const pauseRegex = /cycleResumeTime = Date\.now\(\) \+ 30 \* 60 \* 1000;/g;
js = js.replace(pauseRegex, `cycleResumeTime = Date.now() + 30 * 60 * 1000;\n        saveGlobalState();`);

// C. No Emergency Stop (que reseta o cycle)
const estopRegex = /cycleCount = 0;\s*cycleOnPause = false;\s*cycleResumeTime = null;/g;
js = js.replace(estopRegex, `cycleCount = 0;
    cycleOnPause = false;
    cycleResumeTime = null;
    saveGlobalState();`);
    
// 3. Restaurar esses dados no loadSavedData() logo no inicio
const loadRegex = /function loadSavedData\(\) \{/g;
js = js.replace(loadRegex, `function loadSavedData() {
    const gState = localStorage.getItem('sifras_global_state');
    if (gState) {
        try {
            const state = JSON.parse(gState);
            cycleCount = state.cycleCount || 0;
            cycleOnPause = state.cycleOnPause || false;
            cycleResumeTime = state.cycleResumeTime || null;
            totalProfitAcc = state.totalProfitAcc || { 1: 0.0, 2: 0.0 };
            operationHistory = state.operationHistory || { 1: [], 2: [] };
            updateCycleUI(); // Atualiza a visualização do painel no topo com o ciclo preservado
            addLog(\`[MÓDULO DE RECUPERAÇÃO] Sessão operacional anterior (Operações: \${cycleCount}/10 | PNL Acumulado: \${totalProfitAcc[1].toFixed(2)}%) reconstruída com sucesso.\`, 'system');
        } catch(e) {}
    }`);

fs.writeFileSync(pathJs, js);
console.log("Global State Persistence injected safely into Sifras Web Engine.");
