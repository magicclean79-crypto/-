# READY Validation Engine (TASK-0404, Sprint 4 — Company Brain Integration)

**CompanyBrainService로 Knowledge/Memory/Decision/SOP를 읽어** Product Object의
READY 전환 가능 여부를 판단합니다. Sprint 4 Goal("AI가 Company Brain을 실제
사용")의 첫 실사용처 — Company Brain이 **검수 판단의 근거**로 소비됩니다.

## 판정 3단계 (CTO 지시)

| 판정 | 의미 |
| --- | --- |
| `PASS` | 모든 검사 통과 — READY 전환 권장 |
| `WARNING` | 전환은 가능하나 검토 필요 (규칙 미설정·관련 규칙 존재 등) |
| `FAIL` | 전환 불가 사유 존재 (전이 불가·필수 조건 미충족·금지어) |

전체 판정 = 개별 검사 중 **최악 값** (FAIL > WARNING > PASS).

## 검사 목록 (6종)

| # | key | 근거 소스 | 판정 규칙 |
| --- | --- | --- | --- |
| 1 | `transition` | 도메인(TASK-0302) | 현재 상태에서 READY 전이 가능? 불가 → **FAIL** |
| 2 | `requirements` | 도메인(TASK-0302) | 제목 + OCR/Vision 요약 충족? 미충족 → **FAIL** |
| 3 | `banned-words` | **Memory** (GLOBAL, key=`banned-words`) | 제목·브랜드·카테고리·OCR 텍스트에서 금지어 발견 → **FAIL** · 목록 미설정 → **WARNING**(건너뜀 안내) |
| 4 | `knowledge-rules` | **Knowledge** (RULE/LEGAL) | 제목 검색으로 관련 규칙 발견 → **WARNING**(검토 필요 목록) |
| 5 | `decisions` | **Decision** (프로젝트 필터) | 관련 결정 참고 목록 — 정보성, 항상 **PASS** |
| 6 | `sop` | **SOP** | 표준 절차(product-content) 정의 존재? 부재 → **WARNING** |

- 금지어 목록 설정: `POST /memory` → `{ "scope": "GLOBAL", "key": "banned-words", "value": ["최고", "1위", ...] }`
- 판정 로직은 `@acos/core ready-validation`(프레임워크 무관), Company Brain
  읽기는 API 계층이 `CompanyBrainService.query()` 3회 호출로 수행
  (banned-words → 제목 검색(PROJECT 스코프) → product-content SOP 확인).

## API

### `POST /projects/:projectId/ready-validation` (200)

요청: `{ "productObjectVersion": 3 }` — 미지정 시 **최신 버전** 검증.

응답:

```json
{
  "projectId": "…", "productObjectId": "…", "productObjectVersion": 3,
  "status": "PASS | WARNING | FAIL",
  "checks": [ { "key": "banned-words", "name": "금지어 검사 (Memory)",
                "status": "FAIL", "messages": ["금지어 발견: 1위"] }, … ],
  "validatedAt": "2026-07-27T…"
}
```

오류: `404` 프로젝트/버전 없음, `400` 잘못된 버전.

## 경계 (스펙 준수)

- **판단만 한다** — 실제 READY 전이는 기존 `PATCH …/product-object/:version/status`가
  담당하며, 검증 결과는 전이에 강제되지 않는다 (강제 여부는 CTO 결정 대기).
- 검증 결과는 저장하지 않는다 (이력화는 스펙 없음).
- SopRun(실행 이력)은 Company Brain이 아니므로 판단 근거에 포함하지 않는다 (CTO 결정).
