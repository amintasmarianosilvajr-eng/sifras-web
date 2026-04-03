const axios = require('axios');
const binance = require('./binanceService');
const storage = require('./storageService');
const config = require('../config');

class TradingService {
    constructor() {
        this.activeUsers = new Set();
    }

    // --- CORAÇÃO DO MOTOR: INICIALIZAÇÃO ---
    init() {
        console.log("[O-3 ENGINE] Motor de Ciclos Ligado. Frequência: 1s");
        setInterval(() => this.processAllUsers(), 1000);
    }

    async processAllUsers() {
        const users = storage.getUsers();
        for (const user of users) {
            if (user.alfaState && user.alfaState.monitoring) {
                await this.processUserTradeLogic(user);
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
            // Busca preço em tempo real do WebSocket (preferencial) ou API
            const rankingMatch = binance.globalMarket.top30.find(m => m.symbol === trade.fullSymbol);
            if (rankingMatch) {
                currentPrice = rankingMatch.price;
            } else {
                currentPrice = await binance.getTickerPrice(trade.fullSymbol);
            }

            if (!currentPrice) return;

            // --- LÓGICA DE TRAILING E VENDAS ---
            const pnl = ((currentPrice - trade.buyPrice) / trade.buyPrice) * 100;
            
            // PARÂMETROS ORIGINAIS DO PROJETO
            const TARGET_PROFIT = 0.9;
            const TRAILING_PULLBACK = 0.1;

            // Atualiza pico de lucro
            trade.maxPnl = Math.max(trade.maxPnl || pnl, pnl);
            trade.currentPrice = currentPrice;
            trade.currentPnl = pnl;

            // VERIFICA SE JÁ PASSOU DO ALVO (0.9%)
            if (pnl >= TARGET_PROFIT) {
                console.log(`[ALFA-EXECUTION] 🚀 ${user.username}: Meta Batida. PNL: ${pnl.toFixed(2)}% | Venda Imediata acionada.`);
                await this.executeBackendSell(user, "TARGET_MET");
                return;
            }
            
            // LOCK DE SEGURANÇA (OPCIONAL: PULLBACK SE QUISERMOS DEIXAR CORRER, MAS O USUÁRIO QUER 0.9%)
            // Se preferir manter o trailing, deve-se verificar o recuo aqui.
            // Para este projeto, o usuário reportou que 0.9% não está fechando, então forçamos a saída.
            
            trade.maxPnl = Math.max(trade.maxPnl || pnl, pnl);
            trade.currentPrice = currentPrice;
            trade.currentPnl = pnl;

            // Sincronia de inventário a cada 10s
            if (Date.now() % 10000 < 1000) {
                const balance = await binance.getAssetBalance(user.keys.key, user.keys.secret, trade.symbol.replace('USDT', ''));
                if (balance <= 0) {
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
            if (e.message.includes('Account has insufficient balance')) this.clearUserTrade(user);
        }
    }

    async clearUserTrade(user) {
        user.alfaState.currentTrade = null;
        await storage.updateUser(user.username, { alfaState: user.alfaState });
        await storage.saveUsers(true);
    }

    async panicStop(user) {
        // ESSENCIAL: Fazer o panicStop() reconhecer o usuário independentemente de letras maiúsculas
        const u = storage.getUser(user.username);
        if (u && u.alfaState.currentTrade) {
            await this.executeBackendSell(u, "PANIC_STOP");
        }
        if(u) {
            u.alfaState.monitoring = false;
            await storage.updateUser(u.username, { alfaState: u.alfaState });
            await storage.saveUsers(true);
        }
    }
}

module.exports = new TradingService();
