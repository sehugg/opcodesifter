
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
  fragid ROWID,
  sym TEXT,
  PRIMARY KEY (vec, fragid, sym)
) WITHOUT ROWID;
