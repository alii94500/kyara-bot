const { chromium } = require('playwright');

// Convertit l'export de l'extension Cookie-Editor au format Playwright
function toPwCookies(raw) {
  const map = { no_restriction: 'None', lax: 'Lax', strict: 'Strict' };
  return raw.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.expirationDate ? Math.floor(c.expirationDate) : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: map[c.sameSite] || 'Lax',
  }));
}

// Logique exécutée DANS la page (même principe que le script Tampermonkey)
async function pageLogic() {
  const SHONEN = /sh[oōô]u?nen\s*mix/i;
  const NEXT = [/booster suivant/i, /suivant/i, /continuer/i];
  const BLOCK = /acheter|payer|vendre|€|supprimer|échanger|boutique|recycl/i;
  const logs = [];
  const log = (s) => logs.push(s);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const human = () => sleep(700 + Math.random() * 1300);
  const txt = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim();
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const disabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true';
  const clickables = () =>
    [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')].filter(vis);

  const findBtn = (p) => clickables().find((el) => {
    const t = txt(el);
    return t && !BLOCK.test(t) && !disabled(el) && p.test(t);
  });

  const findText = (p) => {
    const c = [...document.querySelectorAll('body *')].filter((el) => {
      if (!vis(el)) return false;
      const t = (el.innerText || '').trim();
      return t && t.length < 60 && p.test(t);
    });
    return c.find((el) => !c.some((o) => o !== el && el.contains(o))) || null;
  };

  const getStock = () => {
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length || !vis(el)) continue;
      const m = (el.textContent || '').trim().match(/^(\d{1,2})\s*\/\s*10$/);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  };

  const multipliers = () => clickables()
    .map((el) => ({ el, m: txt(el).match(/^[x×]\s?(\d+)$/i) }))
    .filter((o) => o.m && !disabled(o.el))
    .map((o) => ({ el: o.el, n: parseInt(o.m[1], 10) }));

  const findOpenBtn = () => clickables().find((el) => {
    const t = txt(el);
    return /ouvrir/i.test(t) && /gratuit/i.test(t) && !disabled(el);
  });

  const onOpenPage = () => multipliers().length > 0 && !!findText(SHONEN);

  const clickEl = async (el, label) => {
    log('Clic : ' + label);
    el.scrollIntoView({ block: 'center' });
    await human();
    el.click();
    await sleep(2500);
  };

  const stock = getStock();
  if (stock === null) return { ok: false, msg: 'Compteur de stock introuvable : session expirée ? Mets à jour les secrets.', logs };
  if (stock < 10) return { ok: true, msg: `Stock ${stock}/10 : rien à faire.`, logs };

  // Aller sur Shōnen Mix
  if (!onOpenPage()) {
    const nav = findBtn(/^boosters?$/i);
    if (nav) await clickEl(nav, 'Boosters');
    const tab = findBtn(/^gratuits?$/i);
    if (tab) await clickEl(tab, 'Gratuits');
    for (let i = 0; i < 2 && !onOpenPage(); i++) {
      const card = findText(SHONEN);
      if (!card) break;
      await clickEl(card.closest('button, a, [role="button"], [tabindex]') || card, 'Shonen Mix');
    }
  }
  if (!onOpenPage()) return { ok: false, msg: 'Page Shonen Mix non atteinte.', logs };

  const best = multipliers().sort((a, b) => b.n - a.n)[0];
  if (!best || best.n < 10) return { ok: false, msg: 'x10 non proposé alors que stock = 10.', logs };
  await clickEl(best.el, 'x' + best.n);

  const open = findOpenBtn();
  if (!open) return { ok: false, msg: 'Bouton Ouvrir · Gratuit introuvable.', logs };
  await clickEl(open, txt(open));

  // Tout révéler (répété tant qu'il réapparaît)
  let idle = 0;
  for (let i = 0; i < 80 && idle < 4; i++) {
    await sleep(1500 + Math.random() * 1000);
    const reveal = findBtn(/tout révéler/i);
    if (reveal) { await clickEl(reveal, 'Tout reveler'); idle = 0; continue; }
    const next = NEXT.map((p) => findBtn(p)).find(Boolean);
    if (next) { await clickEl(next, txt(next)); idle = 0; continue; }
    idle++;
  }

  await sleep(3000);
  const back = findBtn(/^boosters?$/i);
  if (back) await clickEl(back, 'Retour Boosters');

  return { ok: true, msg: '10 boosters Shonen Mix ouverts ✔', logs };
}

(async () => {
  let cookies = [];
  try {
    cookies = JSON.parse(process.env.KYARA_COOKIES || '[]');
  } catch {
    console.error('Le secret KYARA_COOKIES n\'est pas un JSON valide.');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });

  if (cookies.length) await context.addCookies(toPwCookies(cookies));

  // Injecte le localStorage de ta session avant le chargement du site
  await context.addInitScript((data) => {
    if (!location.hostname.endsWith('kyara.games') || sessionStorage.getItem('__ls_done')) return;
    try {
      const obj = JSON.parse(data);
      for (const [k, v] of Object.entries(obj)) localStorage.setItem(k, v);
    } catch (e) {}
    sessionStorage.setItem('__ls_done', '1');
  }, process.env.KYARA_LOCALSTORAGE || '{}');

  const page = await context.newPage();
  let result;
  try {
    await page.goto('https://kyara.games/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // attend que le compteur de stock (ex : 3/10) apparaisse, 45 s max
    await page
      .waitForFunction(() => /\b\d{1,2}\s*\/\s*10\b/.test(document.body.innerText), null, { timeout: 45000 })
      .catch(() => console.log('Compteur pas visible après 45 s'));
    await page.waitForTimeout(3000);
    result = await page.evaluate(pageLogic);
  } catch (e) {
    result = { ok: false, msg: 'Erreur : ' + e.message, logs: [] };
  }

  result.logs.forEach((l) => console.log('  ' + l));
  console.log(result.msg);
  await page.screenshot({ path: 'capture.png' }).catch(() => {});
  await browser.close();
  process.exit(result.ok ? 0 : 1);
})();
