# Production Deployment Checklist (운영 표준, CTO 결정 2201-④)

> **이 체크리스트는 운영 표준입니다.** 운영 배포는 이 절차를 통과한 뒤에만
> 진행합니다.
>
> 문서로만 있는 체크리스트는 지켜졌는지 확인할 방법이 없고, 결국 "확인했다고
> 치는" 절차가 됩니다. 그래서 **기계가 판정합니다** — `GET /health/ready`
> (ADMIN)와 `/admin/health` 화면이 같은 판정을 돌려줍니다.

---

## 0. 누가 무엇을 하는가

**운영에서 애플리케이션은 만들지 않고 검증만 합니다** (CTO 결정 2101-④ ·
2201-①).

| 대상 | 준비 주체 | 애플리케이션 |
| --- | --- | --- |
| 이미지 버킷 · 백업 버킷 | **운영 담당자** | 존재·보호 상태 검증 |
| IAM 권한 | **운영 담당자** | 조회 가능 여부 검증 |
| DB 스키마 (`prisma migrate deploy`) | **운영 담당자** | 적용 여부 검증 |

애플리케이션이 이것들을 만들지 않는 이유는 [s3-migration.md](s3-migration.md)
§2.1에 있습니다. 요약하면 **오타 하나로 아무도 모르는 자원이 생기고, 배포를
되돌릴 때 그것들은 되돌아가지 않기** 때문입니다.

그러니 **배포 전 확인이 절차의 일부**입니다 — 확인하지 않으면 준비되지 않은
채로 뜹니다.

---

## 1. 배포 전 (운영 담당자)

### 1.1 버킷

- [ ] 이미지 버킷이 있는가 (`S3_BUCKET`)
- [ ] 백업 버킷이 있는가 (`BACKUP_BUCKET`, 기본 `<S3_BUCKET>-backups`)
- [ ] **두 버킷이 서로 다른가** (CTO 결정 1701-②) — 같으면 그 버킷이 사라질 때
      이미지와 백업이 함께 사라집니다
- [ ] 백업 버킷에 **공개 읽기 정책이 없는가** — 덤프가 공개되면 데이터베이스
      전체가 공개되는 것과 같습니다

### 1.2 IAM

| 동작 | 필요한 권한 |
| --- | --- |
| 이미지 업로드·조회·정리 | `s3:PutObject` · `s3:GetObject` · `s3:DeleteObject` |
| 버킷 존재 확인 | `s3:ListBucket` |
| 백업 업로드·대조 | `s3:PutObject` · `s3:GetObject` (백업 버킷) |
| **보호 상태 조회** | `s3:GetBucketVersioning` · `s3:GetReplicationConfiguration` |

- [ ] 위 권한이 모두 부여됐는가

마지막 줄은 **Amazon S3 전환 이후 배포 차단 사유입니다** (CTO 결정 2301-③).
S3는 보호 상태 조회를 지원하므로, 읽지 못하는 것은 저장소의 한계가 아니라
`s3:GetBucketVersioning` 권한이 빠졌다는 뜻입니다. 전환 전(MinIO·s3rver 등
조회를 지원하지 않는 개발 저장소)에는 `직접 확인`으로 남습니다.

| 상태 | 전환 전 (`S3_ENDPOINT`가 S3가 아님) | 전환 후 (`*.amazonaws.com`) |
| --- | --- | --- |
| Versioning 켜짐 | 통과 | 통과 |
| Versioning 꺼짐 | 실패 (배포 차단) | 실패 (배포 차단) |
| **조회 실패** | **직접 확인 (막지 않음)** | **실패 (배포 차단)** |

### 1.3 버전 관리

- [ ] 이미지 버킷 Versioning **켜짐** (운영 필수, CTO 결정 1701-③)
- [ ] 백업 버킷 Versioning **켜짐**
- [ ] Replication 설정 (운영 권장)

### 1.4 스키마

- [ ] `pnpm prisma:migrate deploy` 실행
- [ ] 실패·롤백된 마이그레이션이 없는가

**애플리케이션은 스키마를 적용하지 않습니다.** 배포 파이프라인이나 운영자가
직접 실행합니다.

---

## 2. 배포 후 확인 (기계 판정)

```bash
curl https://<api-host>/health/ready -b cookies.txt   # ADMIN
```

또는 `/admin/health` 화면. 아래 항목이 **배포 차단**입니다.

| 항목 | id | 통과 조건 |
| --- | --- | --- |
| 환경변수 검증 | `env` | 필수·형식 오류 0 |
| 데이터베이스 연결 | `database` | 연결 성공 |
| **마이그레이션 적용** | `migrations` | `pendingMigrations` 0 · 실패 0 |
| 이미지 저장소 접근 | `storage` | 버킷 접근 성공 |
| 관리자 계정 | `admin-user` | ADMIN 존재 |
| 실제 Provider 연결 | `provider` | mock 외 Provider 1개 이상 (운영) |
| **이미지 버킷 준비** | `bucket` | 버킷 존재 (운영) |
| **이미지 버킷 버전 관리** | `versioning` | Versioning 켜짐 (운영) |
| **백업 버킷 준비·분리** | `backup-bucket` | 존재 · 이미지 버킷과 분리 (운영) |
| **재해 복구 판정** | `readiness` | 복구 가능 (운영) |

굵은 항목이 TASK-2301에서 **운영 표준으로 승격**된 것입니다.

### `pendingMigrations`의 공식 의미 (CTO 결정 2301-④)

**`prisma/migrations` 디렉터리에는 있고 `_prisma_migrations`에는 완료 기록이
없는 마이그레이션의 개수**입니다. 실패·롤백 건수가 아닙니다.

| 값 | 뜻 | 배포 |
| --- | --- | --- |
| `0` | 코드의 모든 마이그레이션이 적용됨 | 이 항목은 통과 |
| `n` (양수) | **적용하지 않은 것이 n건** — `pending` 배열에 이름이 있습니다 | 차단 |
| `null` | **확인하지 못했습니다** — 디렉터리나 적용 기록 중 하나를 읽지 못함 | `직접 확인` |

`null`을 `0`으로 읽지 마십시오. 화면에는 `확인 불가`로 표시됩니다 — 확인하지
못한 것을 "미적용 없음"으로 세면 `migrate deploy`를 빠뜨린 배포가 통과합니다.

**적용 중 실패한 마이그레이션이 있어도 `pendingMigrations`는 그대로 실제 미적용
개수입니다.** 무엇을 먼저 알릴지(실패 우선)와 무엇이 사실인지는 다릅니다.

### 재해 복구 판정의 단일 원천 (CTO 결정 2301-①)

`readiness` 항목은 판정을 **다시 하지 않습니다** — `/ops/readiness`의
`recoverable`을 그대로 가져다 씁니다. 두 화면이 다른 말을 하면 어느 쪽을
믿어야 할지 알 수 없기 때문입니다.

| `/ops/readiness`의 `recoverable` | `/health/ready`의 `readiness` 항목 |
| --- | --- |
| `true` | 통과 |
| `false` | 실패 (운영 배포 차단) |
| 확인 실패 | `직접 확인` — `/ops/readiness`를 직접 보세요 |

복구 판정이 왜 실패했는지는 **`/ops/readiness`에서만** 봅니다. 배포 체크리스트는
그 결론만 옮깁니다.

배포를 막지 않는 항목:

| 항목 | id | 뜻 |
| --- | --- | --- |
| 저장소 접근 권한 (IAM) | `iam` | 보호 상태를 읽을 수 있는가 — 못 읽어도 지금 서비스는 돕니다 |
| 비용 예산 · Failover | `budget` · `failover` | 운영에서 경고 |
| 실 Provider 스모크 | `smoke` | 배포 직후 사람이 1회 실행 |
| DB 백업·복구 확인 | `backup` | 절차 숙지 |

### 자동 게이트

```bash
API_BASE=https://<api-host> GATE_EMAIL=... GATE_PASSWORD=... \
  node scripts/deployment-gate.mjs
```

| 종료 코드 | 뜻 |
| --- | --- |
| 0 | 배포 가능 |
| 1 | 배포 불가 (차단 항목 존재) |
| **2** | **판정 불가** — 확인하지 못한 것은 통과가 아닙니다 |

운영에서는 `GATE_STRICT`(직접 확인 항목도 차단)와 `GATE_ALERTS`(활성 심각 경보
차단)가 **기본으로 켜집니다** (CTO 결정 1302-③).

### CI 게이트 (TASK-3401, CTO 지시 6)

**게이트는 GitHub Actions에서 초록으로 끝나야 게이트입니다.** 로컬에서만
통과하는 게이트는 게이트가 아닙니다 — 실제로 이 저장소의 CI는 필수 게이트가
워크플로에 다 적힌 상태로 **13회 연속 실패**했습니다(러너에 Playwright
브라우저가 없어 `pnpm test`가 통째로 죽고 있었습니다).

`.github/workflows/ci.yml`이 돌리는 순서 — 이 순서는 테스트로 고정돼 있습니다
(`ci-workflow.spec.ts`).

| 순서 | 게이트 | 왜 이 자리인가 |
| --- | --- | --- |
| 0 | Playwright 브라우저 설치 | `pnpm test`에 web e2e가 들어 있습니다 |
| 1 | `pnpm build` | 아래 교차 검증이 빌드 산출물을 씁니다 |
| 2 | `pnpm check:major-migrations` | 지정이 어긋난 채로 통과시키지 않습니다 (결정 2101-③) |
| 3 | `pnpm check:ci-gates` | **게이트가 게이트를 검증합니다** — 게이트가 사라져도 CI는 초록으로 끝납니다 (TASK-3501) |
| 4 | `pnpm typecheck` | |
| 5 | `pnpm lint` | |
| 6 | `pnpm test` | core · api · web e2e |

**Live Verification은 CI에서 돌리지 않습니다** — 실 자격 증명이 필요하고, 그것을
CI에 넣으면 남의 서비스에 돈이 나가는 테스트가 매 푸시마다 돕니다. 사람이
돌리고 보고서에 남깁니다.

- [ ] 배포 대상 커밋의 CI가 **초록**인지 확인합니다
      (`GET /ops/cutover`의 `ci` 항목이 같은 사실을 판정합니다)

### 운영 전환 검증 (TASK-3401, CTO 지시 4·5·6)

- [ ] `pnpm cutover` — 네 항목(LLM · Vision · S3 · CI)이 모두 `verified`인지
      확인합니다. 하나라도 아니면 `ready`는 false이고, **운영 전환에 부분
      점수는 없습니다.** (종료 코드 0 전환 완료 / 1 미완 / **2 판정 불가**)

`unreachable`은 **자격 증명 이전의 문제**입니다 — 방화벽·프록시가 공식 주소를
막고 있다는 뜻이고, 키를 넣어도 열리지 않습니다.

`not-production`은 "돌고는 있지만 운영의 그것이 아니다"입니다 — 계약 스텁을
상대로 만든 성공 기록은 연결의 증거가 아닙니다. 자세한 것은
[production-cutover.md](production-cutover.md).

---

## 3. 배포 직후 (사람이 하는 것)

- [ ] `node scripts/real-provider-smoke.mjs` — 실 Provider 1회 호출
      (0901 승인 ③). **과금됩니다.**
- [ ] `POST /ops/backup/run` — 배포 후 첫 백업을 남깁니다
- [ ] `POST /ops/backup/verify-remote?count=3` — 원격 사본 대조
      (전송 비용, CTO 결정 2101-①)
- [ ] `/admin/operations`에서 **기동 시 Major Migration 자동 등록** 칸 확인
      (CTO 결정 2001-④) — `확인 불가`면 사유를 보고 직접 등록하세요

### 재해 복구 절차가 바뀐 배포라면

저장소 전환·DR 절차 변경·PITR 도입은 **주기와 무관하게 리허설을 부릅니다**
(CTO 결정 1801-⑤):

```bash
curl -X POST https://<api-host>/ops/drills/require -b cookies.txt \
  -H 'content-type: application/json' \
  -d '{"trigger":"dr-change","description":"<무엇이 바뀌었는지>","registeredBy":"<이름>"}'
```

---

## 4. 되돌리기

- **애플리케이션**: 이전 이미지로 되돌립니다.
- **스키마는 되돌아가지 않습니다.** 그래서 마이그레이션은 **뒤로 호환되게**
  작성합니다(컬럼 추가는 nullable로, 삭제는 다음 배포로 미룹니다).
  되돌린 뒤 `migrations` 항목이 `주의`로 바뀝니다 — "적용됐는데 코드에 없는
  마이그레이션"이 그 상태입니다. 버그가 아니라 **스키마가 코드보다 앞서
  있다는 사실**입니다.
- 그 상태는 **배포를 막지 않습니다** (CTO 결정 2301-②). 막으면 되돌린 배포를
  다시 되돌릴 수 없습니다. 대신 경보로 남습니다:

  | 경과 | 경보 | 해야 할 일 |
  | --- | --- | --- |
  | 최초 관측 | `주의` (`migration-governance:unknown`) | 되돌린 배포라면 그대로 두어도 됩니다 |
  | **7일 초과** | **`심각`** | 되돌린 것이 아니라 **잊은 것**입니다 — 마이그레이션을 코드로 되살리거나 스키마를 정리하세요 |

  경과는 경보의 `firstRaisedAt`으로 셉니다. 경보는 삭제하지 않으므로
  (CTO 결정 1302-④) 그 시각이 곧 "처음 본 때"입니다.
- **버킷·IAM은 건드리지 않습니다.**

---

## 5. 관련 문서

| 문서 | 내용 |
| --- | --- |
| [production-deployment-target.md](production-deployment-target.md) | **지금 실제 배포 대상이 있는가** (T1-208) — 호스트·도메인·인프라 현황 |
| [production-runbook.md](production-runbook.md) | 배포 실행 절차 |
| [production-cutover.md](production-cutover.md) | 운영 전환 검증 (LLM · Vision · S3 · CI) |
| [s3-migration.md](s3-migration.md) | Amazon S3 전환 · 프로비저닝 경계 |
| [disaster-recovery.md](disaster-recovery.md) | 백업·복원·재해 복구 판정 |
| [recovery-guide.md](recovery-guide.md) | 장애 대응 순서 |
