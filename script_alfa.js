/**
 * SIFRAS PERSONAL CLIENTE 01 - FLUXO ALFA
 * Versão ULTRA-ALINHADA com Disparo Real Garantido
 */

const CONFIG = {
    BINANCE_API: '/proxy-binance/api/v3',
    UPDATE_INTERVAL: 2000,
    PROXIMITY_THRESHOLD: 30.0,
    VOLATILITY_THRESHOLD: 0.1,
    VOLATILITY_WINDOW: 10000,
    GROWTH_THRESHOLD: 0.15,      // Novo gatilho: 0.15%
    GROWTH_WINDOW: 15000,        // Janela de 20 segundos
    COOLDOWN_OPERATIONS: 3,
    TARGET_PROFIT: 0.4,         // Acelerado para teste
    STOP_LOSS: 2.0,             // Rede de segurança
    BLACKLIST: [
        /* Fan Tokens (Times de Futebol, Seleções e Escuderias) */
        'SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'ASR', 'ATM', 'ACM', 'BAR', 'CITY', 'INTER', 'JUV', 'OG', 'PSG', 'ARG', 'POR', 'TRA', 'NAP', 'SAU', 'ALV',
        /* Deslistadas, Risco e Monitoradas (Monitoring e Seed Tag Binance) */
        'LUNC', 'USTC', 'FTT', 'VGX', 'WRX', 'REP', 'BOND', 'EPX', 'POLS', 'MULT', 'PNT', 'WAVES', 'OMNI', 'REEF', 'MDX', 'LOOM', 'KP3R', 'DOCK', 'OAX', 'PROS', 'VITE', 'FOR', 'IRIS', 'NULS', 'FIDA', 'CVX', 'HARD', 'WNXM', 'GLM', 'AKRO'
    ]
};

let volatilityTracker = {};
let rapidGrowthTracker = {};     // Rastreador dedicado para o gatilho de 20s
let symbolRules = {};            // Armazena regras de precisão (Step Size)
let operationHistory = { 1: [], 2: [] };
let totalProfitAcc = { 1: 0.0, 2: 0.0 };
let activeSlots = {
    1: { connected: false, monitoring: false, clientName: '', key: '', secret: '' },
    2: { connected: false, monitoring: false, clientName: '', key: '', secret: '' }
};
let currentTrade = null;
let executionMode = 'REAL';

// --- Controle de Ciclos (10 operações por ciclo) ---
const MAX_CYCLE_OPS = 10;
let cycleCount = 0;
let cycleOnPause = false;
let cycleResumeTime = null;
let closingTrade = false;    // flag: impede disparo duplo do buyUsdtAndReposition
let lastAlfaTarget = null;  // último alvo detectado pelo Fluxo Alfa (parâmetro natural)

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    const header = document.getElementById('main-header');
    if (header) header.classList.add('mode-real');

    addLog("🔥 SISTEMA FERRARI SNIPER: MODO REAL ATIVO", 'error');
    addLog("Bypassing security filters... Connected.", 'system');

    loadSavedData();
    startMonitoring();
    setupPDF();
});

function loadSavedData() {
    [1].forEach(id => {
        const saved = localStorage.getItem(`sifras_slot_${id}`);
        if (saved) {
            const data = JSON.parse(saved);
            document.getElementById(`slot-${id}-name`).value = data.name || '';
            document.getElementById(`slot-${id}-key`).value = data.key || '';
            document.getElementById(`slot-${id}-secret`).value = data.secret || '';
            activeSlots[id].key = data.key;
            activeSlots[id].secret = data.secret;
            activeSlots[id].clientName = data.name;
            
            // Auto Memorização e Auto-Conexão
            if (data.key && data.secret) {
                setTimeout(() => {
                    connectSlot(id);
                    addLog('Chaves Mestre auto-recuperadas da memória local.', 'system');
                }, 800);
            }
        }
    });
}

function saveSlotData(id, name, key, secret) {
    const data = { name, key, secret };
    localStorage.setItem(`sifras_slot_${id}`, JSON.stringify(data));
    activeSlots[id].key = key;
    activeSlots[id].secret = secret;
    activeSlots[id].clientName = name;
}

function clearSlotData(id) {
    if (confirm(`Limpar dados do SLOT #${id}?`)) {
        localStorage.removeItem(`sifras_slot_${id}`);
        document.getElementById(`slot-${id}-name`).value = '';
        document.getElementById(`slot-${id}-key`).value = '';
        document.getElementById(`slot-${id}-secret`).value = '';
        activeSlots[id].key = ''; activeSlots[id].secret = ''; activeSlots[id].clientName = '';
        if (activeSlots[id].connected) disconnectSlot(id);
        addLog(`Slot #${id}: Reset de memória.`, 'system');
    }
}

function signRequest(params, secret) {
    return CryptoJS.HmacSHA256(params, secret).toString(CryptoJS.enc.Hex);
}

// --- Loop Principal ---
async function startMonitoring() {
    while (true) {
        try {
            // Verificar se está na pausa de 30 min entre ciclos
            if (cycleOnPause) {
                const remaining = Math.ceil((cycleResumeTime - Date.now()) / 1000);
                if (Date.now() >= cycleResumeTime) {
                    cycleOnPause = false;
                    cycleCount = 0;
                    cycleResumeTime = null;
                    addLog(`🔄 CICLO REINICIADO! Sistema retomando operações...`, 'system');
                    updateCycleUI();
                } else {
                    const mins = Math.ceil(remaining / 60);
                    document.getElementById('system-status-text').textContent = `PAUSA CICLO: ${mins}min`;
                }
                await new Promise(r => setTimeout(r, CONFIG.UPDATE_INTERVAL));
                continue;
            }

            const topGainers = await fetchTopGainers();
            if (topGainers && topGainers.length >= 10) {
                updateUI(topGainers);
                if (!currentTrade && (activeSlots[1].monitoring || activeSlots[2].monitoring)) {
                    analyzeFluxoAlfa(topGainers);
                }
                if (currentTrade) {
                    const heldCoin = topGainers.find(c => c.symbol.replace('USDT', '') === currentTrade.symbol);
                    if (heldCoin) updateActiveTradeMonitor(heldCoin.price);
                }
                updateStatus(true);
            }
        } catch (error) {
            console.error("Monitoring core fail:", error);
            updateStatus(false);
        }
        await new Promise(r => setTimeout(r, CONFIG.UPDATE_INTERVAL));
    }
}

async function fetchTopGainers() {
    try {
        const res = await fetch(`${CONFIG.BINANCE_API}/ticker/24hr`);
        const all = await res.json();

        let activeSyms = [];
        try {
            const infoRes = await fetch(`${CONFIG.BINANCE_API}/exchangeInfo`);
            const info = await infoRes.json();
            info.symbols.forEach(s => {
                if (s.quoteAsset === 'USDT' && s.status === 'TRADING') {
                    activeSyms.push(s.symbol);
                    const lot = s.filters.find(f => f.filterType === 'LOT_SIZE');
                    if (lot) {
                        const step = parseFloat(lot.stepSize);
                        symbolRules[s.symbol] = {
                            stepSize: step,
                            precision: Math.max(0, Math.round(Math.log10(1 / step)))
                        };
                    }
                }
            });
        } catch (e) { }

        return all
            .filter(i => i.symbol.endsWith('USDT'))
            .filter(i => activeSyms.length === 0 || activeSyms.includes(i.symbol))
            .filter(i => !CONFIG.BLACKLIST.includes(i.symbol.replace('USDT', '')))
            .map(i => ({
                symbol: i.symbol,
                price: parseFloat(i.lastPrice),
                vol: parseFloat(i.priceChangePercent)
            }))
            .sort((a, b) => b.vol - a.vol)
            .slice(0, 30);
    } catch (err) {
        return null;
    }
}

// --- Lógica Alfa ---
function analyzeFluxoAlfa(ranking) {
    // 1. MONITORAMENTO AMPLO: Gatilho 0.15% em 15s (Rank #2 ao #15)
    for (let i = 1; i < 10; i++) {
        const coin = ranking[i];
        if (!coin) continue;

        if (checkRapidGrowth(coin)) {
            addLog(`⚡ GATILHO RÁPIDO: ${coin.symbol.replace('USDT', '')} +${CONFIG.GROWTH_THRESHOLD}% em 15s (Rank #${i + 1})`, 'proximity');
            executeTrade(coin);
            return; // Interrompe para focar na execução da compra detectada
        }
    }

    // 2. LÓGICA DE PROXIMIDADE (BASE BINARY/ALFA)
    const c2 = ranking[1], c4 = ranking[3], c6 = ranking[5];
    if (!c2 || !c4 || !c6) return;

    
    
    

    const d2 = Math.abs(c2.vol - c4.vol);
    const d6 = Math.abs(c6.vol - c4.vol);

    
    

    let target = null;
    if (d2 < CONFIG.PROXIMITY_THRESHOLD || d6 < CONFIG.PROXIMITY_THRESHOLD) {
        if (d2 < CONFIG.PROXIMITY_THRESHOLD && d6 < CONFIG.PROXIMITY_THRESHOLD) {
            target = (d2 <= d6) ? c2 : c6;
        } else {
            target = (d2 < CONFIG.PROXIMITY_THRESHOLD) ? c2 : c6;
        }
    }

    if (target) {
        lastAlfaTarget = target; 
        
        
        if (checkVolatility(target)) executeTrade(target);
    } else {
        
        
    }
}

function checkRapidGrowth(coin) {
    const now = Date.now();
    const symbol = coin.symbol;
    
    if (!rapidGrowthTracker[symbol]) {
        rapidGrowthTracker[symbol] = [];
    }

    // Armazenar histórico de preço
    rapidGrowthTracker[symbol].push({ price: coin.price, timestamp: now });

    // Limpar dados com mais de 30 segundos para manter performance
    rapidGrowthTracker[symbol] = rapidGrowthTracker[symbol].filter(h => now - h.timestamp <= 30000);

    // Buscar o preço mais próximo de 20 segundos atrás (janela de 18s a 25s)
    const pastPricePoint = rapidGrowthTracker[symbol].find(h => 
        (now - h.timestamp) >= (CONFIG.GROWTH_WINDOW - 2000) && 
        (now - h.timestamp) <= (CONFIG.GROWTH_WINDOW + 5000)
    );

    if (pastPricePoint) {
        const jump = ((coin.price - pastPricePoint.price) / pastPricePoint.price) * 100;
        if (jump >= CONFIG.GROWTH_THRESHOLD) {
            // Evita disparar repetidamente para a mesma moeda em curto tempo (cooldown local de 1 min)
            if (!rapidGrowthTracker[symbol].lastFired || (now - rapidGrowthTracker[symbol].lastFired > 60000)) {
                rapidGrowthTracker[symbol].lastFired = now;
                return true;
            }
        }
    }
    return false;
}

function checkVolatility(coin) {
    const now = Date.now();
    const tracker = volatilityTracker[coin.symbol];
    if (!tracker || (now - tracker.timestamp >= CONFIG.VOLATILITY_WINDOW)) {
        const lastPrice = tracker ? tracker.lastPrice : coin.price;
        const jump = Math.abs((coin.price - lastPrice) / lastPrice) * 100;
        volatilityTracker[coin.symbol] = { lastPrice: coin.price, timestamp: now };
        return jump >= CONFIG.VOLATILITY_THRESHOLD;
    }
    return false;
}

// --- Execução Real ---
async function executeTrade(coin, isReposition = false) {
    const monitoringSlots = [1].filter(id => activeSlots[id].monitoring);
    if (monitoringSlots.length === 0) return;
    if (cycleOnPause) return; // bloqueado durante pausa do ciclo

    const symbolShort = coin.symbol.replace('USDT', '');

    // Cooldown por moeda só se NÃO for reposição automática
    if (!isReposition) {
        const inCooldown = monitoringSlots.some(id =>
            operationHistory[id].slice(-CONFIG.COOLDOWN_OPERATIONS).some(op => op.symbol === symbolShort)
        );
        if (inCooldown) {
            addLog(`🚫 COOLDOWN: ${symbolShort} ocultada.`, 'system');
            return;
        }
    }

    const tp = coin.price * (1 + (CONFIG.TARGET_PROFIT / 100));

    // Ativação Visual
    document.getElementById('active-trade-card').classList.remove('hidden');
    document.getElementById('monitoring-symbol').textContent = symbolShort;
    document.getElementById('monitoring-buy-price').textContent = `$${coin.price.toFixed(4)}`;
    document.getElementById('monitoring-target-price').textContent = `$${tp.toFixed(4)}`;
    document.getElementById('monitoring-current-price').textContent = `$${coin.price.toFixed(4)}`;

    currentTrade = { symbol: symbolShort, buyPrice: coin.price, fullSymbol: coin.symbol, targetPrice: tp };
    cycleCount++; // Incrementa no inicio da operação visualmente

    const label = isReposition ? `♻️ REPOSIÇÃO #${cycleCount}: ${symbolShort}. Disparando...` : `🔭 ALVO DETECTADO: ${symbolShort}. Disparando chaves...`;
    addLog(label, 'proximity');
    updateCycleUI();

    let executedQty = null;
    let successCount = 0;
    for (const id of monitoringSlots) {
        const result = await sendBinanceOrder(id, 'BUY', coin.symbol);
        if (result.ok) {
            successCount++;
            // Garantir que qty é sempre um número float
            if (result.executedQty != null) {
                executedQty = parseFloat(result.executedQty);
                addLog(`📦 Qty adquirida (Slot #${id}): ${executedQty}`, 'system');
            }
        }
    }

    if (successCount > 0) {
        // Armazenar quantidade exata comprada (float) para poder vender depois
        if (executedQty && executedQty > 0) {
            currentTrade.qty = executedQty;
            addLog(`✅ Qty armazenada: ${executedQty} ${symbolShort}`, 'system');
        } else {
            addLog(`⚠️ Qty não retornada pela API. Usará saldo real na venda.`, 'system');
        }
        addLog(`🎯 POSICIONADO em ${symbolShort} | Op ${cycleCount}/${MAX_CYCLE_OPS}. Monitorando alvo...`, 'buy');
    } else {
        addLog(`❌ PAINEL: Ordem Rejeitada. Confira 'Spot Trading' na Binance.`, 'error');
        setTimeout(() => { currentTrade = null; document.getElementById('active-trade-card').classList.add('hidden');
    const headerPnl = document.getElementById('header-realtime-pnl');
    if (headerPnl) {
        headerPnl.textContent = 'Aguardando...';
        headerPnl.style.color = 'var(--text-muted)';
    } }, 15000);
    }
}

async function sendBinanceOrder(id, side, symbol, qty = null) {
    const slot = activeSlots[id];
    if (!slot.key || !slot.secret) return { ok: false, executedQty: null };

    try {
        const timestamp = Date.now();
        const recvWindow = 60000;
        const queryParams = new URLSearchParams({
            symbol: symbol,
            side: side,
            type: 'MARKET',
            timestamp: timestamp,
            recvWindow: recvWindow
        });

        if (side === 'BUY') {
            // Compra: usar TODO o saldo USDT disponível com margem de -0.1%
            const usdtFree = await fetchUsdtBalance(id);
            if (!usdtFree || usdtFree < 1) {
                addLog(`❌ [SLOT #${id}] Saldo USDT insuficiente ou indisponível.`, 'error');
                return { ok: false, executedQty: null };
            }
            const usdtToSpend = (usdtFree * 0.999).toFixed(2); // -0.1% de margem para taxa
            queryParams.append('quoteOrderQty', usdtToSpend);
            addLog(`📡 [SLOT #${id}] COMPRANDO ${symbol.replace('USDT', '')} com $${usdtToSpend} USDT (saldo: $${usdtFree.toFixed(2)})...`, 'system');
        } else {
            // "Compra de USDT" = vender a moeda com a quantidade exata adquirida
            if (!qty) {
                addLog(`❌ [SLOT #${id}] Sem quantidade para comprar USDT. Pulando.`, 'error');
                return { ok: false, executedQty: null };
            }
            queryParams.append('quantity', qty);
            addLog(`📡 [SLOT #${id}] COMPRANDO USDT (convertendo ${symbol.replace('USDT', '')})...`, 'system');
        }

        const signature = signRequest(queryParams.toString(), slot.secret);
        queryParams.append('signature', signature);

        const response = await fetch(`${CONFIG.BINANCE_API}/order`, {
            method: 'POST',
            headers: {
                'X-MBX-APIKEY': slot.key,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: queryParams.toString()
        });

        const result = await response.json();

        if (response.ok && result.orderId) {
            // executedQty sempre como float para garantir aritmética correta
            const rawQty = result.executedQty || result.origQty || null;
            const executedQty = rawQty ? parseFloat(rawQty) : null;
            const label = side === 'BUY'
                ? `✅ COMPRA CONFIRMADA! ${symbol.replace('USDT', '')} adquirido. Qtd: ${executedQty ?? '?'}`
                : `✅ USDT ADQUIRIDO! ${symbol.replace('USDT', '')} convertido com sucesso.`;
            addLog(label, 'buy');
            return { ok: true, executedQty };
        } else {
            const msg = result.msg || 'Erro desconhecido';
            const code = result.code || 'N/A';
            if (code === -2015) {
                addLog(`❌ ERRO 2015: Verifique RESTRIÇÃO DE IP na Binance!`, 'error');
            } else {
                addLog(`❌ REJEITADO: ${msg} (${code})`, 'error');
            }
            return { ok: false, executedQty: null };
        }
    } catch (e) {
        addLog(`💥 FALHA DE REDE: Verifique conexão com a Binance.`, 'error');
        return { ok: false, executedQty: null };
    }
}

function updateActiveTradeMonitor(currentPrice) {
    if (!currentTrade) return;

    const pnl = ((currentPrice - currentTrade.buyPrice) / currentTrade.buyPrice) * 100;
    const progress = Math.max(0, Math.min(100, ((pnl - (-1.0)) / (CONFIG.TARGET_PROFIT + 1.0)) * 100));

    // Atualização forçada dos elementos da interface
    const elPl = document.getElementById('monitoring-pl');
    const elCurrent = document.getElementById('monitoring-current-price');
    const elFill = document.getElementById('trade-progress-fill');

    if (elPl) {
        elPl.textContent = `${(pnl >= 0 ? '+' : '')}${pnl.toFixed(2)}%`;
        elPl.style.color = pnl >= 0 ? 'var(--accent-green)' : 'var(--danger)';
    }
    if (elCurrent) elCurrent.textContent = `$${currentPrice.toFixed(4)}`;
    if (elFill) elFill.style.width = `${progress}%`;

    if (pnl >= CONFIG.TARGET_PROFIT && !closingTrade) {
        closingTrade = true; // travar para não disparar duas vezes
        addLog(`🎯 META ALCANÇADA: +${pnl.toFixed(2)}% — Comprando USDT e reposicionando!`, 'sell');
        buyUsdtAndReposition(pnl);
    } else if (pnl <= -CONFIG.STOP_LOSS && !closingTrade) {
        closingTrade = true;
        addLog(`🛑 STOP LOSS: ${pnl.toFixed(2)}% — Protegendo capital e mudando de alvo!`, 'error');
        buyUsdtAndReposition(pnl);
    }
}

// Chamada quando a meta é atingida: VENDE moeda, compra USDT e REPOSICIONA
async function buyUsdtAndReposition(actualPnl = 0) {
    if (!currentTrade) { closingTrade = false; return; }
    const monitoringSlots = [1].filter(id => activeSlots[id].monitoring);
    const prevCoin = { ...currentTrade }; // snapshot antes de limpar

    // Limpar currentTrade imediatamente para não re-entrar no monitor
    currentTrade = null;
    document.getElementById('active-trade-card').classList.add('hidden');
    const headerPnl = document.getElementById('header-realtime-pnl');
    if (headerPnl) {
        headerPnl.textContent = 'Aguardando...';
        headerPnl.style.color = 'var(--text-muted)';
    }

    addLog(`💹 SAÍDA OPERACIONAL! Vendendo ${prevCoin.symbol} para obter USDT...`, 'sell');

    // 1. Determinar quantidade a vender (Fiel ao LOT_SIZE)
    const FEE_SAFETY = 0.998;
    let coinQty = null;
    const rules = symbolRules[prevCoin.fullSymbol] || { precision: 2, stepSize: 0.01 };

    if (prevCoin.qty && parseFloat(prevCoin.qty) > 0) {
        const rawQty = parseFloat(prevCoin.qty);
        const adjustedQty = (rawQty * FEE_SAFETY);
        // Arredondar para baixo de acordo com o stepSize
        const finalQty = (Math.floor(adjustedQty / rules.stepSize) * rules.stepSize);
        coinQty = finalQty.toFixed(rules.precision);
        addLog(`📐 Qty corrigida: ${rawQty.toFixed(8)} → com margem e precisão (${rules.precision} casas): ${coinQty}`, 'system');
    } else {
        addLog(`🔍 Qty não encontrada. Buscando saldo real na Binance...`, 'system');
        const rawBal = await fetchCoinBalance(monitoringSlots[0], prevCoin.symbol);
        if (rawBal && parseFloat(rawBal) > 0) {
            const adjustedBal = parseFloat(rawBal) * FEE_SAFETY;
            const finalQty = (Math.floor(adjustedBal / rules.stepSize) * rules.stepSize);
            coinQty = finalQty.toFixed(rules.precision);
            addLog(`🔍 Saldo real: ${rawBal} → formatado: ${coinQty}`, 'system');
        } else {
            addLog(`❌ Saldo insuficiente para venda de ${prevCoin.symbol}.`, 'error');
            closingTrade = false;
            return;
        }
    }

    addLog(`📡 Enviando ordem SELL | ${prevCoin.fullSymbol} | qty: ${coinQty}`, 'system');

    // 2. VENDER a moeda (SELL = obter USDT)
    let usdtOk = false;
    for (const id of monitoringSlots) {
        const result = await sendBinanceOrder(id, 'SELL', prevCoin.fullSymbol, coinQty);
        if (result.ok) {
            usdtOk = true;
            totalProfitAcc[id] += actualPnl;
            operationHistory[id].push({
                symbol: prevCoin.symbol,
                buyPrice: prevCoin.buyPrice,
                sellPrice: (actualPnl >= 0) ? prevCoin.targetPrice : (prevCoin.buyPrice * (1 + (actualPnl/100))),
                profit: parseFloat(actualPnl.toFixed(2)),
                time: new Date().toLocaleString()
            });
            if (actualPnl >= 0) {
                addLog(`💰 Venda registrada! Lucro acumulado Slot #${id}: ${totalProfitAcc[id].toFixed(2)}%`, 'sell');
            } else {
                addLog(`🛡️ STOP LOSS FINALIZADO! Capital protegido. Impacto na banca: ${actualPnl.toFixed(2)}%. Saldo parcial: ${totalProfitAcc[id].toFixed(2)}%`, 'error');
            }
        }
    }

    if (!usdtOk) {
        addLog(`❌ Falha ao vender ${prevCoin.symbol}. Verifique saldo e permissões de Spot Trading.`, 'error');
        closingTrade = false;
        return;
    }

    // 3. Incrementar contador do ciclo
    cycleCount++;
    addLog(`🔄 USDT obtido! Operação ${cycleCount}/${MAX_CYCLE_OPS} concluída.`, 'system');
    updateCycleUI();

    // 4. Verificar se chegou na 10ª operação → pausa de 30 min
    if (cycleCount >= MAX_CYCLE_OPS) {
        cycleOnPause = true;
        cycleResumeTime = Date.now() + 30 * 60 * 1000;
        addLog(`🏁 CICLO COMPLETO! ${MAX_CYCLE_OPS} operações. PAUSA DE 30 MINUTOS iniciada.`, 'error');
        addLog(`⏰ Sistema retomará às ${new Date(cycleResumeTime).toLocaleTimeString()}`, 'system');
        updateCycleUI();
        closingTrade = false;
        return;
    }

    // 5. REPOSICIONAR IMEDIATAMENTE no parâmetro natural do Fluxo Alfa
    // Aguardar 1 segundo para a venda ser confirmada na Binance
    await new Promise(r => setTimeout(r, 1000));

    const repoTarget = lastAlfaTarget || { symbol: prevCoin.fullSymbol, price: prevCoin.targetPrice };
    const repoLabel = repoTarget.symbol.replace('USDT', '');
    addLog(`♻️ RECOMPRA IMEDIATA: reposicionando em ${repoLabel}...`, 'proximity');

    try {
        // Buscar preço atual da moeda antes de recomprar
        const res = await fetch(`${CONFIG.BINANCE_API}/ticker/price?symbol=${repoTarget.symbol}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.price) throw new Error('Sem preço retornado');

        const updatedCoin = {
            symbol: repoTarget.symbol,
            price: parseFloat(data.price),
            vol: repoTarget.vol || 0
        };
        addLog(`📈 Preço atual ${repoLabel}: $${updatedCoin.price.toFixed(4)}. Disparando recompra...`, 'system');
        closingTrade = false;
        await executeTrade(updatedCoin, true);
    } catch (e) {
        addLog(`⚠️ Falha ao buscar preço para reposição: ${e.message}. Aguardando próximo scan...`, 'error');
        closingTrade = false;
    }
}

// Busca o saldo real de uma moeda na conta Binance (fallback para qty)
async function fetchCoinBalance(id, asset) {
    const slot = activeSlots[id];
    if (!slot || !slot.key || !slot.secret) return null;
    try {
        const timestamp = Date.now();
        const params = `timestamp=${timestamp}&recvWindow=60000`;
        const signature = signRequest(params, slot.secret);
        const res = await fetch(`${CONFIG.BINANCE_API}/account?${params}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': slot.key }
        });
        const data = await res.json();
        if (data.balances) {
            const bal = data.balances.find(b => b.asset === asset);
            const free = bal ? parseFloat(bal.free) : 0;
            return free > 0 ? free.toFixed(6) : null;
        }
    } catch (e) { }
    return null;
}

// Busca o saldo livre de USDT do slot (para usar na compra)
async function fetchUsdtBalance(id) {
    const slot = activeSlots[id];
    if (!slot || !slot.key || !slot.secret) return null;
    try {
        const timestamp = Date.now();
        const params = `timestamp=${timestamp}&recvWindow=60000`;
        const signature = signRequest(params, slot.secret);
        const res = await fetch(`${CONFIG.BINANCE_API}/account?${params}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': slot.key }
        });
        const data = await res.json();
        if (data.balances) {
            const usdt = data.balances.find(b => b.asset === 'USDT');
            const free = usdt ? parseFloat(usdt.free) : 0;
            return free > 0 ? free : null;
        }
    } catch (e) { }
    return null;
}

async function emergencyStop() {
    addLog(`🛑 STOP GERAL ACIONADO!`, 'error');

    // 1. Comprar USDT de emergência se houver posição aberta
    if (currentTrade) {
        addLog(`📡 STOP: Comprando USDT de emergência (${currentTrade.fullSymbol})...`, 'system');
        const monitoringSlots = [1].filter(id => activeSlots[id].monitoring);
        for (const id of monitoringSlots) {
            await sendBinanceOrder(id, 'SELL', currentTrade.fullSymbol, currentTrade.qty ? currentTrade.qty.toFixed(8) : null);
        }
    }

    // 2. Parar monitoramento de todos os slots
    [1].forEach(id => {
        if (activeSlots[id].monitoring) {
            activeSlots[id].monitoring = false;
            const btn = document.getElementById(`activate-${id}`);
            if (btn) { btn.textContent = 'INICIAR MONITORAMENTO'; btn.classList.remove('on'); }
            addLog(`💤 Slot #${id}: Monitoramento parado.`, 'system');
        }
    });

    // 3. Limpar estado do painel e ciclo
    currentTrade = null;
    cycleCount = 0;
    cycleOnPause = false;
    cycleResumeTime = null;
    document.getElementById('active-trade-card').classList.add('hidden');
    const headerPnl = document.getElementById('header-realtime-pnl');
    if (headerPnl) {
        headerPnl.textContent = 'Aguardando...';
        headerPnl.style.color = 'var(--text-muted)';
    }
    updateCycleUI();
    addLog(`✅ SISTEMA PARADO. Ciclo resetado. Reinicie o monitoramento quando quiser.`, 'system');
}

function updateCycleUI() {
    const el = document.getElementById('cycle-counter');
    if (!el) return;
    if (cycleOnPause) {
        const resumeStr = cycleResumeTime ? new Date(cycleResumeTime).toLocaleTimeString() : '—';
        el.innerHTML = `🏁 CICLO PAUSADO — Retoma às ${resumeStr}`;
        el.style.color = 'var(--danger)';
    } else {
        el.innerHTML = `🔄 CICLO: <strong>${cycleCount}</strong> / ${MAX_CYCLE_OPS} operações`;
        el.style.color = cycleCount >= MAX_CYCLE_OPS - 1 ? 'var(--accent-orange, #f59e0b)' : 'var(--accent-green)';
    }
}


// --- UI Helpers ---
function connectSlot(id) {
    const name = document.getElementById(`slot-${id}-name`).value;
    const key = document.getElementById(`slot-${id}-key`).value;
    const secret = document.getElementById(`slot-${id}-secret`).value;
    if (!key || !secret) {
        addLog(`⚠️ Slot #${id}: Preencha Chave e Secret.`, 'error');
        return;
    }
    saveSlotData(id, name, key, secret);
    activeSlots[id].connected = true;
    document.getElementById(`slot-${id}-status`).textContent = (name || 'CONECTADO').toUpperCase();
    document.getElementById(`slot-${id}-status`).classList.add('connected');
    document.getElementById(`activate-${id}`).classList.remove('disabled');

    // Ativar o botão de teste de API
    const testBtn = document.getElementById(`test-${id}`);
    if (testBtn) testBtn.classList.remove('disabled');

    const btn = document.querySelector(`#slot-${id} .btn-connect`);
    btn.textContent = 'DESCONECTAR'; btn.onclick = () => disconnectSlot(id);
    addLog(`Slot #${id}: Link estabelecido. Clique em TESTAR API para validar.`, 'system');
}

async function testApiConnection(id) {
    const slot = activeSlots[id];
    if (!slot.key || !slot.secret) {
        addLog(`❌ Slot #${id}: Conecte antes de testar.`, 'error');
        return;
    }

    addLog(`🔬 Slot #${id}: Testando conexão com Binance...`, 'system');

    try {
        const timestamp = Date.now();
        const params = `timestamp=${timestamp}&recvWindow=60000`;
        const signature = signRequest(params, slot.secret);
        const url = `${CONFIG.BINANCE_API}/account?${params}&signature=${signature}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: { 'X-MBX-APIKEY': slot.key }
        });

        const result = await response.json();

        if (response.ok && result.balances) {
            const usdt = result.balances.find(b => b.asset === 'USDT');
            const saldoUsdt = usdt ? parseFloat(usdt.free).toFixed(2) : '0.00';
            addLog(`✅ CHAVE VÁLIDA! Saldo USDT Disponível: $${saldoUsdt}`, 'buy');
        } else {
            const code = result.code || 'N/A';
            const msg = result.msg || 'Erro desconhecido';
            if (code === -2015) {
                addLog(`❌ ERRO 2015: Restrição de IP ativa na Binance! Desative-a na sua chave API.`, 'error');
            } else {
                addLog(`❌ TESTE FALHOU: ${msg} (${code})`, 'error');
            }
        }
    } catch (e) {
        addLog(`💥 Falha de rede ao testar API: ${e.message}`, 'error');
    }
}


function toggleMonitoring(id) {
    activeSlots[id].monitoring = !activeSlots[id].monitoring;
    const btn = document.getElementById(`activate-${id}`);
    if (activeSlots[id].monitoring) {
        btn.textContent = 'MONITORAMENTO ATIVO'; btn.classList.add('on');
        addLog(`🕵️ Guardião ${id} em patrulha.`, 'system');
    } else {
        btn.textContent = 'INICIAR MONITORAMENTO'; btn.classList.remove('on');
        addLog(`💤 Guardião ${id} em repouso.`, 'system');
    }
}

function disconnectSlot(id) {
    activeSlots[id].connected = false; activeSlots[id].monitoring = false;
    document.getElementById(`slot-${id}-status`).textContent = 'DESCONECTADO';
    document.getElementById(`slot-${id}-status`).classList.remove('connected');
    const actBtn = document.getElementById(`activate-${id}`);
    actBtn.classList.add('disabled'); actBtn.classList.remove('on');
    const connBtn = document.querySelector(`#slot-${id} .btn-connect`);
    connBtn.textContent = 'CONECTAR SLOT'; connBtn.onclick = () => connectSlot(id);
}

function updateUI(ranking) {
    const timeEl = document.getElementById('last-update');
    if(timeEl) timeEl.textContent = new Date().toLocaleTimeString();
    
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (let i = 1; i < 10; i++) {
        const coin = ranking[i];
        if (!coin) continue;
        const pos = i + 1;
        
        let badge = '';
        if (pos === 4) badge = '<span class="badge badge-ind" style="background:var(--card-border); color:#fff; font-size:0.6rem; padding: 4px 8px;">IND</span>';
        if (pos === 2 || pos === 6) badge = '<span class="badge badge-target" style="background:var(--primary); color:var(--bg-dark); font-size:0.6rem; padding: 4px 8px;">ALVO</span>';

        const card = document.createElement('div');
        card.className = 'target-slot-card';
        card.innerHTML = `
            <div class="ts-header">
                <span class="ts-pos">#${pos}</span>
                ${badge}
            </div>
            <div class="ts-coin">${coin.symbol.replace('USDT', '')}</div>
            <div class="ts-vol ${coin.vol >= 0 ? 'up' : 'down'}">${coin.vol >= 0 ? '+' : ''}${coin.vol.toFixed(2)}%</div>
        `;
        grid.appendChild(card);
    }


}
function updateStatus(on) {
    document.getElementById('system-status-dot').className = `status-dot ${on ? 'online' : ''}`;
    document.getElementById('system-status-text').textContent = on ? 'FLUXO ALFA ON' : 'OFFLINE';
}

function addLog(msg, type = 'system') {
    const mon = document.getElementById('log-monitor');
    if (!mon) return;
    const entry = document.createElement('div');
    const types = ['system', 'scan', 'buy', 'sell', 'error', 'proximity'];
    entry.className = `log-entry ${types.includes(type) ? type : 'system'}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    mon.prepend(entry);
    if (mon.children.length > 60) mon.removeChild(mon.lastChild);
}

function clearLogs() { document.getElementById('log-monitor').innerHTML = ''; addLog("Logs limpos.", 'system'); }

function setupPDF() {
    [1].forEach(id => {
        const btn = document.getElementById(`download-pdf-${id}`);
        if (btn) btn.onclick = () => {
            const h = operationHistory[id], name = activeSlots[id].clientName || `S${id}`;
            const el = document.createElement('div'); el.style.padding = '40px'; el.style.background = '#0d1117'; el.style.color = '#fff';
            el.innerHTML = `<h1 style="color:#0070f3;">EXTRATO FLUXO ALFA</h1><h2>CLIENTE: ${name}</h2><table style="width:100%; border-collapse:collapse;">
                <thead style="background:#161b22"><tr><th>DATA</th><th>MOEDA</th><th>LUCRO</th></tr></thead>
                <tbody>${h.map(o => `<tr><td>${o.time}</td><td>${o.symbol}</td><td>+${o.profit}%</td></tr>`).join('')}</tbody>
                </table><h3>LUCRO TOTAL: ${totalProfitAcc[id].toFixed(2)}%</h3>`;
            html2pdf().from(el).save(`Extrato_${name}.pdf`);
        };
    });
}
