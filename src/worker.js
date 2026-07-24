/* mira tortillas — checkout API (Cloudflare Worker)
   run_worker_first: every request lands here (canonical-host 301s), then
   non-/api/ paths fall through to env.ASSETS. */

/* every price this API will sell — anything else is rejected */
const PRICES = {
  // one-off (amount = cents per pack, used for shipping rules)
  "price_1Tp6jR2KMRu6Fi6htz56SDPI": { mode: "payment", amount: 800 },   // small ×12 €8
  "price_1Tp6jS2KMRu6Fi6hI68OSLWD": { mode: "payment", amount: 1000 },  // medium ×12 €10
  "price_1Tp6jU2KMRu6Fi6hj58ozoRh": { mode: "payment", amount: 900 },   // large ×6 €9
  // subscriptions (cad = billing rhythm; a multi-item subscription must share one cad)
  "price_1Tp6je2KMRu6Fi6hri2mQkM8": { mode: "subscription", cad: "weekly" },   // small
  "price_1Tp6jf2KMRu6Fi6hnOZhEOkg": { mode: "subscription", cad: "biweekly" }, // small
  "price_1Tp6jg2KMRu6Fi6h26hVNFiV": { mode: "subscription", cad: "monthly" },  // small
  "price_1Tp6jh2KMRu6Fi6hvlaea75S": { mode: "subscription", cad: "weekly" },   // medium
  "price_1Tp6jj2KMRu6Fi6hCJSEMrlK": { mode: "subscription", cad: "biweekly" }, // medium
  "price_1Tp6jk2KMRu6Fi6h7svhoyec": { mode: "subscription", cad: "monthly" },  // medium
  "price_1Tp6jm2KMRu6Fi6hJ0jJ2qVn": { mode: "subscription", cad: "weekly" },   // large
  "price_1Tp6jn2KMRu6Fi6h47lAOYZs": { mode: "subscription", cad: "biweekly" }, // large
  "price_1Tp6jo2KMRu6Fi6hOAHj9Uo4": { mode: "subscription", cad: "monthly" },  // large
};

/* sku per price id — stock caps + sold-out accounting + sales-by-size.
   Includes subscription prices so every pack line item is tagged at write time
   (order items are unbackfillable — a null sku would vanish from analytics). */
const PRICE_SKU = {
  "price_1Tp6jR2KMRu6Fi6htz56SDPI": "small",
  "price_1Tp6jS2KMRu6Fi6hI68OSLWD": "medium",
  "price_1Tp6jU2KMRu6Fi6hj58ozoRh": "large",
  "price_1Tp6je2KMRu6Fi6hri2mQkM8": "small",  "price_1Tp6jf2KMRu6Fi6hnOZhEOkg": "small",  "price_1Tp6jg2KMRu6Fi6h26hVNFiV": "small",
  "price_1Tp6jh2KMRu6Fi6hvlaea75S": "medium", "price_1Tp6jj2KMRu6Fi6hCJSEMrlK": "medium", "price_1Tp6jk2KMRu6Fi6h7svhoyec": "medium",
  "price_1Tp6jm2KMRu6Fi6hJ0jJ2qVn": "large",  "price_1Tp6jn2KMRu6Fi6h47lAOYZs": "large",  "price_1Tp6jo2KMRu6Fi6hOAHj9Uo4": "large",
};

/* owner dashboard access (email-code login as one of these = admin) */
const ADMIN_EMAILS = ["nicholascalkins@gmail.com"];

async function getSettings(env) {
  const rows = (await env.DB.prepare(`SELECT k, v FROM settings`).all()).results || [];
  const s = {};
  for (const r of rows) s[r.k] = r.v;
  return {
    open: s.store_open === "1",
    caps: { small: +s.cap_small || 0, medium: +s.cap_medium || 0, large: +s.cap_large || 0 },
    sold: { small: +s.sold_small || 0, medium: +s.sold_medium || 0, large: +s.sold_large || 0 },
  };
}

async function isAdmin(env, request) {
  const c = await currentCustomer(env, request);
  /* admin requires a code-VERIFIED session (proved inbox control), not a
     claim-minted one — a Stripe-checkout email is not an authenticated identity */
  return !!(c && c._verified === 1 && ADMIN_EMAILS.includes((c.email || "").toLowerCase()));
}

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });

/* ── mira's own accounts (D1) ── */
const SESSION_DAYS = 90;

function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

async function currentCustomer(env, request) {
  const token = getCookie(request, "mira_session");
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT c.*, s.verified AS _verified FROM sessions s JOIN customers c ON c.id = s.customer_id
     WHERE s.token = ?1 AND s.expires_at > datetime('now')`
  ).bind(token).first();
  return row || null;
}

/* verified=1 = email-code login (proved inbox); verified=0 = claim after checkout (weak identity) */
async function createSession(env, customerId, verified = 0) {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(
    `INSERT INTO sessions (token, customer_id, verified, expires_at)
     VALUES (?1, ?2, ?3, datetime('now', '+${SESSION_DAYS} days'))`
  ).bind(token, customerId, verified ? 1 : 0).run();
  return `mira_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

async function stripeGet(env, path) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  return res.ok ? data : null;
}

/* like stripePost but surfaces Stripe's error message (admin tools need real errors) */
/* Verify a Stripe webhook signature (HMAC-SHA256 over `${t}.${rawBody}`, 5-min tolerance,
   constant-time compare). Returns false on any malformed/stale/mismatched signature. */
async function verifyStripeSig(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = {};
  for (const kv of header.split(",")) { const i = kv.indexOf("="); if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

async function stripePostRaw(env, path, params) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = await res.json();
  return { ok: res.ok, data, err: !res.ok ? (data.error && data.error.message) || "stripe error" : null };
}

async function stripePost(env, path, params) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = await res.json();
  return res.ok ? data : null;
}

/* transactional email via Brevo (BREVO_API_KEY + MAIL_FROM env) */
async function sendEmail(env, to, subject, text, attachments) {
  if (!env.BREVO_API_KEY) return false;
  const payload = {
    sender: { name: "mira tortillas", email: env.MAIL_FROM || "ola@miratortillas.pt" },
    to: [{ email: to }],
    subject,
    textContent: text,
  };
  if (attachments && attachments.length) payload.attachment = attachments; /* [{content: base64, name}] */
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

/* base64-encode a UTF-8 string (chunked, so accents in names/addresses survive
   and large backups don't blow the call stack) — for email CSV attachments */
function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/* owner SMS via Brevo transactional SMS (same API key; needs SMS credits +
   OWNER_PHONE env var, intl format, comma-separated for several owners
   e.g. +3519XXXXXXXX,+3519YYYYYYYY — silently skips if unset) */
async function sendSMS(env, text) {
  if (!env.BREVO_API_KEY || !env.OWNER_PHONE) return false;
  let ok = false;
  for (const to of String(env.OWNER_PHONE).split(",").map((s) => s.trim()).filter(Boolean)) {
    const res = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "transactional", unicodeEnabled: true, sender: "mira",
        recipient: to, content: text.slice(0, 155),
      }),
    });
    ok = ok || res.ok;
  }
  return ok;
}

/* ROUTINE owner SMS (per-order / per-renewal pings) — OFF by default to save SMS
   credits; the email twin always fires. Set worker var OWNER_SMS=1 to turn these on
   (e.g. at launch). URGENT alerts — disputes, failed renewals, oversold — call
   sendSMS directly and always send, regardless of this flag. */
async function smsRoutine(env, text) {
  if (env.OWNER_SMS !== "1") return false;
  return sendSMS(env, text);
}

const POINTS_COUPON = "MIRA-POINTS-800"; // 100 points → €8 off

/* upsert customer + (if paid) record order & settle points. Idempotent per session. */
async function processSession(env, session) {
  const cd = session.customer_details || {};
  const email = (cd.email || "").toLowerCase();
  if (!email) return null;
  const addr = (session.shipping_details && session.shipping_details.address) || cd.address || {};

  await env.DB.prepare(
    `INSERT INTO customers (email, name, phone, address_line1, address_line2, postal_code, city, country, stripe_customer_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(email) DO UPDATE SET
       name = COALESCE(excluded.name, name),
       phone = COALESCE(excluded.phone, phone),
       address_line1 = COALESCE(excluded.address_line1, address_line1),
       address_line2 = COALESCE(excluded.address_line2, address_line2),
       postal_code = COALESCE(excluded.postal_code, postal_code),
       city = COALESCE(excluded.city, city),
       country = COALESCE(excluded.country, country),
       stripe_customer_id = COALESCE(excluded.stripe_customer_id, stripe_customer_id),
       updated_at = datetime('now')`
  ).bind(
    email, cd.name || null, cd.phone || null,
    addr.line1 || null, addr.line2 || null, addr.postal_code || null,
    addr.city || null, addr.country || "PT",
    typeof session.customer === "string" ? session.customer : null
  ).run();

  const customer = await env.DB.prepare(`SELECT * FROM customers WHERE email = ?1`).bind(email).first();

  /* newsletter consent from our cart checkbox (only ever upgrades to yes) */
  if (session.metadata && session.metadata.newsletter === "1") {
    await env.DB.prepare(`UPDATE customers SET marketing_ok = 1 WHERE id = ?1`).bind(customer.id).run();
  }

  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (paid) {
    const points = Math.floor((session.amount_total || 0) / 100);
    /* what's inside the order — feeds sales-by-size analytics + the bake sheet.
       Delivery line items carry sku:"delivery" so they're skipped in pack tallies. */
    const isDelivery = (li) => /entrega|envio|delivery|shipping/i.test(li.description || "");
    const itemsJson = JSON.stringify(((session.line_items && session.line_items.data) || []).map((li) => ({
      sku: PRICE_SKU[(li.price && li.price.id) || ""] || (isDelivery(li) ? "delivery" : null),
      d: (li.description || "").slice(0, 40),
      q: li.quantity || 1,
    })));
    /* chosen shipping option (Lisboa €5 / continente €10) from the paid session */
    const sc = session.shipping_cost || {};
    const shipMethod = (sc.shipping_rate && typeof sc.shipping_rate === "object" && sc.shipping_rate.display_name) ||
      (session.shipping_options && session.shipping_options[0] && session.shipping_options[0].shipping_rate_data && session.shipping_options[0].shipping_rate_data.display_name) || null;
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO orders
        (customer_id, stripe_session_id, amount_total, currency, mode, points_earned, items,
         ship_name, ship_phone, ship_line1, ship_line2, ship_postal, ship_city, ship_method, status)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'new')`
    ).bind(customer.id, session.id, session.amount_total || 0, session.currency || "eur", session.mode, points, itemsJson,
      cd.name || null, cd.phone || null, addr.line1 || null, addr.line2 || null,
      addr.postal_code || null, addr.city || null, shipMethod).run();
    if (inserted.meta.changes > 0) {
      if (points > 0)
        await env.DB.prepare(`UPDATE customers SET points = points + ?1 WHERE id = ?2`).bind(points, customer.id).run();
      /* redeemed points were already reserved at checkout creation (atomic decrement) —
         no second decrement here, or racing checkouts would double-charge the balance */
      /* stock accounting: count packs sold per size (one-off orders, once per session) */
      if (session.mode === "payment" && session.line_items && session.line_items.data) {
        for (const li of session.line_items.data) {
          const sku = PRICE_SKU[(li.price && li.price.id) || ""];
          if (sku) await env.DB.prepare(
            `UPDATE settings SET v = CAST(CAST(v AS INTEGER) + ?1 AS TEXT) WHERE k = ?2`
          ).bind(li.quantity || 1, "sold_" + sku).run();
        }
        /* two buyers can pass the cap check before either pays — if that happens,
           tell the owner immediately so they can bake extra or contact the customer */
        try {
          const shop2 = await getSettings(env);
          const over = Object.keys(shop2.caps).filter((k) => shop2.sold[k] > shop2.caps[k])
            .map((k) => `${k}: sold ${shop2.sold[k]} / cap ${shop2.caps[k]}`);
          if (over.length) {
            await sendEmail(env, "ola@miratortillas.pt", "⚠️ oversold — simultaneous checkouts",
              `two checkouts passed the stock check at the same time:\n\n${over.join("\n")}\n\nbake extra or contact the last buyer.\ndashboard: https://miratortillas.pt/admin`);
            await sendSMS(env, `mira: ⚠️ OVERSOLD ${over.join("; ")} — see email`);
          }
        } catch (e) { /* alert only */ }
      }
      /* owner heads-up: one email per new order via ola@ (best-effort, never blocks the order) */
      try {
        const lis = (session.line_items && session.line_items.data) || [];
        const itemsTxt = lis.map((li) => `${li.quantity}× ${li.description || (li.price && li.price.id) || "item"}`).join("\n") || `(${session.mode})`;
        const total = ((session.amount_total || 0) / 100).toFixed(2);
        const packs = lis.filter((li) => PRICE_SKU[(li.price && li.price.id) || ""]).map((li) => li.quantity).reduce((a, b) => a + b, 0);
        const addrLines = [addr.line1, addr.line2, [addr.postal_code, addr.city].filter(Boolean).join(" ")].filter(Boolean).join("\n");
        const fulfil = addrLines ? `\nmorada / address:\n${addrLines}` : `\nlevantamento / pickup: Graça (envia dia + local)`;
        await sendEmail(env, "ola@miratortillas.pt", `🌯 nova encomenda — €${total}`,
          `nova encomenda / new order\n\n${itemsTxt}\n\ntotal: €${total} · ${session.mode}\n\n${cd.name || "?"} · ${email}${cd.phone ? " · ☎ " + cd.phone : ""}${fulfil}\n\nstripe: https://dashboard.stripe.com/payments\ndashboard: https://miratortillas.pt/admin`);
        await smsRoutine(env, `mira: nova encomenda €${total} — ${cd.name || email} (${packs || "?"} packs) · Graça pickup`);
      } catch (e) { /* notification failure must never fail an order */ }

      /* customer confirmation — the ONE email that tells them HOW they get their tortillas
         (pickup in Graça, or their own courier). Warm, early-stage-honest, PT + EN. */
      try {
        const totalC = ((session.amount_total || 0) / 100).toFixed(2);
        const hi = cd.name ? " " + cd.name.split(" ")[0] : "";
        await sendEmail(env, email, "obrigado! a tua encomenda mira · your mira order 🌯",
          `Olá${hi}!\n\n` +
          `Obrigado pela tua encomenda 🌯 Está tudo recebido (€${totalC}).\n\n` +
          `Somos uma operação pequena e nova, por isso tratamos de cada encomenda pessoalmente. Vamos responder-te em breve por email para combinar o dia e o local do levantamento na Graça — ou, se preferires, envia o teu próprio estafeta (Bolt/Glovo) para o levantar.\n\n` +
          `São tortillas frescas, meia-cozedura — a tostadela final é contigo, em casa.\n\n` +
          `Qualquer dúvida, responde a este email.\n— mira\n\n` +
          `— — — — —\n\n` +
          `Hi${hi}!\n\n` +
          `Thanks for your order 🌯 We've got it (€${totalC}).\n\n` +
          `We're a small, new operation, so every order gets a personal touch. We'll email you back soon to arrange the day and spot for pickup in Graça — or, if you'd rather, send your own courier (Bolt/Glovo) to grab it.\n\n` +
          `They're fresh, par-cooked tortillas — the final toast is yours, at home.\n\n` +
          `Questions? Just reply to this email.\n— mira`);
      } catch (e) { /* customer email is best-effort — never blocks the order */ }
    }
  }
  return customer;
}

/* subscription RENEWALS arrive as invoice.paid (no checkout session) — record them
   the same way so revenue/points/alerts/backup all include recurring charges.
   Untrusted payload: caller only passes the invoice id; we re-fetch from Stripe. */
async function processInvoice(env, invoiceId) {
  const inv = await stripeGet(env, `/v1/invoices/${invoiceId}?expand[]=lines`);
  if (!inv || inv.status !== "paid") return;
  /* the very first subscription invoice is already covered by the checkout.session flow — skip it */
  if (inv.billing_reason === "subscription_create") return;
  const email = (inv.customer_email || "").toLowerCase();
  if (!email) return;
  const customer = await env.DB.prepare(`SELECT * FROM customers WHERE email = ?1`).bind(email).first();
  if (!customer) return; /* unknown customer — first order always precedes a renewal */
  const points = Math.floor((inv.amount_paid || 0) / 100);
  const lines = (inv.lines && inv.lines.data) || [];
  const isDelivery = (l) => /entrega|envio|delivery|shipping/i.test((l.description || "") + " " + ((l.price && l.price.nickname) || ""));
  const itemsJson = JSON.stringify(lines.map((l) => ({
    sku: PRICE_SKU[(l.price && l.price.id) || ""] || (isDelivery(l) ? "delivery" : null),
    d: (l.description || "").slice(0, 40),
    q: l.quantity || 1,
  })));
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO orders (customer_id, stripe_session_id, amount_total, currency, mode, points_earned, items, status)
     VALUES (?1, ?2, ?3, ?4, 'subscription', ?5, ?6, 'new')`
  ).bind(customer.id, inv.id, inv.amount_paid || 0, inv.currency || "eur", points, itemsJson).run();
  if (inserted.meta.changes === 0) return; /* already recorded (idempotent on invoice id) */
  if (points > 0)
    await env.DB.prepare(`UPDATE customers SET points = points + ?1 WHERE id = ?2`).bind(points, customer.id).run();
  try {
    const total = ((inv.amount_paid || 0) / 100).toFixed(2);
    const itemsTxt = lines.map((l) => `${l.quantity || 1}× ${l.description || "item"}`).join("\n");
    await sendEmail(env, "ola@miratortillas.pt", `🔁 renovação de assinatura — €${total}`,
      `subscription renewal / renovação\n\n${itemsTxt}\n\ntotal: €${total}\n\n${customer.name || "?"} · ${email}${customer.phone ? " · " + customer.phone : ""}\n${[customer.address_line1, [customer.postal_code, customer.city].filter(Boolean).join(" ")].filter(Boolean).join("\n")}\n\ndashboard: https://miratortillas.pt/admin`);
    const packs = lines.filter((l) => PRICE_SKU[(l.price && l.price.id) || ""]).map((l) => l.quantity || 1).reduce((a, b) => a + b, 0);
    await smsRoutine(env, `mira: renovação €${total} — ${customer.name || email} (${packs || "?"} packs)`);
  } catch (e) { /* never block */ }
}

export default {
  /* daily heartbeat (cron): self-check the live endpoints, email owner on failure;
     Mondays also email a full customers+orders CSV backup — the data IS the business */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      let alert = "";
      try {
        const s = await fetch("https://miratortillas.pt/api/status");
        const sd = await s.json().catch(() => ({}));
        if (!s.ok || typeof sd.open !== "boolean") alert += `/api/status broken (${s.status})\n`;
        const c = await fetch("https://miratortillas.pt/api/checkout", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        const cd = await c.json().catch(() => ({}));
        if (!cd.error) alert += `/api/checkout unexpected (${c.status})\n`;
      } catch (e) { alert += "self-check fetch failed: " + e.message + "\n"; }
      if (alert)
        await sendEmail(env, "ola@miratortillas.pt", "⚠️ mira self-check FAILED", alert + "\ncheck: https://dash.cloudflare.com → mira-shop");
      if (new Date().getUTCDay() === 1) {
        const cell = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"'; /* RFC-4180 CSV escaping */
        const csv = (rows) => rows.length
          ? Object.keys(rows[0]).join(",") + "\n" + rows.map((r) => Object.values(r).map(cell).join(",")).join("\n")
          : "(empty)";
        const cust = (await env.DB.prepare(`SELECT * FROM customers`).all()).results || [];
        const ord = (await env.DB.prepare(`SELECT * FROM orders`).all()).results || [];
        const eur = (c) => "€" + ((c || 0) / 100).toFixed(2).replace(".00", "");
        const weekAgo = Date.now() - 7 * 864e5;
        const newThisWeek = cust.filter((c) => Date.parse(String(c.created_at || "").replace(" ", "T") + "Z") >= weekAgo).length;
        const newsletter = cust.filter((c) => Number(c.marketing_ok) === 1).length;
        const points = cust.reduce((n, c) => n + (Number(c.points) || 0), 0);
        const revenue = ord.reduce((n, o) => n + ((Number(o.amount_total) || 0) - (Number(o.refunded_cents) || 0)), 0);
        /* human summary on top; raw CSV still below AND attached, so it's readable + fully restorable */
        const summary =
          `automatic Monday backup — your safety net. the CSVs are attached (open in Sheets/Excel); keep this email.\n\n` +
          `THIS WEEK\n` +
          `· customers: ${cust.length} total${newThisWeek ? ` (${newThisWeek} new this week)` : ""}\n` +
          `· on the newsletter: ${newsletter}\n` +
          `· orders: ${ord.length}  ·  revenue: ${eur(revenue)}\n` +
          `· points outstanding: ${points}\n\n` +
          `— raw data below (also attached) — this is the restore copy —\n\n` +
          `CUSTOMERS\n${csv(cust)}\n\nORDERS\n${csv(ord)}`;
        const stamp = new Date().toISOString().slice(0, 10);
        await sendEmail(env, "ola@miratortillas.pt",
          `📦 mira weekly backup — ${cust.length} customers · ${ord.length} orders`,
          summary,
          [
            { content: b64utf8(csv(cust)), name: `mira-customers-${stamp}.csv` },
            { content: b64utf8(csv(ord)), name: `mira-orders-${stamp}.csv` },
          ]);
      }
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    /* canonical host: www + .com variants 301 to the apex (workers.dev stays live for testing) */
    const host = url.hostname;
    if (host === "www.miratortillas.pt" || host === "miratortillas.com" || host === "www.miratortillas.com") {
      return Response.redirect("https://miratortillas.pt" + url.pathname + url.search, 301);
    }

    if (url.pathname === "/api/config") {
      return json({ publishableKey: env.STRIPE_PUBLISHABLE_KEY || null });
    }

    if (url.pathname === "/api/checkout" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }

      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > 10) return json({ error: "bad cart" }, 400);

      let mode = "payment";
      let subtotal = 0;
      let packs = 0;
      const cads = new Set();
      for (const it of items) {
        const known = PRICES[it.price];
        const qty = Number(it.quantity);
        if (!known || !Number.isInteger(qty) || qty < 1 || qty > 20)
          return json({ error: "bad item" }, 400);
        if (known.mode === "subscription") { mode = "subscription"; cads.add(known.cad); }
        else { subtotal += known.amount * qty; packs += qty; }
      }
      if (mode === "subscription") {
        // no mixing one-off packs into a subscription, and one rhythm per subscription
        if (items.some((it) => PRICES[it.price].mode !== "subscription"))
          return json({ error: "subscriptions and one-off packs check out separately" }, 400);
        if (cads.size > 1)
          return json({ error: "one rhythm per subscription" }, 400);
      }

      /* owner controls: store pause + per-size stock caps (caps apply to one-off packs) */
      const shop = await getSettings(env);
      if (!shop.open) return json({ error: "loja em pausa, voltamos em breve · store paused, back soon" }, 503);
      if (mode === "payment") {
        for (const it of items) {
          const sku = PRICE_SKU[it.price];
          /* a cap of 0 = "no weekly limit set" = unlimited, NOT sold out — otherwise
             flipping the store live before setting caps rejects every order as esgotado */
          if (!sku || !(shop.caps[sku] > 0)) continue;
          const left = Math.max(shop.caps[sku] - shop.sold[sku], 0);
          if (Number(it.quantity) > left)
            return json({ error: left > 0 ? `${sku}: esgotado, só restam ${left} · sold out, only ${left} left` : `${sku}: esgotado · sold out` }, 409);
        }
      }

      /* points redemption: 100 pts = €8 off, one-off orders of €8+, signed-in only.
         Points are RESERVED here atomically (conditional decrement) so two open
         checkouts can't spend the same balance twice; refunded via webhook if the
         session expires or its async payment fails. */
      let redeemer = null;
      if (body.usePoints === true && mode === "payment" && subtotal >= 800) {
        const c = await currentCustomer(env, request);
        if (c) {
          const res = await env.DB.prepare(
            `UPDATE customers SET points = points - 100 WHERE id = ?1 AND points >= 100`
          ).bind(c.id).run();
          if (res.meta.changes === 1) redeemer = c;
        }
      }

      const p = new URLSearchParams();
      p.set("ui_mode", "embedded_page");
      p.set("mode", mode);
      /* only the payment methods that matter for Lisbon — otherwise Stripe auto-shows
         Bancontact/Satispay/EPS etc. from other countries. Multibanco + MB WAY are
         one-off only, so subscriptions fall back to card. */
      if (mode === "subscription") {
        p.set("payment_method_types[0]", "card");
      } else {
        /* NB: Stripe's MB WAY id is "mb_way" (underscore) — "mbway" is rejected.
           Revolut Pay dropped on purpose: Revolut users already pay under "card",
           so it added a row without adding reach. */
        ["card", "multibanco", "mb_way"].forEach((m, i) => p.set(`payment_method_types[${i}]`, m));
      }
      /* newsletter opt-in from our own cart checkbox (Stripe's consent_collection
         isn't available for PT accounts) */
      if (body.newsletter === true) p.set("metadata[newsletter]", "1");
      if (redeemer) {
        p.set("discounts[0][coupon]", POINTS_COUPON);
        p.set("metadata[points_redeemed]", "100");
        p.set("metadata[points_customer]", String(redeemer.id));
      } else {
        /* Stripe's native promo-code box in checkout (can't combine with discounts) */
        p.set("allow_promotion_codes", "true");
      }
      /* 30-min session expiry: shrinks the window where a checkout opened
         before a pause/sell-out could still complete (default is 24h) */
      p.set("expires_at", String(Math.floor(Date.now() / 1000) + 1800));
      p.set("return_url", `${url.origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
      /* pickup model: no delivery address needed — just a phone so we can send the
         customer the weekly Graça pickup day & spot (email is collected by Stripe) */
      p.set("phone_number_collection[enabled]", "true");
      items.forEach((it, i) => {
        p.set(`line_items[${i}][price]`, it.price);
        p.set(`line_items[${i}][quantity]`, String(it.quantity));
      });

      /* NO delivery fees for now (owner call, 2026-07-12): shipping logistics
         aren't set up yet — no boxes, no courier pricing. We still collect the
         address + phone so pickup/delivery can be arranged personally after the
         order. When shipping is real, re-add shipping_options (one-off) and a
         recurring delivery line item (subscriptions) here. */

      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: p,
      });
      const session = await res.json();
      if (!res.ok) {
        /* Stripe session never created — give back any points we already reserved,
           or the customer silently loses them (no session id = no webhook refund path) */
        if (redeemer) await env.DB.prepare(`UPDATE customers SET points = points + 100 WHERE id = ?1`).bind(redeemer.id).run();
        return json({ error: session.error?.message || "stripe error" }, 502);
      }
      return json({ clientSecret: session.client_secret });
    }

    /* after a successful checkout: create/refresh the mira account + sign in */
    if (url.pathname === "/api/claim" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const sid = String(body.session_id || "");
      if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sid)) return json({ error: "bad session" }, 400);

      const session = await stripeGet(env, `/v1/checkout/sessions/${sid}?expand[]=line_items`);
      if (!session || session.status !== "complete") return json({ error: "not a completed checkout" }, 400);

      const customer = await processSession(env, session);
      if (!customer) return json({ error: "no email on session" }, 400);

      const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
      /* auto-login ONLY on the fresh post-checkout redirect (bounds the leaked-session_id
         replay window); never a verified session — a checkout email isn't proven identity */
      const fresh = String(Date.now() / 1000 - (session.created || 0) < 3600); /* < 1h old */
      let cookie = null;
      if (fresh === "true") cookie = await createSession(env, customer.id, 0);
      const bal = await env.DB.prepare(`SELECT points FROM customers WHERE id = ?1`).bind(customer.id).first();
      return json({ ok: true, paid, email: customer.email, name: customer.name, points: bal.points },
        200, cookie ? { "Set-Cookie": cookie } : {});
    }

    /* Stripe webhook: records orders/points even if the buyer never returns to the site
       (closed tab, or async methods like Multibanco that settle later).
       Payload is untrusted — we only take the session id and re-fetch from Stripe. */
    if (url.pathname === "/api/webhook" && request.method === "POST") {
      const raw = await request.text();
      /* verify the Stripe signature when a signing secret is configured — rejects
         forged POSTs (which could otherwise spam owner alerts / drain SMS credits) */
      if (env.STRIPE_WEBHOOK_SECRET) {
        const okSig = await verifyStripeSig(raw, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
        if (!okSig) return json({ error: "bad signature" }, 400);
      }
      let evt;
      try { evt = JSON.parse(raw); } catch { return json({ received: true }); }
      /* idempotency: Stripe can deliver the same event more than once — handle each once
         (also stops a replayed event from re-crediting reserved points) */
      if (evt.id) {
        const seen = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (id) VALUES (?1)`).bind(String(evt.id)).run();
        if (seen.meta.changes === 0) return json({ received: true });
      }
      const type = evt.type || "";
      const objId = evt.data && evt.data.object && evt.data.object.id;
      if (
        (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") &&
        /^cs_(live|test)_[A-Za-z0-9]+$/.test(objId || "")
      ) {
        const session = await stripeGet(env, `/v1/checkout/sessions/${objId}?expand[]=line_items`);
        if (session && session.status === "complete") await processSession(env, session);
      } else if (
        (type === "invoice.paid" || type === "invoice.payment_succeeded") &&
        /^in_[A-Za-z0-9]+$/.test(objId || "")
      ) {
        await processInvoice(env, objId);
      } else if (
        (type === "checkout.session.expired" || type === "checkout.session.async_payment_failed") &&
        /^cs_(live|test)_[A-Za-z0-9]+$/.test(objId || "")
      ) {
        /* a checkout that reserved points never paid — give them back */
        const s = await stripeGet(env, `/v1/checkout/sessions/${objId}`);
        if (s && s.payment_status !== "paid" && s.metadata && s.metadata.points_redeemed) {
          const cid = parseInt(s.metadata.points_customer || "0", 10);
          const pts = parseInt(s.metadata.points_redeemed, 10);
          if (cid > 0 && pts > 0)
            await env.DB.prepare(`UPDATE customers SET points = points + ?1 WHERE id = ?2`).bind(pts, cid).run();
        }
      } else if (type === "charge.refunded" && /^ch_[A-Za-z0-9]+$/.test(objId || "")) {
        /* refunds flow back so dashboard revenue stays honest; points are clawed back */
        const ch = await stripeGet(env, `/v1/charges/${objId}`);
        if (ch) {
          const refunded = ch.amount_refunded || 0;
          let sid = typeof ch.invoice === "string" ? ch.invoice : (ch.invoice && ch.invoice.id) || null;
          if (!sid && ch.payment_intent) {
            const ss = await stripeGet(env, `/v1/checkout/sessions?payment_intent=${ch.payment_intent}&limit=1`);
            sid = ss && ss.data && ss.data[0] && ss.data[0].id;
          }
          const o = sid && await env.DB.prepare(
            `SELECT id, customer_id, amount_total, refunded_cents FROM orders WHERE stripe_session_id = ?1`
          ).bind(sid).first();
          if (o && refunded > (o.refunded_cents || 0)) {
            await env.DB.prepare(
              `UPDATE orders SET refunded_cents = ?1,
                 status = CASE WHEN ?1 >= amount_total THEN 'refunded' ELSE status END WHERE id = ?2`
            ).bind(refunded, o.id).run();
            const clawback = Math.floor(refunded / 100) - Math.floor((o.refunded_cents || 0) / 100);
            if (clawback > 0)
              await env.DB.prepare(`UPDATE customers SET points = MAX(points - ?1, 0) WHERE id = ?2`).bind(clawback, o.customer_id).run();
            try {
              await sendEmail(env, "ola@miratortillas.pt", `↩️ reembolso — €${(refunded / 100).toFixed(2)}`,
                `refund recorded / reembolso registado\n\n€${(refunded / 100).toFixed(2)} of €${(o.amount_total / 100).toFixed(2)}\n\ndashboard revenue is adjusted automatically.\nstripe: https://dashboard.stripe.com/payments`);
            } catch (e) { /* alert only */ }
          }
        }
      } else if (type === "charge.dispute.created" && /^d[pu]_[A-Za-z0-9]+$/.test(objId || "")) {
        /* disputes have a response deadline — this must never be silent.
           Only alert once the dispute is confirmed real via re-fetch (a forged id fetches null → no alert). */
        try {
          const dp = await stripeGet(env, `/v1/disputes/${objId}`);
          if (dp && dp.amount != null) {
            const amt = (dp.amount / 100).toFixed(2);
            await sendEmail(env, "ola@miratortillas.pt", `🚨 DISPUTE — €${amt} (responder no Stripe)`,
              `a customer disputed a charge of €${amt}.\n\nyou have a DEADLINE to respond — open Stripe now:\nhttps://dashboard.stripe.com/disputes\n\nignoring it = automatic loss + €15 fee.`);
            await sendSMS(env, `mira: 🚨 DISPUTE €${amt} — responde no Stripe (prazo!) dashboard.stripe.com/disputes`);
          }
        } catch (e) { /* alert only */ }
      } else if (type === "customer.subscription.deleted" && /^sub_[A-Za-z0-9]+$/.test(objId || "")) {
        try {
          const s = await stripeGet(env, `/v1/subscriptions/${objId}`);
          if (s && s.id) {
            const scid = typeof s.customer === "string" ? s.customer : s.customer && s.customer.id;
            const c = scid && await env.DB.prepare(`SELECT email, name FROM customers WHERE stripe_customer_id = ?1`).bind(scid).first();
            await sendEmail(env, "ola@miratortillas.pt", "👋 assinatura cancelada",
              `subscription cancelled / assinatura cancelada\n\n${(c && (c.name || c.email)) || objId}\n\nbake sheet updates automatically. maybe worth a friendly "sentimos a tua falta" email later (manual — never automatic).`);
          }
        } catch (e) { /* alert only */ }
      } else if (type === "invoice.payment_failed" && /^in_[A-Za-z0-9]+$/.test(objId || "")) {
        try {
          const inv = await stripeGet(env, `/v1/invoices/${objId}`);
          if (inv && inv.status !== "paid" && inv.billing_reason !== "subscription_create") {
            const amt = ((inv.amount_due || 0) / 100).toFixed(2);
            await sendEmail(env, "ola@miratortillas.pt", `⚠️ renovação falhou — €${amt}`,
              `a subscription renewal payment failed / pagamento de renovação falhou\n\n${inv.customer_email || "?"} · €${amt}\n\nStripe retries automatically for ~1 week, then pauses the subscription.\nDON'T deliver this renewal until it shows paid.\nstripe: https://dashboard.stripe.com/invoices/${inv.id}`);
            await sendSMS(env, `mira: ⚠️ renovação FALHOU €${amt} (${inv.customer_email || "?"}) — não entregar; Stripe vai repetir`);
          }
        } catch (e) { /* alert only */ }
      }
      return json({ received: true });
    }

    /* who am i + my orders + my subscriptions */
    if (url.pathname === "/api/me" && request.method === "GET") {
      const c = await currentCustomer(env, request);
      if (!c) return json({ loggedIn: false }, 200);
      const orders = await env.DB.prepare(
        `SELECT amount_total, currency, mode, points_earned, created_at
         FROM orders WHERE customer_id = ?1 ORDER BY id DESC LIMIT 200`
      ).bind(c.id).all();
      let subs = [];
      let subsError = false;
      if (c.stripe_customer_id) {
        const list = await stripeGet(env, `/v1/subscriptions?customer=${c.stripe_customer_id}&status=all&limit=10`);
        if (!list || !list.data) subsError = true; /* Stripe hiccup ≠ "no subscription" */
        if (list && list.data) {
          subs = list.data
            .filter((s) => s.status !== "incomplete_expired" && s.status !== "incomplete")
            .map((s) => {
              const items = (s.items && s.items.data) || [];
              const it = items[0];
              /* sum ALL line items (box sizes + the recurring delivery fee), not just the first */
              const amount = items.reduce((t, i) => t + ((i.price && i.price.unit_amount) || 0) * (i.quantity || 1), 0) || null;
              const plan = items.map((i) => i.price && i.price.nickname).filter(Boolean).join(" + ") || "subscription";
              /* current_period_end moved to item level in Stripe API ≥2025-03-31 */
              const periodEnd = s.current_period_end || (it && it.current_period_end);
              return {
                id: s.id,
                cancelAtEnd: !!s.cancel_at_period_end,
                paused: !!s.pause_collection,
                status: s.status,
                plan,
                amount,
                interval: it && it.price && it.price.recurring
                  ? `${it.price.recurring.interval_count > 1 ? it.price.recurring.interval_count + " " : ""}${it.price.recurring.interval}`
                  : null,
                renews: periodEnd ? new Date(periodEnd * 1000).toISOString().slice(0, 10) : null,
              };
            });
        }
      }
      return json({
        loggedIn: true,
        customer: {
          email: c.email, name: c.name, phone: c.phone, points: c.points, birthday: c.birthday,
          newsletter: c.marketing_ok === 1,
          address: { line1: c.address_line1, line2: c.address_line2, postal_code: c.postal_code, city: c.city, country: c.country },
        },
        orders: orders.results || [],
        subscriptions: subs,
        subsError,
      });
    }

    /* profile self-service: whatever the customer wants to share (all fields optional) */
    if (url.pathname === "/api/profile" && request.method === "POST") {
      const c = await currentCustomer(env, request);
      if (!c) return json({ error: "not signed in" }, 401);
      let b;
      try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const clean = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
      /* birthday is day+month only (MM-DD) — the treat never needed a year.
         Legacy YYYY-MM-DD values from the old date picker stay accepted. */
      const birthday = clean(b.birthday, 10);
      if (birthday) {
        const m = birthday.match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
        const mo = m && parseInt(m[1], 10), dy = m && parseInt(m[2], 10);
        if (!m || mo < 1 || mo > 12 || dy < 1 || dy > 31)
          return json({ error: "birthday must be MM-DD" }, 400);
      }
      /* newsletter is a customer right (GDPR): honor an explicit true/false, both directions */
      const news = b.newsletter === true ? 1 : b.newsletter === false ? 0 : null;
      await env.DB.prepare(
        `UPDATE customers SET
           name = ?1, phone = ?2, address_line1 = ?3, address_line2 = ?4,
           postal_code = ?5, city = ?6, birthday = ?7,
           marketing_ok = COALESCE(?8, marketing_ok), updated_at = datetime('now')
         WHERE id = ?9`
      ).bind(
        clean(b.name, 80), clean(b.phone, 24), clean(b.line1, 120), clean(b.line2, 120),
        clean(b.postal_code, 12), clean(b.city, 60), birthday, news, c.id
      ).run();
      return json({ ok: true });
    }

    /* Stripe billing portal — saved cards + subscription management, Stripe-hosted */
    if (url.pathname === "/api/portal" && request.method === "POST") {
      const c = await currentCustomer(env, request);
      if (!c) return json({ error: "not signed in" }, 401);
      if (!c.stripe_customer_id) return json({ error: "no payment profile yet — appears after your first order" }, 400);
      const p = new URLSearchParams();
      p.set("customer", c.stripe_customer_id);
      p.set("return_url", `${url.origin}/account#payments`);
      const sess = await stripePost(env, "/v1/billing_portal/sessions", p);
      if (!sess) return json({ error: "portal unavailable" }, 502);
      return json({ url: sess.url });
    }

    /* email login — step 1: send a 6-digit code */
    if (url.pathname === "/api/login-request" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "invalid email" }, 400);
      if (!env.BREVO_API_KEY)
        return json({ error: "email login isn't connected yet — your account signs in automatically after any order" }, 503);
      /* throttle: one code per email/minute AND per-IP burst AND a global daily
         ceiling — stops flooding arbitrary inboxes + draining Brevo credits */
      const recent = await env.DB.prepare(
        `SELECT 1 AS hit FROM login_codes WHERE email = ?1 AND created_at > datetime('now', '-60 seconds')`
      ).bind(email).first();
      if (recent) return json({ error: "code already sent — wait a minute before requesting another" }, 429);
      const ip = request.headers.get("CF-Connecting-IP") || "?";
      const ipHits = await env.DB.prepare(
        `SELECT COUNT(*) n FROM login_codes WHERE ip = ?1 AND created_at > datetime('now', '-1 hour')`
      ).bind(ip).first().catch(() => ({ n: 0 }));
      if ((ipHits.n || 0) >= 8) return json({ error: "too many requests — try again later" }, 429);
      const dayHits = await env.DB.prepare(
        `SELECT COUNT(*) n FROM login_codes WHERE created_at > datetime('now', '-1 day')`
      ).first().catch(() => ({ n: 0 }));
      if ((dayHits.n || 0) >= 500) return json({ error: "login temporarily unavailable — try again later" }, 429);
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
      await env.DB.prepare(
        `INSERT INTO login_codes (email, code, attempts, ip, expires_at)
         VALUES (?1, ?2, 0, ?3, datetime('now', '+30 minutes'))
         ON CONFLICT(email) DO UPDATE SET code = excluded.code, attempts = 0,
           ip = excluded.ip, expires_at = excluded.expires_at, created_at = datetime('now')`
      ).bind(email, code, ip).run();
      const sent = await sendEmail(env, email, "your mira login code",
        `your login code: ${code}\n\nit's valid for 30 minutes, no rush.\n\no teu código de acesso: ${code} (válido por 30 minutos, sem pressa)\n\n— mira tortillas`);
      if (!sent) return json({ error: "couldn't send the email — try again in a minute" }, 502);
      return json({ ok: true });
    }

    /* email login — step 2: verify the code, open a session */
    if (url.pathname === "/api/login-verify" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      const code = String(body.code || "").trim();
      const row = await env.DB.prepare(
        `SELECT * FROM login_codes WHERE email = ?1 AND expires_at > datetime('now')`
      ).bind(email).first();
      if (!row) return json({ error: "code expired, request a new one · código expirado, pede outro" }, 400);
      if (row.attempts >= 5) return json({ error: "too many tries, request a new code · demasiadas tentativas, pede um novo" }, 400);
      if (row.code !== code) {
        await env.DB.prepare(`UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?1`).bind(email).run();
        const left = 5 - (row.attempts + 1);
        return json({ error: left > 0 ? `wrong code (${left} left) · código errado (restam ${left})` : "too many tries, request a new code · demasiadas tentativas, pede um novo" }, 400);
      }
      await env.DB.prepare(`DELETE FROM login_codes WHERE email = ?1`).bind(email).run();
      const created = await env.DB.prepare(`INSERT OR IGNORE INTO customers (email) VALUES (?1)`).bind(email).run();
      const customer = await env.DB.prepare(`SELECT * FROM customers WHERE email = ?1`).bind(email).first();
      /* mailing-list opt-in ticked on the sign-in form (only ever upgrades to yes) */
      if (body.newsletter === true) {
        await env.DB.prepare(`UPDATE customers SET marketing_ok = 1 WHERE id = ?1`).bind(customer.id).run();
      }
      /* owner heads-up on brand-new profiles (never blocks the login) */
      if (created.meta.changes > 0) {
        try {
          const n = await env.DB.prepare(`SELECT COUNT(*) n FROM customers`).first();
          await sendEmail(env, "ola@miratortillas.pt", `🌯 new tortilla lover — ${email}`,
            `new account on miratortillas.pt\n\n${email}${body.newsletter === true ? "\njoined the mailing list ✓" : ""}\n\ncustomers total: ${n.n}\ndashboard: https://miratortillas.pt/admin`);
        } catch (e) { /* notification failure must never block login */ }
      }
      const cookie = await createSession(env, customer.id, 1); /* code-verified = trusted */
      return json({ ok: true }, 200, { "Set-Cookie": cookie });
    }

    /* manage own subscription: cancel at period end / keep / pause / resume */
    if (url.pathname === "/api/sub-action" && request.method === "POST") {
      const c = await currentCustomer(env, request);
      if (!c || !c.stripe_customer_id) return json({ error: "not signed in" }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const id = String(body.id || "");
      const action = String(body.action || "");
      if (!/^sub_[A-Za-z0-9]+$/.test(id)) return json({ error: "bad id" }, 400);
      const sub = await stripeGet(env, `/v1/subscriptions/${id}`);
      if (!sub || sub.customer !== c.stripe_customer_id) return json({ error: "not yours" }, 403);
      const p = new URLSearchParams();
      if (action === "cancel") p.set("cancel_at_period_end", "true");
      else if (action === "keep") p.set("cancel_at_period_end", "false");
      else if (action === "pause") p.set("pause_collection[behavior]", "void");
      else if (action === "resume") p.set("pause_collection", "");
      else return json({ error: "bad action" }, 400);
      const updated = await stripePost(env, `/v1/subscriptions/${id}`, p);
      if (!updated) return json({ error: "stripe error" }, 502);
      return json({ ok: true });
    }

    /* public shop status: open/paused + remaining stock per size */
    if (url.pathname === "/api/status") {
      const s = await getSettings(env);
      return json({
        open: s.open,
        remaining: {
          small: Math.max(s.caps.small - s.sold.small, 0),
          medium: Math.max(s.caps.medium - s.sold.medium, 0),
          large: Math.max(s.caps.large - s.sold.large, 0),
        },
      });
    }

    /* owner: send yourself a test SMS (admin-only, POST so it can't fire from a GET/link) */
    if (url.pathname === "/api/admin/test-sms" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized — sign in at /account first" }, 401);
      if (!env.OWNER_PHONE) return json({ error: "OWNER_PHONE var not set in Cloudflare yet" }, 400);
      const ok = await sendSMS(env, "mira: SMS test OK — order alerts armed 🌯");
      return json({ sent: ok, to: env.OWNER_PHONE, hint: ok ? "check your phone!" : "check Brevo SMS credits" });
    }

    /* owner dashboard API — requires email-code login as an ADMIN_EMAILS address */
    if (url.pathname === "/api/admin/state") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      return json(await getSettings(env));
    }
    /* owner: sales + customer stats for the dashboard */
    if (url.pathname === "/api/admin/stats") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      const allTime = await env.DB.prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(amount_total - COALESCE(refunded_cents,0)),0) cents FROM orders`).first();
      const week = await env.DB.prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(amount_total - COALESCE(refunded_cents,0)),0) cents FROM orders WHERE created_at >= datetime('now','-7 days')`).first();
      const prevWeek = await env.DB.prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(amount_total - COALESCE(refunded_cents,0)),0) cents FROM orders
         WHERE created_at >= datetime('now','-14 days') AND created_at < datetime('now','-7 days')`).first();
      const today = await env.DB.prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(amount_total - COALESCE(refunded_cents,0)),0) cents FROM orders WHERE date(created_at) = date('now')`).first();
      const daily = (await env.DB.prepare(
        `SELECT date(created_at) d, COUNT(*) n, COALESCE(SUM(amount_total - COALESCE(refunded_cents,0)),0) cents FROM orders
         WHERE date(created_at) >= date('now','-13 days') GROUP BY date(created_at)`).all()).results || [];
      const customers = await env.DB.prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(marketing_ok),0) newsletter FROM customers`).first();
      const newCustomers = await env.DB.prepare(
        `SELECT COUNT(*) n FROM customers WHERE created_at >= datetime('now','-7 days')`).first();
      /* packs sold by size, last 30 days (from order items JSON) */
      const itemRows = (await env.DB.prepare(
        `SELECT items FROM orders WHERE created_at >= datetime('now','-30 days') AND items IS NOT NULL`).all()).results || [];
      const bySize = { small: 0, medium: 0, large: 0 };
      for (const r of itemRows) {
        try {
          for (const it of JSON.parse(r.items)) {
            const s = it.sku || (/pequen|small/i.test(it.d || "") ? "small"
              : /m[eé]di|medium/i.test(it.d || "") ? "medium"
              : /grand|large/i.test(it.d || "") ? "large" : null);
            if (s && bySize[s] !== undefined) bySize[s] += it.q || 1;
          }
        } catch (e) { /* ignore malformed rows */ }
      }
      const recent = (await env.DB.prepare(
        `SELECT o.created_at, o.amount_total, o.mode, o.points_earned, o.items, c.email, c.name, c.city
         FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id DESC LIMIT 15`).all()).results || [];
      return json({ allTime, week, prevWeek, today, daily, customers, newCustomers, bySize, recent });
    }

    /* owner: orders to fulfill — the pack/deliver list, newest first, with address + status */
    if (url.pathname === "/api/admin/orders") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      const rows = (await env.DB.prepare(
        `SELECT o.id, o.created_at, o.amount_total, o.mode, o.items, o.status, o.refunded_cents,
                o.ship_name, o.ship_phone, o.ship_line1, o.ship_line2, o.ship_postal, o.ship_city, o.ship_method,
                c.email, c.name AS cust_name, c.city AS cust_city
         FROM orders o JOIN customers c ON c.id = o.customer_id
         ORDER BY o.id DESC LIMIT 60`).all()).results || [];
      return json({ orders: rows });
    }

    if (url.pathname === "/api/admin/order-status" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const st = ["new", "packed", "delivered"].includes(b.status) ? b.status : null;
      if (!st || !Number.isInteger(b.id)) return json({ error: "bad params" }, 400);
      await env.DB.prepare(`UPDATE orders SET status = ?1 WHERE id = ?2`).bind(st, b.id).run();
      return json({ ok: true });
    }

    /* owner: one-click full refund from the dashboard. Money goes back via Stripe;
       the charge.refunded webhook then fixes revenue + claws back points. */
    if (url.pathname === "/api/admin/refund" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      if (!Number.isInteger(b.id)) return json({ error: "bad params" }, 400);
      const o = await env.DB.prepare(
        `SELECT id, customer_id, stripe_session_id, amount_total, refunded_cents FROM orders WHERE id = ?1`
      ).bind(b.id).first();
      if (!o) return json({ error: "order not found" }, 404);
      if ((o.refunded_cents || 0) >= o.amount_total) return json({ error: "already refunded" }, 409);
      /* find the payment behind this order (checkout session or renewal invoice) */
      let pi = null;
      if (/^cs_/.test(o.stripe_session_id)) {
        const s = await stripeGet(env, `/v1/checkout/sessions/${o.stripe_session_id}`);
        pi = s && (typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent && s.payment_intent.id);
      } else if (/^in_/.test(o.stripe_session_id)) {
        const inv = await stripeGet(env, `/v1/invoices/${o.stripe_session_id}`);
        pi = inv && (typeof inv.payment_intent === "string" ? inv.payment_intent : inv.payment_intent && inv.payment_intent.id);
      }
      if (!pi) return json({ error: "couldn't find the payment in Stripe — refund it at dashboard.stripe.com/payments" }, 502);
      const res = await fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ payment_intent: pi }),
      });
      const refund = await res.json();
      if (!res.ok) return json({ error: refund.error?.message || "stripe refused the refund" }, 502);
      /* mark immediately so the dashboard reflects it even before the webhook lands
         (the webhook then sees nothing new and won't double-process) */
      await env.DB.prepare(
        `UPDATE orders SET refunded_cents = amount_total, status = 'refunded' WHERE id = ?1`
      ).bind(o.id).run();
      const clawback = Math.floor((o.amount_total - (o.refunded_cents || 0)) / 100);
      if (clawback > 0)
        await env.DB.prepare(`UPDATE customers SET points = MAX(points - ?1, 0) WHERE id = ?2`).bind(clawback, o.customer_id).run();
      return json({ ok: true, refunded: o.amount_total });
    }

    /* owner: this week's bake sheet — active Stripe subscriptions grouped by size */
    if (url.pathname === "/api/admin/subs") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      const list = await stripeGet(env, "/v1/subscriptions?status=active&limit=100&expand[]=data.items");
      if (!list) return json({ error: "stripe error" }, 502);
      const tally = { small: 0, medium: 0, large: 0 };
      const subs = (list.data || []).map((s) => {
        const items = (s.items && s.items.data) || [];
        const sizes = [];
        for (const it of items) {
          const sku = PRICE_SKU[(it.price && it.price.id) || ""];
          if (sku && tally[sku] !== undefined) { tally[sku] += it.quantity || 1; sizes.push(`${it.quantity || 1}×${sku[0].toUpperCase()}`); }
        }
        const first = items[0];
        return {
          id: s.id, sizes: sizes.join(" "),
          interval: first && first.price && first.price.recurring ? first.price.recurring.interval : "?",
          renews: (s.current_period_end || (first && first.current_period_end))
            ? new Date((s.current_period_end || first.current_period_end) * 1000).toISOString().slice(0, 10) : null,
          paused: !!s.pause_collection, cancelAtEnd: !!s.cancel_at_period_end,
        };
      });
      return json({ subs, tally, count: subs.length });
    }

    /* owner: visitor analytics pulled from Cloudflare Web Analytics (GraphQL) */
    if (url.pathname === "/api/admin/visitors") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      if (!env.CF_ANALYTICS_TOKEN || !env.CF_SITE_TAG) return json({ error: "analytics not configured" }, 500);
      const now = new Date();
      const iso = (d) => d.toISOString().slice(0, 19) + "Z";
      const ago = (days) => new Date(now.getTime() - days * 86400000);
      const q = `query {
        viewer { accounts(filter: {accountTag: "77f21a888cac91e9fdbbf4d84bd068b1"}) {
          daily: rumPageloadEventsAdaptiveGroups(filter: {siteTag: "${env.CF_SITE_TAG}", datetime_geq: "${iso(ago(14))}", datetime_leq: "${iso(now)}"}, limit: 20, orderBy: [date_ASC]) {
            count sum { visits } dimensions { date }
          }
          countries: rumPageloadEventsAdaptiveGroups(filter: {siteTag: "${env.CF_SITE_TAG}", datetime_geq: "${iso(ago(7))}", datetime_leq: "${iso(now)}"}, limit: 6, orderBy: [sum_visits_DESC]) {
            sum { visits } dimensions { countryName }
          }
          devices: rumPageloadEventsAdaptiveGroups(filter: {siteTag: "${env.CF_SITE_TAG}", datetime_geq: "${iso(ago(7))}", datetime_leq: "${iso(now)}"}, limit: 5) {
            sum { visits } dimensions { deviceType }
          }
        } }
      }`;
      const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      const acct = data && data.data && data.data.viewer.accounts[0];
      if (!acct) return json({ error: "analytics query failed" }, 502);
      return json({
        daily: (acct.daily || []).map((r) => ({ date: r.dimensions.date, visits: r.sum.visits, views: r.count })),
        countries: (acct.countries || []).map((r) => ({ country: r.dimensions.countryName, visits: r.sum.visits })),
        devices: (acct.devices || []).map((r) => ({ device: r.dimensions.deviceType, visits: r.sum.visits })),
      });
    }

    /* owner: the customer book — who they are, what they've spent, who's on the list */
    if (url.pathname === "/api/admin/customers") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      const rows = (await env.DB.prepare(
        `SELECT c.id, c.email, c.name, c.phone, c.address_line1, c.postal_code, c.city,
                c.points, c.marketing_ok, c.wholesale, c.company, c.created_at,
                COUNT(o.id) orders, COALESCE(SUM(o.amount_total - COALESCE(o.refunded_cents,0)), 0) cents
         FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
         GROUP BY c.id ORDER BY c.id DESC LIMIT 5000`).all()).results || [];
      return json({ customers: rows });
    }

    /* owner: promo codes managed from /admin (Stripe coupons + promotion codes under the hood) */
    if (url.pathname === "/api/admin/promos") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      /* API ≥2025-09-30: coupon lives under promotion.coupon; older versions: top-level coupon */
      let list = await stripeGet(env, "/v1/promotion_codes?limit=20&expand[]=data.promotion.coupon");
      if (!list) list = await stripeGet(env, "/v1/promotion_codes?limit=20&expand[]=data.coupon");
      if (!list) return json({ error: "stripe error" }, 502);
      const couponOf = (p) => {
        const c = (p.promotion && p.promotion.coupon) || p.coupon;
        return c && typeof c === "object" ? c : null;
      };
      return json({ promos: list.data
        .filter((p) => { const c = couponOf(p); return c && !c.deleted && c.valid !== false; })
        .map((p) => { const c = couponOf(p); return {
          id: p.id, code: p.code, active: p.active, couponId: c.id,
          off: c.percent_off ? c.percent_off + "%" : "€" + (c.amount_off / 100),
          used: p.times_redeemed, max: p.max_redemptions || null,
          expires: p.expires_at ? new Date(p.expires_at * 1000).toISOString().slice(0, 10) : null,
        }; }) });
    }

    if (url.pathname === "/api/admin/promo-create" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
      if (code.length < 3) return json({ error: "code needs 3+ letters/numbers" }, 400);
      const cp = new URLSearchParams();
      cp.set("duration", "once"); /* subscriptions: discount applies to first delivery only */
      cp.set("name", code);
      if (b.percentOff) {
        const p = Number(b.percentOff);
        if (!(p > 0 && p <= 100)) return json({ error: "percent must be 1-100" }, 400);
        cp.set("percent_off", String(p));
      } else if (b.amountOff) {
        const a = Math.round(Number(b.amountOff) * 100);
        if (!(a > 0 && a <= 50000)) return json({ error: "€ amount looks wrong" }, 400);
        cp.set("amount_off", String(a));
        cp.set("currency", "eur");
      } else return json({ error: "set a % or € discount" }, 400);
      const coupon = await stripePostRaw(env, "/v1/coupons", cp);
      if (!coupon.ok) return json({ error: "coupon: " + coupon.err }, 502);
      const pcParams = (newShape) => {
        const pc = new URLSearchParams();
        if (newShape) { /* API ≥2025-09-30 (clover): polymorphic promotion field */
          pc.set("promotion[type]", "coupon");
          pc.set("promotion[coupon]", coupon.data.id);
        } else {
          pc.set("coupon", coupon.data.id);
        }
        pc.set("code", code);
        const maxUses = parseInt(b.maxUses, 10);
        if (maxUses > 0) pc.set("max_redemptions", String(maxUses));
        const expDays = parseInt(b.expiresDays, 10);
        if (expDays > 0) pc.set("expires_at", String(Math.floor(Date.now() / 1000) + expDays * 86400));
        return pc;
      };
      let promo = await stripePostRaw(env, "/v1/promotion_codes", pcParams(true));
      if (!promo.ok && /unknown parameter: promotion/i.test(promo.err || "")) {
        promo = await stripePostRaw(env, "/v1/promotion_codes", pcParams(false));
      }
      if (!promo.ok) return json({ error: "code: " + promo.err }, 502);
      return json({ ok: true, code: promo.data.code });
    }

    if (url.pathname === "/api/admin/promo-toggle" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const p = new URLSearchParams();
      p.set("active", b.active ? "true" : "false");
      const r = await stripePost(env, `/v1/promotion_codes/${encodeURIComponent(String(b.id || ""))}`, p);
      if (!r) return json({ error: "stripe error" }, 502);
      return json({ ok: true, active: r.active });
    }

    /* delete = deactivate the code + delete its coupon (Stripe can't hard-delete promo codes) */
    if (url.pathname === "/api/admin/promo-delete" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const off = new URLSearchParams();
      off.set("active", "false");
      await stripePost(env, `/v1/promotion_codes/${encodeURIComponent(String(b.id || ""))}`, off);
      const res = await fetch(`https://api.stripe.com/v1/coupons/${encodeURIComponent(String(b.couponId || ""))}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      });
      if (!res.ok) return json({ error: "couldn't delete the coupon" }, 502);
      return json({ ok: true });
    }

    /* owner: raw-materials & packaging inventory (flour/salt/oil/labels/bags/tape) */
    if (url.pathname === "/api/admin/inventory") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      const rows = (await env.DB.prepare(`SELECT * FROM inventory ORDER BY id`).all()).results || [];
      return json({ items: rows });
    }

    if (url.pathname === "/api/admin/inventory-save" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const items = Array.isArray(b.items) ? b.items.slice(0, 50) : [];
      for (const it of items) {
        const name = String(it.name || "").trim().slice(0, 60);
        if (!name) continue;
        const qty = Number(it.qty) || 0, low = Number(it.low_at) || 0, cost = Number(it.cost) || 0;
        const unit = String(it.unit || "").slice(0, 12), sup = String(it.supplier || "").slice(0, 80);
        if (it.id) {
          await env.DB.prepare(
            `UPDATE inventory SET name=?1, unit=?2, qty=?3, low_at=?4, supplier=?5, cost=?6, updated_at=datetime('now') WHERE id=?7`
          ).bind(name, unit, qty, low, sup, cost, it.id).run();
        } else {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO inventory (name, unit, qty, low_at, supplier, cost) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
          ).bind(name, unit, qty, low, sup, cost).run();
        }
      }
      return json({ ok: true });
    }

    if (url.pathname === "/api/admin/inventory-delete" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      await env.DB.prepare(`DELETE FROM inventory WHERE id = ?1`).bind(Number(b.id) || 0).run();
      return json({ ok: true });
    }

    if (url.pathname === "/api/admin/update" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b;
      try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const up = (k, v) => env.DB.prepare(`INSERT OR REPLACE INTO settings (k, v) VALUES (?1, ?2)`).bind(k, String(v)).run();
      if (typeof b.open === "boolean") await up("store_open", b.open ? "1" : "0");
      for (const sku of ["small", "medium", "large"]) {
        if (b.caps && Number.isInteger(b.caps[sku]) && b.caps[sku] >= 0 && b.caps[sku] <= 9999) await up("cap_" + sku, b.caps[sku]);
        if (b.resetSold === true) await up("sold_" + sku, "0");
      }
      return json(await getSettings(env));
    }

    /* newsletter opt-in — used by the post-checkout confirmation (signed-in only) */
    /* email-order mode (store paused, no live Stripe): the cart posts the order + the
       customer's name & phone straight here, so it works with no mail app. We store it
       in D1 (durable — the order survives even if the email doesn't) and ping the owner. */
    if (url.pathname === "/api/order-request" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const ip = request.headers.get("CF-Connecting-IP") || "";
      const lang = body.lang === "pt" ? "pt" : "en";
      const tooMany = lang === "pt" ? "demasiados pedidos, tenta daqui a pouco" : "too many requests, try again shortly";

      /* honeypot: a hidden field real users never see. Bots fill it → fake a 200 so
         they don't retry, but store & notify nothing. */
      if (String(body.hp || "").trim() !== "") return json({ ok: true });

      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > 10) return json({ error: "bad cart" }, 400);
      const name = String(body.name || "").trim().slice(0, 80);
      const email = String(body.email || "").trim().slice(0, 120).toLowerCase();
      const phone = String(body.phone || "").trim().slice(0, 40);
      const address = String(body.address || "").trim().slice(0, 300); /* optional — for future delivery */
      const note = String(body.note || "").trim().slice(0, 500);
      if (name.length < 2) return json({ error: lang === "pt" ? "falta o nome" : "name required" }, 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: lang === "pt" ? "email inválido" : "valid email required" }, 400);
      /* phone is optional (email is the required contact) — but if given, it must be real */
      if (phone && phone.replace(/[^0-9]/g, "").length < 6) return json({ error: lang === "pt" ? "telemóvel inválido" : "invalid phone" }, 400);

      let total = 0;
      const lines = [];
      for (const it of items) {
        const known = PRICES[it.price];
        const qty = Number(it.quantity);
        if (!known || known.mode !== "payment" || !Number.isInteger(qty) || qty < 1 || qty > 20)
          return json({ error: "bad item" }, 400);
        total += known.amount * qty;
        lines.push(`${qty}× ${PRICE_SKU[it.price]} · €${(known.amount * qty) / 100}`);
      }

      /* Cloudflare Turnstile — INERT until TURNSTILE_SECRET is set. Once it is, the
         form must send a valid token in body.ts; this stops scripted/bot spam cold. */
      if (env.TURNSTILE_SECRET) {
        let human = false;
        const tok = String(body.ts || "");
        if (tok) {
          try {
            const fd = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: tok });
            if (ip) fd.set("remoteip", ip);
            const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd });
            human = !!(await vr.json()).success;
          } catch {}
        }
        if (!human) return json({ error: lang === "pt" ? "verificação falhou, recarrega a página" : "verification failed, please reload" }, 403);
      }

      /* rate limits, all read off the order_requests log:
         · per IP   — 5 / 10 min
         · per phone — 4 / hour (one number can't hammer it)
         · site-wide — 100 / day (hard backstop so nothing runs up the SMS/email bill) */
      try {
        const ipN = (await env.DB.prepare(`SELECT COUNT(*) n FROM order_requests WHERE ip = ?1 AND created_at >= datetime('now','-10 minutes')`).bind(ip).first())?.n || 0;
        if (ipN >= 5) return json({ error: tooMany }, 429);
        const emN = (await env.DB.prepare(`SELECT COUNT(*) n FROM order_requests WHERE email = ?1 AND created_at >= datetime('now','-60 minutes')`).bind(email).first())?.n || 0;
        if (emN >= 4) return json({ error: tooMany }, 429);
        if (phone) {
          const phN = (await env.DB.prepare(`SELECT COUNT(*) n FROM order_requests WHERE phone = ?1 AND created_at >= datetime('now','-60 minutes')`).bind(phone).first())?.n || 0;
          if (phN >= 4) return json({ error: tooMany }, 429);
        }
        const dayN = (await env.DB.prepare(`SELECT COUNT(*) n FROM order_requests WHERE created_at >= datetime('now','-24 hours')`).first())?.n || 0;
        if (dayN >= 100) return json({ error: lang === "pt" ? "estamos cheios hoje — escreve-nos a ola@miratortillas.pt" : "we're full today — email us at ola@miratortillas.pt" }, 429);
      } catch {}

      try {
        await env.DB.prepare(
          `INSERT INTO order_requests (name, email, phone, address, note, items, total_cents, lang, ip) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
        ).bind(name, email, phone, address, note, JSON.stringify(items), total, lang, ip).run();
      } catch {}

      /* email only — NO SMS here on purpose (email-order mode, paused store: this is a
         record, never urgent; saves SMS credits and can't be weaponised into a text flood) */
      const eur = (c) => "€" + (c / 100).toFixed(2).replace(".00", "");
      await sendEmail(env, env.MAIL_FROM || "ola@miratortillas.pt",
        `🌯 new order request — ${name} · ${eur(total)}`,
        `New order request from the website (email-order mode).\n\n` +
        lines.map((l) => "· " + l).join("\n") +
        `\n\ntotal: ${eur(total)}\n\nname: ${name}\nemail: ${email}` +
        (phone ? `\nphone: ${phone}` : "") +
        (address ? `\naddress: ${address}` : "") +
        (note ? `\nnote: ${note}` : "") +
        `\n\nReply to confirm the Graça pickup.`);
      return json({ ok: true });
    }

    if (url.pathname === "/api/newsletter-optin" && request.method === "POST") {
      const c = await currentCustomer(env, request);
      if (!c) return json({ error: "not signed in" }, 401);
      await env.DB.prepare(`UPDATE customers SET marketing_ok = 1 WHERE id = ?1`).bind(c.id).run();
      return json({ ok: true });
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      const token = getCookie(request, "mira_session");
      if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?1`).bind(token).run();
      return json({ ok: true }, 200, {
        "Set-Cookie": "mira_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      });
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);

    /* run_worker_first is on (for the canonical-host 301s) — everything else is a static asset.
       Add baseline security headers; deny framing on the owner-only pages (clickjacking). */
    const assetRes = await env.ASSETS.fetch(request);
    const res = new Response(assetRes.body, assetRes);
    res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    if (/^\/(admin|account|inventory)\b/.test(url.pathname)) {
      res.headers.set("X-Frame-Options", "DENY");
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
      res.headers.set("Cache-Control", "no-store");
    }
    return res;
  },
};
