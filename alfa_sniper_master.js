/**
 * SIFRAS ALFA SNIPER ELITE v3.5 - MASTER CONSOLIDADO 
 */

const CONFIG = {
    UPDATE_INTERVAL: 2000, 
    LOG_INTERVAL: 5000,   
    TARGET_PROFIT: 0.7,
    STAIRCASE_START: 10,
    SLEEP_AFTER_N1: 1200000,
    BLACKLIST: ['SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'ASR', 'ATM', 'ACM', 'BAR', 'CITY', 'INTER', 'JUV', 'OG', 'PSG', 'ARG', 'POR', 'TRA', 'NAP', 'SAU', 'ALV']
};

let activeSlots = { 1: { key: '', secret: '', name: 'OPERADOR MASTER', monitoring: false } };
let currentTrade = null;
let staircaseIndex = 10;
let globalSystemPower = false;
let isCooldownActive = false;
let startOfDayBalance = null;
let tradeSocket = null;
let lastRankingHash = "";
let lastLogMsg = "";

document.addEventListener('DOMContentLoaded', () => {
    loadSavedState();
    startOperationalLoop();
    
    const nameInput = document.getElementById('slot-1-name');
    if (nameInput) nameInput.addEventListener('blur', () => syncExistingProfile(nameInput.value));
});

async function startOperationalLoop() {
    startHeartbeat();
    while (true) {
        try {
            if (!isCooldownActive) {
                const ranking = await fetchRanking();
                if (ranking && ranking.length >= 1) {
                    renderRanking(ranking);
                    if (globalSystemPower && !currentTrade && activeSlots[1].monitoring) {
                        analyzeSniper(ranking);
                    }
                }
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, CONFIG.UPDATE_INTERVAL));
    }
}

async function startHeartbeat() {
    const run = async () => {
        const username = activeSlots[1].name || 'OPERADOR';
        const state = {
            status: currentTrade ? 'IN_TRADE' : (globalSystemPower ? 'SCANNING' : 'OFFLINE'),
            activeSymbol: currentTrade ? currentTrade.fullSymbol : '---',
            balanceUSDT: window.currentBalance || 0
        };
        try {
            const r = await fetch('/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, state, keys: { key: activeSlots[1].key, secret: activeSlots[1].secret } })
            });
            const d = await r.json();
            if (d.command === 'STOP' && globalSystemPower) masterToggle();
        } catch (e) {}
    };
    run();
    setInterval(run, 5000);
}

function renderRanking(ranking) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    
    const currentHash = ranking.slice(0, 10).map(c => c.symbol).join('|');
    if (currentHash === lastRankingHash) {
        ranking.slice(0, 10).forEach((c, i) => {
            const el = document.querySelectorAll('.coin-vol')[i];
            if (el) el.textContent = `${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%`;
        });
        return;
    }
    lastRankingHash = currentHash;
    grid.innerHTML = ranking.slice(0, 10).map((c, i) => `
        <div class="ranking-item">
            <span class="rank-num">#${i + 1}</span>
            <span class="coin-name">${c.symbol.replace('USDT', '')}</span>
            <span class="coin-vol">${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%</span>
        </div>
    `).join('');
}

function analyzeSniper(ranking) {
    if (currentTrade || isCooldownActive) return;
    const targetCoin = ranking[staircaseIndex - 1];
    if (targetCoin) executeTrade(targetCoin);
}

async function executeTrade(coin) {
    const tp = coin.price * (1 + (CONFIG.TARGET_PROFIT / 100));
    currentTrade = { symbol: coin.symbol.replace('USDT', ''), fullSymbol: coin.symbol, buyPrice: coin.price, targetPrice: tp, qty: 0 };
    updateTradeUI(true);
    
    try {
        const r = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                key: activeSlots[1].key, 
                secret: activeSlots[1].secret, 
                symbol: currentTrade.fullSymbol, 
                side: 'BUY',
                buyPercentage: activeSlots[1].buyPercentage || 100
            })
        });
        const d = await r.json();
        
        if (d.orderId) {
            currentTrade.qty = parseFloat(d.executedQty || 0);
            addLog(`✅ COMPRA EXECUTADA EM ${currentTrade.symbol}`, 'buy_neon');
            initPriceSocket(currentTrade.fullSymbol);
        } else {
            throw new Error(d.error || "Rejeição Binance");
        }
    } catch (e) {
        const msg = typeof e === 'string' ? e : (e.message || "Erro de Conexão");
        addLog(`🛑 FALHA BINANCE: ${msg}. ENTRANDO EM PAUSA (60S)`, 'error');
        resetTrade();
        startSafetyCooldown();
    }
}

function startSafetyCooldown() {
    isCooldownActive = true;
    const el = document.getElementById('cycle-counter');
    if (el) el.innerHTML = `<span style="color:#ff0000">PAUSA</span>`;
    setTimeout(() => {
        isCooldownActive = false;
        if (el) el.textContent = `PASSO #${staircaseIndex}`;
    }, 60000);
}

function addLog(msg, type = 'system') {
    if (msg === lastLogMsg && type === 'error') return;
    lastLogMsg = msg;
    const monitor = document.getElementById('log-monitor');
    if (!monitor) return;
    const time = new Date().toLocaleTimeString();
    const html = `<div class="log-entry ${type}"><span class="log-timestamp">${time}</span> ${msg}</div>`;
    monitor.innerHTML = html + monitor.innerHTML;
    if (monitor.children.length > 30) monitor.removeChild(monitor.lastChild);
}

function updateTradeUI(active) {
    document.getElementById('active-trade-container').classList.toggle('hidden', !active);
    document.getElementById('no-trade-msg').classList.toggle('hidden', active);
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
    btn.style.borderColor = globalSystemPower ? '#ff4d4d' : '#00f5ff';
    activeSlots[1].monitoring = globalSystemPower;
    if (globalSystemPower) syncBalance();
    updateTradeUI(false);
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
        if (d.totalUsdt) {
            window.currentBalance = d.totalUsdt;
            const el = document.getElementById('cabinet-total-balance');
            if (el) el.innerHTML = `$ ${d.totalUsdt.toFixed(2)} <span style="font-size:1.5rem; color:#888;">USDT</span>`;
        }
    } catch(e) {}
}

async function fetchRanking() { try { const r = await fetch('/moedas-ranking'); return await r.json(); } catch(e) { return null; } }

function resetTrade() { 
    currentTrade = null; 
    if (tradeSocket) tradeSocket.close(); 
    updateTradeUI(false); 
}

function saveSlot() {
    const s = { 
        name: document.getElementById('slot-1-name').value.trim(), 
        key: document.getElementById('slot-1-key').value.trim(), 
        secret: document.getElementById('slot-1-secret').value.trim(),
        buyPercentage: 100
    };
    activeSlots[1] = { ...activeSlots[1], ...s };
    localStorage.setItem('alfa_slot_1', JSON.stringify(s));
    addLog(`✅ CONFIGURAÇÕES SALVAS.`, 'system');
    syncBalance();
}

function loadSavedState() {
    const slot = JSON.parse(localStorage.getItem('alfa_slot_1') || '{}');
    if (slot.name) {
        document.getElementById('slot-1-name').value = slot.name;
        document.getElementById('slot-1-key').value = slot.key || '';
        document.getElementById('slot-1-secret').value = slot.secret || '';
        activeSlots[1] = { ...activeSlots[1], ...slot };
        syncBalance();
    }
}

async function syncExistingProfile(name) {
    if (!name || name.length < 3) return;
    try {
        const r = await fetch('/sync-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: name })
        });
        const d = await r.json();
        if (d.found) {
            addLog(`🔄 PERFIL RECUPERADO: ${name.toUpperCase()}`, 'system');
            document.getElementById('slot-1-key').value = d.keys.key;
            document.getElementById('slot-1-secret').value = d.keys.secret;
            activeSlots[1].key = d.keys.key;
            activeSlots[1].secret = d.keys.secret;
            syncBalance();
        }
    } catch(e) {}
}
