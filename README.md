# Rodonaves API (Puppeteer)

API simples que consulta o rastreio no site Rodonaves usando Puppeteer.
Retorna JSON em: `/rodonaves?cnpj=16524954000133&nf=10021127`

## Como usar (local)
1. `npm install`
2. `node rodonaves-api.js`
3. Acessar: `http://localhost:3000/rodonaves?cnpj=16524954000133&nf=10021127`

## Deploy no Render (passos resumidos)
1. Crie um repositório no GitHub com estes arquivos.
2. No Render: `New → Web Service` → Conecte ao GitHub e selecione o repositório.
3. Build command: `npm install`
4. Start command: `npm start`
5. Deploy e aguarde. Depois teste:
   `https://<sua-url>.onrender.com/rodonaves?cnpj=16524954000133&nf=10021127`

Observação: usamos `--no-sandbox` e `--disable-setuid-sandbox` para compatibilidade com ambientes containerizados.
