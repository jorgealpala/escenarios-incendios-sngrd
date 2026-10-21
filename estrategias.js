/* ============================================================================
 *  Estrategias de reducción del riesgo por incendios forestales (SRR · UNGRD)
 *  Pestaña «Estrategias de reducción» + fichas descargables (PDF) por municipio
 *  y departamento.
 *
 *  Catálogo:     data/estrategias/estrategias_incendios.json
 *                (se genera desde el Excel de la SRR con herramientas/estrategias_a_json.py)
 *  Diagnóstico:  datos que el portal ya tiene (VIIRS, MapBiomas, Matriz de Capacidades).
 *
 *  index.html llama a  window.ESTR.render(ctx)  con el estado y los datos del portal.
 * ========================================================================== */
(function () {
  "use strict";

  const RUTA = "data/estrategias/estrategias_incendios.json";
  const LIBS = {
    autotable: ["https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
                "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js"],
  };
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const MES_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const ORDEN_PROC = ["conocimiento", "reduccion_prospectiva", "reduccion_correctiva", "proteccion_financiera", "preparacion", "recuperacion"];
  const ORDEN_MOM = { antes: 0, durante: 1, despues: 2, permanente: 3 };
  const PLAZO_TXT = { corto: "Corto", mediano: "Mediano", largo: "Largo" };
  const NIVELES = [
    { k: "muy_alta", t: "Muy alta", hasta: 0.10 },
    { k: "alta", t: "Alta", hasta: 0.25 },
    { k: "media", t: "Media", hasta: 0.50 },
    { k: "baja", t: "Baja", hasta: 1.01 },
  ];
  const ESC_MUN = ["Municipal", "Local", "Multiescala"], ESC_DEP = ["Departamental", "Regional", "Multiescala"];

  let CAT = null, CAT_ERR = null, CAP = null, CAP_PROM = null;
  const PT = {};           // caché de puntos por municipio
  const ui = { filtro: "todas", proceso: "", plazo: "", matC: null, matT: null };   // matC/matT: celda elegida en la matriz
  let ctx = null, ultimoDiag = null, token = 0;
  // ---- Matriz de medidas (línea de acción × plazo), con la matriz de «Reducción del Riesgo» ----
  const MAT_T = ["corto", "mediano", "largo"];
  const MAT_RAMPA = ["#FDE7CF", "#F7B97E", "#EE8547", "#D2512A", "#9A2617"];
  const heat = (v, max) => !v ? "var(--surface-2)" : MAT_RAMPA[Math.min(MAT_RAMPA.length - 1, Math.round(v / max * (MAT_RAMPA.length - 1)))];
  const tipoTxt = t => t === "mun" ? "este municipio" : t === "dep" ? "este departamento" : "todo el país";
  function matrizHTML(items, tipo) {
    if (!items.length) return "";
    const cel = (L, t) => items.filter(e => e.linea === L && (e.plazo || []).includes(t));
    const tot = L => MAT_T.reduce((a, t) => a + cel(L, t).length, 0);
    const lineas = [...new Set(items.map(e => e.linea))].sort((a, b) => tot(b) - tot(a));
    const max = Math.max(1, ...lineas.flatMap(L => MAT_T.map(t => cel(L, t).length)));
    const selC = ui.matC, selT = ui.matT;
    let h = `<section class="card sec"><h3>Matriz de medidas · línea de acción × plazo</h3>
      <p class="desc">Las medidas que aplican a ${tipoTxt(tipo)}, por línea de acción y plazo. El color crece con la cantidad; entre paréntesis, las <b>prioritarias aquí</b>. Toque una celda, una fila o una columna para <b>filtrar el catálogo</b> (a la derecha).</p>
      <div class="tscroll"><table class="estr-mat"><thead><tr><th></th>${MAT_T.map(t => `<th class="colh${selT === t && !selC ? " on" : ""}" data-t="${t}" tabindex="0">${esc(PLAZO_TXT[t])}</th>`).join("")}<th class="tot">Total</th></tr></thead><tbody>`;
    for (const L of lineas) {
      h += `<tr><th class="rowh${selC === L && !selT ? " on" : ""}" data-c="${esc(L)}" tabindex="0">${esc(L)}</th>`;
      for (const t of MAT_T) {
        const g = cel(L, t), nPri = g.filter(e => e.motivos && e.motivos.length).length, on = selC === L && selT === t;
        h += `<td class="cell${on ? " on" : ""}" data-c="${esc(L)}" data-t="${t}"${g.length ? ` tabindex="0" style="background:${heat(g.length, max)};color:${g.length / max > 0.55 ? "#fff" : "var(--ink)"}"` : ""}>${g.length ? g.length + (nPri ? `<span class="pr">(${nPri})</span>` : "") : ""}</td>`;
      }
      h += `<td class="tot">${tot(L)}</td></tr>`;
    }
    h += `<tr><th class="tot">Total</th>${MAT_T.map(t => `<td class="tot">${items.filter(e => (e.plazo || []).includes(t)).length}</td>`).join("")}<td class="tot">${items.length}</td></tr></tbody></table></div>`;
    if (selC || selT) {
      const n = items.filter(e => (!selC || e.linea === selC) && (!selT || (e.plazo || []).includes(selT))).length;
      h += `<div class="estr-matsel">Catálogo filtrado: <b>${selC ? esc(selC) : ""}${selC && selT ? " · " : ""}${selT ? esc(PLAZO_TXT[selT]) + " plazo" : ""}</b> · ${n} medida${n === 1 ? "" : "s"} <button class="link" id="matClear">Ver todas</button></div>`;
    }
    return h + `</section>`;
  }

  // ---------------------------------------------------------------- utilidades
  const fmt = (v, d = 0) => Number(v || 0).toLocaleString("es-CO", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const pct = v => fmt(v * 100) + " %";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const plazoTxt = p => (p && p.length ? p.map(x => PLAZO_TXT[x] || x).join(" a ") + " plazo" : "Sin dato");
  const listaY = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " y " + a[a.length - 1];
  const cargarScript = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  async function cargarLib(urls, ok) { for (const u of urls) { if (ok()) return true; try { await cargarScript(u); } catch (e) {} } return ok(); }

  async function catalogo() {
    if (CAT || CAT_ERR) return CAT;
    try { CAT = await fetch(RUTA, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); }
    catch (e) { CAT_ERR = e; }
    return CAT;
  }
  // Matriz de Capacidades: los registros viven embebidos en capacidades_sngrd.html (const CAP = [...]).
  function capacidades() {
    return CAP_PROM ||= fetch("capacidades_sngrd.html", { cache: "no-cache" }).then(r => r.text()).then(t => {
      const i = t.indexOf("const CAP = ["); if (i < 0) return [];
      const j = t.indexOf("];", i); CAP = JSON.parse(t.slice(i + 12, j + 1)); return CAP;
    }).catch(() => (CAP = []));
  }
  const puntos = cod => (PT[cod] ||= fetch(`data/puntos/${cod}.json`).then(r => r.ok ? r.json() : { n: 0, d: [] }).catch(() => ({ n: 0, d: [] })));

  // ------------------------------------------------------------ diagnóstico
  // Distribución nacional del promedio anual de puntos de calor por municipio (para el nivel de recurrencia).
  let DIST = null;
  function distribucion() {
    if (DIST) return DIST;
    const { DATOS, GEO_MUN, NAL } = ctx, prom = {};
    for (const [c, d] of Object.entries(DATOS.deptos)) if (c !== NAL) for (const x of (d.municipios?.firms_puntos || [])) prom[x.cod] = x.prom;
    const mun = GEO_MUN.features.map(f => ({ cod: f.properties.MPIO_CCNCT, prom: prom[f.properties.MPIO_CCNCT] || 0 })).sort((a, b) => b.prom - a.prom);
    const puesto = {}; mun.forEach((x, i) => puesto[x.cod] = i + 1);
    const dep = Object.keys(DATOS.deptos).filter(c => c !== NAL).map(c => ({ cod: c, prom: DATOS.deptos[c].resumen?.firms_puntos?.prom_anual || 0 })).sort((a, b) => b.prom - a.prom);
    const puestoD = {}; dep.forEach((x, i) => puestoD[x.cod] = i + 1);
    return (DIST = { prom, mun, puesto, dep, puestoD });
  }
  function nivelDe(puesto, total, prom) {
    if (!prom) return { k: "sin", t: "Sin puntos registrados" };
    const q = puesto / total; return NIVELES.find(n => q <= n.hasta);
  }
  // Temporadas oct–abr completas y relación El Niño / temporada típica.
  function perfil(mensualPorAnio) {
    const { M, DATOS } = ctx;
    const anios = M.anios_promedio, mes = new Array(12).fill(0);
    for (const y of anios) for (let m = 0; m < 12; m++) mes[m] += (mensualPorAnio[y]?.[m] || 0);
    for (let m = 0; m < 12; m++) mes[m] /= anios.length;
    const tot = mes.reduce((a, b) => a + b, 0);
    const pico = mes.map(v => tot > 0 && v / tot >= 1.25 / 12);
    const alist = new Array(12).fill(false), desp = new Array(12).fill(false);
    if (tot * anios.length >= 12) for (let m = 0; m < 12; m++) {
      if (pico[m] && !pico[(m + 11) % 12]) { for (const k of [1, 2]) if (!pico[(m - k + 12) % 12]) alist[(m - k + 12) % 12] = true; }
      if (pico[m] && !pico[(m + 1) % 12] && !alist[(m + 1) % 12]) desp[(m + 1) % 12] = true;
    } else pico.fill(false);
    // temporadas
    const ninoIni = (DATOS.nino?.temporadas || []).map(t => +t.split("–")[0]);
    const temporada = y => { let s = 0; for (const m of [9, 10, 11]) s += mensualPorAnio[y]?.[m] || 0; for (const m of [0, 1, 2, 3]) s += mensualPorAnio[y + 1]?.[m] || 0; return s; };
    const ultima = Math.max(...anios) - 1, ini = Math.min(...anios), tn = [], to = [];
    for (let y = ini; y <= ultima; y++) (ninoIni.includes(y) ? tn : to).push(temporada(y));
    const media = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const mn = media(tn), mo = media(to);
    const nino = (mo > 0 && tn.concat(to).reduce((a, b) => a + b, 0) >= 20) ? { razon: mn / mo, mn, mo, temporadas: DATOS.nino.temporadas } : null;
    return { mes, tot, pico, alist, desp, nino };
  }
  function mensualMunicipio(j) {
    const out = {}, base = Date.UTC(2014, 0, 1);
    for (let i = 0; i < (j.n || 0); i++) { const f = new Date(base + j.d[i] * 864e5), y = f.getUTCFullYear(), m = f.getUTCMonth(); (out[y] ||= new Array(12).fill(0))[m]++; }
    return out;
  }
  function mensualDepto(cod) {
    const raw = ctx.DATOS.deptos[cod]?.diario?.firms_puntos || {}, out = {};
    for (const [y, filas] of Object.entries(raw)) { const a = out[y] = new Array(12).fill(0); for (const [m, , v] of filas) a[m - 1] += v; }
    return out;
  }
  function mapbiomas(o) {
    const MB = ctx.DATOS.mapbiomas; if (!o || !MB) return null;
    const n = MB.anios.length, g = [0, 0, 0];
    for (const r of o.ha) for (let k = 0; k < 3; k++) g[k] += r[k] || 0;
    const tot = g[0] + g[1] + g[2];
    return { haAnio: tot / n, sh: tot ? g.map(v => v / tot) : [0, 0, 0], perdida: (o.perdida || []).reduce((a, b) => a + b, 0), anios: [MB.anios[0], MB.anios[n - 1]] };
  }
  const COB = ["bosque", "sabana o herbazal", "pasto o cultivo"];

  async function diagnostico(cod) {
    const { DATOS, NAL, MUN_NOM, nomDepto, GEO_MUN } = ctx, D = distribucion();
    const esMun = cod.length === 5, dp = esMun ? cod.slice(0, 2) : cod;
    const caps = await capacidades();
    const capR = caps.filter(r => esMun ? r.divipola === cod : String(r.divipola).slice(0, 2) === dp);
    const d = { cod, esMun, dp, nombre: esMun ? (MUN_NOM[cod] || cod) : nomDepto(cod), depto: nomDepto(dp) };
    if (esMun) {
      d.prom = D.prom[cod] || 0; d.puesto = D.puesto[cod]; d.total = D.mun.length;
      const enDep = D.mun.filter(x => x.cod.slice(0, 2) === dp); d.puestoDep = enDep.findIndex(x => x.cod === cod) + 1; d.totalDep = enDep.length;
      const f = GEO_MUN.features.find(x => x.properties.MPIO_CCNCT === cod); d.km2 = f ? f.properties.area_km2 : null;
      d.perfil = perfil(mensualMunicipio(await puntos(cod)));
      d.mb = mapbiomas(DATOS.mapbiomas?.datos?.[dp]?.mpios?.[cod]);
    } else {
      d.prom = DATOS.deptos[cod]?.resumen?.firms_puntos?.prom_anual || 0; d.puesto = D.puestoD[cod]; d.total = D.dep.length;
      d.perfil = perfil(mensualDepto(cod));
      d.mb = mapbiomas(DATOS.mapbiomas?.datos?.[cod]);
      // municipios del departamento, para priorizar
      const capPorMun = {}; for (const r of capR) capPorMun[r.divipola] = (capPorMun[r.divipola] || 0) + 1;
      d.municipios = D.mun.filter(x => x.cod.slice(0, 2) === cod).map(x => {
        const mb = mapbiomas(DATOS.mapbiomas?.datos?.[cod]?.mpios?.[x.cod]);
        const dom = mb && mb.haAnio > 0 ? mb.sh.indexOf(Math.max(...mb.sh)) : -1;
        return { cod: x.cod, nombre: MUN_NOM[x.cod] || x.cod, prom: x.prom, puesto: D.puesto[x.cod], nivel: nivelDe(D.puesto[x.cod], D.mun.length, x.prom), mb, dom, cap: capPorMun[x.cod] || 0 };
      });
      d.nivelesMun = {}; for (const m of d.municipios) d.nivelesMun[m.nivel.k] = (d.nivelesMun[m.nivel.k] || 0) + 1;
    }
    d.nivel = nivelDe(d.puesto, d.total, d.prom);
    d.cap = { n: capR.length, inst: [...new Set(capR.map(r => r.ent))], unidades: new Set(capR.map(r => r.ent + "|" + r.desc)).size };
    d.region = CAT?.regiones_departamento?.[dp] || null;
    d.reglas = reglasActivas(d);
    return d;
  }

  // ------------------------------------------------------- priorización
  function reglasActivas(d) {
    const act = [], mb = d.mb, hayMB = mb && mb.haAnio >= (d.esMun ? 5 : 50);
    for (const r of (CAT?.reglas || [])) {
      let ok = false, txt = r.texto;
      switch (r.id) {
        case "base": ok = true; break;
        case "recurrencia": ok = ["muy_alta", "alta"].includes(d.nivel.k); txt = txt.replace("{nivel}", d.nivel.t.toLowerCase()).replace("{tope}", d.nivel.k === "muy_alta" ? "10 %" : "25 %"); break;
        case "agro": ok = hayMB && mb.sh[2] >= 0.40; if (ok) txt = txt.replace("{pct_agro}", pct(mb.sh[2])); break;
        case "bosque": ok = hayMB && (mb.sh[0] >= 0.25 || mb.perdida >= (d.esMun ? 50 : 500));
          if (ok) txt = txt.replace("{pct_bosque}", pct(mb.sh[0])).replace("{perdida_txt}", mb.perdida > 0 ? `; ${fmt(mb.perdida)} ha de bosque quemado eran pasto o cultivo al año siguiente (2014–2023)` : ""); break;
        case "sabana": ok = hayMB && mb.sh[1] >= 0.40; if (ok) txt = txt.replace("{pct_sabana}", pct(mb.sh[1])); break;
        case "nino": ok = !!(d.perfil.nino && d.perfil.nino.razon >= 1.3); if (ok) txt = txt.replace("{razon_nino}", fmt(d.perfil.nino.razon, 1)); break;
        case "capacidad": ok = d.cap.n === 0; txt = txt.replace("{ambito}", d.esMun ? "municipio" : "departamento"); break;
      }
      if (ok) act.push({ id: r.id, nombre: r.nombre, texto: txt, claves: r.claves });
    }
    return act;
  }
  function aplica(e, tipo, region) {
    const escs = new Set([...(e.escalas || []), ...((e.complemento && e.complemento.escala_sugerida) || [])]);
    const ok = (tipo === "mun" ? ESC_MUN : ESC_DEP).some(x => escs.has(x));
    const reg = !e.regiones || !e.regiones.length || !region || e.regiones.includes(region);
    return ok && reg;
  }
  function priorizar(d, tipo) {
    const porClave = {};
    for (const r of d.reglas) for (const k of r.claves) (porClave[k] ||= []).push(r);
    return CAT.estrategias.filter(e => tipo === "nal" || aplica(e, tipo, d.region)).map(e => ({ ...e, motivos: porClave[e.clave] || [] }));
  }
  const TOP = 10;   // «Qué hacer primero»: las 10 con más señales
  const ordenar = (a, b) => (b.motivos.length > 0) - (a.motivos.length > 0) || b.motivos.length - a.motivos.length ||
    (ORDEN_MOM[a.complemento?.momento] ?? 9) - (ORDEN_MOM[b.complemento?.momento] ?? 9) ||
    ["corto", "mediano", "largo"].indexOf(a.plazo[0]) - ["corto", "mediano", "largo"].indexOf(b.plazo[0]);

  // ------------------------------------------------------------ textos
  function sintesis(d) {
    const s = [], P = d.perfil;
    if (d.esMun) s.push(`${d.nombre} registra en promedio ${fmt(d.prom, d.prom < 10 ? 1 : 0)} puntos de calor por año (VIIRS, 2014–2025): puesto ${fmt(d.puesto)} de ${fmt(d.total)} municipios del país y ${d.puestoDep} de ${d.totalDep} en ${d.depto}. Recurrencia ${d.nivel.t.toLowerCase()}.`);
    else s.push(`${d.nombre} registra en promedio ${fmt(d.prom)} puntos de calor por año (VIIRS, 2014–2025): puesto ${d.puesto} de ${d.total} departamentos. Recurrencia ${d.nivel.t.toLowerCase()}.`);
    const mp = MES_L.filter((_, i) => P.pico[i]), ma = MES_L.filter((_, i) => P.alist[i]);
    if (mp.length) s.push(`La actividad se concentra en ${listaY(mp)}${ma.length ? `; las acciones de alistamiento deben estar listas en ${listaY(ma)}` : ""}.`);
    else s.push("No hay suficientes registros para definir una temporada de mayor actividad.");
    if (d.mb && d.mb.haAnio > 0) { const k = d.mb.sh.indexOf(Math.max(...d.mb.sh)); s.push(`Área quemada: ${fmt(d.mb.haAnio)} ha por año en promedio (MapBiomas ${d.mb.anios[0]}–${d.mb.anios[1]}); el ${pct(d.mb.sh[k])} fue ${COB[k]}.`); }
    if (P.nino) s.push(`En las temporadas El Niño ${listaY(P.nino.temporadas)} (octubre a abril) hubo ${fmt(P.nino.razon, 1)} veces los puntos de calor de una temporada típica.`);
    s.push(d.cap.n ? `Matriz Nacional de Capacidades: ${fmt(d.cap.n)} registros de ${d.cap.inst.length} institución${d.cap.inst.length === 1 ? "" : "es"} con base en el ${d.esMun ? "municipio" : "departamento"}.`
                   : `La Matriz Nacional de Capacidades no tiene registros con base en el ${d.esMun ? "municipio" : "departamento"} (información parcial: faltan, entre otros, cuerpos de bomberos y corporaciones).`);
    return s;
  }

  function kpis(d) {
    const i = d.mb && d.mb.haAnio > 0 ? d.mb.sh.indexOf(Math.max(...d.mb.sh)) : -1;
    return [
      ["Puntos de calor por año", fmt(d.prom, d.prom < 10 ? 1 : 0), d.esMun ? `puesto ${fmt(d.puesto)} de ${fmt(d.total)} en el país` : `puesto ${d.puesto} de ${d.total} departamentos`],
      ["Recurrencia", d.nivel.t, "frente al resto del país (no es nivel de riesgo)"],
      ["Área quemada por año", i >= 0 ? fmt(d.mb.haAnio) + " ha" : "–", i >= 0 ? `${pct(d.mb.sh[i])} en ${COB[i]}` : "sin cicatrices registradas"],
      ["Capacidades registradas", fmt(d.cap.n), d.cap.n ? `${d.cap.inst.length} institución${d.cap.inst.length === 1 ? "" : "es"} (información parcial)` : "sin registros (información parcial)"],
    ];
  }

  // ----------------------------------------------------------------- estilos
  function estilos() {
    if (document.getElementById("estr-css")) return;
    const st = document.createElement("style"); st.id = "estr-css";
    st.textContent = `
#pane-estr .aviso-prop{background:var(--warn-bg);color:var(--warn-ink);border-radius:10px;padding:9px 12px;font-size:13px;margin:0 0 12px}
.estr-cab{display:flex;gap:14px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.estr-cab .acc{display:flex;gap:8px;flex-wrap:wrap}
.estr-cab .pbtn{white-space:nowrap}
.estr-niv{display:inline-flex;align-items:center;gap:6px;font:600 12.5px var(--f-body);padding:3px 10px;border-radius:999px;background:var(--surface-2)}
.estr-niv i{width:10px;height:10px;border-radius:50%;display:inline-block}
.estr-sint{margin:10px 0 0;padding-left:18px;font-size:14px;color:var(--ink-2)}
.estr-sint li{margin:2px 0}
.estr-cal{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:3px;margin-top:12px;align-items:end}
.estr-cal .m{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11px;color:var(--ink-3)}
.estr-cal .b{width:100%;border-radius:3px 3px 0 0;background:var(--line);min-height:2px}
.estr-cal .b.p{background:var(--accent)}
.estr-cal .t{width:100%;height:6px;border-radius:2px;background:transparent}
.estr-cal .t.a{background:var(--o1)} .estr-cal .t.p{background:var(--accent)} .estr-cal .t.d{background:var(--c-bosque)}
.estr-calleg{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--ink-2);margin-top:6px}
.estr-calleg i{display:inline-block;width:12px;height:6px;border-radius:2px;margin-right:5px;vertical-align:middle}
.estr-motivos{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.estr-motivos div{background:var(--surface-2);border-radius:10px;padding:9px 11px;font-size:13px}
.estr-motivos b{display:block;font-size:13.5px;margin-bottom:2px}
.estr-fil{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 10px}
.estr-fil select{font:13px var(--f-body);padding:5px 8px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
.estr-proc{margin-top:14px}
.estr-proc>h4{margin:0 0 2px;font-size:14.5px}
.estr-proc>p{margin:0 0 8px;font-size:12.5px;color:var(--ink-3)}
.estr-item{border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;padding:9px 12px;margin:0 0 8px;background:var(--surface)}
.estr-item.pri{border-left-color:var(--accent)}
.estr-item .tt{font-weight:600;font-size:14px}
.estr-item .ds{font-size:13px;color:var(--ink-2);margin:3px 0 0}
.estr-item .ch{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.estr-item .ch span{font-size:11.5px;padding:2px 7px;border-radius:999px;background:var(--surface-2);color:var(--ink-2)}
.estr-item .ch span.pr{background:var(--accent-soft);color:var(--accent);font-weight:600}
.estr-item .rs{font-size:12.5px;color:var(--ink-2);margin-top:6px}
.estr-item .rs b{color:var(--ink)}
.estr-item .mt{font-size:12.5px;color:var(--accent);margin-top:4px}
.estr-tab{width:100%;border-collapse:collapse;font-size:13px}
.estr-tab th,.estr-tab td{padding:6px 8px;border-bottom:1px solid var(--grid);text-align:left;vertical-align:top}
.estr-tab td.num,.estr-tab th.num{text-align:right;font-variant-numeric:tabular-nums}
.estr-tab tr.clic{cursor:pointer}.estr-tab tr.clic:hover{background:var(--surface-2)}
.estr-cal-q{font-size:12px;color:var(--ink-3);margin-top:4px}
.estr-mat{border-collapse:separate;border-spacing:3px;width:100%;font-size:13px}
.estr-mat th,.estr-mat td{padding:7px 9px;text-align:center;border-radius:7px}
.estr-mat thead th{background:var(--surface-2);color:var(--ink-2);font-weight:600}
.estr-mat th.rowh{text-align:left;background:var(--surface-2);color:var(--ink);font-weight:600;min-width:150px;cursor:pointer;white-space:nowrap}
.estr-mat .colh{cursor:pointer}
.estr-mat .cell{background:var(--surface-2);color:var(--ink-3);font-variant-numeric:tabular-nums;font-weight:600}
.estr-mat .cell[tabindex]{cursor:pointer}
.estr-mat .cell[tabindex]:hover,.estr-mat .rowh:hover,.estr-mat .colh:hover{outline:2px solid var(--azul-2);outline-offset:-2px}
.estr-mat .cell.on,.estr-mat .rowh.on,.estr-mat .colh.on{outline:2px solid var(--azul);outline-offset:-2px}
.estr-mat .cell .pr{font-size:10.5px;opacity:.9;margin-left:2px}
.estr-mat td.tot,.estr-mat th.tot{background:transparent;color:var(--ink-3);font-weight:600}
.estr-matsel{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink-2);margin:12px 0 8px}
.estr-matsel .link{background:none;border:0;color:var(--azul-2);cursor:pointer;font:inherit;text-decoration:underline}
@media print{#pane-estr .estr-cab .acc,#pane-estr .estr-fil{display:none!important}}`;
    document.head.appendChild(st);
  }
  const COL_NIV = { muy_alta: "var(--h5)", alta: "var(--h4)", media: "var(--h3)", baja: "var(--h2)", sin: "var(--map-0)" };

  // ------------------------------------------------------------------ render
  async function render(c) {
    ctx = c; estilos();
    const pane = document.getElementById("pane-estr"); if (!pane) return;
    const yo = ++token;
    if (!CAT) { pane.innerHTML = `<section class="card sec"><p class="desc">Cargando estrategias…</p></section>`; await catalogo(); }
    if (yo !== token) return;
    if (!CAT) { pane.innerHTML = `<section class="card sec"><h3>Estrategias de reducción</h3><p class="desc">No se pudo leer <code>${RUTA}</code>. Genere el archivo con <code>python herramientas/estrategias_a_json.py</code>.</p></section>`; return; }
    const { st, NAL } = ctx;
    const cod = st.mpio || (st.dpto !== NAL ? st.dpto : null);
    const tipo = st.mpio ? "mun" : (st.dpto !== NAL ? "dep" : "nal");
    document.getElementById("aviso").hidden = true;
    const d = cod ? await diagnostico(cod) : null;
    if (yo !== token) return;
    ultimoDiag = d;
    const dsub = document.getElementById("dsub");
    if (dsub) dsub.textContent = tipo === "mun" ? `Municipio de ${d.depto} · DIVIPOLA ${cod}` : tipo === "dep" ? "Departamento · toque un municipio en el mapa para su ficha" : `${CAT.meta.n} estrategias de la SRR · elija un departamento y un municipio`;
    if (tipo === "mun" && document.getElementById("nombre")) document.getElementById("nombre").textContent = d.nombre;
    const items = priorizar(d || { reglas: [], region: null }, tipo).sort(ordenar);
    const nPri = items.filter(e => e.motivos.length).length;

    let h = `<details class="guia"><summary>Cómo usar esta pestaña</summary><ul>
      <li>Elija un <b>departamento</b> y luego toque un <b>municipio</b> en el mapa. La pestaña cruza las ${CAT.meta.n} estrategias de la Subdirección para la Reducción del Riesgo con lo que dicen los datos del portal sobre ese territorio.</li>
      <li>Las estrategias marcadas como <b>prioritarias aquí</b> responden a una señal concreta de los datos (recurrencia, cobertura que más se quema, comportamiento en El Niño o falta de capacidades registradas). Las demás siguen siendo válidas.</li>
      <li><b>Descargue la ficha (PDF)</b> para presentarla en el consejo de gestión del riesgo y acordar responsables, fechas y recursos.</li>
      <li>El <b>nivel de recurrencia</b> compara la frecuencia histórica de puntos de calor con el resto del país; no es un nivel de riesgo, porque no incluye exposición ni vulnerabilidad.</li></ul></details>`;

    // cabecera
    h += `<section class="card sec"><div class="estr-cab"><div>`;
    if (d) h += `<div class="kpis" style="margin:0 0 12px">${kpis(d).map(([l, v, n]) => `<div class="card kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="n">${esc(n)}</div></div>`).join("")}</div>
         <span class="estr-niv"><i style="background:${COL_NIV[d.nivel.k]}"></i>Recurrencia ${esc(d.nivel.t.toLowerCase())}</span>
         <ul class="estr-sint">${sintesis(d).map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
    else h += `<h3 style="margin:0 0 4px">Catálogo nacional de estrategias</h3><p class="desc" style="margin:0">Elija un departamento en el selector o en el mapa para ver su diagnóstico, y luego un municipio para su ficha municipal.</p>`;
    h += `</div><div class="acc">
         <button class="pbtn" id="estrPDF">⤓ ${tipo === "mun" ? "Ficha municipal" : tipo === "dep" ? "Ficha departamental" : "Catálogo"} (PDF)</button></div></div>`;
    if (d) {
      const P = d.perfil, mx = Math.max(...P.mes) || 1;
      h += `<div class="estr-cal" role="img" aria-label="Puntos de calor promedio por mes">` + P.mes.map((v, i) =>
        `<div class="m" title="${MES_L[i]}: ${fmt(v, 1)} puntos en promedio"><div class="b${P.pico[i] ? " p" : ""}" style="height:${Math.round(4 + v / mx * 56)}px"></div>${MES[i]}<div class="t${P.alist[i] ? " a" : P.pico[i] ? " p" : P.desp[i] ? " d" : ""}"></div></div>`).join("") + `</div>
        <div class="estr-calleg"><span><i style="background:var(--o1)"></i>Alistamiento</span><span><i style="background:var(--accent)"></i>Temporada de mayor actividad</span><span><i style="background:var(--c-bosque)"></i>Revisión y recuperación</span></div>
        <div class="estr-cal-q">Barras: puntos de calor promedio por mes, 2014–2025. Un mes es de mayor actividad cuando concentra al menos 1,25 veces su parte proporcional del año.</div>`;
    }
    h += `</section>`;

    if (d && d.reglas.length) h += `<section class="card sec"><h3>Por qué estas prioridades</h3><p class="desc">Señales que salen de los datos del portal para este territorio. Cada una activa un grupo de estrategias.</p>
      <div class="estr-motivos">${d.reglas.map(r => `<div><b>${esc(r.nombre)}</b>${esc(r.texto)}</div>`).join("")}</div></section>`;

    if (d && nPri) {
      const top = items.filter(e => e.motivos.length).slice(0, TOP);
      h += `<section class="card sec"><h3>Qué hacer primero</h3><p class="desc">Las ${top.length} estrategias con más señales a favor${nPri > top.length ? `, de ${nPri} prioritarias aquí` : ""}. Ordenadas por número de señales, momento (antes de la temporada primero) y plazo.</p>
        <div class="tscroll"><table class="estr-tab"><thead><tr><th>#</th><th>Estrategia</th><th>Cuándo</th><th>Lidera (sugerido)</th><th>Señales</th></tr></thead><tbody>` +
        top.map((e, i) => `<tr><td>${i + 1}</td><td><b>${esc(e.estrategia)}</b><br><span class="muted">${e.id} · ${esc(e.linea)} · ${esc(plazoTxt(e.plazo))}</span></td><td>${esc(CAT.momentos[e.complemento?.momento]?.nombre || "–")}</td><td>${esc(e.complemento?.lider || "–")}</td><td>${esc(e.motivos.map(m => m.nombre).join(" · "))}</td></tr>`).join("") +
        `</tbody></table></div></section>`;
    }
    if (tipo === "dep") {
      const lst = d.municipios.slice().sort((a, b) => b.prom - a.prom).slice(0, 12);
      const cnt = k => d.nivelesMun[k] || 0;
      h += `<section class="card sec"><h3>Municipios a priorizar en ${esc(d.nombre)}</h3>
        <p class="desc">${fmt(cnt("muy_alta"))} municipios con recurrencia muy alta y ${fmt(cnt("alta"))} con alta, de ${d.municipios.length}. Toque uno para ver su ficha.</p>
        <div class="tscroll"><table class="estr-tab"><thead><tr><th>Municipio</th><th class="num">Puntos de calor / año</th><th>Recurrencia</th><th>Cobertura más quemada</th><th class="num">Registros de capacidad</th></tr></thead><tbody>` +
        lst.map(m => `<tr class="clic" data-cod="${m.cod}" tabindex="0"><td>${esc(m.nombre)}</td><td class="num">${fmt(m.prom, 1)}</td><td><span class="estr-niv" style="padding:1px 8px"><i style="background:${COL_NIV[m.nivel.k]}"></i>${m.nivel.t}</span></td><td>${m.dom >= 0 ? COB[m.dom] + " (" + pct(m.mb.sh[m.dom]) + ")" : '<span class="muted">–</span>'}</td><td class="num">${m.cap || '<span class="muted">0</span>'}</td></tr>`).join("") +
        `</tbody></table></div></section>`;
    }

    // catálogo
    const P_ = CAT.procesos;
    h += `<section class="card sec"><h3>${tipo === "nal" ? "Estrategias" : `Estrategias ${tipo === "mun" ? "para el municipio" : "a cargo del departamento"}`} <span style="font-weight:400;color:var(--ink-3)">· ${items.length}${d ? ` · ${nPri} prioritarias aquí` : ""}</span></h3>
      ${(ui.matC || ui.matT) ? `<div class="estr-matsel">Filtrado desde la matriz: <b>${ui.matC ? esc(ui.matC) : ""}${ui.matC && ui.matT ? " · " : ""}${ui.matT ? esc(PLAZO_TXT[ui.matT]) + " plazo" : ""}</b> <button class="link" id="matClear2">Ver todas</button></div>` : ""}
      <div class="estr-fil">
        ${d ? `<div class="seg" id="estrFiltro" role="group" aria-label="Filtro"><button data-v="todas" aria-pressed="${ui.filtro === "todas"}">Todas</button><button data-v="pri" aria-pressed="${ui.filtro === "pri"}">Prioritarias aquí</button></div>` : ""}
        <select id="estrProc" aria-label="Proceso"><option value="">Todos los procesos</option>${ORDEN_PROC.map(k => `<option value="${k}"${ui.proceso === k ? " selected" : ""}>${esc(P_[k]?.nombre || k)}</option>`).join("")}</select>
        <select id="estrPlazo" aria-label="Plazo"><option value="">Todos los plazos</option>${["corto", "mediano", "largo"].map(k => `<option value="${k}"${ui.plazo === k ? " selected" : ""}>${PLAZO_TXT[k]} plazo</option>`).join("")}</select>
      </div>`;
    // el catálogo (derecha) respeta la selección de la matriz (izquierda): sin duplicar medidas
    const vis = items.filter(e => (ui.filtro !== "pri" || e.motivos.length) && (!ui.proceso || e.complemento?.proceso === ui.proceso) && (!ui.plazo || e.plazo.includes(ui.plazo))
      && (!ui.matC || e.linea === ui.matC) && (!ui.matT || (e.plazo || []).includes(ui.matT)));
    for (const k of ORDEN_PROC) {
      const g = vis.filter(e => (e.complemento?.proceso || "") === k); if (!g.length) continue;
      h += `<div class="estr-proc"><h4>${esc(P_[k]?.nombre || k)}</h4><p>${esc(P_[k]?.texto || "")}${P_[k]?.fao ? ` · Equivale a «${esc(P_[k].fao)}» en el manejo integral del fuego (FAO).` : ""}</p>` +
        g.map(e => itemHTML(e)).join("") + `</div>`;
    }
    const sinProc = vis.filter(e => !e.complemento?.proceso);
    if (sinProc.length) h += `<div class="estr-proc"><h4>Sin clasificar</h4>${sinProc.map(itemHTML).join("")}</div>`;
    if (!vis.length) h += `<p class="desc">No hay estrategias con ese filtro.</p>`;
    h += `</section>`;
    h += notasHTML();
    pane.innerHTML = h;
    // La matriz de medidas (análisis propio) va en la columna izquierda, debajo del mapa de Colombia.
    const matBox = document.getElementById("estr-left");
    if (matBox) matBox.innerHTML = matrizHTML(items, tipo);

    // eventos
    pane.querySelector("#estrPDF").onclick = () => fichaPDF(tipo, d, items);
    pane.querySelectorAll("#estrFiltro button").forEach(b => b.onclick = () => { ui.filtro = b.dataset.v; render(ctx); });
    const sp = pane.querySelector("#estrProc"); if (sp) sp.onchange = () => { ui.proceso = sp.value; render(ctx); };
    const sz = pane.querySelector("#estrPlazo"); if (sz) sz.onchange = () => { ui.plazo = sz.value; render(ctx); };
    pane.querySelectorAll("tr.clic[data-cod]").forEach(tr => {
      tr.onclick = () => ctx.elegirMpio(tr.dataset.cod);
      tr.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ctx.elegirMpio(tr.dataset.cod); } };
    });
    // matriz de medidas: clic en celda/fila/columna filtra la lista
    const matSel = el => {
      const c = el.dataset.c, t = el.dataset.t;
      if (el.classList.contains("cell")) { const on = ui.matC === c && ui.matT === t; ui.matC = on ? null : c; ui.matT = on ? null : t; }
      else if (el.classList.contains("rowh")) { const on = ui.matC === c && !ui.matT; ui.matC = on ? null : c; ui.matT = null; }
      else if (el.classList.contains("colh")) { const on = ui.matT === t && !ui.matC; ui.matT = on ? null : t; ui.matC = null; }
      render(ctx);
    };
    (matBox || pane).querySelectorAll(".estr-mat .cell[tabindex], .estr-mat .rowh, .estr-mat .colh").forEach(el => {
      el.onclick = () => matSel(el);
      el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); matSel(el); } };
    });
    const limpiarMat = () => { ui.matC = null; ui.matT = null; render(ctx); };
    const mc = (matBox || pane).querySelector("#matClear"); if (mc) mc.onclick = limpiarMat;
    const mc2 = pane.querySelector("#matClear2"); if (mc2) mc2.onclick = limpiarMat;
    window.ESTR_RESUMEN = d ? sintesis(d).join(" ") : "";
  }

  function itemHTML(e) {
    const c = e.complemento || {}, mom = CAT.momentos[c.momento]?.nombre;
    return `<div class="estr-item${e.motivos.length ? " pri" : ""}"><div class="tt">${esc(e.estrategia)}</div>
      ${e.descripcion ? `<div class="ds">${esc(e.descripcion)}</div>` : ""}
      <div class="ch">${e.motivos.length ? `<span class="pr">Prioritaria aquí</span>` : ""}<span>${esc(e.linea)}</span><span>${esc(plazoTxt(e.plazo))}</span>${mom ? `<span>${esc(mom)}</span>` : ""}<span>Escala: ${esc(e.escala_txt || "–")}</span><span class="muted">${e.id}</span></div>
      ${c.lider ? `<div class="rs"><b>Lidera (sugerido):</b> ${esc(c.lider)}${c.apoyo ? ` · <b>Apoya:</b> ${esc(c.apoyo)}` : ""}<br><b>Evidencia:</b> ${esc(c.evidencia || "–")}</div>` : ""}
      ${e.motivos.length ? `<div class="mt">Por qué aquí: ${esc(e.motivos.map(m => m.nombre).join(" · "))}</div>` : ""}</div>`;
  }
  function notasHTML() {
    const q = CAT.calidad || {};
    return `<section class="card sec notas"><h3>Fuentes y reglas de cálculo</h3><ul>
      <li><b>Estrategias:</b> ${esc(CAT.meta.fuente)} (${CAT.meta.n} estrategias, procesado ${esc(CAT.meta.generado)}).</li>
      <li><b>Recurrencia:</b> puesto del promedio anual de puntos de calor VIIRS (toda la vegetación, 2014–2025) frente a todos los municipios (o departamentos) del país: muy alta = 10 % con más puntos; alta = siguiente 15 %; media = siguiente 25 %; baja = resto.</li>
      <li><b>Temporada:</b> meses que concentran al menos 1,25 veces su parte proporcional (1/12) de los puntos del año; alistamiento = los dos meses previos.</li>
      <li><b>El Niño:</b> puntos de calor de octubre a abril en ${esc(listaY(ctx.DATOS.nino?.temporadas || []))} frente al promedio de las demás temporadas completas 2014–2025 (se muestra si hay al menos 20 puntos en total).</li>
      <li><b>Cobertura quemada:</b> MapBiomas Fuego (30 m), promedio 2014–2025, en bosque, sabana o herbazal y pasto o cultivo. Las reglas se activan con 40 % o más (25 % para bosque).</li>
      <li><b>Capacidades:</b> registros de la Matriz Nacional de Capacidades SNGRD con base en el territorio; información parcial.</li>
      <li><b>Calidad del insumo (para la SRR):</b> ${q.sin_descripcion?.length || 0} estrategias sin descripción; ${q.filas_corridas?.length || 0} filas con la temporalidad corrida de columna; ${q.regiones_marcadas || 0} con regiones marcadas; ${q.posibles_duplicados?.length || 0} pares por revisar como posibles duplicados.</li></ul></section>`;
  }

  const nombreArchivo = d => (d ? `${d.nombre}_${d.cod}` : "Colombia").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_]+/g, "_") + "_" + new Date().toISOString().slice(0, 10);

  // -------------------------------------------------------------- PDF
  const AZUL = [14, 58, 102], NAR = [247, 148, 31], GRIS = [90, 100, 112], TINTA = [22, 25, 26], SUAVE = [244, 246, 249], ROJO = [212, 71, 31];
  const RGB_NIV = { muy_alta: [109, 31, 11], alta: [184, 64, 27], media: [229, 116, 63], baja: [247, 180, 124], sin: [210, 214, 210] };
  const pdfTxt = s => String(s ?? "").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[→]/g, "->").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/ | /g, " ");

  async function fichaPDF(tipo, d, items) {
    const btn = document.getElementById("estrPDF"), t0 = btn.textContent;
    btn.disabled = true; btn.textContent = "Preparando…";
    try {
      if (!window.jspdf?.jsPDF) throw new Error("No se pudo cargar el generador de PDF (jsPDF).");
      const ok = await cargarLib(LIBS.autotable, () => !!(window.jspdf?.jsPDF?.API?.autoTable));
      if (!ok) throw new Error("No se pudo cargar el complemento de tablas (jspdf-autotable).");
      const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
      construirPDF(doc, tipo, d, items);
      doc.save(`Ficha_estrategias_incendios_${nombreArchivo(d)}.pdf`);
    } catch (e) { console.error(e); alert("No se pudo generar la ficha: " + (e.message || e)); }
    finally { btn.disabled = false; btn.textContent = t0; }
  }

  function logoData() {
    const logo = document.querySelector("header.top img.logo");
    try { if (logo && logo.complete && logo.naturalWidth) { const r = logo.naturalHeight / logo.naturalWidth, w = Math.min(460, logo.naturalWidth), h = Math.round(w * r);
      const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(logo, 0, 0, w, h);
      return { src: c.toDataURL("image/jpeg", 0.92), r }; } } catch (e) {}
    return null;
  }

  function construirPDF(doc, tipo, d, items) {
    const PW = 210, PH = 297, MG = 14, CW = PW - 2 * MG, lg = logoData();
    const fecha = new Date().toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" });
    const fmax = ctx.M.metricas.firms_puntos.fecha_max;
    const titulo = tipo === "mun" ? "FICHA MUNICIPAL" : tipo === "dep" ? "FICHA DEPARTAMENTAL" : "CATÁLOGO NACIONAL";
    const lugar = d ? (d.esMun ? `${d.nombre}, ${d.depto}` : d.nombre) : "Colombia";
    let y;
    const T = (s, x, yy, o) => doc.text(pdfTxt(s), x, yy, o);
    const fuente = (st, sz, col) => { doc.setFont("helvetica", st); doc.setFontSize(sz); doc.setTextColor(...(col || TINTA)); };
    const parrafo = (s, x, yy, w, lh) => { const ls = doc.splitTextToSize(pdfTxt(s), w); doc.text(ls, x, yy); return yy + ls.length * lh; };
    const franja = () => { doc.setFillColor(...AZUL); doc.rect(MG, 0, CW * 0.66, 2, "F"); doc.setFillColor(...NAR); doc.rect(MG + CW * 0.66, 0, CW * 0.34, 2, "F"); };
    const necesito = h => { if (y + h > PH - 18) { doc.addPage(); franja(); y = 14; } };
    const seccion = (s, sub) => { necesito(16); fuente("bold", 11.5, AZUL); T(s, MG, y); y += 1.6; doc.setDrawColor(...NAR); doc.setLineWidth(0.6); doc.line(MG, y, MG + 18, y); y += 4.2;
      if (sub) { fuente("normal", 8.3, GRIS); y = parrafo(sub, MG, y, CW, 3.6) + 1; } };

    // ---- página 1: encabezado
    franja();
    if (lg) doc.addImage(lg.src, "JPEG", MG, 7, 30, 30 * lg.r);
    fuente("bold", 8, AZUL); T("UNGRD · SUBDIRECCIÓN PARA LA REDUCCIÓN DEL RIESGO", PW - MG, 10, { align: "right" });
    fuente("normal", 7.5, GRIS); T("Escenarios Incendios Forestales y Capacidades del SNGRD · Fenómeno El Niño 2026–2027", PW - MG, 14, { align: "right" });
    y = 30;
    fuente("bold", 9, NAR); T(`${titulo} DE REDUCCIÓN DEL RIESGO POR INCENDIOS FORESTALES`, MG, y); y += 8;
    let tz = 20; fuente("bold", tz, AZUL); while (tz > 13 && doc.getTextWidth(pdfTxt(lugar)) > CW) { tz -= 1; doc.setFontSize(tz); }
    const tl = doc.splitTextToSize(pdfTxt(lugar), CW); doc.text(tl, MG, y); y += (tl.length - 1) * tz * 0.42 + 5.5;
    fuente("normal", 8.2, GRIS);
    T([d?.esMun ? `DIVIPOLA ${d.cod}` : d ? `Código DANE ${d.cod}` : "", `Generada el ${fecha}`, `Puntos de calor hasta ${ctx.fechaTxt(fmax)}`].filter(Boolean).join("   ·   "), MG, y); y += 6;

    if (d) {
      // ---- tarjetas
      const k = kpis(d).map(([l, v, n]) => [l.toUpperCase(), v, n]);
      const w = (CW - 9) / 4;
      k.forEach(([l, v, n], i) => {
        const x = MG + i * (w + 3);
        doc.setFillColor(...SUAVE); doc.roundedRect(x, y, w, 21, 2, 2, "F");
        if (i === 1) { doc.setFillColor(...RGB_NIV[d.nivel.k]); doc.rect(x, y, 1.4, 21, "F"); }
        fuente("bold", 6.3, GRIS); T(l, x + 3, y + 4.5);
        fuente("bold", 14, AZUL); T(v, x + 3, y + 11.5);
        fuente("normal", 6.6, GRIS); doc.text(doc.splitTextToSize(pdfTxt(n), w - 5), x + 3, y + 15.5);
      });
      y += 26;

      // ---- síntesis
      seccion("En síntesis");
      fuente("normal", 9, TINTA);
      for (const s of sintesis(d)) { necesito(8); doc.setFillColor(...NAR); doc.circle(MG + 1.2, y - 1.1, 0.8, "F"); y = parrafo(s, MG + 4, y, CW - 4, 4.1) + 1.2; }
      y += 2;

      // ---- calendario
      seccion("Cuándo actuar", "Barras: puntos de calor promedio por mes (VIIRS 2014–2025). Debajo, el calendario de acción que se deriva de la temporada del territorio.");
      necesito(40);
      const P = d.perfil, mx = Math.max(...P.mes) || 1, bw = CW / 12, hB = 22;
      P.mes.forEach((v, i) => {
        const x = MG + i * bw, h = Math.max(0.4, v / mx * hB);
        doc.setFillColor(...(P.pico[i] ? ROJO : [200, 205, 210])); doc.rect(x + 1.2, y + hB - h, bw - 2.4, h, "F");
        fuente("normal", 6.2, GRIS); if (v > 0) T(fmt(v, v < 10 ? 1 : 0), x + bw / 2, y + hB - h - 1, { align: "center" });
        fuente("bold", 7, TINTA); T(MES[i], x + bw / 2, y + hB + 4, { align: "center" });
        const c = P.alist[i] ? [31, 111, 178] : P.pico[i] ? ROJO : P.desp[i] ? [47, 125, 74] : null;
        if (c) { doc.setFillColor(...c); doc.rect(x + 0.6, y + hB + 6, bw - 1.2, 2.6, "F"); }
      });
      y += hB + 13;
      fuente("normal", 7.2, GRIS);
      [[[31, 111, 178], "Alistamiento (acciones de antes de la temporada)"], [ROJO, "Temporada de mayor actividad"], [[47, 125, 74], "Revisión y recuperación"]].forEach(([c, t], i) => {
        const x = MG + [0, 72, 128][i]; doc.setFillColor(...c); doc.rect(x, y - 2.2, 5, 2.4, "F"); T(t, x + 6.5, y);
      });
      y += 6;
      if (!P.pico.some(Boolean)) { fuente("italic", 8, GRIS); T("Sin registros suficientes para definir una temporada; aplique el calendario departamental.", MG, y); y += 5; }
    } else {
      fuente("normal", 9, TINTA);
      y = parrafo(`Catálogo de las ${CAT.meta.n} estrategias de reducción del riesgo por incendios forestales elaboradas por la Subdirección para la Reducción del Riesgo de la UNGRD, organizadas por proceso de la Ley 1523 de 2012. Para una ficha con diagnóstico y prioridades, elija un departamento o un municipio en el portal.`, MG, y, CW, 4.2) + 4;
    }

    // ---- por qué
    if (d && d.reglas.length) {
      seccion("Por qué estas prioridades", "Señales que salen de los datos del portal para este territorio. Cada señal activa un grupo de estrategias del catálogo.");
      doc.autoTable({ startY: y, margin: { left: MG, right: MG, bottom: 18 }, theme: "plain",
        styles: { font: "helvetica", fontSize: 8, cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 }, textColor: TINTA },
        columnStyles: { 0: { cellWidth: 52, fontStyle: "bold", textColor: AZUL } },
        body: d.reglas.map(r => [pdfTxt(r.nombre), pdfTxt(r.texto)]),
        didParseCell: h => { if (h.row.index % 2 === 0) h.cell.styles.fillColor = SUAVE; } });
      y = doc.lastAutoTable.finalY + 6;
    }

    // ---- municipios a priorizar (departamental)
    if (tipo === "dep") {
      const lst = d.municipios.slice().sort((a, b) => b.prom - a.prom).slice(0, 15);
      seccion(`Municipios a priorizar`, `Los 15 municipios con más puntos de calor por año en ${d.nombre}. ${fmt(d.nivelesMun.muy_alta || 0)} de ${d.municipios.length} tienen recurrencia muy alta y ${fmt(d.nivelesMun.alta || 0)} alta. El departamento apoya a sus municipios por concurrencia y subsidiariedad (Ley 1523 de 2012).`);
      doc.autoTable({ startY: y, margin: { left: MG, right: MG, bottom: 18 }, theme: "grid",
        head: [["Municipio", "Puntos / año", "Puesto país", "Recurrencia", "Cobertura más quemada", "Registros de capacidad"]],
        body: lst.map(m => [pdfTxt(m.nombre), fmt(m.prom, 1), fmt(m.puesto), m.nivel.t, m.dom >= 0 ? `${COB[m.dom]} (${pct(m.mb.sh[m.dom])})` : "–", String(m.cap)]),
        headStyles: { fillColor: AZUL, textColor: 255, fontSize: 7.5 }, styles: { fontSize: 7.8, cellPadding: 1.5, lineColor: [225, 228, 232], lineWidth: 0.2 },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 5: { halign: "right" } } });
      y = doc.lastAutoTable.finalY + 6;
    }

    // ---- qué hacer primero
    const priT = items.filter(e => e.motivos.length).sort(ordenar), pri = priT.slice(0, TOP);
    if (d && pri.length) {
      seccion("Qué hacer primero", `Las ${pri.length} estrategias con más señales a favor${priT.length > pri.length ? ` (de ${priT.length} prioritarias aquí, marcadas con «P» en el catálogo)` : ""}. Ordenadas por número de señales, momento (antes de la temporada primero) y plazo. Marque la casilla al cumplir.`);
      tablaEstrategias(doc, pri, MG, y, true); y = doc.lastAutoTable.finalY + 6;
    }

    // ---- catálogo completo por proceso
    necesito(60);
    seccion(d ? (tipo === "mun" ? "Catálogo completo para el municipio" : "Catálogo de estrategias a cargo del departamento") : "Catálogo por proceso de gestión del riesgo",
      `${items.length} estrategias de la SRR que aplican a la escala ${tipo === "mun" ? "municipal o local" : tipo === "dep" ? "departamental o regional" : "de cualquier territorio"}, agrupadas por proceso de la Ley 1523 de 2012 (entre paréntesis, su equivalente en el manejo integral del fuego de la FAO). ${d ? "Las marcadas con «P» son prioritarias aquí." : ""}`);
    for (const k of ORDEN_PROC) {
      const g = items.filter(e => e.complemento?.proceso === k).sort(ordenar); if (!g.length) continue;
      necesito(20);
      fuente("bold", 9.2, TINTA); T(`${CAT.procesos[k].nombre}  (${CAT.procesos[k].fao})`, MG, y); y += 3.8;
      fuente("normal", 7.6, GRIS); y = parrafo(CAT.procesos[k].texto, MG, y, CW, 3.3) + 0.8;
      tablaEstrategias(doc, g, MG, y, false, !!d); y = doc.lastAutoTable.finalY + 5;
    }

    // ---- cómo usar y fuentes
    necesito(70);
    seccion("Cómo usar esta ficha");
    fuente("normal", 8.6, TINTA);
    const pasos = [
      `Preséntela en sesión del ${tipo === "dep" ? "Consejo Departamental (CDGRD)" : "Consejo Municipal (CMGRD)"} y acuerde quién lidera cada estrategia priorizada.`,
      "Registre en el acta el responsable, la fecha y los recursos de cada estrategia priorizada, y use la casilla de «Qué hacer primero» para el seguimiento.",
      `Incorpore las acciones en el ${tipo === "dep" ? "PDGRD" : "PMGRD"} y en el plan anual de inversiones del Fondo Territorial de Gestión del Riesgo.`,
      "Complete las acciones de alistamiento antes de la temporada de mayor actividad y revise el avance al cerrarla.",
      "Durante El Niño, haga cumplir la suspensión de quemas abiertas agrícolas y mineras (Resolución 1070 de 2026 del Ministerio de Ambiente), vigente hasta que el IDEAM informe que cesaron las condiciones que la motivaron.",
    ];
    pasos.forEach((p, i) => { necesito(9); fuente("bold", 8.6, NAR); T(`${i + 1}.`, MG, y); fuente("normal", 8.6, TINTA); y = parrafo(p, MG + 5, y, CW - 5, 3.9) + 1.3; });
    y += 3;
    seccion("Fuentes y notas");
    fuente("normal", 7.3, GRIS);
    const notas = [
      `Estrategias: ${CAT.meta.fuente}. Procesadas el ${CAT.meta.generado}.`,
      `Proceso de la Ley 1523, momento, responsable sugerido, evidencia y reglas de priorización: ${CAT.meta.complemento?.estado || "propuesta técnica"} (versión ${CAT.meta.complemento?.version || "-"}).`,
      "Puntos de calor: VIIRS S-NPP (NASA FIRMS) sobre vegetación, promedio de los años completos 2014–2025. Área quemada: MapBiomas Fuego, Landsat 30 m, 2014–2025. Capacidades: Matriz Nacional de Capacidades para la Atención de Incendios SNGRD (información parcial). Límites: DIVIPOLA-DANE.",
      "Recurrencia: puesto del territorio en el país según el promedio anual de puntos de calor (muy alta = 10 % superior; alta = siguiente 15 %; media = siguiente 25 %; baja = resto). No es un nivel de riesgo: no incluye exposición ni vulnerabilidad.",
      "Temporada: meses que concentran al menos 1,25 veces su parte proporcional de los puntos del año; alistamiento = los dos meses previos. El Niño: puntos de octubre a abril en las temporadas El Niño frente al promedio de las demás temporadas completas.",
      "Marco: Ley 1523 de 2012 (Política Nacional de Gestión del Riesgo); Decreto 2157 de 2017 (planes de gestión del riesgo de entidades públicas y privadas, PGRDEPP); Resolución 1070 de 2026 (MinAmbiente). Referentes: FAO, Directrices voluntarias de manejo integral del fuego (2024); PNUMA, «Spreading like Wildfire» (2022).",
      "Herramienta de apoyo a la gestión del riesgo. No reemplaza las alertas oficiales del IDEAM, el SGC ni la UNGRD.",
    ];
    for (const n of notas) { necesito(8); y = parrafo("· " + n, MG, y, CW, 3.2) + 1; }

    // ---- pies
    const np = doc.getNumberOfPages();
    for (let p = 1; p <= np; p++) {
      doc.setPage(p);
      doc.setDrawColor(217, 222, 233); doc.setLineWidth(0.2); doc.line(MG, PH - 12, PW - MG, PH - 12);
      fuente("normal", 6.5, GRIS);
      T(`${titulo.charAt(0) + titulo.slice(1).toLowerCase()} · ${lugar} · Estrategias SRR-UNGRD para incendios forestales`, MG, PH - 8);
      fuente("bold", 6.5, ROJO); T("VERSIÓN DE PREPRODUCCIÓN Y DESARROLLO · Oficial: scr-ungrd.github.io/escenarios-incendios-sngrd", MG, PH - 5);
      T(`Página ${p} de ${np}`, PW - MG, PH - 8, { align: "right" });
      if (p > 1) { fuente("bold", 7, AZUL); T(lugar, PW - MG, 8, { align: "right" }); }
    }
  }

  function tablaEstrategias(doc, lista, MG, y, conMotivo, marcarP) {
    const head = conMotivo ? [["", "Estrategia", "Cuándo", "Plazo", "Lidera (sugerido)", "Por qué aquí"]]
                           : [["", "Estrategia", "Plazo", "Escala", "Lidera (sugerido)", "Evidencia de cumplimiento"]];
    const body = lista.map(e => { const c = e.complemento || {};
      const est = pdfTxt(e.estrategia) + (e.descripcion ? "\n" + pdfTxt(e.descripcion) : "") + `\n${e.id} · ${pdfTxt(e.linea)}`;
      return conMotivo ? ["", est, pdfTxt(CAT.momentos[c.momento]?.nombre || "-"), plazoTxt(e.plazo).replace(" plazo", ""), pdfTxt(c.lider || "-"), pdfTxt(e.motivos.map(m => m.nombre).join("; "))]
                       : [marcarP && e.motivos.length ? "P" : "", est, plazoTxt(e.plazo).replace(" plazo", ""), pdfTxt(e.escala_txt), pdfTxt(c.lider || "-"), pdfTxt(c.evidencia || "-")]; });
    doc.autoTable({ startY: y, margin: { left: MG, right: MG, bottom: 18, top: 14 }, theme: "grid", head, body, rowPageBreak: "avoid",
      headStyles: { fillColor: AZUL, textColor: 255, fontSize: 7.4, cellPadding: 1.6 },
      styles: { font: "helvetica", fontSize: 7.6, cellPadding: 1.6, lineColor: [225, 228, 232], lineWidth: 0.2, textColor: TINTA, valign: "top" },
      columnStyles: conMotivo ? { 0: { cellWidth: 6 }, 1: { cellWidth: 66 }, 2: { cellWidth: 22 }, 3: { cellWidth: 15 }, 4: { cellWidth: 35 } }
                              : { 0: { cellWidth: 6, halign: "center", fontStyle: "bold", textColor: ROJO }, 1: { cellWidth: 66 }, 2: { cellWidth: 15 }, 3: { cellWidth: 22 }, 4: { cellWidth: 34 } },
      didParseCell: h => { if (h.section === "body" && h.column.index === 1) h.cell.styles.fontStyle = "bold"; },
      didDrawCell: h => {
        if (h.section !== "body") return;
        if (conMotivo && h.column.index === 0) { doc.setDrawColor(...AZUL); doc.setLineWidth(0.3); doc.rect(h.cell.x + 1.5, h.cell.y + 1.8, 3, 3); }
        if (h.column.index === 1) {
          // se repinta la celda: título en negrita, descripción normal y código en gris
          const e = lista[h.row.index], pl = h.cell.padding("left"), x = h.cell.x + pl, w = h.cell.width - pl - h.cell.padding("right");
          const lh = 7.6 * 1.15 / doc.internal.scaleFactor;
          let yy = h.cell.y + h.cell.padding("top") + 2.5;
          doc.setFillColor(255, 255, 255); doc.rect(h.cell.x + 0.15, h.cell.y + 0.15, h.cell.width - 0.3, h.cell.height - 0.3, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(7.6); doc.setTextColor(...TINTA);
          const t = doc.splitTextToSize(pdfTxt(e.estrategia), w); doc.text(t, x, yy); yy += t.length * lh;
          if (e.descripcion) { doc.setFont("helvetica", "normal"); doc.setTextColor(60, 66, 72); const dd = doc.splitTextToSize(pdfTxt(e.descripcion), w); doc.text(dd, x, yy); yy += dd.length * lh; }
          doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); doc.setTextColor(...GRIS); doc.text(pdfTxt(`${e.id} · ${e.linea}`), x, yy);
        }
      } });
  }

  window.ESTR = { render, diagnostico: c => diagnostico(c), catalogo };
})();
