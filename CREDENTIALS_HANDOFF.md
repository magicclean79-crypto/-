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

> **2026-08-04 갱신 (TASK-5301) · 2026-08-05 재확인 (TASK-5401)** — 실행 환경이
> Linux 컨테이너에서 **Windows 로컬**로 바뀌었습니다. 아래는 현재 환경의 값입니다.

| 확인 | 결과 (2026-08-05) |
| --- | --- |
| `OPENAI_API_KEY` 환경변수 | **없음** |
| `apps/api/.env` | TASK-5301에서 새로 만듦 — `DATABASE_URL` · `BACKUP_RESTORE_DB_URL` · `PORT` · `WEB_URL`뿐. **자격 증명 0건** |
| `AWS_ACCESS_KEY_ID` | **아예 없음** (컨테이너의 더미 `proxy-in…`조차 없음) |
| `api.openai.com` 연결 | ✅ **도달** — `401` + `www-authenticate: Bearer realm="OpenAI API"` |
| `s3.amazonaws.com` · `sts.amazonaws.com` | 도달(307 · 302) |
| `ENV_SPECS` 총 항목 | **96개** (운영 필수 9 · 조건부 필수 4) |
| 운영 기동을 막는 누락 | **7개** (§7 표) |

**막힌 것이 하나로 줄었습니다.** 이전 판의 ②(OpenAI 주소 차단)는 해제됐고,
남은 것은 ①(키가 없음)입니다. **다만 §7-0이 새로 생겼습니다** — 값을 넣을
호스트가 아직 정해지지 않았습니다.

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
| Production Host Inventory | 목록 확정 | `PRODUCTION_HOSTS` — 사람이 결정 (§7-3) |
| Backup Chain | 18.0시간 공백 | 예약 백업이 도는 호스트가 **24시간 연속 가동** |
| KPI 기준선 | 스냅샷 1점 | **UTC 자정 이후** 2점째 — 하루 한 번만 찍힙니다 |

**자동으로 넣지 않습니다** — 넣으면 스테이징까지 운영으로 올라가 정작 검증
대상이 막힙니다.

---

## 7. 체크리스트 — 무엇이 누락됐는가 (2026-08-05 실측)

> 이 표는 **추측이 아니라 코드의 단일 원천**에서 뽑았습니다. `@acos/core`의
> `validateEnvironment`를 `production: true`로 직접 불러 얻은 결과입니다.
> **제품을 production 등급으로 기동하지는 않았습니다** — 등급을 위조하면
> 흔적이 남지 않기 때문입니다.

### 7-0. 먼저 정해야 하는 것 (다른 모든 항목의 전제)

- [ ] **출시를 수행할 호스트의 배포 등급** — `production` 또는 `staging`
      현재 등급은 `development`이고, 이 등급에서는 `pnpm cutover`가 전환을
      **아예 세지 않습니다**(정책 3501-①). 아래 값을 이 로컬 머신에 넣어도
      `v1.0.0`은 붙지 않습니다. **값을 넣을 곳이 먼저 정해져야 합니다.**

### 7-1. 운영 기동을 막는 필수 환경변수 — **7개 누락**

기동 시 환경 검증이 `error`로 잡고, **운영에서는 뜨지 않습니다.**

| | 변수 | 카테고리 | 무엇인가 | 누가 |
| --- | --- | --- | --- | --- |
| 1 | `S3_ENDPOINT` | storage | 이미지 저장소 엔드포인트 — 운영 표준은 Amazon S3 | 사람 |
| 2 | `S3_BUCKET` | storage | 이미지 버킷 이름 | 사람 |
| 3 | `S3_ACCESS_KEY` | storage | 저장소 액세스 키 | 사람 |
| 4 | `S3_SECRET_KEY` | storage | 저장소 시크릿 키 | 사람 |
| 5 | `AUTH_ADMIN_EMAIL` | auth | 초기 관리자 이메일 (부트스트랩) | 사람 |
| 6 | `AUTH_ADMIN_PASSWORD` | auth | 초기 관리자 비밀번호 | 사람 |
| 7 | `BACKUP_DIR` | ops | 백업 파일 디렉터리 — **컨테이너 밖 볼륨**을 가리켜야 함 | 사람 |

이미 설정된 필수 항목 2개: `DATABASE_URL` · `WEB_URL`.

> **`AUTH_ADMIN_*`을 빠뜨리기 쉽습니다.** 개발에서는 기본값
> (`admin@acos.local` / `admin1234`)으로 조용히 부트스트랩되지만, 운영에서는
> 필수이고 **기본 비밀번호가 그대로 운영에 올라가면 그것이 사고입니다.**

### 7-2. 운영 권고 — **9개** (기동은 되지만 대가가 남음)

| | 변수 | 없으면 무엇을 잃는가 | 누가 |
| --- | --- | --- | --- |
| 1 | `LLM_PROVIDER` | mock — Provider를 부르지 않습니다 | 사람 |
| 2 | `OCR_PROVIDER` | mock — 가짜 텍스트로 조립된 상품은 사실이 아닙니다 | 사람 |
| 3 | `LLM_DAILY_BUDGET_USD` | 비용 폭주를 막을 상한이 없습니다 | 사람 |
| 4 | `LLM_FAILOVER_PRIORITY` | 단일 Provider 장애가 곧 서비스 중단 | 사람 |
| 5 | `ALERT_WEBHOOK_URL` | 경보가 로그에만 남아 아무도 모릅니다 | 사람 |
| 6 | `REDIS_URL` | 인스턴스 2개 이상이면 예약 점검 **중복 실행** | 사람 |
| 7 | `BACKUP_OFFSITE` | 호스트가 사라지면 백업도 함께 사라집니다 | 사람 |
| 8 | `TZ` | 새벽 백업·보관이 생각한 시각과 다르게 돕니다 | 사람 |
| 9 | `WEB_URL` | 지금 `localhost` — 실제 도메인이어야 합니다 | 사람 |

> **5번(`ALERT_WEBHOOK_URL`)은 Go-Live 8항목 중 하나**입니다
> ("경보 경로 도달 확인"). 권고가 아니라 **출시 조건**입니다.
> **6번(`REDIS_URL`)은 인스턴스를 1개만 띄운다면 필요 없습니다** — 다만
> 다중 인스턴스 동작은 v1.0에서 검증되지 않았습니다(`KNOWN_LIMITATIONS` H-2).

### 7-3. Production Hosts — 목록이 비어 있습니다

**이 환경에서는 `PRODUCTION_HOSTS`가 비어 있고, 관측된 호스트도 1개
(`127.0.0.1`)뿐입니다.** TASK-5201이 보고한 미선언 6개는 **이전 컨테이너의
트래픽에서 나온 것이고 이 환경에는 없습니다.**

그 6개는 이렇습니다:

| 호스트 | 판단에 도움이 되는 사실 |
| --- | --- |
| `cdn.acos.example` | `.example`은 **RFC 2606 예약 TLD** — 실제로 존재할 수 없는 이름 |
| `m.acos.example` | 같음 |
| `v6-notation.acos.example` | 같음 |
| `shop.acos.example` | 같음 |
| `old.acos.example` | 같음 |
| `api.internal` | 라우팅되지 않는 내부 전용 이름 |

> **여섯 개 전부 문서·시험용 이름입니다.** 실제 운영 도메인이 아닐 가능성이
> 매우 높습니다. 그렇다면 답은 "여섯 개 중 무엇을 넣을까"가 아니라
> **"실제 운영 도메인이 무엇인가"** 입니다.
>
> **저희가 판단하지 않습니다** — 무엇이 운영인지는 사람만 압니다. 다만 위
> 사실은 결정을 쉽게 만듭니다.

- [ ] 실제 운영 도메인 확정 → `PRODUCTION_HOSTS`에 설정
- [ ] `127.0.0.1` 등 사설·로컬 주소는 **넣지 마십시오** — 넣으면 검증 대상
      보호가 모든 로컬 대상을 운영으로 보고 거부합니다 (제품이 직접 경고함)

### 7-4. 시간이 필요한 항목 — 사람도 코드도 줄일 수 없음

| | 항목 | 필요한 것 | 예상 |
| --- | --- | --- | --- |
| 1 | `backup-chain` (18.0시간 공백) | 예약 백업이 도는 호스트가 **24시간 연속 가동** | 24시간 |
| 2 | KPI 기준선 (스냅샷 1점) | 하루 한 번만 찍힘 → **UTC 자정** 경과 | ~17시간 |
| 3 | 비용 귀속률 목표 | 귀속 대상 호출 **20건 이상** — 실 Provider 트래픽 필요 | 자격 증명 이후 |

> 2번은 시도해 봤습니다: `POST /ops/kpi/snapshot` →
> `{"taken":false,"detail":"오늘 스냅샷이 이미 있습니다 — 하루 한 번만
> 찍습니다."}` **제품이 두 번째 점을 만들어 주지 않습니다.** 옳은 동작입니다.
>
> 3번을 mock 호출 20건으로 채우지 않았습니다. 그 숫자는 **스텁을 상대로 얻은
> 초록**이고, 이 저장소가 쉰 스프린트 동안 막아 온 바로 그것입니다.
