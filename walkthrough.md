# 4DFrame AI — Walkthrough

> 마지막 업데이트: 2026-05-10 (D-day 새벽)
> **다음 세션 시작 시 이 문서만 읽고 즉시 작업 진입 가능**

---

## 0. 즉시 시작 — 다음 세션 첫 명령

```bash
cd /Users/caleb/dev/4dframe-ai
git status
git log --oneline -10
vercel env pull .env.local       # OIDC 토큰 12시간 만료 — 항상 첫 작업
npm run dev                       # 로컬 dev (Mac)
```

**라이브 URL**: https://4dframe-ai.vercel.app
- `/` 마케팅 / `/play` 학생용 / `/play/identify` 사진 인식 / `/play/test` 디버그 / `/admin` 관리자

---

## 1. 5/9~5/10 큰 줄기 (시간순)

### A. 펌웨어 회귀 사슬 fix
- **v1.3.3** (`a46626f`): `Servo::detach()` 가 timer1 모드(CTC) 복원 안 해서 D9/D10 PWM 죽던 v1.3.2 회귀 → `resetTimer1ForPwm()` 명시 호출 추가. detach 후 TCCR1A=Phase Correct PWM, TCCR1B=prescaler 64 강제 reset.
- **stk500_flash.py 4세대** (`7b57c25`): sync 잔여 응답 정리 + 시그니처 우회 + 5회 제한 + 첫 페이지 read-back verify + drain 단축. 보드 펌웨어가 Optiboot 변종이라 sync 후 timer 계속 가는 환경에 맞춤.
- 결과: M1~M4 V Sweep 4단계 (V3/V5/V7/V9) 모두 청각 차이 명확.

### B. 자연어 모드 speed 단계차 fix
- `calibratedPwmLevel` floor 클램프 → 학생 "천천히=V5" 가 V9 로 끌려가던 문제. **`speedToLevel(label, threshold)`** 시동 V 균등 배분으로 교체.
- localStorage 의 v1.3.2 진단 시기 비정상 시동 V (V8/V9) 잔존 → **zustand persist version 1→2 + migrate 강제 reset**.
- 결과: 자연어 "천천히/보통/빠르게" 가 V3/V6/V9 (PWM 84/168/255) 로 명확.

### C. 디자인 5/8 시점 롤백
- 사용자 결정: 5/9 D-1 대전환 디자인 폐기, 짝코더 톤 (hint/learning_points) 시점으로 복귀.
- `/play/page.tsx` 를 `65ef24f^` 시점으로 복원, ServoGauge/SpeedGauge 자동 제거.
- play_tune step (5/9 추가) 호환을 위해 stepIcon/describeStep 보강.

### D. 직접 컨트롤 시스템
- **🕹 조이스틱**: 차동 조향 (좌=M1+M3, 우=M2+M4). 80ms throttle.
  - 키보드 화살표 지원. textarea/input focus 시 무시. 떼면 즉시 정지 (mag=0 throttle 우회).
  - 작품 무관 토글 ON/OFF.
  - V level = `round(mag × 9)` (조이스틱 거리 비례 — 조금 밀면 V3, 끝까지 V9 직관).
- **🖐 손 동작 인식** (MediaPipe HandLandmarker):
  - **손가락 개수 0~5 인식** (`countFingers`: tip-mcp 거리 비교).
  - 6 슬롯 매핑 (`finger_0` ~ `finger_5`). 기본 매핑: 0=정지 / 1=천천히 / 2=보통 / 3=빠르게 / 4=뒤로 / 5=입 벌리기.
  - 매핑 UI 기본 접힘. "⚙️ 고급 — 매핑 바꾸기" 펼침.
  - 동작 카탈로그 12개 (전후좌우 / 속도 3단 / servo SA SB / noop).
  - **Lm 타입**: MediaPipe Tasks Vision 의 객체 형태 ({x,y,z}). 옛 array indexing 으로 NaN 나던 버그 fix.

### E. 4 기본 모델 스킬화
- `src/lib/skills/library.ts` (6 스킬):
  - `viking_swing` / `viking_school_bell` / `car_explore` / `crocodile_chomp` / `ballerina_musicbox` / `swing_round`
  - 각 스킬에 variation_chips + 마지막 say (제안 톤).
- 작품 선택 카드 안 칩 → 클릭 시 즉시 실행 (AI 안 거침).
- **executor 인터페이스** (`Skill.execute`): 음악-동작 정교 sync 가 필요한 스킬용.
  - `ballerina_musicbox` = `playMelody` + `W` 한 번 시동 + 250ms 마다 V9→V2 linear 보간.
  - 음악 16.5초 동안 끊김 없이 연속 감속 (이전 step 시퀀스로 stopAll 끊기던 문제 해결).

### F. 음악 시스템
- 동요 6곡 (school_bell/twinkle/butterfly/mountain_rabbit/three_bears/beep_pattern)
- **music_box** (오르골): C4~C5 옥타브 + triangle wave + release 0.18s (chime ring out) + beats 점진 증가 (태엽 풀림 dynamics)
- **jaws** (죠스 등장음): E2/F2 sine wave + beats 점진 감소 (긴장감 점증)
- **결정적 fix**: page.tsx onEvent 핸들러에 `play_tune` case 누락 → 모든 멜로디 무시되던 버그. import + handler 추가 (`1c81924`).

### G. 사진 인식 → 작품 자동 파악
- **별도 페이지** `/play/identify`:
  - `CameraCapture` 컴포넌트 — `getUserMedia` + 1024px 리사이즈 + JPEG 0.85
  - PC 웹캠 (facingMode='user') 자동 미러 (`scaleX(-1)`)
  - 다각도 사진 누적 → 사진별 분석 + 종합 confidence → "이걸로 놀러갈래" `/play?artwork=xxx`
- **`/api/identify-artwork`**: claude-sonnet-4-6 vision (Vercel AI Gateway).
  - 응답: `{ artwork, confidence, greeting, reasoning, ideas[] }`

### H. UX 개선 (단순함 우선)
- ⚙️ **설정 모달**: 모터 길들이기 + 거리 반응 토글 = 어른용. 메인은 단순.
- 헤더 우측 **거리센서 미니 위젯** (👀 30 cm).
- 입력란 **🎤 음성 + 엔터 실행** (Shift+Enter = 줄바꿈, IME 한글 조합 안전).
- **Global Enter**: 어디서든 Enter → textarea focus + 끝 커서 (button/input/contentEditable 외).
- **응답 영역 단순화**: "💬 짝코더 메시지" 별도 영역 삭제. 시작 한마디 + 마지막 멘트 + "▼ 실행 과정 보기" 토글 (기본 닫힘).
- **후속 제안 흐름**: 동작 종료 후 핑크 카드 + scrollIntoView + variation_chips 큰 칩. 클릭 = setInput + textarea focus (자동 전송 X — 학생이 추가 주문 작성).
- **💾 커스텀 스킬 저장**: `customSkillsStore` (zustand persist). "💖 내 스킬" 라인 + ✕ 삭제. 향후 로그인 시 서버 동기화 진입점.

### I. systemPrompt 톤 전환
- 코딩 용어 (코드/프로그램/스크립트/명령어/구문/repeat/loop/if) 명시 금지
- "🌟 후속 제안 (variation_chips) — 항상 2~4개" 명시 + 좋은/나쁜 예
- 학생 흐름 ("칩 → 입력창 채워짐 → 추가 주문 → 풍부한 상상") 가이드
- ballerina + music_box + jaws 가이드 추가

---

## 2. 펌웨어 매트릭스

| 버전 | 위치 | 상태 |
|---|---|---|
| v1.0 | ThinkGen_Framework `b62f3c0` | 4D Frame 본사 원본 |
| ~~v1.3~~ | `469c5f6` | M2/M3 핀 스왑 + V/X/F/? — timer1 회귀 |
| ~~v1.3.2~~ | `1a068e5` | servo detach 시도. timer1 모드 reset 빠져 무효 |
| **v1.3.3** | `a46626f` | TCCR1A/B 명시 reset. **사용자 보드 플래시 + Verify OK** |

펌웨어 어휘 (사용 빈도순):
- **W/A/S/D**: 4모터 전후좌우 (모든 모터)
- **0**: 전체 정지
- **V0~V9**: globalPwm (v1.3+)
- **1234/!@#$**: 단일 모터 forward/reverse
- **5/%/6/^**: 서보 SA(입) / SB(꼬리) ±15도
- **X{idx}{duty}**: 단일 PWM 핀 변조 (idx 0=D5/M2, 1=D6/M1, 2=D9/M3, 3=D10/M4)
- **F1~F4**: 모터 방향 토글
- **?**: 진단 / **\***: 소프트 reset

---

## 3. 알려진 이슈 / 미해결

### 🟠 음성 입력 (Web Speech API) — 환경 의존
- 사용자 환경에서 onspeechstart 한 번도 안 호출 → 12회 자동 재시작 후 종료.
- 우리 코드 측 fix 한계 (continuous=true + 자동 재시작 + 화면 진단 칩 다 적용).
- alert: 시스템 마이크 / Chrome 권한 / 다른 앱 점유 / 인터넷 연결 4가지 점검.
- **대안**: MediaRecorder + Gemini STT 또는 Whisper. 큰 작업, 미실행.

### 🟢 미해결 / 보류
- **폭파도** — 사진 인식 결과 → 모터/프레임/연결 시각 분해 일러스트. 사용자 비전 "마지막으로". 미실행.
- 카메라 인식 — 손만. 얼굴/머리 (head_tilt) 모드는 placeholder 만. v0.1 미구현.

---

## 4. 핵심 모듈 트리

```
src/lib/
  ai/systemPrompt.ts        — 학생 친화 톤 + 작품별 본질 + variation_chips 가이드
  admin/metrics.ts          — in-memory 호출 카운터
  calibration/store.ts      — 보드별 시동 V (zustand persist v2)
  commands/commands.ts      — 어휘 SSoT + speedToLevel + isV13Plus
  dsl/schema.ts             — Step types + validateProgram (artwork list ballerina 포함)
  dsl/interpreter.ts        — Program 실행 + speedToLevel 매핑
  serial/webSerial.ts       — Web Serial + console.log [serial→]
  sound/soundManager.ts     — TTS + 효과음 캐시
  sound/melodySynth.ts      — Web Audio 멜로디 8곡 (tune 별 oscType + gain + release)
  skills/library.ts         — 6 built-in 스킬 + Skill.execute (executor)
  skills/customStore.ts     — 학생 커스텀 스킬 (zustand persist, max 30)
  gestures/mappingStore.ts  — 손가락 개수 6 슬롯 매핑 (zustand persist v2)

src/components/play/
  Joystick.tsx              — onMove(x,y,mag) + onDirection 호환
  CameraPanel.tsx           — MediaPipe HandLandmarker + countFingers + Lm 객체 타입
  CameraCapture.tsx         — getUserMedia 직접 촬영 (사진 인식 페이지용)

src/app/
  play/page.tsx             — 메인 (작품 선택 / 스킬 / 사진 / 직접 조종 / 손 동작 / 입력)
  play/identify/page.tsx    — 사진 인식 별도 페이지
  play/test/page.tsx        — 어른용 디버그 (V Sweep, 모터 캘리브)
  api/chat/route.ts         — 자연어 → DSL (claude-sonnet-4-6 + Vercel AI Gateway)
  api/identify-artwork/route.ts — 사진 → artwork (claude-sonnet-4-6 vision)
  api/tts/route.ts          — Gemini 3.1 Flash TTS

public/sounds/              — 효과음 mp3 10개
public/fdland/              — 4D Land 디자인 자산 (현재 미사용)
```

---

## 5. 다음 작업 후보 (우선순위)

### 🔴 시급 (사용자 의향 따라)
1. **폭파도** (사용자 비전 마지막) — 사진 인식 결과 + Gemini Vision → 분해 일러스트. SVG 또는 GPT-Image. /play/identify 페이지 확장 또는 새 라우트.
2. **음성 입력 대안** — Web Speech API 환경 의존 우회. MediaRecorder + Gemini Audio API 직접 호출.

### 🟡 차순위
3. **얼굴/머리 모드** — MediaPipe FaceLandmarker 추가. CameraPanel 의 head_tilt placeholder 완성.
4. **다른 작품 executor 화** — viking_swing, swing_round 도 음악 sync 화 (현재는 step 시퀀스).
5. **사진 인식 페이지의 chat-like 대화** — 학생이 사진 보고 질문 → AI 응답 흐름.

### 🟢 후속 (D+ 미정)
6. **Turso 영속 메트릭** — admin/metrics 가 in-memory.
7. **사용자 인증 (Clerk)** — 커스텀 스킬 서버 동기화.
8. **결제 통합** (Stripe / Toss) — 유료 버전.
9. **펌웨어 자동 플래시 옵션** — Web Serial STK500v1 JS 포팅.

---

## 6. 결정/사실 빠른 참조

- **시리얼 포트** (Mac): `/dev/cu.usbserial-A5069RR4`
- **Baud**: 115200
- **사용자 보드 펌웨어**: v1.3.3 (Ami5_V01)
- **펌웨어 컴파일**: `arduino-cli compile --fqbn arduino:avr:nano:cpu=atmega328 --build-path "$(pwd)/build" 04_Base_Program/MechatronicsController/`
- **펌웨어 플래시**: `python3.14 stk500_flash.py 04_Base_Program/MechatronicsController/build/MechatronicsController.ino.hex`
- **모터 매핑 v1.3.3**: D5=M2, D6=M1, D9=M3, D10=M4 (PWM)
- **서보 매핑**: D3=SA(입), D11=SB(꼬리), ±15도
- **timer 충돌**: Servo 라이브러리 = timer1 → D9, D10 PWM 영향 (v1.3.3 동적 detach + 명시 reset 으로 해결)
- **Vercel AI Gateway**: VERCEL_OIDC_TOKEN 자동 인증, claude-sonnet-4-6
- **TTS**: gemini-3.1-flash-tts-preview (직접 Gemini API, Gateway 미지원)
- **localStorage 키**:
  - `4dframe-calibration` v2 (모터 시동 V)
  - `4dframe-custom-skills` v1 (학생 저장 스킬)
  - `4dframe-gesture-mapping` v2 (손가락 ↔ 동작)

---

## 7. 권한 (.claude/settings.local.json)

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

## 8. 다음 세션 첫 검증 체크 (라이브)

PC 크롬에서 https://4dframe-ai.vercel.app/play 강제 새로고침 후:

- [ ] 보드 연결 → FW 뱃지 `1.3.3 ✓ 최신`
- [ ] 발레리나 → "🩰 오르골 발레리나" 스킬 → 음악 + 회전이 끊김 없이 점진 감속
- [ ] 자동차 또는 직접 조종 ON → Joystick 끝까지/조금 밀기 비교 → V level 차이 명확
- [ ] 손 동작 ON → 손가락 1/2/3/4 개씩 보여주기 → 진단 칩에 정확한 % 와 액션 표시
- [ ] /play/identify → 카메라 미러 정상 + 작품 사진 → 분석 카드 + ideas chips
- [ ] 자연어 발화 → 응답 카드 + 후속 제안 칩 클릭 → input 채워짐 + focus
- [ ] 💾 내 스킬 저장 → 작품 카드에 ✕ 삭제 가능한 칩 등장

---

## 9. ADMIN_PASSWORD

`kiQVGOg---k8E48U` (5/7 발급, .env.local + Vercel 환경변수 등록)
- /admin 접근용
- 정식 운영 전 회전 권장
