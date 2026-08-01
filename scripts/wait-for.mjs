#!/usr/bin/env node
/**
 * 주소가 응답할 때까지 기다린다. (TASK-4701, Sprint 47 — 지시 4)
 *
 * `sleep 10`으로 기다리면 두 가지가 다 나쁩니다: 빠른 날에는 쓸데없이
 * 기다리고, 느린 날에는 **아직 안 뜬 서버를 죽었다고** 부릅니다. 그리고
 * 그 실패는 "코드가 잘못됐다"로 읽힙니다 — 실제로는 준비가 안 된 것입니다.
 *
 * 사용: `node scripts/wait-for.mjs <url> [초]`
 *
 * 판정:
 *   exit 0 — 응답했다
 *   exit 2 — 시간 안에 응답하지 않았다 — **통과로 처리하지 않는다**
 */

const [, , url, secondsRaw] = process.argv;
const seconds = Number(secondsRaw ?? 30) || 30;

if (!url) {
  console.error("[wait-for] 주소를 주세요: node scripts/wait-for.mjs <url> [초]");
  process.exit(2);
}

const deadline = Date.now() + seconds * 1000;
let lastError = "아직 아무 응답도 받지 못했습니다";

while (Date.now() < deadline) {
  try {
    const response = await fetch(url);
    // 상태 코드는 보지 않습니다 — 404라도 **누군가 듣고 있다**는 뜻이고,
    // 여기서 알고 싶은 것은 그것뿐입니다.
    console.log(`[wait-for] ${url} 응답 (HTTP ${response.status})`);
    process.exit(0);
  } catch (error) {
    lastError = String(error);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

console.error(`[wait-for] ${seconds}초 안에 ${url}이(가) 응답하지 않았습니다: ${lastError}`);
console.error("  못 기다린 것을 통과로 처리하지 않습니다.");
process.exit(2);
