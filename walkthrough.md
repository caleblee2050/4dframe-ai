# 4DFrame AI — Walkthrough

> 마지막 업데이트: 2026-05-09 (D-1, 5/10 데모 전날)
> 다음 세션 시작 시 **이 문서만 읽고 즉시 작업 진입 가능**

---

## 0. 즉시 시작 — 다음 세션 첫 명령

```bash
cd /Users/caleb/dev/4dframe-ai
git status
git log --oneline -10
vercel env pull .env.local   # OIDC 토큰 12시간마다 만료 — 항상 첫 작업
npm run dev                   # 로컬 dev (Mac에서 권장 환경)
```

**라이브 URL**: https://4dframe-ai.vercel.app
- `/` 마케팅 / `/play` 학생용 / `/play/test` 디버그 / `/admin` 관리자

---

## 1. 오늘 (5/9) 완료한 것 — 핵심

### A. 회귀 + 펌웨어 fix
사용자 보고: 동일 노트북에서 이전 Python 모두 동작, 우리 PWA만 일부 안 동작.

**원인 분석 (정밀)**:
1. PWA 가 V/X 명령 송신 — Python 어휘 (1234/!@#$/W/A/S/D/5/%/6/^/0) 와 다름
2. 서보 명령 간격 80ms — SG90 응답 시간 (~150ms) 보다 짧음 → stall
3. **펌웨어 v1.3 의 결정적 회귀**: Servo 라이브러리가 timer1 영구 점유 → D9 (M3 PWM), D10 (M4 PWM) `analogWrite` 무력화
   - val ≥ 128 → digitalWrite(HIGH) 풀파워
   - val < 128 → digitalWrite(LOW) 정지
   - 결과: M3 풀파워 고정, M4 V9 에서만 시동

**수정 (커밋)**:
- `e0ce3c3` — V/X 제거 + 서보 delay 200ms (PWA, v1.0 호환 모드)
- `8cc81c8` — `isV13Plus(fw)` 펌웨어 자동 감지 → v1.3+ 면 V 명령 사용
- ThinkGen_Framework `1a068e5` — **펌웨어 v1.3.2** (servo 동적 attach/detach + V/X 명령 시 강제 detach)
- `815fda5` — /play/test 에 FW 큰 뱃지 + V Sweep 비교 도구

### B. 학생 페이지 D-1 대전환 (사용자 회의 결과 5/9)
- 코딩 개념 설명 제거 (유치원~초등 친화)
- 가로 레이아웃 (좌-서보×2 / 중-속도 / 우-조이스틱) — `haqizza/mechatronics_controller` Flutter 코드 충실 반영
- 4DFrame-Android 디자인 자산 (`logo3`, Dongle 폰트, 오렌지 톤) `/public/fdland/` 에 다운
- 수동 조종 (Joystick, SpeedGauge, ServoGauge 컴포넌트)
- 동요 전자음 (Web Audio API 사인파 6곡: 학교종/반짝반짝/나비야/산토끼/곰세마리/띠띠띠)
- 카메라 인터랙티브 (MediaPipe Hands → 서보 SA)
- AI 자연어 + 음악 + 카메라 통합

### C. 디버그 보드 (`/play/test`) 강화
- 모터 캘리브 (시동 V ±, ▶ 시동, 방향 토글)
- 서보 캘리브 (단계 ×N, 풀 가동 검증 90→0→180→90)
- 자동 스크롤 페이지 끌어내림 버그 fix
- **FW 큰 뱃지** (헤더 우측, v1.3.2+ 초록 / 그 외 주황)
- **V Sweep 비교** (한 모터 V3→V5→V7→V9 1초씩, PWM 차이 자동 검증)

---

## 2. 펌웨어 매트릭스

| 버전 | 위치 | 상태 |
|---|---|---|
| **v1.0** | ThinkGen_Framework `b62f3c0` | 4D Frame 본사 원본. 학생 키트 보드 기본값 가정 |
| v1.3 | ThinkGen_Framework `469c5f6` | M2/M3 핀 스왑, V/X/F/? 추가. **timer1 회귀 발견** |
| **v1.3.2** | ThinkGen_Framework `1a068e5` | servo 동적 detach. **사용자 본인 보드 플래시됨** |

### 펌웨어 어휘 호환성

| 어휘 | v1.0 | v1.3.2 | PWA 송신 |
|---|---|---|---|
| W/A/S/D, 1234/!@#$, 5/%/6/^, 0 | ✅ | ✅ | 항상 |
| **V0~V9** | ❌ | ✅ | `isV13Plus(fw)` 자동 분기 |
| X{idx}{duty}, F1~F4, ?, * | ❌ | ✅ | /play/test 디버그만 |

학생 키트 양산 = v1.3.2 일괄 플래시 권장. 펌웨어 자동 플래시 옵션 (Web Serial STK500v1) v1.1 작업으로 미룸.

---

## 3. 미해결 / 검증 필요

### 🔴 검증 미완료 (D-1, 5/9 종료 시점)
1. **펌웨어 v1.3.2 + 라이브 PWA** 에서 V Sweep — M3, M4 PWM 단계별 차이 시각 확인 필요
   - 사용자 행동: `/play/test` 에서 **연결 끊기 → 보드 연결** 다시 → FW 뱃지가 `1.3.2 ✓ 최신` 인지 → V Sweep 4개 모터 차례로

### 🟡 미해결 / 보류
- **디자인 원본** — 사용자 제공 대기 (현재 4DFrame-Android 톤 임시 적용. 사용자 다시 줄 예정)
- **/play 학생용 페이지** — 사용자 보고 "글씨 작아 검증 안 됨". 디자인 원본 받은 후 재작업
- **카메라 인터랙티브 v1** — 손만 가능. 얼굴/머리 v0.1 미구현

### 🟢 후속 작업 (5/10 데모 후 v1.1)
- 펌웨어 자동 플래시 옵션 (Web Serial STK500v1 JS 포팅) — 사용자 직접 보드 업그레이드
- Turso 영속 메트릭 + 사용자 인증 (Clerk via Vercel Marketplace)
- 학생 결제 통합 (Stripe / Toss Payments)
- 카메라 얼굴 인식 → 자동차 방향
- Lyria 3 Clip 동적 효과음 생성 (5/10 후 wow moment)

---

## 4. 기술 스택 (현재)

### 프런트엔드
Next.js 16 (App Router, Turbopack) + React 19 + TypeScript 5
Tailwind v4, 인라인 CSS-in-JS
Zustand v5 (+ persist)
Framer Motion 12, Lucide React, @react-three/fiber

### AI / 음성
Vercel AI SDK v6 + AI Gateway (OIDC)
- **claude-sonnet-4-6** (자연어 → JSON DSL, 게이트웨이)
- **gemini-3.1-flash-tts-preview** (음성, 직접 Gemini API — Gateway 미지원)
- WAV 헤더 변환 (Gemini PCM L16 → audio/wav)
Web Audio API (square-wave 멜로디 합성, 동요 6곡)
@mediapipe/tasks-vision (lazy import, 손 인식)

### 보드 통신
Web Serial API (Chromium 전용)
- 어휘 SSoT: `src/lib/commands/commands.ts` (+ commands.yaml 스펙)
- Mac USB-C: `/dev/cu.usbserial-A5069RR4`
- Baud 115200

### 인프라
Vercel (Fluid Compute) + GitHub auto deploy
- 환경변수: VERCEL_OIDC_TOKEN (12시간 만료, 매번 vercel env pull), GOOGLE_GENERATIVE_AI_API_KEY, ADMIN_PASSWORD

### 페이지
- `/` 마케팅 (다크 글래스 네온, 그대로)
- `/play` 학생용 (D-1 가로 레이아웃 + 4D Land 톤 임시. 디자인 원본 대기)
- `/play/test` 디버그 (모터/서보 캘리브, V Sweep, 풀 어휘 v1.3.2)
- `/admin` 관리자 (사용량 + 외부 대시보드 링크)
- `/api/chat`, `/api/tts`, `/api/admin/metrics`

### 핵심 모듈
```
src/lib/
  ai/systemPrompt.ts      (단순화 페르소나, 동요 가이드 포함)
  admin/metrics.ts        (in-memory 카운터, v1.1 Turso 영속 예정)
  calibration/store.ts    (보드별 시동 V + DIR, localStorage)
  commands/commands.ts    (어휘 SSoT + isV13Plus helper)
  dsl/schema.ts           (Step types + validateProgram)
  dsl/interpreter.ts      (Program 실행, fw 자동 분기)
  serial/webSerial.ts     (Web Serial 연결)
  sound/soundManager.ts   (TTS prefetch + 효과음 캐시)
  sound/melodySynth.ts    (Web Audio 동요 6곡)
src/components/play/
  Joystick.tsx, SpeedGauge.tsx, ServoGauge.tsx, CameraPanel.tsx
public/sounds/        (10 mp3 효과음)
public/fdland/        (4D Land 디자인 자산 8개 — logo3, main_ill 등)
```

---

## 5. D-day (5/10) 데모 전 마지막 체크리스트

### 사용자 검증 (필수)
- [ ] **PC + 9V 배터리 환경**에서 라이브 https://4dframe-ai.vercel.app/play/test 접속
- [ ] 보드 연결 → **FW 뱃지 `1.3.2 ✓ 최신`** 확인
- [ ] V Sweep — M3, M4 PWM 단계별 차이 시각 확인
- [ ] 서보 풀 가동 검증 (SA, SB) — 90→0→180→90 부드럽게
- [ ] 자연어 시연 — `/play` 또는 디자인 원본 받은 후 재작업한 페이지에서

### 환경 차이 (확인됨)
- **Mac USB-C**: USB-PD 협상으로 디바이스 전류 빡빡 → SG90 stall 가능. **9V 권장**.
- **PC USB-A**: 5V 토크 충분 → 9V 없이도 모든 모터/서보 정상 (사용자 검증)

### 데모 환경 가정
- PC + 9V + 사용자 본인 v1.3.2 보드 → 모두 정상 동작 가정

---

## 6. 다음 세션 — D-day (5/10) 우선순위

### 시급 (오전)
1. 사용자가 디자인 원본 제공 → /play 학생 페이지 디자인 적용
2. 라이브 V Sweep 검증 결과에 따라 추가 fix
3. 데모 시나리오 리허설 (자연어 5종 + 동요 + 카메라 + 수동 조종)

### 데모 직전 (오후)
4. 라이브 페이지 최종 검증 (모든 페이지 200 OK)
5. 데모 환경 셋업 (PC + 9V + 보드 + 작품)

### 데모 후 v1.1 (5/11 ~)
- 펌웨어 자동 플래시 옵션
- 사진 인식 (C 의도 — 학생 작품 사진 + 갤러리)
- Turso 영속 메트릭
- 사용자 인증 (Clerk)

---

## 7. 결정/사실 빠른 참조

- **시리얼 포트** (Mac): `/dev/cu.usbserial-A5069RR4`
- **Baud**: 115200
- **펌웨어 (사용자 본인 보드)**: v1.3.2 (Ami5_V01)
- **펌웨어 컴파일**: `arduino-cli compile --fqbn arduino:avr:nano:cpu=atmega328 04_Base_Program/MechatronicsController/`
- **펌웨어 플래시**: `python3.14 stk500_flash.py <hex 경로>` (Mac, USB-C 클론 보드)
- **명령 어휘 (학생 보드 v1.0 호환)**: W/A/S/D, 1234/!@#$, 5/%/6/^, 0
- **명령 어휘 (v1.3.2 추가)**: V0~V9, F1~F4, X{idx}{duty}, ?, *
- **모터 매핑 v1.3.2**: D5=M2, D6=M1, D9=M3, D10=M4
- **서보 매핑**: D3=SA(입), D11=SB(꼬리), ±15도 단위
- **timer 충돌**: Servo 라이브러리 = timer1 → D9, D10 PWM 영향 (v1.3.2 동적 detach 로 해결)

---

## 8. 권한 (.claude/settings.local.json)
```json
{
  "permissions": {
    "allow": [
      "Bash(git push:*)",
      "Edit(/Users/caleb/dev/ThinkGen_Framework/**)",
      "Write(/Users/caleb/dev/ThinkGen_Framework/**)"
    ]
  }
}
```

---

## 9. ADMIN_PASSWORD (참고)

`kiQVGOg---k8E48U` (5/7 발급, .env.local + Vercel production/development 등록)
- /admin 접근용
- 정식 운영 전 회전 권장
