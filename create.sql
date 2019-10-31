
CREATE TABLE IF NOT EXISTS fragments(
  id INTEGER PRIMARY KEY,
  insns BLOB UNIQUE
);

CREATE TABLE IF NOT EXISTS sources(
  fragid ROWID,
  filename TEXT,
  offset INTEGER,
  PRIMARY KEY (fragid, filename, offset)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS prints(
  vec BLOB,
  sym TEXT,
  fragid ROWID,
  PRIMARY KEY (vec, sym, fragid)
) WITHOUT ROWID;
