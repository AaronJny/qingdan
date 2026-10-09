CREATE TABLE calendar_subscriptions (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 name TEXT NOT NULL,
 url TEXT NOT NULL,
 time_zone TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 generation INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL DEFAULT '{}',
 last_attempt INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX calendar_subscriptions_owner ON calendar_subscriptions(owner_id);
CREATE UNIQUE INDEX calendar_subscriptions_owner_url ON calendar_subscriptions(owner_id,url);
CREATE TABLE calendar_source_preferences (
 owner_id TEXT PRIMARY KEY NOT NULL,
 holidays_enabled INTEGER NOT NULL DEFAULT 0 CHECK(holidays_enabled IN (0,1))
);
CREATE TABLE calendar_source_cache (
 name TEXT PRIMARY KEY NOT NULL,
 value TEXT NOT NULL DEFAULT '{}',
 last_attempt INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0,
 generation INTEGER NOT NULL DEFAULT 1
);
