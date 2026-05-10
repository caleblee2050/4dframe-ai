### [2026-05-10] baseline-lint-unescaped-quotes: 기존 랜딩 페이지 lint 실패
- **결과**: FAIL
- **맥락**: `/play/simple` 디자인 변경 검증 중 `npm run lint` 실행. 변경 범위 밖인 `src/app/page.tsx:261`의 unescaped quote 에러 2건으로 lint가 실패했다.
- **학습**: 디자인 변경 검증에서는 `npm run build` 통과 여부와 기존 lint baseline 실패를 분리해서 보고해야 한다.
- **반복횟수**: 2회
