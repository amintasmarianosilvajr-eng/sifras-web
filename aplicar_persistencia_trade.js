const fs = require('fs');
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(pathJs, 'utf8');

// 1. Modificar loadSavedData() para incluir recuperação de memoria de Trade
const loadRegex = /\/\/ Auto Memorização Apenas Visual[\s\S]*?\}, 800\);\s*\}/g;
js = js.replace(loadRegex, `// Recuperação Inteligente de Trade Aberto ou Standby
            if (data.key && data.secret) {
                setTimeout(() => {
                    const savedTrade = localStorage.getItem('sifras_active_trade');
                    if (savedTrade) {
                        try {
                            currentTrade = JSON.parse(savedTrade);
                            
                            // 1. Restaura visual no painel
                            document.getElementById('active-trade-card').classList.remove('hidden');
                            document.getElementById('monitoring-symbol').textContent = currentTrade.symbol;
                            document.getElementById('monitoring-buy-price').textContent = \`$\${currentTrade.buyPrice.toFixed(4)}\`;
                            document.getElementById('monitoring-target-price').textContent = \`$\${currentTrade.targetPrice.toFixed(4)}\`;
                            
                            // 2. Realiza Auto-Conexao e Liga o Monitoramento Forçadamente
                            connectSlot(id);
                            if (!activeSlots[id].monitoring) toggleMonitoring(id);
                            
                            addLog(\`[RECUPERAÇÃO DE EMERGÊNCIA] Operação em aberto de \${currentTrade.symbol} resgatada da memória. Motor Religado Automaticamente!\`, 'error');
                        } catch(e) {
                            addLog('[SISTEMA] Credenciais Operacionais preenchidas. Aguardando conexão manual.', 'system');
                        }
                    } else {
                        // Sem trade na memoria -> Apenas preenche, e respeita a escolha do usuario de não autoconectar
                        addLog('[SISTEMA] Credenciais Operacionais preenchidas. Aguardando conexão manual do usuário.', 'system');
                    }
                }, 800);
            }`);

// 2. Salvar currentTrade ao abrir posicao em executeTrade()
// O JS atual tem: currentTrade = { symbol: symbolShort... }; e depos add a quantidade currentTrade.qty, entao vamos salvar após ele ter o qty
const qtyRegex = /currentTrade\.qty = executedQty;\s*addLog\(\`\[SISTEMA\] Fração registrada em log de memória interna: \$\{executedQty\} \$\{symbolShort\}\`, 'system'\);/g;
js = js.replace(qtyRegex, `currentTrade.qty = executedQty;
            localStorage.setItem('sifras_active_trade', JSON.stringify(currentTrade));
            addLog(\`[SISTEMA] Fração registrada em log de memória interna persistente (Anti-F5): \${executedQty} \${symbolShort}\`, 'system');`);

// 3. Clear localStorage on sell
const clearRegex = /currentTrade = null;\s*document\.getElementById\('active-trade-card'\)\.classList\.add\('hidden'\);/g;
js = js.replace(clearRegex, `currentTrade = null;
    localStorage.removeItem('sifras_active_trade');
    document.getElementById('active-trade-card').classList.add('hidden');`);
    
// 4. Emergency Stop
const emergencyRegex = /currentTrade = null;\s*cycleCount = 0;/g;
js = js.replace(emergencyRegex, `currentTrade = null;
    localStorage.removeItem('sifras_active_trade');
    cycleCount = 0;`);

fs.writeFileSync(pathJs, js);
console.log("Memory persistence added to Sifras Web Engine successfully.");
