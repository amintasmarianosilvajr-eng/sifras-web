/**
 * SIFRAS ALFA v5.2.0 - OMEGA-3 SUPREME SYNC
 * Sistema de Sincronia de Cronometria, Latência e PNL.
 * Blindagem total de Quantidade e Preço de Entrada.
 */

const CONFIG = {
    UPDATE_INTERVAL: 1000,
    LOG_INTERVAL: 5000,
    TARGET_PROFIT: 0.8,
    VOLATILITY_WINDOW: 10000,
    MIN_VOLATILITY_TRIGGER: 0.15,
    MAX_CYCLES: 10,
    COOLDOWN_TIME: 1800000,
    BLACKLIST: ['SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'ASR', 'ATM', 'ACM', 'BAR', 'CITY', 'INTER', 'JUV', 'OG', 'PSG', 'ARG', 'POR', 'TRA', 'NAP', 'SAU', 'ALV'],
    WITHDRAW_THRESHOLD: 15,
    WITHDRAW_ENABLED: true
};

// State Variables
let activeSlots = { 1: { key: '', secret: '', name: 'OPERADOR MASTER', monitoring: false } };
let currentTrade = null;
let globalSystemPower = false;
let isCooldownActive = false;
let tradeSocket = null;
let lastRankingHash = "";
let completedCycles = 0;
let sessionStartBalance = parseFloat(localStorage.getItem('alfa_session_start') || '0');
let syncCountdown = 10;
let tradeStartTime = null;

let isAnalyzingVolatility = false;
let analysisStartTime = 0;
let volatilityBuffer = {};
let tradeHistory = [];

// --- BOOTSTRAP ---

document.addEventListener('DOMContentLoaded', () => {
    console.log("[ALFA v5.2.0] Inicializando Blindagem Omega-3...");
    setTimeout(() => {
        loadSavedState();
        syncBalance();
        pushNetworkHeartbeat();
    }, 500);

    setInterval(updateHeartbeatUI, 1000);
    setInterval(pushNetworkHeartbeat, 5000);
    
    const nameInput = document.getElementById('slot-1-name');
    if (nameInput) nameInput.addEventListener('blur', () => syncExistingProfile(nameInput.value));
});

// --- UI UPDATE LOOPS ---

async function updateHeartbeatUI() {
    if (!globalSystemPower) {
        updateChronometryStatic();
        return;
    }

    syncCountdown--;
    if (syncCountdown <= 0) {
        syncCountdown = 10;
        await syncBalance();
    }

    updateChronometryActive();
    updateSessionStats();
    
    // LIVE UPDATE DE PNL SE HOUVER TRADE
    if (currentTrade) {
        updateTradePriceLive();
    }
}

function updateChronometryStatic() {
    const syncVal = document.getElementById('sync-timer-val');
    if (syncVal) syncVal.innerText = "OFF";
    const elCycle = document.getElementById('cycle-counter');
    if (elCycle) elCycle.textContent = "OFFLINE";
    updateLatencyUI(0);
}

function updateChronometryActive() {
    const syncCircle = document.getElementById('sync-circle');
    const syncVal = document.getElementById('sync-timer-val');
    if (syncCircle && syncVal) {
        const offset = 283 - (syncCountdown / 10) * 283;
        syncCircle.style.strokeDashoffset = offset;
        syncVal.innerText = `${syncCountdown}s`;
    }

    let elCycle = document.getElementById('cycle-counter');
    if (elCycle) {
        elCycle.textContent = isCooldownActive ? `PAUSA (${completedCycles}/10)` : `${completedCycles} / 10`;
    }

    const tradeCircle = document.getElementById('trade-circle');
    const tradeVal = document.getElementById('trade-timer-val');
    if (currentTrade && tradeStartTime && tradeVal) {
        const elapsed = Math.floor((Date.now() - tradeStartTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        tradeVal.innerText = `${mins}:${secs}`;
        const tradeOffset = 283 - ((elapsed % 60) / 60) * 283;
        if (tradeCircle) tradeCircle.style.strokeDashoffset = tradeOffset;
    } else if (tradeVal) {
        tradeVal.innerText = "00:00";
        if (tradeCircle) tradeCircle.style.strokeDashoffset = 283;
    }
}

function updateTradePriceLive() {
    if (!currentTrade) return;
    const price = window.lastSocketPrice || currentTrade.buyPrice;
    
    const elPrice = document.getElementById('monitoring-current-price');
    if (elPrice) elPrice.textContent = `$${price.toFixed(price < 0.1 ? 6 : 4)}`;

    const pl = ((price - currentTrade.buyPrice) / currentTrade.buyPrice) * 100;
    const plEl = document.getElementById('monitoring-pl');
    if (plEl) {
        plEl.textContent = `${pl >= 0 ? '+' : ''}${pl.toFixed(2)}%`;
        plEl.style.color = pl >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
    }

    const usdtEl = document.getElementById('monitoring-pnl-usdt');
    if (usdtEl) {
        const profit = (currentTrade.qty || 0) * (price - currentTrade.buyPrice);
        usdtEl.textContent = `($${profit.toFixed(2)})`;
    }

    const progress = Math.min((pl / CONFIG.TARGET_PROFIT) * 100, 100);
    const fill = document.getElementById('trade-progress-fill');
    if (fill) fill.style.width = `${Math.max(progress, 0)}%`;
}

async function syncBalance() {
    if (!activeSlots[1].key) return;
    try {
        const r = await fetch('/pnl-real', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: activeSlots[1].key, secret: activeSlots[1].secret })
        });
        const d = await r.json();
        if (d.totalUsdt !== undefined) {
            window.currentBalance = d.totalUsdt;
            if (!sessionStartBalance || sessionStartBalance <= 0) {
                sessionStartBalance = d.totalUsdt;
                localStorage.setItem('alfa_session_start', sessionStartBalance);
            }
            const el = document.getElementById('cabinet-total-balance');
            if (el) el.innerHTML = `$ ${d.totalUsdt.toFixed(2)} <span style="font-size:1rem; opacity:0.5;">USDT</span>`;
        }
    } catch(e) {}
}

function updateSessionStats() {
    const pnlHeader = document.getElementById('header-realtime-pnl');
    const pnlCabinet = document.getElementById('cabinet-realtime-pnl');
    if (!window.currentBalance || !sessionStartBalance) return;

    const profit = window.currentBalance - sessionStartBalance;
    const pct = (profit / sessionStartBalance) * 100;
    const color = profit >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
    const sign = profit >= 0 ? '+' : '';

    if (pnlHeader) {
        pnlHeader.textContent = `${sign}$${profit.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
        pnlHeader.style.color = color;
    }
    if (pnlCabinet) {
        pnlCabinet.innerHTML = `SESSION: <span style="color:${color}">${sign}$${profit.toFixed(2)}</span>`;
    }
}

// --- SYNC ENGINE ---

async function pushNetworkHeartbeat() {
    const username = document.getElementById('slot-1-name').value || 'OPERADOR';
    const keys = { key: document.getElementById('slot-1-key').value, secret: document.getElementById('slot-1-secret').value };

    const state = { 
        monitoring: globalSystemPower, 
        currentTrade,
        tradeStartTime,
        currentBalance: window.currentBalance || 0,
        cycleCount: completedCycles,
        tradeHistory
    };

    try {
        const r = await fetch('/heartbeat', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ username, state, keys }) 
        });
        const d = await r.json();
        
        // Sincronia de Ranking (Radar)
        if (d.marketRanking) {
            window.lastRankingData = d.marketRanking;
            renderRanking(d.marketRanking);
            renderOpportunityHub(d.marketRanking);
        }

        // Sincronia de Estado (Master Authority Recovery)
        if (d.serverState) {
            const s = d.serverState;
            completedCycles = s.cycleCount || 0;
            
            if (s.currentTrade) {
                if (!currentTrade || currentTrade.fullSymbol !== s.currentTrade.fullSymbol) {
                    currentTrade = s.currentTrade;
                    tradeStartTime = s.tradeStartTime || Date.now();
                    updateTradeUI(true);
                    initPriceSocket(currentTrade.fullSymbol);
                } else if (!currentTrade.qty && s.currentTrade.qty) {
                    // Recuperação de Qty perdida
                    currentTrade.qty = s.currentTrade.qty;
                }
            } else if (currentTrade) {
                // Venda realizada no servidor
                resetTrade();
            }
        }
    } catch (e) {}
}

function initPriceSocket(symbol) {
    if(tradeSocket) tradeSocket.close();
    tradeSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`);
    tradeSocket.onmessage = (e) => {
        const d = JSON.parse(e.data);
        window.lastSocketPrice = parseFloat(d.c);
    };
}

function updateTradeUI(active) {
    document.getElementById('active-trade-container').classList.toggle('hidden', !active);
    document.getElementById('no-trade-msg').classList.toggle('hidden', active);
    if (active && currentTrade) {
        document.getElementById('monitoring-symbol').textContent = currentTrade.symbol;
        const prec = currentTrade.buyPrice < 0.1 ? 6 : 4;
        document.getElementById('monitoring-buy-price').textContent = `$${currentTrade.buyPrice.toFixed(prec)}`;
        document.getElementById('monitoring-target-price').textContent = `$${(currentTrade.buyPrice * 1.008).toFixed(prec)}`;
        document.getElementById('system-status-pill').textContent = 'TRADE ATIVO';
        document.getElementById('system-status-pill').style.color = 'var(--accent-green)';
    } else {
        document.getElementById('system-status-pill').textContent = globalSystemPower ? 'SCANNING' : 'OFFLINE';
        document.getElementById('system-status-pill').style.color = globalSystemPower ? 'var(--primary-neon)' : 'var(--text-muted)';
    }
}

function renderRanking(ranking) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    
    if (!ranking || ranking.length === 0) {
        grid.innerHTML = `<div class="empty-msg" style="height: 50px; font-size:0.6rem; color:var(--text-muted); opacity:0.5;">Aguardando Sincronia da Binance API...</div>`;
        return;
    }

    grid.innerHTML = ranking.slice(0, 30).map((c, i) => `
        <div class="log-card" style="margin-bottom:8px; padding:10px; display:flex; justify-content:space-between; ${c.symbol === 'BTCUSDT' && ranking[0].vol === 0 ? 'opacity:0.6;' : ''}">
            <span style="font-weight:900; opacity:0.5;">#${i + 1}</span>
            <span style="font-weight:800;">${c.symbol.replace('USDT', '')}</span>
            <span style="font-weight:900; color:var(--accent-green);">${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%</span>
        </div>
    `).join('');
}

function renderOpportunityHub(rankingData) {
    const grid = document.getElementById('opportunity-grid');
    if (!grid || !tradeHistory.length) return;
    grid.innerHTML = tradeHistory.slice(0, 5).map(hist => {
        const live = rankingData.find(r => r.symbol === hist.fullSymbol);
        const currentPrice = live ? live.price : hist.sellPrice;
        const diff = ((currentPrice - hist.sellPrice) / hist.sellPrice) * 100;
        return `
            <div class="opt-card ${diff >= 0 ? 'recovering' : 'falling'}">
                <span class="opt-symbol">${hist.symbol}</span>
                <span style="color:${diff >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)'}">${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%</span>
                <button onclick="aproveitarOportunidade('${hist.fullSymbol}')" class="btn-opt-buy">SWITCH</button>
            </div>
        `;
    }).join('');
}

function resetTrade() { 
    if (tradeSocket) tradeSocket.close();
    currentTrade = null; 
    tradeStartTime = null; 
    updateTradeUI(false); 
}

async function agentForceSell() {
    if (!currentTrade) return;
    if (!confirm("⚠️ FORÇAR VENDA IMEDIATA?")) return;
    const name = document.getElementById('slot-1-name').value;
    const keys = { key: document.getElementById('slot-1-key').value, secret: document.getElementById('slot-1-secret').value };
    await fetch('/panic', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ username: name, key: keys.key, secret: keys.secret, symbol: currentTrade.fullSymbol }) 
    });
    resetTrade();
}

async function agentClearGhost() {
    const user = document.getElementById('slot-1-name').value;
    if (!confirm("⚠️ LIMPAR ESTADO FANTASMA?")) return;
    await fetch('/agent/clear-ghost', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ username: user }) 
    });
    resetTrade();
}

async function loadSavedState() {
     const name = document.getElementById('slot-1-name').value;
     if (!name) return;
     const r = await fetch('/get-alfa-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name }) });
     const { state } = await r.json();
     if (state && state.currentTrade) {
         currentTrade = state.currentTrade;
         tradeStartTime = state.tradeStartTime;
         updateTradeUI(true);
         initPriceSocket(currentTrade.fullSymbol);
     }
}

function updateLatencyUI(ms) {
    const el = document.getElementById('header-latency');
    if (el) el.textContent = ms > 0 ? `${ms}ms` : '--ms';
}

function masterToggle() {
    globalSystemPower = !globalSystemPower;
    const btn = document.getElementById('master-toggle-btn');
    btn.textContent = globalSystemPower ? 'DESCONECTAR' : 'CONECTAR';
    btn.classList.toggle('active', globalSystemPower);
    pushNetworkHeartbeat();
}

// Expose globals
window.agentForceSell = agentForceSell;
window.agentClearGhost = agentClearGhost;
window.masterToggle = masterToggle;
window.syncExistingProfile = (n) => localStorage.setItem('alfa_session_user', n);
