const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// --- REDIRECIONAMENTO WWW & HTTPS ---
app.use((req, res, next) => {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;

    // Se o domínio for o seu e não tiver 'www' no início, redireciona
    if (host === 'fluxoalfafinance.online') {
        return res.redirect(301, `https://www.fluxoalfafinance.online${req.url}`);
    }
    
    // Se o protocolo for http (em produção), força https
    if (protocol === 'http' && host !== 'localhost' && !host.includes('127.0.0.1')) {
        return res.redirect(301, `https://${host}${req.url}`);
    }
    
    next();
});

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, './')));

// --- CONFIG & AUTH ---
const ADMIN_TOKEN = "ALFA_SECRET_2026"; // Chave mestre para acesso admin
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// --- STATE ---
let globalMarket = { top30: [], allTickersMap: new Map() };
let binanceWS = null;
let userStates = {}; // username -> state object

// Carregar usuários salvos se existirem
if (fs.existsSync(USERS_FILE)) {
    try {
        userStates = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {
        console.error("Erro ao carregar users.json:", e.message);
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(userStates, null, 2));
    } catch (e) {
        console.error("Erro ao salvar users.json:", e.message);
    }
}

// Limpeza de usuários inativos (mais de 1 minuto sem heartbeat)
setInterval(() => {
    const now = Date.now();
    let changed = false;
    Object.keys(userStates).forEach(username => {
        const lastSeen = userStates[username].lastSeen || 0;
        if (now - lastSeen > 60000) { // 60 segundos
            if (userStates[username].status !== 'OFFLINE') {
                userStates[username].status = 'OFFLINE';
                changed = true;
            }
        }
    });
    if (changed) saveUsers();
}, 30000);

app.get('/operacional', (req, res) => {
    res.sendFile(path.join(__dirname, 'operacional.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/leads', (req, res) => {
    res.sendFile(path.join(__dirname, 'leads.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- REGISTRO E APROVAÇÃO ---
app.post('/register', (req, res) => {
    const { name, email, experience, whatsapp } = req.body;
    if (!name || !email || !experience || !whatsapp) {
        return res.status(400).json({ error: 'Dados incompletos' });
    }

    userStates[name] = {
        username: name,
        email,
        experience,
        whatsapp,
        isApproved: false,
        status: 'OFFLINE',
        lastSeen: Date.now(),
        registrationDate: new Date().toISOString()
    };

    saveUsers();
    res.json({ success: true });
});

// --- HEARTBEAT & STATE UPDATES ---
app.post('/heartbeat', (req, res) => {
    const { username, state } = req.body;
    if (!username) return res.status(400).json({ error: 'Username requerido' });

    // Bloqueio rigoroso: se não existir ou não estiver aprovado, é falso por padrão
    const user = userStates[username] || { isApproved: false }; 

    userStates[username] = {
        ...userStates[username],
        ...state,
        username,
        lastSeen: Date.now(),
        isApproved: user.isApproved
    };
    
    // Se o admin mandou parar, avisa o cliente
    const shouldStop = userStates[username].remoteCommand === 'STOP';
    if (shouldStop) {
        userStates[username].remoteCommand = null; 
    }

    res.json({ 
        success: true, 
        command: shouldStop ? 'STOP' : null,
        isApproved: userStates[username].isApproved
    });
});

// --- EXPORTAR LEADS EM CSV ---
app.get('/export-leads', (req, res) => {
    const password = req.query.password;
    if (password !== 'ALFA_SECRET_2026') {
        return res.status(403).send('Credencial inválida para exportação');
    }

    let csvContent = "\ufeff"; // UTF-8 BOM para Excel
    csvContent += "Nome;Email;Experiencia;WhatsApp;Data Cadastro;Status;Aprovado\n";

    Object.values(userStates).forEach(u => {
        const row = [
            u.username || 'N/A',
            u.email || 'N/A',
            u.experience || 'N/A',
            u.whatsapp || 'N/A',
            u.registrationDate || 'N/A',
            u.status || 'OFFLINE',
            u.isApproved ? 'SIM' : 'NÃO'
        ].join(';');
        csvContent += row + "\n";
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=leads_fluxo_alfa.csv');
    res.status(200).send(csvContent);
});

// --- EXPORTAR LEADS EM WORD ---
app.get('/export-word', (req, res) => {
    const password = req.query.password;
    if (password !== 'ALFA_SECRET_2026') {
        return res.status(403).send('Credencial inválida para exportação');
    }

    let htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>Relatório de Leads Fluxo Alfa</title>
    <style>
        body { font-family: 'Arial', sans-serif; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #333; padding: 10px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        h1 { color: #008080; border-bottom: 2px solid #008080; }
    </style>
    </head>
    <body>
        <h1>Relatório de Leads - Fluxo Alfa</h1>
        <p>Data de Geração: ${new Date().toLocaleDateString('pt-BR')}</p>
        <table>
            <thead>
                <tr>
                    <th>Nome</th>
                    <th>Email</th>
                    <th>Experiência</th>
                    <th>WhatsApp</th>
                    <th>Data Cadastro</th>
                </tr>
            </thead>
            <tbody>
                ${Object.values(userStates).map(u => `
                    <tr>
                        <td>${u.username || '---'}</td>
                        <td>${u.email || '---'}</td>
                        <td>${u.experience || '---'}</td>
                        <td>${u.whatsapp || '---'}</td>
                        <td>${u.registrationDate ? new Date(u.registrationDate).toLocaleDateString('pt-BR') : '---'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </body>
    </html>`;

    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', 'attachment; filename=leads_fluxo_alfa.doc');
    res.send(htmlContent);
});

// --- ADMIN ENDPOINTS ---
const authAdmin = (req, res, next) => {
    const auth = req.headers['authorization'];
    if (auth === `Bearer ${ADMIN_TOKEN}`) {
        next();
    } else {
        res.status(401).json({ error: 'Acesso negado' });
    }
};

app.get('/admin/overview', authAdmin, (req, res) => {
    const users = Object.values(userStates).map(u => ({
        ...u,
        online: (Date.now() - (u.lastSeen || 0)) < 15000
    }));

    res.json({
        users,
        serverUptime: process.uptime(),
        globalPivot: globalMarket.top30[2]?.symbol || '---',
        globalLatency: 42, // Mock ou implementar medição real
        serverIp: '127.0.0.1'
    });
});

app.post('/admin/stop-all', authAdmin, (req, res) => {
    Object.keys(userStates).forEach(username => {
        userStates[username].remoteCommand = 'STOP';
    });
    res.json({ success: true, count: Object.keys(userStates).length });
});

app.post('/admin/stop-user', authAdmin, (req, res) => {
    const { targetUser } = req.body;
    if (userStates[targetUser]) {
        userStates[targetUser].remoteCommand = 'STOP';
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});

app.post('/admin/delete-user', authAdmin, (req, res) => {
    const { targetUser } = req.body;
    if (userStates[targetUser]) {
        delete userStates[targetUser];
        saveUsers();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});

app.post('/admin/reset-all-users', authAdmin, (req, res) => {
    userStates = {};
    saveUsers();
    res.json({ success: true, message: 'Todos os usuários foram removidos.' });
});

app.post('/admin/approve-user', authAdmin, (req, res) => {
    const { targetUser } = req.body;
    if (userStates[targetUser]) {
        userStates[targetUser].isApproved = true;
        saveUsers();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});

app.post('/admin/anti-restart', authAdmin, (req, res) => {
    const { targetUser } = req.body;
    if (userStates[targetUser]) {
        // Reseta o contador de ciclos e limpa trade ativo no estado do servidor
        userStates[targetUser].salesCount = 0;
        userStates[targetUser].status = 'SCANNING';
        userStates[targetUser].remoteCommand = 'STOP'; // Força uma parada para limpeza no cliente
        saveUsers();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});

// --- BINANCE PROXY ---
function signRequest(params, secret) {
    return crypto.createHmac('sha256', secret).update(params).digest('hex');
}

function startBinanceWS() {
    if (binanceWS) binanceWS.terminate();
    binanceWS = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');

    binanceWS.on('message', (data) => {
        try {
            const tickers = JSON.parse(data);
            const usdtTickers = tickers
                .filter(t => t.s.endsWith('USDT'))
                .map(t => ({
                    symbol: t.s,
                    price: parseFloat(t.c),
                    vol: parseFloat(t.P),
                    quoteVol: parseFloat(t.q)
                }))
                // REMOVIDO: Filtro de 1M para garantir que sempre existam moedas no Top 10 para a Escalada
                .filter(t => !['USDC','FDUSD','TUSD','EUR','TRY','BRL','DAI','PAXG'].some(s => t.symbol.includes(s)))
                .sort((a,b) => b.vol - a.vol);

            if (usdtTickers.length > 0) {
                globalMarket.top30 = usdtTickers.slice(0, 30);
                usdtTickers.forEach(t => globalMarket.allTickersMap.set(t.symbol, t.price));
            }
        } catch (e) {
            console.error("WS Message Error:", e.message);
        }
    });

    binanceWS.on('error', () => setTimeout(startBinanceWS, 5000));
}

app.get('/moedas-ranking', (req, res) => {
    if (globalMarket.top30.length === 0) {
        console.warn("⚠️ API moedas-ranking chamada, mas top30 está VAZIO.");
    }
    res.json(globalMarket.top30);
});

app.post('/pnl-real', async (req, res) => {
    const { key, secret } = req.body;
    if (!key || !secret) return res.status(400).json({ error: 'Faltam credenciais' });

    try {
        const timestamp = Date.now();
        const query = `timestamp=${timestamp}&recvWindow=10000`;
        const signature = signRequest(query, secret);
        
        const response = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': key }
        });

        const balances = response.data.balances.filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0);
        let totalUsdt = 0;

        for (const b of balances) {
            const amount = parseFloat(b.free) + parseFloat(b.locked);
            if (b.asset === 'USDT') {
                totalUsdt += amount;
            } else {
                const pair = b.asset + 'USDT';
                const price = globalMarket.allTickersMap.get(pair);
                if (price) totalUsdt += amount * price;
            }
        }
        res.json({ totalUsdt });
    } catch (error) {
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

app.post('/executar-ordem', async (req, res) => {
    const { key, secret, symbol, side, qty } = req.body;
    if (!key || !secret) return res.status(400).json({ error: 'Faltam credenciais' });

    try {
        const timestamp = Date.now();
        const params = { symbol, side, type: 'MARKET', timestamp, recvWindow: 10000 };

        if (side === 'BUY') {
            const { buyPercentage } = req.body;
            const pctCap = parseFloat(buyPercentage || 99) / 100; // Default 99% se não informado

            const qAcc = `timestamp=${timestamp}&recvWindow=10000`;
            const sAcc = signRequest(qAcc, secret);
            const aRes = await axios.get(`https://api.binance.com/api/v3/account?${qAcc}&signature=${sAcc}`, {
                headers: { 'X-MBX-APIKEY': key }
            });
            const usdt = aRes.data.balances.find(b => b.asset === 'USDT');
            const free = parseFloat(usdt ? usdt.free : 0);
            
            const operativeCapital = free * pctCap; 
            if (operativeCapital < 10) throw new Error(`Saldo USDT Insuficiente ($${operativeCapital.toFixed(2)})`);

            const iRes = await axios.get(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`);
            const filters = iRes.data.symbols[0].filters;
            const lSize = filters.find(f => f.filterType === 'LOT_SIZE');
            const pRes = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
            const price = parseFloat(pRes.data.price);

            const step = parseFloat(lSize.stepSize);
            const calculatedQty = operativeCapital / price;
            params.quantity = (Math.floor(calculatedQty / step) * step).toFixed(8).replace(/\.?0+$/, "");
        } else {
            params.quantity = qty;
        }

        const queryString = new URLSearchParams(params).toString();
        const signature = signRequest(queryString, secret);
        const finalUrl = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;

        const response = await axios.post(finalUrl, null, {
            headers: { 'X-MBX-APIKEY': key }
        });
        res.json(response.data);
    } catch (error) {
        const msg = error.response?.data?.msg || error.message;
        console.error("Order Fail:", msg);
        res.status(500).json({ error: msg });
    }
});

app.post('/panic', (req, res) => {
    const { username } = req.body;
    console.log(`🚨 PANIC STOP ACIONADO por: ${username || 'Desconhecido'}`);
    res.json({ success: true, msg: "Sinal de Emergência recebido pelo servidor." });
});

app.get('/info-par', async (req, res) => {
    const symbol = req.query.symbol;
    try {
        const response = await axios.get(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ALFA MASTER ELITE na Porta ${PORT}`);
    startBinanceWS();
});
