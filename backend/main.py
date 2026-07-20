"""FastAPI backend do Controle de Contas — Morango.

Escuta em 0.0.0.0:8001 (porta local no Pi). Expor via Tailscale Funnel 10000.
Uploads salvos em ./uploads/.
"""
import os
import shutil
import uuid
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.orm import Session, selectinload

from db import get_db, init_db
from models import Item, Nota, ProdutoSugestao
from schemas import (
    ItemOut, NotaCreate, NotaOut, QuitadoUpdate, ResumoMes,
    SaldoOut, Sugestao,
)

UPLOADS_DIR = Path(os.environ.get("CONTAS_UPLOADS", Path(__file__).parent / "uploads"))
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Controle de Contas — Morango")

# CORS liberado (auth eh via senha no frontend + Tailscale Funnel).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


# ---------- helpers ----------
def _quantize(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"))


def _upsert_sugestao(db: Session, descricao: str, pct: Decimal) -> None:
    nome = descricao.strip().lower()
    if not nome:
        return
    existing = db.execute(
        select(ProdutoSugestao).where(ProdutoSugestao.nome == nome)
    ).scalar_one_or_none()
    if existing is None:
        db.add(ProdutoSugestao(nome=nome, percentual_padrao=pct))
    else:
        existing.percentual_padrao = pct
        existing.ultima_vez_usado = datetime.utcnow()
        existing.vezes_usado += 1


def _sync_data_quitacao(item: Item, novo_quitado: bool) -> None:
    if novo_quitado and not item.quitado:
        if item.data_quitacao is None:
            item.data_quitacao = date.today()
    elif not novo_quitado:
        item.data_quitacao = None
    item.quitado = novo_quitado


# ---------- notas / itens ----------
@app.get("/api/notas", response_model=list[NotaOut])
def listar_notas(db: Session = Depends(get_db)):
    stmt = (
        select(Nota)
        .options(selectinload(Nota.itens))
        .order_by(Nota.data.desc(), Nota.created_at.desc())
    )
    return db.execute(stmt).scalars().all()


@app.post("/api/notas", response_model=NotaOut, status_code=201)
async def criar_nota(
    payload: str = Form(..., description="JSON serializado de NotaCreate"),
    anexo: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
):
    import json
    try:
        data = NotaCreate.model_validate_json(payload)
    except Exception as e:
        raise HTTPException(400, f"payload invalido: {e}")

    if not data.itens:
        raise HTTPException(400, "adicione pelo menos um item")

    anexo_path: Optional[str] = None
    if anexo and anexo.filename:
        ext = Path(anexo.filename).suffix
        safe_ext = ext if len(ext) <= 8 else ""
        anexo_path = f"{datetime.utcnow():%Y%m%d}-{uuid.uuid4().hex[:8]}{safe_ext}"
        dest = UPLOADS_DIR / anexo_path
        with dest.open("wb") as f:
            shutil.copyfileobj(anexo.file, f)

    nota = Nota(
        data=data.data,
        fornecedor=data.fornecedor,
        obs=data.obs,
        pago_por=data.pago_por,
        anexo_path=anexo_path,
    )
    db.add(nota)
    db.flush()

    for it in data.itens:
        item = Item(
            nota_id=nota.id,
            descricao=it.descricao,
            valor=it.valor,
            percentual_meu=it.percentual_meu,
        )
        db.add(item)
        _upsert_sugestao(db, it.descricao, it.percentual_meu)

    db.commit()
    db.refresh(nota)
    return nota


@app.delete("/api/notas/{nota_id}", status_code=204)
def excluir_nota(nota_id: str, db: Session = Depends(get_db)):
    nota = db.get(Nota, nota_id)
    if nota is None:
        raise HTTPException(404, "nota nao encontrada")
    if nota.anexo_path:
        try:
            (UPLOADS_DIR / nota.anexo_path).unlink(missing_ok=True)
        except Exception:
            pass
    db.delete(nota)
    db.commit()


@app.patch("/api/notas/{nota_id}/quitar-tudo", status_code=204)
def quitar_nota_toda(nota_id: str, db: Session = Depends(get_db)):
    nota = db.get(Nota, nota_id)
    if nota is None:
        raise HTTPException(404, "nota nao encontrada")
    for item in nota.itens:
        if not item.quitado:
            _sync_data_quitacao(item, True)
    db.commit()


@app.patch("/api/itens/{item_id}", response_model=ItemOut)
def atualizar_item(item_id: str, up: QuitadoUpdate, db: Session = Depends(get_db)):
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, "item nao encontrado")
    _sync_data_quitacao(item, up.quitado)
    db.commit()
    db.refresh(item)
    return item


@app.delete("/api/itens/{item_id}", status_code=204)
def excluir_item(item_id: str, db: Session = Depends(get_db)):
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, "item nao encontrado")
    db.delete(item)
    db.commit()


# ---------- anexo ----------
@app.get("/api/notas/{nota_id}/anexo")
def baixar_anexo(nota_id: str, db: Session = Depends(get_db)):
    nota = db.get(Nota, nota_id)
    if nota is None or not nota.anexo_path:
        raise HTTPException(404, "sem anexo")
    p = UPLOADS_DIR / nota.anexo_path
    if not p.exists():
        raise HTTPException(404, "arquivo nao encontrado")
    return FileResponse(p)


# ---------- sugestoes ----------
@app.get("/api/sugestoes", response_model=list[Sugestao])
def listar_sugestoes(db: Session = Depends(get_db)):
    stmt = select(ProdutoSugestao).order_by(ProdutoSugestao.ultima_vez_usado.desc()).limit(50)
    return db.execute(stmt).scalars().all()


# ---------- saldo ----------
@app.get("/api/saldo", response_model=SaldoOut)
def saldo(db: Session = Depends(get_db)):
    # Junta item + nota. valor_meu/valor_outro sao propriedades derivadas —
    # calculamos em SQL pra performance.
    valor_meu = (Item.valor * Item.percentual_meu / 100)
    valor_outro = (Item.valor * (100 - Item.percentual_meu) / 100)

    def sum_case(cond, expr):
        return func.coalesce(func.sum(case((cond, expr), else_=0)), 0)

    aberto = ~Item.quitado
    quitado = Item.quitado

    stmt = select(
        sum_case((Nota.pago_por == "renan") & aberto, valor_outro).label("outro_deve"),
        sum_case((Nota.pago_por == "outro") & aberto, valor_meu).label("renan_deve"),
        func.coalesce(func.sum(case((aberto, Item.valor), else_=0)), 0).label("total_aberto"),
        func.coalesce(func.sum(case((aberto, 1), else_=0)), 0).label("qtd_aberto"),
        sum_case(
            (Nota.pago_por == "renan") & quitado, valor_outro
        ).label("ja_recebido_renan"),
        sum_case(
            (Nota.pago_por == "outro") & quitado, valor_meu
        ).label("ja_recebido_outro"),
    ).select_from(Item).join(Nota, Item.nota_id == Nota.id)

    row = db.execute(stmt).one()
    outro_deve = _quantize(Decimal(row.outro_deve))
    renan_deve = _quantize(Decimal(row.renan_deve))
    ja_receb = _quantize(Decimal(row.ja_recebido_renan) - Decimal(row.ja_recebido_outro))
    return SaldoOut(
        outro_deve=outro_deve,
        renan_deve=renan_deve,
        saldo_liquido=outro_deve - renan_deve,
        total_aberto=_quantize(Decimal(row.total_aberto)),
        qtd_aberto=int(row.qtd_aberto),
        ja_recebido=ja_receb,
    )


# ---------- resumo mensal ----------
@app.get("/api/resumo-mensal", response_model=list[ResumoMes])
def resumo_mensal(db: Session = Depends(get_db)):
    mes_expr = func.strftime("%Y-%m-01", Nota.data)
    valor_meu = (Item.valor * Item.percentual_meu / 100)
    valor_outro = (Item.valor * (100 - Item.percentual_meu) / 100)

    stmt = (
        select(
            mes_expr.label("mes"),
            func.coalesce(func.sum(Item.valor), 0).label("total_gasto"),
            func.coalesce(func.sum(valor_meu), 0).label("parte_minha"),
            func.coalesce(func.sum(valor_outro), 0).label("parte_outro"),
            func.count(func.distinct(Nota.id)).label("qtd_notas"),
        )
        .select_from(Item)
        .join(Nota, Item.nota_id == Nota.id)
        .group_by(mes_expr)
        .order_by(mes_expr.desc())
        .limit(12)
    )
    rows = db.execute(stmt).all()
    return [
        ResumoMes(
            mes=date.fromisoformat(r.mes),
            total_gasto=_quantize(Decimal(r.total_gasto)),
            parte_minha=_quantize(Decimal(r.parte_minha)),
            parte_outro=_quantize(Decimal(r.parte_outro)),
            qtd_notas=int(r.qtd_notas),
        )
        for r in rows
    ]


@app.get("/api/health")
def health():
    return {"ok": True, "ts": datetime.utcnow().isoformat()}
