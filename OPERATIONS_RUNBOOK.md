# 운영 런북 (v1.0)

> 당직 중에 읽는 문서입니다. **급할 때 필요한 것만** 앞에 두고, 배경은
> `docs/operations/`로 넘깁니다.

---

## 0. 30초 안에 상태 보기

```bash
curl -s $API/health                    # 살아 있는가 (인증 불필요)
curl -s $API/ops/overview     -b jar   # 지금 운영이 어떤 상태인가 (ADMIN)
curl -s $API/ops/readiness    -b jar   # 배포해도 되는가
```

화면이면 **`/admin/overview`** 한 곳입니다 — Validation · Attribution ·
Notification · Recovery를 모아 보여 줍니다.

> 이 화면은 **다른 판정을 인용만** 합니다. 여기서 새로 판정하지 않습니다 —
> 같은 사실에 두 개의 답이 생기면 둘 다 못 믿게 되기 때문입니다.

### 화면이 "확실하지 않음"이라고 할 때

**정상이라는 뜻이 아니고, 고장이라는 뜻도 아닙니다.** 둘 중 하나입니다:

- **못 읽음** — 판정을 부르지 못했다 → **고칠 버그**
- **판정 유보** — 읽었는데 표본이 모자라다 → **기다리거나 트래픽이 필요**

화면이 이 둘을 갈라서 말합니다.

---

## 1. 자주 나는 일

### AI 호출이 429로 막힌다

**예산 상한입니다.** 기다린다고 열리지 않습니다.

```bash
curl -s $API/llm/budget -b jar     # 오늘/이번 달 지출과 상한
```

- 정말 더 써야 하면 `LLM_DAILY_BUDGET_USD`를 올리고 재기동합니다.
- **재시도하지 마세요** — 막힌 상태에서 재시도는 돈이 나가는 호출을
  반복하지 않지만, 사람의 시간을 씁니다.

### Provider가 죽었다

```bash
curl -s $API/llm/monitoring -b jar   # Provider별 성공률·지연
curl -s $API/llm/health     -b jar
```

- Failover 우선순위(`LLM_FAILOVER_PRIORITY`)가 있으면 자동으로 넘어갑니다.
- **표본이 5건 미만이면 판정하지 않습니다** — "unknown"은 장애가 아닙니다.

### 묶음 작업이 멈췄다

```bash
curl -s $API/jobs -b jar                       # 최근 작업
curl -s $API/jobs/$ID -b jar                   # 계측·로그
curl -s -X POST $API/jobs/$ID/resume -b jar    # 이어하기
```

화면은 **`/admin/jobs`**.

- `이어할 수 있습니다`가 붙어 있으면 눌러도 됩니다 — **끝난 단계는 다시
  사지 않습니다.**
- `이어해도 같은 결과가 나오는 실패입니다`면 **원인을 먼저 고치세요.**
- `서버가 멈춤`(interrupted)은 **실패가 아니라 "끝났는지 모른다"** 입니다.

### 서버가 죽어서 작업이 남았다

`JOB_AUTO_RESUME=on`이면 큐가 알아서 되살립니다(기본은 **꺼짐**).
꺼져 있으면 사람이 이어해야 합니다.

```bash
curl -s $API/jobs/queue/status -b jar          # 켜졌는가 (조회는 아무것도 안 함)
curl -s -X POST $API/jobs/queue/sweep -b jar   # 지금 한 번 훑기
```

큐가 **하지 않는 것**을 기억하세요: 살아 있는 작업 · 다시 해도 같은 실패 ·
모르는 실패 · 자동 2회를 넘긴 것 · 하루 지난 것.

### 경보가 안 온다

```bash
curl -s $API/ops/notifications/health -b jar        # 최근 24시간 도달
curl -s -X POST $API/ops/notifications/test -b jar  # 시험 발송
```

- `silent`은 **"죽었다"가 아니라 "24시간 안에 보낼 일이 없었다"** 입니다.
  확실히 하려면 시험 발송을 누르세요.
- 못 나간 경보는 재전송 대상입니다: `GET/POST /ops/notifications/resend`
  (**조회는 아무것도 보내지 않습니다**).

### 예약 점검이 멈췄다

감시(`OPS_SCHEDULER_WATCHDOG`)가 경보를 냅니다. 껐다면 아무도 모릅니다.

```bash
curl -s $API/ops/diagnostics -b jar   # checks[] 의 scheduler 항목
curl -s -X POST $API/ops/checks/run -b jar   # 지금 한 번 돌리기
```

---

## 2. 백업과 복구

### 지금 안전한가

```bash
curl -s $API/ops/readiness -b jar     # backup·restore·enterprise 블록에 다 있습니다
curl -s $API/ops/drills    -b jar     # 복구 리허설 이력
curl -s $API/ops/drills/requirements -b jar   # 아직 안 한 리허설 요구
```

> `readiness`의 `backup`은 마지막 백업과 신선도, `restore`는 복원 검증
> 결과, `enterprise.objectives`가 RPO/RTO입니다. **한 응답 안에 있습니다** —
> 백업만 따로 보는 주소는 없습니다.

- **복원해 보지 않은 백업은 백업이 아닙니다** — `BACKUP_RESTORE_DB_URL`이
  설정돼 있어야 복원 검증이 돕니다.
- 백업 버킷은 이미지 버킷과 **달라야** 합니다. 같으면 한 버킷이 사라질 때
  둘 다 사라집니다.

### 복원해야 한다

절차는 `docs/operations/recovery-guide.md`에 있습니다. 핵심 두 가지:

1. **복원 대상 DB를 확인하세요.** `BACKUP_RESTORE_DB_URL`이 운영 DB와
   같으면 검증이 곧 사고입니다 — 그 설정은 기동을 막습니다.
2. **이 시스템의 되돌리기는 복원입니다.** 마이그레이션 롤백은 없습니다.

---

## 3. 배포

```bash
pnpm build
pnpm --filter api exec prisma migrate deploy
node apps/api/dist/main.js
```

기동 시 환경 검증이 돌고, **운영에서 오류가 있으면 뜨지 않습니다.**
로그의 `환경 오류 [이름]` 줄이 무엇을 고쳐야 하는지 말합니다.

배포 전 확인:

```bash
pnpm cutover                  # 운영 전환이 끝났는가 (exit 1이면 안 끝남)
pnpm validation:preflight     # 검증을 시작해도 되는가
curl -s $API/ops/runbook -b jar
```

**Major Migration**이 포함되면 복구 리허설이 요구됩니다 — 리허설 없이
넘어가면 운영 활성화 판정이 막힙니다. 강제로 여는 방법은 없습니다.

---

## 4. 인스턴스를 늘릴 때

- `REDIS_URL`을 **반드시** 설정하세요. 없으면 단일 인스턴스 모드이고,
  인스턴스가 둘이면 예약 점검이 **중복 실행**됩니다.
- 지금 어느 모드인지는 `GET /ops/readiness`의 `redis` 블록에 나옵니다
  (`configured: false`면 단일 인스턴스 모드입니다).
- **주의**: 다중 인스턴스 동작은 v1.0에서 **실제로 확인되지 않았습니다**
  (`KNOWN_LIMITATIONS.md` H-2). 늘리기 전에 확인하세요.

---

## 5. 비용

```bash
curl -s $API/ops/cost-forecast   -b jar   # 월말 예측
curl -s $API/llm/cost-verification -b jar # 기록과 가격표 대조
curl -s $API/llm/pricing-health  -b jar   # 단가의 나이 · 가격표에 없는 모델
```

- **미산정 호출이 있으면 지출 합계는 최소값입니다.** 그 모델을 등록하기
  전까지 예산 상한도 그만큼 비어 있습니다.
- 단가 변경은 **제안 → 검토 → 승인 → 적용** 4단계입니다. 감지는 제안까지만
  만들고 적용은 사람이 합니다.

---

## 6. 사람을 불러야 하는 때

| 상황 | 왜 |
| --- | --- |
| 자동 이어하기가 **포기**한 작업이 있다 | 자동이 그만둔 것은 아무도 모르면 안 됩니다 |
| 같은 경보가 **재전송 3회**를 다 썼다 | 조용히 그만두면 없는 일이 됩니다 |
| 복구 리허설 기한이 지났다 | 리허설 없는 복구 계획은 계획이 아닙니다 |
| 가격 공지를 24시간 넘게 못 읽는다 | 단가가 바뀌어도 모릅니다 |
| Redis 장애가 30분 넘게 이어진다 | 중복 실행이 계속됩니다 |

---

## 7. 하지 말아야 할 것

- **모르는 것을 통과로 처리하지 마세요.** 판정 불가는 실패가 아니지만
  성공도 아닙니다.
- **CI가 초록이라고 라이브 검증이 끝난 것이 아닙니다.** CI의
  `live-checks`는 **배선이 맞는가**를 증명합니다.
- **스텁을 상대로 성공한 기록을 "연결됨"으로 세지 마세요.** 판정이 그것을
  막고 있지만, 사람이 화면을 읽을 때도 같은 기준이어야 합니다.
- **막힌 게이트를 강제로 열지 마세요.** 여는 길은 없고, 있으면 그것이
  게이트가 아닙니다.

---

## 함께 보는 문서

| 주제 | 문서 |
| --- | --- |
| 작업 신뢰성 | `docs/operations/job-reliability.md` · `reliability-expansion.md` |
| 비용 거버넌스 | `docs/operations/ai-cost-governance.md` |
| 백업·복구 | `docs/operations/backup-strategy.md` · `recovery-guide.md` · `disaster-recovery.md` |
| 운영 전환 | `docs/operations/production-cutover.md` · `production-activation-runbook.md` |
| 배포 | `docs/operations/deployment-checklist.md` |
| 콘텐츠 거버넌스 | `docs/operations/content-governance.md` |
