/* mira tortillas — interactions */
(function () {
  "use strict";

  /* ─────────────────────────────────────────────
     STRIPE PAYMENT LINKS — paste yours here.
     Create them at dashboard.stripe.com → Payment Links
     (one per product). Until a link is filled in, the
     buy buttons fall back to an order email.
  ───────────────────────────────────────────── */
  const STRIPE_LINKS = {
    small: "https://buy.stripe.com/6oUbIU5ve5G9fpH4sF6J200",   // 12 small — €8
    medium: "https://buy.stripe.com/3cIbIU8Hq1pT3GZf7j6J201",  // 12 medium — €10
    large: "https://buy.stripe.com/7sYdR24rab0tb9r5wJ6J202",   // 6 large — €9
  };

  /* ─────────────────────────────────────────────
     UPCOMING EVENTS — edit this list, that's it.
     date: "YYYY-MM-DD" (past dates hide themselves)
     name: { en: "...", pt: "..." }
     place: shown as-is · url: optional "more info" link
     Example:
       { date: "2026-07-19", name: { en: "saturday market", pt: "mercado de sábado" },
         place: "campo de ourique · lisboa", url: "" },
  ───────────────────────────────────────────── */
  const EVENTS = [
  ];

  /* ───────── i18n ───────── */
  const I18N = {
    en: {
      nav_ing: "ingredients",
      nav_heat: "how-to",
      nav_sizes: "sizes",
      nav_order: "order",
      hero_blurb: "Flour tortillas — four ingredients, pressed &amp; par-cooked in small batches in Lisboa.<br>You give them the final toast at home.",
      hero_cta: "grab a pack",
      nav_sub: "subscribe",
      sub_kicker: "02 — subscriptions",
      sub_title: "never run out.",
      sub_sub: "Pick a size, pick a rhythm — tortillas on repeat. Pause or cancel anytime.",
      sub_weekly: "weekly",
      sub_biweekly: "every 2 weeks",
      sub_monthly: "monthly",
      sub_note: "manage, pause or cancel anytime — no strings attached.",
      ing_kicker: "03 — the recipe",
      ing_title: "only four<br>ingredients.",
      ing_note: "The whole label, start to finish. Mixed, rolled and pressed in small batches in Lisboa.",
      heat_kicker: "04 — fire it up",
      heat_title: "par-cooked by us.<br>finished by you.",
      heat_sub: "Every mira tortilla leaves our kitchen 90% done. The last 40 seconds happen in your pan — that final toast is what makes them taste fresh-made.",
      step1_h: "dry pan, high heat",
      step1_p: "Pan, griddle or grill — no oil. Get it properly hot, about 15–20 seconds per side.",
      step2_h: "see bubbles? flip it",
      step2_p: "When tiny bubbles start forming, flip to the other side.",
      step3_h: "15–20 more — it puffs up",
      step3_p: "Ready to eat! Stack them in a clean cloth so they stay warm and soft.",
      heat_store: "keep refrigerated · 7 days&nbsp;&nbsp;/&nbsp;&nbsp;or freeze · 3 months",
      sub_meta_s: "12 tortillas · €8 per delivery",
      sub_meta_m: "12 tortillas · €10 per delivery",
      sub_meta_l: "6 tortillas · €9 per delivery",
      nav_events: "find us",
      nav_account: "account",
      ev_kicker: "05 — find us",
      ev_title: "upcoming<br>drops &amp; markets.",
      ev_empty: "nothing on the calendar right now — follow @miratortillas for the next drop.",
      sizes_kicker: "01 — pick your size",
      sizes_title: "one dough.<br>three sizes.",
      sizes_sub: "Taco night, burrito Sunday or snack-size quesadillas — there's a stack for that.",
      s_name: "small", s_desc: "15&nbsp;cm — tacos &amp; snacks.", s_btn: "add to cart +",
      m_name: "medium", m_desc: "21–23&nbsp;cm — wraps &amp; quesadillas.", m_btn: "add to cart +",
      l_name: "large", l_desc: "30&nbsp;cm — burritos.", l_btn: "add to cart +",
      marquee: "flour <i>·</i> water <i>·</i> avocado oil <i>·</i> salt <i>·</i>&nbsp;",
      pay_note: "secure checkout by stripe — card · apple pay · google pay · mb way / multibanco",
      foot_kicker: "hungry? / fome?",
      foot_cta: "order<br>a stack",
      foot_made: "made in lisboa 🇵🇹",
      foot_contact: "questions? cafés &amp; restaurants? say olá —",
      cart_title: "your stack",
      cart_empty: "nothing here yet.",
      cart_total: "total",
      cart_checkout: "checkout",
      cart_back: "back to site",
      cart_usepoints: "use 100 points — €8 off",
      cart_news: "email me about drops & news",
      cart_clear: "clear",
      sub_size: "your box",
      sub_rhythm: "rhythm",
      sc_note: "secure checkout · stripe",
      ship_note: "lisboa: free local delivery &nbsp;·&nbsp; mainland portugal: ctt 24h — €7 from 3 packs, free over €40",
      scene_start: "dry pan · no oil",
      scene_side1: "side 1 · 15–20s",
      scene_flip: "tiny bubbles? flip!",
      scene_side2: "side 2 · 15–20s",
      scene_done: "puffed up — ready to eat!",
      doc_title: "mira tortillas — flour tortillas, Lisboa",
    },
    pt: {
      nav_ing: "ingredientes",
      nav_heat: "como aquecer",
      nav_sizes: "tamanhos",
      nav_order: "encomendar",
      hero_blurb: "Tortillas de trigo — quatro ingredientes, prensadas e meio cozidas em pequenos lotes em Lisboa.<br>Tu dás-lhes a tostadela final em casa.",
      hero_cta: "leva um pack",
      nav_sub: "assinar",
      sub_kicker: "02 — assinaturas",
      sub_title: "nunca fiques sem.",
      sub_sub: "Escolhe o tamanho, escolhe o ritmo — tortillas em repetição. Pausa ou cancela quando quiseres.",
      sub_weekly: "semanal",
      sub_biweekly: "quinzenal",
      sub_monthly: "mensal",
      sub_note: "gere, pausa ou cancela quando quiseres — sem compromissos.",
      ing_kicker: "03 — a receita",
      ing_title: "só quatro<br>ingredientes.",
      ing_note: "O rótulo inteiro, do início ao fim. Misturadas, tendidas e prensadas em pequenos lotes em Lisboa.",
      heat_kicker: "04 — ao lume",
      heat_title: "meio cozidas por nós.<br>acabadas por ti.",
      heat_sub: "Cada tortilha mira sai da nossa cozinha 90% pronta. Os últimos 40 segundos acontecem na tua frigideira — é essa tostadela final que lhes dá o sabor de acabadas de fazer.",
      step1_h: "frigideira seca, lume forte",
      step1_p: "Frigideira, chapa ou grelha — sem óleo. Deixa aquecer bem, cerca de 15–20 segundos por lado.",
      step2_h: "vês bolhas? vira",
      step2_p: "Quando se formarem pequenas bolhas, vira para o outro lado.",
      step3_h: "mais 15–20 — e incha",
      step3_p: "Prontas a comer! Empilha-as num pano limpo para ficarem quentes e macias.",
      heat_store: "conservar no frigorífico · 7 dias&nbsp;&nbsp;/&nbsp;&nbsp;ou congelar · 3 meses",
      sub_meta_s: "12 tortillas · €8 por entrega",
      sub_meta_m: "12 tortillas · €10 por entrega",
      sub_meta_l: "6 tortillas · €9 por entrega",
      nav_events: "onde estamos",
      nav_account: "conta",
      ev_kicker: "05 — onde estamos",
      ev_title: "próximos<br>drops &amp; mercados.",
      ev_empty: "nada agendado de momento — segue @miratortillas para o próximo drop.",
      sizes_kicker: "01 — escolhe o tamanho",
      sizes_title: "uma massa.<br>três tamanhos.",
      sizes_sub: "Noite de tacos, burrito ao domingo ou quesadillas para o lanche — há uma pilha para isso.",
      s_name: "pequenas", s_desc: "15&nbsp;cm — tacos e snacks.", s_btn: "adicionar +",
      m_name: "médias", m_desc: "21–23&nbsp;cm — wraps e quesadillas.", m_btn: "adicionar +",
      l_name: "grandes", l_desc: "30&nbsp;cm — burritos.", l_btn: "adicionar +",
      marquee: "farinha <i>·</i> água <i>·</i> óleo de abacate <i>·</i> sal <i>·</i>&nbsp;",
      pay_note: "pagamento seguro com stripe — cartão · apple pay · google pay · mb way / multibanco",
      foot_kicker: "fome? / hungry?",
      foot_cta: "encomenda<br>uma pilha",
      foot_made: "feito em lisboa 🇵🇹",
      foot_contact: "dúvidas? cafés &amp; restaurantes? diz olá —",
      cart_title: "a tua pilha",
      cart_empty: "ainda nada aqui.",
      cart_total: "total",
      cart_checkout: "finalizar",
      cart_back: "voltar ao site",
      cart_usepoints: "usar 100 pontos — €8 de desconto",
      cart_news: "quero receber novidades por email",
      cart_clear: "limpar",
      sub_size: "a tua caixa",
      sub_rhythm: "ritmo",
      sc_note: "pagamento seguro · stripe",
      ship_note: "lisboa: entrega local grátis &nbsp;·&nbsp; portugal continental: ctt 24h — €7 a partir de 3 packs, grátis acima de €40",
      scene_start: "frigideira seca · sem óleo",
      scene_side1: "lado 1 · 15–20s",
      scene_flip: "bolhas? vira!",
      scene_side2: "lado 2 · 15–20s",
      scene_done: "estufada — pronta a comer!",
      doc_title: "mira tortillas — tortillas de trigo, Lisboa",
    },
  };

  let lang = (function () {
    /* saved choice wins; first-time visitors get their browser's language (PT for Portugal) */
    try {
      const saved = localStorage.getItem("mira-lang");
      if (saved === "pt" || saved === "en") return saved;
      return (navigator.language || "").toLowerCase().startsWith("pt") ? "pt" : "en";
    }
    catch (e) { return "en"; }
  })();

  const langBtn = document.getElementById("langToggle");

  /* render the upcoming-events list (past dates auto-hide) */
  const EV_MONTHS = {
    en: ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"],
    pt: ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"],
  };
  const EV_DAYS = {
    en: ["sun","mon","tue","wed","thu","fri","sat"],
    pt: ["dom","seg","ter","qua","qui","sex","sáb"],
  };
  function renderEvents(l) {
    const list = document.getElementById("eventsList");
    const empty = document.getElementById("eventsEmpty");
    if (!list || !empty) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = EVENTS
      .map((ev) => {
        const [y, m, d] = ev.date.split("-").map(Number);
        return { ev, when: new Date(y, m - 1, d) };
      })
      .filter((x) => x.when >= today)
      .sort((a, b) => a.when - b.when);
    list.innerHTML = upcoming
      .map(({ ev, when }) => {
        const dateStr = `${EV_DAYS[l][when.getDay()]} · ${when.getDate()} ${EV_MONTHS[l][when.getMonth()]}`;
        const link = ev.url
          ? `<a class="event__link mono" data-hover href="${ev.url}" target="_blank" rel="noopener">info ↗</a>`
          : `<span class="event__link mono"></span>`;
        return `<li class="event">
          <span class="event__date mono">${dateStr}</span>
          <span class="event__name">${ev.name[l] || ev.name.en}</span>
          <span class="event__place mono">${ev.place}</span>
          ${link}
        </li>`;
      })
      .join("");
    empty.style.display = upcoming.length ? "none" : "";
  }

  function applyLang(next, resplit) {
    lang = next;
    document.documentElement.lang = lang === "pt" ? "pt-PT" : "en";
    document.title = I18N[lang].doc_title;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const v = I18N[lang][el.dataset.i18n];
      if (v == null) return;
      el.innerHTML = v;
      if (resplit && el.hasAttribute("data-split-lines")) {
        // re-wrap lines and leave them visible (no re-animation on toggle)
        const lines = splitLines(el);
        if (typeof gsap !== "undefined") gsap.set(lines, { yPercent: 0 });
      }
    });
    langBtn.textContent = lang === "en" ? "PT" : "EN";
    langBtn.setAttribute("aria-label", lang === "en" ? "Mudar para português" : "Switch to English");
    renderEvents(lang);
    if (window.__subPickReady) updateSubGo();
    if (document.body.classList.contains("cart-mode")) renderCart();
    try { localStorage.setItem("mira-lang", lang); } catch (e) {}
  }

  /* wrap each visual line (set by <br>) in an overflow mask */
  function splitLines(el) {
    const lines = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = lines
      .map((l) => `<span class="line-mask"><span class="line-inner">${l.trim()}</span></span>`)
      .join("");
    return el.querySelectorAll(".line-inner");
  }

  /* buy buttons → Stripe Payment Links (mailto fallback until links are set) */
  document.querySelectorAll("[data-buy]").forEach((a) => {
    const link = STRIPE_LINKS[a.dataset.buy];
    if (link) { a.href = link; a.removeAttribute("target"); }
  });

  /* ─────────────────────────────────────────────
     CART + EMBEDDED CHECKOUT
     Activates only when the site runs behind the
     Cloudflare Worker (/api/config responds).
     On GitHub Pages it stays dormant and the buy
     buttons keep their payment-link behaviour.
  ───────────────────────────────────────────── */
  const CATALOG = {
    small:  { price: "price_1Tp6jR2KMRu6Fi6htz56SDPI", eur: 8,  pack: "×12", nameKey: "s_name" },
    medium: { price: "price_1Tp6jS2KMRu6Fi6hI68OSLWD", eur: 10, pack: "×12", nameKey: "m_name" },
    large:  { price: "price_1Tp6jU2KMRu6Fi6hj58ozoRh", eur: 9,  pack: "×6",  nameKey: "l_name" },
  };
  const SUB_PRICES = {
    "small:weekly":    "price_1Tp6je2KMRu6Fi6hri2mQkM8",
    "small:biweekly":  "price_1Tp6jf2KMRu6Fi6hnOZhEOkg",
    "small:monthly":   "price_1Tp6jg2KMRu6Fi6h26hVNFiV",
    "medium:weekly":   "price_1Tp6jh2KMRu6Fi6hvlaea75S",
    "medium:biweekly": "price_1Tp6jj2KMRu6Fi6hCJSEMrlK",
    "medium:monthly":  "price_1Tp6jk2KMRu6Fi6h7svhoyec",
    "large:weekly":    "price_1Tp6jm2KMRu6Fi6hJ0jJ2qVn",
    "large:biweekly":  "price_1Tp6jn2KMRu6Fi6h47lAOYZs",
    "large:monthly":   "price_1Tp6jo2KMRu6Fi6hOAHj9Uo4",
  };
  const CART_KEY = "mira-cart";
  let publishableKey = null;
  let embedded = null;

  const readCart = () => {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch (e) { return {}; }
  };
  const writeCart = (c) => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch (e) {}
  };

  function renderCart() {
    const list = document.getElementById("cartItems");
    if (!list) return;
    const cart = readCart();
    const skus = Object.keys(cart).filter((s) => CATALOG[s] && cart[s] > 0);
    let total = 0;
    list.innerHTML = skus.map((sku) => {
      const it = CATALOG[sku];
      const qty = cart[sku];
      total += it.eur * qty;
      return `<li class="citem">
        <span class="citem__name">${I18N[lang][it.nameKey]} <span class="citem__pack mono">${it.pack}</span></span>
        <span class="citem__qty mono">
          <button data-dec="${sku}" data-hover aria-label="less">−</button><b>${qty}</b><button data-inc="${sku}" data-hover aria-label="more">+</button>
        </span>
        <span class="citem__eur mono">€${it.eur * qty}</span>
      </li>`;
    }).join("");
    document.getElementById("cartEmpty").style.display = skus.length ? "none" : "";
    document.getElementById("cartCheckout").style.display = skus.length ? "" : "none";
    document.getElementById("cartTotal").textContent = "€" + total;
    const pointsRow = document.getElementById("cartPoints");
    if (pointsRow) {
      const eligible = window.__miraMe && window.__miraMe.loggedIn &&
        window.__miraMe.customer.points >= 100 && total >= 8;
      pointsRow.hidden = !eligible;
      if (!eligible) {
        const cb = document.getElementById("usePoints");
        if (cb) cb.checked = false;
      }
    }
    const count = skus.reduce((n, s) => n + cart[s], 0);
    const badge = document.getElementById("cartCount");
    badge.hidden = !count;
    badge.textContent = count;
    const clearBtn = document.getElementById("cartClear");
    if (clearBtn) clearBtn.hidden = !count;
  }

  function addToCart(sku, qty) {
    const cart = readCart();
    cart[sku] = Math.min((cart[sku] || 0) + qty, 20);
    if (cart[sku] <= 0) delete cart[sku];
    writeCart(cart);
    renderCart();
  }

  const drawer = document.getElementById("cartDrawer");
  const shade = document.getElementById("cartShade");
  function openCart() { drawer.classList.add("is-open"); shade.classList.add("is-on"); }
  function closeCart() { drawer.classList.remove("is-open"); shade.classList.remove("is-on"); }

  function loadStripeJs() {
    return new Promise((resolve, reject) => {
      if (window.Stripe) return resolve();
      const s = document.createElement("script");
      s.src = "https://js.stripe.com/v3/";
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function startCheckout(items, usePoints) {
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, usePoints: !!usePoints }),
      });
      const raw = await r.text();
      let d;
      try { d = JSON.parse(raw); } catch (e) { d = {}; }
      if (!d.clientSecret) throw new Error(d.error || "");
      await loadStripeJs();
      const stripe = Stripe(publishableKey);
      if (embedded) { embedded.destroy(); embedded = null; }
      embedded = await stripe.initEmbeddedCheckout({ clientSecret: d.clientSecret });
      closeCart();
      const wrap = document.getElementById("scWrap");
      wrap.hidden = false;
      wrap.scrollTop = 0;
      document.body.style.overflow = "hidden";
      embedded.mount("#scMount");
    } catch (e) {
      showToast((lang === "pt" ? "erro no checkout — tenta de novo. " : "checkout error — try again. ") + (e.message || ""));
    }
  }

  function closeCheckout() {
    if (embedded) { embedded.destroy(); embedded = null; }
    document.getElementById("scWrap").hidden = true;
    document.body.style.overflow = "";
  }

  let toastTimer = null;
  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  /* post-checkout confirmation — includes the newsletter opt-in (moved out of the cart) */
  function showOrderSuccess(claimed) {
    const pts = claimed && claimed.points != null ? claimed.points : 0;
    const ptsLine = pts
      ? (lang === "pt" ? ` · ${pts} pontos na tua conta` : ` · ${pts} points in your account`)
      : "";
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:50%;bottom:1.4rem;transform:translateX(-50%);z-index:120;background:var(--cream);color:var(--ink);border:3px solid var(--ink);border-radius:16px;padding:1.1rem 1.3rem;max-width:min(430px,92vw);box-shadow:6px 7px 0 rgba(20,20,18,.25);font-family:var(--font-mono);font-size:.82rem;line-height:1.5";
    box.innerHTML =
      '<button id="ordClose" style="position:absolute;top:.35rem;right:.6rem;background:none;border:0;font-size:1.2rem;line-height:1;cursor:pointer;color:var(--ink)">×</button>' +
      '<div style="font-weight:500;margin:0 1rem .8rem 0">' +
      (lang === "pt" ? "obrigado! encomenda confirmada 🌮" : "obrigado! order confirmed 🌮") + ptsLine + "</div>" +
      '<button id="ordNews" style="display:flex;align-items:center;gap:.55rem;width:100%;background:none;border:2px solid var(--ink);border-radius:999px;padding:.5rem .95rem;font-family:inherit;font-size:.76rem;cursor:pointer;color:var(--ink);text-align:left">' +
      '<span id="ordBox" style="width:1rem;height:1rem;border:2px solid var(--ink);border-radius:4px;flex:none;display:grid;place-items:center;font-size:.7rem"></span>' +
      '<span id="ordTxt">' + (lang === "pt" ? "quero novidades &amp; drops por email" : "email me about drops &amp; news") + "</span></button>";
    document.body.appendChild(box);
    const close = () => box.remove();
    box.querySelector("#ordClose").addEventListener("click", close);
    box.querySelector("#ordNews").addEventListener("click", async () => {
      try {
        const r = await fetch("/api/newsletter-optin", { method: "POST" });
        const d = await r.json();
        if (d.ok) {
          box.querySelector("#ordBox").textContent = "✓";
          box.querySelector("#ordBox").style.background = "var(--green)";
          box.querySelector("#ordTxt").textContent = lang === "pt" ? "estás na lista ✓" : "you're on the list ✓";
          box.querySelector("#ordNews").disabled = true;
          setTimeout(close, 2500);
        }
      } catch (e) {}
    });
    setTimeout(() => { if (document.body.contains(box)) close(); }, 14000);
  }

  function initCart() {
    document.body.classList.add("cart-mode");
    /* owner controls: pause + per-size sold-out from /api/status */
    window.__miraBlocked = new Set();
    fetch("/api/status").then((r) => r.json()).then((st) => {
      window.__miraStatus = st;
      const closed = !st.open;
      const deadLabel = closed
        ? (lang === "pt" ? "brevemente" : "coming soon")
        : (lang === "pt" ? "esgotado" : "sold out");
      document.querySelectorAll("[data-buy]").forEach((a) => {
        const sku = a.dataset.buy;
        const out = ((st.remaining || {})[sku] || 0) <= 0;
        if (closed || out) {
          window.__miraBlocked.add(sku);
          a.classList.add("btn--dead");
          const span = a.querySelector("[data-i18n]") || a;
          span.removeAttribute("data-i18n");
          span.textContent = deadLabel;
          if (out && !closed) a.closest(".card").classList.add("card--soldout");
        }
      });
      document.querySelectorAll("[data-quick]").forEach((b) => {
        if (closed || window.__miraBlocked.has(b.dataset.quick)) b.classList.add("btn--dead");
      });
      if (closed) {
        window.__miraSubsClosed = true;
        const go = document.getElementById("subGo");
        if (go) go.classList.add("btn--dead");
      }
    }).catch(() => {});
    /* buy buttons add to cart WITHOUT opening the drawer (so all sizes stay reachable).
       The toast itself opens the cart on tap, and the nav un-hides so ORDER is visible. */
    const addedToast = (sku) => {
      const name = I18N[lang][CATALOG[sku].nameKey] || sku;
      const nav = document.getElementById("nav");
      if (nav) nav.classList.remove("nav--hidden");
      showToast(lang === "pt" ? `+1 ${name} · ver carrinho →` : `+1 ${name} · view cart →`);
      const t = document.getElementById("toast");
      t.style.cursor = "pointer";
      t.onclick = () => { t.hidden = true; t.onclick = null; openCart(); };
    };
    window.__miraAddedToast = addedToast;
    document.querySelectorAll("[data-buy]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (window.__miraBlocked.has(a.dataset.buy)) {
          showToast(lang === "pt" ? "esgotado — voltamos em breve! 🌮" : "sold out — back soon! 🌮");
          return;
        }
        addToCart(a.dataset.buy, 1);
        addedToast(a.dataset.buy);
      });
    });
    /* subscription pills → embedded subscription checkout */
    document.querySelectorAll("[data-sub]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        startCheckout([{ price: SUB_PRICES[a.dataset.sub], quantity: 1 }]);
      });
    });
    /* nav order button opens the cart */
    document.getElementById("navOrder").addEventListener("click", (e) => {
      e.preventDefault(); openCart();
    });
    /* footer CTA: shop instead of the mailto (no inbox until the domain email exists) */
    const footCta = document.querySelector(".footer__cta");
    if (footCta) {
      footCta.addEventListener("click", (e) => {
        e.preventDefault();
        const cart = readCart();
        if (Object.keys(cart).some((s) => CATALOG[s] && cart[s] > 0)) { openCart(); return; }
        const grid = document.getElementById("escolher");
        if (grid) grid.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    document.getElementById("cartClose").addEventListener("click", closeCart);
    document.getElementById("cartClear").addEventListener("click", () => {
      writeCart({});
      renderCart();
    });
    shade.addEventListener("click", closeCart);
    document.getElementById("scClose").addEventListener("click", closeCheckout);
    document.getElementById("cartItems").addEventListener("click", (e) => {
      const inc = e.target.closest("[data-inc]"), dec = e.target.closest("[data-dec]");
      if (inc) addToCart(inc.dataset.inc, 1);
      if (dec) addToCart(dec.dataset.dec, -1);
    });
    document.getElementById("cartCheckout").addEventListener("click", () => {
      const cart = readCart();
      const items = Object.keys(cart)
        .filter((s) => CATALOG[s] && cart[s] > 0)
        .map((s) => ({ price: CATALOG[s].price, quantity: cart[s] }));
      if (items.length) {
        const cb = document.getElementById("usePoints");
        startCheckout(items, !!(cb && cb.checked && !document.getElementById("cartPoints").hidden));
      }
    });
    renderCart();
  }

  /* hero quick-order chips: add to cart when live, otherwise scroll to the cards */
  document.querySelectorAll("[data-quick]").forEach((b) => {
    b.addEventListener("click", () => {
      if (document.body.classList.contains("cart-mode")) {
        if (window.__miraBlocked && window.__miraBlocked.has(b.dataset.quick)) return;
        addToCart(b.dataset.quick, 1);
        if (typeof window.__miraAddedToast === "function") window.__miraAddedToast(b.dataset.quick);
      } else {
        const cta = document.querySelector('a[href="#escolher"].btn--ink, a[href="#escolher"].btn--green');
        if (cta) cta.click();
      }
    });
  });

  /* subscription picker: size + rhythm -> one subscribe button with live price */
  const SUB_LINKS = {
    "small:weekly": "https://buy.stripe.com/bJe14g9Lu1pTgtLe3f6J203",
    "small:biweekly": "https://buy.stripe.com/28E4gs7DmfgJa5ne3f6J204",
    "small:monthly": "https://buy.stripe.com/6oUbIUf5O6Kd1yR7ER6J205",
    "medium:weekly": "https://buy.stripe.com/00w9AMe1K2tX1yR3oB6J206",
    "medium:biweekly": "https://buy.stripe.com/14AbIU6zi8Slcdv9MZ6J207",
    "medium:monthly": "https://buy.stripe.com/7sY9AM7Dm0lP3GZ7ER6J208",
    "large:weekly": "https://buy.stripe.com/fZuaEQ6zi5G90uN6AN6J209",
    "large:biweekly": "https://buy.stripe.com/4gMaEQf5Ob0t4L3bV76J20a",
    "large:monthly": "https://buy.stripe.com/9B64gsg9Sb0t0uN1gt6J20b",
  };
  const subState = { cad: "weekly" };
  const subQty = { small: 0, medium: 1, large: 0 };
  const CAD_SUFFIX = {
    en: { weekly: "/ week", biweekly: "/ 2 weeks", monthly: "/ month" },
    pt: { weekly: "/ semana", biweekly: "/ 2 semanas", monthly: "/ mês" },
  };
  function updateSubGo() {
    const label = document.getElementById("subGoLabel");
    const go = document.getElementById("subGo");
    if (!label || !go) return;
    Object.keys(subQty).forEach((k) => {
      const el = document.getElementById("subq-" + k);
      if (el) el.textContent = subQty[k];
    });
    const PACK_COUNT = { small: 12, medium: 12, large: 6 };
    const total = Object.keys(subQty).reduce((n, k) => n + CATALOG[k].eur * subQty[k], 0);
    const tortillas = Object.keys(subQty).reduce((n, k) => n + PACK_COUNT[k] * subQty[k], 0);
    const countEl = document.getElementById("subCount");
    if (total > 0) {
      go.disabled = false;
      label.textContent = `${lang === "pt" ? "assinar" : "subscribe"} — €${total} ${CAD_SUFFIX[lang][subState.cad]}`;
      if (countEl) {
        countEl.hidden = false;
        countEl.textContent = lang === "pt"
          ? `= ${tortillas} tortillas por entrega`
          : `= ${tortillas} tortillas per delivery`;
      }
    } else {
      go.disabled = true;
      label.textContent = lang === "pt" ? "escolhe os teus packs" : "pick your packs";
      if (countEl) countEl.hidden = true;
    }
  }
  document.querySelectorAll("[data-sub-inc]").forEach((b) => {
    b.addEventListener("click", () => {
      const k = b.dataset.subInc;
      subQty[k] = Math.min(subQty[k] + 1, 5);
      updateSubGo();
    });
  });
  document.querySelectorAll("[data-sub-dec]").forEach((b) => {
    b.addEventListener("click", () => {
      const k = b.dataset.subDec;
      subQty[k] = Math.max(subQty[k] - 1, 0);
      updateSubGo();
    });
  });
  (function bindCad() {
    const group = document.getElementById("subCad");
    if (!group) return;
    group.querySelectorAll(".subpick__opt").forEach((b) => {
      b.addEventListener("click", () => {
        group.querySelectorAll(".subpick__opt").forEach((x) => x.classList.remove("is-on"));
        b.classList.add("is-on");
        subState.cad = b.dataset.cad;
        updateSubGo();
      });
    });
  })();
  window.__subPickReady = true;
  updateSubGo();
  const subGo = document.getElementById("subGo");
  if (subGo) {
    subGo.addEventListener("click", () => {
      if (window.__miraSubsClosed) {
        showToast(lang === "pt" ? "assinaturas brevemente! 🌮" : "subscriptions coming soon! 🌮");
        return;
      }
      const sizes = Object.keys(subQty).filter((k) => subQty[k] > 0);
      if (!sizes.length) return;
      if (document.body.classList.contains("cart-mode")) {
        startCheckout(sizes.map((k) => ({ price: SUB_PRICES[`${k}:${subState.cad}`], quantity: subQty[k] })));
      } else {
        window.location.href = SUB_LINKS[`${sizes[0]}:${subState.cad}`];
      }
    });
  }

  /* activate cart mode only when the worker API is live */
  fetch("/api/config")
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      if (cfg && cfg.publishableKey) { publishableKey = cfg.publishableKey; initCart(); }
    })
    .catch(() => {});

  /* signed-in visitors get a green account dot */
  fetch("/api/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      window.__miraMe = me;
      if (me && me.loggedIn) {
        const a = document.getElementById("navAccount");
        if (a) a.classList.add("is-in");
        if (document.body.classList.contains("cart-mode")) renderCart();
      }
    })
    .catch(() => {});

  /* back from a successful embedded checkout: create/refresh the mira account */
  const qs = new URLSearchParams(location.search);
  if (qs.get("checkout") === "success") {
    const sid = qs.get("session_id");
    writeCart({});
    history.replaceState(null, "", location.pathname);
    (async () => {
      let claimed = null;
      if (sid) {
        try {
          const r = await fetch("/api/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sid }),
          });
          claimed = await r.json();
        } catch (e) {}
      }
      if (claimed && claimed.ok) {
        const a = document.getElementById("navAccount");
        if (a) a.classList.add("is-in");
        showOrderSuccess(claimed);
      } else {
        showToast(lang === "pt"
          ? "obrigado! encomenda confirmada — entraremos em contacto para combinar a entrega. 🌮"
          : "obrigado! order confirmed — we'll be in touch to arrange delivery. 🌮");
      }
    })();
  }

  langBtn.addEventListener("click", () => {
    applyLang(lang === "en" ? "pt" : "en", true);
    if (typeof window.__miraMarqueeRefresh === "function") window.__miraMarqueeRefresh();
  });

  /* apply current language BEFORE animations split anything —
     also keeps HTML fallback text in sync with the dictionary */
  applyLang(lang, false);

  /* ───────── motion setup ───────── */
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasGsap = typeof gsap !== "undefined";

  /* If GSAP failed to load or user prefers reduced motion,
     remove the loader and bail — page stays fully usable. */
  const loader = document.getElementById("loader");
  if (!hasGsap || reduceMotion) {
    if (loader) loader.remove();
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  /* ───────── smooth scroll (Lenis) ───────── */
  let lenis = null;
  if (typeof Lenis !== "undefined" && !("ontouchstart" in window)) {
    lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  function splitChars(el) {
    const text = el.textContent;
    el.textContent = "";
    el.setAttribute("aria-hidden", "true");
    const frag = document.createDocumentFragment();
    for (const ch of text) {
      const s = document.createElement("span");
      s.className = "char";
      s.textContent = ch;
      frag.appendChild(s);
    }
    el.appendChild(frag);
    return el.querySelectorAll(".char");
  }

  /* intro/preloader animation removed — page content shows immediately */

  /* ───────── nav hide/show ───────── */
  const nav = document.getElementById("nav");
  ScrollTrigger.create({
    start: "top -80",
    end: "max",
    onUpdate: (self) => {
      nav.classList.toggle("nav--hidden", self.direction === 1 && self.scroll() > 300);
      nav.classList.toggle("nav--solid", self.scroll() > 80);
    },
  });

  /* ───────── marquee — infinite, speeds up with scroll velocity ───────── */
  const track = document.getElementById("marqueeTrack");
  const chunk = track.querySelector(".marquee__chunk");
  while (track.scrollWidth < window.innerWidth * 2.2) {
    track.appendChild(chunk.cloneNode(true));
  }
  let chunkW = chunk.offsetWidth;
  window.__miraMarqueeRefresh = () => { chunkW = chunk.offsetWidth; };
  const marqueeAnim = gsap.to(track, {
    x: -chunkW,
    duration: 14,
    ease: "none",
    repeat: -1,
    modifiers: { x: (x) => (parseFloat(x) % chunkW) + "px" },
  });
  ScrollTrigger.create({
    start: 0,
    end: "max",
    onUpdate: (self) => {
      const boost = 1 + Math.min(Math.abs(self.getVelocity()) / 900, 3);
      gsap.to(marqueeAnim, { timeScale: boost, duration: 0.3, overwrite: true });
    },
  });

  /* ───────── generic reveals ───────── */
  gsap.utils.toArray("[data-reveal]").forEach((el) => {
    gsap.from(el, {
      y: 30,
      opacity: 0,
      duration: 0.8,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 88%" },
    });
  });

  /* masked line reveals for big headings */
  document.querySelectorAll("[data-split-lines]").forEach((el) => {
    const lines = splitLines(el);
    gsap.from(lines, {
      yPercent: 110,
      duration: 0.9,
      ease: "power4.out",
      stagger: 0.12,
      scrollTrigger: { trigger: el, start: "top 85%" },
    });
  });

  /* ───────── ingredients ───────── */
  gsap.utils.toArray("[data-ing]").forEach((row, i) => {
    gsap.from(row, {
      xPercent: -6,
      opacity: 0,
      duration: 0.7,
      delay: i * 0.06,
      ease: "power3.out",
      scrollTrigger: { trigger: row, start: "top 90%" },
    });
  });

  /* events rows — same entrance as ingredients */
  gsap.utils.toArray(".event").forEach((row, i) => {
    gsap.from(row, {
      xPercent: -6,
      opacity: 0,
      duration: 0.7,
      delay: i * 0.06,
      ease: "power3.out",
      scrollTrigger: { trigger: row, start: "top 90%" },
    });
  });

  gsap.from("[data-count-4]", {
    scale: 0.4,
    opacity: 0,
    rotation: -20,
    duration: 1,
    ease: "back.out(1.6)",
    scrollTrigger: { trigger: ".ingredients", start: "top 70%" },
  });

  /* ───────── heat scene — par-cooked tortilla finishing loop ───────── */
  (function heatScene() {
    /* tortilla body shapes — bottom edge stays put, only the top inflates */
    const TORT_FLAT  = "M-92 0 Q-90 -13 0 -13 Q90 -13 92 0 Q90 13 0 13 Q-90 13 -92 0 Z";
    const TORT_PUFF  = "M-86 2 Q-76 -88 0 -94 Q76 -88 86 2 Q56 14 0 14 Q-56 14 -86 2 Z";
    const TORT_SETTLE = "M-87 2 Q-77 -74 0 -80 Q77 -74 87 2 Q57 14 0 14 Q-57 14 -87 2 Z";
    const tort = "#tort";
    const spots = gsap.utils.toArray("#tortSpots .spot");
    const stack = gsap.utils.toArray(".stack-t");
    const label = document.getElementById("heatLabel");
    const labelPill = document.querySelector("#heatLabelG rect");
    const fitLabelPill = () => {
      const w = Math.max(Math.ceil(label.getComputedTextLength()) + 48, 150);
      labelPill.setAttribute("width", w);
      labelPill.setAttribute("x", -w / 2);
    };
    const setLabel = (key) => () => { label.textContent = I18N[lang][key]; fitLabelPill(); };
    fitLabelPill();

    /* flames flicker constantly */
    const flameAnim = gsap.to(".flame", {
      scaleY: "random(0.65, 1.3)",
      duration: 0.22,
      repeat: -1,
      yoyo: true,
      repeatRefresh: true,
      stagger: 0.06,
      transformOrigin: "50% 100%",
      paused: true,
    });

    let stackCount = 0;

    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.6, paused: true });

    /* NOTE: gsap x/y on SVG elements replaces the markup transform,
       so all positions below are absolute canvas coords.
       Pan position: (285, 295). Stack landing: (92, 400). */
    tl
      /* reset — parked above the viewBox */
      .set(tort, { x: 285, y: -70, rotation: 0, scale: 1, scaleY: 1, opacity: 1 })
      .set(spots, { opacity: 0 })
      .set("#tortSpots", { y: 0 })
      .set("#tortBody", { attr: { d: TORT_FLAT } })
      .call(setLabel("scene_start"))
      /* drop into the pan */
      .to(tort, { y: 295, duration: 0.6, ease: "bounce.out" })
      .to(tort, { scaleY: 0.92, duration: 0.08, yoyo: true, repeat: 1 }, "<55%")
      /* side one */
      .call(setLabel("scene_side1"))
      .to(".steam-p", { opacity: 0.7, y: -14, duration: 0.7, stagger: 0.18 }, "<")
      .to(".steam-p", { opacity: 0, y: -30, duration: 0.7, stagger: 0.18 }, ">-0.2")
      .to(spots.slice(0, 3), { opacity: 0.9, duration: 0.5, stagger: 0.35 }, "<-0.5")
      .to({}, { duration: 0.4 })
      /* flip */
      .call(setLabel("scene_flip"))
      .to(tort, { y: 175, scaleY: 0.14, rotation: 6, duration: 0.3, ease: "power2.out" })
      .to(tort, { y: 295, scaleY: 1, rotation: 0, duration: 0.32, ease: "power2.in" })
      .to(tort, { scaleY: 0.9, duration: 0.07, yoyo: true, repeat: 1 })
      /* side two — it puffs */
      .call(setLabel("scene_side2"))
      .to(".steam-p", { opacity: 0.7, y: -14, duration: 0.7, stagger: 0.18 }, "<")
      .to(".steam-p", { opacity: 0, y: -30, duration: 0.7, stagger: 0.18 }, ">-0.2")
      .to(spots.slice(3), { opacity: 0.9, duration: 0.5, stagger: 0.35 }, "<-0.5")
      /* the puff — bottom stays on the pan, only the top inflates into a dome */
      .to("#tortBody", { attr: { d: TORT_PUFF }, duration: 0.85, ease: "back.out(1.6)" }, "<+0.3")
      .to("#tortSpots", { y: -42, duration: 0.85, ease: "back.out(1.6)" }, "<")
      .to("#tortBody", { attr: { d: TORT_SETTLE }, duration: 0.35, yoyo: true, repeat: 1, ease: "sine.inOut" })
      .to("#tortSpots", { y: -36, duration: 0.35, yoyo: true, repeat: 1, ease: "sine.inOut" }, "<")
      /* done — slide onto the stack */
      .call(setLabel("scene_done"))
      .to(tort, {
        x: 92,
        y: 400,
        scale: 0.6,
        duration: 0.7,
        ease: "power2.inOut",
      })
      .call(() => {
        if (stackCount >= stack.length) {
          stackCount = 0;
          gsap.set(stack, { opacity: 0 });
        }
        gsap.set(stack[stackCount], { opacity: 1 });
        stackCount++;
      })
      .set(tort, { opacity: 0 });

    const setRunning = (on) => {
      if (on) { tl.play(); flameAnim.play(); }
      else { tl.pause(); flameAnim.pause(); }
    };
    const sceneST = ScrollTrigger.create({
      trigger: ".heat__scene",
      start: "top 85%",
      end: "bottom top",
      onToggle: (self) => setRunning(self.isActive),
    });
    /* covers landing inside the range via deep link / restored scroll,
       where no enter callback fires */
    setRunning(sceneST.isActive);
  })();

  /* size cards & how-to steps render without entrance animations —
     they must always sit level, in every scroll/visibility state */

  /* ───────── footer mark ───────── */
  gsap.from("[data-footer-mark]", {
    yPercent: 40,
    opacity: 0,
    duration: 1,
    ease: "power3.out",
    scrollTrigger: { trigger: ".footer", start: "top 55%" },
  });

  /* ───────── custom cursor ───────── */
  const cursor = document.getElementById("cursor");
  if (window.matchMedia("(pointer: fine)").matches) {
    const xTo = gsap.quickTo(cursor, "x", { duration: 0.18, ease: "power3.out" });
    const yTo = gsap.quickTo(cursor, "y", { duration: 0.18, ease: "power3.out" });
    window.addEventListener("pointermove", (e) => { xTo(e.clientX); yTo(e.clientY); });
    document.querySelectorAll("a, button, [data-hover]").forEach((el) => {
      el.addEventListener("pointerenter", () => cursor.classList.add("is-hover"));
      el.addEventListener("pointerleave", () => cursor.classList.remove("is-hover"));
    });
  }

  /* ───────── anchor links play nice with lenis ───────── */
  if (lenis) {
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        const target = document.querySelector(a.getAttribute("href"));
        if (target) {
          e.preventDefault();
          const offset = parseInt(a.dataset.offset || "-20", 10);
          lenis.scrollTo(target, { offset });
          /* layout can still be settling right after load — re-aim once if we landed short */
          setTimeout(() => {
            if (!lenis.isScrolling && Math.abs(target.getBoundingClientRect().top + offset) > 60) {
              lenis.scrollTo(target, { offset });
            }
          }, 1400);
        }
      });
    });
  }
})();
