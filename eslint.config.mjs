import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/next-env.d.ts",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
        process: "readonly",
      },
    },
  },
  {
    // Node 스크립트 (Playwright 스텁 서버·운영 스모크 등, TASK-0702/0703)
    // + CTO Bridge (2026-08-09) — ChatGPT ↔ Claude Code 작업 전달 계층
    files: ["**/e2e/**/*.mjs", "scripts/**/*.mjs", "bridge/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        fetch: "readonly",
        // 계약 스텁과 라이브 검사 스크립트가 쓴다 (TASK-4701)
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        // Bridge 비동기 실행의 심장박동에 쓴다 (2026-08-09)
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
  },
);
