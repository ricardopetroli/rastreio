// rodonaves-api.js
import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());

/** Lista de diretórios onde vamos procurar o Chrome baixado pelo Puppeteer */
const CANDIDATE_DIRS = [
  process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer",
  "/opt/render/.cache/puppeteer",              // nosso alvo no Build
  "/opt/render/project/.cache/puppeteer",      // cache do projeto
  `${process.cwd()}/node_modules/puppeteer/.local-chromium`, // fallback local
  "/root/.cache/puppeteer",
  "/home/render/.cache/puppeteer",
];

/** procura por .../chrome/linux-xxx/chrome-linux64/chrome */
function findChromeUnder(root) {
  try {
    if (!fs.existsSync(root)) return null;
    // procurar em .../chrome/*/
    const chromeRoot = path.join(root, "chrome");
    const level1 = fs.existsSync(chromeRoot) ? fs.readdirSync(chromeRoot) : [];
    for (const d of level1) {
      const base = path.join(chromeRoot, d);
      const candidate1 = path.join(base, "chrome-linux64", "chrome");
      const candidate2 = path.join(base, "chrome"); // estrutura alternativa
      if (fs.existsSync(candidate1)) return candidate1;
      if (fs.existsSync(candidate2)) return candidate2;
    }
    // fallback: varrer recursivamente alguns níveis
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop();
      let entries;
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const full = path.join(cur, e.name);
        if (e.isFile() && e.name === "chrome" && fs.accessSync(full, fs.constants.X_OK) == null) {
          return full;
        }
        if (e.isDirectory()) stack.push(full);
      }
    }
  } catch {}
  return null;
}

async function resolveChromePath() {
  // 1) Caminho “oficial” que o Puppeteer conhece
  try {
    const p = await puppeteer.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {}
  // 2) Var de ambiente explícita
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // 3) Varre diretórios candidatos
  for (const dir of CANDIDATE_DIRS) {
    const found = findChromeUnder(dir);
    if (found) return found;
  }
  throw new Error(
    "Chrome não encontrado. " +
    "Garanta que o build executa: npx puppeteer browsers install chrome --cache-dir=/opt/render/.cache/puppeteer"
  );
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/rodonaves", async (req, res) => {
  const cnpj = (req.query.cnpj || "16524954000133").trim();
  const nf = (req.query.nf || "").trim();
  if (!nf) return res.status(400).json({ ok:false, error:"Falta parâmetro nf" });

  let browser = null;
  try {
    const url = "https://rodonaves.com.br/rastreio-de-mercadoria";

    // 🔎 resolve caminho do Chrome
    const executablePath = await resolveChromePath();

    browser = await puppeteer.launch({
      headless: "new",
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Seleciona "Consultar por: Nota fiscal"
    await page.waitForSelector("select.form-select", { visible: true });
    await page.select("select.form-select", "invoiceNumber");

    // Preenche dados
    await page.type('input[aria-describedby="CPF"]', cnpj, { delay: 15 });
    await page.type('input[aria-describedby="NF"]', nf, { delay: 15 });

    // Clica “RASTREAR”
    await page.click("button.btn-submit.btn-primary");

    // Aguarda lista de eventos ou mensagem de “Nenhum pedido...”
    await page.waitForFunction(() => {
      const list = document.querySelectorAll(".product-status-date li");
      const top = document.querySelector(".product-status-top");
      const noRes = top && /nenhum pedido encontrado/i.test(top.textContent || "");
      return list.length > 0 || noRes;
    }, { timeout: 45000 }).catch(() => {});

    // Extrai eventos
    const events = await page.$$eval(".product-status-date li", els =>
      els.map(el => ({
        time: el.querySelector(".date")?.textContent?.trim() || "",
        reason: el.querySelector(".desc")?.textContent?.trim() || el.textContent.trim()
      }))
    );

    // Metadados
    const meta = await page.evaluate(() => {
      const get = sel => document.querySelector(sel)?.textContent?.trim() || "";
      return {
        serviceType: get('.product-status-info .info-item:nth-child(1) .desc'),
        cteNumber:   get('.product-status-info .info-item:nth-child(2) .desc'),
        date:        get('.product-status-info .info-item:nth-child(3) .desc'),
        sender:      get('.product-status-info .info-item:nth-child(4) .desc'),
        recipient:   get('.product-status-info .info-item:nth-child(5) .desc'),
        status:      get('.product-status-info .info-item:nth-child(6) .desc'),
        preDelivery: get('.product-status-top .date')
      };
    });

    await browser.close();
    browser = null;

    res.json({ ok: events.length > 0, events, meta, url, usedExecutable: executablePath, searchedDirs: CANDIDATE_DIRS });
  } catch (err) {
    if (browser) try { await browser.close(); } catch {}
    // devolve diagnóstico com diretórios pesquisados
    res.json({ ok:false, error:String(err), searchedDirs: CANDIDATE_DIRS });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Rodonaves API online na porta " + PORT));
