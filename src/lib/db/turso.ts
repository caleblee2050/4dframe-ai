// Turso (libsql) 클라이언트 — 영구 저장된 customSkill 동기화용.
// 환경변수: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN

import { createClient, type Client } from '@libsql/client';

let _client: Client | null = null;

export function getDb(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL 미설정');
  _client = createClient({ url, authToken });
  return _client;
}

// 행 → CustomSkill 변환
export interface SkillRow {
  id: string;
  artwork: string;
  label: string;
  emoji: string;
  description: string | null;
  program_json: string;
  created_at: number;
  simple_hidden: number;
}

export type Artwork = 'viking' | 'car_4wd' | 'swing' | 'crocodile' | 'ballerina' | 'free';
