const binance = require('./binanceService');
const storage = require('./storageService');
const config = require('../config');

class TradingService {
    constructor() {
        this.activeProcessors = {}; // Memória volátil para buffers de scan
        this.isLoopRunning = false;
    }

    async init() {
        console.log("[TRADING-ENGINE] Inicializando Motor de Autonomia 24/7...");
        this.startEngineLoop();
    }

    startEngineLoop() {
        if (this.isLoopRunning) return;
        this.isLoopRunning = true;

        // Loop de processamento de alta frequência (5s) para todos os usuários ativos
        setInterval(async () => {
            try {
                const users = storage.getUsers();
                if (Date.now() % 30000 < 5000) { // Log a cada ~30s
                    console.log(`[TRADING-ENGINE] Heartbeat 24/7 - Usuários Ativos: ${users.filter(u => u.alfaState?.monitoring).length}`);
                }
                for (const user of users) {
                    if (user.alfaState?.monitoring && user.keys?.key) {
                        if (Date.now() % 30000 < 5000) {
                            console.log(`[TRADING-ENGINE] Processando: ${user.username} | Estado: ${user.alfaState.currentTrade ? 'IN_TRADE (' + user.alfaState.currentTrade.symbol + ')' : 'SCANNING'}`);
                        }
                        await this.processUserTradeLogic(user);
                    }
                }
            } catch (e) {
                console.error("[TRADING-ENGINE] Erro no loop global:", e.message);
            }
        }, 5000);
    }

    async processUserTradeLogic(user) {
        const state = user.alfaState;
        const username = user.username;

        // Inicializa buffer de memória se não existir
        if (!this.activeProcessors[username]) {
            this.activeProcessors[username] = {
                volatilityBuffer: {},
                analysisStartTime: 0,
                isAnalyzing: false
            };
        }

        const proc = this.activeProcessors[username];

        // 1. Lógica se estiver em TRADE (Monitoramento de Venda)
        if (state.currentTrade) {
            await this.monitorActiveTrade(user, proc);
            return;
        }

        // 2. Lógica se estiver em SCAN (Busca de Compra)
        if (!state.isCooldownActive) {
            await this.runSniperScan(user, proc);
        }
    }

    async monitorActiveTrade(user, proc) {
        const state = user.alfaState;
        const symbol = state.currentTrade.fullSymbol;
        const baseAsset = symbol.replace('USDT', '');
        
        // Anti-Ghost: Verifica se o usuário ainda possui o ativo na conta (a cada ~10s reais de loop)
        if (Date.now() % 10000 < 5000) {
            const actualQty = await binance.getAssetBalance(user.keys.key, user.keys.secret, baseAsset);
            // Se o saldo for irrelevante (< $1), considera o trade encerrado manualmente
            if (actualQty * (state.currentTrade.buyPrice || 0) < 1) {
                console.warn(`[TRADING-ENGINE] GHOST TRADE DETECTADO para ${user.username}: ${symbol}. Limpando estado.`);
                const newState = {
                    ...state,
                    currentTrade: null,
                    tradeStartTime: null,
                    cycleCount: (state.cycleCount || 0) + 1
                };
                await storage.updateUser(user.username, { 
                    alfaState: newState,
                    staircaseIndex: newState.cycleCount + 1 
                });
                return;
            }
        }

        // Busca preço real: Tenta cache do Top 30 primeiro por performance, senão busca Ticker direto
        const marketData = binance.globalMarket.top30.find(m => m.symbol === symbol);
        const currentPrice = marketData ? marketData.price : await binance.getTickerPrice(symbol);

        if (!currentPrice) return;

        const buyPrice = state.currentTrade.buyPrice;
        const targetPrice = buyPrice * 1.008; // 0.8% Fixo
        const pnl = ((currentPrice - buyPrice) / buyPrice) * 100;

        // Verifica se atingiu o alvo (0.8% por padrão)
        if (pnl >= 0.8) {
            console.log(`[TRADING-ENGINE] ALVO ALCANÇADO para ${user.username}: ${symbol} (${pnl.toFixed(2)}%)`);
            await this.executeBackendSell(user);
        }
    }

    async runSniperScan(user, proc) {
        const ranking = binance.globalMarket.top30;
        if (!ranking || ranking.length < 5) return;

        // O CORRETO PARA SCAN É #2 A #10 (índices 1 a 10)
        const candidates = ranking.slice(1, 10).filter(c => 
            !stateIsBlacklisted(c.symbol) && 
            !(user.alfaState.tradeHistory || []).some(h => h.fullSymbol === c.symbol)
        );

        if (!proc.isAnalyzing) {
            proc.volatilityBuffer = {};
            candidates.forEach(c => { proc.volatilityBuffer[c.symbol] = c.price; });
            proc.analysisStartTime = Date.now();
            proc.isAnalyzing = true;
            return;
        }

        // Janela de análise de 10s (de acordo com a v4.6.3)
        if (Date.now() - proc.analysisStartTime >= 10000) {
            let bestCoin = null;
            let highestDelta = -Infinity;

            candidates.forEach(c => {
                const initialPrice = proc.volatilityBuffer[c.symbol];
                if (initialPrice) {
                    const delta = ((c.price - initialPrice) / initialPrice) * 100;
                    if (delta > highestDelta) {
                        highestDelta = delta;
                        bestCoin = c;
                    }
                }
            });

            // Gatilho de 0.15% em 10s
            if (bestCoin && highestDelta >= 0.15) {
                console.log(`[TRADING-ENGINE] GATILHO BACKEND para ${user.username}: ${bestCoin.symbol} (+${highestDelta.toFixed(2)}%)`);
                await this.executeBackendBuy(user, bestCoin);
                proc.isAnalyzing = false;
            } else {
                // Reinicia ciclo de scan
                proc.volatilityBuffer = {};
                candidates.forEach(c => { proc.volatilityBuffer[c.symbol] = c.price; });
                proc.analysisStartTime = Date.now();
            }
        }
    }

    async executeBackendBuy(user, coin) {
        try {
            const res = await binance.executeOrder(user.keys.key, user.keys.secret, coin.symbol, 'BUY');
            if (res.orderId) {
                const tp = coin.price * 1.008; // 0.8% Fixed Target
                const newState = {
                    ...user.alfaState,
                    currentTrade: {
                        symbol: coin.symbol.replace('USDT', ''),
                        fullSymbol: coin.symbol,
                        buyPrice: coin.price,
                        targetPrice: tp,
                        qty: parseFloat(res.executedQty || 0)
                    },
                    tradeStartTime: Date.now()
                };
                await storage.updateUser(user.username, { 
                    alfaState: newState,
                    activeSymbol: coin.symbol,
                    buyPrice: coin.price,
                    targetPrice: tp
                });
            }
        } catch (e) {
            console.error(`[TRADING-ENGINE] Erro na compra (${user.username}):`, e.message);
        }
    }

    async executeBackendSell(user) {
        const state = user.alfaState;
        try {
            const res = await binance.executeOrder(user.keys.key, user.keys.secret, state.currentTrade.fullSymbol, 'SELL', state.currentTrade.qty);
            if (res.orderId) {
                // Atualiza histórico e reseta trade
                const historyEntry = {
                    symbol: state.currentTrade.symbol,
                    fullSymbol: state.currentTrade.fullSymbol,
                    sellPrice: res.price || state.currentTrade.targetPrice,
                    time: Date.now()
                };
                
                let history = state.tradeHistory || [];
                history.unshift(historyEntry);
                if (history.length > 10) history.pop();

                const newState = {
                    ...state,
                    currentTrade: null,
                    tradeStartTime: null,
                    tradeHistory: history,
                    cycleCount: (state.cycleCount || 0) + 1
                };

                await storage.updateUser(user.username, { 
                    alfaState: newState,
                    staircaseIndex: newState.cycleCount + 1 
                });
            }
        } catch (e) {
            console.error(`[TRADING-ENGINE] Erro na venda (${user.username}):`, e.message);
        }
    }
}

function stateIsBlacklisted(symbol) {
    const list = ['SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'ASR', 'ATM', 'ACM', 'BAR', 'CITY', 'INTER', 'JUV', 'OG', 'PSG', 'ARG', 'POR', 'TRA', 'NAP', 'SAU', 'ALV'];
    return list.includes(symbol.replace('USDT', ''));
}

module.exports = new TradingService();
