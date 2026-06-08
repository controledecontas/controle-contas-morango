// =====================================================================
// Controle de Contas - Morango
// Modelo: NOTA (cabeçalho) + ITEM (produtos com % próprio)
// =====================================================================

// SHA-256 da palavra-passe ("morango2026").
const SENHA_HASH = "cb68a831f190efd097aa47c1b1b439f918f973c71c16898a6f2ac7fe6fe5c0fa";
const STORAGE_KEY = "contas_morango_unlocked";

async function sha256(txt) {
  const buf = new TextEncoder().encode(txt);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function mostrarTrava() {
  $("#trava").classList.remove("hidden");
  $("#app").classList.add("hidden");
}
function mostrarApp() {
  $("#trava").classList.add("hidden");
  $("#app").classList.remove("hidden");
}

$("#formTrava").addEventListener("submit", async (e) => {
  e.preventDefault();
  const senha = $("#senha").value;
  const hash = await sha256(senha);
  if (hash === SENHA_HASH) {
    localStorage.setItem(STORAGE_KEY, "1");
    $("#senha").value = "";
    mostrarApp();
    recarregarTudo();
  } else {
    toast("Senha incorreta", "error");
  }
});

// =====================================================================
const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

const fmtBRL = (n) =>
  (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (d) => {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
};

let estado = {
  notas: [],        // [{ ...nota, itens: [...] }]
  sugestoes: [],
  filtroStatus: "aberto",
  filtroBusca: "",
  chartMes: null,
  chartProduto: null,
  itemSelecionado: null,
};

// =====================================================================
// Toast
// =====================================================================
function toast(msg, tipo = "") {
  const t = document.createElement("div");
  t.className = "toast " + tipo;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// =====================================================================
// Tabs
// =====================================================================
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

// =====================================================================
// Carregar dados
// =====================================================================
async function recarregarTudo() {
  await Promise.all([carregarNotasComItens(), carregarSugestoes(), carregarSaldo()]);
  renderLista();
  renderUltimosAbertos();
}

async function carregarNotasComItens() {
  // Uma query só com join via sintaxe do supabase-js
  const { data, error } = await sb
    .from("nota")
    .select("*, itens:item(*)")
    .order("data", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    toast("Erro ao carregar notas: " + error.message, "error");
    return;
  }
  estado.notas = (data || []).map((n) => ({
    ...n,
    itens: (n.itens || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
  }));
}

async function carregarSugestoes() {
  const { data, error } = await sb
    .from("produto_sugestao")
    .select("*")
    .order("ultima_vez_usado", { ascending: false })
    .limit(50);
  if (error) return;
  estado.sugestoes = data || [];
  $("#sugestoes").innerHTML = estado.sugestoes.map((s) => `<option value="${s.nome}">`).join("");
}

async function carregarSaldo() {
  const { data, error } = await sb.from("saldo_corrente").select("*").single();
  if (error) { console.error(error); return; }
  $("#saldoAReceber").textContent = fmtBRL(data.a_receber);
  $("#saldoTotalAberto").textContent = fmtBRL(data.total_aberto);
  $("#saldoJaRecebido").textContent = fmtBRL(data.ja_recebido);
  $("#saldoQtdAberto").textContent = `${data.qtd_aberto} item(ns) em aberto`;
}

// =====================================================================
// Form: nova nota com itens dinâmicos
// =====================================================================
$("#data").value = new Date().toISOString().slice(0, 10);

function adicionarItem() {
  const tpl = $("#tplItem").content.cloneNode(true);
  const row = tpl.querySelector(".item-row");
  $("#itens").appendChild(row);

  // listeners
  row.querySelector(".item-valor").addEventListener("input", atualizarPreview);
  row.querySelector(".item-pct").addEventListener("input", atualizarPreview);
  row.querySelector(".btn-remover").addEventListener("click", () => {
    row.remove();
    atualizarPreview();
  });
  // auto-fill % quando descrição bate
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
  if (itens.length === 0) {
    toast("Adicione pelo menos um produto", "error"); return;
  }
  for (const it of itens) {
    if (!it.descricao || it.valor <= 0) {
      toast("Preencha descrição e valor de todos os produtos", "error"); return;
    }
  }

  btn.disabled = true;
  let anexo_path = null;
  const arquivo = $("#anexo").files[0];
  if (arquivo) {
    const ext = arquivo.name.split(".").pop();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await sb.storage.from("notas").upload(path, arquivo);
    if (upErr) {
      toast("Falha no upload da foto: " + upErr.message, "error");
      btn.disabled = false; return;
    }
    anexo_path = path;
  }

  const { data: nota, error: notaErr } = await sb.from("nota").insert({
    data: $("#data").value,
    fornecedor: $("#fornecedor").value.trim() || null,
    obs: $("#obs").value.trim() || null,
    anexo_path,
  }).select().single();
  if (notaErr) {
    toast("Erro ao salvar nota: " + notaErr.message, "error");
    btn.disabled = false; return;
  }

  const payloadItens = itens.map((i) => ({ ...i, nota_id: nota.id }));
  const { error: itemErr } = await sb.from("item").insert(payloadItens);
  if (itemErr) {
    toast("Erro ao salvar itens: " + itemErr.message, "error");
    btn.disabled = false; return;
  }

  toast("Nota salva!", "success");
  resetarFormNota();
  btn.disabled = false;
  await recarregarTudo();

  // muda pra Lista
  $$(".tab").forEach((t) => t.classList.remove("active"));
  $('[data-tab="lista"]').classList.add("active");
  $$(".tab-content").forEach((c) => c.classList.add("hidden"));
  $("#tab-lista").classList.remove("hidden");
});

function resetarFormNota() {
  $("#formNota").reset();
  $("#data").value = new Date().toISOString().slice(0, 10);
  $("#itens").innerHTML = "";
  adicionarItem();
  atualizarPreview();
}

// =====================================================================
// Lista
// =====================================================================
$("#filtroStatus").addEventListener("change", (e) => { estado.filtroStatus = e.target.value; renderLista(); });
$("#filtroBusca").addEventListener("input", (e) => { estado.filtroBusca = e.target.value.toLowerCase(); renderLista(); });

function notaCasaBusca(nota, q) {
  if (!q) return true;
  if ((nota.fornecedor || "").toLowerCase().includes(q)) return true;
  return nota.itens.some((i) => i.descricao.toLowerCase().includes(q));
}

function renderLista() {
  const cont = $("#listaNotas");
  const fstatus = estado.filtroStatus;
  const q = estado.filtroBusca;

  const notasFiltradas = estado.notas
    .map((n) => {
      let itens = n.itens;
      if (fstatus === "aberto")  itens = itens.filter((i) => !i.quitado);
      if (fstatus === "quitado") itens = itens.filter((i) =>  i.quitado);
      if (q) itens = itens.filter((i) => i.descricao.toLowerCase().includes(q) || (n.fornecedor || "").toLowerCase().includes(q));
      return { ...n, itensVisiveis: itens };
    })
    .filter((n) => n.itensVisiveis.length > 0);

  if (notasFiltradas.length === 0) {
    cont.innerHTML = `<div class="empty">Nenhum lançamento encontrado.</div>`;
    return;
  }

  cont.innerHTML = notasFiltradas.map(renderNotaBloco).join("");

  // listeners
  cont.querySelectorAll(".item-linha").forEach((el) => {
    el.addEventListener("click", () => abrirDetalhe(el.dataset.id));
  });
  cont.querySelectorAll(".btn-quitar-nota").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      quitarNotaInteira(el.dataset.id);
    });
  });
  cont.querySelectorAll(".btn-anexo").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const path = el.dataset.path;
      const { data } = await sb.storage.from("notas").createSignedUrl(path, 3600);
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    });
  });
}

function renderNotaBloco(n) {
  const totalNota = n.itens.reduce((s, i) => s + Number(i.valor), 0);
  const todosQuitados = n.itens.length > 0 && n.itens.every((i) => i.quitado);
  const algumAberto = n.itens.some((i) => !i.quitado);

  const cabecalho = `
    <div class="nota-cabecalho">
      <div class="nota-cab-info">
        <div class="nota-cab-titulo">
          ${fmtData(n.data)} · ${n.fornecedor ? escapeHtml(n.fornecedor) : "<i style='color:var(--muted)'>sem fornecedor</i>"}
          ${n.anexo_path ? `<button class="btn-anexo" data-path="${escapeHtml(n.anexo_path)}" title="Ver nota">📎</button>` : ""}
        </div>
        <div class="nota-cab-sub">${n.itens.length} produto(s) · total ${fmtBRL(totalNota)}</div>
      </div>
      ${algumAberto ? `<button class="btn-quitar-nota" data-id="${n.id}" title="Quitar tudo">Quitar nota</button>` : `<span class="badge quitado" style="margin:0;">tudo quitado</span>`}
    </div>`;

  const linhasItens = n.itensVisiveis.map((i) => {
    const badge = i.quitado ? `<span class="badge quitado">quitado</span>` : `<span class="badge aberto">em aberto</span>`;
    return `
      <div class="item-linha ${i.quitado ? "quitado" : ""}" data-id="${i.id}">
        <div class="item-linha-desc">
          <div>${escapeHtml(i.descricao)} ${badge}</div>
          <div class="item-linha-pct">${i.percentual_meu}% meu · ${100 - i.percentual_meu}% a receber</div>
        </div>
        <div class="item-linha-valores">
          <div class="item-linha-total">${fmtBRL(i.valor)}</div>
          <div class="item-linha-detalhe">recebo: ${fmtBRL(i.valor_outro)}</div>
        </div>
      </div>`;
  }).join("");

  return `<div class="nota-bloco">${cabecalho}${linhasItens}</div>`;
}

function renderUltimosAbertos() {
  // Junta todos os itens em aberto, ordenados por data desc
  const linhas = [];
  estado.notas.forEach((n) => {
    n.itens.forEach((i) => {
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
  cont.innerHTML = top.map(({ nota, item }) => `
    <div class="item-linha" data-id="${item.id}">
      <div class="item-linha-desc">
        <div>${escapeHtml(item.descricao)}</div>
        <div class="item-linha-pct">${fmtData(nota.data)}${nota.fornecedor ? " · " + escapeHtml(nota.fornecedor) : ""}</div>
      </div>
      <div class="item-linha-valores">
        <div class="item-linha-total">${fmtBRL(item.valor)}</div>
        <div class="item-linha-detalhe">recebo: ${fmtBRL(item.valor_outro)}</div>
      </div>
    </div>`).join("");
  cont.querySelectorAll(".item-linha").forEach((el) => {
    el.addEventListener("click", () => abrirDetalhe(el.dataset.id));
  });
}

// =====================================================================
// Modal de detalhe (item)
// =====================================================================
function acharItem(id) {
  for (const n of estado.notas) {
    const it = n.itens.find((i) => i.id === id);
    if (it) return { nota: n, item: it };
  }
  return null;
}

async function abrirDetalhe(id) {
  const found = acharItem(id);
  if (!found) return;
  const { nota, item } = found;
  estado.itemSelecionado = item;

  $("#modalTitulo").textContent = item.descricao;
  $("#modalCorpo").innerHTML = `
    <p><strong>Nota:</strong> ${fmtData(nota.data)}${nota.fornecedor ? " · " + escapeHtml(nota.fornecedor) : ""}</p>
    <p><strong>Valor:</strong> ${fmtBRL(item.valor)}</p>
    <p><strong>Minha parte (${item.percentual_meu}%):</strong> ${fmtBRL(item.valor_meu)}</p>
    <p><strong>A receber (${100 - item.percentual_meu}%):</strong> ${fmtBRL(item.valor_outro)}</p>
    <p><strong>Status:</strong> ${item.quitado ? `Quitado em ${fmtData(item.data_quitacao)}` : "Em aberto"}</p>
    ${nota.obs ? `<p><strong>Obs da nota:</strong> ${escapeHtml(nota.obs)}</p>` : ""}
  `;
  $("#btnAcaoModal").textContent = item.quitado ? "Reabrir (não quitado)" : "Marcar como quitado";
  $("#modalDetalhe").classList.remove("hidden");
}

$("#btnFechaModal").addEventListener("click", () => $("#modalDetalhe").classList.add("hidden"));

$("#btnAcaoModal").addEventListener("click", async () => {
  const i = estado.itemSelecionado;
  if (!i) return;
  const novo = !i.quitado;
  const { error } = await sb.from("item").update({ quitado: novo }).eq("id", i.id);
  if (error) { toast("Erro: " + error.message, "error"); return; }
  toast(novo ? "Marcado como quitado" : "Reaberto", "success");
  $("#modalDetalhe").classList.add("hidden");
  await recarregarTudo();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modalDetalhe").classList.contains("hidden")) {
    $("#modalDetalhe").classList.add("hidden");
  }
});

// =====================================================================
// Quitar nota inteira
// =====================================================================
async function quitarNotaInteira(notaId) {
  const n = estado.notas.find((x) => x.id === notaId);
  if (!n) return;
  if (!confirm(`Marcar todos os ${n.itens.filter(i => !i.quitado).length} item(ns) em aberto desta nota como quitados?`)) return;
  const idsAbertos = n.itens.filter((i) => !i.quitado).map((i) => i.id);
  if (idsAbertos.length === 0) return;
  const { error } = await sb.from("item").update({ quitado: true }).in("id", idsAbertos);
  if (error) { toast("Erro: " + error.message, "error"); return; }
  toast("Nota quitada", "success");
  await recarregarTudo();
}

// =====================================================================
// Botão travar
// =====================================================================
$("#btnTravar").addEventListener("click", () => {
  if (confirm("Travar o app? Vai precisar digitar a senha pra entrar de novo.")) {
    localStorage.removeItem(STORAGE_KEY);
    mostrarTrava();
  }
});

// =====================================================================
// Dashboard
// =====================================================================
async function renderDashboard() {
  const { data: mensal } = await sb.from("resumo_mensal").select("*").limit(12);
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

  // Top produtos em aberto (agrega itens de todas as notas)
  const porProduto = {};
  estado.notas.forEach((n) => n.itens.forEach((i) => {
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

// =====================================================================
// Utils
// =====================================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// =====================================================================
// Boot
// =====================================================================
adicionarItem(); // 1 item inicial no form
if (localStorage.getItem(STORAGE_KEY) === "1") {
  mostrarApp();
  recarregarTudo();
} else {
  mostrarTrava();
}
