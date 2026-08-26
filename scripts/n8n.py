#!/usr/bin/env python3
"""
Cliente de la Public API de n8n para gestionar la instancia desde el repo.

Sólo stdlib: no añade dependencias al proyecto.

Uso:
  python3 scripts/n8n.py list                       # workflows (id, activo, nombre)
  python3 scripts/n8n.py get <id> [fichero.json]    # baja un workflow
  python3 scripts/n8n.py create <fichero.json>      # alta desde JSON local
  python3 scripts/n8n.py update <id> <f.json> --yes # sobrescribe el remoto
  python3 scripts/n8n.py activate <id>
  python3 scripts/n8n.py deactivate <id> --yes
  python3 scripts/n8n.py delete <id> --yes
  python3 scripts/n8n.py executions [--workflow ID] [--limit N]
  python3 scripts/n8n.py execution <id>             # con datos de nodos
  python3 scripts/n8n.py raw GET /workflows/123     # escotilla para lo no cubierto

Credenciales: N8N_API_URL y N8N_API_KEY en .env.local (o .env) en la raíz.
Mismos nombres que en el repo de CyP, a propósito: un solo patrón por máquina.
"""
import argparse, json, sys, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Algunos proxies (Cloudflare entre ellos) rechazan el User-Agent por defecto de
# urllib con un 403. Cualquier UA propio pasa.
UA = "pizzeria-n8n/1.0"


def load_env():
    """Lee las credenciales del .env sin volcarlo entero a stdout."""
    for nombre in (".env.local", ".env"):
        f = ROOT / nombre
        if not f.exists():
            continue
        env = {}
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
        url, key = env.get("N8N_API_URL", "").rstrip("/"), env.get("N8N_API_KEY", "")
        if url and key:
            return url, key
    sys.exit("ERROR: faltan N8N_API_URL o N8N_API_KEY en .env.local")


BASE, KEY = (None, None)


def api(method, path, body=None, query=""):
    url = f"{BASE}/api/v1{path}{query}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"X-N8N-API-KEY": KEY, "accept": "application/json",
                 "content-type": "application/json", "User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detalle = e.read().decode(errors="replace")[:500]
        sys.exit(f"ERROR {e.code} en {method} {path}\n{detalle}")
    except urllib.error.URLError as e:
        sys.exit(f"ERROR de red contra {BASE}: {e.reason}")


# El schema de la Public API es additionalProperties:false tanto en 'node' como en
# 'workflowSettings'. Los exports de la UI traen claves que el PUT rechaza con 400
# (binaryMode, availableInMCP, timeSavedMode...), así que se filtran del payload.
NODE_KEYS = {"id", "name", "webhookId", "disabled", "notesInFlow", "notes", "type",
             "typeVersion", "executeOnce", "alwaysOutputData", "retryOnFail", "maxTries",
             "waitBetweenTries", "continueOnFail", "onError", "position", "parameters",
             "credentials", "createdAt", "updatedAt"}
SETTINGS_KEYS = {"saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution",
                 "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone",
                 "executionOrder", "callerPolicy"}


def build_body(doc):
    """Body estricto para POST/PUT /workflows: sólo name, nodes, connections, settings."""
    if "nodes" not in doc or "connections" not in doc:
        sys.exit("ERROR: el JSON no tiene nodes/connections")
    nodes, extra = [], set()
    for n in doc["nodes"]:
        extra |= set(n) - NODE_KEYS
        nodes.append({k: v for k, v in n.items() if k in NODE_KEYS})
    if extra:
        print(f"  (claves de nodo ignoradas: {', '.join(sorted(extra))})")
    settings = {k: v for k, v in doc.get("settings", {}).items() if k in SETTINGS_KEYS}
    settings.setdefault("executionOrder", "v1")
    return {"name": doc.get("name", "sin nombre"), "nodes": nodes,
            "connections": doc["connections"], "settings": settings}


def exigir_confirmacion(args, accion):
    if not args.yes:
        sys.exit(f"Operación destructiva ({accion}). Repite con --yes.")


def cmd_list(_):
    data = api("GET", "/workflows", query="?limit=200")["data"]
    if not data:
        print("(sin workflows)")
        return
    for w in sorted(data, key=lambda x: x["name"].lower()):
        print(f"  {'ON ' if w.get('active') else 'off'}  {w['id']:<20} {w['name']}")
    print(f"\n  {len(data)} workflow(s)")


def cmd_get(args):
    d = api("GET", f"/workflows/{args.id}")
    salida = json.dumps(d, indent=2, ensure_ascii=False)
    if args.fichero:
        Path(args.fichero).write_text(salida + "\n", encoding="utf-8")
        print(f"escrito: {args.fichero} ({len(d.get('nodes', []))} nodos)")
    else:
        print(salida)


def cmd_create(args):
    doc = json.loads(Path(args.fichero).read_text(encoding="utf-8"))
    d = api("POST", "/workflows", body=build_body(doc))
    print(f"creado: {d['id']}  {d['name']}")


def cmd_update(args):
    exigir_confirmacion(args, "sobrescribe el workflow remoto")
    doc = json.loads(Path(args.fichero).read_text(encoding="utf-8"))
    api("PUT", f"/workflows/{args.id}", body=build_body(doc))
    print(f"actualizado: {args.id}")


def cmd_activate(args):
    api("POST", f"/workflows/{args.id}/activate")
    print(f"activado: {args.id}")


def cmd_deactivate(args):
    exigir_confirmacion(args, "desactiva el workflow en producción")
    api("POST", f"/workflows/{args.id}/deactivate")
    print(f"desactivado: {args.id}")


def cmd_delete(args):
    exigir_confirmacion(args, "borra el workflow")
    api("DELETE", f"/workflows/{args.id}")
    print(f"borrado: {args.id}")


def cmd_executions(args):
    q = f"?limit={args.limit}"
    if args.workflow:
        q += f"&workflowId={args.workflow}"
    for e in api("GET", "/executions", query=q)["data"]:
        print(f"  {e['id']:<10} {e.get('status','?'):<10} {e.get('startedAt','')}  wf={e.get('workflowId')}")


def cmd_execution(args):
    print(json.dumps(api("GET", f"/executions/{args.id}", query="?includeData=true"),
                     indent=2, ensure_ascii=False))


def cmd_raw(args):
    body = json.loads(Path(args.fichero).read_text(encoding="utf-8")) if args.fichero else None
    print(json.dumps(api(args.metodo.upper(), args.ruta, body=body), indent=2, ensure_ascii=False))


def main():
    global BASE, KEY
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list").set_defaults(f=cmd_list)

    s = sub.add_parser("get"); s.add_argument("id"); s.add_argument("fichero", nargs="?")
    s.set_defaults(f=cmd_get)

    s = sub.add_parser("create"); s.add_argument("fichero"); s.set_defaults(f=cmd_create)

    s = sub.add_parser("update"); s.add_argument("id"); s.add_argument("fichero")
    s.add_argument("--yes", action="store_true"); s.set_defaults(f=cmd_update)

    s = sub.add_parser("activate"); s.add_argument("id"); s.set_defaults(f=cmd_activate)

    s = sub.add_parser("deactivate"); s.add_argument("id")
    s.add_argument("--yes", action="store_true"); s.set_defaults(f=cmd_deactivate)

    s = sub.add_parser("delete"); s.add_argument("id")
    s.add_argument("--yes", action="store_true"); s.set_defaults(f=cmd_delete)

    s = sub.add_parser("executions"); s.add_argument("--workflow"); s.add_argument("--limit", default=20)
    s.set_defaults(f=cmd_executions)

    s = sub.add_parser("execution"); s.add_argument("id"); s.set_defaults(f=cmd_execution)

    s = sub.add_parser("raw"); s.add_argument("metodo"); s.add_argument("ruta")
    s.add_argument("fichero", nargs="?"); s.set_defaults(f=cmd_raw)

    args = p.parse_args()
    BASE, KEY = load_env()
    args.f(args)


if __name__ == "__main__":
    main()
