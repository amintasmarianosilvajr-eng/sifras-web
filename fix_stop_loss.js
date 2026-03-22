const fs = require('fs');
const file = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(file, 'utf8');

// 1. Passar o valor do PNL real para o buyUsdtAndReposition
js = js.replace(/buyUsdtAndReposition\(\);/g, 'buyUsdtAndReposition(pnl);');

// 2. Atualizar a assinatura da função para receber o PNL
js = js.replace(/async function buyUsdtAndReposition\(\) {/g, 'async function buyUsdtAndReposition(actualPnl = 0) {');

// 3. Modificar o bloco de injeção de lucro/prejuízo no Array e Histórico
const oldLogBloc = `totalProfitAcc\\[id\\] \\+\\= CONFIG\\.TARGET_PROFIT;
            operationHistory\\[id\\].push\\({
                symbol: prevCoin\\.symbol,
                buyPrice: prevCoin\\.buyPrice,
                sellPrice: prevCoin\\.targetPrice,
                profit: CONFIG\\.TARGET_PROFIT,
                time: new Date\\(\\)\\.toLocaleString\\(\\)
            }\\);
            addLog\\(\`💰 Venda registrada! Lucro acumulado Slot #\\$\\{id\\}: \\$\\{totalProfitAcc\\[id\\]\\.toFixed\\(2\\)\\}\\%\`, 'sell'\\);`;

const newLogBloc = `totalProfitAcc[id] += actualPnl;
            operationHistory[id].push({
                symbol: prevCoin.symbol,
                buyPrice: prevCoin.buyPrice,
                sellPrice: (actualPnl >= 0) ? prevCoin.targetPrice : (prevCoin.buyPrice * (1 + (actualPnl/100))),
                profit: parseFloat(actualPnl.toFixed(2)),
                time: new Date().toLocaleString()
            });
            if (actualPnl >= 0) {
                addLog(\`💰 Venda registrada! Lucro acumulado Slot #\${id}: \${totalProfitAcc[id].toFixed(2)}%\`, 'sell');
            } else {
                addLog(\`🛡️ STOP LOSS FINALIZADO! Capital protegido. Impacto na banca: \${actualPnl.toFixed(2)}%. Saldo parcial: \${totalProfitAcc[id].toFixed(2)}%\`, 'error');
            }`;

js = js.replace(new RegExp(oldLogBloc, 'g'), newLogBloc);

fs.writeFileSync(file, js);
console.log('Stop loss reporting and PNL extraction corrected!');
