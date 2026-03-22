const fs = require('fs');
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(pathJs, 'utf8');


// 1. Alterar buyUsdtAndReposition para apagar o trade caso nao tenha margem na Binance
const fallbackLiqRegex = /addLog\(\`\[FALHA DE LIQUIDAÇÃO\] Margem de ativo \(\$\{prevCoin\.symbol\}\) é insuficiente[\s\S]*?return;/g;
const fallbackAntiFantasma = `addLog(\`⚙️ [ANTI-FANTASMA] Saldo de \${prevCoin.symbol} zerado na Binance. Assumindo Venda Manual/Externa. Abortando operação fantasma.\`, 'error');
            currentTrade = null;
            localStorage.removeItem('sifras_active_trade');
            document.getElementById('active-trade-card').classList.add('hidden');
            closingTrade = false;
            syncBinanceBalance();
            
            const headerPnl = document.getElementById('header-realtime-pnl');
            if (headerPnl) {
                headerPnl.innerHTML = 'Aguardando...';
                headerPnl.style.color = 'var(--text-muted)';
                if (headerPnl.previousElementSibling) headerPnl.previousElementSibling.textContent = 'PNL ATUAL';
            }
            return;`;
js = js.replace(fallbackLiqRegex, fallbackAntiFantasma);


// 2. Modificar syncBinanceBalance para não interromper quando existe currentTrade, 
// e adicionar a varredura ativa de Fantasmas
js = js.replace(/if \(!globalSystemPower \|\| !slot\.key \|\| !slot\.secret \|\| currentTrade\) return;/g, 
`if (!globalSystemPower || !slot.key || !slot.secret) return;`);

const balancesRegex = /if \(data\.balances\) \{/;
const balancesAntiFantasma = `if (data.balances) {
            // [NOVO] Verificação Anti-Fantasma Silenciosa
            if (currentTrade) {
                const baseAsset = currentTrade.symbol.replace('USDT', '');
                const b = data.balances.find(bal => bal.asset === baseAsset);
                const actualBal = b ? parseFloat(b.free) + parseFloat(b.locked) : 0;
                
                if (currentTrade.qty && actualBal < (currentTrade.qty * 0.1)) {
                    addLog(\`⚙️ [ANTI-FANTASMA] Ativo \${baseAsset} sumiu da corretora (Transferência/Venda externa?). Exterminando operação Zumbi da memória!\`, 'system');
                    currentTrade = null;
                    localStorage.removeItem('sifras_active_trade');
                    document.getElementById('active-trade-card').classList.add('hidden');
                    
                    const hdPnl = document.getElementById('header-realtime-pnl');
                    if (hdPnl) {
                        hdPnl.innerHTML = 'Aguardando...';
                        hdPnl.style.color = 'var(--text-muted)';
                        if (hdPnl.previousElementSibling) hdPnl.previousElementSibling.textContent = 'PNL ATUAL';
                    }
                }
            }`;
js = js.replace(balancesRegex, balancesAntiFantasma);


fs.writeFileSync(pathJs, js);
console.log('Filtro Anti-Fantasma (Out-Of-Band Manual Sell Check) aplicado ao core.');
