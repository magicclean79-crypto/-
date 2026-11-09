# Production 인프라 백업 (EC2)

> **이 디렉터리는 운영 호스트에만 존재했던 설정을 저장소로 옮겨 둔 것입니다.**
> 2026-11-09 실측. 호스트에서 그대로 읽어 왔고, 손으로 고치지 않았습니다.
>
> 왜 만들었나: 서버·도메인·운영 환경은 **기반으로 계속 쓰기로** 결정됐는데,
> 그 기반의 설정이 **저장소 어디에도 없었습니다**. 호스트가 사라지면 함께
> 사라지는 상태였습니다.

---

## 0. TLS 자동 갱신 — 2026-11-09에 켰습니다

처음 백업할 때 **`certbot-renew.timer`가 `disabled`이고 cron 갱신 작업도
없었습니다.** 인증서는 2026-12-03 만료였으므로, 그대로 두면 그날
`magicclean79.com`과 `api.magicclean79.com`이 TLS 오류로 함께 멈췄을
것입니다.

**조치하고 실제로 확인했습니다:**

```
sudo certbot renew --dry-run        → 3개 도메인 전부 simulated renewal 성공
sudo systemctl enable --now certbot-renew.timer
```

| 확인 | 결과 |
| --- | --- |
| 타이머 | `enabled` · `active` |
| 스케줄 | `*-*-* 00/12:00:00` (하루 2회) · `RandomizedDelaySec=12h` · `Persistent=true` |
| 다음 실행 | 2026-11-09 22:54 UTC |
| 재부팅 생존 | `timers.target.wants/`에 symlink 생성 확인 |
| 갱신 시점 | 만료 30일 전부터 (`renew_before_expiry = 30 days`) |
| dry-run 후 서비스 | 웹 200 · API `/health` 200 (영향 없음) |

**갱신 후 nginx 재적용**은 인증서별 설정의 `installer = nginx`가 처리합니다
(`tls/certbot-renewal-magicclean79.com.conf`). `/etc/sysconfig/certbot`의
훅은 전부 비어 있으나, `--dry-run`이 그 경로까지 포함해 성공했으므로
별도 `DEPLOY_HOOK`을 넣지 않았습니다.

> **확인하는 방법** — 12월 3일 전에 한 번은 눈으로 보십시오.
> ```
> sudo systemctl list-timers certbot-renew.timer
> sudo certbot certificates          # Expiry Date가 뒤로 밀렸는지
> ```

---

## 1. 무엇이 백업돼 있는가

| 파일 | 호스트 원본 |
| --- | --- |
| `nginx/nginx.conf` | `/etc/nginx/nginx.conf` |
| `nginx/conf.d-acos.conf` | `/etc/nginx/conf.d/acos.conf` |
| `systemd/acos-api.service` | `/etc/systemd/system/acos-api.service` |
| `systemd/acos-web.service` | `/etc/systemd/system/acos-web.service` |
| `systemd/acos-prune-backups.service` | 같은 경로 |
| `systemd/acos-prune-backups.timer` | 같은 경로 |
| `scripts/prune-backups.sh` | `/home/ec2-user/prune-backups.sh` |
| `tls/certbot-renewal-magicclean79.com.conf` | `/etc/letsencrypt/renewal/magicclean79.com.conf` |

**비밀값은 하나도 들어 있지 않습니다** — 기계 검사로 확인했습니다(`sk-`·
`AKIA`·`BEGIN PRIVATE KEY`·`password=`·`secret=` 패턴 0건, `.pem` 0건).

### 일부러 가져오지 않은 것

| | 왜 |
| --- | --- |
| `privkey.pem` · `fullchain.pem` | **개인키는 저장소에 두지 않습니다.** 재발급이 가능하므로 백업할 이유도 없습니다 |
| `apps/api/.env` · `apps/web/.env` | 실제 키가 들어 있습니다. **변수 이름만** §5에 적었습니다 |
| `/home/ec2-user/acos-secrets/*` | 비밀값 파일 8개. **파일 이름만** §5에 적었습니다 |

---

## 2. 호스트 사실

| | |
| --- | --- |
| 호스트 | `ec2-3-39-9-111.ap-northeast-2.compute.amazonaws.com` (`3.39.9.111`) |
| 내부 호스트명 | `ip-172-31-47-30.ap-northeast-2.compute.internal` |
| OS | Amazon Linux 2023 |
| 접속 | `ssh -i E:\detail-key.pem ec2-user@3.39.9.111` (키는 탈착식 USB) |
| 도메인 | `magicclean79.com` · `www` · `api` (Cloudflare DNS → A레코드) |

### 가동 중인 서비스 (2026-11-09 확인)

```
acos-api.service    active running     → 127.0.0.1:4000
acos-web.service    active running     → 127.0.0.1:3000
nginx.service       active running     → 80/443
docker.service      active running
acos-postgres       Up 3 months        → 127.0.0.1:5432
```

---

## 3. 요청이 흐르는 길

```
인터넷
  │  443 (TLS, Let's Encrypt ECDSA)
  ▼
nginx  /etc/nginx/conf.d/acos.conf
  ├── magicclean79.com · www      → proxy_pass 127.0.0.1:3000   (Next.js)
  └── api.magicclean79.com        → proxy_pass 127.0.0.1:4000   (NestJS)
       80 → 443 301 리다이렉트 (certbot이 만든 블록)
       /.well-known/acme-challenge/ → /var/www/certbot (갱신용, 유지 필요)
```

프록시가 넘기는 헤더: `Host` · `X-Real-IP` · `X-Forwarded-For` ·
`X-Forwarded-Proto` · `X-Forwarded-Host`.
API가 이 헤더를 신뢰하려면 `TRUSTED_PROXY_IPS`가 설정돼 있어야 합니다(§5).

---

## 4. 데이터베이스

```
컨테이너   acos-postgres   postgres:16-alpine
포트       127.0.0.1:5432  (외부 비공개)
볼륨       acos-pgdata → /var/lib/postgresql/data
재시작     unless-stopped
```

**데이터는 도커 볼륨 `acos-pgdata`에 있습니다.** 컨테이너를 지워도 볼륨이
남지만, **볼륨을 지우면 데이터가 사라집니다.**

백업: `/home/ec2-user/acos-data/backups/*.dump`, 7일 보관
(`acos-prune-backups.timer`, 매일 00:00 UTC).

재생성 명령(참고 — 비밀값은 `acos-secrets/pg-password`에서 읽어 주입):

```bash
docker run -d --name acos-postgres --restart unless-stopped \
  -p 127.0.0.1:5432:5432 \
  -v acos-pgdata:/var/lib/postgresql/data \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD="$(cat /home/ec2-user/acos-secrets/pg-password)" \
  -e POSTGRES_DB=acos \
  postgres:16-alpine
```

---

## 5. 환경변수 — 이름만 (값은 호스트에만)

### `apps/api/.env`

```
NODE_ENV  DEPLOY_TIER  PORT  TZ
DATABASE_URL  BACKUP_RESTORE_DB_URL
WEB_URL  PRODUCTION_HOSTS  TRUSTED_PROXY_IPS
AUTH_ADMIN_EMAIL  AUTH_ADMIN_PASSWORD  AUTH_COOKIE_SECURE
LLM_PROVIDER  LLM_ANTHROPIC_MODEL  LLM_ROUTE_DESIGN_REVIEW
OPENAI_API_KEY  ANTHROPIC_API_KEY  GEMINI_API_KEY
OCR_PROVIDER  GOOGLE_VISION_API_KEY
S3_ENDPOINT  S3_BUCKET  S3_ACCESS_KEY  S3_SECRET_KEY  BACKUP_BUCKET  BACKUP_DIR
GITHUB_REPOSITORY
VALIDATION_TARGET_URL  VALIDATION_TARGET_ACK
```

### `apps/web/.env`

```
NEXT_PUBLIC_API_URL
```

### `/home/ec2-user/acos-secrets/` (파일 1개 = 비밀값 1개)

```
admin-password  pg-password
openai-api-key  anthropic-api-key  gemini-api-key  vision-api-key
s3-access-key   s3-secret-key
```

**이 8개가 이 운영 환경의 모든 비밀값입니다.** 신규 프로젝트가 쓰지 않는
것(예: vision·gemini)은 그때 지우면 됩니다.

---

## 6. 배포 레이아웃 — 심볼릭 링크 교체 방식

```
/home/ec2-user/
├── acos-current -> acos-release-20260908-t1228      ← 심볼릭 링크
├── acos-release-20260908-t1228/                     ← 현재 가동 중
├── acos-release-20260908-t1226/
├── acos-release-20260905-t1215/
├── acos-release-20260905-t1214/
├── acos-release-20260904/
├── acos/                                            (8월 구버전)
├── acos-data/        로그 · 백업
└── acos-secrets/     비밀값 8개 (0600)
```

systemd 유닛의 `WorkingDirectory`가 `acos-current`를 가리키므로,
**배포는 "새 디렉터리를 올리고 링크를 바꾸고 재시작"** 입니다.
되돌리기도 링크를 되돌리고 재시작하면 됩니다.

```bash
ln -sfn /home/ec2-user/<새 릴리스> /home/ec2-user/acos-current
sudo systemctl restart acos-api acos-web
```

---

## 7. 신규 프로젝트에서 그대로 쓸 수 있는 것

이 기반은 **제품과 거의 무관합니다.** 바꿔야 하는 곳만 적습니다.

| 자산 | 신규 프로젝트에서 | 고칠 곳 |
| --- | --- | --- |
| EC2 · 도메인 · Cloudflare DNS | 그대로 | — |
| TLS 인증서 | 그대로 | 도메인이 같으면 손댈 것 없음 |
| nginx 설정 | 거의 그대로 | 포트가 다르면 `proxy_pass` 2줄 |
| systemd 유닛 | 거의 그대로 | 이름(`acos-*`)·`WorkingDirectory` |
| 심볼릭 링크 배포 방식 | 그대로 | 링크 이름 |
| Postgres 컨테이너 | 그대로 | **DB는 새로 만들 것을 권합니다**(§8) |
| 백업 타이머 | 그대로 | 경로 |
| `acos-secrets` 구조 | 그대로 | 안 쓰는 키 삭제 |

---

## 8. 복구 절차 (호스트를 처음부터 다시 세울 때)

```
1. EC2 생성 (Amazon Linux 2023) · 보안그룹 80/443 인바운드
2. node · docker · nginx · certbot 설치
3. Postgres 컨테이너 기동                    → §4
4. acos-secrets/ 에 비밀값 8개 배치 (0600)   → §5
5. 릴리스 디렉터리 업로드 + acos-current 링크 → §6
6. systemd/ 의 유닛 4개를 /etc/systemd/system/ 에 복사
   sudo systemctl daemon-reload
   sudo systemctl enable --now acos-api acos-web acos-prune-backups.timer
7. nginx/ 의 설정을 /etc/nginx/ 에 복사 (TLS 줄은 일단 제거)
   sudo nginx -t && sudo systemctl enable --now nginx
8. DNS를 새 IP로 변경
9. sudo certbot --nginx -d magicclean79.com -d www.magicclean79.com \
                        -d api.magicclean79.com
10. sudo systemctl enable --now certbot-renew.timer   ← §0, 빠뜨리지 말 것
11. 확인: https://magicclean79.com → 200,
          https://api.magicclean79.com/health → 200
```

`tls/certbot-renewal-magicclean79.com.conf`는 **참고용**입니다 — 새
인증서를 발급하면 certbot이 이 파일을 스스로 다시 만듭니다. 계정 id
(`account`)와 `key_type = ecdsa`가 기존 설정이었다는 기록으로 남깁니다.

---

## 9. 이 백업이 보장하지 않는 것

- **AWS 콘솔 설정**(보안그룹 규칙·S3 버킷 정책·IAM)은 들어 있지 않습니다.
- **Cloudflare DNS 레코드**도 들어 있지 않습니다.
- 위 §8 절차를 **실제로 처음부터 밟아 본 적은 없습니다.** 지금 도는
  호스트에서 읽어 적은 것이며, 복구 리허설은 하지 않았습니다.
