-- Every hit on a tracking link, kept as it came. Nothing is counted here: src/summary.ts (and the app) fold the rows.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- the read cursor: rows are fetched "after id N", so none is ever skipped
  key TEXT NOT NULL,            -- the letter's message key (22 base64url characters)
  type TEXT NOT NULL,           -- open | click | file
  target TEXT,                  -- click: the link; file: the file id
  at INTEGER NOT NULL,          -- ms since 1970, when the hit reached Cloudflare
  sent_at INTEGER NOT NULL,     -- ms, when the letter was sent (from the signed token)
  cls TEXT NOT NULL,            -- human | proxy | prefetch | scanner | bot
  why TEXT,                     -- the rule that decided cls
  client TEXT,                  -- Gmail, Apple Mail, Outlook, Chrome, ...
  device TEXT,                  -- Windows, Mac, iPhone, Android, ...
  ua TEXT,
  asn INTEGER,
  as_org TEXT,
  country TEXT,
  city TEXT,
  colo TEXT,
  ip_hash TEXT,                 -- keyed hash: the same reader is recognisable, the address is not kept
  hit_id TEXT UNIQUE            -- one id per hit, so a replayed hit (dead-letter retry) is never stored twice
);
CREATE INDEX events_key ON events (key);
