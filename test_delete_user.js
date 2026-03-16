const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3014';
const ADMIN_KEY = 'alfa777';

async function testDeletion() {
    console.log("--- TESTANDO EXCLUSÃO DE USUÁRIO ---");
    
    // 1. Criar um usuário de teste no login
    console.log("1. Criando usuário de teste...");
    await axios.post(`${API_URL}/login`, { email: 'ghost_test@sifras.com', password: '123' });
    
    // 2. Verificar se o arquivo existe
    const tradeFile = path.join(__dirname, 'data', 'trade_ghost_test@sifras.com.json');
    console.log(`2. Verificando arquivo físico: ${tradeFile}`);
    
    // 3. Deletar via Admin
    console.log("3. Deletando via API Admin...");
    const res = await axios.post(`${API_URL}/admin/delete-user`, 
        { targetUser: 'ghost_test@sifras.com' },
        { headers: { 'Authorization': `Bearer ${ADMIN_KEY}` } }
    );
    console.log("Resposta:", res.data);
    
    // 4. Verificar se sumiu
    if (!fs.existsSync(tradeFile)) {
        console.log("✅ SUCESSO: Arquivo de trade removido!");
    } else {
        console.log("❌ FALHA: Arquivo ainda existe.");
    }
}

testDeletion().catch(err => console.error("Erro no teste:", err.message));
