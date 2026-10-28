-- Tabelas do livro-caixa. O servidor (functions/api/[[path]].js) cria tudo sozinho no primeiro acesso.
-- Este arquivo é só referência, ou para criar à mão pelo console do D1.

CREATE TABLE IF NOT EXISTS docs (
  col TEXT NOT NULL,          -- gastos, lancamentos, meses, categorias, historico
  id TEXT NOT NULL,
  data TEXT NOT NULL,         -- o registro em JSON
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (col, id)
);
CREATE INDEX IF NOT EXISTS docs_col ON docs (col);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
INSERT OR IGNORE INTO meta (k, v) VALUES ('versao', 0);

CREATE TABLE IF NOT EXISTS login_falhas (ip TEXT PRIMARY KEY, n INTEGER NOT NULL, ate INTEGER NOT NULL);
