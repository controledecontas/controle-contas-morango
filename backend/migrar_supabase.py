"""Le backup/*.json (gerado por backup/export.ps1) e popula SQLite + copia fotos.

Uso:
    cd backend
    python migrar_supabase.py
"""
import json
import shutil
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

# Ajusta path do banco pra este script rodar tanto no PC quanto no Pi.
BACKEND_DIR = Path(__file__).parent
REPO_DIR = BACKEND_DIR.parent
BACKUP_DIR = REPO_DIR / "backup"
FOTOS_SRC = BACKUP_DIR / "notas"
UPLOADS_DST = BACKEND_DIR / "uploads"

sys.path.insert(0, str(BACKEND_DIR))
from db import SessionLocal, init_db  # noqa: E402
from models import Item, Nota, ProdutoSugestao  # noqa: E402


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    # Supabase manda ISO com timezone; corta ate os segundos
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).replace(tzinfo=None)
    except ValueError:
        return None


def parse_d(s: str | None) -> date | None:
    if not s:
        return None
    return date.fromisoformat(s[:10])


def load_json(name: str) -> list[dict]:
    p = BACKUP_DIR / f"{name}.json"
    if not p.exists():
        print(f"AVISO: {p} nao encontrado — pulando")
        return []
    with p.open(encoding="utf-8-sig") as f:  # strip BOM
        content = f.read().strip()
    if not content:
        return []
    raw = json.loads(content)
    if isinstance(raw, dict):
        raw = [raw]
    return raw


def main() -> None:
    print(f"backup dir: {BACKUP_DIR}")
    print(f"uploads dst: {UPLOADS_DST}")
    UPLOADS_DST.mkdir(parents=True, exist_ok=True)
    init_db()

    notas = load_json("nota")
    itens = load_json("item")
    sug = load_json("produto_sugestao")

    db = SessionLocal()
    try:
        # Notas
        n_ins = 0
        for n in notas:
            if db.get(Nota, n["id"]) is not None:
                continue
            db.add(Nota(
                id=n["id"],
                data=parse_d(n.get("data")),
                fornecedor=n.get("fornecedor"),
                anexo_path=n.get("anexo_path"),
                obs=n.get("obs"),
                pago_por=n.get("pago_por") or "renan",
                created_at=parse_dt(n.get("created_at")) or datetime.utcnow(),
            ))
            n_ins += 1

        # Itens
        i_ins = 0
        for it in itens:
            if db.get(Item, it["id"]) is not None:
                continue
            db.add(Item(
                id=it["id"],
                nota_id=it["nota_id"],
                descricao=it["descricao"],
                valor=Decimal(str(it["valor"])),
                percentual_meu=Decimal(str(it["percentual_meu"])),
                quitado=bool(it.get("quitado", False)),
                data_quitacao=parse_d(it.get("data_quitacao")),
                created_at=parse_dt(it.get("created_at")) or datetime.utcnow(),
            ))
            i_ins += 1

        # Sugestoes
        s_ins = 0
        for s in sug:
            if db.query(ProdutoSugestao).filter_by(nome=s["nome"]).first():
                continue
            db.add(ProdutoSugestao(
                id=s.get("id"),
                nome=s["nome"],
                percentual_padrao=(Decimal(str(s["percentual_padrao"]))
                                    if s.get("percentual_padrao") is not None else None),
                ultima_vez_usado=parse_dt(s.get("ultima_vez_usado")) or datetime.utcnow(),
                vezes_usado=int(s.get("vezes_usado", 1)),
            ))
            s_ins += 1

        db.commit()
        print(f"inseridas: {n_ins} notas, {i_ins} itens, {s_ins} sugestoes")
    finally:
        db.close()

    # Fotos
    if FOTOS_SRC.exists():
        copiadas = 0
        for src in FOTOS_SRC.rglob("*"):
            if src.is_dir():
                continue
            # Preserva subpastas relativas (Supabase permite path com /)
            rel = src.relative_to(FOTOS_SRC)
            dst = UPLOADS_DST / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            if dst.exists():
                continue
            shutil.copy2(src, dst)
            copiadas += 1
        print(f"fotos copiadas: {copiadas}")
    else:
        print("AVISO: sem pasta backup/notas — pulando copia de fotos")

    print("OK — migracao concluida")


if __name__ == "__main__":
    main()
