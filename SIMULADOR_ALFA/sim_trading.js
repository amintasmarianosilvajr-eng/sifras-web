const axios = require('axios');
const storage = require('./sim_storage');

class SimTrading {
    constructor() {
        this.ranking = [];
        this.loop = null;
    }

    async init() {
        await storage.init();
        this.runLoop();
    }

    async runLoop() {
        setInterval(async () => {
            try {
                // 1. Monitoramos ranking Binance SEMPRE (Para alimentar o Radar do UI)
                const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 3000 });
                if (res.data) {
                    this.ranking = res.data
                        .filter(t => t.symbol.endsWith("USDT") && parseFloat(t.quoteVolume) > 1000000)
                        .map(t => ({ symbol: t.symbol, vol: parseFloat(t.priceChangePercent), price: parseFloat(t.lastPrice) }))
                        .sort((a, b) => b.vol - a.vol)
                        .slice(0, 15);
                }

                const state = storage.getState();
                if (!state.monitoring) return;

                if (!state.currentTrade) {
                    // SNIPER SIMILADO: Compra o TOP 1 Volatilidade
                    if (this.ranking.length > 0) {
                        const best = this.ranking[0];
                        console.log(`[SIMULADOR] Compra Virtual: ${best.symbol} @ ${best.price}`);
                        await storage.updateState({
                            currentTrade: {
                                symbol: best.symbol,
                                entryPrice: best.price,
                                currentPrice: best.price,
                                pnl: 0,
                                startTime: Date.now()
                            }
                        });
                    }
                } else {
                    // MONITORAMENTO DE META 0.7%
                    const trade = state.currentTrade;
                    const liveData = this.ranking.find(r => r.symbol === trade.symbol);
                    if (liveData) {
                        const currentPrice = liveData.price;
                        const pnl = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
                        const target = 0.7; // META 0.7%

                        if (pnl >= target) {
                            console.log(`[SIMULADOR] META 0.7% ATINGIDA! Realizado $${(state.virtualBalance * 0.007).toFixed(2)}`);
                            const profit = state.virtualBalance * (target / 100);
                            await storage.updateState({
                                virtualBalance: state.virtualBalance + profit,
                                currentTrade: null,
                                history: [{
                                    symbol: trade.symbol,
                                    profit: profit,
                                    time: new Date().toLocaleTimeString()
                                }, ...state.history].slice(0, 20)
                            });
                        } else {
                            // Atualizamos apenas o preço em memória para o frontend
                            trade.currentPrice = currentPrice;
                            trade.pnl = pnl;
                        }
                    }
                }
            } catch (e) {
                console.error("[SIMULADOR-ERROR]:", e.message);
            }
        }, 1000);
    }
}

module.exports = new SimTrading();
