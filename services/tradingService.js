const axios = require('axios');
const binance = require('./binanceService');
const storage = require('./storageService');
const config = require('../config');

class TradingService {
    constructor() {
        this.activeUsers = new Set();
    }

    // --- CORAÇÃO DO MOTOR: INICIALIZAÇÃO ALINHADA ---
    init() {
        console.log("[O-3 ENGINE] Motor de Ciclos Ligado. Sincronia Master Ativa.");
        this.runEngineLoop();
    }
    
    async runEngineLoop() {
        try {
            await this.processAllUsers();
        } catch (e) { 
            console.error("[ENGINE-FAIL]", e.message); 
        }
        setTimeout(() => this.runEngineLoop(), 1000);
    }

    async processAllUsers() {
        const users = storage.getUsers();
        for (const user of users) {
             if (user.alfaState && user.alfaState.monitoring) {
                 await this.processUserTradeLogic(user);
             } else if (user.alfaState) {
                 user.alfaState.isAnalyzing = false;
             }
         }
    }

    async processUserTradeLogic(user) {
        const state = user.alfaState;
        
        // 1. MONITORAMENTO DE TRADE ATIVO
        if (state.currentTrade) {
            await this.monitorActiveTrade(user);
        }
        // 2. SCANNER DE COMPRA
        else {
            const isCooldown = state.cooldownUntil && Date.now() < state.cooldownUntil;
            if (!isCooldown) {
                await this.runSniperScan(user);
            }
        }
    }

    async monitorActiveTrade(user) {
        const state = user.alfaState;
        const trade = state.currentTrade;
        
        try {
            let currentPrice;
            // SYNC REAL-TIME: Prioriza WebSocket e depois API
            const rankingMatch = binance.globalMarket.top30.find(m => m.symbol === trade.fullSymbol);
            if (rankingMatch) {
                currentPrice = rankingMatch.price;
            } else {
                currentPrice = await binance.getTickerPrice(trade.fullSymbol);
            }

            if (!currentPrice) return;

            // --- LÓGICA DE VENDAS (FOCO TOTAL EM 0,9%) ---
            const pnl = ((currentPrice - trade.buyPrice) / trade.buyPrice) * 100;
            const TARGET_PROFIT = 0.9;

            if (pnl >= TARGET_PROFIT) {
                console.log(`[ALFA-EXECUTION] 🚀 ${user.username}: Venda disparada para ${trade.fullSymbol} em +${pnl.toFixed(2)}%`);
                await this.executeBackendSell(user, "TARGET_MET");
                return;
            }
            
            trade.maxPnl = Math.max(trade.maxPnl || pnl, pnl);
            trade.currentPrice = currentPrice;
            trade.currentPnl = pnl;

            // --- DETECTOR DE GHOSTS (SINCRONIZAÇÃO DE SALDO 5s) ---
            if (Date.now() % 5000 < 1100) {
                const balance = await binance.getAssetBalance(user.keys.key, user.keys.secret, trade.symbol.replace('USDT', ''));
                if (balance <= 0) {
                    console.warn(`[GHOST-CLEAN] ${user.username}: Limpeza de Fantasma Detectada (Ativo Zerado na Binance).`);
                    this.clearUserTrade(user);
                }
            }

            await storage.updateUser(user.username, { alfaState: state });

        } catch (e) {
            console.error(`[MONITOR] Erro ${user.username}:`, e.message);
        }
    }

    async runSniperScan(user) {
        const state = user.alfaState;
        const ranking = binance.globalMarket.top30 || [];
        if (ranking.length === 0) return;

        // REGRA DE OURO: Bloqueia as últimas 3 moedas operadas
        const blacklisted = (state.tradeHistory || []).slice(0, 3).map(h => h.fullSymbol);

        // Filtra Ranking e Blacklist
        const candidates = ranking.slice(1, 15).filter(c => !blacklisted.includes(c.symbol));

        if (!state.isAnalyzing) {
            state.volBuffer = {};
            candidates.forEach(c => { state.volBuffer[c.symbol] = c.price; });
            state.analysisStartTime = Date.now();
            state.isAnalyzing = true;
            return;
        }

        if (Date.now() - state.analysisStartTime >= 10000) {
            let bestCoin = null;
            let highestDelta = 0;

            candidates.forEach(c => {
                const initial = state.volBuffer[c.symbol];
                if (initial) {
                    const delta = ((c.price - initial) / initial) * 100;
                    if (delta > highestDelta) {
                        highestDelta = delta;
                        bestCoin = c;
                    }
                }
            });

            if (bestCoin && highestDelta >= 0.12) {
                await this.executeBackendBuy(user, bestCoin);
            }
            
            state.isAnalyzing = false;
            await storage.updateUser(user.username, { alfaState: state });
        }
    }

    async executeBackendBuy(user, coin) {
        try {
            console.log(`[BUY] 🛒 ${user.username}: Comprando ${coin.symbol}...`);
            const result = await binance.executeOrder(user.keys.key, user.keys.secret, coin.symbol, 'BUY');
            
            if (result.orderId) {
                const filledPrice = result.fills && result.fills.length > 0 ? parseFloat(result.fills[0].price) : coin.price;
                const filledQty = parseFloat(result.executedQty);

                user.alfaState.currentTrade = {
                    symbol: coin.symbol.replace('USDT', ''),
                    fullSymbol: coin.symbol,
                    buyPrice: filledPrice,
                    targetPrice: filledPrice * 1.009,
                    qty: filledQty,
                    buyTime: Date.now(),
                    maxPnl: 0,
                    currentPnl: 0
                };
                
                await storage.updateUser(user.username, { 
                    alfaState: user.alfaState,
                    status: 'IN_TRADE',
                    activeSymbol: coin.symbol
                });
                await storage.saveUsers(true);
                console.log(`[BUY] ✅ SUCESSO: ${coin.symbol}`);
            }
        } catch (e) { console.error(`[BUY-ERR] ${user.username}:`, e.message); }
    }

    async executeBackendSell(user, reason) {
        const state = user.alfaState;
        const trade = state.currentTrade;
        if (!trade) return;

        try {
            const result = await binance.executeOrder(user.keys.key, user.keys.secret, trade.fullSymbol, 'SELL', trade.qty);
            if (result.orderId) {
                const sellPrice = result.fills && result.fills.length > 0 ? parseFloat(result.fills[0].price) : trade.currentPrice;
                const profit = ((sellPrice - trade.buyPrice) / trade.buyPrice) * 100;

                state.tradeHistory = state.tradeHistory || [];
                state.tradeHistory.unshift({ symbol: trade.symbol, pnl: profit, time: Date.now(), reason });
                if (state.tradeHistory.length > 30) state.tradeHistory.pop();

                state.cycleCount = (state.cycleCount || 0) + 1;
                state.currentTrade = null;

                // REINTEGRANDO COOLDOWN ORIGINAL
                if (state.cycleCount % 3 === 0) {
                    state.cooldownUntil = Date.now() + (15 * 60 * 1000); 
                }

                await storage.updateUser(user.username, { 
                    alfaState: state,
                    status: 'SCANNING',
                    activeSymbol: '---'
                });
                await storage.saveUsers(true);
                console.log(`[SELL] ✅ SUCESSO: PNL ${profit.toFixed(2)}%`);
            }
        } catch (e) {
            console.error(`[SELL-ERR] ${user.username}:`, e.message);
            // IMPORTANTE: Se o erro for de saldo ou ordem inexistente, o usuário provavelmente já vendeu manual.
            // Limpamos o trade para não travar o bot e o frontend em loop.
            if (e.message.includes('Account') || e.message.includes('Filter') || e.message.includes('API error') || e.message.includes('order')) {
                console.warn(`[ALFA] Limpando registro de trade após erro de venda para evitar 'Ghost'.`);
                this.clearUserTrade(user);
            }
        }
    }

    async clearUserTrade(user) {
        user.alfaState.currentTrade = null;
        await storage.updateUser(user.username, { alfaState: user.alfaState });
        await storage.saveUsers(true);
    }

    async panicStop(userArg) {
        // ESSENCIAL: Fazer o panicStop() reconhecer o usuário independentemente de letras maiúsculas
        const username = typeof userArg === 'string' ? userArg : userArg.username;
        const u = storage.getUser(username);
        
        if (u) {
            console.warn(`[PANIC] ❗ Acionado para: ${u.username}`);
            u.alfaState.monitoring = false; // Desliga o motor primeiro
            
            if (u.alfaState.currentTrade) {
                console.log(`[PANIC] 📉 Liquidando trade ativo: ${u.alfaState.currentTrade.symbol}`);
                await this.executeBackendSell(u, "PANIC_STOP");
            }
            
            await storage.updateUser(u.username, { alfaState: u.alfaState });
            await storage.saveUsers(true);
        } else {
            console.error(`[PANIC-ERR] Usuário não encontrado: ${username}`);
        }
    }
}

module.exports = new TradingService();
