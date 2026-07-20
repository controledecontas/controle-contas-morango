// Controle de Contas — Morango (backend FastAPI proprio, sem Supabase)

const API = APP_CONFIG.API_URL.replace(/\/+$/, "");
const SENHA_HASH = "cb68a831f190efd097aa47c1b1b439f918f973c71c16898a6f2ac7fe6fe5c0fa"; // "morango2026"
const STORAGE_KEY = "contas_morango_unlocked";
const NOME_OUTRO = "Otavio";

// ---------- utils ----------
async function sha256(txt) {
  const buf = new TextEncoder().encode(txt);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const fmtBRL = (n) =>
  (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (d) => {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function toast(msg, tipo = "") {
  const t = document.createElement("div");
  t.className = "toast " + tipo;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- API wrapper ----------
async function apiFetch(path, opts = {}) {
  const url = API + path;
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail || j.message || msg;
    } catch (e) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- trava ----------
function mostrarTrava() { $("#trava").classList.remove("hidden"); $("#app").classList.add("hidden"); }
function mostrarApp() { $("#trava").classList.add("hidden"); $("#app").classList.remove("hidden"); }

$("#formTrava").addEventListener("submit", async (e) => {
  e.preventDefault();
  const hash = await sha256($("#senha").value);
  if (hash === SENHA_HASH) {
    localStorage.setItem(STORAGE_KEY, "1");
    $("#senha").value = "";
    mostrarApp();
    recarregarTudo();
  } else {
    toast("Senha incorreta", "error");
  }
});

$("#btnTravar").addEventListener("click", () => {
  if (confirm("Travar o app? Vai precisar digitar a senha pra entrar de novo.")) {
    localStorage.removeItem(STORAGE_KEY);
    mostrarTrava();
  }
});

// ---------- estado ----------
let estado = {
  notas: [],
  sugestoes: [],
  filtroStatus: "aberto",
  filtroBusca: "",
  chartMes: null,
  chartProduto: null,
  itemSelecionado: null,
};

// ---------- tabs ----------
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const alvo = tab.dataset.tab;
    $$(".tab-content").forEach((c) => c.classList.add("hidden"));
    $("#tab-" + alvo).classList.remove("hidden");
    if (alvo === "dashboard") renderDashboard();
  });
});

// ---------- carregar ----------
async function recarregarTudo() {
  try {
    const [notas, sug, saldo] = await Promise.all([
      apiFetch("/api/notas"),
      apiFetch("/api/sugestoes"),
      apiFetch("/api/saldo"),
    ]);
    estado.notas = notas || [];
    estado.sugestoes = sug || [];
    renderSugestoes();
    renderSaldo(saldo);
    renderLista();
    renderUltimosAbertos();
  } catch (e) {
    toast("Erro ao carregar: " + e.message, "error");
  }
}

function renderSugestoes() {
  $("#sugestoes").innerHTML = estado.sugestoes.map((s) => `<option value="${escapeHtml(s.nome)}">`).join("");
}

function renderSaldo(data) {
  const saldo = Number(data.saldo_liquido) || 0;
  const big = $("#saldoLiquido");
  const exp = $("#saldoExplicacao");
  big.textContent = fmtBRL(Math.abs(saldo));
  if (saldo >= 0) {
    big.style.color = "var(--success)";
    exp.textContent = saldo === 0 ? "Está tudo zerado" : `${NOME_OUTRO} deve ao Renan`;
  } else {
    big.style.color = "var(--accent)";
    exp.textContent = `Renan deve ao ${NOME_OUTRO}`;
  }
  $("#saldoOutroDeve").textContent = fmtBRL(data.outro_deve);
  $("#saldoRenanDeve").textContent = fmtBRL(data.renan_deve);
  $("#saldoTotalAberto").textContent = fmtBRL(data.total_aberto);
  $("#saldoQtdAberto").textContent = `${data.qtd_aberto} itens`;
}

// ---------- form ----------
$("#data").value = new Date().toISOString().slice(0, 10);

function adicionarItem() {
  const tpl = $("#tplItem").content.cloneNode(true);
  const row = tpl.querySelector(".item-row");
  $("#itens").appendChild(row);
  row.querySelector(".item-valor").addEventListener("input", atualizarPreview);
  row.querySelector(".item-pct").addEventListener("input", atualizarPreview);
  row.querySelector(".btn-remover").addEventListener("click", () => { row.remove(); atualizarPreview(); });
  row.querySelector(".item-desc").addEventListener("change", (e) => {
    const nome = e.target.value.trim().toLowerCase();
    const s = estado.sugestoes.find((x) => x.nome === nome);
    if (s && s.percentual_padrao != null) {
      row.querySelector(".item-pct").value = s.percentual_padrao;
      atualizarPreview();
    }
  });
  atualizarPreview();
}
$("#btnAddItem").addEventListener("click", adicionarItem);

function lerItensDoForm() {
  return Array.from($("#itens").querySelectorAll(".item-row")).map((row) => ({
    descricao: row.querySelector(".item-desc").value.trim(),
    valor: parseFloat(row.querySelector(".item-valor").value) || 0,
    percentual_meu: parseFloat(row.querySelector(".item-pct").value) || 0,
  }));
}

function atualizarPreview() {
  const itens = lerItensDoForm();
  let total = 0, meu = 0;
  itens.forEach((i) => { total += i.valor; meu += i.valor * i.percentual_meu / 100; });
  $("#preview_total").textContent = fmtBRL(total);
  $("#preview_meu").textContent = fmtBRL(meu);
  $("#preview_outro").textContent = fmtBRL(total - meu);
}

$("#formNota").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#btnSalvar");

  const itens = lerItensDoForm();
  if (itens.length === 0) { toast("Adicione pelo menos um produto", "error"); return; }
  for (const it of itens) {
    if (!it.descricao || it.valor <= 0) { toast("Preencha descrição e valor de todos os produtos", "error"); return; }
  }

  const pagoPor = document.querySelector('input[name="pago_por"]:checked')?.value || "renan";
  const payload = {
    data: $("#data").value,
    fornecedor: $("#fornecedor").value.trim() || null,
    obs: $("#obs").value.trim() || null,
    pago_por: pagoPor,
    itens,
  };

  btn.disabled = true;
  try {
    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));
    const arquivo = $("#anexo").files[0];
    if (arquivo) fd.append("anexo", arquivo);

    const res = await fetch(API + "/api/notas", { method: "POST", body: fd });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.detail || `HTTP ${res.status}`);
    }
    toast("Nota salva!", "success");
    resetarFormNota();
    await recarregarTudo();
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $('[data-tab="lista"]').classList.add("active");
    $$(".tab-content").forEach((c) => c.classList.add("hidden"));
    $("#tab-lista").classList.remove("hidden");
  } catch (e) {
    toast("Erro: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
});

function resetarFormNota() {
  $("#formNota").reset();
  $("#data").value = new Date().toISOString().slice(0, 10);
  document.querySelector('input[name="pago_por"][value="renan"]').checked = true;
  $("#itens").innerHTML = "";
  adicionarItem();
  atualizarPreview();
}

// ---------- lista ----------
$("#filtroStatus").addEventListener("change", (e) => { estado.filtroStatus = e.target.value; renderLista(); });
$("#filtroBusca").addEventListener("input", (e) => { estado.filtroBusca = e.target.value.toLowerCase(); renderLista(); });

function renderLista() {
  const cont = $("#listaNotas");
  const fstatus = estado.filtroStatus;
  const q = estado.filtroBusca;

  const notasFiltradas = estado.notas
    .map((n) => {
      let itens = n.itens || [];
      if (fstatus === "aberto") itens = itens.filter((i) => !i.quitado);
      if (fstatus === "quitado") itens = itens.filter((i) => i.quitado);
      if (q) itens = itens.filter((i) => i.descricao.toLowerCase().includes(q) || (n.fornecedor || "").toLowerCase().includes(q));
      return { ...n, itensVisiveis: itens };
    })
    .filter((n) => n.itensVisiveis.length > 0);

  if (notasFiltradas.length === 0) {
    cont.innerHTML = `<div class="empty">Nenhum lançamento encontrado.</div>`;
    return;
  }
  cont.innerHTML = notasFiltradas.map(renderNotaBloco).join("");
  cont.querySelectorAll(".item-linha").forEach((el) => {
    el.addEventListener("click", () => abrirDetalhe(el.dataset.id));
  });
  cont.querySelectorAll(".btn-quitar-nota").forEach((el) => {
    el.addEventListener("click", (e) => { e.stopPropagation(); quitarNotaInteira(el.dataset.id); });
  });
  cont.querySelectorAll(".btn-excluir-nota").forEach((el) => {
    el.addEventListener("click", (e) => { e.stopPropagation(); excluirNota(el.dataset.id); });
  });
  cont.querySelectorAll(".btn-anexo").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(API + `/api/notas/${el.dataset.id}/anexo`, "_blank");
    });
  });
}

function renderNotaBloco(n) {
  const totalNota = (n.itens || []).reduce((s, i) => s + Number(i.valor), 0);
  const algumAberto = (n.itens || []).some((i) => !i.quitado);
  const pagoBadge = n.pago_por === "outro"
    ? `<span class="badge-pago outro">👥 ${NOME_OUTRO} pagou</span>`
    : `<span class="badge-pago renan">🙋 Renan pagou</span>`;

  const cabecalho = `
    <div class="nota-cabecalho">
      <div class="nota-cab-info">
        <div class="nota-cab-titulo">
          ${fmtData(n.data)} · ${n.fornecedor ? escapeHtml(n.fornecedor) : "<i style='color:var(--muted)'>sem fornecedor</i>"}
          ${n.anexo_path ? `<button class="btn-anexo" data-id="${n.id}" title="Ver nota">📎</button>` : ""}
        </div>
        <div class="nota-cab-sub">${pagoBadge} · ${(n.itens || []).length} produto(s) · total ${fmtBRL(totalNota)}</div>
      </div>
      <div class="nota-cab-acoes">
        ${algumAberto ? `<button class="btn-quitar-nota" data-id="${n.id}" title="Quitar tudo">Quitar nota</button>` : `<span class="badge quitado" style="margin:0;">tudo quitado</span>`}
        <button class="btn-excluir-nota" data-id="${n.id}" title="Excluir nota inteira">🗑️</button>
      </div>
    </div>`;

  const linhasItens = n.itensVisiveis.map((i) => {
    const badge = i.quitado ? `<span class="badge quitado">quitado</span>` : `<span class="badge aberto">em aberto</span>`;
    const direcao = n.pago_por === "renan"
      ? `${NOME_OUTRO} deve: ${fmtBRL(i.valor_outro)}`
      : `Renan deve: ${fmtBRL(i.valor_meu)}`;
    return `
      <div class="item-linha ${i.quitado ? "quitado" : ""}" data-id="${i.id}">
        <div class="item-linha-desc">
          <div>${escapeHtml(i.descricao)} ${badge}</div>
          <div class="item-linha-pct">${i.percentual_meu}% Renan · ${100 - i.percentual_meu}% ${NOME_OUTRO}</div>
        </div>
        <div class="item-linha-valores">
          <div class="item-linha-total">${fmtBRL(i.valor)}</div>
          <div class="item-linha-detalhe">${direcao}</div>
        </div>
      </div>`;
  }).join("");

  return `<div class="nota-bloco">${cabecalho}${linhasItens}</div>`;
}

function renderUltimosAbertos() {
  const linhas = [];
  estado.notas.forEach((n) => {
    (n.itens || []).forEach((i) => {
      if (!i.quitado) linhas.push({ nota: n, item: i });
    });
  });
  linhas.sort((a, b) => new Date(b.nota.data) - new Date(a.nota.data));
  const top = linhas.slice(0, 5);

  const cont = $("#ultimosAbertos");
  if (top.length === 0) {
    cont.innerHTML = `<div class="empty" style="padding:20px;">Tudo quitado! ✨</div>`;
    return;
  }
  cont.innerHTML = top.map(({ nota, item }) => {
    const direcao = nota.pago_por === "renan"
      ? `${NOME_OUTRO} deve: ${fmtBRL(item.valor_outro)}`
      : `Renan deve: ${fmtBRL(item.valor_meu)}`;
    return `
    <div class="item-linha" data-id="${item.id}">
      <div class="item-linha-desc">
        <div>${escapeHtml(item.descricao)}</div>
        <div class="item-linha-pct">${fmtData(nota.data)}${nota.fornecedor ? " · " + escapeHtml(nota.fornecedor) : ""} · ${nota.pago_por === "renan" ? "🙋 Renan" : "👥 " + NOME_OUTRO}</div>
      </div>
      <div class="item-linha-valores">
        <div class="item-linha-total">${fmtBRL(item.valor)}</div>
        <div class="item-linha-detalhe">${direcao}</div>
      </div>
    </div>`;
  }).join("");
  cont.querySelectorAll(".item-linha").forEach((el) => {
    el.addEventListener("click", () => abrirDetalhe(el.dataset.id));
  });
}

// ---------- modal ----------
function acharItem(id) {
  for (const n of estado.notas) {
    const it = (n.itens || []).find((i) => i.id === id);
    if (it) return { nota: n, item: it };
  }
  return null;
}

function abrirDetalhe(id) {
  const found = acharItem(id);
  if (!found) return;
  const { nota, item } = found;
  estado.itemSelecionado = item;

  const pagoLabel = nota.pago_por === "renan" ? "🙋 Renan" : `👥 ${NOME_OUTRO}`;
  const direcaoTexto = nota.pago_por === "renan"
    ? `<p style="color:var(--success);"><strong>${NOME_OUTRO} deve ao Renan:</strong> ${fmtBRL(item.valor_outro)}</p>`
    : `<p style="color:var(--accent);"><strong>Renan deve ao ${NOME_OUTRO}:</strong> ${fmtBRL(item.valor_meu)}</p>`;
  $("#modalTitulo").textContent = item.descricao;
  $("#modalCorpo").innerHTML = `
    <p><strong>Nota:</strong> ${fmtData(nota.data)}${nota.fornecedor ? " · " + escapeHtml(nota.fornecedor) : ""}</p>
    <p><strong>Pago por:</strong> ${pagoLabel}</p>
    <p><strong>Valor:</strong> ${fmtBRL(item.valor)}</p>
    <p><strong>Parte Renan (${item.percentual_meu}%):</strong> ${fmtBRL(item.valor_meu)}</p>
    <p><strong>Parte ${NOME_OUTRO} (${100 - item.percentual_meu}%):</strong> ${fmtBRL(item.valor_outro)}</p>
    ${direcaoTexto}
    <p><strong>Status:</strong> ${item.quitado ? `Quitado em ${fmtData(item.data_quitacao)}` : "Em aberto"}</p>
    ${nota.obs ? `<p><strong>Obs da nota:</strong> ${escapeHtml(nota.obs)}</p>` : ""}
    ${nota.anexo_path ? `<p><a href="${API}/api/notas/${nota.id}/anexo" target="_blank">📎 Ver nota fiscal</a></p>` : ""}
  `;
  $("#btnAcaoModal").textContent = item.quitado ? "Reabrir (não quitado)" : "Marcar como quitado";
  $("#modalDetalhe").classList.remove("hidden");
}

$("#btnFechaModal").addEventListener("click", () => $("#modalDetalhe").classList.add("hidden"));

$("#btnAcaoModal").addEventListener("click", async () => {
  const i = estado.itemSelecionado;
  if (!i) return;
  const novo = !i.quitado;
  try {
    await apiFetch(`/api/itens/${i.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quitado: novo }),
    });
    toast(novo ? "Marcado como quitado" : "Reaberto", "success");
    $("#modalDetalhe").classList.add("hidden");
    await recarregarTudo();
  } catch (e) { toast("Erro: " + e.message, "error"); }
});

$("#btnExcluirItem").addEventListener("click", async () => {
  const i = estado.itemSelecionado;
  if (!i) return;
  if (!confirm(`Excluir o item "${i.descricao}"? Essa ação não dá pra desfazer.`)) return;
  try {
    await apiFetch(`/api/itens/${i.id}`, { method: "DELETE" });
    toast("Item excluído", "success");
    $("#modalDetalhe").classList.add("hidden");
    await recarregarTudo();
  } catch (e) { toast("Erro: " + e.message, "error"); }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modalDetalhe").classList.contains("hidden")) {
    $("#modalDetalhe").classList.add("hidden");
  }
});

// ---------- quitar nota / excluir nota ----------
async function quitarNotaInteira(notaId) {
  const n = estado.notas.find((x) => x.id === notaId);
  if (!n) return;
  const abertos = (n.itens || []).filter((i) => !i.quitado);
  if (abertos.length === 0) return;
  if (!confirm(`Marcar todos os ${abertos.length} item(ns) em aberto desta nota como quitados?`)) return;
  try {
    await apiFetch(`/api/notas/${notaId}/quitar-tudo`, { method: "PATCH" });
    toast("Nota quitada", "success");
    await recarregarTudo();
  } catch (e) { toast("Erro: " + e.message, "error"); }
}

async function excluirNota(notaId) {
  const n = estado.notas.find((x) => x.id === notaId);
  if (!n) return;
  const total = (n.itens || []).length;
  if (!confirm(`Excluir esta nota inteira (${total} produto(s))${n.anexo_path ? " + a foto da nota" : ""}? Essa ação não dá pra desfazer.`)) return;
  try {
    await apiFetch(`/api/notas/${notaId}`, { method: "DELETE" });
    toast("Nota excluída", "success");
    await recarregarTudo();
  } catch (e) { toast("Erro: " + e.message, "error"); }
}

// ---------- dashboard ----------
async function renderDashboard() {
  let mensal = [];
  try { mensal = await apiFetch("/api/resumo-mensal"); } catch (e) {}
  const mensalOrdenado = (mensal || []).slice().reverse();

  if (estado.chartMes) estado.chartMes.destroy();
  estado.chartMes = new Chart($("#chartMes"), {
    type: "bar",
    data: {
      labels: mensalOrdenado.map((m) => { const [y, mm] = m.mes.split("-"); return `${mm}/${y.slice(2)}`; }),
      datasets: [
        { label: "Minha parte", data: mensalOrdenado.map((m) => m.parte_minha), backgroundColor: "#2e7d32" },
        { label: "A receber",   data: mensalOrdenado.map((m) => m.parte_outro), backgroundColor: "#a5d6a7" },
      ],
    },
    options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => "R$ " + v } } } },
  });

  const porProduto = {};
  estado.notas.forEach((n) => (n.itens || []).forEach((i) => {
    if (i.quitado) return;
    const k = i.descricao.toLowerCase();
    porProduto[k] = (porProduto[k] || 0) + Number(i.valor);
  }));
  const top = Object.entries(porProduto).sort((a, b) => b[1] - a[1]).slice(0, 8);

  if (estado.chartProduto) estado.chartProduto.destroy();
  estado.chartProduto = new Chart($("#chartProduto"), {
    type: "doughnut",
    data: {
      labels: top.map(([k]) => k),
      datasets: [{
        data: top.map(([, v]) => v),
        backgroundColor: ["#2e7d32","#43a047","#66bb6a","#a5d6a7","#1b5e20","#558b2f","#9ccc65","#ef5350"],
      }],
    },
    options: { responsive: true },
  });
}

// ---------- boot ----------
adicionarItem();
if (localStorage.getItem(STORAGE_KEY) === "1") {
  mostrarApp();
  recarregarTudo();
} else {
  mostrarTrava();
}
