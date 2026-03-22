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
let globalSystemPower = false;

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

    addLog("[SISTEMA ALFA] Motor de Operações Base Inicializado", 'error');
    addLog("[CONEXÃO] Link Seguro Estabelecido (Mainnet).", 'system');

    loadSavedData();
    startMonitoring();
    setupPDF();
});

function loadSavedData() {
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
            globalSystemPower = true;
            document.getElementById('master-toggle-btn').innerHTML = 'DESCONECTAR';
            document.getElementById('master-toggle-btn').style.background = 'rgba(255, 102, 0, 0.15)';
            document.getElementById('master-toggle-btn').style.color = '#ff6600';
            document.getElementById('master-toggle-btn').style.borderColor = '#ff6600';
            syncBinanceBalance();
            addLog(`[MÓDULO DE RECUPERAÇÃO] Sessão operacional anterior (Operações: ${cycleCount}/10 | PNL Acumulado: ${totalProfitAcc[1].toFixed(2)}%) reconstruída com sucesso.`, 'system');
        } catch(e) {}
    }
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
            
            // Recuperação Inteligente de Trade Aberto ou Standby
            if (data.key && data.secret) {
                document.getElementById(`activate-${id}`).classList.remove('disabled');
                const testBtn = document.getElementById(`test-${id}`);
                if (testBtn) testBtn.classList.remove('disabled');
                setTimeout(() => {
                    const savedTrade = localStorage.getItem('sifras_active_trade');
                    if (savedTrade) {
                        try {
                            currentTrade = JSON.parse(savedTrade);
                            
                            // 1. Restaura visual no painel
                            document.getElementById('active-trade-card').classList.remove('hidden');
                            document.getElementById('monitoring-symbol').textContent = currentTrade.symbol;
                            document.getElementById('monitoring-buy-price').textContent = `${currentTrade.buyPrice.toFixed(4)}`;
                            document.getElementById('monitoring-target-price').textContent = `${currentTrade.targetPrice.toFixed(4)}`;
                            
                            // 2. Realiza Auto-Conexao e Liga o Monitoramento Forçadamente
                            connectSlot(id);
                            if (!activeSlots[id].monitoring) toggleMonitoring(id);
                            
                            addLog(`[RECUPERAÇÃO DE EMERGÊNCIA] Operação em aberto de ${currentTrade.symbol} resgatada da memória. Motor Religado Automaticamente!`, 'error');
                        } catch(e) {
                            addLog('[SISTEMA] Credenciais Operacionais preenchidas. Aguardando conexão manual.', 'system');
                        }
                    } else {
                        // Sem trade na memoria -> Apenas preenche, e respeita a escolha do usuario de não autoconectar
                        addLog('[SISTEMA] Credenciais Operacionais preenchidas. Aguardando conexão manual do usuário.', 'system');
                    }
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
                    addLog(`[OPERAÇÃO] Retomando fluxo de varredura ativa.`, 'system');
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
            addLog(`[ALERTA DE FLUXO] Crescimento Anômalo em ${coin.symbol.replace('USDT', '')} (+${CONFIG.GROWTH_THRESHOLD}%/15s) | Rank #${i + 1}.`, 'proximity');
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

    // Blindagem Absoluta: Cooldown Mandatório de 3 Operações
    const inCooldown = monitoringSlots.some(id =>
        operationHistory[id].slice(-CONFIG.COOLDOWN_OPERATIONS).some(op => op.symbol === symbolShort)
    );
    if (inCooldown) {
        addLog(`[SISTEMA ALFA] Ativo ${symbolShort} retido preventivamente pela regra de Cooldown (3 Operações).`, 'system');
        return;
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

    const label = isReposition ? `[REPOSIÇÃO] Ciclo #${cycleCount} em ${symbolShort}. Processando Ordem...` : `[ALVO CONFIRMADO] Padrão detectado em ${symbolShort}. Processando Ordem...`;
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
                addLog(`[AUDITORIA] Fração executada (S${id}): ${executedQty}`, 'system');
            }
        }
    }

    if (successCount > 0) {
        // Armazenar quantidade exata comprada (float) para poder vender depois
        if (executedQty && executedQty > 0) {
            currentTrade.qty = executedQty;
            localStorage.setItem('sifras_active_trade', JSON.stringify(currentTrade));
            addLog(`[SISTEMA] Fração registrada em log de memória interna persistente (Anti-F5): ${executedQty} ${symbolShort}`, 'system');
        } else {
            addLog(`[AVISO] Divergência na API da Binance. O motor forçará leitura do saldo real no fechamento.`, 'system');
        }
        addLog(`[POSIÇÃO ABERTA] Ativo: ${symbolShort} | Operação de Ciclo Atual: ${cycleCount}/${MAX_CYCLE_OPS}.`, 'buy');
    } else {
        addLog(`[ERRO] Ordem Recusada. Verifique permissões Mestre "Spot Trading" na Binance.`, 'error');
        setTimeout(() => { currentTrade = null;
    localStorage.removeItem('sifras_active_trade');
    document.getElementById('active-trade-card').classList.add('hidden');
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
                ? `[COMPRA EXECUTADA] Ativo: ${symbol.replace('USDT', '')} | Qtd: ${executedQty ?? '?'}`
                : `[VENDA EXECUTADA] Capital em ${symbol.replace('USDT', '')} inteiramente convertido para USDT.`;
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
    
    // Atualiza o Top Header PNL
    const headerPnl = document.getElementById('header-realtime-pnl');
    const headerLabel = document.querySelector('#header-realtime-pnl').previousElementSibling;
    if (headerPnl) {
        if (headerLabel) headerLabel.textContent = 'PNL DA OPERAÇÃO';
        headerPnl.textContent = `${(pnl >= 0 ? '+' : '')}${pnl.toFixed(2)}%`;
        headerPnl.style.color = pnl >= 0 ? 'var(--accent-green)' : 'var(--danger)';
    }
    if (elCurrent) elCurrent.textContent = `$${currentPrice.toFixed(4)}`;
    if (elFill) elFill.style.width = `${progress}%`;

    if (pnl >= CONFIG.TARGET_PROFIT && !closingTrade) {
        closingTrade = true; // travar para não disparar duas vezes
        addLog(`[TAKE PROFIT ALCANÇADO] Variação Positiva Identificada (+${pnl.toFixed(2)}%). Iniciando Ordem de Liquidação.`, 'sell');
        buyUsdtAndReposition(pnl);
    } else if (pnl <= -CONFIG.STOP_LOSS && !closingTrade) {
        closingTrade = true;
        addLog(`[RISCO MÁXIMO ATINGIDO] Gatilho de Segurança ativado (${pnl.toFixed(2)}%). Iniciando Ordem de Liquidação (Proteção).`, 'error');
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
    localStorage.removeItem('sifras_active_trade');
    document.getElementById('active-trade-card').classList.add('hidden');
    syncBinanceBalance(); // Força atualização do Saldo Real ao invés de exibir 'Aguardando...'

    addLog(`[LIQUIDAÇÃO A MERCADO] Enviando Ordem de Venda Integral para ${prevCoin.symbol}.`, 'sell');

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
        addLog(`[AJUSTE DE FRAÇÃO] Lote bruto: ${rawQty.toFixed(8)} → Corrigido com Step Size (${rules.precision} decimais): ${coinQty}`, 'system');
    } else {
        addLog(`[CONSULTA] Buscando saldo real exato pendente de liquidação na carteira Binance...`, 'system');
        const rawBal = await fetchCoinBalance(monitoringSlots[0], prevCoin.symbol);
        if (rawBal && parseFloat(rawBal) > 0) {
            const adjustedBal = parseFloat(rawBal) * FEE_SAFETY;
            const finalQty = (Math.floor(adjustedBal / rules.stepSize) * rules.stepSize);
            coinQty = finalQty.toFixed(rules.precision);
            addLog(`[CONSULTA REALIZADA] Saldo exato recuperado: ${rawBal} → Ajustado: ${coinQty}`, 'system');
        } else {
            addLog(`⚙️ [ANTI-FANTASMA] Saldo de ${prevCoin.symbol} zerado na Binance. Assumindo Venda Manual/Externa. Abortando operação fantasma.`, 'error');
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
                const overlay = document.getElementById('profit-overlay');
                if(overlay) { overlay.classList.add('show'); setTimeout(() => overlay.classList.remove('show'), 8000); }

                addLog(`[MARGEM CONSOLIDADA] Operação S${id} fechada com lucro! PNL Global Acumulado C/ Juros: ${totalProfitAcc[id].toFixed(2)}%`, 'sell');
            } else {
                addLog(`[STOP LOSS EXECUTADO] Operação e Prejuízos Encerrados. PNL do Trade: ${actualPnl.toFixed(2)}%. Global: ${totalProfitAcc[id].toFixed(2)}%`, 'error');
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
        saveGlobalState();
        addLog(`[CICLO ENCERRADO] Limite de segurança de ${MAX_CYCLE_OPS} Trades atingido. Protocolo de Resfriamento de 30min Inativo ativado.`, 'error');
        addLog(`[AGUARDO] Retomada inteligente de mercado agendada estritamente para às ${new Date(cycleResumeTime).toLocaleTimeString()}`, 'system');
        updateCycleUI();
        closingTrade = false;
        return;
    }

    // 5. MOTOR LIVRE (Cooldown Aplicado)
    addLog('[SISTEMA ALFA] Motor Livre. Aguardando nova janela orgânica respeitando limite de Cooldown (3x).', 'system');
    closingTrade = false;
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
        if(!data.balances) {
            addLog(`❌ Binance rejeitou espelhamento. Cod: ${data.code} Msg: ${data.msg}`, 'error');
        }
        if (data.balances) {
            // [NOVO] Verificação Anti-Fantasma Silenciosa
            if (currentTrade) {
                const baseAsset = currentTrade.symbol.replace('USDT', '');
                const b = data.balances.find(bal => bal.asset === baseAsset);
                const actualBal = b ? parseFloat(b.free) + parseFloat(b.locked) : 0;
                
                if (currentTrade.qty && actualBal < (currentTrade.qty * 0.1)) {
                    addLog(`⚙️ [ANTI-FANTASMA] Ativo ${baseAsset} sumiu da corretora (Transferência/Venda externa?). Exterminando operação Zumbi da memória!`, 'system');
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
            }
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
        if(!data.balances) {
            addLog(`❌ Binance rejeitou espelhamento. Cod: ${data.code} Msg: ${data.msg}`, 'error');
        }
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
    localStorage.removeItem('sifras_active_trade');
    cycleCount = 0;
    cycleOnPause = false;
    cycleResumeTime = null;
    saveGlobalState();
    document.getElementById('active-trade-card').classList.add('hidden');
    syncBinanceBalance();
    
    updateCycleUI();
    addLog(`✅ SISTEMA PARADO. Ciclo resetado. Reinicie o monitoramento quando quiser.`, 'system');
    updateMasterToggleUI(false); // Stop
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
    if (!globalSystemPower && id === 1) {
        addLog('⚠️ ACESSO NEGADO: Ligue a "Conexão Global" no botão do TOPO primeiro.', 'error');
        return;
    }
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
    
    // Inicia e acopla a rotina de Espelhamento do Saldo Estimado (Intervalo de Segurança 30 min solicitado)
    syncBinanceBalance();
    if (!window.balanceSyncInterval) {
        window.balanceSyncInterval = setInterval(syncBinanceBalance, 30 * 60 * 1000); 
    }
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
        addLog(`[SISTEMA] Monitoramento do Terminal ${id} Ativado. Aguardando Janelas de Oportunidade.`, 'system');
    } else {
        btn.textContent = 'INICIAR MONITORAMENTO'; btn.classList.remove('on');
        addLog(`[SISTEMA] Monitoramento do Terminal ${id} Suspenso.`, 'system');
    }
    updateMasterToggleUI(activeSlots[id].monitoring);
}

function disconnectSlot(id) {
    activeSlots[id].connected = false; activeSlots[id].monitoring = false;
    document.getElementById(`slot-${id}-status`).textContent = 'DESCONECTADO';
    document.getElementById(`slot-${id}-status`).classList.remove('connected');
    const actBtn = document.getElementById(`activate-${id}`);
    actBtn.classList.remove('on');
    const connBtn = document.querySelector(`#slot-${id} .btn-connect`);
    connBtn.textContent = '1. CONECTAR'; connBtn.onclick = () => connectSlot(id);
    
    // Reseta o header visual
    const headerPnl = document.getElementById('header-realtime-pnl');
    const headerLabel = headerPnl ? headerPnl.previousElementSibling : null;
    if (headerPnl) {
        if (headerLabel) headerLabel.textContent = 'PNL ATUAL';
        headerPnl.textContent = 'Aguardando...';
        headerPnl.style.color = 'var(--text-muted)';
    }
    updateMasterToggleUI(false); // Disconnect
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

// Rotina Autônoma: Espelhamento Fiel do "Saldo Estimado" (USDT) da Corretora
async function syncBinanceBalance() {
    const slot = activeSlots[1];
    if (!globalSystemPower) { console.log('Sync Negado: System Off'); return; }
    if (!slot.key || !slot.secret) { addLog('⚠️ Tentativa de Espelhamento de Capital sem Chaves. Salve as chaves ("1. CONECTAR").', 'error'); return; }
    
    try {
        addLog('[SISTEMA] Solicitando Espelhamento Direto da Binance (Spot)...', 'system');
        const timestamp = Date.now();
        const params = `timestamp=${timestamp}&recvWindow=60000`;
        const signature = signRequest(params, slot.secret);
        const res = await fetch(`${CONFIG.BINANCE_API}/account?${params}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': slot.key }
        });
        const data = await res.json();
        if(!data.balances) {
            addLog(`❌ Binance rejeitou espelhamento. Cod: ${data.code} Msg: ${data.msg}`, 'error');
        }
        
        if (data.balances) {
            let totalEstimatedUsdt = 0;
            const nonZeroBalances = data.balances.filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0);
            
            // Requisita os precos de todos os tickers de uma vez para cruzar dados
            let tickerMap = {};
            if (nonZeroBalances.length > 1) { // Tem outras moedas além do USDT
                try {
                    const tRes = await fetch(`${CONFIG.BINANCE_API}/ticker/price`);
                    const tData = await tRes.json();
                    tData.forEach(t => tickerMap[t.symbol] = parseFloat(t.price));
                } catch(e) {}
            }

            for (const b of nonZeroBalances) {
                const amount = parseFloat(b.free) + parseFloat(b.locked);
                if (b.asset === 'USDT') {
                    totalEstimatedUsdt += amount;
                } else {
                    const priceInUsdt = tickerMap[b.asset + 'USDT'];
                    if (priceInUsdt) {
                        totalEstimatedUsdt += amount * priceInUsdt;
                    }
                }
            }

            // Atualiza Componente na Interface se a operação estiver Livre
            if (!currentTrade) {
                const headerPnl = document.getElementById('header-realtime-pnl');
                const headerLabel = headerPnl ? headerPnl.previousElementSibling : null;
                if (headerPnl) {
                    if (headerLabel) headerLabel.textContent = 'SALDO ESTIMADO BINANCE';
                    headerPnl.innerHTML = `<strong style="color: #fff;">$${totalEstimatedUsdt.toFixed(2)}</strong> <span style="font-size: 0.6em; color: var(--text-muted)">USDT</span>`;
                    headerPnl.style.color = '#fff';
                }
            }
        }
    } catch (e) {
        addLog(`❌ FALHA DE ESPELHAMENTO: ${e.message}. Verifique sua internet ou permissão de API IP.`, 'error');
        console.error("Erro ao sincronizar Saldo Estimado:", e);
    }
}


function masterToggle() {
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
}
function updateMasterToggleUI(isMonitoring) {
    const btn = document.getElementById('master-toggle-btn');
    if (!btn) return;
    if (isMonitoring) {
        btn.innerHTML = 'DESCONECTAR';
        btn.style.background = 'rgba(255, 102, 0, 0.15)';
        btn.style.borderColor = '#ff6600';
        btn.style.color = '#ff6600';
        btn.style.animation = 'blink 1.5s infinite';
    } else {
        btn.innerHTML = 'CONECTAR';
        btn.style.background = 'rgba(0,255,136,0.15)';
        btn.style.borderColor = 'var(--accent-green)';
        btn.style.color = 'var(--accent-green)';
        btn.style.animation = 'none';
    }
}


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
