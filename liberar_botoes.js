const fs = require('fs');
const pathJs = 'c:\\Users\\user\\Desktop\\Sifras_Web\\script_alfa.js';
let js = fs.readFileSync(pathJs, 'utf8');

// Modificando loadSavedData para ligar os botoes
js = js.replace(/if \(data\.key && data\.secret\)\s*\{\s*setTimeout/g, `if (data.key && data.secret) {
                document.getElementById(\`activate-\${id}\`).classList.remove('disabled');
                const testBtn = document.getElementById(\`test-\${id}\`);
                if (testBtn) testBtn.classList.remove('disabled');
                setTimeout`);

// Modificando disconnectSlot para não desabilitar os botoes
js = js.replace(/actBtn\.classList\.add\('disabled'\);\s*actBtn\.classList\.remove\('on'\);/g, `actBtn.classList.remove('on');`);

fs.writeFileSync(pathJs, js);
console.log('Botoes auxiliares desvinculados do state off (ativados perfeitamente).');
