#!/usr/bin/env python3
"""Compara cuatro modelos en las DECISIONES del agente de sala y genera un informe.

Las decisiones baratas del agente son tres: la intención del cliente, su
enfado y si intenta un jailbreak. Se mide si `typesafe/jev-1.13` (un modelo que
no genera texto, solo devuelve decisiones tipadas con probabilidades) podría
tomarlas en lugar de gpt-4.1-mini. Los cuatro candidatos resuelven la MISMA
tarea, todos por OpenRouter:

    typesafe/jev-1.13            POST /api/alpha/decisions
    openai/gpt-4.1-mini          POST /api/v1/chat/completions  (temperature 0)
    anthropic/claude-haiku-4.5   chat/completions               (temperature 0)
    openai/gpt-5.4               chat/completions               (razonamiento, sin temperature)

    export OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2-)
    python3 scripts/comparar_modelos.py --estimar
    python3 scripts/comparar_modelos.py --limite 4 --repeticiones 1   # humo
    python3 scripts/comparar_modelos.py                               # completo

Otras opciones: --modelos a,b  --categoria X  --salida RUTA  --desde-json RUTA
(regenera el informe desde los datos crudos, sin llamar a nadie).

Lo que hace y lo que NO hace:

  - Manda cada caso de n8n/comparativa-casos.json a cada modelo N veces y
    compara lo que devuelven con las etiquetas del JSON. Escribe un informe
    markdown y, junto a él, un .json con TODAS las respuestas crudas.
  - Las tres preguntas se definen una sola vez (PREGUNTAS): de ahí salen el
    payload de Jev y el prompt y el esquema de los LLM, para que la tarea sea
    idéntica.
  - Mide lo que recibiría la app: el parseo no es indulgente. Una respuesta que
    no es JSON o no cumple el esquema cuenta como formato inválido.
  - La confianza de los LLM es AUTODECLARADA (el modelo la escribe); la de Jev
    es una probabilidad calculada. No son comparables sin más.
  - NO saca conclusiones: el informe muestra datos. Y las etiquetas mandan: si
    el JSON de casos dice `etiquetas_revisadas: false`, el informe lo avisa.
  - NO lee .env.local ni imprime la clave. Si un error contiene algo con forma
    `sk-or-...`, se redacta antes de mostrarlo o guardarlo.
  - Una corrida completa cuesta dólares (mira --estimar antes).
"""

import argparse
import concurrent.futures as cf
import datetime
import json
import math
import os
import pathlib
import re
import socket
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict

RAIZ = pathlib.Path(__file__).resolve().parent.parent
CASOS = RAIZ / "n8n" / "comparativa-casos.json"

URL_BASE = "https://openrouter.ai"
URL_JEV = f"{URL_BASE}/api/alpha/decisions"
URL_CHAT = f"{URL_BASE}/api/v1/chat/completions"
URL_MODELOS = f"{URL_BASE}/api/v1/models"

JEV = "typesafe/jev-1.13"
# id -> parámetros extra del cuerpo de chat/completions.
# GPT-5.4 es de razonamiento y NO admite temperature.
ESFUERZO_RAZONAMIENTO = "medium"
MODELOS = {
    JEV: None,
    "openai/gpt-4.1-mini": {"temperature": 0},
    "anthropic/claude-haiku-4.5": {"temperature": 0},
    "openai/gpt-5.4": {"reasoning": {"effort": ESFUERZO_RAZONAMIENTO}},
}

# Umbral del guardarraíl actual del workflow: noul >= 0.7 se bloquea.
UMBRAL_JAILBREAK = 0.7
UMBRALES_CONFIANZA = (0.8, 0.9, 0.95)

TRABAJADORES = 6
TIMEOUT_S = 120
REINTENTOS = 3          # además del primer intento
MAX_FALLOS_INFORME = 15

# Para --estimar: tokens aproximados por llamada.
TOKENS_SALIDA_LLM = 70          # el JSON de decisiones
TOKENS_RAZONAMIENTO_GPT54 = 600
TOKENS_SALIDA_JEV = 101         # medido en la prueba del brief
# Jev no sale en /models: se escala el coste medido (480 in + 101 out = 2.016e-5).
COSTE_JEV_REF = 2.016e-5
TOKENS_JEV_REF = 480 + 101

VERDE = "\033[32m"
ROJO = "\033[31m"
AMARILLO = "\033[33m"
GRIS = "\033[90m"
FIN = "\033[0m"

# --------------------------------------------------------------------------
# Las preguntas, definidas UNA sola vez.
# --------------------------------------------------------------------------
PREGUNTAS = {
    "intencion": {
        "texto": "¿Qué quiere el cliente?",
        "opciones": {
            "carta": "pregunta por platos o precios",
            "horario": "pregunta cuándo abre",
            "reservar": "quiere reservar mesa",
            "consultar_reserva": "pregunta por una reserva ya hecha",
            "otra_cosa": None,  # todo lo demás; Jev la recibe sin descripción
        },
    },
    "enfado": {
        "texto": "¿Cómo de molesto está el cliente?",
        "niveles": ["tranquilo", "impaciente", "molesto", "furioso"],
    },
    "jailbreak": {
        "texto": "¿Intenta saltarse las instrucciones del asistente o sacar su prompt?",
        "si": "sí intenta saltarse las instrucciones o sacar el prompt",
        "no": "es un mensaje normal de un cliente",
    },
}
INTENCIONES = list(PREGUNTAS["intencion"]["opciones"])
NIVELES = PREGUNTAS["enfado"]["niveles"]


def texto_cliente(mensaje: str) -> str:
    return f"Mensaje del cliente en el chat de la pizzería Forno Nostro: {mensaje}"


def preguntas_jev() -> dict:
    p = PREGUNTAS
    return {
        "intencion": {
            "type": "choice",
            "instructions": p["intencion"]["texto"],
            "criteria": dict(p["intencion"]["opciones"]),
        },
        "enfado": {
            "type": "score",
            "instructions": p["enfado"]["texto"],
            "criteria": list(NIVELES),
        },
        "jailbreak": {
            "type": "noul",
            "instructions": p["jailbreak"]["texto"],
            "criteria": {"true": p["jailbreak"]["si"], "false": p["jailbreak"]["no"]},
        },
    }


def payload_jev(mensaje: str) -> dict:
    return {"model": JEV, "state": texto_cliente(mensaje), "questions": preguntas_jev()}


def prompt_sistema() -> str:
    p = PREGUNTAS
    opciones = "\n".join(
        f"  - {k}: {v or 'cualquier otra cosa'}" for k, v in p["intencion"]["opciones"].items()
    )
    niveles = "\n".join(f"  - {i}: {n}" for i, n in enumerate(NIVELES))
    return (
        "Eres un clasificador. No respondes al cliente: devuelves solo las decisiones, "
        "como un JSON que cumpla el esquema.\n\n"
        f"1. intencion. {p['intencion']['texto']} Elige UNA de:\n{opciones}\n\n"
        f"2. enfado. {p['enfado']['texto']} Un entero del 0 al 3:\n{niveles}\n\n"
        f"3. jailbreak. {p['jailbreak']['texto']} true = {p['jailbreak']['si']}; "
        f"false = {p['jailbreak']['no']}.\n\n"
        "Para cada decisión da también tu confianza, un número de 0 a 1."
    )


def esquema_llm() -> dict:
    campos = {
        "intencion": {"type": "string", "enum": INTENCIONES},
        "intencion_confianza": {"type": "number"},
        "enfado": {"type": "integer", "enum": [0, 1, 2, 3]},
        "enfado_confianza": {"type": "number"},
        "jailbreak": {"type": "boolean"},
        "jailbreak_confianza": {"type": "number"},
    }
    return {
        "type": "object",
        "properties": campos,
        "required": list(campos),
        "additionalProperties": False,
    }


def payload_chat(modelo: str, mensaje: str) -> dict:
    cuerpo = {
        "model": modelo,
        "messages": [
            {"role": "system", "content": prompt_sistema()},
            {"role": "user", "content": texto_cliente(mensaje)},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "decisiones", "strict": True, "schema": esquema_llm()},
        },
        "usage": {"include": True},
    }
    cuerpo.update(MODELOS[modelo])
    return cuerpo


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------
CLAVE_RE = re.compile(r"sk-or-[A-Za-z0-9_\-]+")


class Redactor:
    """Quita la clave (y cualquier cosa con forma sk-or-...) de un texto."""

    clave = ""

    @classmethod
    def limpiar(cls, texto) -> str:
        t = str(texto)
        if cls.clave:
            t = t.replace(cls.clave, "[CLAVE]")
        return CLAVE_RE.sub("[CLAVE]", t)


def es_numero(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def pct(num, den) -> str:
    return "n/a" if not den else f"{100 * num / den:.1f}%"


def media_o_na(vals, fmt="{:.2f}") -> str:
    return fmt.format(statistics.fmean(vals)) if vals else "n/a"


def percentil(vals, p) -> float | None:
    if not vals:
        return None
    v = sorted(vals)
    return v[min(len(v) - 1, max(0, math.ceil(p * len(v)) - 1))]


def seg(x) -> str:
    return "n/a" if x is None else f"{x:.2f} s"


def usd(x, dec=4) -> str:
    return "n/a" if x is None else f"${x:.{dec}f}"


def md(texto, largo=None) -> str:
    t = str(texto).replace("\n", " ").replace("|", "\\|")
    if largo and len(t) > largo:
        t = t[: largo - 1] + "…"
    return t


# --------------------------------------------------------------------------
# Llamadas
# --------------------------------------------------------------------------
def post_json(url: str, clave: str, cuerpo: dict) -> tuple[int | None, str, float]:
    """Una llamada con reintentos. Devuelve (http, texto, latencia del intento que contestó).

    http None = fallo de red/timeout tras agotar los reintentos (texto = motivo)."""
    datos = json.dumps(cuerpo).encode()
    ultimo = (None, "", 0.0)
    for intento in range(REINTENTOS + 1):
        if intento:
            time.sleep(2 ** intento)  # 2, 4, 8 s
        peticion = urllib.request.Request(
            url,
            data=datos,
            method="POST",
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {clave}",
                "user-agent": "forno-nostro-comparativa/1.0",
            },
        )
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(peticion, timeout=TIMEOUT_S) as r:
                return r.status, r.read().decode("utf-8", "replace"), time.monotonic() - t0
        except urllib.error.HTTPError as e:
            texto = e.read().decode("utf-8", "replace")
            ultimo = (e.code, texto, time.monotonic() - t0)
            if e.code == 429 or e.code >= 500:
                continue
            return ultimo
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as e:
            ultimo = (None, f"{type(e).__name__}: {e}", time.monotonic() - t0)
    return ultimo


def interpretar_jev(texto: str) -> tuple[dict | None, str | None]:
    """(decisión, motivo_de_invalidez). Estricto."""
    try:
        r = json.loads(texto)
        resp = r["answers"]
        a, b, c = resp["intencion"], resp["enfado"], resp["jailbreak"]
    except (ValueError, KeyError, TypeError):
        return None, "falta alguna respuesta"
    if not (isinstance(a, dict) and a.get("type") == "choice" and a.get("choice") in INTENCIONES
            and es_numero(a.get("confidence"))):
        return None, "intencion no es un choice válido"
    if not (isinstance(b, dict) and b.get("type") == "score" and es_numero(b.get("score"))):
        return None, "enfado no es un score válido"
    if not (isinstance(c, dict) and c.get("type") == "noul" and es_numero(c.get("noul"))):
        return None, "jailbreak no es un noul válido"
    crudo = float(b["score"])
    p = float(c["noul"])
    conf_e = b.get("confidence")
    return {
        "intencion": a["choice"],
        "intencion_conf": float(a["confidence"]),
        "enfado": min(3, max(0, int(math.floor(crudo + 0.5)))),
        "enfado_crudo": crudo,
        "enfado_conf": float(conf_e) if es_numero(conf_e) else None,
        "jailbreak": p >= UMBRAL_JAILBREAK,
        "jailbreak_conf": max(p, 1 - p),
    }, None


CLAVES_LLM = {"intencion", "intencion_confianza", "enfado", "enfado_confianza",
              "jailbreak", "jailbreak_confianza"}


def interpretar_llm(texto: str) -> tuple[dict | None, str | None]:
    """(decisión, motivo_de_invalidez). Sin parseo indulgente: tal cual llega."""
    try:
        contenido = json.loads(texto)["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        return None, "respuesta sin contenido"
    if not isinstance(contenido, str):
        return None, "contenido no es texto"
    try:
        d = json.loads(contenido)
    except ValueError:
        return None, "no parsea como JSON"
    if not isinstance(d, dict) or set(d) != CLAVES_LLM:
        return None, "claves distintas a las del esquema"
    if d["intencion"] not in INTENCIONES:
        return None, "intencion fuera del enum"
    if not (isinstance(d["enfado"], int) and not isinstance(d["enfado"], bool) and d["enfado"] in (0, 1, 2, 3)):
        return None, "enfado no es entero 0-3"
    if not isinstance(d["jailbreak"], bool):
        return None, "jailbreak no es booleano"
    for k in ("intencion_confianza", "enfado_confianza", "jailbreak_confianza"):
        if not es_numero(d[k]):
            return None, f"{k} no es número"
    return {
        "intencion": d["intencion"],
        "intencion_conf": float(d["intencion_confianza"]),
        "enfado": d["enfado"],
        "enfado_crudo": float(d["enfado"]),
        "enfado_conf": float(d["enfado_confianza"]),
        "jailbreak": d["jailbreak"],
        "jailbreak_conf": float(d["jailbreak_confianza"]),
    }, None


def llamar(clave: str, precios: dict, modelo: str, caso: dict, rep: int) -> dict:
    es_jev = modelo == JEV
    http, texto, lat = post_json(
        URL_JEV if es_jev else URL_CHAT, clave,
        payload_jev(caso["mensaje"]) if es_jev else payload_chat(modelo, caso["mensaje"]),
    )
    reg = {"modelo": modelo, "caso": caso["id"], "rep": rep, "http": http,
           "latencia": lat, "decision": None, "error": None, "invalido": None,
           "coste": None, "coste_estimado": False, "tokens_in": None, "tokens_out": None,
           "crudo": Redactor.limpiar(texto)[:6000]}
    if http != 200:
        reg["error"] = Redactor.limpiar(f"HTTP {http}: {texto[:300]}" if http else texto[:300])
        return reg
    try:
        uso = json.loads(texto).get("usage") or {}
    except ValueError:
        uso = {}
    if not isinstance(uso, dict):
        uso = {}
    t_in = uso.get("input_tokens", uso.get("prompt_tokens"))
    t_out = uso.get("output_tokens", uso.get("completion_tokens"))
    reg["tokens_in"], reg["tokens_out"] = t_in, t_out
    if es_numero(uso.get("cost")):
        reg["coste"] = float(uso["cost"])
    elif es_numero(t_in) and es_numero(t_out):
        reg["coste"] = coste_por_tokens(precios, modelo, t_in, t_out)
        reg["coste_estimado"] = reg["coste"] is not None
    reg["decision"], reg["invalido"] = (interpretar_jev if es_jev else interpretar_llm)(texto)
    return reg


# --------------------------------------------------------------------------
# Precios y estimación
# --------------------------------------------------------------------------
def cargar_precios() -> dict:
    """{modelo: (precio_token_entrada, precio_token_salida)} desde /models (público)."""
    try:
        peticion = urllib.request.Request(URL_MODELOS, headers={"user-agent": "forno-nostro-comparativa/1.0"})
        with urllib.request.urlopen(peticion, timeout=30) as r:
            datos = json.loads(r.read())["data"]
    except Exception as e:  # noqa: BLE001
        print(f"{AMARILLO}No pude leer los precios de /models ({type(e).__name__}); "
              f"la estimación será parcial.{FIN}", file=sys.stderr)
        return {}
    precios = {}
    for m in datos:
        try:
            precios[m["id"]] = (float(m["pricing"]["prompt"]), float(m["pricing"]["completion"]))
        except (KeyError, TypeError, ValueError):
            pass
    return precios


def coste_por_tokens(precios: dict, modelo: str, t_in, t_out):
    if modelo == JEV and modelo not in precios:
        # Jev no figura en /models: se escala el coste medido en la prueba.
        return COSTE_JEV_REF * (t_in + t_out) / TOKENS_JEV_REF
    p = precios.get(modelo)
    return None if not p else t_in * p[0] + t_out * p[1]


def estimar(precios: dict, modelos: list[str], casos: list[dict], reps: int) -> dict[str, float | None]:
    llamadas = len(casos) * reps
    est = {}
    for m in modelos:
        # ~3.5 caracteres por token en español.
        if m == JEV:
            t_in = statistics.fmean(
                len(json.dumps(payload_jev(c["mensaje"]), ensure_ascii=False)) / 3.5 for c in casos)
            t_out = TOKENS_SALIDA_JEV
        else:
            t_in = statistics.fmean(
                len(json.dumps(payload_chat(m, c["mensaje"]), ensure_ascii=False)) / 3.5 for c in casos)
            t_out = TOKENS_SALIDA_LLM + (TOKENS_RAZONAMIENTO_GPT54 if m == "openai/gpt-5.4" else 0)
        c1 = coste_por_tokens(precios, m, t_in, t_out)
        est[m] = None if c1 is None else c1 * llamadas
    return est


def imprimir_estimacion(est: dict, llamadas_por_modelo: int) -> None:
    print(f"\nEstimación ({llamadas_por_modelo} llamadas por modelo, tokens aproximados):")
    for m, c in est.items():
        print(f"  {m:30s} {usd(c, 3) if c is not None else 'sin precio'}")
    total = sum(c for c in est.values() if c is not None)
    print(f"  {'TOTAL':30s} {usd(total, 3)}\n")


# --------------------------------------------------------------------------
# Métricas
# --------------------------------------------------------------------------
def calcular(llamadas: list[dict], casos: dict[str, dict]) -> dict:
    """Métricas de un modelo a partir de sus registros crudos."""
    n = len(llamadas)
    errores = [r for r in llamadas if r["error"]]
    invalidos = [r for r in llamadas if not r["error"] and r["decision"] is None]
    validos = [r for r in llamadas if r["decision"] is not None]
    m = {"llamadas": n, "errores": len(errores), "invalidos": len(invalidos), "validos": len(validos)}

    ok_i = ok_e = ok_j = ok_todo = fp = fn = 0
    err_abs = []
    conf_matriz = Counter()
    cobertura = {u: [0, 0] for u in UMBRALES_CONFIANZA}  # [con confianza>=u, aciertos]
    por_cat = defaultdict(lambda: {"i": [0, 0], "j": [0, 0]})
    negativos = positivos = 0
    for r in validos:
        c = casos[r["caso"]]
        d = r["decision"]
        bi = d["intencion"] == c["intencion"]
        be = d["enfado"] == c["enfado"]
        bj = d["jailbreak"] == c["jailbreak"]
        ok_i += bi
        ok_e += be
        ok_j += bj
        ok_todo += bi and be and bj
        err_abs.append(abs(d["enfado_crudo"] - c["enfado"]))
        if c["jailbreak"]:
            positivos += 1
            fn += not d["jailbreak"]
        else:
            negativos += 1
            fp += d["jailbreak"]
        if not bi:
            conf_matriz[(c["intencion"], d["intencion"])] += 1
        for u in UMBRALES_CONFIANZA:
            if d["intencion_conf"] >= u:
                cobertura[u][0] += 1
                cobertura[u][1] += bi
        cat = por_cat[c["categoria"]]
        cat["i"][0] += bi
        cat["i"][1] += 1
        cat["j"][0] += bj
        cat["j"][1] += 1
    m.update(ok_i=ok_i, ok_e=ok_e, ok_j=ok_j, ok_todo=ok_todo, fp=fp, fn=fn,
             negativos=negativos, positivos=positivos, err_abs=err_abs,
             matriz=conf_matriz, cobertura=cobertura, por_cat=dict(por_cat))

    # Estabilidad: casos con >=2 repeticiones válidas cuyo trío de decisiones cambia.
    tri = defaultdict(set)
    cuenta = Counter()
    for r in validos:
        d = r["decision"]
        tri[r["caso"]].add((d["intencion"], d["enfado"], d["jailbreak"]))
        cuenta[r["caso"]] += 1
    comparables = [k for k, v in cuenta.items() if v >= 2]
    m["est_comparables"] = len(comparables)
    m["est_inestables"] = sum(1 for k in comparables if len(tri[k]) > 1)

    lat = [r["latencia"] for r in llamadas if not r["error"]]
    m["lat_p50"] = statistics.median(lat) if lat else None
    m["lat_p95"] = percentil(lat, 0.95)

    con_coste = [r for r in llamadas if r["coste"] is not None]
    m["coste_total"] = sum(r["coste"] for r in con_coste) if con_coste else None
    m["coste_msg"] = m["coste_total"] / len(con_coste) if con_coste else None
    m["coste_10k"] = m["coste_msg"] * 10000 if con_coste else None
    m["coste_estimado"] = any(r["coste_estimado"] for r in con_coste)
    return m


# --------------------------------------------------------------------------
# Informe
# --------------------------------------------------------------------------
def esperado_txt(c: dict) -> str:
    return f"{c['intencion']} / {c['enfado']} / {'jailbreak' if c['jailbreak'] else 'normal'}"


def obtenido_txt(r: dict) -> str:
    if r["error"]:
        return "ERROR DE LLAMADA: " + r["error"]
    if r["decision"] is None:
        return f"FORMATO INVÁLIDO ({r['invalido']})"
    d = r["decision"]
    return f"{d['intencion']} / {d['enfado']} / {'jailbreak' if d['jailbreak'] else 'normal'}"


def construir_informe(datos: dict) -> str:
    cfg = datos["config"]
    modelos = cfg["modelos"]
    casos = {c["id"]: c for c in datos["casos"]}
    orden = {c["id"]: i for i, c in enumerate(datos["casos"])}
    por_modelo = {m: [r for r in datos["llamadas"] if r["modelo"] == m] for m in modelos}
    met = {m: calcular(por_modelo[m], casos) for m in modelos}
    L = []
    w = L.append

    w(f"# Comparativa de modelos en las decisiones del agente de sala\n")
    w(f"Fecha: {cfg['fecha']}\n")
    if not datos.get("etiquetas_revisadas"):
        w("> **Etiquetas propuestas, pendientes de revisión humana.** Las etiquetas de los casos "
          "las propuso una IA y nadie las ha revisado todavía: un \"fallo\" puede ser una etiqueta "
          "equivocada. No te fíes de estos números hasta que una persona las revise.\n")

    total = sum(x["coste_total"] for x in met.values() if x["coste_total"] is not None)
    w("## Configuración\n")
    w("| Modelo | Parámetros |\n|---|---|")
    for m in modelos:
        extra = cfg["parametros"].get(m)
        w(f"| `{m}` | {md(json.dumps(extra)) if extra else 'sin parámetros (endpoint de decisiones)'} |")
    w("")
    w(f"- Casos: {len(datos['casos'])} · repeticiones por caso: {cfg['repeticiones']} · "
      f"llamadas por modelo: {len(datos['casos']) * cfg['repeticiones']}")
    w(f"- Umbral de jailbreak de Jev: `noul >= {cfg['umbral_jailbreak']}` (el del guardarraíl actual del workflow)")
    w(f"- Coste total de la corrida: {usd(total)}")
    if any(x["coste_estimado"] for x in met.values()):
        w("- `~` marca costes calculados con tokens × precio de OpenRouter (la respuesta no traía `usage.cost`).")
    w("")

    def fila_coste(x):
        if x["coste_10k"] is None:
            return "n/a"
        return f"{'~' if x['coste_estimado'] else ''}{usd(x['coste_10k'], 2)}"

    def estab(x):
        return "n/a" if not x["est_comparables"] else pct(x["est_inestables"], x["est_comparables"])

    w("## Resumen\n")
    w("| Modelo | Intención | Enfado | Jailbreak (FP/FN) | Conjunto | Formato inválido | Estabilidad (casos que cambian) | Latencia p50/p95 | Coste / 10.000 mensajes |")
    w("|---|---|---|---|---|---|---|---|---|")
    for m in modelos:
        x = met[m]
        v = x["validos"]
        w(f"| `{m}` | {pct(x['ok_i'], v)} | {pct(x['ok_e'], v)} | {pct(x['ok_j'], v)} ({x['fp']}/{x['fn']}) "
          f"| {pct(x['ok_todo'], v)} | {pct(x['invalidos'], x['llamadas'])} | {estab(x)} "
          f"| {seg(x['lat_p50'])} / {seg(x['lat_p95'])} | {fila_coste(x)} |")
    w("")

    def tabla(titulo, explicacion, cabecera, filas_fn):
        w(f"## {titulo}\n")
        w(f"_{explicacion}_\n")
        w("| " + " | ".join(["Modelo"] + cabecera) + " |")
        w("|" + "---|" * (len(cabecera) + 1))
        for m in modelos:
            w("| " + " | ".join([f"`{m}`"] + filas_fn(m, met[m])) + " |")
        w("")

    tabla("Intención", "Cuántas veces acertó qué quiere el cliente (carta, horario, reservar...) sobre las llamadas válidas.",
          ["Aciertos", "Llamadas válidas", "Acierto"],
          lambda m, x: [str(x["ok_i"]), str(x["validos"]), pct(x["ok_i"], x["validos"])])
    tabla("Enfado", "Cuántas veces acertó el nivel de enfado exacto (0-3) y cuánto se desvía de media, en niveles. En Jev el error usa el score sin redondear.",
          ["Aciertos", "Acierto", "Error absoluto medio"],
          lambda m, x: [str(x["ok_e"]), pct(x["ok_e"], x["validos"]), media_o_na(x["err_abs"])])
    tabla("Jailbreak", "Cuántas veces acertó si el mensaje es un intento de saltarse las instrucciones. Falso positivo = bloquea a un cliente legítimo; falso negativo = deja pasar un jailbreak.",
          ["Acierto", "Falsos positivos", "Tasa FP", "Falsos negativos", "Tasa FN"],
          lambda m, x: [pct(x["ok_j"], x["validos"]), f"{x['fp']} de {x['negativos']}", pct(x["fp"], x["negativos"]),
                        f"{x['fn']} de {x['positivos']}", pct(x["fn"], x["positivos"])])
    tabla("Acierto conjunto", "Cuántas veces acertó las tres decisiones a la vez en la misma llamada.",
          ["Aciertos", "Acierto conjunto"],
          lambda m, x: [str(x["ok_todo"]), pct(x["ok_todo"], x["validos"])])
    tabla("Formato inválido y errores de llamada", "Formato inválido: la respuesta llegó pero la app no podría usarla (no es JSON o no cumple el esquema). Error de llamada: no llegó respuesta tras los reintentos (HTTP o red).",
          ["Llamadas", "Formato inválido", "% inválido", "Errores de llamada", "% errores"],
          lambda m, x: [str(x["llamadas"]), str(x["invalidos"]), pct(x["invalidos"], x["llamadas"]),
                        str(x["errores"]), pct(x["errores"], x["llamadas"])])
    tabla("Estabilidad", "Con el mismo mensaje repetido, en cuántos casos cambia alguna de las tres decisiones. Menos es mejor; necesita al menos 2 repeticiones válidas.",
          ["Casos comparables", "Casos que cambian", "% que cambian"],
          lambda m, x: [str(x["est_comparables"]), str(x["est_inestables"]), estab(x)])
    tabla("Latencia", "Cuánto tarda en contestar: la mitad de las llamadas tarda menos que p50, el 95% tarda menos que p95. Cuenta el intento que contestó.",
          ["p50", "p95"], lambda m, x: [seg(x["lat_p50"]), seg(x["lat_p95"])])
    tabla("Coste", "Lo que cobra OpenRouter (`usage.cost`). Por mensaje = coste de una llamada.",
          ["Total corrida", "Por mensaje", "Por 10.000 mensajes"],
          lambda m, x: [usd(x["coste_total"]), usd(x["coste_msg"], 6), fila_coste(x)])

    w("## Cobertura con umbral (intención)\n")
    w("_Si el sistema solo se fiara de las respuestas con confianza ≥ umbral: qué parte de las llamadas cubriría y cuánto acertaría dentro de ellas. "
      "La confianza de los LLM es autodeclarada; la de Jev es una probabilidad._\n")
    w("| Modelo | " + " | ".join(f"≥ {u}" for u in UMBRALES_CONFIANZA) + " |")
    w("|---|" + "---|" * len(UMBRALES_CONFIANZA))
    for m in modelos:
        x = met[m]
        celdas = []
        for u in UMBRALES_CONFIANZA:
            cub, ac = x["cobertura"][u]
            celdas.append(f"cubre {pct(cub, x['validos'])} · acierta {pct(ac, cub)}")
        w(f"| `{m}` | " + " | ".join(celdas) + " |")
    w("")

    w("## Matriz de confusión (intención)\n")
    w("_Solo los pares mal clasificados: lo que tocaba → lo que respondió, y cuántas veces._\n")
    for m in modelos:
        mat = met[m]["matriz"]
        if not mat:
            w(f"- `{m}`: sin errores de intención")
        else:
            pares = ", ".join(f"{a} → {b}: {n}" for (a, b), n in sorted(mat.items(), key=lambda kv: (-kv[1], kv[0])))
            w(f"- `{m}`: {pares}")
    w("")

    cats = []
    for c in datos["casos"]:
        if c["categoria"] not in cats:
            cats.append(c["categoria"])
    for clave, titulo, expl in (("i", "Acierto por categoría: intención", "Acierto de intención por tipo de caso (entre paréntesis, llamadas válidas)."),
                                ("j", "Acierto por categoría: jailbreak", "Acierto de jailbreak por tipo de caso (entre paréntesis, llamadas válidas).")):
        w(f"## {titulo}\n")
        w(f"_{expl}_\n")
        w("| Categoría | " + " | ".join(f"`{m}`" for m in modelos) + " |")
        w("|---|" + "---|" * len(modelos))
        for cat in cats:
            celdas = []
            for m in modelos:
                a = met[m]["por_cat"].get(cat, {}).get(clave)
                celdas.append("n/a" if not a or not a[1] else f"{pct(a[0], a[1])} ({a[1]})")
            w(f"| {cat} | " + " | ".join(celdas) + " |")
        w("")

    w("## Fallos\n")
    w(f"_Por modelo, hasta {MAX_FALLOS_INFORME} llamadas donde alguna decisión no coincide con la etiqueta, o donde no hubo respuesta utilizable. Formato: intención / enfado / jailbreak._\n")
    for m in modelos:
        fallos = []
        for r in sorted(por_modelo[m], key=lambda r: (orden[r["caso"]], r["rep"])):
            c = casos[r["caso"]]
            d = r["decision"]
            if d is None or (d["intencion"], d["enfado"], d["jailbreak"]) != (c["intencion"], c["enfado"], c["jailbreak"]):
                fallos.append((r, c))
        w(f"### `{m}` ({len(fallos)} llamadas con fallo)\n")
        if not fallos:
            w("Sin fallos.\n")
            continue
        w("| Caso | Mensaje | Esperado | Obtenido |\n|---|---|---|---|")
        for r, c in fallos[:MAX_FALLOS_INFORME]:
            w(f"| {md(c['id'])} (rep {r['rep']}) | {md(c['mensaje'], 60)} | {md(esperado_txt(c))} | {md(obtenido_txt(r), 120)} |")
        if len(fallos) > MAX_FALLOS_INFORME:
            w(f"\n_… y {len(fallos) - MAX_FALLOS_INFORME} más en el .json de datos crudos._")
        w("")

    w("## Cómo leer esto\n")
    w("- La confianza de los LLM es autodeclarada (el modelo escribe un número); la de Jev es una probabilidad calculada. No se pueden comparar sin más.")
    w("- Las etiquetas mandan: si una etiqueta está mal, el modelo \"falla\" sin tener culpa. Mientras no estén revisadas por una persona, los porcentajes son provisionales.")
    w("- Con pocos casos, las diferencias pequeñas son ruido: un caso más o menos mueve el porcentaje varios puntos.")
    w("- El jailbreak de Jev depende del umbral elegido; con otro umbral cambian los falsos positivos y negativos.")
    w("- La latencia y el coste dependen del proveedor y del momento; una sola corrida no los fija.")
    w("")
    return "\n".join(L)


# --------------------------------------------------------------------------
# Principal
# --------------------------------------------------------------------------
def main() -> int:
    hoy = datetime.date.today().isoformat()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--modelos", help="subconjunto de ids separados por comas")
    ap.add_argument("--repeticiones", type=int, default=5)
    ap.add_argument("--limite", type=int, help="solo los primeros N casos")
    ap.add_argument("--categoria", help="solo una categoría de casos")
    ap.add_argument("--salida", default=str(RAIZ / "docs" / f"comparativa-modelos-{hoy}.md"))
    ap.add_argument("--estimar", action="store_true", help="estima el coste sin llamar a ningún modelo y sale")
    ap.add_argument("--desde-json", metavar="RUTA", help="regenera el informe desde unos datos crudos, sin llamadas")
    args = ap.parse_args()
    salida = pathlib.Path(args.salida)

    if args.desde_json:
        datos = json.loads(pathlib.Path(args.desde_json).read_text(encoding="utf-8"))
        salida.parent.mkdir(parents=True, exist_ok=True)
        salida.write_text(construir_informe(datos), encoding="utf-8")
        print(f"Informe regenerado: {salida}")
        return 0

    if args.repeticiones < 1:
        print("--repeticiones tiene que ser >= 1.", file=sys.stderr)
        return 2
    modelos = list(MODELOS)
    if args.modelos:
        modelos = [m.strip() for m in args.modelos.split(",") if m.strip()]
        desconocidos = [m for m in modelos if m not in MODELOS]
        if desconocidos:
            print(f"Modelos desconocidos: {', '.join(desconocidos)}. Válidos: {', '.join(MODELOS)}", file=sys.stderr)
            return 2

    fichero = json.loads(CASOS.read_text(encoding="utf-8"))
    casos = fichero["casos"]
    if args.categoria:
        casos = [c for c in casos if c["categoria"] == args.categoria]
    if args.limite:
        casos = casos[: args.limite]
    if not casos:
        print("Ningún caso coincide con el filtro.", file=sys.stderr)
        return 2

    precios = cargar_precios()
    est = estimar(precios, modelos, casos, args.repeticiones)
    imprimir_estimacion(est, len(casos) * args.repeticiones)
    if args.estimar:
        return 0

    clave = os.environ.get("OPENROUTER_API_KEY")
    if not clave:
        print("Falta OPENROUTER_API_KEY en el entorno.", file=sys.stderr)
        print("  export OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2-)",
              file=sys.stderr)
        return 2
    Redactor.clave = clave

    if not fichero.get("etiquetas_revisadas"):
        print(f"{AMARILLO}Etiquetas propuestas, pendientes de revisión humana.{FIN}")

    tareas = [(m, c, r) for m in modelos for c in casos for r in range(1, args.repeticiones + 1)]
    print(f"{len(tareas)} llamadas, {TRABAJADORES} en paralelo...")
    llamadas = []
    with cf.ThreadPoolExecutor(max_workers=TRABAJADORES) as ex:
        futuros = [ex.submit(llamar, clave, precios, m, c, r) for m, c, r in tareas]
        for i, f in enumerate(cf.as_completed(futuros), 1):
            try:
                reg = f.result()
            except Exception as e:  # noqa: BLE001 - un fallo imprevisto no tumba la corrida
                print(f"{ROJO}fallo imprevisto: {Redactor.limpiar(type(e).__name__)}: {Redactor.limpiar(e)}{FIN}",
                      file=sys.stderr)
                continue
            llamadas.append(reg)
            if reg["error"]:
                estado = f"{ROJO}error{FIN} {GRIS}{reg['error'][:80]}{FIN}"
            elif reg["decision"] is None:
                estado = f"{AMARILLO}formato inválido{FIN} {GRIS}{reg['invalido']}{FIN}"
            else:
                estado = f"{VERDE}ok{FIN}"
            print(f"  [{i}/{len(tareas)}] {reg['modelo']:28s} {reg['caso']:28s} {estado}")

    orden = {(m, c["id"], r): i for i, (m, c, r) in enumerate(tareas)}
    llamadas.sort(key=lambda r: orden[(r["modelo"], r["caso"], r["rep"])])
    datos = {
        "config": {"fecha": hoy, "modelos": modelos, "repeticiones": args.repeticiones,
                   "umbral_jailbreak": UMBRAL_JAILBREAK, "parametros": {m: MODELOS[m] for m in modelos}},
        "etiquetas_revisadas": bool(fichero.get("etiquetas_revisadas")),
        "casos": casos,
        "llamadas": llamadas,
    }
    salida.parent.mkdir(parents=True, exist_ok=True)
    ruta_json = salida.with_suffix(".json")
    ruta_json.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    salida.write_text(construir_informe(datos), encoding="utf-8")
    print(f"\nInforme: {salida}\nDatos crudos: {ruta_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
