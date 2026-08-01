# 설치·마이그레이션 안내 (v1.0)

> v1.0은 **첫 정식 릴리스**입니다. 그래서 이 문서의 대부분은 "올리는 법"이
> 아니라 **"처음 세우는 법"** 입니다. 0.x에서 올라오는 경우는 §4에 있습니다.

---

## 0. 먼저 읽을 것

이 안내를 따라가면 서비스가 뜹니다. **뜬다는 것과 운영해도 된다는 것은
다릅니다** — 출시 판단은 `reports/CTO_RELEASE_REPORT.md`에 있습니다.

---

## 1. 필요한 것

| 구성 요소 | 최소 | 없으면 |
| --- | --- | --- |
| Node.js | 22 | 기동 불가 |
| pnpm | 10.33 | 빌드 불가 |
| PostgreSQL | 16 | 기동 불가 |
| 오브젝트 저장소 (S3 호환) | — | 이미지 업로드 불가 |
| Redis | — | **단일 인스턴스 모드** (인스턴스를 늘리면 점검이 중복 실행됨) |
| AI Provider 자격 증명 | — | mock으로만 동작 (**실제 결과가 아닙니다**) |

---

## 2. 환경 변수

**설정의 단일 원천은 `packages/core/src/ops/env-spec.ts`의 `ENV_SPECS`**
입니다. 검증·대시보드·배포 체크리스트가 전부 그 선언에서 나옵니다.

- 지금 설정 상태를 보려면: `GET /ops/config` 또는 `/admin/ops`
- 저장소 뿌리의 `.env.example`은 **자주 쓰는 것만** 담고 있습니다.
  전체 목록은 위 선언과 화면에서 보세요.

### 운영에서 반드시 있어야 하는 것

없으면 **API가 기동하지 않습니다**(개발에서는 경고만 하고 뜹니다).

```
WEB_URL                 CORS 허용 출처 (실제 도메인)
DATABASE_URL            postgresql://…
S3_ENDPOINT             운영 표준은 Amazon S3
S3_BUCKET  S3_ACCESS_KEY  S3_SECRET_KEY
AUTH_ADMIN_EMAIL        초기 관리자
AUTH_ADMIN_PASSWORD     초기 관리자 비밀번호 (12자 이상 권장)
BACKUP_DIR              컨테이너 밖 볼륨을 가리켜야 함
```

> `AUTH_ADMIN_PASSWORD`를 비워 두면 운영에서는 **기동이 멈춥니다.**
> 기본 비밀번호로 조용히 뜨지 않습니다.

### 꼭 확인할 것

| 변수 | 안 하면 |
| --- | --- |
| `LLM_DAILY_BUDGET_USD` | **비용 상한이 없습니다** |
| `AUTH_COOKIE_SECURE` | 운영·스테이징은 **자동 활성**입니다. HTTP로만 서비스하면 `0`을 **명시**하세요 |
| `ALERT_WEBHOOK_URL` 등 | 경보가 로그에만 남습니다 |
| `BACKUP_RESTORE_DB_URL` | 복원해 보지 않은 백업은 백업이 아닙니다. **운영 DB를 절대 지정하지 마세요** (덮어씁니다 — 같은 값이면 기동을 막습니다) |
| `REDIS_URL` | 인스턴스를 늘리면 점검이 중복 실행됩니다 |
| `TZ` | 새벽 백업이 생각한 시각과 다르게 돕니다 |

---

## 3. 처음 세우기

```bash
pnpm install --frozen-lockfile
pnpm build

# 스키마 적용 — 운영에서는 반드시 deploy (dev는 스키마를 지울 수 있습니다)
pnpm --filter api exec prisma migrate deploy

node apps/api/dist/main.js        # API
pnpm --filter web start            # 웹
```

기동하면 사용자가 하나도 없을 때만 관리자 1명이 만들어집니다
(`AUTH_ADMIN_EMAIL` / `AUTH_ADMIN_PASSWORD`). **첫 로그인 후 비밀번호를
바꾸세요.**

### 뜬 뒤 확인

```bash
curl -s localhost:4000/health                 # 살아 있는가
curl -s localhost:4000/ops/readiness          # 배포해도 되는가 (ADMIN)
pnpm cutover                                  # 운영 전환이 끝났는가
pnpm validation:preflight                     # 검증을 시작해도 되는가
```

`pnpm cutover`가 **exit 1**이면 아직 전환이 끝나지 않은 것입니다. 무엇이
남았는지 한 줄씩 출력합니다.

---

## 4. 0.x에서 올라오는 경우

v1.0까지의 마이그레이션은 **전부 누적 적용**됩니다. 건너뛸 수 있는 것은
없습니다.

```bash
pnpm --filter api exec prisma migrate deploy
```

### 올리기 전에

1. **백업을 뜨고 복원해 보세요.** 복원해 보지 않은 백업은 백업이 아닙니다.
2. `pnpm check:major-migrations`로 Major Migration 지정이 어긋나지 않았는지
   봅니다.

### Major Migration 2건

아래 둘은 **복구 리허설을 요구**합니다(결정 1901-①). 적용되면 리허설
요구가 자동 등록되며, 리허설 없이 넘어가면 운영 활성화 판정이 막힙니다.

```
20260729180000_operational_readiness
20260729210000_enterprise_backup
```

### 되돌리기

**자동 롤백은 없습니다.** 마이그레이션은 앞으로만 갑니다. 문제가 생기면
**백업에서 복원**하는 것이 유일한 경로이며, 그 절차는
`docs/operations/recovery-guide.md`에 있습니다.

> 되돌리는 법이 안 적힌 단계는 사고가 났을 때 지어내게 됩니다. 그래서
> 여기에 적습니다: **이 시스템의 되돌리기는 복원입니다.**

---

## 5. 데이터에 관한 약속

- **비용 기록은 수정하지 않습니다** (Append Only). 단가가 바뀌어도 과거를
  다시 계산하지 않습니다 — 그때 유효했던 단가로 검증합니다.
- **경보·콘텐츠는 삭제하지 않고 보관합니다.**
- 마이그레이션 57건 중 파괴적 변경은 Major 2건뿐이며, 나머지는 컬럼·테이블
  추가입니다.

---

## 6. 막혔을 때

| 증상 | 먼저 볼 곳 |
| --- | --- |
| API가 안 뜬다 | 기동 로그의 `환경 오류 [이름]` 줄 |
| 로그인이 안 된다 (운영) | `AUTH_COOKIE_SECURE` — HTTPS가 아니면 쿠키가 안 실립니다 |
| 이미지가 안 올라간다 | `S3_*` · 버킷 존재 여부 |
| AI 호출이 429 | 예산 상한 (`LLM_DAILY_BUDGET_USD`) |
| 점검이 안 돈다 | `OPS_SCHEDULED_CHECKS` · 감시 경보 |

자세한 대응은 `OPERATIONS_RUNBOOK.md`.
