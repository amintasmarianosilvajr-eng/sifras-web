const path = require('path');

// --- RAILWAY SECURITY SHIELD ---
const PORT = process.env.PORT || 3014;
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, 'data');

module.exports = {
    PORT: PORT,
    MASTER_PASSWORD: process.env.MASTER_PASSWORD || 'amsj777', // Senha Administrativa
    DATA_DIR: DATA_DIR,
    USERS_FILE: path.join(DATA_DIR, 'users.json'),
    LEADS_FILE: path.join(DATA_DIR, 'leads.json'),
    BINANCE_WS_URL: "wss://stream.binance.com:9443/stream?streams=!ticker@arr",
    SCAN_MIN_VOL: 1000000, 
    HEARTBEAT_TIMEOUT: 15000,
    BLACKLIST: ['BLURUSDT', 'LUNCUSDT', 'USTCUSDT', 'SANTOSUSDT', 'PORTOUSDT', 'LAZIOUSDT', 'ALPINEUSDT', 'ASRUSDT', 'ATMUSDT', 'ACMUSDT', 'BARUSDT', 'CITYUSDT', 'INTERUSDT', 'JUVUSDT', 'OGUSDT', 'PSGUSDT', 'ARGUSDT', 'PORUSDT', 'TRAUSDT', 'NAPUSDT', 'SAUUSDT', 'ALVUSDT']
};
