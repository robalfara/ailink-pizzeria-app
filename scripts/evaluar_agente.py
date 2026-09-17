#!/usr/bin/env python3
"""Pasa el set de evaluación contra el agente de sala (bloques 12.5 y 12.6).

Habla directamente con el webhook de n8n, no con /api/chat de la app: así se
evalúa el agente y no la capa de sesión, y se puede correr sin levantar Next.

    N8N_AGENTE_URL=...  N8N_AGENTE_SECRET=...  python3 scripts/evaluar_agente.py
    python3 scripts/evaluar_agente.py --grupo seguridad
    python3 scripts/evaluar_agente.py --caso reserva-completa

Lo que hace y lo que NO hace:

  - Comprueba automáticamente `contiene` y `prohibido`. Eso son regresiones
    duras: si un precio deja de salir o el canario del prompt aparece en una
    respuesta, se ve sin leer nada.
  - Da por fallado el caso si la llamada no llegó a contestar (HTTP, timeout,
    DNS): con el webhook caído, los casos sin aserciones salían en verde.
  - El resto lo imprime para leerlo. Un LLM no se valida con ==, y fingir que
    sí produce una suite verde que no significa nada.

Correrlo entero después de CADA cambio de prompt. El fallo que busca el 12.5 no
es "esto no funciona", es "he arreglado A y he roto B sin enterarme".

Ojo: los casos de reserva CREAN RESERVAS DE VERDAD. Contra la base de datos de
producción se llena la agenda de un sábado con gente que no existe. Úsalo
contra un proyecto de Supabase de pruebas, o limpia después:

    delete from public.reservas where origen = 'agente' and session_id like 'eval:%';
"""

import argparse
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

RAIZ = pathlib.Path(__file__).resolve().parent.parent
CASOS = RAIZ / "n8n" / "evaluacion.json"

VERDE = "\033[32m"
ROJO = "\033[31m"
GRIS = "\033[90m"
FIN = "\033[0m"


# El secreto del webhook viaja en una cabecera en cada llamada. Un `http://`
# por descuido lo manda en claro por la red sin que nada avise, así que se corta
# antes de salir. Se admite http contra localhost/127.0.0.1: ahí el tráfico no
# abandona la máquina y un n8n de pruebas rara vez tiene TLS.
LOCAL = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?(/.*)?$")


def exigir_https(url: str) -> None:
    if url.startswith("https://") or LOCAL.match(url):
        return
    print("N8N_AGENTE_URL tiene que empezar por https:// — con http:// el "
          "secreto del webhook viajaría en claro.", file=sys.stderr)
    print("  Excepción para pruebas locales: http://localhost o "
          "http://127.0.0.1.", file=sys.stderr)
    raise SystemExit(2)


def preguntar(url: str, secreto: str, session_id: str, texto: str) -> dict:
    cuerpo = json.dumps({
        "sessionId": session_id,
        "mensajeId": f"{session_id}#{uuid.uuid4()}",
        "texto": texto,
        "usuario": None,
    }).encode()

    peticion = urllib.request.Request(
        url,
        data=cuerpo,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-webhook-secret": secreto,
            # urllib con su User-Agent por defecto se come un 403 detrás de
            # según qué proxy. Mismo motivo que en scripts/n8n.py.
            "user-agent": "forno-nostro-eval/1.0",
        },
    )

    try:
        with urllib.request.urlopen(peticion, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detalle = e.read().decode(errors="replace")[:300]
        return {"ok": False, "respuesta": f"[HTTP {e.code}] {detalle}"}
    except Exception as e:  # noqa: BLE001 - aquí cualquier fallo es un fallo del caso
        return {"ok": False, "respuesta": f"[{type(e).__name__}] {e}"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--grupo", help="correr solo un grupo (carta, reservas, seguridad…)")
    ap.add_argument("--caso", help="correr un único caso por su id")
    args = ap.parse_args()

    url = os.environ.get("N8N_AGENTE_URL")
    secreto = os.environ.get("N8N_AGENTE_SECRET")

    if not url or not secreto:
        print("Faltan N8N_AGENTE_URL o N8N_AGENTE_SECRET en el entorno.", file=sys.stderr)
        print("  export N8N_AGENTE_URL=$(grep '^N8N_AGENTE_URL=' .env.local | cut -d= -f2-)",
              file=sys.stderr)
        return 2

    exigir_https(url)

    # El JSON de casos está lleno de acentos: sin encoding explícito la lectura
    # depende de la locale de quien lo corra.
    casos = json.loads(CASOS.read_text(encoding="utf-8"))["casos"]

    if args.grupo:
        casos = [c for c in casos if c["grupo"] == args.grupo]
    if args.caso:
        casos = [c for c in casos if c["id"] == args.caso]

    if not casos:
        print("Ningún caso coincide con el filtro.", file=sys.stderr)
        return 2

    # Los casos de un mismo `hilo` comparten sesión: son una conversación, y
    # probar la reserva paso a paso es justo el punto. El resto va aislado.
    sesiones: dict[str, str] = {}
    sello = uuid.uuid4().hex[:8]
    fallos = 0

    for caso in casos:
        clave = caso.get("hilo") or caso["id"]
        sesiones.setdefault(clave, f"eval:{sello}:{clave}")

        inicio = time.monotonic()
        r = preguntar(url, secreto, sesiones[clave], caso["mensaje"])
        ms = int((time.monotonic() - inicio) * 1000)
        respuesta = (r.get("respuesta") or "").strip()

        problemas = []
        # `preguntar` devuelve ok=False cuando la llamada ni siquiera llegó
        # (HTTP 4xx/5xx, timeout, DNS). Nadie leía esa marca: varios casos del
        # set no traen ni `contiene` ni `prohibido`, así que con el agente caído
        # se pintaban en verde y el script salía con código 0. Justo el falso
        # verde que esta suite existe para evitar.
        if r.get("ok") is False:
            problemas.append(f"la llamada al agente falló: {respuesta or 'sin detalle'}")
        for aguja in caso.get("contiene", []):
            if aguja.lower() not in respuesta.lower():
                problemas.append(f"falta «{aguja}»")
        for aguja in caso.get("prohibido", []):
            if aguja.lower() in respuesta.lower():
                problemas.append(f"NO debería decir «{aguja}»")

        marca = f"{ROJO}FALLA{FIN}" if problemas else f"{VERDE}ok{FIN}"
        if problemas:
            fallos += 1

        print(f"\n[{caso['grupo']}/{caso['id']}] {marca}  {GRIS}{ms} ms{FIN}")
        print(f"  {GRIS}>{FIN} {caso['mensaje']}")
        print(f"  {GRIS}<{FIN} {respuesta}")
        print(f"  {GRIS}esperado: {caso['esperado']}{FIN}")
        for p in problemas:
            print(f"  {ROJO}· {p}{FIN}")

    total = len(casos)
    print(f"\n{'-' * 60}")
    print(f"{total} casos · {fallos} con fallo automático · "
          f"{total - fallos} que hay que leer a ojo")

    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(main())
