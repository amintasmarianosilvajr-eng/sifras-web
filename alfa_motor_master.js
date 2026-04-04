/**
 * SIFRAS ALFA v6.2 - PREMIUM DASHBOARD (PASSIVO)
 */

const CONFIG = {
    UPDATE_INTERVAL: 1000, 
    SYNC_INTERVAL: 5000
};

let activeSlots = { 1: { key: '', secret: '', name: 'OPERADOR MASTER', monitoring: false } };
let currentTrade = null;
let globalSystemPower = false;
let sessionStartBalance = parseFloat(localStorage.getItem('alfa_session_start') || '0');
let syncCountdown = 5;
let lastLogMsg = "";

document.addEventListener('DOMContentLoaded', () => {
    loadSavedState();
    startOperationalLoop();
    setInterval(updateStats, 1000);
});

async function startOperationalLoop() {
    while (true) {
        try {
            await syncWithServer();
        } catch (e) {
            console.error("Erro de sincronia:", e);
        }
        await new Promise(r => setTimeout(r, CONFIG.SYNC_INTERVAL));
    }
}

async function syncWithServer() {
    const username = activeSlots[1].name || 'OPERADOR';
    if (!username || username === 'OPERADOR') return;

    try {
        const r = await fetch('/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username, 
                state: { monitoring: globalSystemPower },
                keys: { key: activeSlots[1].key, secret: activeSlots[1].secret } 
            })
        });
        const d = await r.json();

        if (d.success) {
            updateUIFromState(d.serverState);
            if (d.marketRanking) renderRanking(d.marketRanking);
            if (d.command === 'STOP' && globalSystemPower) masterToggle(false);
        }
    } catch (e) {
        addLog(`⚠️ Erro de conexão com servidor Alfa.`, 'error');
    }
}

function updateUIFromState(state) {
    if (!state) return;

    // Sincroniza estado de trade
    currentTrade = state.currentTrade;
    updateTradeUI(!!currentTrade);

    if (currentTrade) {
        document.getElementById('monitoring-symbol').textContent = currentTrade.symbol;
        document.getElementById('monitoring-buy-price').textContent = `$${currentTrade.buyPrice.toFixed(4)}`;
        document.getElementById('monitoring-current-price').textContent = `$${(currentTrade.currentPrice || 0).toFixed(4)}`;
        
        const pl = currentTrade.currentPnl || 0;
        const plEl = document.getElementById('monitoring-pl');
        plEl.textContent = `${pl >= 0 ? '+' : ''}${pl.toFixed(2)}%`;
        plEl.style.color = pl >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
        
        // Progress bar baseada no Trailing Stop (0.9%)
        const progress = Math.min((pl / 0.9) * 100, 100);
        document.getElementById('trade-progress-fill').style.width = `${Math.max(progress, 0)}%`;
        
        // Timer do Trade
        const elapsed = Math.floor((Date.now() - (currentTrade.buyTime || Date.now())) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        document.getElementById('trade-timer-val').innerText = `${mins}:${secs}`;
    }

    // Ciclos e Cooldown
    let elCycle = document.getElementById('cycle-counter');
    if (elCycle) {
        const isCooldown = state.cooldownUntil && Date.now() < state.cooldownUntil;
        if (isCooldown) {
            const rem = Math.ceil((state.cooldownUntil - Date.now()) / 60000);
            elCycle.textContent = `PAUSA: ${rem}M`;
            elCycle.style.color = 'var(--danger-neon)';
        } else {
            elCycle.textContent = `${state.cycleCount || 0} / 10`;
            elCycle.style.color = 'var(--primary-neon)';
        }
    }

    // Histórico de Logs (Último evento)
    if (state.tradeHistory && state.tradeHistory.length > 0) {
        const last = state.tradeHistory[0];
        const logMsg = `MOEDA: ${last.symbol} | PNL: ${last.pnl.toFixed(2)}% (${last.reason || 'ALVO'})`;
        if (logMsg !== lastLogMsg) {
            addLog(`✅ ${logMsg}`, 'sell');
            lastLogMsg = logMsg;
            syncBalance(); // Atualiza saldo após venda confirmada
        }
    }
}

function renderRanking(ranking) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    
    grid.innerHTML = ranking.slice(0, 30).map((c, i) => {
        return `
        <div class="log-card" style="margin-bottom:8px; padding:10px; display:flex; justify-content:space-between;">
            <span style="font-weight:900; color:var(--text-muted);">#${i + 1}</span>
            <span style="font-weight:800; color:#fff;">${c.symbol.replace('USDT', '')}</span>
            <span class="coin-vol" style="font-weight:900; color:var(${c.vol >= 0 ? '--accent-green' : '--danger-neon'});">${c.vol >= 0 ? '+' : ''}${c.vol.toFixed(2)}%</span>
        </div>
    `}).join('');
}

function updateTradeUI(active) {
    const container = document.getElementById('active-trade-container');
    const msg = document.getElementById('no-trade-msg');
    const statusPill = document.getElementById('system-status-pill');

    if (container) container.classList.toggle('hidden', !active);
    if (msg) msg.classList.toggle('hidden', active);
    
    if (statusPill) {
        statusPill.textContent = active ? 'EM TRADE' : (globalSystemPower ? 'SCANNING' : 'OFFLINE');
        statusPill.style.color = active ? 'var(--accent-green)' : (globalSystemPower ? 'var(--primary-neon)' : 'var(--text-muted)');
    }
}

function masterToggle(forceState) {
    globalSystemPower = typeof forceState === 'boolean' ? forceState : !globalSystemPower;
    const btn = document.getElementById('master-toggle-btn');
    if (btn) {
        btn.textContent = globalSystemPower ? 'DESCONECTAR' : 'CONECTAR MASTER';
        btn.classList.toggle('active', globalSystemPower);
    }
    activeSlots[1].monitoring = globalSystemPower;
    if (globalSystemPower) {
        syncBalance();
        addLog("🚀 Motor Master Conectado. Aguardando sinal sniper...", 'system');
    } else {
        addLog("🛑 Motor Master Desconectado.", 'system');
    }
    syncWithServer();
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
            if (sessionStartBalance === 0 || isNaN(sessionStartBalance)) {
                sessionStartBalance = d.totalUsdt;
                localStorage.setItem('alfa_session_start', sessionStartBalance);
            }
            const el = document.getElementById('cabinet-total-balance');
            if (el) el.textContent = `$ ${d.totalUsdt.toFixed(2)}`;
            updateSessionStats();
        }
    } catch(e) {}
}

function addLog(msg, type = 'system') {
    const monitor = document.getElementById('log-monitor');
    if (!monitor) return;
    const time = new Date().toLocaleTimeString();
    const html = `<div class="log-entry ${type}"><span class="log-timestamp">${time}</span> ${msg}</div>`;
    monitor.innerHTML = html + monitor.innerHTML;
    if (monitor.children.length > 30) monitor.removeChild(monitor.lastChild);
}

function updateStats() {
    if (globalSystemPower) {
        syncCountdown--;
        if (syncCountdown < 0) syncCountdown = 5;
        const syncCircle = document.getElementById('sync-circle');
        const syncVal = document.getElementById('sync-timer-val');
        if (syncCircle && syncVal) {
            const offset = 283 - (syncCountdown / 5) * 283;
            syncCircle.style.strokeDashoffset = offset;
            syncVal.innerText = `${syncCountdown}s`;
        }
    }
}

function updateSessionStats() {
    const pnlHeader = document.getElementById('header-realtime-pnl');
    const pnlCabinet = document.getElementById('cabinet-realtime-pnl');
    
    if (window.currentBalance && sessionStartBalance > 0) {
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

function saveSlot() {
    const s = { 
        name: document.getElementById('slot-1-name').value.trim(), 
        key: document.getElementById('slot-1-key').value.trim(), 
        secret: document.getElementById('slot-1-secret').value.trim()
    };
    activeSlots[1] = { ...activeSlots[1], ...s };
    localStorage.setItem('alfa_slot_1', JSON.stringify(s));
    addLog(`✅ Configurações salvas.`, 'system');
    syncWithServer();
}

function recalibrateCapital() {
    if (window.currentBalance) {
        sessionStartBalance = window.currentBalance;
        localStorage.setItem('alfa_session_start', sessionStartBalance);
        addLog(`🔄 Capital recalibrado: $${sessionStartBalance.toFixed(2)}`, 'system');
        updateSessionStats();
    }
}

window.recalibrateCapital = recalibrateCapital;
window.saveSlot = saveSlot;
window.masterToggle = masterToggle;

