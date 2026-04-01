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
    }

    async initBlacklist() {
        try {
            console.log("[BINANCE-REST] Mapeando moedas de risco (Tags)...");
            const res = await axios.get('https://api.binance.com/api/v3/exchangeInfo', { timeout: 10000 });
            if (res.data && Array.isArray(res.data.symbols)) {
                this.dynamicBlacklist = res.data.symbols
                    .filter(s => s.status !== 'TRADING' || (s.tags && s.tags.includes('Monitoring')))
                    .map(s => s.symbol.replace('USDT', ''));
                console.log(`[BINANCE-REST] Blacklist atualizada: ${this.dynamicBlacklist.length} tokens.`);
            }
        } catch (e) {
            console.error("[BINANCE-REST] Falha ao construir blacklist (pulando para sync):", e.message);
        }
    }

    async syncRanking() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        try {
            console.log(`[BINANCE-REST] Sincronizando ranking (Filtro: ${config.SCAN_MIN_VOL} USDT)...`);
            const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 15000 });
            const tickers = res.data;

            if (!Array.isArray(tickers)) {
                console.error("[BINANCE-REST] Resposta inválida da API (esperava Array)");
                return;
            }

            const filtered = tickers.filter(t => 
                t.symbol.endsWith("USDT") && 
                parseFloat(t.quoteVolume) > (config.SCAN_MIN_VOL || 1000000) &&
                !this.dynamicBlacklist.includes(t.symbol.replace('USDT', ''))
            );
            
            this.globalMarket.top30 = filtered
                .map(t => ({
                    symbol: t.symbol,
                    vol: parseFloat(t.priceChangePercent),
                    price: parseFloat(t.lastPrice),
                    quoteVol: parseFloat(t.quoteVolume)
                }))
                .sort((a, b) => b.vol - a.vol)
                .slice(0, 30);

            console.log(`[BINANCE-REST] Ranking sincronizado: ${this.globalMarket.top30.length} moedas.`);
        } catch (e) {
            console.error("[BINANCE-REST] Erro ao sincronizar:", e.message);
        } finally {
            this.isSyncing = false;
        }
    }

    async startGlobalWS() {
        // Inicialização paralela para não bloquear o servidor
        this.initBlacklist().then(() => this.syncRanking());
        
        // Tenta um sync imediato sem blacklist se a blacklist demorar
        setTimeout(() => {
            if (this.globalMarket.top30.length === 0) {
                console.log("[BINANCE-REST] Forçando sync emergencial...");
                this.syncRanking();
            }
        }, 2000);

        setInterval(() => this.syncRanking(), 60000); // Sync a cada 1 minuto (mais frequente)

        console.log(`[BINANCE-WS] Conectando Pulse WS...`);
        this.ws = new WebSocket(config.BINANCE_WS_URL || "wss://stream.binance.com:9443/stream?streams=!ticker@arr");

        this.ws.on("open", () => console.log("[BINANCE-WS] Pulso conectado."));

        this.ws.on("message", (data) => {
            try {
                const payload = JSON.parse(data.toString());
                const updates = payload.data || payload; 
                if (!Array.isArray(updates)) return;

                updates.forEach(u => {
                    const match = this.globalMarket.top30.find(m => m.symbol === u.s);
                    if (match) {
                        match.vol = parseFloat(u.P);
                        match.price = parseFloat(u.c);
                        match.quoteVol = parseFloat(u.q);
                    }
                });
                this.globalMarket.top30.sort((a, b) => b.vol - a.vol);
            } catch (e) {}
        });

        this.ws.on("close", () => {
            setTimeout(() => this.startGlobalWS(), 5000);
        });
    }

    async getExchangeInfo(symbol) {
        const r = await axios.get(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`);
        return r.data;
    }

    async getBalance(key, secret) {
        try {
            const timestamp = Date.now();
            const query = `timestamp=${timestamp}&recvWindow=10000`;
            const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
            const r = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
                headers: { 'X-MBX-APIKEY': key },
                timeout: 5000
            });
            const usdt = r.data.balances.find(b => b.asset === 'USDT');
            return parseFloat(usdt ? usdt.free : 0) + parseFloat(usdt ? usdt.locked : 0);
        } catch(e) { return 0; }
    }

    async getAssetBalance(key, secret, asset) {
        try {
            const timestamp = Date.now();
            const query = `timestamp=${timestamp}&recvWindow=10000`;
            const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
            const r = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
                headers: { 'X-MBX-APIKEY': key },
                timeout: 5000
            });
            const bal = r.data.balances.find(b => b.asset === asset);
            return parseFloat(bal ? bal.free : 0) + parseFloat(bal ? bal.locked : 0);
        } catch(e) { return 0; }
    }

    async executeOrder(key, secret, symbol, side, qty) {
        const timestamp = Date.now();
        let params = { symbol, side, type: 'MARKET', timestamp, recvWindow: 10000 };

        if (side === 'BUY') {
            const free = await this.getBalance(key, secret);
            if (free < 10) throw new Error(`Saldo USDT Insuficiente ($${free.toFixed(2)})`);

            const iRes = await this.getExchangeInfo(symbol);
            const lot = iRes.symbols[0].filters.find(f => f.filterType === 'LOT_SIZE');
            const pRes = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
            const price = parseFloat(pRes.data.price);

            const step = parseFloat(lot.stepSize);
            const calculatedQty = (free * 0.99) / price;
            params.quantity = (Math.floor(calculatedQty / step) * step).toFixed(8).replace(/\.?0+$/, "");
        } else {
            if (qty) {
                const iRes = await this.getExchangeInfo(symbol);
                const lot = iRes.symbols[0].filters.find(f => f.filterType === 'LOT_SIZE');
                const step = parseFloat(lot.stepSize);
                params.quantity = (Math.floor(qty / step) * step).toFixed(8).replace(/\.?0+$/, "");
            } else {
                const asset = symbol.replace('USDT', '');
                const timestamp = Date.now();
                const query = `timestamp=${timestamp}&recvWindow=10000`;
                const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
                const aRes = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
                    headers: { 'X-MBX-APIKEY': key }
                });
                const balance = aRes.data.balances.find(b => b.asset === asset);
                const free = parseFloat(balance ? balance.free : 0);

                const iRes = await this.getExchangeInfo(symbol);
                const lot = iRes.symbols[0].filters.find(f => f.filterType === 'LOT_SIZE');
                const step = parseFloat(lot.stepSize);
                params.quantity = (Math.floor(free / step) * step).toFixed(8).replace(/\.?0+$/, "");
            }
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
        } catch (e) {
            console.error(`[BINANCE-REST] Erro ao buscar preço para ${symbol}:`, e.message);
            return null;
        }
    }
}

module.exports = new BinanceService();
