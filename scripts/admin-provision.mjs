#!/usr/bin/env node
/**
 * 관리자 계정 안전 프로비저닝/비밀번호 재설정 (T1-213).
 *
 * ## 왜 필요한가
 *
 * `AuthService.bootstrapAdmin()`(apps/api/src/auth/auth.service.ts)은
 * **사용자가 0명일 때만** 관리자를 자동 생성한다. 이미 사용자가 있는
 * 운영 DB에서 유일한 ADMIN 계정의 비밀번호를 잃어버리면(또는 배포
 * 직후 최초 로그인이 필요하면), API를 통한 비밀번호 재설정
 * (`POST /auth/users/:id/password-reset`)은 이미 로그인된 ADMIN이
 * 있어야만 쓸 수 있어 이 상황에 쓸 수 없다 — 지금까지 이 경우의
 * 공식 절차가 없었다. 이 스크립트가 그 자리를 채운다.
 *
 * ## 안전 규칙
 *
 * - 비밀번호는 **소스에 절대 넣지 않는다** — `ADMIN_PASSWORD` 환경변수로만
 *   받는다(기본값 없음, 누락 시 그 자리에서 종료).
 * - 비밀번호 자체·해시를 **어디에도 출력하지 않는다**(로그·stdout·stderr
 *   전부). 결과에는 이메일·역할·활성 상태·생성/재설정 여부만 남긴다.
 * - 비밀번호 복잡도 정책(core `validatePasswordComplexity`, 기존 로그인·
 *   가입과 동일 기준)을 그대로 재사용한다 — 이 스크립트만 다른 기준을
 *   쓰지 않는다.
 * - 기존 사용자 감사 로그(`UserAuditLog`)에 동일한 형식으로 기록해,
 *   API로 한 변경과 CLI로 한 변경이 `/admin/users` 감사 로그 화면에서
 *   구분 없이 함께 보이게 한다.
 * - `DATABASE_URL`은 실행 환경의 값을 그대로 쓴다 — 이 스크립트가
 *   대상 DB를 정하지 않는다. 로컬에서 돌리면 로컬 DB, 운영 서버에서
 *   `.env`를 로드해 돌리면 운영 DB를 대상으로 한다(원격 DB에
 *   원격으로 접속해 실행하지 않는다 — 이 프로젝트의 "원격 EC2·원격
 *   데이터 직접 수정 금지" 원칙과 같은 이유로, 실행은 항상 그 DB와
 *   같은 호스트에서 사람이 한다).
 *
 * ## 사용법
 *
 * ```bash
 * ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="<강한 비밀번호>" \
 *   node scripts/admin-provision.mjs
 * ```
 *
 * - 해당 이메일의 사용자가 없으면 **새 ADMIN 계정을 생성**한다.
 * - 이미 있으면 **비밀번호만 재설정**하고 역할을 ADMIN으로 맞추고,
 *   잠금·실패 카운트를 해제하고, 기존 세션을 전부 폐기한다(탈취된
 *   세션 무효화 — `resetPassword`와 동일한 정책).
 *
 * 판정: exit 0 — 성공 / exit 2 — 입력값 오류(비밀번호 누락·정책 위반
 * 등, DB를 건드리지 않음) / exit 1 — 실행 중 오류.
 */

import { createRequire } from "node:module";

const requireFromApi = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { PrismaClient } = requireFromApi("@prisma/client");
const { hashPassword, validatePasswordComplexity } = await import(
  "../packages/core/dist/index.js"
);

const rawEmail = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!rawEmail || !rawEmail.trim()) {
  console.error(
    "[admin-provision] ADMIN_EMAIL 환경변수가 필요합니다 — 종료합니다.",
  );
  process.exit(2);
}
if (!password) {
  console.error(
    "[admin-provision] ADMIN_PASSWORD 환경변수가 필요합니다 — " +
      "고정 비밀번호를 소스에 넣지 않으므로 매 실행 시 직접 지정해야 합니다.",
  );
  process.exit(2);
}

const email = rawEmail.trim().toLowerCase();
const violation = validatePasswordComplexity(password);
if (violation) {
  console.error(`[admin-provision] 비밀번호 정책 위반: ${violation}`);
  process.exit(2);
}

const prisma = new PrismaClient();

async function recordAudit(action, actor, targetEmail, detail = null) {
  await prisma.userAuditLog.create({
    data: { action, actor, targetEmail, detail },
  });
}

try {
  const passwordHash = await hashPassword(password);
  const existing = await prisma.user.findUnique({ where: { email } });

  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        name: "관리자(CLI 프로비저닝)",
        passwordHash,
        role: "ADMIN",
      },
    });
    await recordAudit(
      "USER_CREATED",
      "cli:admin-provision",
      email,
      "role=ADMIN (scripts/admin-provision.mjs)",
    );
    console.log(`[admin-provision] 새 ADMIN 계정을 생성했습니다: ${email}`);
    process.exit(0);
  }

  await prisma.user.update({
    where: { id: existing.id },
    data: {
      passwordHash,
      role: "ADMIN",
      disabled: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await prisma.authSession.deleteMany({ where: { userId: existing.id } });
  await recordAudit(
    "PASSWORD_RESET",
    "cli:admin-provision",
    email,
    "scripts/admin-provision.mjs — 비밀번호 재설정 + 역할 ADMIN 확정",
  );
  if (existing.role !== "ADMIN") {
    await recordAudit(
      "ROLE_CHANGED",
      "cli:admin-provision",
      email,
      `${existing.role} → ADMIN (scripts/admin-provision.mjs)`,
    );
  }
  console.log(
    `[admin-provision] 기존 계정의 비밀번호를 재설정하고 ADMIN으로 확정했습니다: ${email} ` +
      "(기존 세션은 전부 폐기됐습니다 — 새 비밀번호로 다시 로그인하세요).",
  );
  process.exit(0);
} catch (error) {
  console.error(`[admin-provision] 실행 중 오류: ${String(error)}`);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
