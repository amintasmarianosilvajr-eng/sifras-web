const binance = require('./binanceService');
const storage = require('./storageService');
const config = require('../config');

class TradingService {
    constructor() {
        this.activeUsers = {};
        this.isProcessing = false;
    }

    init() {
        // Ciclo agressivo de 3 segundos para monitoramento
        setInterval(() => this.processAllUsers(), 3000);
        console.log("[TRADING-ENGINE] Motor de Autonomia Ômega-3 Ligado (3s).");
    }

    async processAllUsers() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        try {
            const users = storage.getUsers();
            for (const user of users) {
                if (user.alfaState && user.alfaState.monitoring) {
                    await this.processUserTradeLogic(user);
                }
            }
        } catch (e) {
            console.error("[TRADING-ENGINE] Erro no ciclo global:", e.message);
        } finally {
            this.isProcessing = false;
        }
    }

    async processUserTradeLogic(user) {
        try {
            if (user.alfaState.currentTrade) {
                await this.monitorActiveTrade(user);
            } else {
                await this.runSniperScan(user, user.alfaState);
            }
        } catch (e) {
            console.error(`[TRADING-ENGINE] Erro no usuário ${user.username}:`, e.message);
        }
    }

    async monitorActiveTrade(user) {
        const trade = user.alfaState.currentTrade;
        if (!trade) return;

        try {
            // 1. Busca Preço Real Diretamente (Ignora caches)
            const currentPrice = await binance.getTickerPrice(trade.fullSymbol);
            if (!currentPrice) return;

            const targetPrice = trade.buyPrice * 1.008; // 0.8% Target
            const pnl = ((currentPrice - trade.buyPrice) / trade.buyPrice) * 100;

            console.log(`[MONITOR] ${user.username} | ${trade.symbol} | Preço: ${currentPrice} | Alvo: ${targetPrice.toFixed(6)} | PNL: ${pnl.toFixed(2)}%`);

            if (currentPrice >= targetPrice) {
                console.log(`[MONITOR] ALVO ATINGIDO (+0.80%)! Iniciando Liquidação para ${user.username}...`);
                await this.executeBackendSell(user);
            }
        } catch (e) {
            console.error(`[MONITOR-ERROR] ${user.username}:`, e.message);
        }
    }

    async executeBackendSell(user) {
        const trade = user.alfaState.currentTrade;
        if (!trade) return;

        try {
            // --- OMEGA-3: SINCRONIA REAL COM BINANCE ---
            let qtyToSell = trade.qty || 0;
            const asset = trade.symbol.replace('USDT', '');
            
            // Se o servidor perdeu a quantidade (qty=0), busca o saldo REAL na Binance
            if (qtyToSell <= 0) {
                console.warn(`[SELL] Quantidade zero detectada no servidor para ${trade.symbol}. Consultando carteira Binance...`);
                const realBalance = await binance.getAssetBalance(user.keys.key, user.keys.secret, asset);
                if (realBalance > 0) {
                    console.log(`[SELL] Saldo real encontrado na Binance: ${realBalance} ${asset}. Sincronizando...`);
                    qtyToSell = realBalance;
                    trade.qty = realBalance;
                } else {
                    console.error(`[SELL] Nenhum saldo de ${asset} encontrado na Binance. Trade fantasma limpo.`);
                    this.clearUserTrade(user);
                    return;
                }
            }

            console.log(`[SELL] Executando venda a mercado: ${trade.symbol} | Qty: ${qtyToSell}`);
            const result = await binance.executeOrder(user.keys.key, user.keys.secret, trade.symbol, 'SELL', qtyToSell);
            
            if (result.orderId) {
                console.log(`[SELL] ✅ VENDA CONCLUÍDA: ${trade.symbol}.`);
                await this.finalizeTrade(user, result);
            }
        } catch (e) {
            console.error(`[SELL-ERROR] ${user.username}:`, e.message);
            // Se der erro de "insufficient balance", limpa o trade para não travar
            if (e.message.includes('Account has insufficient balance')) {
                this.clearUserTrade(user);
            }
        }
    }

    async finalizeTrade(user, result) {
        const trade = user.alfaState.currentTrade;
        const historyEntry = {
            symbol: trade.symbol,
            fullSymbol: trade.fullSymbol,
            buyPrice: trade.buyPrice,
            sellPrice: result.price || trade.buyPrice * 1.008,
            qty: trade.qty,
            time: Date.now()
        };

        const state = user.alfaState;
        state.tradeHistory = state.tradeHistory || [];
        state.tradeHistory.unshift(historyEntry);
        if (state.tradeHistory.length > 20) state.tradeHistory.pop();
        
        state.currentTrade = null;
        state.tradeStartTime = null;
        state.cycleCount = (state.cycleCount || 0) + 1;
        state.monitoring = true; // Continua monitorando para o próximo ciclo

        await storage.updateUser(user.username, { alfaState: state });
    }

    async clearUserTrade(user) {
        const state = user.alfaState;
        state.currentTrade = null;
        state.tradeStartTime = null;
        await storage.updateUser(user.username, { alfaState: state });
    }

    // SNIPER SCAN (Inalterado, apenas para manter a classe íntegra)
    async runSniperScan(user, state) {
        // ... (Mesma lógica de busca #2 a #10)
        const ranking = binance.globalMarket.top30;
        if (!ranking || ranking.length < 10) return;

        const candidates = ranking.slice(1, 10).filter(c => 
            !(state.tradeHistory || []).some(h => h.fullSymbol === c.symbol)
        );

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
                const init = state.volBuffer[c.symbol];
                if (init) {
                    const d = ((c.price - init) / init) * 100;
                    if (d > highestDelta) { highestDelta = d; bestCoin = c; }
                }
            });

            if (bestCoin && highestDelta >= 0.1) {
                console.log(`[SCANNER] Explosão: ${bestCoin.symbol} +${highestDelta.toFixed(2)}%!`);
                await this.executeBackendBuy(user, bestCoin);
            }
            state.isAnalyzing = false;
        }
    }

    async executeBackendBuy(user, coin) {
        try {
            console.log(`[BUY] Comprando ${coin.symbol} para ${user.username}...`);
            const result = await binance.executeOrder(user.keys.key, user.keys.secret, coin.symbol, 'BUY');
            
            if (result.orderId) {
                const state = user.alfaState;
                state.currentTrade = {
                    symbol: coin.symbol,
                    fullSymbol: coin.symbol,
                    buyPrice: parseFloat(result.fills[0].price),
                    qty: parseFloat(result.executedQty),
                    startTime: Date.now()
                };
                state.tradeStartTime = Date.now();
                await storage.updateUser(user.username, { alfaState: state });
                console.log(`[BUY] ✅ COMPRA CONCLUÍDA: ${coin.symbol} | Qty: ${state.currentTrade.qty}`);
            }
        } catch (e) {
            console.error(`[BUY-ERROR] ${user.username}:`, e.message);
        }
    }
}

module.exports = new TradingService();
