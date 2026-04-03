let activeSlots = { 1: { monitoring: false, key: '', secret: '', name: '' } };
let currentTrade = null;
let sessionStartBalance = 0;
let syncCounter = 10;
let lastHeartbeatTime = Date.now();

async function syncBalance() {
    const key = activeSlots[1].key || document.getElementById('slot-1-key')?.value;
    const secret = activeSlots[1].secret || document.getElementById('slot-1-secret')?.value;
    if (!key || !secret) return;

    try {
        const r = await fetch('/pnl-real', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, secret })
        });
        const d = await r.json();
        if (d.totalUsdt) {
            window.currentBalance = parseFloat(d.totalUsdt);
            if (sessionStartBalance === 0) sessionStartBalance = window.currentBalance;
            updateSessionUI();
        }
    } catch (e) {}
}

async function syncWithServer() {
    const nameInput = document.getElementById('slot-1-name');
    const username = activeSlots[1].name || localStorage.getItem('alfa_session_user') || (nameInput ? nameInput.value : '');
    if (!username) return;

    const startTime = Date.now();
    try {
        const r = await fetch('/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username, 
                state: { monitoring: activeSlots[1].monitoring },
                keys: { 
                    key: activeSlots[1].key || document.getElementById('slot-1-key')?.value, 
                    secret: activeSlots[1].secret || document.getElementById('slot-1-secret')?.value 
                } 
            })
        });
        const latency = Date.now() - startTime;
        const d = await r.json();

        if (d.success) {
            updateUIFromState(d.serverState, d.serverUptime, latency);
            if (d.marketRanking) {
                renderRanking(d.marketRanking);
                renderOpportunityHub(d.marketRanking);
            }
            if (d.keys && d.keys.key && !activeSlots[1].key) {
                activeSlots[1].key = d.keys.key;
                activeSlots[1].secret = d.keys.secret;
                const kEl = document.getElementById('slot-1-key');
                const sEl = document.getElementById('slot-1-secret');
                if (kEl) kEl.value = d.keys.key;
                if (sEl) sEl.value = d.keys.secret;
            }
        }
    } catch (e) { console.error("Sync error:", e); }
}

function updateUIFromState(state, serverUptime, latencyMs) {
    if (!state) return;
    const trade = state.currentTrade;
    
    // Switch between Empty Msg and Active Trade
    const emptyMsg = document.getElementById('no-trade-msg');
    const tradeCont = document.getElementById('active-trade-container');
    const statusPill = document.getElementById('system-status-pill');

    // -- TELEMETRIA UPTIME & LATENCIA (Admin Style) --
    const latEl = document.getElementById('header-latency');
    if(latEl && serverUptime) {
        const h = Math.floor(serverUptime / 3600).toString().padStart(2, '0');
        const m = Math.floor((serverUptime % 3600) / 60).toString().padStart(2, '0');
        latEl.innerText = `${latencyMs} ms | ${h}h ${m}m`;
        latEl.classList.remove('waiting');
    }

    if (trade && trade.fullSymbol) {
        if (emptyMsg) emptyMsg.classList.add('hidden');
        if (tradeCont) tradeCont.classList.remove('hidden');
        
        document.getElementById('monitoring-symbol').innerText = trade.fullSymbol.replace('USDT', '');
        document.getElementById('monitoring-buy-price').innerText = `$ ${Number(trade.buyPrice).toFixed(4)}`;
        const curPrice = trade.currentPrice || trade.buyPrice;
        document.getElementById('monitoring-current-price').innerText = `$ ${Number(curPrice).toFixed(4)}`;
        document.getElementById('monitoring-target-price').innerText = `$ ${Number(trade.targetPrice).toFixed(6)}`;
        
        const pnl = trade.currentPnl || 0;
        const pnlEl = document.getElementById('monitoring-pl');
        if (pnlEl) {
            pnlEl.innerText = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;
            pnlEl.style.color = pnl >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
        }
        
        const pnlCash = (pnl / 100) * (state.currentBalance || 10);
        const cashEl = document.getElementById('monitoring-pnl-usdt');
        if (cashEl) cashEl.innerText = `$ ${pnlCash >= 0 ? '+' : ''}${pnlCash.toFixed(2)}`;

        // Progress Bar
        const fill = document.getElementById('trade-progress-fill');
        if (fill) {
            const progress = Math.min(Math.max((pnl / 0.9) * 100, 0), 100);
            fill.style.width = `${progress}%`;
        }
        if (statusPill) { statusPill.innerText = "IN TRADE"; statusPill.className = "status-pill online"; }
        currentTrade = trade;
    } else {
        if (emptyMsg) emptyMsg.classList.remove('hidden');
        if (tradeCont) tradeCont.classList.add('hidden');
        if (state.monitoring) {
            if (statusPill) { statusPill.innerText = "SCANNING"; statusPill.className = "status-pill online"; }
        } else {
            if (statusPill) { statusPill.innerText = "OFFLINE"; statusPill.className = "status-pill waiting"; }
        }
        currentTrade = null;
        document.getElementById('trade-timer-val').innerText = '00:00';
    }

    window.currentBalance = state.currentBalance || 0;
    const cycleEl = document.getElementById('cycle-counter');
    if (cycleEl) cycleEl.innerText = `${state.cycleCount || 0} / 3`;
    updateSessionUI();
}

function renderRanking(list) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    grid.innerHTML = list.slice(0, 10).map((item, i) => `
        <div class="log-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:900; font-size:1rem;">#${i + 1} ${item.symbol.replace('USDT', '')}</span>
                <span style="color:var(--accent-green); font-weight:800;">${item.vol.toFixed(2)}%</span>
            </div>
            <div style="font-size:0.6rem; color:var(--text-muted); margin-top:4px;">VOL: $${((item.quoteVol || 0) / 1000000).toFixed(1)}M</div>
        </div>
    `).join('');
}

function renderOpportunityHub(list) {
    const grid = document.getElementById('opportunity-grid');
    if (!grid) return;
    grid.innerHTML = list.slice(0, 10).map(item => `
        <div class="opt-card ${item.vol >= 0 ? 'recovering' : 'falling'}">
            <div class="opt-header">
                <span class="opt-symbol">${item.symbol.replace('USDT', '')}</span>
                <span class="opt-pnl-val" style="color:${item.vol >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)'}">${item.vol.toFixed(2)}%</span>
            </div>
            <div class="m-label" style="text-align:left; margin:5px 0;">PRICE: $${item.price.toFixed(4)}</div>
            <div style="font-size:0.55rem; color:var(--text-muted); font-weight:800;">VOL: $${((item.quoteVol || 0) / 1000000).toFixed(1)}M</div>
        </div>
    `).join('');
}

function updateSessionUI() {
    const pnlHeader = document.getElementById('header-realtime-pnl');
    const balanceCabinet = document.getElementById('cabinet-total-balance');
    const valPnl = document.querySelector('.val-pnl');

    if (window.currentBalance !== undefined && balanceCabinet) {
        balanceCabinet.innerHTML = `$ ${window.currentBalance.toFixed(2)}`;
        
        if (pnlHeader) {
            const profit = window.currentBalance - sessionStartBalance;
            const pct = sessionStartBalance > 0 ? (profit / sessionStartBalance) * 100 : 0;
            const color = profit >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';
            
            // -- PNL REAL EM DINHEIRO (Como no Admin) --
            pnlHeader.innerText = `$ ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} (${pct.toFixed(2)}%)`;
            pnlHeader.style.color = color;
            if (valPnl) { 
                valPnl.innerText = `$ ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`; 
                valPnl.style.color = color; 
            }
        }
    }
}

function masterToggle() {
    activeSlots[1].monitoring = !activeSlots[1].monitoring;
    const btn = document.getElementById('master-toggle-btn');
    if (activeSlots[1].monitoring) {
        if (btn) btn.innerText = "DESCONECTAR MASTER";
        addLog("SISTEMA ALFA CONECTADO AO SERVIDOR.", "system");
        syncBalance(); 
    } else {
        if (btn) btn.innerText = "CONNECT MASTER";
        addLog("SISTEMA EM PAUSA.", "system");
    }
    syncWithServer();
}

function addLog(msg, type) {
    const log = document.getElementById('log-monitor');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-timestamp">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    log.prepend(entry);
    if (log.children.length > 20) log.lastChild.remove();
}

function saveSlot(id = 1) {
    const nameInput = document.getElementById(`slot-${id}-name`);
    const keyInput = document.getElementById(`slot-${id}-key`);
    const secretInput = document.getElementById(`slot-${id}-secret`);
    
    const name = nameInput ? nameInput.value : '';
    const key = keyInput ? keyInput.value : '';
    const secret = secretInput ? secretInput.value : '';
    
    activeSlots[id] = { monitoring: activeSlots[1].monitoring, key, secret, name };
    localStorage.setItem('alfa_session_user', name);
    localStorage.setItem('alfa_slot_1', JSON.stringify(activeSlots[id]));
    
    addLog(`Operador ${name} autorizado pelo servidor!`, 'system');
    syncWithServer();
}

// INSTRUMENTOS VISUAIS E RELOGIOS
setInterval(() => {
    syncCounter = syncCounter <= 1 ? 10 : syncCounter - 1;
    const syncVal = document.getElementById('sync-timer-val');
    const syncCircle = document.getElementById('sync-circle');
    if (syncVal) syncVal.innerText = `${syncCounter}s`;
    if (syncCircle) {
        const offset = (syncCounter / 10) * 283;
        syncCircle.style.strokeDashoffset = offset;
    }

    if (currentTrade && currentTrade.buyTime) {
        const diff = Date.now() - currentTrade.buyTime;
        const totalSec = Math.floor(diff / 1000);
        const mins = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const secs = (totalSec % 60).toString().padStart(2, '0');
        
        const tradeVal = document.getElementById('trade-timer-val');
        const tradeCircle = document.getElementById('trade-circle');
        if (tradeVal) tradeVal.innerText = `${mins}:${secs}`;
        if (tradeCircle) {
            const offset = ((totalSec % 60) / 60) * 283;
            tradeCircle.style.strokeDashoffset = 283 - offset;
        }
    }
}, 1000);

setInterval(syncWithServer, 2000);

window.onload = () => {
    const slot = JSON.parse(localStorage.getItem('alfa_slot_1') || '{}');
    if (slot.key) {
        const nEl = document.getElementById('slot-1-name');
        const kEl = document.getElementById('slot-1-key');
        const sEl = document.getElementById('slot-1-secret');
        if (nEl) nEl.value = slot.name || '';
        if (kEl) kEl.value = slot.key || '';
        if (sEl) sEl.value = slot.secret || '';
        activeSlots[1] = { ...activeSlots[1], ...slot };
    }
    syncWithServer();
};

window.masterToggle = masterToggle;
window.saveSlot = saveSlot;
window.recalibrateCapital = () => { sessionStartBalance = window.currentBalance; updateSessionUI(); };
window.agentForceSell = () => { fetch('/panic', { method: 'POST', body: JSON.stringify({ username: localStorage.getItem('alfa_session_user') }), headers: { 'Content-Type': 'application/json' } }); };
window.agentClearGhost = () => { fetch('/agent/clear-ghost', { method: 'POST', body: JSON.stringify({ username: localStorage.getItem('alfa_session_user') }), headers: { 'Content-Type': 'application/json' } }); };
