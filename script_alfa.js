/**
 * SIFRAS ALFA SNIPER ELITE v3.5 FERRARI
 * Protocolo de Monitoramento #3 | Alvo 0.8% | Sem Stop Loss
 */

const CONFIG = {
    UPDATE_INTERVAL: 2000,
    LOG_INTERVAL: 5000,
    TARGET_PROFIT: 0.8,
    BLACKLIST: [
        'SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'ASR', 'ATM', 'ACM', 'BAR', 'CITY', 'INTER', 'JUV', 'OG', 'PSG', 'ARG', 'POR', 'TRA', 'NAP', 'SAU', 'ALV',
        'LUNC', 'USTC', 'FTT', 'VGX', 'WRX', 'REP', 'BOND', 'EPX', 'POLS', 'MULT', 'PNT', 'WAVES', 'OMNI', 'REEF', 'MDX', 'LOOM', 'KP3R', 'DOCK', 'OAX', 'PROS', 'VITE', 'FOR', 'IRIS', 'NULS', 'FIDA', 'CVX', 'HARD', 'WNXM', 'GLM', 'AKRO',
        'AVA', 'KP3R', 'REEF', 'VITE', 'UNFI', 'OAX', 'DOCK', 'NULS', 'IRIS', 'TWT'
    ]
};

let activeSlots = { 1: { key: '', secret: '', name: '', monitoring: false } };
let currentTrade = null;
let cycleCount = 0;
let lastExecutedSymbol = null;
let tradeSocket = null;
let globalSystemPower = false;
let isClosingTrade = false;
let startOfDayBalance = null;

document.addEventListener('DOMContentLoaded', () => {
    loadSavedState();
    startOperationalLoop();
    startDynamicLogExposition();
});

async function startOperationalLoop() {
    while (true) {
        if (globalSystemPower) {
            try {
                const ranking = await fetchRanking();
                if (ranking && ranking.length >= 5) {
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

function startDynamicLogExposition() {
    setInterval(() => {
        if (!globalSystemPower || currentTrade || isClosingTrade) return;
        addLog(`[SCANNER FERRARI] Monitorando Pixels. Pivô Rank #3 ativo.`, 'scan');
    }, CONFIG.LOG_INTERVAL);
}

function analyzeSniper(ranking) {
    if (currentTrade || isClosingTrade) return;
    const coin3 = ranking[2], coin2 = ranking[1], coin4 = ranking[3];
    if (!coin3 || !coin2 || !coin4) return;
    const d3_2 = Math.abs(coin2.vol - coin3.vol), d3_4 = Math.abs(coin4.vol - coin3.vol);
    let target = d3_2 < d3_4 ? coin2 : coin4, rankTarget = d3_2 < d3_4 ? '#2' : '#4';
    const sym = target.symbol.replace('USDT', '');
    if (sym === lastExecutedSymbol || CONFIG.BLACKLIST.includes(sym)) return;
    addLog(`[MONITOR #3] Apontando para ${rankTarget}: ${sym} (Delta: ${Math.min(d3_2, d3_4).toFixed(3)}%)`, 'system');
    addLog(`🔥 sniper detectada! Iniciando entrada no ${sym}...`, 'buy_neon');
    executeTrade(target);
}

async function executeTrade(coin) {
    const tp = coin.price * (1 + (CONFIG.TARGET_PROFIT / 100));
    currentTrade = { symbol: coin.symbol.replace('USDT', ''), fullSymbol: coin.symbol, buyPrice: coin.price, targetPrice: tp, qty: 0, startTime: Date.now() };
    updateTradeUI(true);
    const res = await sendOrder('BUY', currentTrade.fullSymbol);
    if (res && res.orderId) {
        currentTrade.qty = parseFloat(res.executedQty || 0);
        saveActiveTrade();
        addLog(`✅ ORDEM EXECUTADA! ${currentTrade.symbol} sniperado com sucesso. $${res.cummulativeQuoteQty} USDT investidos.`, 'system');
        initPriceSocket(currentTrade.fullSymbol);
    } else {
        addLog(`❌ FALHA NA ENTRADA: O motor não recebeu confirmação da ordem.`, 'error');
        resetTrade();
    }
}

function saveActiveTrade() {
    localStorage.setItem('alfa_active_trade_v35', JSON.stringify(currentTrade));
}

function initPriceSocket(symbol) {
    if (tradeSocket) tradeSocket.close();
    tradeSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`);
    tradeSocket.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d && d.c) updateLivePNL(parseFloat(d.c));
    };
}

function updateLivePNL(curr) {
    if (!currentTrade || isClosingTrade) return;
    const pnl = ((curr - currentTrade.buyPrice) / currentTrade.buyPrice) * 100;
    const pnlUsdt = (pnl / 100) * (currentTrade.buyPrice * currentTrade.qty);
    document.getElementById('monitoring-pl').textContent = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;
    document.getElementById('monitoring-pl').style.color = pnl >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
    document.getElementById('monitoring-pnl-usdt').textContent = `($${pnlUsdt >= 0 ? '+' : ''}${pnlUsdt.toFixed(2)})`;
    document.getElementById('monitoring-current-price').textContent = `$${curr.toFixed(4)}`;
    const prog = Math.max(0, Math.min(100, (pnl / CONFIG.TARGET_PROFIT) * 100));
    document.getElementById('trade-progress-fill').style.width = `${prog}%`;
    if (pnl >= CONFIG.TARGET_PROFIT && !isClosingTrade) { isClosingTrade = true; liquidateTrade(pnl); }
}

async function liquidateTrade(final) {
    addLog(`🎯 ALVO ALCANÇADO! Meta de ${CONFIG.TARGET_PROFIT}% batida. Fechando...`, 'sell_neon');
    const info = await fetchOrderInfo(currentTrade.fullSymbol);
    let q = currentTrade.qty;
    if (info) {
        const step = parseFloat(info.symbols[0].filters.find(f => f.filterType === 'LOT_SIZE').stepSize);
        q = (Math.floor((q * 0.999) / step) * step).toFixed(8).replace(/\.?0+$/, "");
    }
    const res = await sendOrder('SELL', currentTrade.fullSymbol, q);
    if (res && res.orderId) {
        addLog(`💰 LUCRO NO BOLSO! ${currentTrade.symbol} liquidado com sucesso.`, 'sell_neon');
        showProfitOverlay();
        lastExecutedSymbol = currentTrade.symbol; cycleCount++; saveGlobalState(); resetTrade(); syncBalance();
    } else { 
        addLog(`❌ ERRO NA LIQUIDAÇÃO. Finalize manualmente na Binance!`, 'error'); 
        isClosingTrade = false; 
    }
}

async function fetchRanking() {
    const start = performance.now();
    try { 
        const r = await fetch('/moedas-ranking'); 
        const end = performance.now();
        const lat = Math.round(end - start);
        const elLat = document.getElementById('header-latency');
        if (elLat) {
            elLat.textContent = `${lat} ms`;
            elLat.style.color = lat < 250 ? 'var(--primary-neon)' : (lat < 600 ? '#f1c40f' : 'var(--danger-neon)');
        }
        return await r.json(); 
    } catch(e) { return null; }
}

async function sendOrder(side, symbol, qty = null) {
    const body = { key: activeSlots[1].key, secret: activeSlots[1].secret, symbol, side };
    if (qty) body.qty = qty;
    try {
        const r = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        return d;
    } catch(e) { 
        addLog(`⚠️ ORDEM RECUSADA: ${e.message}`, 'error');
        return null; 
    }
}

function renderRanking(ranking) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    grid.innerHTML = ranking.slice(0, 10).map((c, i) => `
        <div class="ranking-item ${i === 2 ? 'log-neon-scan' : ''}">
            <span class="rank-num">#${i + 1}</span>
            <span class="coin-name">${c.symbol.replace('USDT', '')}</span>
            <span class="coin-vol">${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%</span>
        </div>
    `).join('');
}

function addLog(msg, type = 'system') {
    const monitor = document.getElementById('log-monitor');
    if (!monitor) return;
    const time = new Date().toLocaleTimeString();
    let html = "";
    if (type.includes('neon')) {
        const cls = type.includes('buy') ? 'log-neon-buy' : 'log-neon-sell';
        html = `<div class="log-card ${cls}"><span class="log-timestamp">${time}</span><span class="log-entry-text" style="font-weight:900;">${msg.toUpperCase()}</span></div>`;
    } else {
        const cls = type === 'scan' ? 'log-neon-scan' : `log-entry ${type}`;
        html = `<div class="${cls}"><span class="log-timestamp">${time}</span><span class="log-entry-text">${msg}</span></div>`;
    }
    monitor.innerHTML = html + monitor.innerHTML;
}

function updateTradeUI(active) {
    document.getElementById('active-trade-container').classList.toggle('hidden', !active);
    document.getElementById('no-trade-msg').classList.toggle('hidden', active);
    const pill = document.getElementById('system-status-pill');
    pill.textContent = active ? 'MONITORANDO TRADE' : (globalSystemPower ? 'BUSCANDO ALVO' : 'OFFLINE');
    pill.style.borderColor = active ? 'var(--accent-green)' : 'var(--card-border)';
    if (active) {
        document.getElementById('monitoring-symbol').textContent = currentTrade.symbol;
        document.getElementById('monitoring-buy-price').textContent = `$${currentTrade.buyPrice.toFixed(4)}`;
        document.getElementById('monitoring-target-price').textContent = `$${currentTrade.targetPrice.toFixed(4)}`;
    }
}

function masterToggle() {
    globalSystemPower = !globalSystemPower;
    const btn = document.getElementById('master-toggle-btn');
    btn.textContent = globalSystemPower ? 'DESCONECTAR' : 'CONECTAR MASTER';
    btn.style.borderColor = globalSystemPower ? 'var(--danger-neon)' : 'var(--primary-neon)';
    activeSlots[1].monitoring = globalSystemPower;
    if (globalSystemPower) {
        syncBalance();
        setInterval(syncBalance, 10000);
    }
    updateTradeUI(false);
}

function resetTrade() { 
    currentTrade = null; 
    isClosingTrade = false; 
    if (tradeSocket) tradeSocket.close(); 
    localStorage.removeItem('alfa_active_trade_v35');
    updateTradeUI(false); 
}

function saveSlot(id) {
    const s = { name: document.getElementById('slot-1-name').value, key: document.getElementById('slot-1-key').value, secret: document.getElementById('slot-1-secret').value };
    activeSlots[1] = { ...activeSlots[1], ...s };
    localStorage.setItem('alfa_slot_1', JSON.stringify(s));
    addLog(`Configurações de API salvas.`, 'system');
    syncBalance();
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
            const pnlVal = d.totalUsdt - startOfDayBalance;
            const pnlPct = (pnlVal / startOfDayBalance) * 100;
            
            const elCabBal = document.getElementById('cabinet-total-balance');
            if (elCabBal) elCabBal.innerHTML = `$ ${d.totalUsdt.toFixed(2)} <span style="font-size:1.5rem; color:var(--text-muted); font-weight:400;">USDT</span>`;
            
            const elPnl = document.getElementById('header-realtime-pnl');
            const elCabPnl = document.getElementById('cabinet-realtime-pnl');
            if (elPnl) {
                const txt = `${pnlVal >= 0 ? '+' : ''}$${pnlVal.toFixed(2)} (${pnlPct.toFixed(2)}%)`;
                elPnl.textContent = txt;
                elPnl.style.color = pnlVal >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
                elPnl.classList.remove('waiting');
                
                if (elCabPnl) {
                    elCabPnl.innerHTML = `PNL HOJE: <span style="color:${pnlVal >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)'}">${txt}</span>`;
                }
            }
            saveGlobalState();
        }
    } catch(e) {}
}

function saveGlobalState() { localStorage.setItem('alfa_state_v35', JSON.stringify({ cycleCount, lastExecutedSymbol, startOfDayBalance })); }

function loadSavedState() {
    const s = JSON.parse(localStorage.getItem('alfa_state_v35') || '{}');
    cycleCount = s.cycleCount || 0;
    lastExecutedSymbol = s.lastExecutedSymbol || null;
    startOfDayBalance = s.startOfDayBalance || null;
    document.getElementById('cycle-counter').textContent = `${cycleCount} / 24`;
    
    // Recuperar trade ativo
    const activeTrade = JSON.parse(localStorage.getItem('alfa_active_trade_v35') || 'null');
    if (activeTrade) {
        currentTrade = activeTrade;
        updateTradeUI(true);
        initPriceSocket(currentTrade.fullSymbol);
        addLog(`[SISTEMA] Trade recuperado da memória: ${currentTrade.symbol}`, 'system');
    }

    const slot = JSON.parse(localStorage.getItem('alfa_slot_1') || '{}');
    if (slot.key) {
        document.getElementById('slot-1-name').value = slot.name || '';
        document.getElementById('slot-1-key').value = slot.key || '';
        document.getElementById('slot-1-secret').value = slot.secret || '';
        activeSlots[1] = { ...activeSlots[1], ...slot };
    }
}

async function fetchOrderInfo(symbol) { try { const r = await fetch(`/info-par?symbol=${symbol}`); return await r.json(); } catch(e) { return null; } }

function showProfitOverlay() {
    const o = document.getElementById('profit-overlay');
    o.classList.add('show');
    setTimeout(() => o.classList.remove('show'), 6000);
}
