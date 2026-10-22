/* Motor de consultas del asistente de IA.
 *
 * El asistente (widget flotante de index.html) solo veía el texto de la pestaña abierta. Este módulo lee la pregunta,
 * detecta lugares, período y tema, calcula las cifras con los mismos datos del tablero (todas las pestañas) y las
 * entrega como un bloque de texto («RESULTADOS CALCULADOS») que se envía a la IA junto con la pregunta. La IA solo
 * redacta y compara con esas cifras; no calcula ni inventa.
 *
 * index.html expone window.AS_CTX (estado y datos del módulo); el widget llama a ASISTENTE_DATOS.consulta(pregunta).
 */
(() => {
  "use strict";
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const MES_ABR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const MAX_CHARS = 7000;
  const norm = s => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fmt = (v, d = 0) => (v == null || isNaN(v)) ? "s/d" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const cache = {};
  const getJSON = url => (cache[url] ||= fetch(url).then(r => r.ok ? r.json() : null).catch(() => null));
  const X = () => window.AS_CTX;

  // ------------------------------------------------------------------ lugares
  let IDX = null;
  const ALIAS_DEP = { "san andres": "88", "providencia": "88", "bogota": "11", "valle": "76", "guajira": "44", "la guajira": "44", "boyaca": "15", "choco": "27" };
  function indice() {
    if (IDX) return IDX;
    const { GEO_DEP, GEO_MUN } = X(), dep = [], mun = {};
    for (const f of GEO_DEP.features) {
      const c = f.properties.DPTO_CCDGO, n = norm(f.properties.DPTO_CNMBR);
      dep.push({ cod: c, n });
      const corto = n.replace(/^archipielago de /, "").split(",")[0].replace(/\s+d\.?c\.?$/, "");
      if (corto !== n) dep.push({ cod: c, n: corto });
    }
    for (const [a, c] of Object.entries(ALIAS_DEP)) dep.push({ cod: c, n: a });
    dep.sort((a, b) => b.n.length - a.n.length);
    for (const f of GEO_MUN.features) (mun[norm(f.properties.MPIO_CNMBR)] ||= []).push(f.properties.MPIO_CCNCT);
    return (IDX = { dep, mun, munNombres: Object.keys(mun).filter(n => n.length >= 4).sort((a, b) => b.length - a.length) });
  }
  const nombre = c => c === X().NAL ? "Colombia" : c.length === 2 ? X().nomDepto(c) : `${X().MUN_NOM[c] || c} (${X().nomDepto(c.slice(0, 2))})`;

  function lugares(pn) {
    const { st, NAL } = X(), I = indice(), out = [], notas = []; let t = ` ${pn} `;
    const marca = (m, k) => { t = t.slice(0, m.index) + " ".repeat(m[0].length) + t.slice(m.index + m[0].length); return k; };
    if (/\b(este|esta) (municipio|departamento|zona|lugar)\b|\baqui\b/.test(t)) {
      out.push(st.mpio || (st.dpto !== NAL ? st.dpto : NAL));
    }
    // departamentos (los nombres más largos primero para que «norte de santander» no se confunda con «santander»)
    const encontrados = [];
    for (const { cod, n } of I.dep) {
      const m = new RegExp("\\b" + reEsc(n) + "\\b").exec(t);
      if (m) { encontrados.push({ pos: m.index, cod }); marca(m); }
    }
    t = t.replace(/\bcolombia\b/g, "        ");   // «Colombia» es el país aunque exista un municipio con ese nombre (Huila)
    // municipios: solo si la pregunta los introduce («en Ortega», «municipio de Ortega», «Ortega y Chaparral»)
    const cue = "(?:en|de|del|para|sobre|por|municipio|municipios|entre|vs|versus|contra|frente a|comparado con|comparar|compara)";
    const hayPrevio = pos => encontrados.some(e => e.pos < pos);
    for (const n of I.munNombres) {
      const re = new RegExp("\\b(?:(" + cue + ")\\s+(?:de\\s+|del\\s+)?|(y|con|que|e)\\s+)" + reEsc(n) + "\\b", "g");
      let m; while ((m = re.exec(t))) {
        if (m[2] && !hayPrevio(m.index)) continue;
        const cods = I.mun[n], dpMencionados = encontrados.map(e => e.cod);
        const elegido = cods.find(c => dpMencionados.includes(c.slice(0, 2))) || cods.find(c => c.slice(0, 2) === st.dpto) || cods[0];
        if (cods.length > 1 && !dpMencionados.includes(elegido.slice(0, 2)))
          notas.push(`hay ${cods.length} municipios llamados «${n}»; se usó ${nombre(elegido)} (si no es el que busca, indique el departamento)`);
        encontrados.push({ pos: m.index, cod: elegido });
        t = t.slice(0, m.index) + " ".repeat(m[0].length) + t.slice(m.index + m[0].length);
        break;
      }
    }
    encontrados.sort((a, b) => a.pos - b.pos);
    for (const e of encontrados) if (!out.includes(e.cod)) out.push(e.cod);
    if (/\b(colombia|pais|nacional|nivel nacional|todo el pais)\b/.test(pn) && !out.includes(NAL)) out.push(NAL);
    return { lista: out.slice(0, 6), notas: [...new Set(notas)] };
  }

  // ------------------------------------------------------------------ período y tema
  function periodo(pn) {
    const { DATOS } = X(), a0 = DATOS.meta.anio_ini, a1 = DATOS.meta.anio_fin;
    const anios = new Set(), meses = new Set();
    for (const m of pn.matchAll(/\b(?:entre |de |desde )?(20[12]\d)\s*(?:-|a|al|hasta|y)\s*(20[12]\d)\b/g)) {
      const a = +m[1], b = +m[2]; if (a <= b && b - a <= 13) for (let y = a; y <= b; y++) anios.add(y);
    }
    for (const m of pn.matchAll(/\b(20[12]\d)\b/g)) anios.add(+m[1]);
    const ult = /\bultim[oa]s? (\d{1,2}) anos\b/.exec(pn);
    if (ult) for (let y = a1 - 1; y > a1 - 1 - Math.min(+ult[1], 12); y--) anios.add(y);
    if (/\b(este ano|ano actual|en curso)\b/.test(pn)) anios.add(a1);
    if (/\bano pasado|ano anterior\b/.test(pn)) anios.add(a1 - 1);
    MESES.forEach((m, i) => { if (new RegExp("\\b" + m + "\\b").test(pn) || new RegExp("\\b" + MES_ABR[i] + "\\.?(?=\\s|$|[,;])").test(pn)) meses.add(i); });
    if (/\bsetiembre\b/.test(pn)) meses.add(8);
    return { anios: [...anios].filter(y => y >= a0 && y <= a1 + 0).sort(), fuera: [...anios].filter(y => y < a0 || y > a1), meses: [...meses].sort((a, b) => a - b) };
  }
  const TEMAS = {
    area: /area quemad|hectarea|\bha\b|cicatriz|quemad|mapbiomas|perdida de bosque/,
    lluvia: /lluvi|precipit|deficit|seco|humed|anomal|chirps|sequia|antecedente/,
    cap: /capacidad|brigada|bombero|defensa civil|ejercito|policia|personal|vehiculo|equipo|dotacion|extincion|maquinaria|inventario|recursos? de respuesta|brecha|sin registros/,
    estr: /estrategia|\bsrr\b|ficha|priorid|prioriz|recomend|que hacer|alistamiento|ley 1523|reduccion del riesgo|proceso/,
    heat: /punto|calor|frecuencia|foco|viirs|densidad|mes pico|temporada|detecci|wfs|ororatech/,
  };
  const DEBIL = /incendio/;
  const TAB_TEMA = { frec: "heat", wfs: "heat", area: "area", lluvia: "lluvia", cap: "cap", estr: "estr" };
  function temas(pn, tab) {
    const t = Object.keys(TEMAS).filter(k => TEMAS[k].test(pn));
    if (!t.length) t.push(DEBIL.test(pn) && !TAB_TEMA[tab] ? "heat" : (TAB_TEMA[tab] || "heat"));
    return t;
  }
  const coberturaDe = pn => /bosque/.test(pn) ? ["firms_bosque", "bosque"] : /sabana|herbaz/.test(pn) ? ["firms_sabana", "sabana y herbazal"]
    : /agropecuari|pasto|cultiv/.test(pn) ? ["firms_agro", "pastos y cultivos"] : ["firms_puntos", "toda la vegetación"];

  // ------------------------------------------------------------------ series año × mes
  // Devuelven {anios:[...], m: [[12 valores] por año]}
  function heatDepto(cod, met) {
    const { DATOS } = X(), raw = DATOS.deptos[cod]?.diario?.[met]; if (!raw) return null;
    const anios = Object.keys(raw).map(Number).sort(), m = anios.map(y => { const a = new Array(12).fill(0); for (const [mm, , v] of raw[y]) a[mm - 1] += v; return a; });
    return { anios, m };
  }
  async function heatMun(cod, met) {
    const j = await getJSON(`data/puntos/${cod}.json`); if (!j) return null;
    const g = { firms_bosque: 0, firms_sabana: 1, firms_agro: 2 }[met], base = Date.UTC(2014, 0, 1), por = {};
    for (let i = 0; i < (j.n || 0); i++) {
      if (g != null && j.g[i] !== g) continue;
      const f = new Date(base + j.d[i] * 864e5), y = f.getUTCFullYear(); (por[y] ||= new Array(12).fill(0))[f.getUTCMonth()]++;
    }
    const a0 = X().DATOS.meta.anio_ini, a1 = X().DATOS.meta.anio_fin, anios = []; for (let y = a0; y <= a1; y++) anios.push(y);
    return { anios, m: anios.map(y => por[y] || new Array(12).fill(0)) };
  }
  async function areaSerie(cod) {
    const j = await getJSON("data/area/mb_mes.json"); if (!j) return null;
    if (cod === X().NAL) { const m = j.anios.map((_, i) => Array.from({ length: 12 }, (_, k) => Object.values(j.deptos).reduce((s, d) => s + d[i][k], 0))); return { anios: j.anios, m }; }
    const v = cod.length === 2 ? j.deptos[cod] : j.mpios[cod];
    return { anios: j.anios, m: v || j.anios.map(() => new Array(12).fill(0)), sinDato: !v };
  }
  const serieDe = async (tema, cod, met) => tema === "area" ? areaSerie(cod) : cod.length === 5 ? heatMun(cod, met) : heatDepto(cod, met);

  const suma = a => a.reduce((s, v) => s + v, 0);
  // Total del período pedido (años × meses) y detalle
  function totalPeriodo(S, P) {
    const ys = P.anios.length ? P.anios.filter(y => S.anios.includes(y)) : S.anios, ms = P.meses.length ? P.meses : [...Array(12).keys()];
    const filas = ys.map(y => { const r = S.m[S.anios.indexOf(y)]; return { y, v: suma(ms.map(k => r[k])), meses: ms.map(k => r[k]) }; });
    return { ys, ms, filas, total: suma(filas.map(f => f.v)) };
  }
  const rotuloPeriodo = P => `${P.meses.length ? P.meses.map(m => MESES[m]).join(", ") + " " : ""}${P.anios.length ? "de " + P.anios.join(", ") : "(todos los años disponibles)"}`;

  // ------------------------------------------------------------------ bloques por tema
  const UNI = { heat: "puntos de calor", area: "ha quemadas" };
  async function bloqueSerie(tema, lug, P, pn) {
    const [met, covTxt] = coberturaDe(pn), L = [], series = [];
    const titulo = tema === "area" ? "ÁREA QUEMADA (MapBiomas Fuego, 30 m; hectáreas por año y mes, 2014–2025)"
      : `PUNTOS DE CALOR VIIRS S-NPP (cobertura: ${covTxt}; 2014–${X().DATOS.meta.anio_fin}${X().DATOS.meta.anio_fin > 2025 ? ", 2026 hasta " + (X().DATOS.meta.metricas.firms_puntos.fecha_max || "") : ""})`;
    L.push(titulo + `. Período pedido: ${rotuloPeriodo(P)}.`);
    for (const c of lug) {
      const S = await serieDe(tema, c, met); if (!S) { L.push(`- ${nombre(c)}: sin datos en esta fuente.`); continue; }
      if (S.sinDato || suma(S.m.flat()) === 0) {
        L.push(`- ${nombre(c)}: ${tema === "area" ? "MapBiomas Fuego no registra cicatrices de quema (0 ha) en 2014–2025" : "0 puntos de calor en el período"}${tema === "area" ? " (cero del producto satelital: puede ser que no hubo quemas detectables, no prueba que no hubo fuego)" : ""}.`);
        series.push({ c, S, T: totalPeriodo(S, P) }); continue;
      }
      const T = totalPeriodo(S, P); series.push({ c, S, T });
      let l = `- ${nombre(c)}: `;
      if (P.anios.length && P.meses.length) {
        l += T.filas.map(f => P.meses.map((m, i) => `${MESES[m]} ${f.y}: ${fmt(f.meses[i])}`).join("; ")).join("; ") + ` ${UNI[tema]}`;
        if (T.filas.length * P.meses.length > 1) l += ` (suma ${fmt(T.total)})`;
      } else if (P.anios.length) {
        l += T.filas.map(f => `${f.y}: ${fmt(f.v)}`).join("; ") + ` ${UNI[tema]}` + (T.filas.length > 1 ? ` (suma ${fmt(T.total)})` : "");
        if (T.filas.length === 1 && !/promedio/.test(pn)) l += ". Por mes de " + T.filas[0].y + ": " + MESES.map((m, i) => `${m.slice(0, 3)} ${fmt(S.m[S.anios.indexOf(T.filas[0].y)][i])}`).join(", ");
      } else if (P.meses.length) {
        l += `promedio del mes en ${S.anios[0]}–${S.anios[S.anios.length - 1]}: ` + P.meses.map(m => `${MESES[m]} ${fmt(suma(S.m.map(r => r[m])) / S.anios.length)}`).join("; ") + ` ${UNI[tema]}; por año: ` +
          T.filas.map(f => `${f.y}: ${fmt(f.v)}`).join(", ");
      } else {
        l += "por año: " + S.anios.map((y, i) => `${y}: ${fmt(suma(S.m[i]))}`).join(", ") + ` ${UNI[tema]}. Perfil mensual (promedio): ` +
          MESES.map((m, k) => `${m.slice(0, 3)} ${fmt(suma(S.m.map(r => r[k])) / S.anios.length)}`).join(", ");
      }
      L.push(l);
    }
    // comparación explícita entre los dos primeros lugares con dato
    const cmp = series.filter(s => s.T && !s.S.sinDato);
    if (series.length >= 2) {
      const [a, b] = series;
      const ta = a.T.total, tb = b.T.total;
      let c = `Comparación (${rotuloPeriodo(P)}): ${nombre(a.c)} ${fmt(ta)} vs ${nombre(b.c)} ${fmt(tb)} ${UNI[tema]}`;
      if (ta > 0 && tb > 0) c += ta >= tb ? ` → ${nombre(a.c)} tuvo ${fmt(ta / tb, 1)} veces lo de ${nombre(b.c)}` : ` → ${nombre(b.c)} tuvo ${fmt(tb / ta, 1)} veces lo de ${nombre(a.c)}`;
      L.push(c + ".");
    }
    if (tema === "heat") {
      const fm = X().DATOS.meta.metricas[met]?.fecha_max;
      if (fm && fm < X().DATOS.meta.anio_fin + "-12-31" && (!P.anios.length || P.anios.includes(X().DATOS.meta.anio_fin))) L.push(`Aviso: ${X().DATOS.meta.anio_fin} es un año incompleto (datos hasta ${fm}).`);
      const sd = (X().DATOS.meta.metricas[met]?.dias_sin_datos || []).filter(d => (!P.anios.length || P.anios.includes(+d.slice(0, 4))) && (!P.meses.length || P.meses.includes(+d.slice(5, 7) - 1)));
      if (sd.length) L.push(`Aviso: el satélite no tuvo datos en ${sd.length} días de ese período (${sd[0]}${sd.length > 1 ? " … " + sd[sd.length - 1] : ""}); las cifras podrían estar subestimadas.`);
    }
    return L.join("\n");
  }

  // Ranking de departamentos (o municipios) cuando no se nombra ningún lugar
  async function bloqueRanking(tema, P, pn) {
    const [met, covTxt] = coberturaDe(pn), { DATOS, NAL } = X(), esMun = /municipio/.test(pn), L = [];
    const filas = [];
    if (tema === "area") {
      const j = await getJSON("data/area/mb_mes.json"); if (!j) return "";
      const src = esMun ? j.mpios : j.deptos;
      for (const [c, v] of Object.entries(src)) filas.push({ c, v: totalPeriodo({ anios: j.anios, m: v }, P).total });
    } else if (!esMun) {
      for (const c of Object.keys(DATOS.deptos)) if (c !== NAL) { const S = heatDepto(c, met); if (S) filas.push({ c, v: totalPeriodo(S, P).total }); }
    } else if (!P.anios.length && !P.meses.length) {
      for (const x of DATOS.deptos[NAL].municipios[met] || []) filas.push({ c: x.cod, v: x.prom });
      L.push("(promedio anual de puntos de calor 2014–2025 por municipio)");
    } else {
      const ym = []; const ys = P.anios.length ? P.anios : null, ms = P.meses.length ? P.meses : null;
      if (ys && ms) for (const y of ys) for (const m of ms) ym.push(`${y}-${String(m + 1).padStart(2, "0")}`);
      else if (ys) for (const y of ys) for (let m = 1; m <= 12; m++) ym.push(`${y}-${String(m).padStart(2, "0")}`);
      if (!ym.length || ym.length > 4) return "Ranking de municipios por mes/año: pida un período de hasta 4 meses (p. ej. «marzo de 2020») o consulte el mapa de la pestaña Frecuencia.";
      const g = { firms_bosque: 0, firms_sabana: 1, firms_agro: 2 }[met], cnt = {};
      for (const j of await Promise.all(ym.map(k => getJSON(`data/puntos_mes/${k}.json`)))) {
        if (!j) continue; for (let i = 0; i < j.n; i++) if (g == null || j.g[i] === g) { const c = String(j.mp[i]).padStart(5, "0"); cnt[c] = (cnt[c] || 0) + 1; }
      }
      for (const [c, v] of Object.entries(cnt)) filas.push({ c, v });
    }
    filas.sort((a, b) => b.v - a.v);
    const top = filas.filter(f => f.v > 0).slice(0, 10);
    if (!top.length) return "";
    L.unshift(`RANKING de ${esMun ? "municipios" : "departamentos"} por ${tema === "area" ? "hectáreas quemadas (MapBiomas)" : `puntos de calor VIIRS (${covTxt})`} · período ${rotuloPeriodo(P)}: ` +
      top.map((f, i) => `${i + 1}. ${nombre(f.c)} ${fmt(f.v)}`).join("; ") + `. Total del país: ${fmt(suma(filas.map(f => f.v)))}.`);
    return L.join("\n");
  }

  // Lluvia antecedente: estadísticas de los eventos del período en cada lugar
  const rangoDias = P => {
    const { LLUVIA, diaDe } = X(), L = LLUVIA.meta, out = [];
    const y0 = +L.primer_evento.slice(0, 4), y1 = +L.ultimo_evento.slice(0, 4);
    const ys = P.anios.length ? P.anios : null, ms = P.meses.length ? P.meses : null;
    const fin = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const push = (a, b, rot) => { out.push({ a: Math.max(diaDe(a), diaDe(L.primer_evento)), b: Math.min(diaDe(b), diaDe(L.ultimo_evento)), rot }); };
    if (ys && ms) { for (const y of ys) for (const m of ms) push(`${y}-${String(m + 1).padStart(2, "0")}-01`, `${y}-${String(m + 1).padStart(2, "0")}-${fin(y, m)}`, `${MESES[m]} ${y}`); }
    else if (ys) { for (const y of ys) push(`${y}-01-01`, `${y}-12-31`, String(y)); }
    else if (ms) { for (let y = y0; y <= y1; y++) for (const m of ms) push(`${y}-${String(m + 1).padStart(2, "0")}-01`, `${y}-${String(m + 1).padStart(2, "0")}-${fin(y, m)}`, `${MESES[m]} ${y}`); }
    else push(L.primer_evento, L.ultimo_evento, "todo el período");
    return out;
  };
  function statsLluvia(pred, rangos) {
    const { LL, LLUVIA } = X(), E = LL.esc, minN = LLUVIA.meta.normal_min_mm, P = [], pct = []; let sN = 0, n = 0;
    for (let i = 0; i < LL.n; i++) {
      const d = LL.d[i]; if (!rangos.some(r => d >= r.a && d <= r.b)) continue;
      if (!pred(LL.munis[LL.mi[i]])) continue;
      const p = LL.P[i] / E, nn = LL.N[i] / E; n++; P.push(p); sN += nn; if (nn >= minN) pct.push(100 * p / nn);
    }
    if (!n) return null;
    const { llMed } = X();
    return { n, p: llMed(P), nm: sN / n, pc: pct.length ? llMed(pct) : null, df: pct.length ? 100 * pct.filter(v => v < LLUVIA.meta.deficit_pct).length / pct.length : null };
  }
  async function bloqueLluvia(lug, P, pn) {
    const { LLUVIA, NAL, diaDe } = X(); if (!LLUVIA) return "";
    await X().llCargar(); if (!X().LL.ok) return "";
    const mt = LLUVIA.meta, L = [`LLUVIA ANTECEDENTE (CHIRPS, 90 días antes de cada evento de incendio; eventos de ${mt.primer_evento} a ${mt.ultimo_evento}; normal = promedio ${mt.base[0]}–${mt.base[1]}; déficit = menos del ${mt.deficit_pct} % de lo normal). Período pedido: ${rotuloPeriodo(P)}.`];
    const rangos = rangoDias(P), porRango = rangos.length > 1 && rangos.length <= 6;
    const predDe = c => c === NAL ? () => true : c.length === 2 ? m => m.startsWith(c) : m => m === c;
    const f = s => s ? `${fmt(s.n)} eventos-día; lluvia previa típica ${fmt(s.p)} mm (normal ${fmt(s.nm)} mm) = ${s.pc == null ? "s/d" : fmt(s.pc) + " %"} de lo normal; ${s.df == null ? "s/d" : fmt(s.df) + " %"} con déficit` : "sin eventos con puntos de calor en el período";
    if (!lug.length) {
      const g = new Map();
      for (const c of Object.keys(X().DATOS.deptos)) if (c !== NAL) { const s = statsLluvia(predDe(c), rangos); if (s && s.n >= 5 && s.pc != null) g.set(c, s); }
      const arr = [...g.entries()].sort((a, b) => a[1].pc - b[1].pc);
      if (arr.length) L.push("Departamentos (con 5 eventos o más) con MENOR lluvia previa frente a lo normal: " + arr.slice(0, 6).map(([c, s]) => `${nombre(c)} ${fmt(s.pc)} % (${fmt(s.n)} eventos)`).join("; ") +
        ". Con MAYOR: " + arr.slice(-4).reverse().map(([c, s]) => `${nombre(c)} ${fmt(s.pc)} %`).join("; ") + ".");
      L.push("Colombia: " + f(statsLluvia(predDe(NAL), rangos)) + ".");
      return L.join("\n");
    }
    for (const c of lug) {
      const nombres = porRango ? rangos.map(r => `${r.rot}: ${f(statsLluvia(predDe(c), [r]))}`).join(" | ") : f(statsLluvia(predDe(c), rangos));
      L.push(`- ${nombre(c)}: ${nombres}`);
    }
    if (lug.length >= 2 && !porRango) {
      const a = statsLluvia(predDe(lug[0]), rangos), b = statsLluvia(predDe(lug[1]), rangos);
      if (a && b && a.pc != null && b.pc != null) L.push(`Comparación: la lluvia previa típica fue ${fmt(a.pc)} % de lo normal en ${nombre(lug[0])} frente a ${fmt(b.pc)} % en ${nombre(lug[1])}.`);
    }
    if (lug.includes("88") || lug.some(c => c.startsWith("88"))) L.push("Nota: San Andrés y Providencia usan estaciones del IDEAM (CHIRPS no cubre las islas); son muy pocos eventos.");
    return L.join("\n");
  }

  // Capacidades de respuesta (Matriz Nacional de Capacidades, SNGRD)
  let CAP_PROM = null;
  const capRegistros = () => (CAP_PROM ||= fetch("capacidades_sngrd.html").then(r => r.ok ? r.text() : "").then(t => {
    const i = t.indexOf("const CAP = ["); if (i < 0) return null; const j = t.indexOf("];", i); return JSON.parse(t.slice(i + 12, j + 1));
  }).catch(() => null));
  async function bloqueCap(lug) {
    if (!X().TABS.some(t => t[0] === "cap")) return "";
    let R = await capRegistros(); if (!R) return "";
    const L = ["CAPACIDADES DE RESPUESTA (Matriz Nacional de Capacidades SNGRD; solo lo reportado por las instituciones que enviaron datos; faltan, entre otros, cuerpos de bomberos y corporaciones autónomas, así que «sin registros» no significa «sin capacidad»). Un registro es un recurso reportado (equipo, vehículo, personal)."];
    const sinMun = R.filter(r => !/^\d{2,5}$/.test(String(r.divipola || ""))), R0 = R; R = R.filter(r => /^\d{2,5}$/.test(String(r.divipola || "")));
    const top = (arr, k, n = 6) => Object.entries(arr.reduce((o, r) => (o[k(r)] = (o[k(r)] || 0) + 1, o), {})).sort((a, b) => b[1] - a[1]).slice(0, n);
    const personas = arr => arr.filter(r => /persona/i.test(r.und)).reduce((s, r) => s + (+r.cant || 0), 0);
    const resumen = (arr) => `${fmt(arr.length)} registros en ${fmt(new Set(arr.map(r => r.divipola)).size)} municipios; ${fmt(personas(arr))} personas reportadas; por categoría: ${top(arr, r => r.cat || "sin categoría", 5).map(([k, v]) => `${k} ${v}`).join(", ")}; instituciones: ${top(arr, r => r.ent, 4).map(([k, v]) => `${k} ${v}`).join(", ")}`;
    if (!lug.length || lug[0] === X().NAL) {
      L.push("Colombia: " + resumen(R0) + (sinMun.length ? `; ${fmt(sinMun.length)} de ellos sin municipio asignado (cobertura nacional o regional), que no entran en los rankings por lugar` : ""));
      L.push("Departamentos con más registros: " + top(R, r => String(r.divipola).slice(0, 2), 8).map(([c, v]) => `${nombre(c)} ${v}`).join("; ") + ".");
      L.push("Municipios con más registros: " + top(R, r => r.divipola, 8).map(([c, v]) => `${nombre(c)} ${v}`).join("; ") + ".");
      L.push("Municipios con más personas reportadas: " + Object.entries(R.filter(r => /persona/i.test(r.und)).reduce((o, r) => (o[r.divipola] = (o[r.divipola] || 0) + (+r.cant || 0), o), {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, v]) => `${nombre(c)} ${fmt(v)}`).join("; ") + ".");
      return L.join("\n");
    }
    for (const c of lug) {
      const arr = R.filter(r => c.length === 2 ? String(r.divipola).slice(0, 2) === c : r.divipola === c);
      L.push(`- ${nombre(c)}: ${arr.length ? resumen(arr) : "sin registros en la matriz (información parcial)"}`);
      if (c.length === 2 && arr.length) L.push(`  Municipios con más registros en ${nombre(c)}: ` + top(arr, r => r.divipola, 5).map(([m, v]) => `${nombre(m)} ${v}`).join("; "));
    }
    return L.join("\n");
  }

  // Estrategias GRD: diagnóstico del territorio + catálogo
  async function bloqueEstr(lug, pn) {
    const E = window.ESTR; if (!E) return "";
    const x = X(); E.iniciar?.({ st: x.st, DATOS: x.DATOS, M: x.M, GEO_DEP: x.GEO_DEP, GEO_MUN: x.GEO_MUN, MUN_NOM: x.MUN_NOM, NAL: x.NAL, nomDepto: x.nomDepto, titulo: x.titulo, fechaTxt: x.fechaTxt });
    const L = ["ESTRATEGIAS GRD (47 estrategias de la Subdirección para la Reducción del Riesgo, UNGRD; el portal las prioriza con los datos de cada territorio; la clasificación por proceso, momento y responsable es una propuesta técnica pendiente de validación por la SRR)."];
    for (const c of lug.filter(x => x !== X().NAL).slice(0, 3)) {
      try {
        const d = await E.diagnostico(c), P = d.perfil, mes = i => MESES[i];
        const pico = MESES.filter((_, i) => P.pico[i]).join(", "), ali = MESES.filter((_, i) => P.alist[i]).join(", ");
        L.push(`- ${nombre(c)}: recurrencia ${d.nivel.t.toLowerCase()} (${fmt(d.prom, d.prom < 10 ? 1 : 0)} puntos de calor por año, puesto ${fmt(d.puesto)} de ${fmt(d.total)}); ` +
          (pico ? `temporada de mayor actividad: ${pico}; alistamiento: ${ali || "–"}` : "sin temporada definida") +
          `; área quemada ${d.mb ? fmt(d.mb.haAnio) + " ha/año" : "sin cicatrices registradas"}; capacidades registradas: ${d.cap.n}${d.region ? "; región: " + d.region : ""}.`);
      } catch (e) { /* sin diagnóstico */ }
    }
    if (/estrategia|proceso|ley 1523|catalogo|cuales|lista/.test(pn)) {
      const C = await E.catalogo();
      if (C) {
        const por = {}; for (const e of C.estrategias) (por[C.procesos[e.complemento?.proceso]?.nombre || "otro"] ||= []).push(e.estrategia);
        L.push("Catálogo por proceso: " + Object.entries(por).map(([k, v]) => `${k} (${v.length}): ${v.slice(0, 6).join("; ")}${v.length > 6 ? "…" : ""}`).join(" | "));
      }
    }
    return L.length > 1 ? L.join("\n") : "";
  }

  // Descripción fija de las fuentes (corta): permite explicar alcances y límites de cada pestaña
  const FUENTES = "FUENTES DEL TABLERO: (1) Frecuencia VIIRS: puntos de calor satelitales VIIRS S-NPP (NASA FIRMS, 375 m) sobre vegetación, 2014–2026, por día/mes/año, departamento y municipio; un punto de calor no es un incendio. " +
    "(2) Frecuencia WFS: detecciones de OroraTech WildFire Solution. (3) Área quemada: MapBiomas Fuego (30 m), hectáreas por año y cobertura 2014–2025 (y por mes desde el producto mensual); es un mapa de cicatrices, no de puntos. " +
    "(4) Lluvia antecedente: CHIRPS (≈5 km) en los 90 días previos a cada evento (municipio-día con punto de calor), frente al normal 2014–2025; en San Andrés y Providencia, estaciones del IDEAM. " +
    "(5) Capacidades de respuesta: Matriz Nacional de Capacidades SNGRD (parcial). (6) Estrategias GRD: estrategias de la SRR priorizadas por territorio. Asociación no es causalidad.";

  // ------------------------------------------------------------------ API
  async function consulta(pregunta) {
    const { st, TABS } = X(), pn = norm(pregunta);
    const { lista, notas } = lugares(pn), P = periodo(pn), ts = temas(pn, st.tab);
    const lug = lista.length ? lista : (/\b(que|cual|cuales|donde|quien|quienes)\b.*\b(departamento|municipio|region|zona|lugar)s?\b|\bmas\b|\bmayor|\bmenor|\bmenos\b|ranking|top\b/.test(pn) && !/\b(este|esta)\b/.test(pn) ? [] : [st.mpio || st.dpto]);
    const implicito = !lista.length && lug.length > 0;
    const bloques = [], cab = [];
    cab.push(`Lugares detectados: ${lug.length ? lug.map(nombre).join(" ; ") : "ninguno (consulta general o ranking)"}${implicito ? " (el lugar seleccionado en pantalla)" : ""}.`);
    cab.push(`Período: ${rotuloPeriodo(P)}.${P.fuera.length ? " Años fuera del rango de datos: " + P.fuera.join(", ") + "." : ""}`);
    for (const n of notas) cab.push("Nota: " + n + ".");
    for (const tema of ts) {
      try {
        let b = "";
        if (tema === "heat" || tema === "area") b = lug.length ? await bloqueSerie(tema, lug, P, pn) : await bloqueRanking(tema, P, pn);
        else if (tema === "lluvia") b = await bloqueLluvia(lug, P, pn);
        else if (tema === "cap") b = await bloqueCap(lug);
        else if (tema === "estr") b = await bloqueEstr(lug, pn);
        if (b) bloques.push(b);
      } catch (e) { bloques.push(`(no se pudo calcular ${tema}: ${e.message})`); }
    }
    const txt = [cab.join(" "), ...bloques].join("\n\n");
    return { resultados: txt.length > MAX_CHARS ? txt.slice(0, MAX_CHARS - 1) + "…" : txt, fuentes: FUENTES, temas: ts, lugares: lug, periodo: P };
  }
  window.ASISTENTE_DATOS = { consulta, _lugares: lugares, _periodo: periodo, _temas: temas };
})();
