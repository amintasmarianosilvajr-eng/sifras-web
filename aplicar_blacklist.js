const fs = require('fs');
const file = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(file, 'utf8');

// 1. Atualizar Cooldown
js = js.replace(/COOLDOWN_OPERATIONS: \d+,/g, 'COOLDOWN_OPERATIONS: 3,');

// 2. Expandir a Blacklist com Fan Tokens de Futebol/F1 e lixos Monitorados/Deslistados da Binance
const newBlacklist = `BLACKLIST: [
        /* Fan Tokens (Times de Futebol, Seleções e Escuderias) */
        'SANTOS', 'PORTO', 'LAZIO', 'ALPINE', 'ASR', 'ATM', 'ACM', 'BAR', 'CITY', 'INTER', 'JUV', 'OG', 'PSG', 'ARG', 'POR', 'TRA', 'NAP', 'SAU', 'ALV',
        /* Deslistadas, Risco e Monitoradas (Monitoring e Seed Tag Binance) */
        'LUNC', 'USTC', 'FTT', 'VGX', 'WRX', 'REP', 'BOND', 'EPX', 'POLS', 'MULT', 'PNT', 'WAVES', 'OMNI', 'REEF', 'MDX', 'LOOM', 'KP3R', 'DOCK', 'OAX', 'PROS', 'VITE', 'FOR', 'IRIS', 'NULS', 'FIDA', 'CVX', 'HARD', 'WNXM', 'GLM', 'AKRO'
    ]`;

js = js.replace(/BLACKLIST: \[\s*[\s\S]*?\]/g, newBlacklist);

fs.writeFileSync(file, js);
console.log('Regras de Blacklist e Cooldown atualizadas no motor!');
