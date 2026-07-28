# CTO_REPORT — AI Product Content OS 공식 기술 보고서

> 이 문서는 AGENTS.md의 TASK 완료 절차에 따라 모든 TASK 완료 시 갱신된다.
> 형식(섹션 구성)은 항상 동일하게 유지한다:
> 1. 보고 요약 → 2. 품질 게이트 → 3. **변경 사항** → 4. **테스트 결과**
> → 5. **아키텍처 변경**(+현황) → 6. 데이터 모델 → 7. API 표면
> → 8. 리스크·기술 부채 → 9. **다음 권장 사항**
> (굵은 항목 4가지는 AGENTS.md가 요구하는 필수 포함 항목)

---

## 1. 보고 요약

| 항목 | 값 |
| --- | --- |
| 보고 기준 TASK | **TASK-0604 — Image Guard & Preprocessing** |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `6c00dfb` |
| 핵심 성과 | Vision 호출 전 **이미지 검증→리사이즈→최적화→EXIF 제거→용량 제한** 파이프라인 완성 — 실제 Provider 연결 전 필수 가드(0505 승인 ④) 이행 |
| 구현 중단 상태 | **TASK-0604 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 정책 기본값·스킵 동작 등 → **CTO_REQUEST #25 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 273/273 통과 (core 121 · api 152) — 이번 주기 +12 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0604 — Image Guard & Preprocessing (`6c00dfb`)

지시된 5개 항목 — Vision Provider 호출 전에 순서대로 적용:

1. **이미지 검증** (`validateSourceImage`, @acos/core 순수 로직):
   MIME 허용 목록(jpeg/png/webp/gif) · 빈 파일 거부 · 원본 최대 20MB
2. **리사이즈**: 최대 변 1024px, 비율 유지, 확대 없음
3. **최적화**: JPEG q82 재인코딩 (투명도 있는 PNG는 PNG 유지 —
   webp/gif도 JPEG로 정규화되어 Provider 호환성 확보)
4. **EXIF 제거**: Orientation을 실제 픽셀 회전으로 반영한 뒤 메타데이터
   없이 재인코딩 — 위치정보 등 개인정보가 외부 API로 나가지 않음
5. **용량 제한**: 전처리 후에도 5MB 초과면 거부

구조 (기존 Port/Adapter 원칙 그대로):
- **core**: `ImageGuardPolicy`(기본값 선언) + `ImagePreprocessor` Port +
  순수 검증 — `LlmVisionProvider`가 첨부 직전에 검증→전처리 호출
- **apps/api**: `SharpImagePreprocessor` (sharp 어댑터 — 의존성 추가)
- **실패 처리 설계**: 위반 이미지(`ImageGuardError`)는 **분석을 막지 않고
  스킵** — `raw.skippedImages`에 id·사유 기록 후 나머지로 계속.
  스토리지 오류 등 인프라 실패는 그대로 전파되어 기존 재시도 → null 폴백
  유지 (0505 구조 불변)
- **정책 환경변수화** (0505 승인 ① 결과 동일 패턴): `VISION_IMAGE_MAX_SOURCE_BYTES` ·
  `VISION_IMAGE_MAX_DIMENSION` · `VISION_IMAGE_MAX_OUTPUT_BYTES`
- DB·API 계약 변경 없음. 문서: vision.md에 Image Guard 섹션, README/.env.example 갱신

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 6 | 0601 Execution · 0602 Dashboard · 0603 OpenAI 연결 | 승인 |
| Sprint 6 | **TASK-0604 — Image Guard & Preprocessing** | **완료 (`6c00dfb`) — 승인 대기** |
| Sprint 1~5 | Foundation ~ AI Execution | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 115 · **검증 3 + Vision 통합 3** | 121 | ✅ |
| `apps/api` | Service+API — 기존 146 · **sharp 전처리 6** | 152 | ✅ |
| **합계** | | **273** | **전체 통과** |

신규 테스트가 검증하는 것:
- 검증: MIME 거부·빈 파일·원본 용량 초과·통과
- Vision 통합: 전처리된 바이트가 첨부됨, 위반 이미지 스킵 + raw.skippedImages
  기록 + 분석 계속, **인프라 오류는 스킵하지 않고 전파**(null 폴백 경로 보존)
- sharp 어댑터(실제 sharp로 이미지 생성·검증): 2000×1500→1024×768 비율 축소,
  확대 없음, **EXIF Orientation 6 → 픽셀 회전(400×200→200×400) 후 EXIF 완전
  제거**, 투명 PNG 유지, 출력 용량 초과 거부, 손상 파일 → ImageGuardError

라이브 검증:
- 조립 실행 → 가드 경유 후 visionSummary 정상 생성 (경로 무파괴 확인)
- 실제 전처리 데모(운영 코드 직접 실행): **3000×2000 EXIF(Orientation 6)
  JPEG 36KB → 683×1024 · EXIF 없음 · 4.4KB** (회전 반영+축소+최적화+제거 동시 확인)
- 거부 데모: `application/pdf` 형식 거부 · 원본 용량 제한 초과 거부

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — Vision 입력 앞의 가드 계층**:

```
getBytes() → 검증(core 순수) → SharpImagePreprocessor(리사이즈·최적화·EXIF 제거·용량)
                │ ImageGuardError → 해당 이미지 스킵 (분석 계속, 사유 기록)
                ▼
          base64 첨부 → LLM Gateway (멀티모달)
```

① 실제 Provider 연결 전 필수 가드(0505 승인 ④) 이행 — 실키 투입 시
대형 원본/EXIF 개인정보가 외부 API로 나가지 않고, 토큰·전송 비용이
예측 가능해짐. ② 실패 등급 구분: 콘텐츠 위반(스킵) vs 인프라 오류(폴백) —
기존 graceful degradation 불변. ③ 정책은 core 선언 + 환경변수 조정 —
가격표와 같은 Code-first 패턴.

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Advisory 검증 · Execution 6항 결정

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 16건(변경 없음), drift 없음, 신규 의존성 sharp(apps/api)

## 6. 데이터 모델

(TASK-0604는 스키마 변경 없음 — 전처리는 호출 경로 내에서만 수행, 저장물 원본은 불변)

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 전체 | **변경 없음** — 조립(POST /projects/:id/product-object) 내부에서 가드가 적용될 뿐 계약 동일 |

웹: 변경 없음

## 8. 리스크·기술 부채

1. **0604 해석 미확인** — 기본값(1024px/20MB/5MB/JPEG q82)·위반 시 스킵
   동작·업로드 원본 무변경 방침 (CTO_REQUEST #25)
2. **업로드 경로는 별도** — 업로드(TASK-0201)의 10MB/MIME 검증은 기존 유지,
   저장 원본은 전처리하지 않음(호출 시점 전처리) — 저장 시점 최적화가
   필요하면 별도 스펙
3. **sharp 네이티브 의존성** — 배포 환경 아키텍처별 바이너리 확인 필요
   (현 환경 linux-x64 정상)
4. **실키 스모크 테스트** — CTO 결정대로 운영/스테이징에서 수행 대기
   (이제 이미지 가드까지 갖춰져 Vision 실호출 준비 완료)
5. **Dashboard 화면(다음 Sprint)·일별 시계열(Sprint 6 후반)** — CTO 일정 대기

## 9. 다음 권장 사항 (Sprint 6 후속 후보)

1. **CTO_REQUEST #25 확인** — TASK-0604 해석 확인 및 다음 지시
2. **일별 시계열 집계** — CTO 예고(Sprint 6 후반) 항목
3. **실키 스모크 테스트(운영/스테이징)** — health→생성→분석→Vision(이미지
   가드 포함)→/executions/stats 비용 확인
4. **Anthropic/Gemini 공식 연결** — OpenAI 5항목 패턴 재적용
5. **저장 시점 이미지 최적화** — 업로드 파이프라인에 가드 재사용 (스펙 필요)
