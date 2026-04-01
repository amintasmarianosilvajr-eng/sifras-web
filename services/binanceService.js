const axios = require('axios');
const WebSocket = require('ws');
const crypto = require('crypto');
const config = require('../config');

class BinanceService {
    constructor() {
        this.globalMarket = { top30: [] };
        this.ws = null;
        this.dynamicBlacklist = [];
        this.isSyncing = false;
        this.fallbackMode = false;
    }

    async initBlacklist() {
        try {
            const res = await axios.get('https://api.binance.com/api/v3/exchangeInfo', { timeout: 8000 });
            if (res.data && Array.isArray(res.data.symbols)) {
                this.dynamicBlacklist = res.data.symbols
                    .filter(s => s.status !== 'TRADING' || (s.tags && s.tags.includes('Monitoring')))
                    .map(s => s.symbol.replace('USDT', ''));
            }
        } catch (e) {
            console.error("[BINANCE] Falha na Blacklist (prosseguindo sem):", e.message);
        }
    }

    async syncRanking() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        try {
            console.log(`[BINANCE-SYNC] Buscando Ranking. Vol: ${config.SCAN_MIN_VOL}...`);
            const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 10000 });
            
            if (!res.data || !Array.isArray(res.data)) throw new Error("Resposta da Binance não é um Array.");

            const filtered = res.data.filter(t => 
                t.symbol.endsWith("USDT") && 
                parseFloat(t.quoteVolume) > (config.SCAN_MIN_VOL || 100000) &&
                !this.dynamicBlacklist.includes(t.symbol.replace('USDT', ''))
            );
            
            if (filtered.length === 0) throw new Error("Nenhuma moeda passou no filtro de volume.");

            this.globalMarket.top30 = filtered
                .map(t => ({
                    symbol: t.symbol,
                    vol: parseFloat(t.priceChangePercent),
                    price: parseFloat(t.lastPrice)
                }))
                .sort((a, b) => b.vol - a.vol)
                .slice(0, 30);
            
            this.fallbackMode = false;
            console.log(`[BINANCE-SYNC] ✅ Sucesso: ${this.globalMarket.top30.length} moedas.`);
        } catch (e) {
            console.error(`[BINANCE-SYNC] ❌ Falha (Tentando Fallback):`, e.message);
            this.activateFallback();
        } finally {
            this.isSyncing = false;
        }
    }

    activateFallback() {
        if (this.fallbackMode) return;
        this.fallbackMode = true;
        console.warn("[BINANCE-SYNC] ⚠️ MODO DE SOBREVIVÊNCIA ATIVADO (Ranking Estático)");
        
        const majors = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT", "XRPUSDT", "DOGEUSDT", "DOTUSDT", "AVAXUSDT", "LINKUSDT"];
        this.globalMarket.top30 = majors.map(s => ({
            symbol: s,
            vol: 0,
            price: 0
        }));
        
        // Tenta atualizar os preços do fallback individualmente
        this.globalMarket.top30.forEach(async coin => {
            const p = await this.getTickerPrice(coin.symbol);
            if (p) coin.price = p;
        });
    }

    async startGlobalWS() {
        console.log("[BINANCE] Iniciando Motor Master...");
        await this.initBlacklist();
        await this.syncRanking();
        
        // Loop agressivo de 5s se estiver vazio
        const retryInt = setInterval(() => {
            if (this.globalMarket.top30.length === 0 || this.fallbackMode) {
                this.syncRanking();
            } else {
                clearInterval(retryInt);
            }
        }, 5000);

        setInterval(() => this.syncRanking(), 60000);

        this.connectWS();
    }

    connectWS() {
        console.log("[BINANCE-WS] Conectando Pulse Stream...");
        this.ws = new WebSocket(config.BINANCE_WS_URL || "wss://stream.binance.com:9443/stream?streams=!ticker@arr");
        
        this.ws.on("message", (data) => {
            try {
                const payload = JSON.parse(data.toString());
                const updates = payload.data || payload; 
                if (!Array.isArray(updates)) return;
                updates.forEach(u => {
                    const match = this.globalMarket.top30.find(m => m.symbol === u.s);
                    if (match) {
                        if (u.P) match.vol = parseFloat(u.P);
                        if (u.c) match.price = parseFloat(u.c);
                    }
                });
                if (!this.fallbackMode) this.globalMarket.top30.sort((a, b) => b.vol - a.vol);
            } catch (e) {}
        });
        
        this.ws.on("close", () => {
            console.warn("[BINANCE-WS] Conexão perdida. Reconectando...");
            setTimeout(() => this.connectWS(), 5000);
        });
        
        this.ws.on("error", (e) => console.error("[BINANCE-WS] Erro:", e.message));
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
            if (free < 10) throw new Error("Saldo USDT insuficiente na Binance.");

            const priceRes = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
            const price = parseFloat(priceRes.data.price);
            const calculatedQty = (free * 0.98) / price; // 2% margin for fees/slippage
            params.quantity = (Math.floor(calculatedQty / step) * step).toFixed(8).replace(/\.?0+$/, "");
        } else {
            let q = qty;
            if (!q || q <= 0) {
                q = await this.getAssetBalance(key, secret, symbol.replace('USDT', ''));
            }
            if (q <= 0) throw new Error("Sem saldo para vender este ativo na Binance.");
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
