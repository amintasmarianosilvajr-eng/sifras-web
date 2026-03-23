/**
 * SIFRAS ALFA SNIPER ELITE V1.0
 * Reconstrução Total: Sniper Rank 10 | Alvo 0.5% | Sem Stop Loss
 */

// --- CONFIGURAÇÃO MASTER ---
const CONFIG = {
    UPDATE_INTERVAL: 2000,
    TARGET_PROFIT: 0.5,         // Meta fixa de 0.5%
    BLACKLIST: [
        'SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'ASR', 'ATM', 'ACM', 'BAR', 'CITY', 'INTER', 'JUV', 'OG', 'PSG', 'ARG', 'POR', 'TRA', 'NAP', 'SAU', 'ALV',
        'LUNC', 'USTC', 'FTT', 'VGX', 'WRX', 'REP', 'BOND', 'EPX', 'POLS', 'MULT', 'PNT', 'WAVES', 'OMNI', 'REEF', 'MDX', 'LOOM', 'KP3R', 'DOCK', 'OAX', 'PROS', 'VITE', 'FOR', 'IRIS', 'NULS', 'FIDA', 'CVX', 'HARD', 'WNXM', 'GLM', 'AKRO',
        'AVA', 'KP3R', 'REEF', 'VITE', 'UNFI', 'OAX', 'DOCK', 'NULS', 'IRIS', 'TWT'
    ]
};

// --- ESTADO GLOBAL ---
let activeSlots = { 1: { key: '', secret: '', name: '', monitoring: false } };
let currentTrade = null;
let cycleCount = 0;
let cycleOnPause = false;
let cycleResumeTime = null;
let startOfDayBalance = null;
let lastExecutedSymbol = null; // Anti-repetição
let tradeSocket = null;
let globalSystemPower = false;
let isClosingTrade = false;
let symbolRules = {}; // Cache de precisão

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    loadSavedState();
    startOperationalLoop();
});

// --- OPERACIONAL LOOP ---
async function startOperationalLoop() {
    while (true) {
        if (globalSystemPower && !cycleOnPause) {
            try {
                const ranking = await fetchRanking();
                if (ranking && ranking.length >= 10) {
                    renderRanking(ranking);
                    if (!currentTrade && activeSlots[1].monitoring) {
                        analyzeSniper(ranking);
                    }
                }
            } catch (e) {
                console.error("Operational fail:", e);
            }
        }
        await new Promise(r => setTimeout(r, CONFIG.UPDATE_INTERVAL));
    }
}

// --- LOGICA SNIPER (RANK 10) ---
function analyzeSniper(ranking) {
    if (currentTrade || isClosingTrade) return;

    // Foco Exclusivo no Rank #10 (índice 9)
    const coin = ranking[9];
    if (!coin) return;

    const symbolShort = coin.symbol.replace('USDT', '');

    // Filtros de Segurança
    if (symbolShort === lastExecutedSymbol) return; // Anti-repetição
    if (CONFIG.BLACKLIST.includes(symbolShort)) return; // Exclui shitcoins

    // Gatilho Sniper Confirmado
    addLog(`[TARGET DETECTADO] Sniper Rank #10: ${symbolShort} (+${coin.vol.toFixed(2)}%). Disparando Ordem...`, 'buy');
    executeTrade(coin);
}

// --- EXECUÇÃO DE TRADE ---
async function executeTrade(coin) {
    const tp = coin.price * (1 + (CONFIG.TARGET_PROFIT / 100));
    currentTrade = {
        symbol: coin.symbol.replace('USDT', ''),
        fullSymbol: coin.symbol,
        buyPrice: coin.price,
        targetPrice: tp,
        qty: 0,
        startTime: Date.now()
    };

    // Update UI
    updateTradeUI(true);
    
    // Disparar Ordem Real via Backend
    const res = await sendOrder('BUY', currentTrade.fullSymbol);
    if (res && res.orderId) {
        currentTrade.qty = parseFloat(res.executedQty || 0);
        saveActiveTrade();
        addLog(`[ORDEM EXECUTADA] Compra de ${currentTrade.symbol} $${res.cummulativeQuoteQty} USDT.`, 'buy');
        initPriceSocket(currentTrade.fullSymbol);
    } else {
        addLog(`[ERRO] Ordem Recusada. Verifique Saldo e API.`, 'error');
        resetTrade();
    }
}

// --- MONITORAMENTO AO VIVO (WEBSOCKET) ---
function initPriceSocket(symbol) {
    if (tradeSocket) tradeSocket.close();
    tradeSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`);
    tradeSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data && data.c) {
            updateLivePNL(parseFloat(data.c));
        }
    };
}

function updateLivePNL(currentPrice) {
    if (!currentTrade || isClosingTrade) return;

    const pnlPct = ((currentPrice - currentTrade.buyPrice) / currentTrade.buyPrice) * 100;
    const pnlUsdt = currentTrade.qty > 0 ? (currentPrice * currentTrade.qty) - (currentTrade.buyPrice * currentTrade.qty) : 0;

    // Update UI
    const elPct = document.getElementById('monitoring-pl');
    const elUsdt = document.getElementById('monitoring-pnl-usdt');
    const elCurrent = document.getElementById('monitoring-current-price');
    const elFill = document.getElementById('trade-progress-fill');

    if (elPct) {
        elPct.textContent = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`;
        elPct.style.color = pnlPct >= 0 ? 'var(--accent-green-bright)' : 'var(--danger)';
    }
    if (elUsdt) elUsdt.textContent = `$${pnlUsdt.toFixed(2)}`;
    if (elCurrent) elCurrent.textContent = `$${currentPrice.toFixed(4)}`;
    
    const progress = Math.max(0, Math.min(100, (pnlPct / CONFIG.TARGET_PROFIT) * 100));
    if (elFill) elFill.style.width = `${progress}%`;

    // Gatilho de Take Profit (0.5%)
    if (pnlPct >= CONFIG.TARGET_PROFIT && !isClosingTrade) {
        isClosingTrade = true;
        liquidateTrade(pnlPct);
    }
}

// --- LIQUIDAÇÃO DE OPERAÇÃO ---
async function liquidateTrade(finalPnl) {
    addLog(`[ALVO ALCANÇADO] Meta de ${CONFIG.TARGET_PROFIT}% batida. Vendendo...`, 'sell');
    
    // Busca informações de precisão do par
    const info = await fetchOrderInfo(currentTrade.fullSymbol);
    let qtyToSell = currentTrade.qty;

    if (info) {
        const lotFilter = info.symbols[0].filters.find(f => f.filterType === 'LOT_SIZE');
        const stepSize = parseFloat(lotFilter.stepSize);
        qtyToSell = (Math.floor((qtyToSell * 0.999) / stepSize) * stepSize).toFixed(8); // -0.1% margem taxa
    }

    const res = await sendOrder('SELL', currentTrade.fullSymbol, qtyToSell);
    if (res && res.orderId) {
        addLog(`[META CONCLUÍDA] Venda de ${currentTrade.symbol} finalizada com lucro!`, 'sell');
        showProfitOverlay();
        lastExecutedSymbol = currentTrade.symbol;
        cycleCount++;
        saveGlobalState();
        resetTrade();
        syncBalance(); 
    } else {
        addLog(`[ERRO] Falha na liquidação. Verifique saldo manual.`, 'error');
        isClosingTrade = false;
    }
}

// --- AUXILIARES ---
async function fetchRanking() {
    try {
        const r = await fetch('/moedas-ranking');
        return await r.json();
    } catch(e) { return null; }
}

async function sendOrder(side, symbol, qty = null) {
    const body = {
        key: activeSlots[1].key,
        secret: activeSlots[1].secret,
        symbol: symbol,
        side: side,
        type: 'MARKET',
        useMaxBalance: (side === 'BUY' && !qty) // Nova flag para o backend
    };
    if (qty) body.qty = qty;

    try {
        const r = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const res = await r.json();
        if (res.error) console.error("Order Error:", res.error);
        return res;
    } catch(e) { return null; }
}

async function syncBalance() {
    if (!activeSlots[1].key || !globalSystemPower) return;
    try {
        const r = await fetch('/pnl-real', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: activeSlots[1].key, secret: activeSlots[1].secret })
        });
        const d = await r.json();
        if (d.totalUsdt) {
            if (!startOfDayBalance) startOfDayBalance = d.totalUsdt;
            const pnl = d.totalUsdt - startOfDayBalance;
            const pnlPct = (pnl / startOfDayBalance) * 100;
            const el = document.getElementById('header-realtime-pnl');
            if (el) {
                el.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`;
                el.style.color = pnl >= 0 ? 'var(--accent-green-bright)' : 'var(--danger)';
                el.classList.remove('waiting');
            }
            saveGlobalState();
        }
    } catch(e) {}
}

function renderRanking(ranking) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    grid.innerHTML = ranking.slice(0, 15).map((c, i) => `
        <div class="ranking-item ${i === 9 ? 'sniper-target' : ''}">
            <span class="rank-num">#${i + 1}</span>
            <span class="coin-name">${c.symbol.replace('USDT', '')}</span>
            <span class="coin-vol">${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%</span>
        </div>
    `).join('');
}

function updateTradeUI(isActive) {
    const container = document.getElementById('active-trade-container');
    const msg = document.getElementById('no-trade-msg');
    const pill = document.getElementById('system-status-pill');

    if (isActive) {
        container.classList.remove('hidden');
        msg.classList.add('hidden');
        pill.textContent = 'MONITORANDO';
        pill.style.background = 'var(--accent-green)';
        document.getElementById('monitoring-symbol').textContent = currentTrade.symbol;
        document.getElementById('monitoring-buy-price').textContent = `$${currentTrade.buyPrice.toFixed(4)}`;
        document.getElementById('monitoring-target-price').textContent = `$${currentTrade.targetPrice.toFixed(4)}`;
    } else {
        container.classList.add('hidden');
        msg.classList.remove('hidden');
        pill.textContent = globalSystemPower ? 'BUSCANDO...' : 'OFFLINE';
        pill.style.background = globalSystemPower ? 'var(--primary)' : 'var(--card-border)';
    }
}

function masterToggle() {
    globalSystemPower = !globalSystemPower;
    const btn = document.getElementById('master-toggle-btn');
    if (globalSystemPower) {
        btn.textContent = 'DESCONECTAR';
        btn.style.borderColor = 'var(--danger)';
        btn.style.color = 'var(--danger)';
        activeSlots[1].monitoring = true;
        syncBalance();
        setInterval(syncBalance, 15000);
    } else {
        btn.textContent = 'CONECTAR MASTER';
        btn.style.borderColor = 'var(--accent-green)';
        btn.style.color = 'var(--accent-green-bright)';
        activeSlots[1].monitoring = false;
        resetTrade();
    }
    updateTradeUI(false);
}

function addLog(msg, type) {
    const monitor = document.getElementById('log-monitor');
    if (!monitor) return;
    const time = new Date().toLocaleTimeString();
    monitor.innerHTML = `<div class="log-entry ${type}">[${time}] ${msg}</div>` + monitor.innerHTML;
}

function resetTrade() {
    currentTrade = null;
    isClosingTrade = false;
    if (tradeSocket) tradeSocket.close();
    localStorage.removeItem('active_trade_alfa');
    updateTradeUI(false);
}

function saveActiveTrade() {
    localStorage.setItem('active_trade_alfa', JSON.stringify(currentTrade));
}

function saveGlobalState() {
    const state = { cycleCount, startOfDayBalance, lastExecutedSymbol };
    localStorage.setItem('alfa_global_state', JSON.stringify(state));
    document.getElementById('cycle-counter').textContent = `${cycleCount} / 10`;
}

function loadSavedState() {
    const g = localStorage.getItem('alfa_global_state');
    if (g) {
        const s = JSON.parse(g);
        cycleCount = s.cycleCount || 0;
        startOfDayBalance = s.startOfDayBalance || null;
        lastExecutedSymbol = s.lastExecutedSymbol || null;
        document.getElementById('cycle-counter').textContent = `${cycleCount} / 10`;
    }
    const slot = localStorage.getItem('alfa_slot_1');
    if (slot) {
        const d = JSON.parse(slot);
        document.getElementById('slot-1-name').value = d.name;
        document.getElementById('slot-1-key').value = d.key;
        document.getElementById('slot-1-secret').value = d.secret;
        activeSlots[1] = { ...activeSlots[1], ...d };
    }
}

function saveSlot(id) {
    const name = document.getElementById(`slot-${id}-name`).value;
    const key = document.getElementById(`slot-${id}-key`).value;
    const secret = document.getElementById(`slot-${id}-secret`).value;
    activeSlots[id] = { ...activeSlots[id], name, key, secret };
    localStorage.setItem(`alfa_slot_${id}`, JSON.stringify({ name, key, secret }));
    addLog(`Configuração do Slot #${id} salva com sucesso.`, 'system');
}

async function fetchOrderInfo(symbol) {
    try {
        const r = await fetch(`/info-par?symbol=${symbol}`);
        return await r.json();
    } catch(e) { return null; }
}

function showProfitOverlay() {
    const o = document.getElementById('profit-overlay');
    o.classList.add('show');
    setTimeout(() => o.classList.remove('show'), 6000);
}
