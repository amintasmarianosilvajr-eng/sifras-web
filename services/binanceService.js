const axios = require('axios');
const WebSocket = require('ws');
const crypto = require('crypto');
const config = require('../config');
const storage = require('./storageService');

class BinanceService {
    constructor() {
        this.globalMarket = { top30: [] };
        this.ws = null;
        this.dynamicBlacklist = [];
        this.isSyncing = false;
        this.lastSyncSuccess = 0;
    }

    async initBlacklist() {
        try {
            const fanTokens = ["OG", "SANTOS", "LAZIO", "PORTO", "ALPINE", "CITY", "BAR", "JUV", "ACM", "ATM", "ASR"];
            const memeIrrelevant = ["PEPE", "FLOKI", "BONK", "SHIB", "DOGE", "MEME", "LADYS", "AIDOGE", "VMP", "ORDI", "1000SATS"];
            
            const res = await axios.get('https://api.binance.com/api/v3/exchangeInfo', { timeout: 5000 });
            if (res.data && Array.isArray(res.data.symbols)) {
                this.dynamicBlacklist = res.data.symbols
                    .filter(s => s.status !== 'TRADING' || (s.tags && s.tags.includes('Monitoring')))
                    .map(s => s.symbol.replace('USDT', ''));
                
                // Unifica com Fan Tokens e Memes
                this.dynamicBlacklist = [...new Set([...this.dynamicBlacklist, ...fanTokens, ...memeIrrelevant])];
                console.log(`[INIT] Blacklist Ativa: ${this.dynamicBlacklist.length} moedas bloqueadas (Times/Memes/Monitoring).`);
            }
        } catch (e) {
            console.error("[INIT] Falha ao carregar Exchange Info para Blacklist.");
        }
    }

    // Survivor-1M: Garantia de dados se a API travar
    async activateSurvivalStats() {
        console.warn("[BINANCE] ⚠️ Ativando Radar de Emergência (Filtro 1M Garantido)...");
        const majors = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "ADAUSDT", "DOGEUSDT", "DOTUSDT", "MATICUSDT", "AVAXUSDT"];
        
        // Inicializa com as Majors que sempre têm >1M volume
        const mockRanking = majors.map(s => ({ symbol: s, vol: 0, price: 0 }));
        
        // Tenta buscar o preço de cada uma individualmente (mais chance de sucesso que o listão 24h)
        for (const coin of mockRanking) {
            const p = await this.getTickerPrice(coin.symbol);
            if (p) coin.price = p;
        }
        
        this.globalMarket.top30 = mockRanking;
    }

    async syncRanking() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        try {
            // Tenta o listão 24h com timeout curto
            const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 8000 });
            if (res.data && Array.isArray(res.data)) {
                const filtered = res.data.filter(t => 
                    t.symbol.endsWith("USDT") && 
                    parseFloat(t.quoteVolume) >= 1000000 &&
                    !this.dynamicBlacklist.includes(t.symbol.replace('USDT', ''))
                );
                
                if (filtered.length > 0) {
                    this.globalMarket.top30 = filtered
                        .map(t => ({
                            symbol: t.symbol,
                            vol: parseFloat(t.priceChangePercent),
                            price: parseFloat(t.lastPrice),
                            quoteVol: parseFloat(t.quoteVolume)
                        }))
                        .sort((a, b) => b.vol - a.vol)
                        .slice(0, 30);
                    this.lastSyncSuccess = Date.now();
                    console.log(`[BINANCE] Radar Master Sincronizado: ${this.globalMarket.top30.length} moedas > 1M.`);
                }
            }
        } catch (e) {
            console.error("[BINANCE] Erro no sync do ranking (Listão 24h pendente).");
            if (this.globalMarket.top30.length === 0) {
                await this.activateSurvivalStats();
            }
        } finally {
            this.isSyncing = false;
        }
    }

    async startGlobalWS() {
        console.log("[BINANCE] Motor de Sincronia Ligado.");
        await this.initBlacklist();
        await this.syncRanking();
        
        // Tenta sync a cada 60s
        setInterval(() => this.syncRanking(), 60000);

        this.connectWS();
    }

    connectWS() {
        const streamUrl = config.BINANCE_WS_URL || "wss://stream.binance.com:9443/stream?streams=!ticker@arr";
        this.ws = new WebSocket(streamUrl);
        
        this.ws.on("message", (data) => {
            try {
                const payload = JSON.parse(data.toString());
                const updates = (payload.data || payload);
                updates.forEach(u => {
                    const symbol = u.s || u.symbol;
                    const cur = parseFloat(u.c || u.closePrice || u.p);
                    const open = parseFloat(u.o || u.openPrice);
                    const change = parseFloat(u.P || u.priceChangePercent);

                    // 1. Atualiza Top 30 Ranking
                    const match = this.globalMarket.top30.find(m => m.symbol === symbol);
                    if (match) {
                        if (!isNaN(cur)) match.price = cur;
                        if (!isNaN(change)) {
                            match.vol = change;
                        } else if (!isNaN(cur) && !isNaN(open) && open > 0) {
                            match.vol = ((cur - open) / open) * 100;
                        }
                    }

                    // 2. Atualiza Preço de Trades Ativos (ALFA MASTER SYNC)
                    if (!isNaN(cur)) {
                        storage.updateTradePrice(symbol, cur);
                    }
                });
                
                // Só ordena se tivermos dados suficientes
                if (this.globalMarket.top30.length > 5) {
                    this.globalMarket.top30.sort((a, b) => b.vol - a.vol);
                }
            } catch (e) {}
        });

        this.ws.on("close", () => setTimeout(() => this.connectWS(), 5000));
        this.ws.on("error", () => {});
    }

    async getAssetBalance(key, secret, asset) {
        try {
            const timestamp = Date.now();
            const query = `timestamp=${timestamp}&recvWindow=10000`;
            const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
            const res = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
                headers: { 'X-MBX-APIKEY': key },
                timeout: 5000
            });
            const b = res.data.balances.find(b => b.asset === asset);
            return parseFloat(b ? b.free : 0);
        } catch(e) { return 0; }
    }

    async executeOrder(key, secret, symbol, side, qty) {
        const timestamp = Date.now();
        let params = { symbol, side, type: 'MARKET', timestamp, recvWindow: 10000 };

        const info = await axios.get(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`, { timeout: 5000 });
        const lot = info.data.symbols[0].filters.find(f => f.filterType === 'LOT_SIZE');
        const step = parseFloat(lot.stepSize);

        if (side === 'BUY') {
            const query = `timestamp=${timestamp}&recvWindow=10000`;
            const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
            const acc = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
                headers: { 'X-MBX-APIKEY': key }
            });
            const usdt = acc.data.balances.find(b => b.asset === 'USDT');
            const free = parseFloat(usdt ? usdt.free : 0);
            if (free < 10) throw new Error("Saldo USDT Insuficiente.");

            const priceRes = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
            const price = parseFloat(priceRes.data.price);
            const calculatedQty = (free * 0.98) / price;
            params.quantity = (Math.floor(calculatedQty / step) * step).toFixed(8).replace(/\.?0+$/, "");
        } else {
            let q = qty;
            if (!q || q <= 0) {
                q = await this.getAssetBalance(key, secret, symbol.replace('USDT', ''));
            }
            if (q <= 0) throw new Error("Sem saldo para vender.");
            params.quantity = (Math.floor(q / step) * step).toFixed(8).replace(/\.?0+$/, "");
        }

        const queryString = new URLSearchParams(params).toString();
        const signature = crypto.createHmac('sha256', secret).update(queryString).digest('hex');
        const res = await axios.post(`https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`, null, {
            headers: { 'X-MBX-APIKEY': key }
        });
        return res.data;
    }

    async getTickerPrice(symbol) {
        try {
            const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { timeout: 5000 });
            return parseFloat(res.data.price);
        } catch (e) { return null; }
    }
}

module.exports = new BinanceService();
