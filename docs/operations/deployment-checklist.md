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

마지막 줄을 빠뜨리면 **버전 관리 항목이 영영 `직접 확인`으로 남습니다.**
저장소가 S3인 것과 상태를 읽을 수 있는 것은 다릅니다.

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
| **마이그레이션 적용** | `migrations` | 미적용 0 · 실패 0 |
| 이미지 저장소 접근 | `storage` | 버킷 접근 성공 |
| 관리자 계정 | `admin-user` | ADMIN 존재 |
| 실제 Provider 연결 | `provider` | mock 외 Provider 1개 이상 (운영) |
| **이미지 버킷 준비** | `bucket` | 버킷 존재 (운영) |
| **이미지 버킷 버전 관리** | `versioning` | Versioning 켜짐 (운영) |
| **백업 버킷 준비·분리** | `backup-bucket` | 존재 · 이미지 버킷과 분리 (운영) |
| **재해 복구 판정** | `readiness` | 복구 가능 (운영) |

굵은 항목이 TASK-2301에서 **운영 표준으로 승격**된 것입니다.

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
- **버킷·IAM은 건드리지 않습니다.**

---

## 5. 관련 문서

| 문서 | 내용 |
| --- | --- |
| [production-runbook.md](production-runbook.md) | 배포 실행 절차 |
| [s3-migration.md](s3-migration.md) | Amazon S3 전환 · 프로비저닝 경계 |
| [disaster-recovery.md](disaster-recovery.md) | 백업·복원·재해 복구 판정 |
| [recovery-guide.md](recovery-guide.md) | 장애 대응 순서 |
