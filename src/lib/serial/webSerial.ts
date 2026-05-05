'use client';

// Web Serial 연결 hook + 보드 통신 어댑터.
// Chromium 계열 브라우저 + HTTPS(또는 localhost) 에서만 동작.
//
// 펌웨어 부팅 메시지: BOOT:Ami5_V01:FW1.3
// 일반 응답: DIST:<cm>, OBJ_DETECTED, V:<duty>, DIR:M{n}:<+1|-1>, X:D{pin}=<duty>, ID:.../FW:.../...
//
// 학생 PC 가 Mac/Windows 모두 가능. FT232RL 칩셋 (VID 0403/PID 6001).
// 학생이 새 보드를 처음 꽂으면 한 번 사용자 제스처로 requestPort 호출 → 권한 영속.

import { create } from 'zustand';
import { FIRMWARE, USB_FILTER } from '@/lib/commands/commands';
import './types';

export type ConnectionStatus = 'idle' | 'requesting' | 'opening' | 'connected' | 'closing' | 'error';

export interface BoardState {
  status: ConnectionStatus;
  errorMessage: string | null;
  lastBoot: { boardId: string; fw: string } | null;
  lastDiagnostic: string | null;
  lastDistanceCm: number | null;
  // 마지막 100 줄 라인 버퍼 (디버그 패널용)
  lines: string[];
}

interface BoardActions {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  send: (payload: string) => Promise<void>;
  // 텍스트 명령 시퀀스를 한 줄씩 보낼 때 인터프리터가 호출
}

const MAX_LINES = 100;

let _port: SerialPort | null = null;
let _writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let _readAbort: AbortController | null = null;
let _readLoopPromise: Promise<void> | null = null;

const encoder = new TextEncoder();

export const useBoardStore = create<BoardState & BoardActions>()((set, get) => ({
  status: 'idle',
  errorMessage: null,
  lastBoot: null,
  lastDiagnostic: null,
  lastDistanceCm: null,
  lines: [],

  connect: async () => {
    if (typeof navigator === 'undefined' || !('serial' in navigator)) {
      set({ status: 'error', errorMessage: '이 브라우저는 Web Serial을 지원하지 않습니다. Chrome/Edge 를 사용해주세요.' });
      return;
    }
    if (get().status === 'connected') return;

    try {
      set({ status: 'requesting', errorMessage: null });
      const port = await navigator.serial.requestPort({ filters: [USB_FILTER] });

      set({ status: 'opening' });
      await port.open({ baudRate: FIRMWARE.baud });
      _port = port;

      if (!port.writable) throw new Error('포트의 writable 스트림이 없습니다.');
      _writer = port.writable.getWriter();

      _readAbort = new AbortController();
      _readLoopPromise = readLoop(port, _readAbort.signal);

      set({ status: 'connected' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: 'error', errorMessage: msg });
      await safeCleanup();
    }
  },

  disconnect: async () => {
    set({ status: 'closing' });
    await safeCleanup();
    set({ status: 'idle', errorMessage: null });
  },

  send: async (payload: string) => {
    if (!_writer) {
      throw new Error('보드가 연결되지 않았습니다. 먼저 연결 버튼을 눌러주세요.');
    }
    await _writer.write(encoder.encode(payload));
  },
}));

async function safeCleanup() {
  try { _readAbort?.abort(); } catch {}
  try { await _readLoopPromise?.catch(() => {}); } catch {}
  try {
    if (_writer) {
      try { await _writer.close(); } catch {}
      try { _writer.releaseLock(); } catch {}
    }
  } catch {}
  try { await _port?.close(); } catch {}
  _writer = null;
  _readAbort = null;
  _readLoopPromise = null;
  _port = null;
}

async function readLoop(port: SerialPort, signal: AbortSignal) {
  if (!port.readable) return;
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = port.readable.getReader();

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', onAbort);

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length === 0) continue;
        handleLine(line);
      }
    }
  } catch {
    // 의도적 abort 또는 disconnect — 상위에서 status 갱신함
  } finally {
    signal.removeEventListener('abort', onAbort);
    try { reader.releaseLock(); } catch {}
  }
}

function handleLine(line: string) {
  useBoardStore.setState((s) => {
    const next: Partial<BoardState> = {
      lines: [...s.lines.slice(-(MAX_LINES - 1)), line],
    };

    if (line.startsWith('BOOT:')) {
      // BOOT:Ami5_V01:FW1.3
      const parts = line.split(':');
      if (parts.length >= 3) next.lastBoot = { boardId: parts[1], fw: parts[2] };
    } else if (line.startsWith('DIST:')) {
      const cm = Number(line.slice(5));
      if (Number.isFinite(cm) && cm > 0) next.lastDistanceCm = cm;
    } else if (line.startsWith('ID:') || line.startsWith('FW:') || line.startsWith('PWM:') || line.startsWith('DIR:')) {
      next.lastDiagnostic = (s.lastDiagnostic ?? '') + line + '\n';
    }
    return next;
  });
}
