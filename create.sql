CREATE TABLE IF NOT EXISTS prints(
  vec BLOB,
  insns BLOB,
  sym TEXT,
  filename TEXT,
  offset INTEGER,
  length INTEGER,
  PRIMARY KEY (vec, insns, sym)
) WITHOUT ROWID;
