from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index,
    Integer, Numeric, String, Text, func, select
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, column_property


def new_uuid() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Nota(Base):
    __tablename__ = "nota"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    data: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    fornecedor: Mapped[str | None] = mapped_column(Text)
    anexo_path: Mapped[str | None] = mapped_column(Text)
    obs: Mapped[str | None] = mapped_column(Text)
    pago_por: Mapped[str] = mapped_column(String, nullable=False, default="renan")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    itens: Mapped[list["Item"]] = relationship(
        back_populates="nota", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        CheckConstraint("pago_por in ('renan','outro')", name="chk_pago_por"),
        Index("nota_data_idx", data.desc()),
    )


class Item(Base):
    __tablename__ = "item"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    nota_id: Mapped[str] = mapped_column(
        String, ForeignKey("nota.id", ondelete="CASCADE"), nullable=False
    )
    descricao: Mapped[str] = mapped_column(Text, nullable=False)
    valor: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    percentual_meu: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    quitado: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    data_quitacao: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    nota: Mapped[Nota] = relationship(back_populates="itens")

    __table_args__ = (
        CheckConstraint("valor > 0", name="chk_valor_pos"),
        CheckConstraint("percentual_meu >= 0 and percentual_meu <= 100", name="chk_pct_range"),
        Index("item_nota_idx", "nota_id"),
        Index("item_quitado_idx", "quitado"),
    )

    @property
    def valor_meu(self) -> Decimal:
        return (self.valor * self.percentual_meu / Decimal("100")).quantize(Decimal("0.01"))

    @property
    def valor_outro(self) -> Decimal:
        return self.valor - self.valor_meu


class ProdutoSugestao(Base):
    __tablename__ = "produto_sugestao"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    nome: Mapped[str] = mapped_column(Text, nullable=False, unique=True, index=True)
    percentual_padrao: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    ultima_vez_usado: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    vezes_usado: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
