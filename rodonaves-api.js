// rodonaves-api.js
// Scraper Rodonaves usando Puppeteer + Express
// GET /rodonaves?cnpj=16524954000133&nf=10021127
import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";

const app = express();
app.use(cors());

app.get("/rodonaves", async (req, res) => {
  const cnpj = (req.query.cnpj || "16524954000133").trim();
  const nf = (req.query.nf || "").trim();
  if (!nf) return res.status(400).json({ ok:false, error: "Falta parâmetro nf" });

  const url = "https://rodonaves.com.br/rastreio-de-mercadoria";

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: "new", // compatível com versões modernas do Chromium
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(45000);
    page.setDefaultTimeout(45000);

    await page.goto(url, { waitUntil: "domcontentloaded" });

    // seleciona "Consultar por: Nota fiscal"
    await page.waitForSelector("select.form-select", { timeout: 15000 });
    try { await page.select("select.form-select", "invoiceNumber"); } catch(e){ /* ignore */ }

    // preenche CPF/CNPJ e NF
    // campo CPF/CNPJ tem aria-describedby="CPF"
    const cnpjSelector = 'input[aria-describedby="CPF"]';
    const nfSelector = 'input[aria-describedby="NF"]';

    await page.waitForTimeout(300); // pequeno delay
    if (await page.$(cnpjSelector) !== null) {
      // insere sem formatação — o site aplica máscaras
      await page.click(cnpjSelector, { clickCount: 3 }).catch(()=>{});
      await page.type(cnpjSelector, cnpj, { delay: 20 });
    }

    if (await page.$(nfSelector) !== null) {
      await page.click(nfSelector, { clickCount: 3 }).catch(()=>{});
      await page.type(nfSelector, nf, { delay: 20 });
    }

    // clica em rastrear (botão)
    const btn = await page.$("button.btn-submit.btn-primary, button.btn-primary");
    if (btn) {
      await btn.click();
    } else {
      // fallback: clique em qualquer botão primário
      await page.evaluate(()=> {
        const b = document.querySelector("button[type=submit]");
        if (b) b.click();
      });
    }

    // espera por resultado (lista de eventos) ou mensagem "Nenhum pedido encontrado"
    await page.waitForFunction(() => {
      const hasList = document.querySelectorAll('.product-status-date li').length > 0;
      const noResElem = document.querySelector('.product-status-top');
      const noRes = noResElem && /nenhum pedido encontrado/i.test(noResElem.textContent || '');
      return hasList || noRes;
    }, { timeout: 30000 }).catch(()=>{});

    // coleta eventos (se existirem)
    const events = await page.$$eval(".product-status-date li", items =>
      items.map(el => ({
        time: (el.querySelector(".date") && el.querySelector(".date").textContent.trim()) || "",
        reason: (el.querySelector(".desc") && el.querySelector(".desc").textContent.trim()) || el.textContent.trim()
      }))
    );

    // coleta metadados visíveis
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
    if (browser) try { await browser.close(); } catch(e){/*ignore*/}

    // retorna erro com mensagem para debug
    res.json({ ok:false, error: String(err), url });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Rodonaves API listening on port " + PORT));
