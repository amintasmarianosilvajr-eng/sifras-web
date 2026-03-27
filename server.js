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

// --- CONFIG ---
const MASTER_PASS = "ALFA2026";
const ADMIN_TOKEN = "ALFA_SECRET_2026"; 
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let userStates = {};
if (fs.existsSync(USERS_FILE)) {
    try { userStates = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}
}

function saveStats() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(userStates, null, 2));
    } catch (e) {}
}

// --- ROTAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/operacional', (req, res) => res.sendFile(path.join(__dirname, 'operacional.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/leads', (req, res) => res.sendFile(path.join(__dirname, 'leads.html')));
app.use(express.static(path.join(__dirname, './')));

// Login Master
app.post('/login-master', (req, res) => {
    const { password } = req.body;
    if (password === MASTER_PASS) {
        res.json({ success: true, token: 'ALFA-MASTER-TOKEN' });
    } else {
        res.status(401).json({ success: false, error: 'Senha incorreta' });
    }
});

// Heartbeat - LIBERADO SEMPRE (Se a senha passou, está liberado)
app.post('/heartbeat', (req, res) => {
    const { username, state } = req.body;
    if (!username) return res.json({ success: true, isApproved: true });
    
    const finalName = username.trim().toUpperCase();
    userStates[finalName] = { 
        ...userStates[finalName], 
        ...state, 
        lastSeen: Date.now(), 
        isApproved: true // Sempre aprovado no novo modelo
    };
    
    const command = userStates[finalName].remoteCommand;
    if (command === 'STOP') userStates[finalName].remoteCommand = null;
    
    res.json({ success: true, isApproved: true, command: command || null });
});

// APIs de Mercado e Ordens
app.get('/moedas-ranking', async (req, res) => {
    try {
        const r = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 3000 });
        const list = r.data.filter(t => t.symbol.endsWith('USDT'))
            .map(t => ({ symbol: t.symbol, price: parseFloat(t.lastPrice), vol: parseFloat(t.priceChangePercent) }))
            .sort((a,b) => b.vol - a.vol).slice(0, 30);
        res.json(list);
    } catch(e) { res.json([]); }
});

app.post('/pnl-real', async (req, res) => {
    const { key, secret } = req.body;
    try {
        const timestamp = Date.now();
        const query = `timestamp=${timestamp}&recvWindow=10000`;
        const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
        const r = await axios.get(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, { headers: { 'X-MBX-APIKEY': key } });
        res.json({ totalUsdt: r.data.balances.reduce((acc, b) => acc + (parseFloat(b.free) + parseFloat(b.locked)), 0) }); // Simplificado para teste
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/executar-ordem', async (req, res) => {
    const { key, secret, symbol, side, qty } = req.body;
    try {
        const timestamp = Date.now();
        const query = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${qty}&timestamp=${timestamp}&recvWindow=10000`;
        const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
        const response = await axios.post(`https://api.binance.com/api/v3/order?${query}&signature=${signature}`, null, { headers: { 'X-MBX-APIKEY': key } });
        res.json(response.data);
    } catch (e) { res.status(500).json({ error: e.response?.data || e.message }); }
});

app.get('/info-par', async (req, res) => {
    try {
        const r = await axios.get(`https://api.binance.com/api/v3/exchangeInfo?symbol=${req.query.symbol}`);
        res.json(r.data);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin Control
app.get('/admin/overview', (req, res) => {
    if (req.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) return res.status(401).send();
    res.json({ users: Object.values(userStates) });
});

app.post('/admin/reset-all-users', (req, res) => {
    if (req.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) return res.status(401).send();
    userStates = {};
    if (fs.existsSync(USERS_FILE)) fs.unlinkSync(USERS_FILE);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 TERMINAL ALFA ATIVO NA PORTA ${PORT}`));
