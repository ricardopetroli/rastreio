// rodonaves-api.js
// API de rastreio Rodonaves (Puppeteer + Express)
// Endpoint: /rodonaves?cnpj=16524954000133&nf=10150551

import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";

const app = express();
app.use(cors());

app.get("/rodonaves", async (req, res) => {
  const cnpj = (req.query.cnpj || "16524954000133").trim();
  const nf = (req.query.nf || "").trim();
  if (!nf) return res.status(400).json({ ok: false, error: "Falta parâmetro nf" });

  const url = "https://rodonaves.com.br/rastreio-de-mercadoria";
  let browser = null;

  try {
    // ✅ Caminho correto do Chrome no ambiente do Render
    const executablePath = await puppeteer.executablePath();

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

    // Preenche CNPJ e NF
    await page.type('input[aria-describedby="CPF"]', cnpj, { delay: 20 });
    await page.type('input[aria-describedby="NF"]', nf, { delay: 20 });

    // Clica no botão RASTREAR
    await page.click("button.btn-submit.btn-primary");

    // Espera os resultados
    await page.waitForFunction(() => {
      const list = document.querySelectorAll(".product-status-date li");
      const noRes = document.querySelector(".product-status-top")?.textContent?.toLowerCase().includes("nenhum pedido");
      return list.length > 0 || noRes;
    }, { timeout: 45000 }).catch(() => {});

    // Coleta eventos
    const events = await page.$$eval(".product-status-date li", items =>
      items.map(el => ({
        time: el.querySelector(".date")?.textContent?.trim() || "",
        reason: el.querySelector(".desc")?.textContent?.trim() || el.textContent.trim()
      }))
    );

    // Coleta metadados adicionais
    const meta = await page.evaluate(() => {
      const get = sel => document.querySelector(sel)?.textContent?.trim() || "";
      return {
        serviceType: get('.product-status-info .info-item:nth-child(1) .desc'),
        cteNumber: get('.product-status-info .info-item:nth-child(2) .desc'),
        date: get('.product-status-info .info-item:nth-child(3) .desc'),
        sender: get('.product-status-info .info-item:nth-child(4) .desc'),
        recipient: get('.product-status-info .info-item:nth-child(5) .desc'),
        status: get('.product-status-info .info-item:nth-child(6) .desc'),
        preDelivery: get('.product-status-top .date')
      };
    });

    await browser.close();
    res.json({ ok: events.length > 0, events, meta, url });
  } catch (err) {
    if (browser) try { await browser.close(); } catch {}
    res.json({ ok: false, error: String(err), url });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Rodonaves API online na porta " + PORT));
