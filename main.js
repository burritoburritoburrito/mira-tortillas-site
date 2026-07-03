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
    small: "",   // 12 small — €8
    medium: "",  // 12 medium — €10
    large: "",   // 6 large — €9
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
      hero_blurb: "Four ingredients, pressed &amp; par-cooked in small batches in Lisboa.<br>You give them the final toast at home.",
      hero_cta: 'choose your size<span class="btn__dot"></span>',
      ing_kicker: "02 — the recipe",
      ing_title: "only four<br>ingredients.",
      ing_note: "The whole label, start to finish. Mixed, rolled and pressed by hand in Lisboa.",
      heat_kicker: "03 — fire it up",
      heat_title: "par-cooked by us.<br>finished by you.",
      heat_sub: "Every mira tortilla leaves our kitchen 90% done. The last 40 seconds happen in your pan — that final toast is what makes them taste fresh-made.",
      step1_h: "dry pan, high heat",
      step1_p: "Pan, griddle or grill — no oil. Get it properly hot, about 15–20 seconds per side.",
      step2_h: "see bubbles? flip it",
      step2_p: "When tiny bubbles start forming, flip to the other side.",
      step3_h: "15–20 more — it puffs up",
      step3_p: "Ready to eat! Stack them in a clean cloth so they stay warm and soft.",
      heat_store: "keep refrigerated · 7 days&nbsp;&nbsp;/&nbsp;&nbsp;or freeze · 3 months",
      gal_kicker: "04 — the drops",
      gal_title: "packed, dated,<br>delivered.",
      gal_cap1: "a dozen, packed & dated by hand",
      gal_cap3: "drop-off day in lisboa",
      nav_events: "find us",
      ev_kicker: "05 — find us",
      ev_title: "upcoming<br>drops &amp; markets.",
      ev_empty: "nothing on the calendar right now — follow @miratortillas for the next drop.",
      sizes_kicker: "01 — pick your size",
      sizes_title: "one dough.<br>three sizes.",
      sizes_sub: "Taco night, burrito Sunday or snack-size quesadillas — there's a stack for that.",
      s_name: "small", s_desc: "10&nbsp;cm — street-taco size. Two-bite wonders, party favourites.", s_btn: "buy small · €8",
      m_name: "medium", m_desc: "15&nbsp;cm — the everyday hero. Wraps, quesadillas, breakfast burritos.", m_btn: "buy medium · €10",
      l_name: "large", l_desc: "25&nbsp;cm — burrito territory. Big enough to wrap your whole evening.", l_btn: "buy large · €9",
      marquee: "flour <i>·</i> water <i>·</i> avocado oil <i>·</i> salt <i>·</i>&nbsp;",
      pay_note: "secure checkout by stripe — card · apple pay · google pay · mb way / multibanco",
      foot_kicker: "hungry? / fome?",
      foot_cta: "order<br>a stack",
      foot_made: "made in lisboa 🇵🇹",
      scene_start: "dry pan · no oil",
      scene_side1: "side 1 · 15–20s",
      scene_flip: "tiny bubbles? flip!",
      scene_side2: "side 2 · 15–20s",
      scene_done: "puffed up — ready to eat!",
      doc_title: "mira — handmade flour tortillas, Lisboa",
    },
    pt: {
      nav_ing: "ingredientes",
      nav_heat: "como aquecer",
      nav_sizes: "tamanhos",
      nav_order: "encomendar",
      hero_blurb: "Quatro ingredientes, prensadas e meio cozidas em pequenos lotes em Lisboa.<br>Tu dás-lhes a tostadela final em casa.",
      hero_cta: 'escolhe o tamanho<span class="btn__dot"></span>',
      ing_kicker: "02 — a receita",
      ing_title: "só quatro<br>ingredientes.",
      ing_note: "O rótulo inteiro, do início ao fim. Misturadas, tendidas e prensadas à mão em Lisboa.",
      heat_kicker: "03 — ao lume",
      heat_title: "meio cozidas por nós.<br>acabadas por ti.",
      heat_sub: "Cada tortilha mira sai da nossa cozinha 90% pronta. Os últimos 40 segundos acontecem na tua frigideira — é essa tostadela final que lhes dá o sabor de acabadas de fazer.",
      step1_h: "frigideira seca, lume forte",
      step1_p: "Frigideira, chapa ou grelha — sem óleo. Deixa aquecer bem, cerca de 15–20 segundos por lado.",
      step2_h: "vês bolhas? vira",
      step2_p: "Quando se formarem pequenas bolhas, vira para o outro lado.",
      step3_h: "mais 15–20 — e incha",
      step3_p: "Prontas a comer! Empilha-as num pano limpo para ficarem quentes e macias.",
      heat_store: "conservar no frigorífico · 7 dias&nbsp;&nbsp;/&nbsp;&nbsp;ou congelar · 3 meses",
      gal_kicker: "04 — as entregas",
      gal_title: "embaladas, datadas,<br>entregues.",
      gal_cap1: "uma dúzia, embalada e datada à mão",
      gal_cap3: "dia de entregas em lisboa",
      nav_events: "onde estamos",
      ev_kicker: "05 — onde estamos",
      ev_title: "próximos<br>drops &amp; mercados.",
      ev_empty: "nada agendado de momento — segue @miratortillas para o próximo drop.",
      sizes_kicker: "01 — escolhe o tamanho",
      sizes_title: "uma massa.<br>três tamanhos.",
      sizes_sub: "Noite de tacos, burrito ao domingo ou quesadillas para o lanche — há uma pilha para isso.",
      s_name: "pequenas", s_desc: "10&nbsp;cm — tamanho taco de rua. Duas dentadas, favoritas das festas.", s_btn: "comprar S · €8",
      m_name: "médias", m_desc: "15&nbsp;cm — as heroínas do dia-a-dia. Wraps, quesadillas, burritos de pequeno-almoço.", m_btn: "comprar M · €10",
      l_name: "grandes", l_desc: "25&nbsp;cm — território burrito. Grandes o suficiente para embrulhar a noite inteira.", l_btn: "comprar L · €9",
      marquee: "farinha <i>·</i> água <i>·</i> óleo de abacate <i>·</i> sal <i>·</i>&nbsp;",
      pay_note: "pagamento seguro com stripe — cartão · apple pay · google pay · mb way / multibanco",
      foot_kicker: "fome? / hungry?",
      foot_cta: "encomenda<br>uma pilha",
      foot_made: "feito em lisboa 🇵🇹",
      scene_start: "frigideira seca · sem óleo",
      scene_side1: "lado 1 · 15–20s",
      scene_flip: "bolhas? vira!",
      scene_side2: "lado 2 · 15–20s",
      scene_done: "estufada — pronta a comer!",
      doc_title: "mira — tortilhas de farinha feitas à mão, Lisboa",
    },
  };

  let lang = (function () {
    try { return localStorage.getItem("mira-lang") === "pt" ? "pt" : "en"; }
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

  /* ───────── loader ───────── */
  const countEl = document.getElementById("loaderCount");
  const counter = { v: 0 };
  const introTl = gsap.timeline();

  introTl
    .from(".loader__mark", { y: 40, opacity: 0, duration: 0.6, ease: "power3.out" })
    .to(counter, {
      v: 100,
      duration: 1.4,
      ease: "power2.inOut",
      onUpdate: () => { countEl.textContent = Math.round(counter.v) + "%"; },
    }, "<")
    .to(loader, {
      yPercent: -100,
      duration: 0.8,
      ease: "power4.inOut",
      onComplete: () => loader.remove(),
    }, "+=0.15");

  /* ───────── hero intro ───────── */
  const heroChars = splitChars(document.querySelector("[data-split]"));
  document.querySelector(".hero__title").setAttribute("aria-label", "tortillas");

  introTl
    .from(heroChars, {
      yPercent: 110,
      duration: 0.9,
      ease: "power4.out",
      stagger: 0.045,
    }, "-=0.35")
    .from("[data-hero-mark]", {
      scale: 0,
      rotation: 6,
      duration: 0.8,
      ease: "back.out(1.8)",
      transformOrigin: "50% 50%",
    }, "-=0.5")
    .from("[data-hero-fade]", {
      y: 24,
      opacity: 0,
      duration: 0.7,
      ease: "power3.out",
      stagger: 0.08,
    }, "-=0.5");

  /* hero gently parallaxes away */
  gsap.to(".hero__stage", {
    yPercent: 18,
    ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true },
  });

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
    const setLabel = (key) => () => { label.textContent = I18N[lang][key]; };

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

  /* ───────── gallery — row drifts sideways with scroll ───────── */
  const galleryRow = document.getElementById("galleryRow");
  if (galleryRow) {
    const mm = gsap.matchMedia();
    mm.add("(min-width: 761px)", () => {
      const overflow = galleryRow.scrollWidth - window.innerWidth;
      if (overflow > 0) {
        gsap.to(galleryRow, {
          x: -overflow,
          ease: "none",
          scrollTrigger: {
            trigger: ".gallery",
            start: "top 70%",
            end: "bottom 10%",
            scrub: 1,
          },
        });
      }
      gsap.utils.toArray("[data-g-item]").forEach((item, i) => {
        gsap.from(item, {
          y: 60,
          opacity: 0,
          duration: 0.8,
          delay: i * 0.07,
          ease: "power3.out",
          scrollTrigger: { trigger: ".gallery__row", start: "top 85%" },
        });
      });
    });
  }

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
          lenis.scrollTo(target, { offset: -20 });
        }
      });
    });
  }
})();
