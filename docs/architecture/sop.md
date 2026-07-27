# SOP & Workflow Engine (TASK-0305)

CTO 리뷰 반영 구조 — **SOP는 실행 엔진이 아니라 회사의 표준 업무 절차를
저장하는 도메인**이며, 실행은 별도의 Execution Layer가 담당합니다.

```
Company Brain
 └── SOP (표준 업무 절차 정의)          packages/core/src/sop/
Execution Layer
 └── Workflow Engine (SOP 실행)        packages/core/src/workflow/
```

도메인 로직은 모두 `@acos/core`에 있으며 프레임워크·인프라에 의존하지 않습니다.

## 설계 원칙

1. **정의(Company Brain)와 실행(Execution Layer)의 분리** —
   `SopDefinition`은 "무엇을 어떤 순서로"만 선언한다. 각 단계를 실제로
   어떻게 수행하는지는 실행 시점에 WorkflowEngine에 주입되는
   `WorkflowStepExecutor`가 결정한다 (Port/Adapter와 같은 결).
2. **기존 기능 재사용** — 기본 SOP의 단계 실행자는 기존 서비스
   (OcrService / ProductObjectService / ContentsService)를 그대로 호출한다.
   SOP 도입으로 새 파이프라인 로직이 생기지 않는다.
3. **이력 보존** — 실행 1회 = `SopRun` 레코드 1건 (Project : SopRun = 1:N).
   단계별 상태·출력·오류·시각이 JSON으로 저장된다.

## 구조

```
[Company Brain]                    [Execution Layer]
SopDefinition                      WorkflowEngine
 ├─ key: "product-content"          ├─ run(projectId)
 ├─ name, description               │   단계별: PENDING → RUNNING → DONE | FAILED
 └─ steps: SopStepDefinition[]      │   실패 시 이후 단계는 SKIPPED
     └─ { key, name }               │   출력은 outputs[stepKey]로 다음 단계에 전달
                                    └─ executors: Record<stepKey, WorkflowStepExecutor>
```

- `WorkflowStepExecutor = (context: { projectId, outputs }) => Promise<unknown>`
- 반환값은 해당 단계의 `output`으로 기록되고 `outputs`에 누적된다.
- 예외를 던지면 해당 단계 `FAILED`(+메시지), 이후 단계 전부 `SKIPPED`,
  실행 전체는 `FAILED`.
- 생성 시점 검증: 단계 key 중복·실행자 누락은 즉시 오류.

## 기본 SOP — `product-content`

업로드된 이미지에서 상세페이지까지의 기존 파이프라인을 하나의 절차로 선언합니다.

| # | key | 단계 | 실행자 (기존 서비스 재사용) |
| --- | --- | --- | --- |
| 1 | `ocr` | OCR 실행 | 프로젝트 전체 이미지에 `OcrService.runOcr` (이력 1:N 누적) |
| 2 | `assemble` | Product Object 조립 | `ProductObjectService.buildAndCreate` → 새 버전 |
| 3 | `ready` | READY 검수 | `ProductObjectService.updateStatus(…, "READY")` — 필수 조건 검증 포함 |
| 4 | `content` | 상세페이지 생성 | `ContentsService.generate` — 2단계에서 만든 버전 지정 |

- 단계 간 연결: `assemble`의 출력(`version`)을 `ready`/`content`가 사용한다.
- 개별 이미지의 OCR 실패는 FAILED **결과 레코드**로 남을 뿐 절차를 멈추지 않는다
  (OcrExecutionService가 재시도 후 FAILED로 기록하고 정상 반환하기 때문).
  반면 READY 검수 실패(필수 조건 미충족)는 단계 FAILED → 이후 SKIPPED로 이어진다.

## 실행 이력 — `SopRun`

```
Project ──< SopRun
             ├─ sopKey: "product-content"   (어떤 SOP를 실행했는가)
             ├─ status: RUNNING → DONE | FAILED
             ├─ steps: Json (SopStepResultDto[] — 단계별 상태/출력/오류/시각)
             └─ startedAt / completedAt
```

실행 요청 시 `RUNNING` 레코드를 먼저 만들고, 엔진 완료 후 결과로 갱신합니다.

## API (`apps/api/src/sop/`)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects/:projectId/sop-runs` | 기본 SOP 실행 → 실행 이력 반환 (실패해도 201 + `status: FAILED` 이력) |
| `GET` | `/projects/:projectId/sop-runs` | 실행 이력 목록 (최신순) |
| `GET` | `/projects/:projectId/sop-runs/:runId` | 실행 단건 조회 |

오류: `404` 프로젝트/실행 없음. 단계 실패는 HTTP 오류가 아니라
**이력의 FAILED 상태**로 표현됩니다 (부분 실패도 관찰 가능해야 하므로).

## 새 SOP 추가 방법

1. `SopDefinition`을 선언한다 (단계 key/name 목록) — Company Brain에 절차가 쌓인다.
2. 각 단계의 `WorkflowStepExecutor`를 기존 서비스 호출로 작성한다.
3. `new WorkflowEngine(definition, executors).run(projectId)`.

여러 SOP를 노출하려면 API에서 `sopKey`로 정의를 선택하도록 확장하면 됩니다
(현재는 기본 SOP 1개만 노출 — 스펙 없는 확장은 하지 않음).
