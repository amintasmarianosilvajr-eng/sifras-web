/**
 * SIFRAS ALFA PREMIUM v3.7
 * Protocolo de Monitoramento Ativo | Alvo 0.8% | Ciclo 10s
 */

const CONFIG = {
    SYNC_INTERVAL: 10000,
    UPDATE_UI_INTERVAL: 1000,
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
let recentSymbols = []; 
let currentBalance = 0; 
let sessionProfitUsdt = 0; // Lucro acumulado na sessão
let sessionStartBalance = 0; 
let isClosingTrade = false;
let isOpeningTrade = false;
let tradeStartTime = null;
let previousRanking = null; // Memória para cálculo de aceleração
let globalCurrentPrice = 0; // Armazena preço do ticker para o painel admin

// Timers
let syncCountdown = 10;
let uiTimer = null;

// --- INICIALIZAÇÃO ---

document.addEventListener('DOMContentLoaded', () => {
    loadSavedState();
    uiTimer = setInterval(tick, 1000);
});

function tick() {
    updateChronometry();
    if (activeSlots[1].monitoring) {
        updateMonitoringUI();
        if (Date.now() % 10000 < 1000) syncBalance(); 
    }
    updateSessionUI(); // Garante atualização constante dos indicadores
}

async function syncBalance() {
    const slot = activeSlots[1];
    if (!slot.key || !slot.secret || !slot.monitoring) return;

    try {
        const tStart = performance.now();
        const res = await fetch('/pnl-real', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                key: slot.key, 
                secret: slot.secret,
                activeSymbol: currentTrade ? currentTrade.symbol : null
            })
        });
        const data = await res.json();
        
        const latency = Math.round(performance.now() - tStart);
        updateLatencyUI(latency);

        if (data.totalUsdt !== undefined) {
            // Valor total da conta = Dólares livres/presos + Valor atual de mercado do ativo comprado em tempo real
            const activeValue = (data.activeAssetQty && currentTrade && globalCurrentPrice) 
                                ? (data.activeAssetQty * globalCurrentPrice) 
                                : (data.activeAssetQty && currentTrade ? data.activeAssetQty * currentTrade.buyPrice : 0);
            
            const equity = data.totalUsdt + activeValue;
            
            if (sessionStartBalance === 0 || isNaN(sessionStartBalance)) {
                sessionStartBalance = equity;
                localStorage.setItem('alfa_session_start', sessionStartBalance);
            }
            
            // O lucro da sessão é estritamente o crescimento real do patrimônio
            sessionProfitUsdt = equity - sessionStartBalance;
            currentBalance = equity;
            localStorage.setItem('alfa_session_profit', sessionProfitUsdt);

            const balanceEl = document.getElementById('cabinet-total-balance');
            if (balanceEl) {
                balanceEl.innerHTML = `$ ${equity.toFixed(2)} <span style="font-size:1.5rem; color:var(--text-muted); font-weight:400;">USDT</span>`;
            }
            
            // Garante que o painel Admin receba os sinais vitais e preço da moeda atualizada a cada ciclo
            await pushStateToServer();
        }

        if (data.activeAssetQty !== undefined && currentTrade && !isClosingTrade && !isOpeningTrade) {
            // Se o valor retido do ativo for menor que ~1 dólar (resíduo), significa que o usuário vendeu manualmente
            if ((data.activeAssetQty * currentTrade.buyPrice) < 1) {
                 addLog(`VENDA MANUAL DETECTADA NA BINANCE. Encerrando monitoramento de ${currentTrade.symbol}.`, 'system');
                 currentTrade = null;
                 tradeStartTime = null;
                 document.getElementById('active-trade-container').classList.add('hidden');
                 document.getElementById('no-trade-msg').classList.remove('hidden');
                 await pushStateToServer();
            }
        }
    } catch (e) {
        console.error("Error in Sync Balance:", e);
    }
}

async function fetchRanking() {
    try {
        const tStart = performance.now();
        const res = await fetch('/moedas-ranking');
        const data = await res.json();
        
        const latency = Math.round(performance.now() - tStart);
        updateLatencyUI(latency);

        if (data.ranking) {
            // Cálculo de Aceleração (Delta 10s)
            if (previousRanking) {
                data.ranking.forEach(current => {
                    const prev = previousRanking.find(p => p.symbol === current.symbol);
                    current.delta = prev ? (current.vol - prev.vol) : 0;
                });
            } else {
                data.ranking.forEach(current => current.delta = 0);
            }
            // Atualiza memória
            previousRanking = JSON.parse(JSON.stringify(data.ranking));

            renderRanking(data.ranking);
            if (!currentTrade && !isClosingTrade && activeSlots[1].monitoring) {
                analyzeAlfa(data.ranking);
            }
        }
    } catch (e) {
        addLog("Error syncing Non-Binary Pixel Control.", "system");
    }
}

function renderRanking(list) {
    const grid = document.getElementById('dynamic-targets-grid');
    if (!grid) return;
    grid.innerHTML = list.slice(0, 15).map((item, i) => `
        <div class="log-card ${i === 1 ? 'log-neon-scan' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:900; font-size:1rem;">#${i + 1} ${item.symbol.replace('USDT', '')}</span>
                <span style="color:var(--accent-green); font-weight:800;">${item.vol.toFixed(2)}%</span>
            </div>
            <div style="font-size:0.6rem; color:var(--text-muted); margin-top:4px;">VOL: $${(item.quoteVol / 1000000).toFixed(1)}M</div>
        </div>
    `).join('');
}

// --- CORE LÓGICO (MOTOR ALFA) ---

function analyzeAlfa(ranking) {
    if (currentTrade || isClosingTrade) return;

    // Trava de Saldo Mínimo ($10 USDT)
    if (activeSlots[1].monitoring && currentBalance < 10) {
        if (Date.now() % 60000 < 1000) { // Log a cada ~1 min para não poluir
            addLog(`⚠️ LOW BALANCE: $${currentBalance.toFixed(2)}. Deposit USDT (Min $10) to continue.`, 'system');
        }
        return;
    }

    // Motor Alfa v4.3: Scan estrito #2 a #30 (Indices 1 a 29)
    // Busca a moeda com a MAIOR VOLATILIDADE (Aceleração/Delta)
    const scanBlock = ranking.slice(1, 30); // Posições #2 a #30
    
    const candidates = scanBlock
        .filter(c => !CONFIG.BLACKLIST.includes(c.symbol.replace('USDT', '')) && !recentSymbols.includes(c.symbol))
        .sort((a, b) => b.delta - a.delta); // Busca a MAIOR aceleração absoluta

    const target = candidates.length > 0 ? candidates[0] : null;

    if (target) {
        // Encontra o rank original para o log
        const rank = ranking.findIndex(r => r.symbol === target.symbol) + 1;
        const deltaLabel = target.delta > 0 ? `+${target.delta.toFixed(2)}` : target.delta.toFixed(2);
        
        addLog(`[ACCELERATION ENGINE] Detected: #${rank} ${target.symbol.replace('USDT', '')} (Delta: ${deltaLabel}%)`, 'system');
        executeTrade(target);
    }
}

// --- CRONOMETRIA & UI ---

function updateChronometry() {
    // 1. Ciclo de Sincronia (10s)
    if (activeSlots[1].monitoring) {
        if (!isClosingTrade && !isOpeningTrade) {
            syncCountdown--;
            if (syncCountdown < 0) {
                syncCountdown = 10;
                fetchRanking(); 
            }
        }
    } else {
        syncCountdown = 10; 
    }

    // 2. Círculo de Sincronia
    const syncCircle = document.getElementById('sync-circle');
    const syncVal = document.getElementById('sync-timer-val');
    if (syncCircle) {
        const offset = 283 - (syncCountdown / 10) * 283;
        syncCircle.style.strokeDashoffset = offset;
        syncVal.innerText = `${syncCountdown}s`;
    }

    // 3. Tempo de Operação
    const tradeCircle = document.getElementById('trade-circle');
    const tradeVal = document.getElementById('trade-timer-val');
    
    if (currentTrade && tradeStartTime && tradeVal) {
        const elapsed = Math.floor((Date.now() - tradeStartTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        tradeVal.innerText = `${mins}:${secs}`;
        
        const tradeOffset = 283 - ((elapsed % 60) / 60) * 283;
        tradeCircle.style.strokeDashoffset = tradeOffset;
    } else if (tradeVal) {
        tradeVal.innerText = "00:00";
        tradeCircle.style.strokeDashoffset = 283;
    }
}

// --- TRADING OPERACIONAL ---

async function executeTrade(coin) {
    if (currentTrade || !activeSlots[1].key || isOpeningTrade) return;
    
    isOpeningTrade = true;
    currentTrade = { ...coin, buyPrice: coin.price };
    tradeStartTime = Date.now();
    
    addLog(`🚀 STARTING OPERATION: ${coin.symbol}`, 'buy');
    
    try {
        const res = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: activeSlots[1].key,
                secret: activeSlots[1].secret,
                symbol: coin.symbol,
                side: 'BUY'
            })
        });
        const data = await res.json();
        
        if (data.orderId) {
            currentTrade.buyPrice = parseFloat(data.fills[0].price);
            currentTrade.executedQty = data.executedQty;
            
            // REGRA v4.5: Adicionar ao Cooldown de 5 moedas de forma estrita (sem duplicatas)
            if (!recentSymbols.includes(currentTrade.symbol)) {
                recentSymbols.push(currentTrade.symbol);
                if (recentSymbols.length > 5) recentSymbols.shift(); // Memória ampliada para 5 ciclos
                localStorage.setItem('alfa_recent_symbols', JSON.stringify(recentSymbols));
            }

            document.getElementById('active-trade-container').classList.remove('hidden');
            document.getElementById('no-trade-msg').classList.add('hidden');
            document.getElementById('monitoring-symbol').innerText = coin.symbol.replace('USDT', '');
            document.getElementById('monitoring-buy-price').innerText = `$${currentTrade.buyPrice.toFixed(4)}`;
            updateMonitoringUI();
            await pushStateToServer();
        } else {
            throw new Error(data.error || "Execution Failed");
        }
    } catch (e) {
        // Se falhar a compra, também adicionamos ao histórico para "pular" e evitar loop
        if (currentTrade && currentTrade.symbol) {
             if (!recentSymbols.includes(currentTrade.symbol)) {
                 recentSymbols.push(currentTrade.symbol);
                 if (recentSymbols.length > 5) recentSymbols.shift();
                 localStorage.setItem('alfa_recent_symbols', JSON.stringify(recentSymbols));
             }
        }
        
        addLog(`Buy Error: ${e.message}`, 'system');
        currentTrade = null;
        tradeStartTime = null;
    } finally {
        isOpeningTrade = false;
    }
}

async function updateMonitoringUI() {
    if (!currentTrade || isClosingTrade) return;

    try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${currentTrade.symbol}`);
        const data = await res.json();
        const currentPrice = parseFloat(data.price);
        globalCurrentPrice = currentPrice; // Para envio ao Admin
        
        const pnl = ((currentPrice - currentTrade.buyPrice) / currentTrade.buyPrice) * 100;
        const targetPrice = currentTrade.buyPrice * (1 + CONFIG.TARGET_PROFIT / 100);
        
        document.getElementById('monitoring-current-price').innerText = `$${currentPrice.toFixed(4)}`;
        document.getElementById('monitoring-target-price').innerText = `$${targetPrice.toFixed(4)}`;
        
        const pnlEl = document.getElementById('monitoring-pl');
        pnlEl.innerText = `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}%`;
        pnlEl.style.color = pnl >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';

        const progress = Math.min(100, Math.max(0, (pnl / CONFIG.TARGET_PROFIT) * 100));
        const fill = document.getElementById('trade-progress-fill');
        if (fill) fill.style.width = `${progress}%`;

        if (pnl >= CONFIG.TARGET_PROFIT) {
            closeTrade();
        }
    } catch (e) {}
}

async function closeTrade() {
    if (isClosingTrade) return;
    isClosingTrade = true;
    
    addLog(`🎯 TARGET REACHED! Liquidating ${currentTrade.symbol}...`, 'buy');
    
    try {
        const res = await fetch('/executar-ordem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: activeSlots[1].key,
                secret: activeSlots[1].secret,
                symbol: currentTrade.symbol,
                side: 'SELL'
            })
        });
        
        document.getElementById('profit-overlay').classList.add('show');
        setTimeout(() => document.getElementById('profit-overlay').classList.remove('show'), 5000);
        
        if (!recentSymbols.includes(currentTrade.symbol)) {
            recentSymbols.push(currentTrade.symbol); 
            if (recentSymbols.length > 5) recentSymbols.shift();
            localStorage.setItem('alfa_recent_symbols', JSON.stringify(recentSymbols));
        }
        
        cycleCount++;
        localStorage.setItem('alfa_cycle_count', cycleCount);
        document.getElementById('cycle-counter').innerText = `${cycleCount} / 10`;
        
        lastExecutedSymbol = currentTrade.symbol.replace('USDT', '');
        
        await pushStateToServer();
    } catch (e) {
        addLog(`Sell Error: ${e.message}`, 'system');
    } finally {
        currentTrade = null;
        tradeStartTime = null;
        isClosingTrade = false;
        document.getElementById('active-trade-container').classList.add('hidden');
        document.getElementById('no-trade-msg').classList.remove('hidden');
        await pushStateToServer();
    }
}

// --- UTILITÁRIOS ---

function addLog(msg, type) {
    const log = document.getElementById('log-monitor');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-timestamp">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    log.prepend(entry);
}

function masterToggle() {
    activeSlots[1].monitoring = !activeSlots[1].monitoring;
    const btn = document.getElementById('master-toggle-btn');
    const pill = document.getElementById('system-status-pill');
    
    if (activeSlots[1].monitoring) {
        btn.innerText = "DESCONECTAR MASTER";
        btn.style.borderColor = "var(--danger-neon)";
        pill.innerText = "BUSCANDO ALVO";
        pill.className = "status-pill online";
        
        addLog("SISTEMA ALFA ATIVADO.", "system");
        addLog("Initializing Non-Binary Pixel Control...", "system");
        
        syncCountdown = 0; // Gatilha fetchRanking no próximo tick
        syncBalance();     // Gatilha saldo imediatamente
    } else {
        btn.innerText = "CONNECT MASTER";
        btn.style.borderColor = "var(--primary-neon)";
        pill.innerText = "OFFLINE";
        pill.className = "status-pill waiting";
        addLog("SYSTEM PAUSED.", "system");
    }
    pushStateToServer();
}

function updateSessionUI() {
    const pnlHeader = document.getElementById('header-realtime-pnl');
    const pnlCabinet = document.getElementById('cabinet-realtime-pnl');
    
    const pct = sessionStartBalance > 0 ? (sessionProfitUsdt / sessionStartBalance) * 100 : 0;
    const sign = sessionProfitUsdt >= 0 ? '+' : '';
    const color = sessionProfitUsdt >= 0 ? 'var(--accent-green)' : 'var(--danger-neon)';

    if (pnlHeader) {
        pnlHeader.innerText = `${sign}$${sessionProfitUsdt.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
        pnlHeader.style.color = color;
        pnlHeader.classList.remove('waiting');
    }

    if (pnlCabinet) {
        pnlCabinet.innerHTML = `SESSION: <span style="color:${color}">${sign}$${sessionProfitUsdt.toFixed(2)}</span>`;
    }
}

function updateLatencyUI(ms) {
    const el = document.getElementById('header-latency');
    if (el) {
        el.innerText = `${ms} ms`;
        el.classList.remove('waiting');
        el.style.color = ms < 300 ? 'var(--accent-green)' : (ms < 1000 ? '#f1c40f' : 'var(--danger-neon)');
    }
}

function saveSlot(id) {
    activeSlots[id].key = document.getElementById(`slot-${id}-key`).value;
    activeSlots[id].secret = document.getElementById(`slot-${id}-secret`).value;
    activeSlots[id].name = document.getElementById(`slot-${id}-name`).value;
    localStorage.setItem('alfa_slot_1', JSON.stringify(activeSlots[id]));
    addLog(`Operator ${activeSlots[id].name || 'Master'} authorized!`, 'system');
    loadSavedState(); // Trigger cloud fetch for new operator
}

async function pushStateToServer() {
    const username = activeSlots[1].name;
    if (!username) return;

    const state = {
        monitoring: activeSlots[1].monitoring,
        cycleCount,
        recentSymbols,
        currentTrade,
        currentPrice: globalCurrentPrice,
        currentBalance: currentBalance,
        sessionProfitUsdt,
        sessionStartBalance,
        tradeStartTime,
        lastUpdated: Date.now()
    };

    try {
        await fetch('/save-alfa-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username, 
                state,
                keys: {
                    key: activeSlots[1].key || '',
                    secret: activeSlots[1].secret || ''
                }
            })
        });
    } catch (e) {
        console.error("Cloud sync failed:", e);
    }
}

async function loadSavedState() {
    // 1. Load Keys (Local First)
    const sessionUser = localStorage.getItem('alfa_session_user');
    const slot = JSON.parse(localStorage.getItem('alfa_slot_1') || '{}');
    
    if (sessionUser) {
        activeSlots[1].name = sessionUser;
        const nameEl = document.getElementById('slot-1-name');
        if (nameEl) nameEl.value = sessionUser;
    }

    if (slot.key) {
        if (!activeSlots[1].name) activeSlots[1].name = slot.name || '';
        document.getElementById('slot-1-name').value = activeSlots[1].name;
        document.getElementById('slot-1-key').value = slot.key || '';
        document.getElementById('slot-1-secret').value = slot.secret || '';
        activeSlots[1] = { ...activeSlots[1], ...slot };
    }
    
    // 2. Load Operational State (Cloud Priority)
    if (activeSlots[1].name) {
        try {
            const res = await fetch('/get-alfa-state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: activeSlots[1].name })
            });
            const { state } = await res.json();
            
            if (state && state.lastUpdated) {
                // Restore values
                cycleCount = state.cycleCount || 0;
                recentSymbols = state.recentSymbols || [];
                sessionProfitUsdt = state.sessionProfitUsdt || 0;
                sessionStartBalance = state.sessionStartBalance || 0;
                tradeStartTime = state.tradeStartTime || null;
                
                // Active Trade UI
                if (state.currentTrade) {
                    currentTrade = state.currentTrade;
                    document.getElementById('active-trade-container').classList.remove('hidden');
                    document.getElementById('no-trade-msg').classList.add('hidden');
                    document.getElementById('monitoring-symbol').innerText = currentTrade.symbol.replace('USDT', '');
                    document.getElementById('monitoring-buy-price').innerText = `$${currentTrade.buyPrice.toFixed(4)}`;
                }

                // Monitoring ON/OFF
                if (state.monitoring && !activeSlots[1].monitoring) {
                    masterToggle(); // Auto-reconnect if it was on
                }
            }
        } catch (e) {
            console.error("Cloud fetch failed, using local fallback");
            cycleCount = parseInt(localStorage.getItem('alfa_cycle_count') || '0');
            recentSymbols = JSON.parse(localStorage.getItem('alfa_recent_symbols') || '[]');
            sessionProfitUsdt = parseFloat(localStorage.getItem('alfa_session_profit') || '0');
            sessionStartBalance = parseFloat(localStorage.getItem('alfa_session_start') || '0');
        }
    }

    // UI Refresh
    const el = document.getElementById('cycle-counter');
    if (el) el.innerText = `${cycleCount} / 10`; 
    updateSessionUI();
}
