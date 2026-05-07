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
import { FIRMWARE } from '@/lib/commands/commands';
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

      // 이미 권한 받은 포트가 있으면 재사용 (HMR 후 재연결 시 다이얼로그 생략)
      // 필터는 의도적으로 비워둠 — 학생 환경마다 USB 칩이 다를 수 있어 (FT232RL/CH340/CP2102)
      // 강제 필터는 "No compatible devices found" 로 막힘. 학생이 직접 선택하게 한다.
      const existing = await navigator.serial.getPorts();
      const port = existing.length > 0
        ? existing[0]
        : await navigator.serial.requestPort();

      set({ status: 'opening' });
      // 포트가 이전 모듈 인스턴스에 의해 이미 열려 있으면 닫고 다시 연다.
      // (HMR 후 _port/_writer 가 null 로 리셋됐지만 브라우저는 포트를 여전히 잡고 있는 케이스)
      try {
        await port.open({ baudRate: FIRMWARE.baud });
      } catch (openErr) {
        const msg = openErr instanceof Error ? openErr.message : String(openErr);
        if (msg.includes('already open')) {
          try { await port.close(); } catch {}
          await port.open({ baudRate: FIRMWARE.baud });
        } else {
          throw openErr;
        }
      }
      _port = port;

      if (!port.writable) throw new Error('포트의 writable 스트림이 없습니다.');
      _writer = port.writable.getWriter();

      _readAbort = new AbortController();
      _readLoopPromise = readLoop(port, _readAbort.signal);

      set({ status: 'connected' });

      // 보드가 이미 부팅된 상태에서 연결한 경우 BOOT 라인을 못 받음.
      // 진단 명령을 자동 발사해서 ID/FW 를 받아 lastBoot 칸을 채운다.
      setTimeout(() => {
        _writer?.write(encoder.encode('?')).catch(() => {});
      }, 300);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // 흔한 원인 친절 안내
      let msg = raw;
      if (raw.includes('Failed to open') || raw.includes('Access denied')) {
        msg = `${raw}\n\n👉 다른 브라우저 탭에서 보드를 사용 중일 수 있어요. 그 탭을 닫거나 "연결 끊기"를 누른 뒤 다시 시도해 주세요.`;
      } else if (raw.includes('No port selected')) {
        msg = '포트 선택이 취소됐어요. 다시 누르고 USB 시리얼 포트를 골라주세요.';
      }
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
  // 1) read loop 중단 — reader.cancel() 까지 기다림.
  try { _readAbort?.abort(); } catch {}
  try { await _readLoopPromise?.catch(() => {}); } catch {}

  // 2) writer 락 해제 — close() 는 pending write 로 hang 위험이 있으므로 releaseLock 만.
  if (_writer) {
    try { _writer.releaseLock(); } catch {}
  }

  // 3) 포트 닫기 — port.close() 가 pending stream operation 으로 hang 가능해 5초 타임아웃.
  if (_port) {
    await Promise.race([
      _port.close().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  }

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
      // BOOT:Ami5_V01:FW1.3 — fw 토큰의 'FW' 접두사 제거해 저장 (UI 가 라벨 추가)
      const parts = line.split(':');
      if (parts.length >= 3) {
        const fwRaw = parts[2];
        const fw = fwRaw.startsWith('FW') ? fwRaw.slice(2) : fwRaw;
        next.lastBoot = { boardId: parts[1], fw };
      }
    } else if (line.startsWith('DIST:')) {
      const cm = Number(line.slice(5));
      if (Number.isFinite(cm) && cm > 0) next.lastDistanceCm = cm;
    } else if (line.startsWith('ID:')) {
      // 진단 응답 — 이미 부팅된 보드에 연결했을 때 BOOT 못 받은 케이스 보충
      const id = line.slice(3).trim();
      const prevFw = s.lastBoot?.fw ?? '?';
      next.lastBoot = { boardId: id, fw: prevFw };
      next.lastDiagnostic = line + '\n';   // 진단 시작 시 누적 리셋
    } else if (line.startsWith('FW:')) {
      const fw = line.slice(3).trim();
      const prevId = s.lastBoot?.boardId ?? '?';
      next.lastBoot = { boardId: prevId, fw };
      next.lastDiagnostic = (s.lastDiagnostic ?? '') + line + '\n';
    } else if (line.startsWith('PWM:') || line.startsWith('posA:') || line.startsWith('posB:') || line.startsWith('DIR:')) {
      next.lastDiagnostic = (s.lastDiagnostic ?? '') + line + '\n';
    }
    return next;
  });
}
