# Release 준비 상태 (`v1.0.0-rc.1` → `v1.0.0`)

> CTO 승인: 정식 v1.0 **미승인** · `v1.0.0-rc.1` **승인** · Code Freeze 유지.
>
> 이 문서는 **정식 `v1.0.0` 태그를 붙이기 위해 남은 것**만 추적합니다.
> 판단 근거는 `reports/CTO_RELEASE_REPORT.md`에 있습니다.

마지막 실측: 2026-08-01 (TASK-4901)

---

## 한 줄 요약

**다섯 중 둘이 끝났습니다.** 끝난 둘은 우리가 할 수 있는 것이었고, 남은
셋은 **사람이 자격 증명과 계정을 줘야** 시작됩니다.

| | 항목 | 상태 | 막고 있는 것 |
| --- | --- | --- | --- |
| ① | Provider Validation 준비 | **막힘** | 자격 증명 · 검증 환경 · 호스트 목록 |
| ② | Production Validation 수행 | **막힘** | ①이 끝나야 시작됩니다 |
| ③ | Amazon S3 전환 | **막힘** | 유효한 AWS 계정 |
| ④ | Backup Restore Test | **완료** | — |
| ⑤ | Recovery Drill | **완료** | — |

---

## ④ Backup Restore Test — 완료

절차를 끝까지 밟았고, **API 응답을 믿지 않고 대상 DB를 직접 확인**했습니다.

| 단계 | 결과 |
| --- | --- |
| 백업 | 265,771바이트 · 269항목 · 265ms · 체크섬 확인 · 무결성 통과 |
| 복원 | 별도 DB `acos_restore_4901`로 49테이블 · 1,352ms |
| 대조 | `users` 9건 = 운영 9건 |
| 스키마 | `prisma migrate status` — 57건 up to date |

`/ops/readiness`의 `restore`가 `ok`("복원 검증 통과 — 테이블 49개 확인")로
바뀌었습니다.

**부수 확인 — 안전장치가 실제로 작동합니다.** `DATABASE_URL`을 복원 대상과
같게 두고 띄워 보니 기동이 거부됐습니다:

```
환경 오류 [BACKUP_RESTORE_DB_URL] 복원 대상이 운영 데이터베이스와 같습니다 —
복원은 대상을 지우고 쓰므로 검증이 곧 사고가 됩니다.
```

문서에만 있던 규칙(결정 1601-②)이 **코드에서 실제로 막는 것**을 봤습니다.

---

## ⑤ Recovery Drill — 완료

`docs/operations/recovery-guide.md` 2절 절차를 끝까지 수행했습니다. 여기서
그치지 않고 **복원본으로 애플리케이션을 실제로 띄웠습니다** — 복원이
"파일이 돌아왔다"가 아니라 **"서비스가 돌아왔다"** 인지 확인하려면 그래야
합니다.

| 확인 | 결과 |
| --- | --- |
| `/health` | 200 |
| ADMIN 로그인 | 성공 (같은 계정 · 같은 id) |
| `/projects` 조회 | 실제 데이터 반환 |
| 총 소요 | 약 103초 |

`db-major-change` 리허설 요구가 해소됐습니다
(`satisfiedAt: 2026-08-01T03:21:45Z`).

**이 리허설이 증명하지 않는 것**(기록에 그대로 남겼습니다):

- 개발 호스트에서 했습니다 — **운영 호스트의 RTO는 여전히 모릅니다.**
- 원격 복제(`BACKUP_OFFSITE`)가 꺼져 있어 **호스트가 사라지는 시나리오는
  검증하지 못했습니다.**

---

## ① Provider Validation 준비 — 막힘

`pnpm validation:preflight` → **준비 4/11 단계**, 막는 것 3가지.

**사람이 줘야 하는 넷** (열두 스프린트째):

| | 필요한 것 | 없으면 |
| --- | --- | --- |
| 1 | 실 Provider 자격 증명 | 스텁만 부릅니다 |
| 2 | 네트워크 허용 목록 | 공식 주소에 닿지 못합니다 |
| 3 | 검증용 환경 | 어디에 돌릴지 정해지지 않습니다 |
| 4 | 운영 호스트 목록 | 무엇이 운영인지 판정할 수 없습니다 |

**코드는 준비돼 있습니다.** TASK-4501에서 실행기를 만들어 두었고, 넷이 오는
순간 `POST /ops/validation-run/execute` 하나로 시작됩니다.

---

## ② Production Validation 수행 — 막힘

`POST /ops/validation-run/execute` → **403**. `validation_runs`는 여전히
**0건**입니다.

거절 사유는 셋이며, 전부 ①에서 옵니다: 검증 대상 미정 · 사람이 줘야 하는
단계 3건 · 앞 단계에 막힌 단계 4건.

> **강제로 여는 방법은 없습니다.** 준비되지 않은 채 돌리면 스텁을 상대로
> 한 성공 기록이 남고, 그 기록은 나중에 실연결의 증거로 읽힙니다.

---

## ③ Amazon S3 전환 — 막힘

전환 절차 자체는 `docs/operations/s3-migration.md`에 있고 코드는 준비돼
있습니다. **막는 것은 계정입니다.**

이 환경에 `AWS_ACCESS_KEY_ID`·`AWS_SECRET_ACCESS_KEY`가 있어 확인해 봤지만,
**유효한 AWS 자격 증명이 아닙니다** — `sts:GetCallerIdentity`가
`InvalidClientTokenId`로 거절했습니다. s3rver용 더미입니다.
(확인은 읽기 전용으로만 했고 **아무것도 만들지 않았습니다.**)

지금 상태로 남는 대가:

- `storage-standard` — **fail**. 운영 저장소가 Amazon S3가 아닙니다.
- `storage-protection` · `backup-bucket-protection` — **manual**. s3rver는
  버전 관리·복제 상태를 알려 주지 않아, 보호 상태가 영영 "사람이 직접
  확인"으로만 남습니다(결정 1801-④).

---

## 지금 운영 판정

| 판정 | 값 |
| --- | --- |
| `/ops/readiness` | pass 13 · fail 2 · warn 1 · manual 3 — `recoverable: false` |
| `pnpm cutover` | 전환 0/4 확인 · 운영 활성화 **1/3** |
| `pnpm validation:preflight` | 준비 4/11 |

TASK-4801 시점과 비교하면 **pass 10 → 13, fail 3 → 2**입니다. 줄어든 fail
하나가 복구 리허설이고, 복원 검증 미구성도 함께 해소됐습니다.

남은 fail 둘:

- **`storage-standard`** — ③이 풀려야 합니다.
- **`backup-chain`** — 최근 24시간에 2/24회, **18.4시간 공백**. 이건
  자격 증명 문제가 아니라 **예약 백업이 도는 호스트가 24시간 살아 있어야**
  해소됩니다. 이 컨테이너는 그 시간을 살지 않습니다.

---

## 정식 `v1.0.0`을 붙이는 조건

1. ① 넷이 준비된다
2. ② `validation_runs`에 **통과 기록이 남는다** (0건이 아니게 된다)
3. ③ 운영 저장소가 Amazon S3가 된다
4. `pnpm cutover`가 **운영 활성화 3/3**을 낸다

넷이 충족되면 `RELEASE_NOTES_v1.0.md`를 정식판으로 고치고 `v1.0.0` 태그를
붙입니다. **그 전까지는 Release Candidate입니다.**
