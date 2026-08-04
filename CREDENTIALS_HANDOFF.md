# CREDENTIALS_HANDOFF — 자격 증명을 이 환경에 전달하는 방법

> 2026-08-01 · TASK-5201
>
> 계정 준비는 끝났다고 확인받았습니다(OpenAI 계정 · OpenAI API Key ·
> AWS 계정). **그런데 그 값들이 이 실행 환경에는 아직 도착하지 않았습니다.**
> 이 문서는 **무엇을 · 어디에 · 어떻게** 넣어야 하는지만 적습니다.
>
> 전환 절차 자체는 이미 있습니다 — `docs/operations/s3-migration.md` ·
> `docs/operations/validation-environment.md` ·
> `docs/operations/production-cutover.md`. **이 문서는 그것들을 대체하지
> 않습니다.**

---

## 0. 지금 확인된 사실 (실측)

| 확인 | 결과 |
| --- | --- |
| `OPENAI_API_KEY` 환경변수 | **없음** |
| `apps/api/.env` | `DATABASE_URL` · `S3_*`(s3rver) 5줄뿐 — OpenAI 없음 |
| `AWS_ACCESS_KEY_ID` | **`proxy-in…` (14자)** — 샌드박스 프록시 더미. 실제 AWS 키는 `AKIA`/`ASIA`로 시작하는 20자 |
| `api.openai.com` 연결 | **실패** — `curl exit 56`(연결 재설정) |
| `s3.amazonaws.com` · `sts.amazonaws.com` | 도달(307 · 302) |

**두 가지가 따로 막혀 있습니다**: ① 키가 없음 ② 키가 와도 OpenAI 주소에
닿지 못함. **①만 풀면 ②에서 다시 멈춥니다.**

---

## 1. 절대 하지 말아야 하는 것

- **키를 채팅에 붙여넣지 마십시오.** 대화 기록에 영구히 남습니다.
- **키를 커밋하지 마십시오.** `.gitignore` 15~16행이 `.env`·`.env.*`를
  막고 있음을 확인했지만, 그건 실수 하나를 막을 뿐입니다.
- **키를 이슈·PR·로그에 넣지 마십시오.** 라이브 검사
  `logs-have-no-secrets`가 로그를 보지만, 사후 확인입니다.

---

## 2. OpenAI — 무엇을 넣는가

코드가 실제로 읽는 변수입니다(`packages/core/src/ops/env-spec.ts`).

```bash
LLM_PROVIDER=openai          # 지금은 mock — 이걸 바꾸지 않으면 키를 넣어도 부르지 않습니다
OPENAI_API_KEY=sk-…          # 필수
LLM_DAILY_BUDGET_USD=<금액>   # 권장 — 검증이 실제로 과금됩니다
LLM_TIMEOUT_MS=<ms>          # 선택
```

**`OPENAI_BASE_URL`은 설정하지 마십시오.** 공식 주소가 아니면 운영 전환으로
세지 않습니다(TASK-3401). 프록시를 우회하려고 여기에 다른 주소를 넣으면
`pnpm cutover`가 그 성공을 **전환으로 인정하지 않습니다** — 의도된 동작입니다.

### 넣는 위치 (권장 순서)

1. **환경 설정의 시크릿으로 주입** — 이 실행 환경(Claude Code on the web)의
   환경 변수/시크릿 설정에 넣으십시오. 파일에 쓰지 않는 것이 가장 안전합니다.
2. 그것이 불가능하면 `apps/api/.env`에 한 줄 추가 — 이미 `.gitignore`
   대상입니다.

---

## 3. Amazon S3 — 무엇을 넣는가

버킷 생성·IAM 권한·이관 절차는 `docs/operations/s3-migration.md` §3~§4에
있습니다. **여기서는 값만 적습니다.**

```bash
S3_ENDPOINT=https://s3.<region>.amazonaws.com
S3_BUCKET=<이미지 버킷>
BACKUP_BUCKET=<백업 버킷>        # 이미지 버킷과 반드시 다른 버킷
S3_ACCESS_KEY=<IAM 액세스 키>
S3_SECRET_KEY=<IAM 시크릿 키>
S3_PUBLIC_URL=<CDN 또는 버킷 공개 URL>
BACKUP_OFFSITE=on               # 켜면 호스트가 사라져도 백업이 남습니다
```

**IAM 조회 권한(`s3:GetBucketVersioning` · `s3:GetReplicationConfiguration`)을
빠뜨리지 마십시오.** 전환 후에는 조회 실패가 **배포를 막습니다**(결정
2301-③) — S3는 조회를 지원하므로, 못 읽으면 저장소 한계가 아니라 권한
누락입니다.

---

## 4. 네트워크 — 이것도 열어야 합니다

키를 넣어도 이 환경에서는 `api.openai.com`에 **연결이 되지 않습니다**.

```
api.openai.com → curl exit 56 (연결 재설정)
```

선택지는 둘입니다.

| | 방법 | 비고 |
| --- | --- | --- |
| A | 이 환경의 네트워크 정책에서 `api.openai.com` 허용 | 환경 설정에서 변경 |
| B | 검증을 **다른 환경**에서 수행 | `docs/operations/validation-environment.md` |

**우회하지 않습니다.** 프록시를 가리키는 `OPENAI_BASE_URL`을 넣으면 호출은
성공할 수 있지만, 그 기록은 전환의 증거로 인정되지 않습니다(결정 3501-①).

---

## 5. 넣은 뒤에 저희가 할 일

값이 도착하면 다음을 **순서대로** 수행합니다. 순서를 바꾸지 않습니다.

```bash
# 1. 도착 확인 (값은 출력하지 않습니다)
#    OPENAI_API_KEY 존재 여부 · S3_ENDPOINT가 amazonaws.com인지

# 2. 사전 점검
pnpm validation:preflight        # 준비 11/11 이 되어야 합니다

# 3. 실 Provider 검증
POST /ops/validation-run/execute # validation_runs에 행이 생겨야 합니다

# 4. 전환 판정
pnpm cutover                     # 운영 활성화 3/3

# 5. Go-Live
GET /ops/go-live                 # verdict: ready (8/8)

# 6. 승격
v1.0.0 태그 · Release Notes 확정 · FINAL_RELEASE_REPORT
```

**3번에서 행이 생기지 않으면 4번 이후는 하지 않습니다.**

---

## 6. 남은 항목 (자격 증명과 무관)

| | 항목 | 필요한 것 |
| --- | --- | --- |
| Production Host Inventory | 미선언 6개 판정 | `PRODUCTION_HOSTS`에 넣을지 사람이 결정 |
| Backup Chain | 18.4시간 공백 | 예약 백업이 도는 호스트가 24시간 이상 가동 |

미선언 호스트: `cdn.acos.example` · `api.internal` · `m.acos.example` ·
`v6-notation.acos.example` · `shop.acos.example` · `old.acos.example`

**자동으로 넣지 않습니다** — 넣으면 스테이징까지 운영으로 올라가 정작 검증
대상이 막힙니다.
