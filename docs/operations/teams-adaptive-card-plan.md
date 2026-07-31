# Teams Adaptive Card 전환 계획

> TASK-4601, Sprint 46 — CTO 정책 4601-③
>
> 이 문서는 **무엇을 어떤 순서로 바꾸고, 잘못되면 어떻게 되돌리는지**
> 적습니다. 되돌리는 법이 안 적힌 단계는 사고가 났을 때 그 자리에서
> 지어내게 됩니다(정책 4401-⑤와 같은 규칙).

## 지금 상태

| | |
| --- | --- |
| 보내는 형식 | **MessageCard** (TASK-4501에서 붙임) |
| 바꿀 형식 | **Adaptive Card 1.4**, Workflows(Power Automate) incoming webhook |
| 코드 | **둘 다 있습니다** — `teamsBody()` · `teamsAdaptiveBody()` |
| 기본값 | 아직 MessageCard |
| 바꾸는 법 | `TEAMS_CARD_FORMAT=adaptive` **한 줄** |
| 되돌리는 법 | 그 한 줄을 지우거나 `message-card`로 — 재기동 즉시 |

## 왜 지금 기본값을 바꾸지 않는가

이 저장소는 **실제 Teams 워크스페이스에 붙어 본 적이 없습니다.** 지금까지
Teams로 나간 알림은 전부 우리 수신 스텁이 받았습니다.

기본값을 바꾸면 우리가 확인할 수 없는 형식으로 알림이 나가고, 그 형식이
틀렸다는 사실은 **첫 장애 때** 알게 됩니다. 알림 체계에서 가장 하면 안 되는
종류의 변경입니다 — 알림이 안 가는 것은 조용하기 때문입니다.

특히 위험한 실패 모양이 하나 있습니다:

> **봉투 없이 카드만 보내면 Teams는 200을 돌려주고 아무것도 안 띄웁니다.**

우리 기록에는 `ok: true · status: 200`으로 남습니다. **성공으로 기록되는
실패**이고, 이건 우리가 스프린트마다 경계해 온 바로 그 모양입니다. 그래서
`teamsAdaptiveBody()`는 카드를 `{type: "message", attachments: […]}` 봉투에
담고, 테스트가 그 봉투를 검사합니다.

## 두 형식이 같은 사실을 담는다

형식이 둘이면 **한쪽만 고치는 날**이 오고, 그때 같은 장애에 두 개의 답이
생깁니다. 그래서 담아야 하는 사실을 목록으로 두고(`teamsCardFacts()`)
`teams-card.spec.ts`가 두 형식 모두에 그 사실이 들어 있는지 검사합니다:

심각도 · 제목 · 본문 · 종류 · 키 · 환경 · 시각 · (있으면) 주소.

두 형식 모두 **심각도를 색과 글자 둘 다로** 남깁니다. 색만 쓰면 색을
구분하지 못하는 사람에게는 등급이 없는 알림입니다.

## 전환 절차

되돌릴 수 없는 단계는 없습니다 — 전부 설정 한 줄입니다.

| 순서 | 하는 일 | 누가 | 무엇을 보면 됐는가 | 되돌리는 법 |
| --- | --- | --- | --- | --- |
| 1 | Teams에서 **Workflows** 커넥터로 incoming webhook을 새로 만든다 | 운영자 | 새 URL을 받았다 | 흐름을 삭제한다 |
| 2 | `ALERT_TEAMS_WEBHOOK_URL`을 새 URL로 바꾼다 | 운영자 | `GET /ops/notifications/health`의 `teams`가 `never`로 초기화된다 | 이전 URL로 되돌린다 |
| 3 | `TEAMS_CARD_FORMAT=adaptive` 선언 후 재기동 | 운영자 | 같은 화면의 `teamsFormat`이 `adaptive` | 그 줄을 지우고 재기동 |
| 4 | `POST /ops/notifications/test`를 1회 | 운영자 | **Teams 채널에 카드가 실제로 보인다** | — |
| 5 | 24시간 관측 | 시스템 | `GET /ops/notifications/health`의 `teams`가 `reached` | 3번으로 되돌린다 |

**4번이 이 전환의 전부입니다.** 200을 받았다는 것과 카드가 보인다는 것은
다른 사실이고, 사람이 눈으로 보기 전에는 확인된 것이 아닙니다.

## 확인해야 할 것 (사람만 할 수 있음)

- [ ] 카드가 **실제로 렌더링되는가** — 200은 증거가 아닙니다
- [ ] 한글이 깨지지 않는가
- [ ] `FactSet`이 모바일 Teams에서 잘리지 않는가
- [ ] `Action.OpenUrl` 버튼이 동작하는가
- [ ] 색(`Attention`/`Warning`/`Good`)이 등급과 맞게 보이는가

## 이 계획이 끝나면 지울 것

MessageCard 경로(`teamsBody`)는 **전환이 24시간 관측을 통과할 때까지
남깁니다.** 먼저 지우면 되돌릴 곳이 없어지고, 그러면 3번의 "되돌리는 법"이
거짓이 됩니다.

## 관련 문서

- `docs/operations/validation-environment.md` — 알림 채널 설정
- `config/validation.env.example` — `TEAMS_CARD_FORMAT` · `ALERT_TEAMS_*`
- `reports/CTO_REPORT.md` — 스프린트별 보고
