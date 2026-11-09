# CTO BRIDGE — 자동 개발·운영 시스템

> **ChatGPT(총괄) ↔ Claude Code(실행자)** 사이의 작업 전달 구조입니다.
>
> 이 폴더는 **공통 시스템**입니다. 어느 프로젝트에서든 그대로 씁니다.
> 프로젝트별 내용(저장소·문서·작업·결과)은 등록 정보와
> `projects/<프로젝트ID>/` 안에만 있습니다.
>
> 특정 프로젝트의 공식 문서 체계(`MASTER_GUIDE` · `AGENTS` · `TASKS` ·
> `DEVELOPMENT_ENVIRONMENT` · `PROJECT_STATE` · `PROJECT_MEMORY` ·
> `RECOVERY_GUIDE`)는 그대로 두고, Bridge는 **작업의 흐름과 상태만**
> 다룹니다.

## 0. 한 줄 지시가 결과가 되기까지

```
사장님 ── 요구사항 한 줄 ──▶ ChatGPT CTO
                                │  createTask (어느 프로젝트인지 지정)
                                ▼
                             Bridge  ── 202 즉시 응답
                                │
                                ▼
                          Claude Code (무인)
                    구현 → 검증 → 오류수정 → 재검증
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
      READY_FOR_REVIEW                        BLOCKED
   사장님이 브라우저에서 확인            사장님 결정이 필요한 것만
```

**사장님은 지시 한 번, 확인 한 번만 합니다.** 그 사이에는 승인 요청이
없습니다. Claude Code가 사장님께 직접 묻는 일은 없습니다 — 정말로 사람의
결정이 필요하면 묻지 않고 **BLOCKED로 남깁니다**(§2).

---

## 1. 계층 구조

```
통신 계층   bridge-server.mjs   HTTP API — 외부(ChatGPT)가 붙는 통로
            bridge-io.mjs       파일 — 복구·대체 수단으로 유지
프로젝트 계층 bridge-projects.mjs 어느 프로젝트를 대상으로 하는지 (등록·격리)
상태 계층   bridge-state.mjs    작업이 어느 단계인지 판정 (파일·네트워크 안 만짐)
실행 계층   bridge-executor.mjs Claude Code를 헤드리스로 실제 호출
화면        bridge-board.mjs    사람이 보는 현황판 (읽기 전용·이 PC 전용)
```

통신 방식이 바뀌어도 **상태 판정과 실행은 그대로**입니다.

## 1-0. 하나의 저장소에 묶여 있지 않다 (2026-08-09)

Bridge는 원래 이 저장소(`acos`) 하나만을 위해 만들어졌습니다. 다음
프로젝트가 시작되면 같은 통(`bridge/tasks`·`bridge/results`)에 섞이는
문제가 있었습니다. 그래서 **공통 시스템**(이 폴더의 `.mjs` 파일들)과
**프로젝트별 데이터**(`bridge/projects/<프로젝트ID>/`)를 나눴습니다.

- 저장소 경로·먼저 읽을 문서·건드리면 안 되는 것·검증 명령이 전부
  **등록 정보에서** 온다. 코드에는 특정 프로젝트 이야기가 들어가지
  않습니다 — 새 프로젝트를 시작할 때 고칠 코드가 없습니다.
- **기존 프로젝트(acos)는 자리를 옮기지 않습니다.** 여전히
  `bridge/tasks`·`bridge/results`·`bridge/STATUS.md`를 그대로 씁니다 —
  동작하는 것을 이유 없이 옮기지 않습니다.
- 새 프로젝트는 `bridge/projects/<ID>/{tasks,results,STATUS.md}`에
  자기만의 자리를 갖습니다. 어느 프로젝트의 작업인지는 **부르는 쪽이
  항상 명시**합니다 — HTTP는 `?project=<ID>` 쿼리, CLI는 `--project <ID>`.
  생략하면 기본 프로젝트(acos)입니다.

**새 프로젝트 등록**

```bash
# CLI
node bridge/bridge-cli.mjs project register <등록JSON파일>
node bridge/bridge-cli.mjs project list
node bridge/bridge-cli.mjs new T-1 "제목" "요청" --project demo-widget

# HTTP
curl -X POST <주소>/projects -H 'Authorization: Bearer <토큰>' -d '{
  "projectId": "demo-widget", "name": "데모 위젯",
  "repoPath": "C:\\...\\demo-widget-repo",
  "docs": ["README.md"], "doNotTouch": ["NOTES.md"],
  "verifyCommands": ["npm run build", "npm test"]
}'
curl <주소>/tasks?project=demo-widget -H 'Authorization: Bearer <토큰>'
```

`repoPath`는 Bridge를 실행 중인 PC에 **실제로 있어야** 합니다 — 없으면
`runNextTask`를 부를 때가 아니라 **등록하는 지금** 거부됩니다.

### 등록 정보에 무엇을 적는가

| 항목 | 뜻 | 없으면 |
| --- | --- | --- |
| `repoPath` | Claude Code가 일할 폴더. **여기 밖은 대상이 아닙니다** | 등록 거부 |
| `docs` | 일 시작 전에 먼저 읽을 문서 | 읽으라고 시키지 않음 |
| `doNotTouch` | 사람 승인 없이 고치면 안 되는 것 | 그 항목이 지시문에서 빠짐 |
| `verifyCommands` | 검증에 **실제로 돌릴 명령** | "등록된 검증 명령 없음"으로 알림 |
| `requiredChecks` | 사람 확인 단계로 올리려면 **반드시 기록돼야 할 검사 이름** | `build·typecheck·lint·tests` |
| `browserUrl` | 사람이 결과를 확인할 주소 | 사람 확인 단계로 올라가지 못함 |
| `scope` | **사장님이 정한 범위.** 이 밖의 결정은 스스로 하지 않음 | 범위 제한 없음 |

`requiredChecks`는 **게이트를 프로젝트에 맞춘 것이지 느슨하게 만든 것이
아닙니다.** 빌드도 타입체크도 없는 저장소에 네 가지를 강요하면 통과할
방법이 없습니다(실측 2026-08-09: 검사만 있는 프로젝트가 `TESTING`에
갇혔습니다). 목록을 비워도 기본 네 가지로 돌아가므로 **게이트를 없앨 수는
없습니다.**

`verifyCommands`는 **그 PC에서 실제로 돌아가는 명령**이어야 합니다. 실측
(2026-08-09): `node --test test/` 를 등록했는데 이 환경의 Node에서는
디렉토리 인자를 해석하지 못해 실패했습니다. 호출된 세션은 그것을 스스로
진단하고 재현 근거와 함께 `preExisting` 에 적은 뒤, **검사 파일과
package.json 을 건드리지 않고** 작업을 마쳤습니다 — 시킨 범위를 넘지 않은
것입니다.

고칠 일이 생기면 `bridge/projects/<ID>/project.json` 을 직접 고칩니다.
기본 프로젝트(`acos`)는 등록 파일이 없어도 동작하며, 값을 바꾸려면
`bridge/projects/acos.json` 을 만들면 됩니다.

## 1-2. 실행은 기다리지 않는다 (2026-08-09)

**요청과 실행을 분리합니다.**

```
POST /run  ──►  202 즉시 응답 (taskId · runId)
                     │
                     └─►  Claude Code가 뒤에서 계속 일한다 (수 분~수십 분)
                              │
GET /tasks/:id  ◄─────────────┘  상태로 진행을 확인한다
```

### 왜 이렇게 바꿨나

`/run`이 작업이 끝날 때까지 응답을 붙잡고 있었습니다. Claude Code 한 번
호출은 수 분에서 수십 분이 걸리고, **Cloudflare는 100초에서 524를
돌려줍니다.** T1-22 실행에서 실제로 났습니다(2026-08-09).

주의할 점이 하나 있었습니다 — **524가 났어도 작업은 계속 돌고 있었습니다.**
끊긴 것은 응답뿐이고 서버는 끝까지 일했습니다. 즉 문제는 "작업이 실패한
것"이 아니라 **"결과를 볼 방법이 없던 것"**이었습니다.

### 무엇이 달라졌나

| | 전 | 후 |
| --- | --- | --- |
| `/run` 응답 | 작업이 끝나야 옴 | **즉시 202** (83ms 실측) |
| 진행 확인 | 없음 | `GET /tasks/:id` · `GET /runs` · 현황판 |
| 실행이 죽으면 | IN_PROGRESS에 영원히 갇힘 | 자동으로 대기열 복귀 |
| 상태 게이트 | | **그대로** — 건너뛰기는 여전히 막힘 |

### 갇힌 작업 풀기

```bash
node bridge/bridge-cli.mjs reset T1-22     # 하나만
curl -X POST <주소>/recover -H 'Authorization: Bearer <토큰>'   # 중단된 것 전부
```

`IN_PROGRESS`(실행 프로세스가 죽음)와 `TESTING`(검증 기록이 게이트를 통과
못 함) 둘 다 여기서 풉니다. `COMPLETED`는 되돌리지 않습니다. 되돌아갈 때도
**허용된 전이를 한 칸씩** 밟습니다 — 게이트를 우회하지 않습니다.

서버가 다시 뜨면 갇힌 작업을 **자동으로** 되돌립니다. Claude Code는 서버의
자식 프로세스라 서버와 함께 죽기 때문입니다.

## 1-2-1. 무인 실행 — 사람이 자리에 없다는 전제

Bridge가 부르는 Claude Code는 **아무도 화면을 보지 않는 동안** 돕니다.
그래서 "물어보면 멈추는" 자리를 전부 없앴습니다.

| 멈출 수 있던 자리 | 어떻게 막는가 |
| --- | --- |
| 권한 승인 창 | `--dangerously-skip-permissions` + `--permission-mode bypassPermissions` |
| **표준입력 대기** | `stdin`을 아예 닫는다(`ignore`) |
| 지시문이 되묻기를 유도 | 프롬프트 첫머리에 "사람은 자리에 없다" 규칙 |
| 끝나지 않는 실행 | 전체 시간 제한(기본 90분) |
| **조용한 정지** | 15분 동안 출력이 없으면 끊고 이유를 기록 |
| 비용 폭주 | `--max-budget-usd`(기본 20) |

`stdin`이 가장 위험했습니다. 열어 둔 채 아무것도 쓰지 않으면 자식이 입력을
한 번이라도 읽으려는 순간 **영원히 멈추는데, 심장박동은 계속 찍혀서 겉으로는
정상으로 보입니다.** 그래서 심장박동과 별도로 **마지막 출력 시각**을
기록합니다 — 살아 있는 것과 일하고 있는 것은 다릅니다.

그러려면 **진행 중에 출력이 나와야** 합니다. `--output-format json` 은 끝날
때까지 아무것도 쓰지 않아서, 무응답 감지가 **정상적인 긴 작업을 죽입니다.**
그래서 `stream-json` 을 씁니다(실측: 첫 출력 6.3초, 이벤트가 계속 흘러나옴).
결과는 마지막 `result` 이벤트에서 꺼내고, JSON이 아닌 줄이 섞여도 그 줄만
건너뜁니다.

한계값은 환경변수로 바꿉니다: `BRIDGE_RUN_TIMEOUT_MS` ·
`BRIDGE_STALL_LIMIT_MS` · `BRIDGE_MAX_BUDGET_USD`.

### 막히면 멈추지 않고 적고 끝낸다

판단이 필요하면 호출된 세션이 **가장 보수적인 쪽을 스스로 고르고** 이유를
결과에 적습니다. 정말 진행할 수 없으면 대기하지 말고 `blockedOn`에 이유를
남기고 끝냅니다 — **답할 사람이 없는 질문으로 끝내지 않습니다.**

### 통과 여부는 글로 짐작하지 않는다

검사 결과는 `{"ok": true, "detail": "..."}` 로 적습니다.

```json
"lint": { "ok": true, "detail": "npx eslint . — 0건 (기존 4건 전부 해소)" }
```

**문장을 읽어 통과 여부를 짐작하면 틀립니다.** 실측으로 두 번 겪었습니다 —
`"12장 생성 · 실패 0"` 과 `"lint 0건(새 오류 없음)"` 이 모두 실패로 잡혀,
통과해야 할 작업이 막혔습니다. `ok` 를 명시하면 짐작할 일이 없습니다.
(옛 기록의 문자열 형태도 그대로 읽습니다.)

`ok` 는 **이번 변경분이 통과했는가**만 뜻합니다. 원래부터 실패하던 것은
`ok` 를 거짓으로 만들지 말고 `preExisting` 에 따로 적습니다. 다만 **"원래
그랬다"고 말하려면 근거를 확인하고 말합니다**(`PROJECT_MEMORY` M-10).
검사를 돌리지 않았다면 `ok` 를 참으로 적지 않고 `blockedOn` 에 이유를
적습니다.

## 1-3. 현황판 — 사람이 보는 곳

```
http://localhost:4201
```

5초마다 새로고침되는 읽기 전용 화면입니다. 무엇이 돌고 있는지, 얼마나
됐는지, 무엇이 사람 확인을 기다리는지 보입니다.

**Bridge 본체(4200)와 다른 포트인 이유**: 4200은 터널로 바깥에 열려
있습니다. cloudflared가 `127.0.0.1:4200`으로 붙기 때문에 "loopback에서
왔는가"로는 안팎을 구분할 수 없습니다 — 터널을 타고 온 요청도 127.0.0.1로
보입니다. 그래서 화면은 **터널이 닿지 않는 포트**에 따로 두고, 거기에는
쓰기 경로를 아예 만들지 않았습니다.

## 1-1. 지금 실제로 되는 것 / 안 되는 것 (2026-08-09 실측)

| | 상태 |
| --- | --- |
| Bridge → **Claude Code 실제 호출** | ✅ **동작함** — 헤드리스 실행 확인 |
| Claude Code → Bridge 결과 반환 | ✅ 동작함 |
| 결과 기반 **연속 작업 실행** | ✅ 동작함 — A → 결과 → B 사용자 개입 없이 |
| 외부 → Bridge HTTP 호출 | ✅ 동작함 — 공개 주소에서 실측 |
| **ChatGPT(웹) → Bridge 직접 호출** | ⏳ **준비 완료 · 사람이 등록해야 함** — §7 참고 |

**Claude Code 실행 파일**은 PATH에 없고 VS Code 확장 안에 있습니다:

```
~/.vscode/extensions/anthropic.claude-code-<버전>-win32-x64/
  resources/native-binary/claude.exe
```

`bridge-executor.mjs`가 최신 버전을 자동으로 찾습니다.
`CLAUDE_CODE_BIN` 환경변수로 직접 지정할 수도 있습니다.

---

## 2. 작업 상태

```
REQUESTED  →  IN_PROGRESS  →  TESTING  →  READY_FOR_REVIEW  →  COMPLETED
                   ↑              │              │
                   └──────────────┴──────────────┘
                     검증 실패·수정 요청 시 되돌아간다

                   │              │
                   └──────┬───────┘
                          ▼
                      BLOCKED          사람의 결정이 반드시 필요할 때만
                          │
                          └──→ REQUESTED   결정이 내려지면 다시 돈다
```

**건너뛸 수 없습니다.** `REQUESTED → READY_FOR_REVIEW` 는 거부됩니다 —
코드를 썼다는 이유로 사람에게 보여 주는 일을 막습니다.

### READY_FOR_REVIEW로 올라가는 조건

아래를 **모두** 기록해야 통과합니다. 하나라도 빠지면 거부됩니다.

- Build · Typecheck · Lint · 단위 검사 결과
- 브라우저 검증 주소
- 사용자가 확인할 항목
- 변경 파일 목록
- 실패한 검사가 **없을 것**

### BLOCKED — 사장님 결정이 필요할 때만

무인 실행의 목적은 **사람 없이 끝까지 가는 것**입니다. 그래서 막히는 것은
쉬운 선택지가 되면 안 됩니다. BLOCKED에는 **무엇을 정해 주면 되는지**를
적어야만 들어올 수 있습니다.

```json
"decisionNeeded": [
  { "question": "무엇을 정해야 하는지",
    "options": ["가능한 선택지"],
    "why": "왜 스스로 정할 수 없는지" }
]
```

`question` 이나 `why` 가 없으면 **BLOCKED로 두지 않습니다** — 이유 없이
멈춘 작업은 아무도 풀 수 없기 때문입니다.

**언제 BLOCKED인가**

| | |
| --- | --- |
| 사장님 지시 범위를 **넘는** 결정이 필요할 때 | BLOCKED |
| 문서에 답이 있는 것 | 스스로 정한다 (BLOCKED 아님) |
| 어느 쪽이든 되는 사소한 선택 | **가장 보수적인 쪽**을 스스로 고르고 이유를 적는다 |
| 무인 실행 중 권한 승인이 필요해 자동 거부된 도구 호출이 있을 때 | BLOCKED (§1-2-1) |

**스스로 정할 수 있는 것을 사람에게 미루는 것도 실패입니다.**

결정이 내려지면 `resetTask` 로 대기열에 되돌리고 다시 실행합니다. 그때
결정 요청 기록은 지워집니다 — 이미 정해진 것을 다시 묻는 것처럼 보이면
안 되기 때문입니다.

---

## 3. 쓰는 법 — HTTP (권장)

```bash
# 서버 실행 (기본 4200, 같은 PC에서만 접근)
node bridge/bridge-server.mjs

# 외부에 열려면 토큰을 반드시 설정한다 (0.0.0.0에 바인딩됨)
BRIDGE_TOKEN=<비밀값> node bridge/bridge-server.mjs
```

| 메서드 | 경로 | 하는 일 |
| --- | --- | --- |
| GET | `/health` | 살아 있는지 |
| GET | `/projects` | 등록된 프로젝트 전부 |
| POST | `/projects` | 새 프로젝트 등록 |
| GET | `/projects/:id` | 프로젝트 하나의 등록 정보 |
| GET | `/tasks` | 작업 목록과 상태 (`?project=<ID>`, 생략 시 기본 프로젝트) |
| GET | `/tasks/:id` | 작업 하나(지시+결과) |
| POST | `/tasks` | 작업 등록 |
| POST | `/tasks/:id/state` | 상태 변경 |
| POST | `/tasks/:id/result` | 결과 기록 |
| POST | `/tasks/:id/reset` | 멈춘 작업을 대기열로 되돌림 |
| **POST** | **`/run`** | **실행을 시작하고 즉시 202로 응답** |
| GET | `/runs` | 지금 돌고 있는 실행 |
| POST | `/recover` | 중단된 실행 전부를 대기열로 되돌림 |
| GET | `/status` | STATUS.md 원문 |

작업 관련 경로는 전부 `?project=<ID>` 쿼리(또는 POST 본문의 `projectId`)를
받습니다. 생략하면 기본 프로젝트(acos)입니다.

`/run` 이 핵심입니다 — **사람이 복사·붙여넣기 하지 않습니다.**

```bash
# 대기열의 첫 작업을 실행
curl -X POST http://127.0.0.1:4200/run -H 'Content-Type: application/json' \
  -d '{"cwd":"<저장소 경로>","browserUrl":"http://localhost:3100/image-studio"}'

# 특정 작업을 지정해 실행
curl -X POST http://127.0.0.1:4200/run -H 'Content-Type: application/json' \
  -d '{"taskId":"T1-27","cwd":"<저장소 경로>"}'
```

**응답이 왔다고 작업이 끝난 것이 아닙니다.** 202는 접수증입니다. 끝났는지는
`GET /tasks/:id` 로 확인합니다.

## 3-1. 쓰는 법 — 파일 (대체 수단)

```bash
# ChatGPT의 작업 지시를 등록
node bridge/bridge-cli.mjs new T1-27 "제목" "요청 내용"

# 상태 이동
node bridge/bridge-cli.mjs state T1-27 IN_PROGRESS

# 작업 결과 기록 (JSON 파일)
node bridge/bridge-cli.mjs result T1-27 결과.json

# 한 작업 자세히 보기
node bridge/bridge-cli.mjs show T1-27

# 현재 상태 요약 갱신 — ChatGPT가 이 파일을 읽는다
node bridge/bridge-cli.mjs status

# 여러 프로젝트를 다룰 때 — 어느 명령이든 --project를 붙이면 그 프로젝트다
node bridge/bridge-cli.mjs project register <등록JSON파일>
node bridge/bridge-cli.mjs project list
node bridge/bridge-cli.mjs project show demo-widget
node bridge/bridge-cli.mjs new D-1 "제목" "요청" --project demo-widget
node bridge/bridge-cli.mjs status --project demo-widget
```

### 검사

```bash
node bridge/bridge-state.spec.mjs      # 상태 게이트
node bridge/bridge-async.spec.mjs      # 비동기 실행 (524 재발 방지)
node bridge/bridge-projects.spec.mjs   # 프로젝트 등록·격리 (2026-08-09)
```

**건너뛰기가 실제로 막히는지**를 검사합니다. 정상 경로만 확인하는 검사는
게이트가 아닙니다.

비동기 검사는 **"실행이 성공하는가"가 아니라 "요청이 실행을 기다리지
않는가"**를 봅니다. 기다리는 순간 524가 다시 납니다. 진짜 작업 폴더를
건드리지 않도록 임시 폴더에 복사해서 돌리고, 요금이 나가지 않도록 Claude가
아닌 무해한 실행 파일을 씁니다.

---

## 4. 파일 배치

```
bridge/
├── README.md               이 문서
├── STATUS.md               자동 생성 — 기본 프로젝트(acos)의 현재 상태
├── openapi.yaml            ChatGPT Actions 연결 명세
├── bridge-state.mjs        상태 계층 (순수 판정)
├── bridge-state.spec.mjs   상태 계층 검사
├── bridge-async.spec.mjs   비동기 실행 검사 (524 재발 방지)
├── bridge-projects.mjs     프로젝트 계층 (등록·격리, 2026-08-09)
├── bridge-projects.spec.mjs 프로젝트 격리 검사
├── bridge-io.mjs           통신 계층 (파일)
├── bridge-server.mjs       HTTP API
├── bridge-executor.mjs     Claude Code 호출 (백그라운드)
├── bridge-board.mjs        현황판 (읽기 전용·4201, 모든 프로젝트를 함께 본다)
├── bridge-cli.mjs          실행 도구
├── start-bridge.ps1        재부팅 후 복구 실행
├── tasks/<작업ID>.json     기본 프로젝트(acos)의 작업 지시 — 옛 자리 그대로
├── results/<작업ID>.json   기본 프로젝트(acos)의 작업 결과 — 옛 자리 그대로
└── projects/<프로젝트ID>/  새로 등록한 프로젝트마다 하나씩
    ├── project.json           등록 정보 (저장소 경로·문서·doNotTouch·검증 명령)
    ├── tasks/<작업ID>.json     그 프로젝트의 작업 지시
    ├── results/<작업ID>.json   그 프로젝트의 작업 결과
    └── STATUS.md               그 프로젝트의 상태 요약
```

**`STATUS.md`는 손으로 고치지 마십시오** — 자동 생성됩니다. **기본
프로젝트(acos)는 자리를 옮기지 않았습니다** — `bridge/tasks`·
`bridge/results`가 여전히 그 프로젝트의 자리입니다.

---

## 5. 작업 결과에 남기는 것

`results/<작업ID>.json` 에 아래를 기록합니다.

| 항목 | 내용 |
| --- | --- |
| `taskId` · `state` | 작업 ID와 현재 상태 |
| `workDone` | 수행한 작업 |
| `changedFiles` | 변경 파일 |
| `testResults` | build · typecheck · lint · tests · 그 외 검증 |
| `errorsAndFixes` | 발생한 오류와 해결 |
| `costIncurred` · `costDetail` | 비용 발생 여부 |
| `actualResult` | 실제 실행 결과 |
| `browserUrl` | 브라우저 검증 주소 |
| `userChecks` | 사용자가 확인할 항목 |
| `blockedOn` | 막혀 있다면 그 이유 |
| `nextTasks` | 다음에 할 일 |

---

## 6. 세션이 바뀌어도 이어가려면

새 세션은 `docs/RECOVERY_GUIDE.md` 순서로 문서 7종을 먼저 읽고, 그다음
아래를 실행합니다.

```bash
node bridge/bridge-cli.mjs status
```

**어떤 작업이 어느 단계인지, 무엇이 사람 확인 대기 중인지** 한 번에
나옵니다. Bridge는 특정 Claude 세션에 종속되지 않습니다.

---

## 7. ChatGPT 연결 — 구축 완료 (2026-08-09)

**cloudflared 터널로 공개 주소가 열려 있고, 외부에서 전체 흐름이 실제로
동작하는 것을 확인했습니다.**

### 왜 cloudflared인가

| | 판단 |
| --- | --- |
| **cloudflared** | **계정 가입 없이 즉시 공개 주소 생성** · 선택함 |
| ngrok | 무료 플랜도 **인증 토큰 등록 필요** — 사람이 가입해야 함 |
| 공유기 포트포워딩 | 집 네트워크가 열림 — 권장 안 함 |
| EC2 경유(`-R`) | **원격 EC2를 건드려야 함** — 금지 범위 |

### 실행

```powershell
powershell -ExecutionPolicy Bypass -File bridge\start-bridge.ps1
```

옛 서버 정리 → 토큰 준비 → Bridge 서버 → 터널 → 공개 주소 출력까지
한 번에 합니다.

### 인증

- 토큰은 `bridge/.secrets/bridge-token.txt` (64자, `.gitignore`로 차단)
- `Authorization: Bearer <토큰>` 없으면 **401**
- 토큰 비교는 **시간 안전 방식** — 반복 측정으로 알아낼 수 없음
- **5회 실패 시 10분 차단**
- `/health` 만 인증 없이 열림 (살아 있는지만 알림, 작업 내용 비공개)

### ChatGPT Actions 설정

1. `bridge/tunnel-url.txt` 의 주소를 `bridge/openapi.yaml` 의
   `servers.url` 에 넣습니다
2. ChatGPT 커스텀 GPT → **Actions** → `openapi.yaml` 붙여넣기
3. **Authentication** 을 아래와 같이 둡니다

| 항목 | 값 |
| --- | --- |
| Authentication Type | **API Key** |
| Auth Type | **Bearer** |
| API Key | `bridge/.secrets/bridge-token.txt` 의 64자 문자열 |

ChatGPT는 이 값을 `Authorization: Bearer <토큰>` 헤더로 붙여 보냅니다.
서버가 요구하는 형식과 같습니다. **토큰은 이 문서·코드·Git 어디에도 적지
않습니다** — 파일에서 직접 복사합니다.

### ChatGPT가 부를 수 있는 것 (명세에 실린 11개)

| operationId | 메서드·경로 | 언제 쓰는가 | 인증 |
| --- | --- | --- | --- |
| `health` | GET `/health` | 살아 있는지만 확인 | **불필요** |
| `listProjects` | GET `/projects` | 등록된 프로젝트 확인 (새 프로젝트를 시작하기 전에) | 필요 |
| `registerProject` | POST `/projects` | 새 프로젝트 등록(저장소 경로·문서·doNotTouch·검증 명령) | 필요 |
| `listTasks` | GET `/tasks?project=<ID>` | **먼저 부른다.** 그 프로젝트의 전체 작업과 상태 | 필요 |
| `createTask` | POST `/tasks?project=<ID>` | 새 작업 지시 (→ REQUESTED) | 필요 |
| `runNextTask` | POST `/run?project=<ID>` | 실행을 **시작**하고 즉시 202. 비용 발생. `taskId`로 지정 가능 | 필요 |
| `getTask` | GET `/tasks/{taskId}?project=<ID>` | **진행·결과 확인.** 실행 뒤 반복해서 부른다 | 필요 |
| `resetTask` | POST `/tasks/{taskId}/reset?project=<ID>` | 멈춘 작업을 대기열로 되돌림 | 필요 |
| `listRuns` | GET `/runs` | 지금 돌고 있는 실행 (모든 프로젝트) | 필요 |
| `recoverRuns` | POST `/recover` | 중단된 실행 전부 되돌림 | 필요 |
| `getStatus` | GET `/status` | 사람이 읽는 요약(마크다운) | 필요 |

**ChatGPT가 반드시 지켜야 할 것**: `runNextTask` 의 202 응답은 **접수증이지
결과가 아닙니다.** 그것만 보고 "완료됐다"고 말하면 안 됩니다. 잠시 뒤
`getTask` 를 불러 상태가 `READY_FOR_REVIEW` 인지 확인한 다음에 보고합니다.

`/health` 만 인증 없이 열려 있습니다 — 살아 있는지만 알려 주고 작업 내용은
내보내지 않습니다. 나머지는 토큰 없이 부르면 **401**, 5회 틀리면 **10분
차단**입니다.

상태 변경(`/tasks/:id/state`)과 결과 기록(`/tasks/:id/result`)은 서버에는
있지만 **명세에 싣지 않았습니다.** ChatGPT가 실행을 건너뛰고 상태만 올리는
길을 막기 위해서입니다.

### 연결 검증 절차 (ChatGPT → Bridge → Claude Code → 결과 → ChatGPT)

등록 직후 아래 순서로 확인합니다. **1단계가 안 되면 그 아래는 볼 필요가
없습니다** — 주소나 토큰 문제입니다.

| 단계 | ChatGPT에 입력 | 통과 기준 |
| --- | --- | --- |
| 1 | `브릿지 살아 있어?` | `health` 호출 → `ok: true` |
| 2 | **`현재 작업 목록 보여줘`** | `listTasks` 호출 → **T1-21 ~ T1-26 여섯 건**이 상태와 함께 나옴 |
| 3 | `T1-27 이라는 작업을 만들어줘. 제목은 …, 내용은 …` | `createTask` → 201, 다시 2를 하면 T1-27이 REQUESTED로 보임 |
| 4 | `다음 작업 실행해줘` | `runNextTask` → **몇 초 안에** 202. 상태가 IN_PROGRESS (**비용 발생**) |
| 5 | (몇 분 뒤) `T1-27 진행 상황 알려줘` | `getTask` → 아직 IN_PROGRESS면 계속 도는 중 |
| 6 | (끝난 뒤) `T1-27 결과 알려줘` | 상태 READY_FOR_REVIEW · `workDone`·`changedFiles`·`testResults` 가 채워져 있음 |

4단계에서 **오래 기다리다 오류가 나면 안 됩니다.** 응답이 몇 초 안에
돌아오지 않으면 비동기 구조가 동작하지 않는 것입니다.

2단계에서 나와야 하는 여섯 건:

```
T1-21  제품 자동 분석 (Product Recognition Engine)
T1-22  제품 자동 조사
T1-23  교차 검증
T1-24  Product Profile 생성
T1-25  Product Package 생성
T1-26  Gemini 전달
```

`needsHumanDecision: true` 인 작업이 있으면 ChatGPT는 다음 작업을 밀어
넣지 않고 **사람에게 알려야** 합니다 — 브라우저에서 눈으로 확인할 것이
남아 있다는 뜻입니다.

### 연결이 안 될 때

| 증상 | 원인 | 할 일 |
| --- | --- | --- |
| 전부 실패 · 응답 없음 | 터널 주소가 바뀜 | `bridge/tunnel-url.txt` 확인 → 명세 `servers.url` 갱신 → Actions 재등록 |
| 401 | 토큰 불일치 | Actions의 API Key를 토큰 파일 값으로 다시 넣기 |
| 429 | 5회 실패로 차단됨 | 10분 기다리거나 Bridge 서버 재시작 |
| Actions 저장이 안 됨 | 명세 문법 오류 | `bridge/openapi.yaml` 을 다시 붙여넣기 |
| `schemas subsection is not an object` | `components` 안에 `schemas` 가 없음 | 응답 구조를 `components/schemas` 로 옮기고 `$ref` 로 참조 (2026-08-09 해결됨) |
| **524 (timeout)** | 응답을 작업 끝까지 붙잡고 있었음 | **비동기 구조로 해결됨** (2026-08-09). 다시 나면 `/run`이 202로 즉시 돌아오는지 확인 |
| 작업이 IN_PROGRESS에서 안 움직임 | 실행 프로세스가 죽음 | `resetTask` 또는 `recoverRuns`. 서버 재시작 시 자동 복구 |
| 작업이 TESTING에서 멈춤 | 검증 기록이 게이트를 통과 못 함 | `getTask`의 `blockedOn` 을 읽고, 고친 뒤 `resetTask` 로 되돌려 재실행 |

### ⚠️ 임시 터널의 한계

`trycloudflare.com` 주소는 **터널을 다시 띄울 때마다 바뀝니다.** PC를
재부팅하면 새 주소가 나오고, `openapi.yaml` 과 ChatGPT Actions 설정을
함께 갱신해야 합니다.

고정 주소가 필요하면 Cloudflare 계정 + 도메인으로 **Named Tunnel**을 쓰면
됩니다 — 그건 사람이 직접 가입·인증해야 합니다.

## 8. 지켜야 할 것

- **코드를 썼다는 이유로 완료 처리하지 않습니다.** 실제로 동작하는지
  검증하고, 실패하면 원인을 찾아 고치고 다시 검증합니다.
- **중간 진행 상황은 사용자에게 보고하지 않습니다.** 브라우저에서 확인할
  수 있는 상태가 되었을 때만 보고합니다.
- **생성 이미지의 품질은 사람이 판단합니다.** Claude는 "정상이다"·"품질이
  좋다"라고 말하지 않습니다.
- 새 **공식 프로젝트 문서를 임의로 추가하지 않습니다.** 중요한 결정은
  기존 7종 중 알맞은 곳에 적습니다.
