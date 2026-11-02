// Concordancia del oráculo Mermaid: parser jsdom (Node) vs Chrome headless.
//
// Para cada entrada de `MERMAID_CORPUS` compara el veredicto de
// `createNodeMermaidParser()` (mermaid.parse en jsdom) con el de mermaid en
// Chrome headless (puppeteer hoisted por mermaid-cli). Exige 100 % de acuerdo
// en el veredicto de `parse`; además informa si `render` en Chrome falla donde
// `parse` pasa (informativo: el oráculo es `parse`).
//
// Uso (desde la raíz o desde apps/api; los TS se cargan con tsx sin flags):
//   node apps/api/scripts/mermaid-oracle-concordance.mjs
// Salida: código 0 si hay 100 % de acuerdo, 1 si hay discrepancias, 2 si el entorno falla.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const oracleDir = path.join(apiRoot, "src/modules/mermaid-oracle");

const t0 = Date.now();

async function loadTs(relPath) {
  const { tsImport } = await import("tsx/esm/api");
  return tsImport(pathToFileURL(path.join(oracleDir, relPath)).href, import.meta.url);
}

/** Veredictos de Chrome: { parseOk, renderOk, err }[] */
async function runChrome(bodies) {
  const puppeteer = require("puppeteer");
  const mermaidBundle = require.resolve("mermaid/dist/mermaid.min.js");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent("<html><body><div id=c></div></body></html>");
    await page.addScriptTag({ path: mermaidBundle });
    await page.evaluate(() => {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
    });
    return await page.evaluate(async (ds) => {
      const short = (e) =>
        String(e?.message ?? e).split("\n").slice(0, 3).join(" | ");
      const out = [];
      let n = 0;
      for (const d of ds) {
        const r = { parseOk: true, renderOk: true, err: "" };
        try {
          await window.mermaid.parse(d);
        } catch (e) {
          r.parseOk = false;
          r.renderOk = false;
          r.err = short(e);
          out.push(r);
          continue;
        }
        try {
          await window.mermaid.render("m" + n++, d);
        } catch (e) {
          r.renderOk = false;
          r.err = "RENDER: " + short(e);
        }
        out.push(r);
      }
      return out;
    }, bodies);
  } finally {
    await browser.close();
  }
}

async function main() {
  const { MERMAID_CORPUS } = await loadTs("__fixtures__/mermaid-corpus.ts");
  const { createNodeMermaidParser } = await loadTs("node-mermaid-parser.ts");
  const total = MERMAID_CORPUS.length;

  const tChrome = Date.now();
  const chrome = await runChrome(MERMAID_CORPUS.map((e) => e.body));
  const chromeMs = Date.now() - tChrome;

  const parse = createNodeMermaidParser();
  const tJsdom = Date.now();
  const jsdom = [];
  for (const e of MERMAID_CORPUS) jsdom.push(await parse(e.body));
  const jsdomMs = Date.now() - tJsdom;

  const unavailable = jsdom.filter((r) => r.status === "unavailable");
  if (unavailable.length === total) {
    console.error("jsdom no disponible para ninguna entrada:", unavailable[0].error);
    process.exit(2);
  }

  const discrepancies = [];
  const renderOnly = [];
  let agree = 0;
  let chromeValid = 0;
  let expectedMismatch = 0;
  MERMAID_CORPUS.forEach((e, i) => {
    const j = jsdom[i];
    const c = chrome[i];
    if (c.parseOk) chromeValid++;
    if (e.expectedValid !== null && e.expectedValid !== (c.parseOk && c.renderOk)) {
      expectedMismatch++;
    }
    if (c.parseOk && !c.renderOk) renderOnly.push({ id: e.id, err: c.err });
    const jsdomVerdict = j.status === "ok" ? "valid" : j.status;
    const chromeVerdict = c.parseOk ? "valid" : "invalid";
    if (jsdomVerdict === chromeVerdict) agree++;
    else {
      discrepancies.push({
        id: e.id,
        jsdom: jsdomVerdict,
        chrome: chromeVerdict,
        jsdomError: j.status === "ok" ? "" : j.error.split("\n").slice(0, 3).join(" | "),
        chromeError: c.err,
      });
    }
  });

  console.log(`acuerdo ${agree}/${total} (parse jsdom vs parse Chrome)`);
  console.log(
    `válidos según Chrome (parse): ${chromeValid}/${total}; ` +
      `con render fallido pese a parse ok: ${renderOnly.length}`,
  );
  if (expectedMismatch > 0) {
    console.log(
      `AVISO: ${expectedMismatch} entradas con expectedValid del corpus distinto al veredicto actual de Chrome (parse+render); regenerar el corpus.`,
    );
  }
  if (discrepancies.length > 0) {
    console.log("\nDiscrepancias:");
    for (const d of discrepancies) {
      console.log(`- ${d.id}: jsdom=${d.jsdom} chrome=${d.chrome}`);
      if (d.jsdomError) console.log(`    jsdom:  ${d.jsdomError}`);
      if (d.chromeError) console.log(`    chrome: ${d.chromeError}`);
    }
  }
  if (renderOnly.length > 0) {
    console.log("\nInformativo (parse ok, render falla en Chrome):");
    for (const r of renderOnly) console.log(`- ${r.id}: ${r.err}`);
  }
  console.log(
    `\ntiempo: total ${((Date.now() - t0) / 1000).toFixed(1)} s ` +
      `(chrome ${(chromeMs / 1000).toFixed(1)} s, jsdom ${(jsdomMs / 1000).toFixed(1)} s)`,
  );
  process.exit(discrepancies.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error de entorno en la concordancia:", err);
  process.exit(2);
});
