const axios = require('axios');

const TOKEN = "rw_Fe26.2**dc11de949d68255cfa3a77ce8cfe89d4d91ae9113451434fe23aeef9f02e4b70*NkqxAAMEr0EWW6mA4PnLEg*hFUjDdzb2fq21g7xGt5GZrK2RZ02LKSs7noMqFvXAWv8veACmzs5swHo8tK_3bDQG1Rk1jHthhQadgO5JdPOsw*1776261843865*dc41474419679b7e2052cc824bacb4331430b031bfd5ef0086964e3a7593fb94*8q24QM-_cqxHsWtyY7xnvRvFSXpMWjvb5ye_z99AxCk";
const ENV_ID = "4e467221-51e7-4528-be4d-d1c1f61a2fab";
const DOMAIN_IDS = [
    "0a26fc4f-a2e0-4923-9063-7a3d977ab917", // www.fluxoalfafinance.online
    "b508dac2-742a-4f18-aec4-d01d504f7915"  // fluxoalfafinance.online
];

const mutation = `
mutation customDomainUpdate($id: String!, $environmentId: String!, $targetPort: Int) {
  customDomainUpdate(id: $id, environmentId: $environmentId, targetPort: $targetPort)
}
`;

async function updateDomains() {
    for (const id of DOMAIN_IDS) {
        console.log(`Tentando atualizar domínio ID: ${id}...`);
        try {
            const response = await axios.post('https://backboard.railway.app/graphql/v2', {
                query: mutation,
                variables: {
                    id: id,
                    environmentId: ENV_ID,
                    targetPort: 8080
                }
            }, {
                headers: {
                    'Authorization': `Bearer ${TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.errors) {
                console.error(`Erro detalhado ao atualizar ${id}:`, JSON.stringify(response.data.errors, null, 2));
            } else {
                console.log(`✅ Sucesso ao atualizar ${id}! Retorno: ${response.data.data.customDomainUpdate}`);
            }
        } catch (error) {
            console.error(`Falha técnica na requisição para ${id}:`, error.message);
        }
    }
}

updateDomains();
