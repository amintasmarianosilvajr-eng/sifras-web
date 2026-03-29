const path = require('path');

module.exports = {
    PORT: process.env.PORT || 3014,
    MASTER_PASSWORD: 'amsj777',
    DATA_DIR: path.join(__dirname, 'data'),
    USERS_FILE: path.join(__dirname, 'data', 'users.json'),
    LEADS_FILE: path.join(__dirname, 'data', 'leads.json'),
    BINANCE_WS_URL: "wss://stream.binance.com:9443/stream?streams=!ticker@arr",
    SCAN_MIN_VOL: 1000000, // Quote volume em USDT (Segurança Operacional 1M)
    HEARTBEAT_TIMEOUT: 15000 // Tempo para considerar bot offline (ms)
};
