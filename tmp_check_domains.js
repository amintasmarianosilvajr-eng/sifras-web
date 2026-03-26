const axios = require('axios');

const TOKEN = "rw_Fe26.2**dc11de949d68255cfa3a77ce8cfe89d4d91ae9113451434fe23aeef9f02e4b70*NkqxAAMEr0EWW6mA4PnLEg*hFUjDdzb2fq21g7xGt5GZrK2RZ02LKSs7noMqFvXAWv8veACmzs5swHo8tK_3bDQG1Rk1jHthhQadgO5JdPOsw*1776261843865*dc41474419679b7e2052cc824bacb4331430b031bfd5ef0086964e3a7593fb94*8q24QM-_cqxHsWtyY7xnvRvFSXpMWjvb5ye_z99AxCk";
const PROJECT_ID = "4c8217a7-a8bd-451b-9910-b6ef75395e67";

const query = `
query project($id: String!) {
  project(id: $id) {
    services {
      edges {
        node {
          name
          id
          domains {
            customDomains {
              id
              domain
              status
            }
          }
        }
      }
    }
  }
}
`;

async function checkDomains() {
    try {
        const response = await axios.post('https://backboard.railway.app/graphql/v2', {
            query: query,
            variables: { id: PROJECT_ID }
        }, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });

        console.log(JSON.stringify(response.data.data, null, 2));
    } catch (e) {
        console.error(e.message);
    }
}

checkDomains();
