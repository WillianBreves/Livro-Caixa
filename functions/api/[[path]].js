/*
 * Livro-caixa Axis + UpDrive — servidor (Cloudflare Pages Functions + D1)
 *
 * Tudo que chega em /api/... passa por aqui.
 * Configuração no painel do Cloudflare (Settings > Variables and Secrets / Bindings):
 *   DB               -> binding do banco D1
 *   USUARIO, SENHA   -> login de quem lança e edita (obrigatório)
 *   USUARIO_LEITURA, SENHA_LEITURA -> login só para visualizar (opcional)
 *   SEGREDO          -> texto aleatório para assinar as sessões (opcional, recomendado)
 * Nada disso fica no código: quem vê o repositório não vê senha nem dados.
 */

const COLECOES = ["gastos", "lancamentos", "meses", "categorias", "historico"];
const ID_OK = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const CAMPO_OK = /^[A-Za-z0-9_]{1,64}$/;
const SESSAO_DIAS = 30;
const MAX_CORPO = 256 * 1024;
const MAX_FALHAS = 5, BLOQUEIO_MIN = 15;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (col, id))",
  "CREATE INDEX IF NOT EXISTS docs_col ON docs (col)",
  "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)",
  "INSERT OR IGNORE INTO meta (k, v) VALUES ('versao', 0)",
  "CREATE TABLE IF NOT EXISTS login_falhas (ip TEXT PRIMARY KEY, n INTEGER NOT NULL, ate INTEGER NOT NULL)"
];
let schemaPronto = false;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const erro = (msg, status, code) => json({ erro: msg, code: code || "erro" }, status);

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uTexto = t => b64u(enc.encode(t));
const deB64u = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };

function chaveSecreta(env) { return env.SEGREDO || ("lc:" + (env.USUARIO || "") + ":" + (env.SENHA || "")); }
async function hmac(env, texto) {
  const k = await crypto.subtle.importKey("raw", enc.encode(chaveSecreta(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(texto)));
}
function iguais(a, b) { // comparação em tempo constante
  a = String(a); b = String(b); let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function criarToken(env, usuario, papel) {
  const corpo = b64uTexto(JSON.stringify({ u: usuario, p: papel, exp: Date.now() + SESSAO_DIAS * 864e5 }));
  return corpo + "." + await hmac(env, corpo);
}
async function lerToken(env, req) {
  const h = req.headers.get("authorization") || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [corpo, sig] = t.split(".");
  if (!corpo || !sig) return null;
  if (!iguais(sig, await hmac(env, corpo))) return null;
  try { const s = JSON.parse(new TextDecoder().decode(deB64u(corpo))); return s.exp > Date.now() ? s : null; } catch (e) { return null; }
}

async function prepararBanco(db) {
  if (schemaPronto) return;
  await db.batch(SCHEMA.map(q => db.prepare(q)));
  schemaPronto = true;
}
async function subirVersao(db) { await db.prepare("UPDATE meta SET v = v + 1 WHERE k = 'versao'").run(); }
async function versao(db) { const r = await db.prepare("SELECT v FROM meta WHERE k = 'versao'").first(); return r ? r.v : 0; }

async function lerCorpo(req) {
  const t = await req.text();
  if (t.length > MAX_CORPO) throw Object.assign(new Error("grande"), { status: 413 });
  try { return t ? JSON.parse(t) : {}; } catch (e) { throw Object.assign(new Error("json"), { status: 400 }); }
}
const objeto = v => v && typeof v === "object" && !Array.isArray(v);

async function login(env, db, req) {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const agora = Date.now();
  const f = await db.prepare("SELECT n, ate FROM login_falhas WHERE ip = ?").bind(ip).first();
  if (f && f.ate > agora) return erro(`Muitas tentativas erradas. Tente de novo em ${Math.ceil((f.ate - agora) / 60000)} minuto(s).`, 429, "bloqueado");
  const { usuario, senha } = await lerCorpo(req);
  const u = String(usuario || "").trim().toLowerCase(), s = String(senha || "");
  let papel = null;
  if (env.USUARIO && env.SENHA && iguais(u, String(env.USUARIO).trim().toLowerCase()) && iguais(s, env.SENHA)) papel = "editor";
  else if (env.USUARIO_LEITURA && env.SENHA_LEITURA && iguais(u, String(env.USUARIO_LEITURA).trim().toLowerCase()) && iguais(s, env.SENHA_LEITURA)) papel = "leitura";
  if (!papel) {
    const n = (f && f.ate <= agora && f.n >= MAX_FALHAS ? 0 : (f ? f.n : 0)) + 1;
    const ate = n >= MAX_FALHAS ? agora + BLOQUEIO_MIN * 60000 : 0;
    await db.prepare("INSERT INTO login_falhas (ip, n, ate) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET n = excluded.n, ate = excluded.ate").bind(ip, n, ate).run();
    await new Promise(r => setTimeout(r, 400));
    return erro(n >= MAX_FALHAS ? `Usuário ou senha incorretos. Acesso bloqueado por ${BLOQUEIO_MIN} minutos.` : "Usuário ou senha incorretos.", 401, "login");
  }
  await db.prepare("DELETE FROM login_falhas WHERE ip = ?").bind(ip).run();
  return json({ token: await criarToken(env, u, papel), usuario: u, papel });
}

async function listar(db, col, url) {
  const p = url.searchParams;
  let sql = "SELECT id, data FROM docs WHERE col = ?", args = [col];
  const wf = p.get("wf"), wop = p.get("wop"), wv = p.get("wv");
  if (wf) {
    if (!CAMPO_OK.test(wf) || !["<", "<=", ">", ">=", "=="].includes(wop)) return erro("Filtro inválido.", 400);
    sql += ` AND json_extract(data, '$.${wf}') ${wop === "==" ? "=" : wop} ?`; args.push(wv);
  }
  const ord = p.get("ord");
  if (ord) { if (!CAMPO_OK.test(ord)) return erro("Ordem inválida.", 400); sql += ` ORDER BY json_extract(data, '$.${ord}') ${p.get("dir") === "desc" ? "DESC" : "ASC"}, id`; }
  else sql += " ORDER BY id";
  const lim = Math.min(Math.max(parseInt(p.get("lim") || "0", 10) || 0, 0), 5000);
  if (lim) { sql += " LIMIT ?"; args.push(lim); }
  const r = await db.prepare(sql).bind(...args).all();
  return json({ docs: (r.results || []).map(x => ({ id: x.id, data: JSON.parse(x.data) })), versao: await versao(db) });
}

async function gravar(db, metodo, col, id, req) {
  if (metodo === "DELETE") {
    await db.prepare("DELETE FROM docs WHERE col = ? AND id = ?").bind(col, id).run();
    await subirVersao(db); return json({ ok: true });
  }
  const { data } = await lerCorpo(req);
  if (!objeto(data)) return erro("Corpo inválido.", 400);
  let final = data;
  if (metodo === "PATCH") {
    const atual = await db.prepare("SELECT data FROM docs WHERE col = ? AND id = ?").bind(col, id).first();
    if (!atual) return erro("Documento não existe.", 404, "nao_existe");
    final = Object.assign(JSON.parse(atual.data), data);
  }
  await db.prepare("INSERT INTO docs (col, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(col, id, JSON.stringify(final), Date.now()).run();
  await subirVersao(db);
  return json({ ok: true });
}

async function primeiraConfiguracao(db, req) {
  const tem = await db.prepare("SELECT COUNT(*) AS n FROM docs").first();
  if (tem && tem.n > 0) return json({ ok: false, motivo: "ja_tem_dados" });
  const { docs } = await lerCorpo(req);
  if (!objeto(docs)) return erro("Corpo inválido.", 400);
  const st = [], agora = Date.now();
  for (const col of Object.keys(docs)) {
    if (!COLECOES.includes(col) || !objeto(docs[col])) continue;
    for (const id of Object.keys(docs[col])) if (ID_OK.test(id) && objeto(docs[col][id]))
      st.push(db.prepare("INSERT OR IGNORE INTO docs (col, id, data, updated_at) VALUES (?, ?, ?, ?)").bind(col, id, JSON.stringify(docs[col][id]), agora));
  }
  if (st.length) await db.batch(st);
  await subirVersao(db);
  return json({ ok: true, criados: st.length });
}

export async function onRequest(context) {
  const { request: req, env } = context;
  if (!env.DB) return erro("O banco D1 não está ligado ao projeto. No painel: Settings > Bindings > D1, nome da variável DB.", 500, "sem_banco");
  if (!env.USUARIO || !env.SENHA) return erro("Falta configurar USUARIO e SENHA no painel do Cloudflare (Settings > Variables and Secrets).", 500, "sem_senha");
  try {
    await prepararBanco(env.DB);
    const url = new URL(req.url);
    const partes = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const m = req.method;

    if (partes[0] === "login" && m === "POST") return await login(env, env.DB, req);

    const sessao = await lerToken(env, req);
    if (!sessao) return erro("Sessão expirada. Entre de novo.", 401, "sessao");

    if (partes[0] === "eu" && m === "GET") return json({ usuario: sessao.u, papel: sessao.p });
    if (partes[0] === "versao" && m === "GET") return json({ versao: await versao(env.DB) });

    if (partes[0] === "col" && partes.length === 2 && m === "GET") {
      if (!COLECOES.includes(partes[1])) return erro("Coleção desconhecida.", 404);
      return await listar(env.DB, partes[1], url);
    }
    if (partes[0] === "doc" && partes.length === 3 && ["PUT", "PATCH", "DELETE"].includes(m)) {
      if (sessao.p !== "editor") return erro("Seu acesso é só para visualizar.", 403, "leitura");
      const [, col, id] = partes;
      if (!COLECOES.includes(col) || !ID_OK.test(id)) return erro("Endereço inválido.", 400);
      return await gravar(env.DB, m, col, id, req);
    }
    if (partes[0] === "primeira-configuracao" && m === "POST") {
      if (sessao.p !== "editor") return erro("Seu acesso é só para visualizar.", 403, "leitura");
      return await primeiraConfiguracao(env.DB, req);
    }
    return erro("Endereço não encontrado.", 404);
  } catch (e) {
    return erro(e.status === 413 ? "Conteúdo grande demais." : e.status === 400 ? "Pedido inválido." : "Erro no servidor: " + (e.message || e), e.status || 500);
  }
}
