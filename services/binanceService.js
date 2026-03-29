const axios = require('axios');
const WebSocket = require('ws');
const crypto = require('crypto');
const config = require('../config');

class BinanceService {
    constructor() {
        this.globalMarket = { top30: [] };
        this.ws = null;
        this.dynamicBlacklist = [];
    }

    async initBlacklist() {
        try {
            console.log("[BINANCE-REST] Mapeando moedas de risco sob aviso de Deslistagem (Tags)...");
            const res = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
            if (res.data && Array.isArray(res.data.symbols)) {
                this.dynamicBlacklist = res.data.symbols
                    .filter(s => s.status !== 'TRADING' || (s.tags && s.tags.includes('Monitoring')))
                    .map(s => s.symbol.replace('USDT', ''));
                console.log(`[BINANCE-REST] Motor Alfa blindou ${this.dynamicBlacklist.length} tokens tóxicos ou em deslistagem.`);
            }
        } catch (e) {
            console.error("[BINANCE-REST] Falha ao construir blacklist:", e.message);
        }
    }

    async syncRanking() {
        try {
            console.log(`[BINANCE-REST] Sincronizando ranking (Filtro: ${config.SCAN_MIN_VOL} USDT)...`);
            const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
            const tickers = res.data;

            if (!Array.isArray(tickers)) throw new Error("Resposta inválida da API REST");

            const filtered = tickers.filter(t => 
                t.symbol.endsWith("USDT") && 
                parseFloat(t.quoteVolume) > config.SCAN_MIN_VOL &&
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

            console.log(`[BINANCE-REST] Ranking sincronizado. ${this.globalMarket.top30.length} moedas de alta liquidez prontas.`);
        } catch (e) {
            console.error("[BINANCE-REST] Erro ao sincronizar:", e.message);
        }
    }

    async startGlobalWS() {
        // Garantir ranking inicial via REST com a blindagem ativada
        await this.initBlacklist();
        this.syncRanking();
        // Agendar atualização via REST a cada 2 minutos para manter a estrutura do ranking sólida
        setInterval(() => this.syncRanking(), 120000);

        console.log(`[BINANCE-WS] Iniciando pulso de volatilidade: ${config.BINANCE_WS_URL}`);
        this.ws = new WebSocket(config.BINANCE_WS_URL);

        this.ws.on("open", () => {
            console.log("[BINANCE-WS] Pulso em tempo real conectado.");
        });

        this.ws.on("message", (data) => {
            try {
                const payload = JSON.parse(data.toString());
                const updates = payload.data || payload; 
                
                if (!Array.isArray(updates)) return;

                // O WebSocket agora apenas ATUALIZA a volatilidade e preço do cache existente
                // Isso evita que o radar "pisque" ou fique vazio se o WS falhar momentaneamente
                updates.forEach(u => {
                    const match = this.globalMarket.top30.find(m => m.symbol === u.s);
                    if (match) {
                        match.vol = parseFloat(u.P);
                        match.price = parseFloat(u.c);
                        match.quoteVol = parseFloat(u.q);
                    }
                });

                // Re-ordenar por volatilidade (Gainers) em tempo real
                this.globalMarket.top30.sort((a, b) => b.vol - a.vol);

            } catch (e) {
                console.error("[BINANCE-WS] Erro no processamento de pulso:", e.message);
            }
        });

        this.ws.on("error", (err) => console.error("WS Error:", err.message));
        this.ws.on("close", () => {
            console.log("Binance WS closed. Reconnecting pulse...");
            setTimeout(() => this.startGlobalWS(), 5000);
        });
    }

    async getExchangeInfo(symbol) {
        const r = await axios.get(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`);
        return r.data;
    }

    async getBalance(key, secret) {
        const timestamp = Date.now();
        const query = `timestamp=${timestamp}&recvWindow=10000`;
        const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
        const r = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': key }
        });
        const usdt = r.data.balances.find(b => b.asset === 'USDT');
        return parseFloat(usdt ? usdt.free : 0) + parseFloat(usdt ? usdt.locked : 0);
    }

    async getAssetBalance(key, secret, asset) {
        try {
            const timestamp = Date.now();
            const query = `timestamp=${timestamp}&recvWindow=10000`;
            const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
            const r = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
                headers: { 'X-MBX-APIKEY': key }
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
                params.quantity = qty;
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
}

module.exports = new BinanceService();
