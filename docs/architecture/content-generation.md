# Content Generation Engine (TASK-0502, Sprint 5 — AI Execution)

READY Product Object와 Company Brain을 컨텍스트로 **LLM Gateway를 통해**
Markdown 상세페이지를 생성하고 **Content로 저장**하는 엔진입니다.
Sprint 5 Goal "AI Execution"의 첫 완결 루프 — 회사 지식이 실제 생성물에
반영됩니다.

```
POST /projects/:id/contents/generate
  │
  ├─ ① READY Product Object 확인 (TASK-0303과 동일 규칙 — READY만 허용)
  ├─ ② Company Brain 조회 (CompanyBrainService)
  │     ├─ 금지어: Memory GLOBAL `banned-words`
  │     └─ 제목 검색(PROJECT 스코프): Knowledge / Decision / Memory
  ├─ ③ 프롬프트 조립 (@acos/core content-generation — 프레임워크 무관)
  │     system: 카피라이터 지침 + Markdown 출력 규칙 + 금지어 지침
  │     user:   상품 정보(속성/OCR/Vision) + 프로젝트 + 회사 지식/결정/설정
  ├─ ④ LLM Gateway 호출 (LlmService — LLM_PROVIDER로 교체, 기본 mock)
  └─ ⑤ Content 저장 (제목 = 첫 `# 헤딩`, 없으면 "<상품명> 상세페이지")
```

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects/:projectId/contents/generate` | **엔진 경로 (TASK-0502)** — `{ productObjectVersion? }`, 미지정 시 최신 READY |
| `POST` | `/projects/:projectId/contents` | 구 mock Generator 경로 (TASK-0303 — 기존 기능 보존, 일원화 여부 CTO 결정 대기) |
| `GET` | `/projects/:projectId/contents`(+`/:contentId`) | 목록/단건 — 두 경로의 생성물이 같은 Content로 저장됨 |

오류: `404` 프로젝트/버전 없음, `400` READY 아님·READY 없음·잘못된 버전.

## Company Brain 반영 규칙

| 소스 | 조회 | 프롬프트 반영 |
| --- | --- | --- |
| Memory (GLOBAL `banned-words`) | 키 조회 | system 지침: "다음 금지어는 절대 사용하지 않는다: …" |
| Knowledge | 상품 제목 검색 | "회사 지식 — 반드시 준수" 섹션 (RULE/GUIDE/BRAND …) |
| Decision | 상품 제목 검색 (프로젝트 필터) | "관련 결정" 섹션 (제목+근거) |
| Memory (PROJECT) | 상품 제목 검색 | "관련 설정" 섹션 (key/value/설명) |

컨텍스트가 비어 있어도 생성은 성립합니다 (해당 섹션 생략).

## 원칙·경계

- **LLM Gateway 경유**: Provider는 `LLM_PROVIDER`로 교체(기본 mock — 실제 API
  미호출). 실모델 전환은 키 설정만으로 가능 (docs/architecture/llm.md)
- **READY만 입력**: 검수를 통과한 Product Object만 생성 입력이 된다
- **호출 이력·비용 비저장**: CTO 결정 — 별도 Execution 도메인으로 분리 예정
- Content 모델 변경 없음 — 생성 경로와 무관하게 같은 Content 테이블에 저장
