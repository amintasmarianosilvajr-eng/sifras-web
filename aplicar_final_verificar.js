const fs = require('fs');
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(pathJs, 'utf8');

// 1. Injetar a lógica de feedback visual e Anti-Fantasma no testApiConnection
const testFnMarker = 'async function testApiConnection(id) {';
const testFnEndMarker = '} catch (e) {'; // Pegamos o catch original como âncora de fim do bloco try

const newBody = `    const slot = activeSlots[id];
    if (!slot.key || !slot.secret) {
        addLog(\`❌ Slot #\${id}: Conecte antes de testar.\`, 'error');
        return;
    }

    const testBtn = document.getElementById(\`test-\${id}\`);
    if (testBtn) {
        testBtn.style.background = 'rgba(255, 102, 0, 0.2)';
        testBtn.style.borderColor = '#ff6600';
        testBtn.style.color = '#ff6600';
        testBtn.textContent = 'VERIFICANDO...';
    }

    addLog(\`🔬 Slot #\${id}: Testando conexão com Binance...\`, 'system');

    try {
        const timestamp = Date.now();
        const params = \`timestamp=\${timestamp}&recvWindow=60000\`;
        const signature = signRequest(params, slot.secret);
        const url = \`\${CONFIG.BINANCE_API}/account?\${params}&signature=\${signature}\`;

        const response = await fetch(url, {
            method: 'GET',
            headers: { 'X-MBX-APIKEY': slot.key }
        });

        const result = await response.json();

        if (testBtn) {
            setTimeout(() => {
                testBtn.style.background = 'transparent';
                testBtn.style.borderColor = 'var(--card-border)';
                testBtn.style.color = '#fff';
                testBtn.textContent = '2. VERIFICAR';
            }, 1200);
        }

        if (response.ok && result.balances) {
            const usdt = result.balances.find(b => b.asset === 'USDT');
            const saldoUsdt = usdt ? parseFloat(usdt.free).toFixed(2) : '0.00';
            addLog(\`✅ CHAVE VÁLIDA! Saldo USDT Disponível: $\${saldoUsdt}\`, 'buy');
            
            // LÓGICA ANTI-FANTASMA: Se o robô acha que está operando algo que não existe na conta
            if (currentTrade) {
                const baseAsset = currentTrade.symbol.replace('USDT', '');
                const balInfo = result.balances.find(b => b.asset === baseAsset);
                const actualQty = balInfo ? parseFloat(balInfo.free) + parseFloat(balInfo.locked) : 0;
                
                if (actualQty < (currentTrade.qty * 0.1)) {
                    addLog(\`⚙️ [ANTI-FANTASMA] \${baseAsset} não encontrado na Binance. Operação Fantasma Removida.\`, 'error');
                    currentTrade = null;
                    localStorage.removeItem('sifras_active_trade');
                    document.getElementById('active-trade-card').classList.add('hidden');
                    
                    const headerPnl = document.getElementById('header-realtime-pnl');
                    if (headerPnl) {
                        headerPnl.innerHTML = 'Aguardando...';
                        headerPnl.style.color = 'var(--text-muted)';
                        if (headerPnl.previousElementSibling) headerPnl.previousElementSibling.textContent = 'PNL ATUAL';
                    }
                }
            }
        } else {
            const code = result.code || 'N/A';
            const msg = result.msg || 'Erro desconhecido';
            addLog(\`❌ TESTE FALHOU: \${msg} (\${code})\`, 'error');
        }
`;

// Substituição via substring para garantir que não erramos o Regex
const startIdx = js.indexOf(testFnMarker);
const endIdx = js.indexOf(testFnEndMarker, startIdx);

if (startIdx !== -1 && endIdx !== -1) {
    const finalJs = js.substring(0, startIdx + testFnMarker.length) + "\n" + newBody + "    " + js.substring(endIdx);
    fs.writeFileSync(pathJs, finalJs);
    console.log('Botão Verificar Turbinado & Anti-Fantasma Instalado!');
} else {
    console.log('Falha ao localizar marcadores no script_alfa.js');
}
