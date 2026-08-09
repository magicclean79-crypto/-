/**
 * CTO Bridge — 커밋 전 비밀값 검사
 *
 * ## 왜 필요한가
 *
 * Bridge의 작업 지시·결과·등록 정보를 Git에 넣기로 했다(사장님 결정,
 * 2026-08-09). 그 순간부터 **한 번 커밋된 비밀값은 지워도 이력에 남는다.**
 * `.gitignore`는 "새 파일이 올라가는 것"만 막지, 이미 추적 중인 파일 안에
 * 섞여 들어간 문자열은 막지 못한다.
 *
 * 그래서 **내용을 직접 읽어** 확인한다.
 *
 * ## 무엇을 막는가
 *
 * | | 왜 |
 * | --- | --- |
 * | Bridge 인증 토큰 | 이것이 있으면 누구나 Claude Code를 실행시킬 수 있다 |
 * | API 키 (OpenAI·Google·GitHub 등) | 요금이 나가고 데이터에 접근된다 |
 * | 개인 키·인증서 | 서버 접속 수단 |
 * | 임시 터널 주소 | 재시작하면 바뀌는 환경 종속 값. 남으면 옛 주소를 믿게 된다 |
 * | 데이터베이스 접속 문자열 | 자격 증명이 그대로 들어 있다 |
 *
 * ## 쓰는 법
 *
 *   node bridge/check-secrets.mjs            커밋 대상(스테이징)만 검사
 *   node bridge/check-secrets.mjs --all      추적 중인 파일 전부 검사
 *
 * 하나라도 걸리면 **0이 아닌 값으로 끝난다** — 커밋 전에 멈추라는 뜻이다.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);

/** 이 파일들은 검사에서 뺀다 — 검사기 자신과 규칙 목록이 걸리면 곤란하다 */
const SKIP = [/^bridge\/check-secrets\.mjs$/, /^\.gitignore$/, /^pnpm-lock\.yaml$/];

/** 이진 파일·거대 파일은 읽지 않는다 */
const SKIP_EXT = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|node|wasm|map)$/i;

function rules() {
  const list = [
    {
      name: "Bridge 인증 토큰",
      // 실제 토큰 값을 파일에서 읽어 그 문자열이 있는지 본다.
      // 값 자체는 이 파일에 적지 않는다.
      pattern: liveToken(),
      why: "이 값이 있으면 누구나 Claude Code를 실행시킬 수 있습니다.",
    },
    {
      name: "OpenAI API 키",
      pattern: /\bsk-[A-Za-z0-9_-]{20,}/,
      why: "요금이 나가는 키입니다.",
    },
    {
      name: "Google/Gemini API 키",
      pattern: /\bAIza[A-Za-z0-9_-]{30,}/,
      why: "요금이 나가는 키입니다.",
    },
    {
      name: "GitHub 토큰",
      pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/,
      why: "저장소 접근 권한이 넘어갑니다.",
    },
    {
      name: "개인 키",
      pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      why: "서버 접속 수단입니다.",
    },
    {
      name: "임시 터널 주소",
      pattern: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
      why: "재시작하면 바뀌는 환경 종속 값입니다. 남아 있으면 죽은 주소를 믿게 됩니다.",
    },
    {
      name: "데이터베이스 접속 문자열",
      pattern: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']*:[^\s"'@]+@/,
      why: "자격 증명이 그대로 들어 있습니다.",
    },
    {
      name: "Bearer 토큰 값",
      pattern: /Bearer\s+[A-Za-z0-9._-]{32,}/,
      why: "인증 헤더에 실린 실제 값입니다.",
    },
  ];
  return list.filter((r) => r.pattern);
}

/** 지금 쓰이는 토큰 값 — 파일이 없으면 이 규칙은 건너뛴다 */
function liveToken() {
  const file = join(HERE, ".secrets", "bridge-token.txt");
  if (!existsSync(file)) return null;
  const value = readFileSync(file, "utf8").trim();
  // 너무 짧으면 우연히 걸릴 수 있으므로 쓰지 않는다.
  return value.length >= 16 ? new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : null;
}

function git(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" });
}

function targets(all) {
  const out = all
    ? git(["ls-files"])
    : git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  return out
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !SKIP.some((s) => s.test(f)))
    .filter((f) => !SKIP_EXT.test(f));
}

const all = process.argv.includes("--all");
const files = targets(all);
const checks = rules();

console.log(`비밀값 검사 — ${all ? "추적 중인 파일 전체" : "커밋 대상"} ${files.length}개 · 규칙 ${checks.length}개\n`);

const hits = [];
for (const file of files) {
  const path = join(REPO, file);
  if (!existsSync(path)) continue;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue; // 읽을 수 없는 파일은 넘어간다
  }
  const lines = text.split(/\r?\n/);
  for (const rule of checks) {
    lines.forEach((line, index) => {
      if (rule.pattern.test(line)) {
        hits.push({ file, line: index + 1, rule });
      }
    });
  }
}

if (hits.length === 0) {
  console.log("걸린 것 없음.");
  process.exit(0);
}

console.log(`걸린 것 ${hits.length}건 — 커밋하지 마십시오.\n`);
for (const h of hits) {
  console.log(`  ${h.file}:${h.line}`);
  console.log(`    ${h.rule.name} — ${h.rule.why}`);
}
console.log("\n값 자체는 일부러 출력하지 않습니다. 해당 줄을 직접 확인하십시오.");
process.exit(1);
