# 4DFrame AI — Walkthrough

> 마지막 업데이트: 2026-05-09 저녁 (D-1, 5/10 데모 전날)
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
| ~~v1.3.2~~ | ThinkGen_Framework `1a068e5` | servo 동적 detach 시도. **timer1 모드 reset 빠져 무효** |
| **v1.3.3** | ThinkGen_Framework `a46626f` | detach 후 TCCR1A/B 명시 reset → D9/D10 PWM 회복. **5/9 저녁 플래시 + Verify OK 완료** |

### 펌웨어 어휘 호환성

| 어휘 | v1.0 | v1.3.2 | PWA 송신 |
|---|---|---|---|
| W/A/S/D, 1234/!@#$, 5/%/6/^, 0 | ✅ | ✅ | 항상 |
| **V0~V9** | ❌ | ✅ | `isV13Plus(fw)` 자동 분기 |
| X{idx}{duty}, F1~F4, ?, * | ❌ | ✅ | /play/test 디버그만 |

학생 키트 양산 = v1.3.2 일괄 플래시 권장. 펌웨어 자동 플래시 옵션 (Web Serial STK500v1) v1.1 작업으로 미룸.

---

## 3. 미해결 / 검증 필요

### ✅ 펌웨어 v1.3.2 → v1.3.3 회귀 fix + 플래시 + V Sweep 검증 완료 (5/9 저녁)

#### 사용자 직접 테스트 결과 (Mac + PC 둘 다, v1.3.2 펌웨어)
- **M3 (D9), M4 (D10)**: V0~V8 무반응, **V9(최고 속도)만 동작** ← 핵심
- M1 (D6), M2 (D5): 정상 (timer0 사용 → servo 영향 없음)
- 서보: PC ✅ / Mac ❌ (Mac USB-C 5V 토크 부족, 별개 이슈)
- 9V 배터리 연결해도 모터 증상 동일 → 전류 가설 폐기

#### 진단 (ThinkGen_Framework `a46626f` 분석 + 코드 검증)
- Arduino `Servo::detach()` 의 `finISR()` 는 `TIMSK1` OCIE1A 만 끔
- `TCCR1A`/`TCCR1B` 는 attach 시 `initISR` 가 set 한 **CTC 모드**
  (WGM12=1, prescaler 8) 그대로 남음
- 이 상태의 `analogWrite(D9/D10)` 는 OCR1A/B 만 쓰지만 모드가 PWM 이
  아니라 출력 파형이 안 나감 → val=255 만 `digitalWrite(HIGH)` fallback
  → "최고속도만 작동" 증상과 정확히 매치
- v1.3.2 의 detach 패치는 **timer1 모드 자체는 복원하지 않아 무효**

#### v1.3.3 fix (커밋: ThinkGen_Framework `a46626f`)
- `resetTimer1ForPwm()` 추가:
  - `TCCR1A = _BV(WGM10)` → Phase Correct PWM 8-bit
  - `TCCR1B = _BV(CS11) | _BV(CS10)` → prescaler 64 (~490Hz, Arduino 기본)
  - `TIMSK1 = 0` → Servo 인터럽트 해제
- detach 후 항상 호출 (V/X 명령 진입, setup 초기화, loop 자동 1.5s detach)
- 컴파일 검증: 7234 bytes / 30720 (23%), 정상

#### 펌웨어 v1.3.3 플래시 — 완료 (5/9 저녁)
```
✅ Sync OK on attempt 2
[3/5] Enter prog mode
[4/5] 펌웨어 쓰기 (57/57 페이지)
[5/5] Verify OK — 첫 페이지 128 byte 일치
🎉 BOOT:Ami5_V01:FW1.3.3
```

#### stk500_flash.py 강화 이력 (5/9 저녁, 4세대 fix)
이 보드의 부트로더는 **sync 받아도 1초 timer 가 계속 가는 변종** (Optiboot 표준은 sync 후 무한 대기). 이 사실 모르고 구현하면 progress bar 가 다 가도 실제 보드는 미변경 상태로 남는 가짜 매치가 발생. 4번 디버깅 끝에 다음 셋이 모두 필요:
1. `7639e4a` — sync 잔여 응답 정리 + 시그니처 try/except
2. `098d5c4` — 시그니처 단계 완전 제거 (윈도우 절약)
3. `f8c56bc` — sync 5회 제한 + drain 함수 + **첫 페이지 read-back verify** (가짜 매치 안전망)
4. `7b57c25` — drain 0.3s → 0.05s + 짝맞춤 sync (윈도우 까먹기 방지)

핵심 학습: Verify (CMD_READ_PAGE) 가 가짜 매치 진단의 결정적 단서. 없으면 progress bar 만 보고 성공 오인.

#### PC 검증 결과 (5/9 저녁)
- ✅ FW 뱃지 `1.3.3 ✓ 최신`
- ✅ V Sweep — M2/M3/M4 모두 V3/V5/V7/V9 단계차 명확 (청각 + 시각)
- ✅ 서보 SA/SB 풀 가동 — 부드럽게 동작
- ❌ `/play` 자연어 모드 — speed 차이 안 들림 (별개 이슈, 아래 참조)

### ✅ 자연어 모드 speed 단계차 fix 완료 (5/9 저녁, 사용자 검증 완료)
**결과**: 3단계 속도차이가 모든 모터에서 정확히 들림 (M1~M4 + 자연어 + V Sweep 동치).
사용자 보고: 자연어로 "천천히→점점 빠르게→천천히→정지" 명시했는데 단계차 미체감.
모터 1~4 모두 동일 증상.

#### 원인
`calibration/store.ts:calibratedPwmLevel` 의 floor 클램프:
```ts
return Math.min(9, Math.max(baseLevel, threshold[motor] + 1));
```
v1.3.2 회귀 진단 때 사용자가 캘리브레이션 카드에서 시동 V 를 V8/V9 까지
올려가며 진단 → localStorage 에 흔적 → v1.3.3 플래시 후에도 calibration
값은 그대로 → 학생 "천천히=V5" 가 max(5, 9) = V9 풀파워로 클램프 →
모든 speed 라벨이 사실상 V9 → 단계차 무.

#### fix 사슬 (3 커밋)
1. `8cbf29b` — webSerial.send 에 `[serial→]` console.log 디버그
2. `207643c` — **floor 클램프 폐기 + 시동 V 균등 배분** (`speedToLevel`)
3. `746c666` — **zustand persist version 1→2** + migrate 함수로 v1.3.2 진단 시기 비정상 시동 V (V8/V9) 흔적 강제 reset. 사용자 측 dev tools 명령 입력 없이 강제 새로고침만으로 정상화.
```ts
// commands.ts
export function speedToLevel(label: SpeedLabel, threshold: number): number {
  const t = Math.max(0, Math.min(9, threshold));
  if (label === '천천히') return t;          // 시동 V 그대로
  if (label === '빠르게') return 9;           // 풀파워
  return Math.round((t + 9) / 2);             // 보통 = 중간
}
```

매핑 결과:
- 시동 V=3 모터 → 천천히 V3, 보통 V6, 빠르게 V9 (PWM 84/168/255 — V Sweep 4단계와 흡사)
- 시동 V=5 모터 → 천천히 V5, 보통 V7, 빠르게 V9 (PWM 140/196/255)
- 시동 V=8 인 보드 (비정상) → 천천히 V8, 보통 V9, 빠르게 V9 (단계차 줄지만 모터 한계)

#### 새 운영 컨셉 (어른+아이 분리)
- **/play/test (어른용)**: 모터별 시동 V 측정 + 캘리브레이션 카드
- **/play (학생용)**: localStorage 의 시동 V 자동 적용 → 학생은 그냥 "천천히/보통/빠르게" 라벨로 놀기
- zustand persist 로 두 페이지 자동 공유 (이미 구현)

#### 디버그
- `webSerial.send` 에 `console.log('[serial→]', payload)` 추가 → PC dev tools Console
  탭에서 어떤 V/W/A 명령이 보드에 가는지 실시간 확인 가능

#### 검증 결과 (사용자 보고, 5/9 저녁)
- ✅ 3단계 속도 차이가 M1~M4 모두에서 정확하게 들림
- 즉 자연어 → DSL → speedToLevel(시동 V 기준) → V 명령 → 펌웨어 v1.3.3 → 모터 PWM 흐름이 끝까지 정상 동작

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

### 사용자 검증 (5/9 저녁 — 모두 완료)
- [x] PC 환경에서 라이브 https://4dframe-ai.vercel.app/play/test 접속 ✅
- [x] 보드 연결 → **FW 뱃지 `1.3.3 ✓ 최신`** 확인 ✅
- [x] V Sweep — M2/M3/M4 모두 V3/V5/V7/V9 단계차 명확 ✅
- [x] 서보 풀 가동 (SA, SB) — 90→0→180→90 부드럽게 ✅
- [x] 자연어 시연 — `/play` 페이지에서 3단계 속도차 모든 모터 정상 ✅

### 환경 차이 (5/9 저녁 정정)
- **모터 M3/M4 회귀**는 환경 무관 — 펌웨어 v1.3.2 자체 결함 (timer1 모드 reset 누락). v1.3.3 플래시로 해결 예정.
- **서보**: PC ✅, Mac ❌. Mac USB-C 5V 토크 부족 (별개 이슈, 9V 외부 전원 필요). 데모 PC 는 Windows/Chromium 권장.

### 데모 환경 가정 (5/10)
- PC (Chromium) + v1.3.3 플래시된 보드 → 모터 4채널 + 서보 2채널 모두 정상 동작 기대
- Mac 데모 시: 9V 외부 전원 필수 + v1.3.3

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
- **펌웨어 (사용자 본인 보드)**: v1.3.3 (Ami5_V01, 5/9 저녁 플래시 완료, Verify OK)
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
