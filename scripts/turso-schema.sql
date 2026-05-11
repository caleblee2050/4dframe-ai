-- 4DFrame AI — Turso schema (libsql)
-- customSkill 영구 저장 (PC/브라우저 무관 공유)
-- v1: 단일 테넌트 (로그인 X). v2 에서 user_id 추가 + 로그인.

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  artwork TEXT NOT NULL CHECK (artwork IN ('viking','car_4wd','swing','crocodile','ballerina','free')),
  label TEXT NOT NULL,
  emoji TEXT NOT NULL,
  description TEXT,
  program_json TEXT NOT NULL,            -- JSON.stringify(Program)
  created_at INTEGER NOT NULL,           -- Date.now()
  simple_hidden INTEGER NOT NULL DEFAULT 0  -- 0=노출 / 1=숨김
);

CREATE INDEX IF NOT EXISTS idx_skills_artwork ON skills(artwork);
CREATE INDEX IF NOT EXISTS idx_skills_created_at ON skills(created_at DESC);
