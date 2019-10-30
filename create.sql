
CREATE TABLE IF NOT EXISTS fragments(
  insns BLOB PRIMARY KEY
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
