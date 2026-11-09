# 사내 ERP 신규 프로젝트 — 기반 이식 계획

> 2026-11-09 작성. 결정된 사항과 **실측으로 확인한 사실**만 적습니다.
>
> 상세페이지 제작 기능은 폐기하고, 서버·도메인·운영 환경과 **기반
> 모듈**을 신규 ERP 프로젝트로 이식합니다.

---

## 0. 결정된 것

| | 결정 |
| --- | --- |
| 신규 프로젝트 | **웹 기반 사내용 ERP** (이카운트 ERP류) |
| 방식 | **B — 새 저장소 + 기반 모듈 이식** |
| 인프라 | **t3.medium + RDS 분리** (ERP 성격상 권장안 채택) |
| 폐기 전 스냅샷 | **완료** — `infrastructure/production/FINAL_SNAPSHOT.md` |
| AI 기능 | **사용 예정** → `llm`·`pricing` 이식 대상 |

### 왜 B(새 저장소)인가

현 운영이 살아 있는 상태에서 같은 저장소를 비우면, 폐기 작업과 배포가
엉켜 서비스가 내려갈 수 있습니다. 또 **실패해도 원본이 그대로 남습니다.**
기반 모듈의 경계가 깨끗해(§2) 이식 비용이 작습니다.

---

## 1. 폐기 위험 평가 — 낮습니다

스냅샷 시점(2026-11-09) 실측:

```
사용자 2명 · 활성 세션 0 · 최근 30일 활동 0건
마지막 로그인 2026-09-07 (2개월 전)
상세페이지 생성물 0건 · 생성 이력 0건
DB 84MB · 이미지 151개
```

**운영에 올라가 있었지만 실사용자가 없습니다.** 잃을 데이터가 사실상
없고, 그마저 스냅샷으로 보존했습니다(복원까지 검증).

---

## 2. 기반 모듈 — 경계가 깨끗합니다 (실측)

기반 모듈이 폐기 대상을 참조하는지 전수 확인한 결과:

| 모듈 | 폐기 대상 참조 |
| --- | --- |
| `reliability` · `auth` · `execution` | **없음** |
| `ops` · `llm` | `ocr/ocr-pricing` **1곳뿐** |

그 1곳은 OCR **기능**이 아니라 **비용 단가 데이터**(`OcrUnitPrice` ·
`DEFAULT_OCR_PRICING`)입니다. ERP에서 AI를 쓰기로 했으므로 **그대로
가져갑니다.** 즉 **기반 이식에 끊어야 할 의존이 없습니다.**

---

## 3. 이식 대상

### 가져가는 것 — `packages/core/src`

| 모듈 | 파일 수 | ERP에서의 쓰임 |
| --- | --- | --- |
| `ops` | 59 | 배포 준비도·백업·복구·경보·KPI·진단 — **ERP에 필수** |
| `llm` | 12 | Provider 추상화·라우팅·Failover·예산 |
| `reliability` | 7 | 체크포인트·이어하기 → **마감 처리·대량 전표** |
| `execution` | 9 | 실행 기록·비용 귀속 → **감사 추적** |
| `auth` | 5 | 역할·세션·잠금 → **ERP 권한 관리의 출발점** |
| `ocr/ocr-pricing` | 1 | 단가표(위 §2) |
| `knowledge` `memory` `decision` `sop` `project-memory` | — | 범용 지식 저장소 — ERP 사내 규정·SOP에 그대로 |
| `workflow` | — | 순차 단계 엔진 → **전표 승인 흐름의 기초** |
| `admin` | — | 설정 판정 |

### 가져가는 것 — `apps/api/src`

```
auth  ops  reliability  llm  execution  pricing
storage  prisma  common  health
company-brain  knowledge  memory  decisions  sop  project-memories  admin
```

### 가져가는 것 — 그 외

```
infrastructure/production/*     ← 이번에 백업한 운영 설정 (그대로 재사용)
docs/operations/*               ← 19종 운영 문서
docs/MASTER_GUIDE.md            ← 철학·원칙
docs/PROJECT_MEMORY.md          ← 교훈 M-1~M-95 (같은 실수를 반복하지 않기 위해)
ai-continuity/*                 ← AI 인수인계 체계 10종
.github/workflows/ci.yml        ← 품질 게이트
scripts/check-*.mjs             ← 게이트 검사
eslint.config.mjs  turbo.json  pnpm-workspace.yaml
packages/shared  packages/ui
```

### 버리는 것

```
core:  product-profile(58) · level1 · image-gen · design-review ·
       content-generation · content · content-governance · product-object ·
       analysis · ocr(단가표 제외) · vision · prompt · ready-validation
api:   product-profile · product-research · level1* · image-gen ·
       design-review · contents · content-governance · product-object ·
       analysis · ocr · products · projects · prompt · ready-validation
web:   product-profile · image-studio · level1* · level2-generate ·
       benchmark · t1150-benchmark-compare · design-review · upload ·
       products · projects
DB:    ProductProfile · DesignReview · Level1*(7) · Content*(3) · Image ·
       OcrResult · AnalysisResult · ProductObject · Pricing* 중 상세페이지용
```

### 판단을 보류한 것

| | 이유 |
| --- | --- |
| `Project` · `Product` 모델 | 비용 귀속 단위라 `ops`·`llm`·`execution`이 의존합니다. **ERP 도메인 설계 후** 결정 — 이름만 남기고 뜻을 바꿀지, 새로 만들지 |
| `experiments` · `routing` 화면 | AI를 쓰므로 유지 후보. ERP 운영자에게 필요한 화면인지는 별개 |

---

## 4. DB는 새로 시작합니다

마이그레이션 75건은 상세페이지 도메인의 역사입니다. **ERP에 들고 갈 이유가
없습니다.**

```
신규 저장소에서 prisma/migrations 를 비우고 ERP 스키마로 1번부터 시작
기반 모듈이 쓰는 테이블(User·AuthSession·Execution·JobRun·Alert·
BackupRun·OpsEvent 등 약 25개)만 초기 마이그레이션에 포함
```

이것이 RDS 분리(§5)와 맞물립니다 — **새 DB를 RDS에 만들고 현 컨테이너
DB는 폐기 때까지 그대로 둡니다.**

---

## 5. 인프라 — 사람이 콘솔에서 해야 하는 작업

**제가 실행할 수 없음을 실측으로 확인했습니다.** 운영 호스트의 IAM
사용자(`detail-generator`)는 **S3 전용**입니다:

```
ec2:DescribeInstances   → UnauthorizedOperation
rds:DescribeDBInstances → AccessDenied
```

따라서 아래는 **콘솔 또는 관리자 권한 자격 증명**이 필요합니다.

| 순서 | 작업 | 주의 |
| --- | --- | --- |
| 1 | **인스턴스 타입 변경** t3.small → t3.medium | 중지→변경→시작. **Elastic IP라 IP는 유지됩니다**(실측 확인) |
| 2 | **RDS PostgreSQL 16 생성** | 같은 VPC·서브넷. 자동 백업·다중 AZ 여부 결정 |
| 3 | RDS 보안그룹에 EC2로부터의 5432 인바운드 허용 | EC2 보안그룹을 소스로 지정 |
| 4 | 신규 `DATABASE_URL`을 `acos-secrets`에 배치 | 기존 컨테이너 DB는 건드리지 않음 |
| 5 | (선택) `BACKUP_OFFSITE=on` + 수명주기 규칙 | **ERP 데이터가 올라간 뒤에는 필수** |

### 비용이 늘어납니다 — 결정 전에 확인하십시오

| | 현재 | 변경 후 |
| --- | --- | --- |
| EC2 | t3.small | t3.medium (**약 2배**) |
| DB | 컨테이너(추가 비용 0) | **RDS 신규 과금** |
| S3 | 저장분만 | 복제 켜면 월 약 35GB 증가 |

다중 AZ RDS는 비용이 다시 2배가 됩니다. **사내 ERP의 중단 허용 시간**에
따라 정하시면 됩니다.

---

## 6. 진행 순서

```
① 스냅샷                                    ✅ 완료
② 운영 설정 백업                            ✅ 완료
③ 이 계획 확정                              ← 지금
④ 새 저장소 생성 + 기반 이식                  Claude 수행 가능
⑤ ERP 도메인 설계 (회계 무결성이 핵심)         설계 결정 필요
⑥ 인프라 변경 (t3.medium · RDS)              사람 수행 (§5)
⑦ 신규를 별도 포트/서브도메인에 먼저 배포       현 운영 유지
⑧ 검증 후 전환, 구 프로젝트 정리              마지막
```

**⑦이 중요합니다** — 현 운영을 먼저 지우지 않습니다. 실사용자가 없어
급할 이유가 없고, 신규가 실제로 도는 것을 확인한 뒤 치우는 것이 안전합니다.

---

## 7. ERP가 이 기반에서 **얻지 못하는** 것

정직하게 적습니다. 기반은 좋지만 **ERP의 핵심은 새로 설계해야 합니다.**

| 필요한 것 | 현 기반에 | 비고 |
| --- | --- | --- |
| 복식부기 무결성 (차변=대변) | **없음** | ERP의 심장. 새로 설계 |
| 전표 승인 흐름 | `workflow`가 기초만 | 승인 단계·반송·권한 분리 |
| 회계 마감·이월 | **없음** | 마감 후 수정 금지 규칙 |
| 세금계산서·전자신고 | **없음** | 국세청 연동 |
| 재고 평가 (선입선출 등) | **없음** | |
| 다중 사용자 동시 편집 | 미검증 | 두 인스턴스 실경쟁 미확인 |
| 권한 체계 | 역할 3종뿐 | ERP는 메뉴·전표 단위 권한이 필요 |

**→ 기반은 "운영과 안정성"을 주고, "회계 정확성"은 새로 만들어야 합니다.**

---

## 8. 이 계획이 확인하지 않은 것

- **ERP 요구사항을 아직 듣지 못했습니다.** §3의 "판단 보류"와 §7은
  요구사항이 정해지면 다시 봐야 합니다.
- RDS·t3.medium의 **실제 월 비용을 계산하지 않았습니다**(권한 없음).
- `infrastructure/production/README.md` §8의 복구 절차를 **실제로 밟아 본
  적이 없습니다.**
