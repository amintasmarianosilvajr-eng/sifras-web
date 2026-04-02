const express = require('express');
const axios = require('axios');
const path = require('path');
const storage = require('./sim_storage');
const trading = require('./sim_trading');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.get('/sim-state', (req, res) => {
    const state = storage.getState();
    res.json({ ...state, marketRanking: trading.ranking });
});

app.post('/sim-toggle', async (req, res) => {
    const state = storage.getState();
    await storage.updateState({ monitoring: !state.monitoring });
    res.json(storage.getState());
});

app.post('/sim-reset', async (req, res) => {
    await storage.updateState({ 
        virtualBalance: 25728.42,
        currentTrade: null,
        history: [],
        monitoring: false
    });
    res.json(storage.getState());
});

app.get('/painel', (req, res) => {
    res.sendFile(path.join(__dirname, 'painel_operacional.html'));
});

const PORT = 3001;
app.listen(PORT, async () => {
    console.log(`[SIMULADOR] ONLINE NA PORTA ${PORT}`);
    await trading.init();
    
    // AUTO-OPEN PARA PEN DRIVE DEMO
    try {
        require('child_process').exec(`start http://localhost:${PORT}/painel`);
        console.log("[ALFA] Gabinete Operacional Arcádio ATIVO.");
    } catch (e) {}
});
