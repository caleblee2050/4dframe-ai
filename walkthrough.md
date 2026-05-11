# 4DFrame AI — Walkthrough

> 마지막 업데이트: 2026-05-11 (PM 후속 세션 — Turso 라이브 완료)
> **다음 세션 시작 시 이 문서만 읽고 즉시 작업 진입 가능**
> 페이지 안내: [docs/PAGES.md](docs/PAGES.md)
> 제품 비전: [docs/VISION.md](docs/VISION.md)

---

## 0. 즉시 시작 — 다음 세션 첫 명령

```bash
cd /Users/caleb/dev/4dframe-ai
git status
git log --oneline -15
vercel env pull .env.local       # OIDC 토큰 12시간 만료 — 항상 첫 작업
npm run dev                       # 로컬 dev (Mac)
```

**라이브 URL**: https://4dframe-ai.vercel.app
- `/` 마케팅
- **`/play/simple` 학생 메인 (THINK GEN 디자인)** ← 학생/교사에게 알리는 URL
- `/play` 어른용 고급 모드 (모든 기능)
- `/play/identify` 사진 인식
- `/play/test` 디버그
- `/admin` 관리자

---

## ✅ 5/11 PM 후속 — Turso DB 라이브 완료

- **DB**: `4dframe-skills` (default group, `aws-us-west-2`, `libsql://4dframe-skills-caleblee2050.aws-us-west-2.turso.io`).
  - 도쿄(`aws-ap-northeast-1`)는 별도 group 필요 — 일단 사용자 다른 18개 DB와 동일 그룹 사용. 트래픽 한국 집중 시 group 이전 검토.
- **Schema 적용 완료**: `skills` 테이블 + `idx_skills_artwork` / `idx_skills_created_at` 인덱스.
- **Vercel env**: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN × Production + Preview + Development 전부 등록.
  - 주의: `vercel env add ... preview --value <v> --yes` CLI 가 v53.3.2 에서도 "all preview branches" 모드 미동작 → **REST API (`POST https://api.vercel.com/v10/projects/:id/env?upsert=true`)** 로 우회. 토큰: `~/Library/Application Support/com.vercel.cli/auth.json`.
- **로컬 검증**: GET (전체) / GET `?artwork=crocodile` / POST / PATCH (simpleHidden) / DELETE 전부 PASS.
- **라이브 검증**: https://4dframe-ai.vercel.app/api/skills 동일 PASS — 배포 ID `dpl_5HoyGzMckko2qGhjjZajJ2H7HKZx`.
- **DB 상태**: 검증 데이터 삭제 후 0 row (clean slate).
- **Vercel CLI**: v52 → v53.3.2 업그레이드 완료.
- **TURSO 토큰**: 새로 발급 (caleblee2050). 만료 시 `turso db tokens create 4dframe-skills` 후 env 갱신 + redeploy.

---

## 1. 5/11 (PM) 큰 줄기 — BLE 진단 확정 + 자연어 스킬 워크플로우 + Turso 인프라

### A. 펌웨어 v1.3.6 — BLE 회로 미연결 확정
- v1.3.5 의 진단 강화 (5 baud → 9 baud + AT 형식 2개 + wait 400ms → 1000ms + 누적 byte 진단).
- 검증 결과: `BLE:noresponse,bytes=0` — 9 baud × 2 AT 변형 = **18회 시도 전부 0 byte**.
- echo 도 안 옴 → **J6 슬롯 ↔ ATmega328 hardware UART (D0/D1) 회로 자체 단선** 확정.
- 펌웨어 측 해결 불가능. 결론: **회로도 입수** (ThinkGen Inc 에 요청 진행) 또는 **멀티미터 추적** 후 SoftwareSerial 펌웨어 v1.4 필요.
- D-day (5/13 시연) 전까지 USB 모드로 안전 시연.

### B. 9V + USB 동시 연결 검증
- **운행 중**: 둘 다 연결 OK. 모터/서보 = 9V, 데이터 통신 = USB. 정상 작동.
- **플래싱 시**: 9V 분리 필요 (DTR reset window 영향, Arduino Nano 클론 흔한 증상).
- 5/13 시연 권장 구성: `보드 + 9V 배터리 (DC 잭) + USB 케이블 → 노트북`.

### C. 자연어 스킬 저장 워크플로우 — `save_skill` DSL
- 새 step: `{ do:'save_skill', label, emoji }`.
- 학생 흐름: "악어 잡아먹기에 죠스 음악 넣어줘" → AI program 생성+실행 → 마지막 say "마음에 들면 '저장해줘' 라고 해봐!" → 학생 "저장해줘" → AI 가 `save_skill` 만 응답 → 클라이언트가 **lastProgramRef** (직전 실행 program) 을 customSkill 로 저장.
- systemPrompt 에 워크플로우 가이드 + 예시 추가.
- simple + advanced 페이지 모두 `save_skill` 이벤트 처리.

### D. 쉬운 모드 3개 슬롯 노출/숨김 관리
- `CustomSkill.simpleHidden?: boolean` 필드 추가.
- `customStore.toggleSimpleHidden(id)` action.
- 설정 모달에 "💖 내 스킬 관리" 섹션 — 작품별 list + ⭐/🙈/🗑.
- simple page customs = `filter(!simpleHidden).slice(0, 3)`.
- 한/영/몽 라벨 모두 번역.

### E. AI 즉석 작곡 — `tune: 'custom'`
- DSL 확장: `PlayTuneStep.custom?: { notes: [{pitch, beats}], timbre? }`.
- pitch 'C3'~'A5' / 'rest' / beats 0.1~8 / timbre square·triangle·sine.
- melodySynth 의 `pitchToHz` + `customToNotes` + tune='custom' 분기 (timbre 별 음색).
- `melodyDurationMs(tune, tempo, custom?)` — sync 길이 정확 측정.
- systemPrompt 의 즉석 작곡 가이드 + 예시 3개 (긴장 sine / 행진 square / 심장박동 sine 반복).
- 핵심 원칙: 부정확해도 OK — "맞춰 나가는 과정" 자체가 사고력 훈련.

### F. ✈️ 떴다떴다 비행기 + 미지원 노래 fallback
- `airplane` tune 추가 (Mary Had a Little Lamb 멜로디).
- 카탈로그 9개: school_bell / twinkle / butterfly / mountain_rabbit / three_bears / airplane / beep_pattern / music_box / jaws / custom.
- systemPrompt: 카탈로그 외 노래 ("아기상어" 등) → custom 으로 즉석 작곡 또는 비슷한 preset.

### G. 음악-동작 정확 sync (executor 패턴)
- `viking_school_bell` executor — 학교종 + M1+M3 흔들기 동시 시작/종료.
- `crocodile_jaws` 신규 — 죠스 음악 80% 까지 입 미세 떨림, 마지막 20% 클라이맥스 입 크게 + crocodile 효과음.
- `ballerina_musicbox` 다국어 say (intro/outro 사전 키).
- `SkillExecutor.t(key)` 인터페이스 추가 — executor 내부 i18n.

### H. TTS 다층 fallback + OpenAI 통합
- **검색 결과 (2026-05-11)**: Vercel AI Gateway 가 TTS 라우팅 미지원 ("Model could not be resolved"). `gemini-3.1-flash-tts-preview` 가 최신, preview 자체 일일 한도 100 (Tier 1 유료여도).
- 3층 fallback 구조:
  1. **Gemini 3.1 Flash TTS Preview** (`GOOGLE_GENERATIVE_AI_API_KEY`) — 최선 품질, 100/일.
  2. **OpenAI tts-1** (`OPENAI_API_KEY`) — 유료 billing 활성. 한도 거의 무한. **사용자 5/11 PM 활성화 + 키 등록 완료** ✅.
  3. **브라우저 `SpeechSynthesisUtterance`** — 최종 안전망, Mac OS voice.
- voice 매핑 (Gemini → OpenAI): Kore→nova / Puck→alloy / etc.
- soundManager.ts: `/api/tts` 실패 시 자동으로 브라우저 TTS fallback.
- ⚠️ 사용자 공유 OpenAI key 는 채팅/git 기록에 평문 노출 — **회전 권장**.

### I. Turso DB 인프라 (다음 세션 완성)
- `@libsql/client` 사용. `scripts/turso-schema.sql` (skills 테이블).
- `/api/skills` GET (?artwork=xxx 필터) / POST (validateProgram + 추가).
- `/api/skills/[id]` DELETE / PATCH (simpleHidden 토글).
- **customStore.ts 변환**: zustand persist (localStorage) → server-synced.
  - fetch / add / remove / toggleSimpleHidden 모두 async + API 호출.
  - 낙관적 업데이트 + 실패 시 롤백.
  - simple + advanced 페이지 mount useEffect 에서 fetch.
- 단일 테넌트 (로그인 v2). 모든 PC 같은 스킬 풀 공유 — **PC 별 스킬 차이 문제 해결**.
- 사용자 turso 로그인 OK. DB 생성 + env 등록 + schema 적용 = 다음 세션 첫 작업.

### J. 카메라 손 동작 — 악어 단순화
- artwork === 'crocodile' 시 손 펼침(openness>=0.6) = 입 벌림 (`%`) / 주먹(<=0.3) = 입 다묾 (`5`).
- 중간 영역 hysteresis. 다른 작품은 기존 손가락 0~5개 매핑 유지.

### K. 도메인 진단 + 보안
- 5/11 PM 1차 시연 후 OIDC 토큰 만료 → dev server 죽음 → vercel env pull 갱신.
- OpenAI key 가 채팅 평문 노출 → 사용자에게 회전 권장.
- turso 의 settings.json 에 저장된 token 만료 → 사용자가 `turso auth login` 재로그인 (5/11 PM 완료).

---

## 2. 5/10 (오후) ~ 5/11 (AM) 큰 줄기 — 단순 모드 + 다국어 + AI 작곡

### A. 학생용 단순 모드 (/play/simple) 신설
- 별도 라우트로 분리 — `/play` 는 어른용, `/play/simple` 은 학생용 (디자인 이미지 매칭).
- 좌측 사이드바: THINK GEN 로고 + 나만의 AI 스킬 (1/2/3 칩, 작품별 자동) + AI 기본 스킬 (입 벌리기/다물기 ±15°).
- 우측 메인: 프로젝트 검색바 + 컨트롤 보드 ON/OFF + 큰 입력 박스 + 캐릭터 + 메시지.
- 입력 박스 우측 하단 마이크 🎤 (입력 박스와 통합) / mount 시 textarea autofocus.
- 캐릭터 박스 우측 하단: 입 아이콘 (설정 ⚙️) + 눈 아이콘 (거리 반응 + cm + ON/OFF 배지) — 직관적 라벨.
- 우측 상단 헤더: 프로젝트 드롭다운 / 🖐 손동작 토글 / 언어 토글 (큰 원형 44px 🇰🇷🇺🇸🇲🇳) / 컨트롤 보드 ON/OFF.

### B. 다국어 — 한국어 / English / Монгол
- `src/lib/i18n/dict.ts` — 60+ 키 사전 (UI 라벨, 스킬 이름, 설정 메뉴, 카메라 메시지)
- `src/lib/i18n/store.ts` — zustand persist (`4dframe-i18n`, locale + simpleMode)
- TTS voice 분기: `Kore` (한) / `Puck` (영) / `Puck` (몽골 — voice 미지원이라 영어 fallback)
- TTS cache 키에 `locale:text` prefix
- systemPrompt 가 locale 받아 응답 언어 가이드 출력 (en/mn 모드 → say/intro/chips 모두 해당 언어)
- 6개 built-in 스킬 라벨 + intro/outro say 텍스트 모두 한/영/몽 번역

### C. AI 즉석 작곡 — `tune: 'custom'`
- DSL 확장: `PlayTuneStep.custom?: { notes: [{pitch, beats}], timbre? }`
- pitch 'C3'~'A5' / 'rest' / beats 0.1~8 / timbre square·triangle·sine
- melodySynth: `pitchToHz` + `customToNotes` + tune='custom' 분기 (timbre 별 음색)
- `melodyDurationMs(tune, tempo, custom?)` — sync 길이 정확 측정
- systemPrompt: 분위기 묘사 → AI 즉석 작곡 가이드 + 예시 3개 (긴장 sine / 행진 square / 심장박동 sine 반복)
- 핵심 원칙: 부정확해도 OK — "맞춰 나가는 과정" 자체가 사고력 훈련

### D. 음악-동작 정확 sync (executor 패턴)
- `viking_school_bell` executor 화 — 학교종 + M1+M3 흔들기 동시 시작/종료
- `crocodile_jaws` 신규 — 죠스 음악 80% 까지 입 미세 떨림, 마지막 20% 클라이맥스 입 크게 + crocodile 효과음
- `ballerina_musicbox` — V9 → V2 linear 감속, 음악 끝 = 모터 정지 (이미 있던 것 + 다국어 say)
- `SkillExecutor` 인터페이스에 `t(key)` 추가 — executor 안에서 다국어 say
- `playMelody(tune, tempo, muted, custom?)` 시그니처 + Promise<void> 반환

### E. 새 동요 + 카탈로그 확장
- ✈️ `airplane` (떴다떴다 비행기) 추가 — Mary Had a Little Lamb 멜로디
- 카탈로그 9개: school_bell / twinkle / butterfly / mountain_rabbit / three_bears / airplane / beep_pattern / music_box / jaws
- 미지원 노래 ("아기상어" 등) 시 systemPrompt fallback 가이드 — custom 으로 즉석 작곡 또는 비슷한 preset 안내

### F. 마이크 STT 전면 교체 (Web Speech API → MediaRecorder)
- 환경 의존성 (특정 PC onspeechstart 미호출) 우회
- `/api/stt` (Vercel AI Gateway → google/gemini-2.5-flash multimodal audio)
- VAD 침묵 자동 종료 (1.5초) + 명확한 진단 (권한/장치/짧음/들리는말없음)
- 단발 토글 — 명령줄에서 클릭 시 녹음, 침묵 자동 종료, 결과 input 누적
- 대화모드 일시 시도 후 제거 (자동 흐름 검증 부족)

### G. UI 큰 단계
- 도구 바 / 작품 카드 분리 (advanced 페이지)
- 거리 반응 토글을 헤더 위젯 (advanced) + 캐릭터 박스 우측 하단 (simple)
- 자동차 작품 시 조이스틱 자동 노출 (mag 위치값 기반 V level + 키보드 화살표 mag=0.55)
- 카메라 제스처 토글 버튼 (🖐) — 헤더에서 ON/OFF
- 악어 작품 카메라 단순 분기 — 손 펼침(openness>=0.6) = 입 벌림 (`%`) / 주먹(<=0.3) = 입 다묾 (`5`)

### H. 손가락 인식 정확도 — 3D 관절 각도
- MediaPipe 의 z 좌표 포함한 dot product (`MCP→PIP` 와 `PIP→TIP` cos > 0.5)
- 엄지는 별도 — `tip` 과 검지 MCP 거리 비교 (회전축 다름)
- 진단 칩에 마스크 표시 (👍 ☝️ 🖕 💍 🤙)

### I. 펌웨어 v1.3.4 ~ v1.3.5 — BLE baud auto-changer
- v1.3.4: 부팅 시 EEPROM 플래그 검사 → JDY-23 default 9600 → AT+BAUD8 (115200) 영구 변경 → EEPROM 플래그 set
- v1.3.5: 응답 검출 강화 (1+ byte = OK), 1.5초 BLE init wait, 부팅 메시지에 `BLE:9600->115200` 진단 출력
- stk500_flash.py 8라운드 retry 추가 (sync window 부팅 직후 짧은 USB-C 클론 보드 대비)
- **결론**: 보드 J6 슬롯이 ATmega328 hardware UART 와 회로상 연결되지 않음 (`BLE:noresponse`) — BLE 통신 불가. UI 에서 BLE 버튼 숨김.

### J. 손그림 → 폭파도 / 자유 입력 JSON 보호
- 빈 응답 (`cleaned === ''`) → 명확한 에러 메시지
- JSON.parse 실패 → 원인 message 포함 에러
- history 누적 cap (서버 전송 8턴, 메모리 16엔트리)

### K. customSkills 연동 (advanced ↔ simple)
- simple 모드도 customSkills 자동 표시 (작품별 필터, 최대 3개 슬롯)
- advanced 에서 💾 저장 → simple 에 즉시 반영, ✕ 삭제 → simple 도 동시 사라짐
- localStorage origin 별 분리는 환경 차이 (localhost ↔ vercel.app) — 같은 환경 안에서는 자동 동기화

### L. 부모용 ⚙️ 설정 모달 (simple 페이지 안)
- 거리 반응 모드 토글 (체크박스)
- 모터 길들이기 (M1~M4 시동 V ±1, 정/역, ▶ 시동 테스트)
- 서보 각도 (SA/SB ±15°, 90° 중앙)
- 모든 라벨 다국어

---

## 2. 5/9~5/10 큰 줄기 (시간순)

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
