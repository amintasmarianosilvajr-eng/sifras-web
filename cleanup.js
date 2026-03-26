const axios = require('axios');

const TOKEN = 'rw_Fe26.2**dc11de949d68255cfa3a77ce8cfe89d4d91ae9113451434fe23aeef9f02e4b70*NkqxAAMEr0EWW6mA4PnLEg*hFUjDdzb2fq21g7xGt5GZrK2RZ02LKSs7noMqFvXAWv8veACmzs5swHo8tK_3bDQG1Rk1jHthhQadgO5JdPOsw*1776261843865*dc41474419679b7e2052cc824bacb4331430b031bfd5ef0086964e3a7593fb94*8q24QM-_cqxHsWtyY7xnvRvFSXpMWjvb5ye_z99AxCk';
const URL = 'https://backboard.railway.app/graphql/v2';

const domainIds = [
    "8e379f04-0049-445b-b7d8-5970a56b3691", // fluxoalfafinance.com
    "6dc12530-8228-481c-bb34-d2b38a479097"  // www.fluxoalfafinance.com
];

async function cleanup() {
    for (const id of domainIds) {
        console.log(`Deleting domain: ${id}...`);
        try {
            const res = await axios.post(URL, {
                query: `mutation {
                    customDomainDelete(id: "${id}")
                }`
            }, {
                headers: {
                    'Authorization': `Bearer ${TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log("Response:", JSON.stringify(res.data));
        } catch (e) {
            console.error("Error:", e.response ? e.response.data : e.message);
        }
    }
}

cleanup();
