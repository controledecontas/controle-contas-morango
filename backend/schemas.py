from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


PagoPor = Literal["renan", "outro"]


class ItemIn(BaseModel):
    descricao: str
    valor: Decimal = Field(gt=0)
    percentual_meu: Decimal = Field(ge=0, le=100)


class NotaCreate(BaseModel):
    data: date
    fornecedor: Optional[str] = None
    obs: Optional[str] = None
    pago_por: PagoPor = "renan"
    itens: list[ItemIn]


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    nota_id: str
    descricao: str
    valor: Decimal
    percentual_meu: Decimal
    valor_meu: Decimal
    valor_outro: Decimal
    quitado: bool
    data_quitacao: Optional[date]
    created_at: datetime


class NotaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    data: date
    fornecedor: Optional[str]
    anexo_path: Optional[str]
    obs: Optional[str]
    pago_por: PagoPor
    created_at: datetime
    itens: list[ItemOut]


class QuitadoUpdate(BaseModel):
    quitado: bool


class Sugestao(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    nome: str
    percentual_padrao: Optional[Decimal]


class SaldoOut(BaseModel):
    outro_deve: Decimal
    renan_deve: Decimal
    saldo_liquido: Decimal
    total_aberto: Decimal
    qtd_aberto: int
    ja_recebido: Decimal


class ResumoMes(BaseModel):
    mes: date
    total_gasto: Decimal
    parte_minha: Decimal
    parte_outro: Decimal
    qtd_notas: int
