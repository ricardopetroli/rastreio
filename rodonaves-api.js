// rodonaves-api.js
import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());

function findChromeIn(dir) {
  try {
    if (!fs.existsSync(dir)) return null;
    // procura por .../chrome/linux-xxx/chrome-linux64/chrome
    for (const sub1 of fs.readdirSync(dir)) {
      const p1 = path.join(dir, sub1);
      if (!fs.statSync(p1).isDirectory()) continue;
      const maybe = path.join(p1, "chrome-linux64", "chrome");
      if (fs.existsSync(maybe)) return maybe;
      // estrutura alternativa …/chrome/linux-xxx/chrome
      const alt = path.join(p1, "chrome");
      if (fs.existsSync(alt)) return alt;
    }
  } catch {}
  return null;
}

async function resolveChromePath() {
  // 1) Tenta o caminho que o Puppeteer conhece
  try {
    const p = await puppeteer.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {}
  // 2) Tenta variável de ambiente explícita
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // 3) Var de cache padrão no Render
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";
  const inCache = findChromeIn(path.join(cacheDir, "chrome"));
  if (inCache) return inCache;

  // 4) Fallback: tenta dentro do node_modules
  const local = findChromeIn(path.join(process.cwd(), "node_modules", "puppeteer", ".local-chromium"));
  if (local) return local;

  throw new Error("Chrome não encontrado. Verifique se o build instalou o navegador.");
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/rodonaves", async (req, res) => {
  const cnpj = (req.query.cnpj || "16524954000133").trim();
  const nf = (req.query.nf || "").trim();
  if (!nf) return res.status(400).json({ ok: false, error: "Falta parâmetro nf" });

  let browser = null;
  try {
    const url = "https://rodonaves.com.br/rastreio-de-mercadoria";
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

    // Seleciona "Nota fiscal"
    await page.waitForSelector("select.form-select", { visible: true });
    await page.select("select.form-select", "invoiceNumber");

    // Preenche CNPJ/NF e clica
    await page.type('input[aria-describedby="CPF"]', cnpj, { delay: 15 });
    await page.type('input[aria-describedby="NF"]', nf, { delay: 15 });
    await page.click("button.btn-submit.btn-primary");

    // Espera eventos ou "Nenhum pedido encontrado"
    await page.waitForFunction(() => {
      const list = document.querySelectorAll(".product-status-date li");
      const top = document.querySelector(".product-status-top");
      const noRes = top && /nenhum pedido encontrado/i.test(top.textContent || "");
      return list.length > 0 || noRes;
    }, { timeout: 45000 }).catch(() => {});

    const events = await page.$$eval(".product-status-date li", els =>
      els.map(el => ({
        time: el.querySelector(".date")?.textContent?.trim() || "",
        reason: el.querySelector(".desc")?.textContent?.trim() || el.textContent.trim()
      }))
    );

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

    res.json({ ok: events.length > 0, events, meta, url });
  } catch (err) {
    if (browser) try { await browser.close(); } catch {}
    res.json({ ok: false, error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Rodonaves API online na porta " + PORT));
