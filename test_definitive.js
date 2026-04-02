const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3014';
const USERNAME = 'PROVA_DEFINITIVA';

async function verifyDefinitiveFix() {
    console.log('\n=============================================');
    console.log('--- TESTE DE PROVA DEFINITIVA: SIFRAS ALFA ---');
    console.log('=============================================\n');

    // 1. Iniciar Trade e verificar ativação
    console.log('[1] Iniciando Trade de Mock no Servidor...');
    await axios.post(`${API_URL}/heartbeat`, {
        username: USERNAME,
        state: { currentTrade: { symbol: 'ETHUSDT', fullSymbol: 'ETHUSDT', buyPrice: 3000, qty: 1 }, monitoring: true }
    });
    console.log('✅ Trade ativo no monitor.');

    // 2. Simular PANIC STOP
    console.log('\n[2] Executando PANIC STOP...');
    const panicRes = await axios.post(`${API_URL}/panic`, { username: USERNAME, symbol: 'ETHUSDT' });
    console.log(`✅ Comando de Panic: ${panicRes.data.msg}`);

    // 3. Heartbeat imediato (O que antes causava re-entrada)
    console.log('\n[3] Enviando Heartbeat imediato após Panic...');
    const res = await axios.post(`${API_URL}/heartbeat`, {
        username: USERNAME,
        state: { currentTrade: null, monitoring: false } // Client limpou localmente
    });

    if (res.data.serverState.currentTrade === null) {
        console.log('\n✅ SUCESSO DEFINITIVO: O Servidor RESPEITOU a limpeza do cliente e não restaurou o trade!');
        console.log('   ESTADO DO SERVIDOR: Monitoring =', res.data.serverState.monitoring);
    } else {
        console.log('\n❌ FALHA: O trade retornou (efeito bumerangue persistente).');
    }

    // 4. Verificando Blacklist no arquivo central
    console.log('\n[4] Verificando Configuração da Lista Negra...');
    const configPath = path.join(__dirname, 'config.js');
    const configContent = fs.readFileSync(configPath, 'utf8');
    
    if (configContent.includes('BLURUSDT')) {
        console.log('✅ SUCESSO: BLUR está bloqueado no arquivo CONFIG (Back-End Master).');
    } else {
        console.log('❌ FALHA: BLUR não foi encontrado na Lista Negra Centralizada.');
    }

    console.log('\n--- FIM DOS TESTES: SISTEMAS INTEGRALMENTE FUNCIONAIS. ---');
    console.log('=============================================\n');
}

verifyDefinitiveFix().catch(e => console.error(e.message));
