# Sifras Alfa PRO - Guia de Deploy VPS

Este guia contém as instruções necessárias para hospedar o robô Sifras Alfa em uma VPS Windows para operação 24h.

## Passo 1: Contratação
1. Recomendamos contratar uma VPS com Windows Server (2019 ou 2022).
2. Empresas sugeridas: Hostinger, Contabo ou Google Cloud/AWS (Windows Instance).
3. Salve o **IP**, **Usuário** (Geralmente `Administrator`) e **Senha**.

## Passo 2: Acesso Remoto
1. No Windows local, abra a "Conexão de Área de Trabalho Remota".
2. Em "Recursos Locais", marque a opção "Área de Transferência" para permitir copiar arquivos do seu PC para o servidor.
3. Conecte-se usando o IP e as credenciais recebidas.

## Passo 3: Configuração do Robô
1. Copie esta pasta `Sifras_Web` e cole na Área de Trabalho da VPS.
2. Certifique-se de que o [Node.js](https://nodejs.org/) está instalado na VPS (versão 18 ou superior).
3. Execute o arquivo `START_ALFA_USDC_MASTER.bat` para iniciar o servidor.
4. O robô estará acessível localmente em `http://localhost:3014`.

## Passo 4: Operação 24h
1. **NÃO** desligue a VPS pelo botão de desligar do Windows.
2. Para sair, feche apenas a janela da Conexão Remota clicando no "X" da barra azul no topo.
3. O servidor continuará rodando em segundo plano.

---
*Dúvidas técnicas: Contate a Equipe Amintas & Sifras Invest*
