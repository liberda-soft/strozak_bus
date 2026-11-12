/* Stróżak Bus — strona. Dane: data/network.js (window.NETWORK), te same co w aplikacji iOS. */
(() => {
  "use strict";
  const N = window.NETWORK;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ------------------------------------------------------------------ dane
  const STOPS = N.stops;
  const LINES = N.lines;
  const LINE = Object.fromEntries(LINES.map((l) => [l.id, l]));
  const VARIANTS = [];
  for (const l of LINES) {
    for (const dir of ["out", "back"]) {
      const v = l.variants[dir];
      v.line = l;
      v.dir = dir;
      v.cum = cumulative(v.geometry);
      VARIANTS.push(v);
    }
  }
  const stopName = (id) => STOPS[id]?.name ?? id;
  const TERMINALS = new Set(["zsti", "konina-palace", "poreba-chlipaly", "koninki-osrodek"]);

  function haversine(a, b) {
    const r = Math.PI / 180;
    const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(h));
  }
  function cumulative(g) {
    const c = [0];
    for (let i = 1; i < g.length; i++) c.push(c[i - 1] + haversine(g[i - 1], g[i]));
    return c;
  }
  function pointAt(v, d) {
    const c = v.cum, g = v.geometry;
    // dist[] w danych jest liczone na tej samej (uproszczonej) geometrii — skalujemy na wszelki wypadek
    d = (d * c[c.length - 1]) / v.length;
    if (d <= 0) return g[0];
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] < d) lo = mid; else hi = mid; }
    const f = (d - c[lo]) / ((c[hi] - c[lo]) || 1);
    return [g[lo][0] + (g[hi][0] - g[lo][0]) * f, g[lo][1] + (g[hi][1] - g[lo][1]) * f];
  }

  // ------------------------------------------------------------------ czas (Europe/Warsaw)
  const FMT = new Intl.DateTimeFormat("en-GB", {
    timeZone: N.calendar.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WD_PL = ["niedz.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob."];
  function parts(ms) {
    const o = {};
    for (const p of FMT.formatToParts(new Date(ms))) o[p.type] = p.value;
    const frac = ((ms % 1000) + 1000) % 1000 / 1000;
    return { ymd: `${o.year}-${o.month}-${o.day}`, wd: WD.indexOf(o.weekday), sec: +o.hour * 3600 + +o.minute * 60 + +o.second + frac };
  }
  function addDays(ymd, n) {
    const [y, m, d] = ymd.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
  }
  function warsawEpoch(ymd, h, m) {
    const [Y, M, D] = ymd.split("-").map(Number);
    let t = Date.UTC(Y, M - 1, D, h, m);
    for (let i = 0; i < 3; i++) {
      const p = parts(t);
      const dayShift = p.ymd === ymd ? 0 : p.ymd > ymd ? 86400 : -86400;
      t -= (dayShift + p.sec - (h * 3600 + m * 60)) * 1000;
    }
    return t;
  }
  const HOL = new Set(N.calendar.holidays);
  const NOS = new Set(N.calendar.noService);
  function dayType(ymd, wd) {
    if (wd === 0 || HOL.has(ymd) || NOS.has(ymd)) return null;
    return wd === 6 ? "saturday" : "weekday";
  }
  function isSchool(ymd, wd) {
    if (wd === 0 || wd === 6 || HOL.has(ymd)) return false;
    return !N.calendar.schoolBreaks.some(([a, b]) => ymd >= a && ymd <= b);
  }
  function tripsFor(v, ymd, wd) {
    const dt = dayType(ymd, wd);
    if (!dt) return [];
    const school = isSchool(ymd, wd);
    return (v.trips[dt] || []).filter((t) => !t.school || school);
  }
  const toSec = (t) => { const [h, m] = t.split(":").map(Number); return h * 3600 + m * 60; };
  const hm = (sec) => { sec = Math.round(sec / 60) * 60; sec = ((sec % 86400) + 86400) % 86400; return `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, "0")}`; };
  const hms = (sec) => { const s = Math.floor(sec); return `${String(Math.floor(s / 3600) % 24).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  function countdown(delta) {
    if (delta < 45) return "teraz";
    const min = Math.round(delta / 60);
    if (min < 60) return `za ${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `za ${h} h ${m} min` : `za ${h} h`;
  }

  // zegar symulacji (mapa i schemat); reszta strony zawsze w czasie rzeczywistym
  const clock = { mode: "live", speed: 1, base: 0, realBase: 0 };
  const simNow = () => (clock.mode === "live" ? Date.now() : clock.base + (Date.now() - clock.realBase) * clock.speed);

  // ------------------------------------------------------------------ busy z rozkładu
  const DWELL = 15;      // s postoju na przystanku
  const PRE = 150;       // s, bus widoczny na pętli przed odjazdem
  function activeBuses(p) {
    const out = [];
    for (const v of VARIANTS) {
      const total = v.minutes[v.minutes.length - 1] * 60;
      for (const trip of tripsFor(v, p.ymd, p.wd)) {
        const dep = toSec(trip.t);
        const el = p.sec - dep;
        if (el < -PRE || el > total + 20) continue;
        out.push(busState(v, trip, dep, el));
      }
    }
    return out.sort((a, b) => a.dep - b.dep);
  }
  function busState(v, trip, dep, el) {
    const M = v.minutes, last = M.length - 1;
    let i = 0;
    while (i < last && M[i + 1] * 60 <= el) i++;
    let d;
    if (el <= 0) d = v.dist[0];
    else if (i >= last) d = v.dist[last];
    else {
      const t0 = M[i] * 60, t1 = M[i + 1] * 60 - DWELL;
      if (el >= t1) d = v.dist[i + 1];
      else {
        const f = (el - t0) / (t1 - t0);
        const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
        d = v.dist[i] + (v.dist[i + 1] - v.dist[i]) * e;
      }
    }
    const next = el <= 0 ? 0 : Math.min(i + 1, last);
    return {
      id: `${v.line.id}-${v.dir}-${trip.t}`, v, trip, dep, el, d, next,
      eta: M[next] * 60 - el, pos: pointAt(v, d), done: el >= M[last] * 60,
      progress: Math.max(0, Math.min(1, el / (M[last] * 60))),
    };
  }
  function nextDepartures(p, { stop, dir, limit = 4 }) {
    const res = [];
    for (let dd = 0; dd < 5 && res.length < limit; dd++) {
      const ymd = addDays(p.ymd, dd), wd = (p.wd + dd) % 7;
      for (const v of VARIANTS) {
        if (dir && v.dir !== dir) continue;
        const idx = stop ? v.stops.indexOf(stop) : 0;
        if (idx < 0 || idx === v.stops.length - 1) continue;
        for (const trip of tripsFor(v, ymd, wd)) {
          const s = toSec(trip.t) + v.minutes[idx] * 60;
          const delta = dd * 86400 + s - p.sec;
          if (delta < -20) continue;
          res.push({ v, trip, idx, s, delta, dd, wd });
        }
      }
    }
    return res.sort((a, b) => a.delta - b.delta).slice(0, limit);
  }
  const whenLabel = (x) => (x.dd === 0 ? countdown(x.delta) : x.dd === 1 ? "jutro" : WD_PL[x.wd]);
  const badge = (l, extra = "") => `<span class="line-badge ${extra}" style="background:${l.color}">${l.id}</span>`;

  // ------------------------------------------------------------------ intro: logo rysuje się
  const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 4 612 162"><defs><clipPath id="in-tr"><rect x="-20" y="60" width="300" height="100"/></clipPath><clipPath id="in-ak"><rect x="400" y="40" width="220" height="92"/></clipPath></defs><g fill="none" stroke="#E8AE2C" stroke-width="20" stroke-linejoin="round"><path d="M10 150 H54 A16 16 0 0 0 70 134 V116 A16 16 0 0 0 54 100 H26 A16 16 0 0 1 10 84 V66 A16 16 0 0 1 26 50 H214"/><path d="M118 50 V160"/><g clip-path="url(#in-tr)"><path d="M166 160 V78 H190 A16 16 0 0 1 206 94 V102 A16 16 0 0 1 190 118 H166"/><path d="M184 118 L226 184"/></g><rect x="248" y="50" width="68" height="100" rx="24"/><path d="M346 50 H398 Q412 50 404 62 L356 138 Q348 150 364 150 H572"/><g clip-path="url(#in-ak)"><path d="M442 132 V70 A20 20 0 0 1 462 50 H474 A20 20 0 0 1 494 70 V132"/><path d="M442 98 H494"/><path d="M522 30 V140"/><path d="M522 102 L568 34"/><path d="M534 88 L570 140"/></g></g><g fill="#E8AE2C"><polygon points="0,140 12,140 12,160 -12,160"/><polygon points="212,40 236,40 214,60 212,60"/><polygon points="570,140 596,140 572,160 570,160"/><polygon points="268,34 286,34 306,12 288,12"/><rect x="364" y="12" width="22" height="20" rx="7"/></g></svg>`;
  function intro() {
    const el = $("#intro");
    let seen = false;
    try { seen = sessionStorage.getItem("sb-intro") === "1"; sessionStorage.setItem("sb-intro", "1"); } catch (e) { /* prywatne okno */ }
    if (REDUCED || seen || /[?&]nointro/.test(location.search)) { el.remove(); return Promise.resolve(); }
    $("#intro-logo").innerHTML = LOGO_SVG;
    $$("#intro-logo g[stroke] > *, #intro-logo g[stroke] g > *").forEach((p, i) => {
      if (p.getTotalLength) { p.setAttribute("stroke", "#E8AE2C"); p.style.setProperty("--len", Math.ceil(p.getTotalLength()) + 1); p.style.animationDelay = `${i * 0.06}s`; }
    });
    return new Promise((res) => setTimeout(() => { el.classList.add("is-done"); setTimeout(() => { el.remove(); }, 1200); res(); }, 1650));
  }

  // ------------------------------------------------------------------ nawigacja, reveal
  function chrome() {
    const nav = $("#nav");
    const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 20);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    $("#burger").addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      $("#burger").setAttribute("aria-expanded", open);
    });
    $$("#nav-links a").forEach((a) => a.addEventListener("click", () => nav.classList.remove("is-open")));
    const links = Object.fromEntries($$("#nav-links a").map((a) => [a.getAttribute("href").slice(1), a]));
    const so = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      $$("#nav-links a").forEach((a) => a.classList.remove("is-current"));
      links[e.target.id]?.classList.add("is-current");
    }), { rootMargin: "-45% 0px -50% 0px" });
    $$("main section[id], #oferta").forEach((el) => so.observe(el));

    const ro = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); ro.unobserve(e.target); } }), { threshold: 0.12 });
    $$(".reveal").forEach((el) => ro.observe(el));
  }

  // ------------------------------------------------------------------ hero
  function hero() {
    // bus jedzie drogą pod górami
    const road = $("#road"), bus = $("#hero-bus");
    const len = road.getTotalLength();
    const ridges = $$(".ridge");
    let mx = 0;
    addEventListener("pointermove", (e) => { mx = e.clientX / innerWidth - 0.5; }, { passive: true });
    const loop = (t) => {
      const f = ((t / 16000) % 1);
      const p = road.getPointAtLength(f * len), q = road.getPointAtLength(Math.min(len, f * len + 2));
      const a = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      bus.setAttribute("transform", `translate(${p.x} ${p.y - 9}) rotate(${a})`);
      const sy = Math.min(scrollY, 900);
      ridges.forEach((r, i) => { r.style.transform = `translate(${mx * (i + 1) * -10}px, ${sy * (0.06 + i * 0.05)}px)`; });
      if (!REDUCED) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    // najbliższe odjazdy
    let dir = "out";
    $$("#next-tabs button").forEach((b) => b.addEventListener("click", () => {
      dir = b.dataset.dir;
      $$("#next-tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
      renderNext(true);
    }));
    let lastKey = "";
    function renderNext(force) {
      const p = parts(Date.now());
      $("#hero-clock").textContent = hms(p.sec).slice(0, 5);
      const list = nextDepartures(p, { dir, limit: 4 });
      const key = dir + list.map((x) => x.v.line.id + x.trip.t + x.dd + whenLabel(x)).join();
      if (!force && key === lastKey) return;
      lastKey = key;
      $("#next-list").innerHTML = list.map((x) => {
        const from = stopName(x.v.from), to = stopName(x.v.to);
        return `<li class="next__item">${badge(x.v.line)}<div class="next__dest">${esc(to)}<small>z ${esc(from)}</small></div><div class="next__time"><b>${x.trip.t.replace(/^0/, "")}</b><small>${whenLabel(x)}</small></div></li>`;
      }).join("") || `<li class="next__item">Brak kursów w najbliższych dniach.</li>`;
      const dt = dayType(p.ymd, p.wd);
      $("#next-foot").textContent = !dt ? "Dziś kursy nie jeżdżą — pokazujemy najbliższe." :
        (dt === "weekday" ? (isSchool(p.ymd, p.wd) ? "Dziś: dzień roboczy, dzień nauki szkolnej." : "Dziś: dzień roboczy, bez kursów szkolnych.") : "Dziś: sobotni rozkład jazdy.");
    }
    renderNext(true);
    setInterval(renderNext, 1000);
  }

  // ------------------------------------------------------------------ mapa na żywo
  const live = { map: null, markers: new Map(), visible: new Set(["16", "17", "18"]), focus: null, buses: [] };
  function routeGeoJSON(v) {
    return { type: "Feature", properties: { line: v.line.id }, geometry: { type: "LineString", coordinates: v.geometry } };
  }
  function gradient(color, p) {
    if (p >= 0.995) return ["interpolate", ["linear"], ["line-progress"], 0, color, 1, color];
    if (p <= 0.002) return ["interpolate", ["linear"], ["line-progress"], 0, "rgba(0,0,0,0)", 1, "rgba(0,0,0,0)"];
    return ["interpolate", ["linear"], ["line-progress"], 0, color, p, color, p + 0.002, "rgba(0,0,0,0)", 1, "rgba(0,0,0,0)"];
  }
  const OFFSET = { 16: -3.2, 17: 0, 18: 3.2 };

  function initMap() {
    const chips = $("#map-chips");
    chips.innerHTML = LINES.map((l) => `<button class="chip" aria-pressed="true" data-line="${l.id}"><b style="background:${l.color}">${l.id}</b>${esc(l.name)}</button>`).join("");
    chips.addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      const id = b.dataset.line, on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", on);
      on ? live.visible.add(id) : live.visible.delete(id);
      if (live.map) for (const v of VARIANTS) if (v.line.id === id) for (const k of ["case", "line"]) live.map.setLayoutProperty(`${k}-${id}-${v.dir}`, "visibility", on ? "visible" : "none");
    });

    if (!window.maplibregl) {
      $("#map").innerHTML = `<p class="live__empty" style="margin:20px">Mapa nie mogła się załadować (brak połączenia). Lista busów obok działa dalej.</p>`;
      return;
    }
    const map = new maplibregl.Map({
      container: "map", style: "https://tiles.openfreemap.org/styles/positron", center: [20.09, 49.628], zoom: 12,
      attributionControl: { compact: true }, cooperativeGestures: true, maxZoom: 17, minZoom: 9, dragRotate: false,
    });
    live.map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      const set = (id, prop, val) => { if (map.getLayer(id)) try { map.setPaintProperty(id, prop, val); } catch (e) { /* inny styl */ } };
      set("background", "background-color", "#F6F6F3");
      set("water", "fill-color", "#CFE1EC");
      set("waterway", "line-color", "#B9D3E3");
      ["landcover_wood", "park"].forEach((id) => set(id, "fill-color", "#E4EBE2"));
      set("landuse_residential", "fill-color", "#EFEFEB");
      ["label_village", "label_town", "label_other", "label_city"].forEach((id) => { set(id, "text-color", "#5F6873"); set(id, "text-halo-color", "#FFFFFF"); });

      map.addSource("dem", { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 13, attribution: "Elevation: Mapzen/AWS Terrain Tiles" });
      map.addLayer({ id: "hills", type: "hillshade", source: "dem", paint: { "hillshade-shadow-color": "#7D8794", "hillshade-highlight-color": "#FFFFFF", "hillshade-accent-color": "#A9B1BB", "hillshade-exaggeration": 0.38, "hillshade-illumination-direction": 315 } }, map.getLayer("waterway") ? "waterway" : undefined);

      for (const v of VARIANTS) {
        const id = `${v.line.id}-${v.dir}`;
        map.addSource(`r-${id}`, { type: "geojson", data: routeGeoJSON(v), lineMetrics: true });
        map.addLayer({ id: `case-${id}`, type: "line", source: `r-${id}`, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 15, 11], "line-offset": OFFSET[v.line.id] } });
        map.addLayer({ id: `line-${id}`, type: "line", source: `r-${id}`, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-gradient": gradient(v.line.color, 0), "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.2, 15, 5.5], "line-offset": OFFSET[v.line.id] } });
      }
      const stopsFC = { type: "FeatureCollection", features: Object.entries(STOPS).map(([id, s]) => ({ type: "Feature", properties: { id, name: s.name, term: TERMINALS.has(id) ? 1 : 0 }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })) };
      map.addSource("stops", { type: "geojson", data: stopsFC });
      map.addLayer({ id: "stops", type: "circle", source: "stops", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["==", ["get", "term"], 1], 4.5, 2.2], 15, ["case", ["==", ["get", "term"], 1], 9, 6]], "circle-color": ["case", ["==", ["get", "term"], 1], "#E8AE2C", "#FFFFFF"], "circle-stroke-color": "#0E1116", "circle-stroke-width": 2 } });
      map.addLayer({ id: "stop-labels", type: "symbol", source: "stops", layout: { "text-field": ["get", "name"], "text-font": ["case", ["==", ["get", "term"], 1], ["literal", ["Noto Sans Bold"]], ["literal", ["Noto Sans Regular"]]], "text-size": ["case", ["==", ["get", "term"], 1], 13, 11.5], "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true, "symbol-sort-key": ["-", 1, ["get", "term"]] }, paint: { "text-color": ["case", ["==", ["get", "term"], 1], "#0E1116", "#3B424C"], "text-halo-color": "#FFFFFF", "text-halo-width": 1.8 }, filter: ["any", ["==", ["get", "term"], 1], [">=", ["zoom"], 13]] });
      map.on("mouseenter", "stops", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "stops", () => { map.getCanvas().style.cursor = ""; });
      map.on("click", "stops", (e) => {
        const id = e.features[0].properties.id;
        new maplibregl.Popup({ offset: 12, maxWidth: "280px" }).setLngLat([STOPS[id].lon, STOPS[id].lat]).setHTML(stopPopup(id)).addTo(map);
      });

      const b = new maplibregl.LngLatBounds();
      VARIANTS.forEach((v) => v.geometry.forEach((c) => b.extend(c)));
      map.fitBounds(b, { padding: { top: 70, bottom: 110, left: 60, right: 60 }, duration: 0 });

      // linie "rysują się" po wejściu w widok
      const io = new IntersectionObserver((es) => {
        if (!es[0].isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const anim = (t) => {
          const p = REDUCED ? 1 : Math.min(1, (t - t0) / 2200);
          const e = 1 - (1 - p) ** 3;
          for (const v of VARIANTS) map.setPaintProperty(`line-${v.line.id}-${v.dir}`, "line-gradient", gradient(v.line.color, e));
          if (p < 1) requestAnimationFrame(anim);
        };
        requestAnimationFrame(anim);
      }, { threshold: 0.3 });
      io.observe($("#map"));
    });
  }

  function stopPopup(id) {
    const p = parts(Date.now());
    const deps = nextDepartures(p, { stop: id, limit: 5 });
    return `<div class="pop"><h4>${esc(STOPS[id].name)}</h4><p>Strefa ${STOPS[id].zone} · ${esc(N.zones[STOPS[id].zone].name)}</p><ul>${deps.map((x) => `<li>${badge(x.v.line)}<b>${hm(x.s)}</b><span>→ ${esc(stopName(x.v.to))}</span></li>`).join("") || "<li>brak odjazdów</li>"}</ul></div>`;
  }

  function busPopup(b) {
    const v = b.v, M = v.minutes;
    const rows = [];
    for (let k = Math.max(b.next, 0); k < v.stops.length && rows.length < 4; k++) rows.push(`<li><b>${hm(b.dep + M[k] * 60)}</b><span>${esc(stopName(v.stops[k]))}</span></li>`);
    return `<div class="pop"><h4>${badge(v.line)} → ${esc(stopName(v.to))}</h4><p>Kurs ${b.trip.t} z ${esc(stopName(v.from))}${b.trip.school ? " · szkolny" : ""}</p><ul>${rows.join("")}</ul></div>`;
  }

  function busNextText(b) {
    if (b.el <= 0) return `Odjazd z pętli <b>${countdown(-b.el).replace("teraz", "zaraz")}</b>`;
    if (b.done) return `Dojechał: <b>${esc(stopName(b.v.to))}</b>`;
    if (b.eta <= DWELL) return `Na przystanku <b>${esc(stopName(b.v.stops[b.next]))}</b>`;
    return `Następny: ${esc(stopName(b.v.stops[b.next]))} · <b>${b.eta < 60 ? "< 1 min" : Math.round(b.eta / 60) + " min"}</b>`;
  }

  let listKey = "";
  function renderBusList(buses, p) {
    const vis = buses.filter((b) => live.visible.has(b.v.line.id));
    const key = vis.map((b) => b.id).join();
    const ul = $("#bus-list");
    $("#live-empty").hidden = vis.length > 0;
    if (!vis.length) {
      const nx = nextDepartures(p, { limit: 1 })[0];
      $("#live-empty").innerHTML = clock.mode === "live"
        ? `Teraz żaden bus nie jest w trasie${nx ? ` — najbliższy kurs: <b>${badge(nx.v.line)} ${nx.trip.t}</b> ${whenLabel(nx)}` : ""}. Włącz symulację, żeby zobaczyć poranny szczyt.`
        : "W tej chwili symulacji żaden bus nie jest w trasie.";
    }
    if (key !== listKey) {
      listKey = key;
      ul.innerHTML = vis.map((b) => `<li class="bus" data-id="${b.id}"><div class="bus__top">${badge(b.v.line)}<div class="bus__dest">→ ${esc(stopName(b.v.to))}<small>kurs ${b.trip.t} z ${esc(stopName(b.v.from))}${b.trip.school ? " · szkolny" : ""}</small></div></div><div class="bus__bar"><i style="background:${b.v.line.color};width:0"></i></div><p class="bus__next"></p></li>`).join("");
    }
    for (const b of vis) {
      const li = ul.querySelector(`[data-id="${b.id}"]`);
      if (!li) continue;
      li.querySelector("i").style.width = `${(b.progress * 100).toFixed(1)}%`;
      li.querySelector(".bus__next").innerHTML = busNextText(b);
      li.classList.toggle("is-focus", live.focus === b.id);
    }
  }

  function updateMarkers(buses) {
    const map = live.map;
    if (!map || !map.loaded()) return;
    const seen = new Set();
    for (const b of buses) {
      if (!live.visible.has(b.v.line.id)) continue;
      seen.add(b.id);
      let m = live.markers.get(b.id);
      if (!m) {
        const el = document.createElement("div");
        el.className = "bus-marker";
        el.innerHTML = `<div class="bus-marker__dot" style="--c:${b.v.line.color}">${b.v.line.id}</div>`;
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", `Linia ${b.v.line.id} do ${stopName(b.v.to)}`);
        m = new maplibregl.Marker({ element: el }).setLngLat(b.pos).addTo(map);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const cur = live.buses.find((x) => x.id === b.id) || b;
          live.focus = b.id;
          new maplibregl.Popup({ offset: 18, maxWidth: "280px" }).setLngLat(cur.pos).setHTML(busPopup(cur)).addTo(map);
        });
        live.markers.set(b.id, m);
      } else m.setLngLat(b.pos);
      m.getElement().classList.toggle("is-focus", live.focus === b.id);
    }
    for (const [id, m] of live.markers) if (!seen.has(id)) { m.remove(); live.markers.delete(id); }
  }

  function liveControls() {
    const now = $("#btn-now"), sim = $("#btn-sim");
    now.addEventListener("click", () => {
      clock.mode = "live"; clock.speed = 1;
      now.classList.add("is-active"); sim.classList.remove("is-active");
    });
    sim.addEventListener("click", () => {
      // najbliższy dzień nauki szkolnej, 6:50 — poranny szczyt
      const p = parts(Date.now());
      let ymd = p.ymd, wd = p.wd;
      for (let i = 0; i < 30; i++) {
        if (dayType(ymd, wd) === "weekday" && isSchool(ymd, wd) && (i > 0 || p.sec < 9 * 3600)) break;
        ymd = addDays(ymd, 1); wd = (wd + 1) % 7;
      }
      clock.mode = "sim"; clock.speed = 20; clock.base = warsawEpoch(ymd, 6, 50); clock.realBase = Date.now();
      sim.classList.add("is-active"); now.classList.remove("is-active");
      $("#na-zywo").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
    });
    $("#bus-list").addEventListener("click", (e) => {
      const li = e.target.closest(".bus"); if (!li) return;
      live.focus = li.dataset.id;
      const b = live.buses.find((x) => x.id === li.dataset.id);
      if (b && live.map) live.map.flyTo({ center: b.pos, zoom: 14, duration: REDUCED ? 0 : 1200 });
    });
  }

  // ------------------------------------------------------------------ schemat sieci
  const SCH = (() => {
    const TRUNK = ["zsti", "rondo", "gronoszowa", "gronoszowa-1", "gronoszowa-2", "podobin-1", "podobin-2", "podobin-3", "niedzwiedz-szk"];
    const B16 = ["niedzwiedz-c", "konina-domagaly", "konina-dziolek", "konina-szkola", "konina-napory", "konina-krzesowo", "konina-halamy", "konina-palace"];
    const SH = ["niedzwiedz-ug", "niedzwiedz-oz", "poreba-krokus", "poreba-kaciki"];
    const B17 = ["poreba-szkola", "poreba-buchole", "poreba-kopajdy", "poreba-bastowka", "poreba-chlipaly"];
    const B18 = ["poreba-zalew", "poreba-rusnaki", "poreba-borek", "poreba-malarze", "poreba-garaze", "poreba-koninki", "koninki-osrodek"];
    const S = 52;
    const pos = { 16: {}, 17: {}, 18: {} };   // pozycja przystanku na danej linii
    const marks = [];                          // znaczniki przystanków
    TRUNK.forEach((id, i) => {
      const x = 60 + i * S;
      pos[16][id] = [x, 253]; pos[17][id] = [x, 260]; pos[18][id] = [x, 267];
      marks.push({ id, x, y: 260, kind: "trunk", label: "up" });
    });
    B16.forEach((id, i) => { const x = 686 + i * S; pos[16][id] = [x, 130]; marks.push({ id, x, y: 130, kind: "c", label: "up", line: "16" }); });
    SH.forEach((id, i) => { const x = 660 + i * S; pos[17][id] = [x, 386]; pos[18][id] = [x, 394]; marks.push({ id, x, y: 390, kind: "shared", label: "up" }); });
    B17.forEach((id, i) => { const x = 868 + i * S; pos[17][id] = [x, 386]; marks.push({ id, x, y: 386, kind: "c", label: "up", line: "17" }); });
    B18.forEach((id, i) => { const x = 954 + i * S; pos[18][id] = [x, 490]; marks.push({ id, x, y: 490, kind: "c", label: "down", line: "18" }); });
    const paths = {
      16: "M60 253 H516 L639 130 H1050",
      17: "M60 260 H520 L646 386 H1076",
      18: "M60 267 H512 L639 394 H840 L936 490 H1266",
    };
    return { pos, marks, paths, W: 1530, H: 610 };
  })();

  function schema() {
    const svg = $("#schema");
    svg.setAttribute("viewBox", `0 0 ${SCH.W} ${SCH.H}`);
    const NS = "http://www.w3.org/2000/svg";
    const zones = [[30, 294, 1], [294, 727, 2], [727, SCH.W - 10, 3]];
    let html = zones.map(([a, b, z], i) => `<rect class="zone-bg" x="${a}" y="16" width="${b - a}" height="${SCH.H - 32}" rx="18" style="opacity:${i % 2 ? 0 : 1}"/><text class="zone-lab" x="${z === 3 ? b - 18 : a + 18}" y="44" text-anchor="${z === 3 ? "end" : "start"}">STREFA ${z} · ${esc(N.zones[z].name.toUpperCase())}</text>`).join("");
    html += LINES.map((l) => `<path class="ln" d="${SCH.paths[l.id]}" stroke="#FFFFFF" stroke-width="13"/>`).join("");
    html += LINES.map((l) => `<path class="ln ln-draw" id="sch-${l.id}" d="${SCH.paths[l.id]}" stroke="${l.color}"/>`).join("");
    for (const m of SCH.marks) {
      const term = TERMINALS.has(m.id);
      let shape;
      if (m.kind === "trunk") shape = `<rect x="${m.x - 8}" y="${m.y - 14}" width="16" height="28" rx="8"/>`;
      else if (m.kind === "shared") shape = `<rect x="${m.x - 8}" y="${m.y - 11}" width="16" height="22" rx="8"/>`;
      else shape = `<circle cx="${m.x}" cy="${m.y}" r="${term ? 9 : 7}" ${term ? `style="stroke:${LINE[m.line].color};stroke-width:4"` : ""}/>`;
      const up = m.label === "up";
      const off = m.kind === "trunk" ? 20 : 15;
      const tx = m.x + 4, ty = up ? m.y - off : m.y + off + 6;
      const label = stopName(m.id).replace(/^Poręba Wielka /, "").replace(/^Konina /, "").replace(/^Mszana Dolna /, "Mszana D. ").replace(/^Niedźwiedź /, "Niedźwiedź ");
      // pętle końcowe: nazwa poziomo za końcem linii
      const flat = term && m.id !== "zsti";
      const text = flat
        ? `<text class="term" x="${m.x + 18}" y="${m.y + 5}">${esc(stopName(m.id))}</text>`
        : `<text class="${term ? "term" : ""}" x="${tx}" y="${ty}" transform="rotate(${up ? -45 : 45} ${tx} ${ty})">${esc(term ? stopName(m.id) : label)}</text>`;
      html += `<g class="st" data-id="${m.id}" tabindex="0" role="button" aria-label="${esc(stopName(m.id))}">${shape}${text}</g>`;
    }
    html += `<g id="sch-buses"></g>`;
    svg.innerHTML = html;
    // długości linii do animacji rysowania i pozycje przystanków na ścieżce
    const lens = {};
    for (const l of LINES) {
      const p = $(`#sch-${l.id}`);
      const L = p.getTotalLength();
      p.style.setProperty("--len", Math.ceil(L));
      const at = {};
      for (const [id, [x, y]] of Object.entries(SCH.pos[l.id])) {
        let best = 1e9, bl = 0;
        for (let s = 0; s <= L; s += 2) { const q = p.getPointAtLength(s); const d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < best) { best = d; bl = s; } }
        at[id] = bl;
      }
      lens[l.id] = { el: p, at };
    }
    SCH.lens = lens;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { $(".schema").classList.add("is-in"); io.disconnect(); } }, { threshold: 0.25 });
    io.observe($(".schema"));
    $("#legend").innerHTML = LINES.map((l) => `<span class="chip"><b style="background:${l.color}">${l.id}</b>${esc(l.long)}</span>`).join("");

    const panel = $("#stop-panel");
    const open = (id) => {
      $$(".st").forEach((g) => g.classList.toggle("is-sel", g.dataset.id === id));
      const s = STOPS[id];
      $("#sp-zone").textContent = `Strefa ${s.zone} · linie ${s.lines.join(", ")}`;
      $("#sp-name").textContent = s.name;
      const p = parts(Date.now());
      const deps = nextDepartures(p, { stop: id, limit: 6 });
      $("#sp-deps").innerHTML = deps.map((x) => `<div class="sp-row">${badge(x.v.line)}<span>→ ${esc(stopName(x.v.to))}</span><b>${hm(x.s)}</b><em>${whenLabel(x)}</em></div>`).join("") || `<p class="note">Brak odjazdów (to przystanek końcowy).</p>`;
      panel.hidden = false;
    };
    svg.addEventListener("click", (e) => { const g = e.target.closest(".st"); if (g) open(g.dataset.id); });
    svg.addEventListener("keydown", (e) => { const g = e.target.closest(".st"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(g.dataset.id); } });
    $("#stop-close").addEventListener("click", () => { panel.hidden = true; $$(".st").forEach((g) => g.classList.remove("is-sel")); });
  }

  let schKey = "";
  function updateSchemaBuses(buses) {
    if (!SCH.lens) return;
    const g = $("#sch-buses");
    const vis = buses;
    const key = vis.map((b) => b.id).join();
    if (key !== schKey) {
      schKey = key;
      g.innerHTML = vis.map((b) => `<g class="sbus" data-id="${b.id}"><circle class="halo" r="12" stroke="${b.v.line.color}"/><circle r="8" fill="#E8AE2C"/></g>`).join("");
    }
    for (const b of vis) {
      const el = g.querySelector(`[data-id="${b.id}"]`);
      const L = SCH.lens[b.v.line.id];
      const v = b.v, i = Math.max(0, Math.min(b.next - (b.el <= 0 ? 0 : 1), v.stops.length - 2));
      const a = L.at[v.stops[i]], c = L.at[v.stops[i + 1]];
      const f = b.el <= 0 ? 0 : Math.max(0, Math.min(1, (b.d - v.dist[i]) / ((v.dist[i + 1] - v.dist[i]) || 1)));
      const q = L.el.getPointAtLength(a + (c - a) * f);
      el.setAttribute("transform", `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`);
    }
  }

  // ------------------------------------------------------------------ rozkład
  function timetable() {
    const st = { line: "16", dir: "out", day: "weekday", stop: null };
    const today = parts(Date.now());
    const dt = dayType(today.ymd, today.wd);
    if (dt === "saturday") st.day = "saturday";
    $$("#tt-day button").forEach((b) => b.setAttribute("aria-selected", b.dataset.day === st.day));

    $("#tt-lines").innerHTML = LINES.map((l) => `<button role="tab" data-line="${l.id}" style="--c:${l.color}" aria-selected="${l.id === st.line}"><b style="background:${l.color}">${l.id}</b>${esc(l.name)}</button>`).join("");
    const renderDir = () => {
      const l = LINE[st.line];
      $("#tt-dir").innerHTML = ["out", "back"].map((d) => `<button data-dir="${d}" aria-selected="${d === st.dir}">→ ${esc(stopName(l.variants[d].to))}</button>`).join("");
    };
    const renderStops = () => {
      const v = LINE[st.line].variants[st.dir];
      const opts = v.stops.slice(0, -1);
      if (!opts.includes(st.stop)) st.stop = opts[0];
      $("#tt-stop").innerHTML = opts.map((id) => `<option value="${id}" ${id === st.stop ? "selected" : ""}>${esc(STOPS[id].full)}</option>`).join("");
    };
    const render = () => {
      const v = LINE[st.line].variants[st.dir];
      const idx = v.stops.indexOf(st.stop);
      const trips = v.trips[st.day] || [];
      const p = parts(Date.now());
      const isToday = dayType(p.ymd, p.wd) === st.day;
      const schoolToday = isSchool(p.ymd, p.wd);
      let nextMarked = false;
      $("#tt-times").innerHTML = trips.length ? trips.map((t, k) => {
        const s = toSec(t.t) + v.minutes[idx] * 60;
        const runsToday = isToday && (!t.school || schoolToday);
        let cls = "", sub = t.school ? "dni nauki" : "";
        if (isToday) {
          if (!runsToday) { cls = "is-past"; sub = "dziś nie kursuje"; }
          else if (s < p.sec - 30) cls = "is-past";
          else if (!nextMarked) { cls = "is-next"; nextMarked = true; sub = countdown(s - p.sec); }
        }
        return `<div class="dep ${cls}" style="animation-delay:${k * 25}ms">${t.school ? '<span class="badge badge--s">S</span>' : ""}<b>${hm(s)}</b><small>${sub}</small></div>`;
      }).join("") : `<p class="tt__empty">Na tej linii w soboty nie ma kursów.</p>`;
      // pełna macierz
      if (!trips.length) { $("#tt-matrix").innerHTML = ""; return; }
      const head = `<tr><th>Przystanek</th>${trips.map((t) => `<th class="${t.school ? "s" : ""}">${t.school ? "S " : ""}${t.t.replace(/^0/, "")}</th>`).join("")}</tr>`;
      const rows = v.stops.map((sid, i) => `<tr><td>${esc(STOPS[sid].full)}</td>${trips.map((t) => `<td>${hm(toSec(t.t) + v.minutes[i] * 60)}</td>`).join("")}</tr>`).join("");
      $("#tt-matrix").innerHTML = `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    };
    $("#tt-lines").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      st.line = b.dataset.line;
      $$("#tt-lines button").forEach((x) => x.setAttribute("aria-selected", x === b));
      renderDir(); renderStops(); render();
    });
    $("#tt-dir").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      st.dir = b.dataset.dir; renderDir(); renderStops(); render();
    });
    $("#tt-day").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      st.day = b.dataset.day;
      $$("#tt-day button").forEach((x) => x.setAttribute("aria-selected", x === b));
      render();
    });
    $("#tt-stop").addEventListener("change", (e) => { st.stop = e.target.value; render(); });
    renderDir(); renderStops(); render();
    setInterval(render, 30000);
  }

  // ------------------------------------------------------------------ bilety
  const PLN = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
  function tickets() {
    const F = N.fares;
    $("#zones").innerHTML = Object.entries(N.zones).map(([z, info]) => `<div class="zone" style="--o:${0.45 + z * 0.18}"><div class="zone__n">${z}</div><h3>${esc(info.name)}</h3><p>${esc(info.desc)}</p></div>`).join("");
    const byZone = {};
    for (const [id, s] of Object.entries(STOPS)) (byZone[s.zone] ||= []).push(id);
    const options = Object.entries(byZone).map(([z, ids]) => `<optgroup label="Strefa ${z} · ${esc(N.zones[z].name)}">${ids.map((id) => `<option value="${id}">${esc(STOPS[id].name)}</option>`).join("")}</optgroup>`).join("");
    const from = $("#calc-from"), to = $("#calc-to");
    from.innerHTML = options; to.innerHTML = options;
    from.value = "konina-szkola"; to.value = "zsti";
    let disc = "pupil";
    const SHORT = { normal: "Normalny", pupil: "Uczeń", student: "Student" };
    $("#calc-disc").innerHTML = F.discounts.map((d) => `<button data-id="${d.id}" aria-selected="${d.id === disc}" title="${esc(d.name)}">${esc(SHORT[d.id] || d.name)}${d.percent ? ` −${d.percent}%` : ""}</button>`).join("");
    const render = () => {
      const za = STOPS[from.value].zone, zb = STOPS[to.value].zone;
      const n = Math.abs(za - zb) + 1;
      const d = F.discounts.find((x) => x.id === disc);
      const month = F.monthly[n] * (100 - d.percent) / 100;
      $("#calc-zones").innerHTML = `Przejazd przez <b>${n} ${n === 1 ? "strefę" : "strefy"}</b> (strefa ${Math.min(za, zb)}${n > 1 ? `–${Math.max(za, zb)}` : ""}).`;
      $("#price-single").innerHTML = PLN.format(F.single[n]);
      $("#price-ten").innerHTML = `${PLN.format(F.tenRide[n])}<s>${PLN.format(F.single[n] * 10)}</s>`;
      $("#price-month").innerHTML = `${PLN.format(month)}${d.percent ? `<s>${PLN.format(F.monthly[n])}</s>` : ""}`;
      $("#price-month-desc").textContent = d.percent
        ? `Imienny, ${F.monthlyDays} dni od wybranej daty, bez limitu przejazdów. Wymaga: ${d.doc}.`
        : `Imienny, ${F.monthlyDays} dni od wybranej daty, bez limitu przejazdów. W iPhonie i w Apple Wallet.`;
      [$("#price-single"), $("#price-ten"), $("#price-month")].forEach((el) => { el.animate?.([{ opacity: 0.2, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 400, easing: "cubic-bezier(.22,1,.36,1)" }); });
    };
    from.addEventListener("change", render);
    to.addEventListener("change", render);
    $("#calc-swap").addEventListener("click", () => { [from.value, to.value] = [to.value, from.value]; render(); });
    $("#calc-disc").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      disc = b.dataset.id;
      $$("#calc-disc button").forEach((x) => x.setAttribute("aria-selected", x === b));
      render();
    });
    render();
  }

  // ------------------------------------------------------------------ makieta biletu
  const DAY_COLORS = ["#E8AE2C", "#12B886", "#3B82F6", "#FF5A36", "#A78BFA", "#F472B6", "#22D3EE"];
  function aztec(seed) {
    // kod w stylu Aztec: centralny "celownik" + moduły danych z ziarna
    let s = 0;
    for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
    const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000) / 1000; };
    const n = 27, c = 13, out = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const r = Math.max(Math.abs(x - c), Math.abs(y - c));
      let on;
      if (r <= 4) on = r % 2 === 0;
      else if (r === 5) on = (x === c - 5 && y <= c - 4) || (y === c - 5 && x <= c - 4) || (x === c + 5 && y === c - 5) || rnd() > 0.55;
      else on = rnd() > 0.5;
      if (on) out.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
    return out.join("");
  }
  function ticketMock() {
    const p = parts(Date.now());
    const [y, m, d] = p.ymd.split("-");
    const end = addDays(p.ymd, N.fares.monthlyDays - 1).split("-");
    $("#ticket-valid").textContent = `${d}.${m} – ${end[2]}.${end[1]}`;
    $("#pass-valid").textContent = `${end[2]}.${end[1]}.${end[0]}`;
    $("#aztec").innerHTML = aztec(`SB-${p.ymd}-0016-JK`);
    const doy = Math.floor((Date.UTC(+y, +m - 1, +d) - Date.UTC(+y, 0, 0)) / 864e5);
    const col = DAY_COLORS[doy % DAY_COLORS.length];
    $("#ticket-daydot").style.background = col;
    const tick = () => {
      const q = parts(Date.now());
      $("#ticket-clock").textContent = hms(q.sec);
      $("#phone-time").textContent = hm(q.sec - 30);
    };
    tick();
    setInterval(tick, 250);
    // lekki obrót telefonu za kursorem
    const phone = $("#phone"), stage = $(".app__stage");
    if (!REDUCED && matchMedia("(hover:hover)").matches) {
      stage.addEventListener("pointermove", (e) => {
        const r = stage.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5, yy = (e.clientY - r.top) / r.height - 0.5;
        phone.style.transform = `rotateY(${x * 16 - 4}deg) rotateX(${-yy * 10 + 2}deg)`;
      });
      stage.addEventListener("pointerleave", () => { phone.style.transform = ""; });
    }
    // zrzuty ekranu z aplikacji (jeśli są)
    const shots = window.APP_SHOTS || [];
    if (shots.length) {
      const box = $("#app-shots");
      box.hidden = false;
      box.innerHTML = shots.map((s) => `<figure><img src="${s.src}" alt="${esc(s.caption)}" loading="lazy"><figcaption>${esc(s.caption)}</figcaption></figure>`).join("");
    }
  }

  // ------------------------------------------------------------------ przewozy i flota
  const SERVICE_ICON = { wesela: "i-rings", komunie: "i-candle", szkolne: "i-school", indywidualne: "i-mountain", inne: "i-spark" };
  function offer() {
    $("#services").innerHTML = N.services.map((s, i) => `<article class="service reveal" style="transition-delay:${i * 70}ms"><svg class="i" viewBox="0 0 24 24"><use href="#${SERVICE_ICON[s.id]}"/></svg><h3>${esc(s.name)}</h3><p>${esc(s.desc)}</p></article>`).join("");
    $("#fleet").innerHTML = N.fleet.map((f, i) => `<article class="veh reveal" style="transition-delay:${i * 80}ms"><div class="veh__img"><img src="assets/img/${f.photos[0]}" alt="${esc(f.name)} ${f.seats} miejsc" loading="lazy"></div><div class="veh__body"><h3>${esc(f.name)}</h3><div class="veh__seats"><b>${f.seats}</b><span>miejsc</span></div><div class="veh__tags">${f.belts ? `<span><svg class="i" viewBox="0 0 24 24"><use href="#i-shield"/></svg>pasy bezpieczeństwa</span>` : `<span><svg class="i" viewBox="0 0 24 24"><use href="#i-mountain"/></svg>wycieczki i dalekie trasy</span>`}</div></div></article>`).join("");
    // zdjęcia zmieniają się po najechaniu (drugie ujęcie pojazdu)
    $$(".veh").forEach((el, i) => {
      const img = el.querySelector("img"), ph = N.fleet[i].photos;
      if (ph.length < 2) return;
      el.addEventListener("mouseenter", () => { img.src = `assets/img/${ph[1]}`; });
      el.addEventListener("mouseleave", () => { img.src = `assets/img/${ph[0]}`; });
    });
  }

  // ------------------------------------------------------------------ pętla
  function tickLive() {
    const p = parts(simNow());
    const buses = activeBuses(p);
    live.buses = buses;
    $("#time-readout").textContent = hms(p.sec);
    $("#time-mode").textContent = clock.mode === "live" ? "teraz" : `symulacja ×${clock.speed} · ${WD_PL[p.wd]} ${p.ymd.slice(8)}.${p.ymd.slice(5, 7)}`;
    return { p, buses };
  }
  function loop() {
    let last = 0;
    const frame = (t) => {
      const { p, buses } = tickLive();
      updateMarkers(buses);
      updateSchemaBuses(buses.filter((b) => live.visible.has(b.v.line.id)));
      if (t - last > 500) { last = t; renderBusList(buses, p); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ start
  intro().then(() => {});
  chrome();
  hero();
  schema();
  timetable();
  tickets();
  ticketMock();
  offer();
  liveControls();
  // mapa ładuje się, gdy sekcja jest blisko widoku
  const mo = new IntersectionObserver((es) => { if (es[0].isIntersecting) { mo.disconnect(); initMap(); } }, { rootMargin: "800px" });
  mo.observe($("#na-zywo"));
  loop();
  // reveal dla elementów dodanych dynamicznie
  const ro = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); ro.unobserve(e.target); } }), { threshold: 0.1 });
  $$(".service.reveal, .veh.reveal").forEach((el) => ro.observe(el));
})();
