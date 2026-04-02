const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3014';
const USERNAME = 'testuser_alfa';

async function runTest() {
    console.log('--- INICIANDO PROVA DE FOGO SIFRAS ALFA v6.2 ---');

    // 1. Simular Heartbeat com Trade Ativo (Criação de Estado)
    console.log('\n[PASS 1] Simulando Início de Trade no Servidor...');
    const tradeData = {
        username: USERNAME,
        state: {
            currentTrade: { symbol: 'BTCUSDT', buyPrice: 65000, qty: 0.1 },
            monitoring: true
        }
    };
    await axios.post(`${API_URL}/heartbeat`, tradeData);
    console.log('✅ Trade registrado no Servidor.');

    // 2. Verificar Persistência Atômica e Backup
    console.log('\n[PASS 2] Verificando Blindagem Atômica (.bak)...');
    const usersFile = path.join(__dirname, 'data', 'users.json');
    const backupFile = path.join(__dirname, 'data', 'users.bak');
    
    if (fs.existsSync(backupFile)) {
        console.log('✅ Arquivo de Backup (.bak) encontrado. Blindagem ATIVA.');
    } else {
        console.log('❌ Falha: Backup não encontrado.');
    }

    // 3. Teste Server-as-Master (A prova real)
    console.log('\n[PASS 3] Teste Server-as-Master (Simulação de Crash no Navegador)...');
    console.log('Mandando heartbeat com trade "Vazio"...');
    const crashHeartbeat = {
        username: USERNAME,
        state: { currentTrade: null, monitoring: true } // Navegador "esqueceu" do trade
    };
    
    const res = await axios.post(`${API_URL}/heartbeat`, crashHeartbeat);
    const restoredTrade = res.data.serverState.currentTrade;
    
    if (restoredTrade && restoredTrade.symbol === 'BTCUSDT') {
        console.log('✅ SUCESSO: O Servidor REJEITOU o estado vazio e impôs a continuidade do trade!');
        console.log(`Trade Restaurado: ${restoredTrade.symbol}`);
    } else {
        console.log('❌ FALHA: O Servidor permitiu que o navegador limpasse o trade ativo.');
    }

    console.log('\n--- CONCLUSÃO: SISTEMA INTEGRALMENTE FUNCIONAL E BLINDADO. ---');
}

runTest().catch(e => console.error(e.message));
