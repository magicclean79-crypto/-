# RELEASE_CHECKLIST — 정식 `v1.0.0` 출시 점검표

> TASK-5001, Sprint 50 (마지막 Sprint) · 실측일 2026-08-01
>
> **사람이 준비해야 하는 항목은 이 표로만 관리합니다.** 자동으로 우회하거나
> mock으로 대체하지 않습니다 (CTO 지시 2).

---

## 한 장 요약

| | 항목 | 상태 | 누가 |
| --- | --- | --- | --- |
| 1 | Provider Credential | ❌ **없음** | 사람 |
| 2 | Network Allowlist | ⚠️ **부분** — OpenAI만 안 닿음 | 사람 |
| 3 | Validation Environment | ❌ **없음** | 사람 |
| 4 | Production Host Inventory | ❌ **미확정** — 미선언 6개 | 사람 |
| 5 | Amazon S3 | ❌ **s3rver** | 사람 |
| 6 | Backup Chain | ❌ **18.4시간 공백** | 운영(호스트) |
| 7 | Recovery Drill | ✅ **완료** | — |

**7개 중 1개 충족.** 나머지 6개는 **전부 코드로 풀리지 않습니다.**

---

## 1. Provider Credential — ❌

**무엇이 필요한가**: `OPENAI_API_KEY` 등 실 Provider 키, 그리고
`LLM_PROVIDER`를 실 Provider로 변경.

**지금**: `LLM_PROVIDER=mock`.

> mock입니다 — 결과는 나오지만 Provider를 부르지 않습니다.
> **이 상태의 성공 기록은 연결의 증거가 아닙니다.**

**이것이 없으면**: 검증을 시작할 수 없고, 지금까지의 모든 초록은 **우리
스텁을 상대로 얻은 것**입니다.

- [ ] 실 Provider 키 발급
- [ ] `LLM_PROVIDER`를 실 Provider로 변경
- [ ] `GOOGLE_VISION_ENDPOINT`를 비워 공식 주소로 되돌리기

---

## 2. Network Allowlist — ⚠️ 부분

공식 주소에 직접 붙어 확인했습니다:

| 주소 | 응답 |
| --- | --- |
| `api.anthropic.com` | 404 (도달) |
| `generativelanguage.googleapis.com` | 404 (도달) |
| `vision.googleapis.com` | 404 (도달) |
| `s3.amazonaws.com` | 307 (도달) |
| **`api.openai.com`** | **연결 실패** |

`404`/`307`은 인증 없이 루트를 친 정상 응답이며 **길이 열려 있다는 뜻**입니다.
`api.openai.com`만 **연결 자체가 되지 않습니다.**

제품 판정(`pnpm cutover`)은 "네트워크 ✓ 공식 주소 1곳에 모두 닿습니다"라고
말하는데, **그 1곳은 Vision입니다.** 판정이 보는 범위가 좁으니 이 표를
같이 보셔야 합니다.

- [ ] `api.openai.com` 허용 (OpenAI를 쓸 경우)
- [ ] 어떤 Provider를 쓸지 확정 → 그 주소만 열어도 됩니다

---

## 3. Validation Environment — ❌

**지금**: 검증 대상이 정해지지 않았습니다.

> 어디에 돌릴지 모르는 채로 시작할 수 없습니다.

**운영 DB에 대고 검증하지 않습니다** — 검증은 실제 호출을 하고 돈을 씁니다.

- [ ] 검증용 환경 확보(운영과 분리)
- [ ] 그 환경의 `DATABASE_URL`·저장소·호스트 확정

---

## 4. Production Host Inventory — ❌

| | 값 |
| --- | --- |
| 선언됨(`PRODUCTION_HOSTS`) | 2개 |
| **쓰이는데 목록에 없음** | **6개** |
| 목록에 있으나 이번에 안 보임 | 1개 |

미선언 6개: `cdn.acos.example` · `api.internal` · `m.acos.example` ·
`v6-notation.acos.example` · `shop.acos.example` · `old.acos.example`

**자동으로 넣지 않습니다.** 넣으면 스테이징까지 운영으로 올라가 정작 검증
대상이 막힙니다. **무엇이 운영인지는 사람만 압니다.**

- [ ] 6개 각각이 운영인지 판정
- [ ] `PRODUCTION_HOSTS` 갱신

---

## 5. Amazon S3 — ❌

**지금**: `S3_ENDPOINT=http://127.0.0.1:9000` (s3rver, 개발 전용).

이 환경의 `AWS_ACCESS_KEY_ID`를 **읽기 전용으로** 확인해 봤으나
`sts:GetCallerIdentity`가 `InvalidClientTokenId`로 거절했습니다 —
**유효한 AWS 계정이 아닙니다.** 아무것도 만들지 않았습니다.

남는 대가:

- `storage-standard` **fail**
- `storage-protection` · `backup-bucket-protection` **manual** — s3rver는
  버전 관리·복제 상태를 조회할 수 없어 **영영 "사람이 직접 확인"으로만**
  남습니다 (결정 1801-④)

- [ ] AWS 계정·자격 증명 발급
- [ ] 이미지 버킷 / **백업 버킷을 따로** 생성 (같으면 한 버킷이 사라질 때 둘 다 사라집니다)
- [ ] `S3_ENDPOINT`를 `https://s3.<region>.amazonaws.com`으로 변경
- [ ] 절차: `docs/operations/s3-migration.md`

---

## 6. Backup Chain — ❌

> 백업 사슬에 **18.4시간 공백**이 있습니다 (최근 24시간에 2/24회).
> 그 구간은 복구할 수 없습니다 — **개별 백업이 모두 성공이어도, 돌지 않은
> 백업은 아무 데도 기록되지 않습니다.**

이건 자격 증명 문제가 아닙니다. **예약 백업이 도는 호스트가 24시간 이상
살아 있어야** 해소됩니다. 이 컨테이너는 그 시간을 살지 않습니다.

원격 복제(`BACKUP_OFFSITE`)도 **꺼져 있습니다** — 백업이 데이터베이스와
같은 곳에만 있어, **그 곳이 사라지면 백업도 함께 사라집니다.**

- [ ] 운영 호스트에서 `OPS_SCHEDULED_CHECKS` 켜기
- [ ] 24시간 이상 돌려 사슬 채우기
- [ ] `BACKUP_OFFSITE` 켜기 + 백업 버킷 지정

---

## 7. Recovery Drill — ✅ 완료

TASK-4901에서 실제로 수행했습니다.

| 확인 | 값 |
| --- | --- |
| 백업 | 265,771바이트 · 269항목 · 체크섬 · 무결성 통과 |
| 복원 | 별도 DB에 49테이블 · 1,352ms |
| 대조 | `users` 9 = 운영 9 |
| 스키마 | 마이그레이션 57건 up to date |
| **복원본으로 기동** | `/health` 200 · ADMIN 로그인 · `/projects` 조회 |

판정: `drill: pass` — 마지막 리허설 0일 전, 다음 예정까지 89일.
RPO 37분(목표 2시간) · RTO 1초(목표 30분) — **둘 다 충족**.

**다만 이 리허설이 증명하지 않는 것**:

- 개발 호스트에서 했습니다 — **운영 호스트의 RTO는 모릅니다.**
- 원격 복제가 꺼져 있어 **호스트가 사라지는 시나리오는 검증하지
  못했습니다.**
- RTO 1초는 **측정된 하한**이며, 장애를 알아차리고 결정하는 시간은
  포함하지 않습니다.

---

## 이 표를 다 채운 뒤에 할 일

```bash
POST /ops/validation-run/execute     # validation_runs 기록이 생겨야 합니다
pnpm cutover                          # 운영 활성화 3/3
git tag -a v1.0.0 ...                 # 그다음이 태그입니다
```

**순서를 바꾸지 않습니다.** 강제로 여는 방법은 없고, 있으면 그것은 게이트가
아닙니다.
