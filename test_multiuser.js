const axios = require('axios');

async function testMultiUser() {
    const baseURL = 'http://localhost:3014';
    
    try {
        console.log("--- Testando isolamento Multi-Usuário ---");

        // 1. Login Usuário A
        const resA = await axios.post(`${baseURL}/login`, { username: 'userA', password: 'passwordA' });
        const tokenA = resA.data.token;
        console.log("Usuário A logado.");

        // 2. Login Usuário B
        const resB = await axios.post(`${baseURL}/login`, { username: 'userB', password: 'passwordB' });
        const tokenB = resB.data.token;
        console.log("Usuário B logado.");

        // 3. Modificar estado Usuário A
        await axios.post(`${baseURL}/start`, { 
            apiKey: 'keyA', apiSecret: 'secA', buyPercentage: 0.5 
        }, { headers: { 'Authorization': `Bearer ${tokenA}` } });
        console.log("Usuário A iniciou o motor.");

        // 4. Verificar se Usuário B continua OFFLINE
        const statusB = await axios.get(`${baseURL}/status`, { 
            headers: { 'Authorization': `Bearer ${tokenB}` } 
        });
        
        if (statusB.data.status === 'OFFLINE') {
            console.log("✅ SUCESSO: Usuário B continua OFFLINE enquanto Usuário A está SCANNING.");
        } else {
            console.log("❌ FALHA: Vazamento de estado detectado!");
        }

        // 5. Verificar se dados são diferentes
        const statusA = await axios.get(`${baseURL}/status`, { 
            headers: { 'Authorization': `Bearer ${tokenA}` } 
        });
        
        if (statusA.data.apiKey === 'keyA' && statusB.data.apiKey === '') {
            console.log("✅ SUCESSO: Credenciais isoladas por usuário.");
        } else {
            console.log("❌ FALHA: Credenciais misturadas!");
        }

    } catch (e) {
        console.error("Erro no teste:", e.message);
    }
}

testMultiUser();
