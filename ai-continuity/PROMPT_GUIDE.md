# PROMPT_GUIDE

> Rules for writing and changing prompts in this system.
>
> Prompts here are **not strings scattered in services.** They are declarative
> templates registered in one engine. Do not bypass it.

---

## 1. Where prompts live

```
packages/core/src/prompt/prompt-engine.ts      the engine (PromptTemplate interface)
packages/core/src/prompt/default-engine.ts     registration
packages/core/src/prompt/templates/
    product-analysis.template.ts               key: "product-analysis"
    content-generation.template.ts             key: "content-generation"
    vision-analysis.template.ts                key: "vision-analysis"
apps/api/src/prompt/prompt.constants.ts        adapter-side constants
GET /prompt                                    lists registered templates
```

**Prompts are pure judgment**: they live in `@acos/core` and perform no I/O.
A template turns a typed context into `LlmMessageDto[]`. That is all it does.

---

## 2. The contract

```ts
interface PromptTemplate<TInput> {
  key: string;          // unique within the engine — duplicates throw at construction
  name: string;
  description: string;
  build(input: TInput): LlmMessageDto[];
}
```

Rules that follow from this shape:

- **`key` is unique.** The engine throws `중복된 프롬프트 템플릿 key입니다`
  on collision. Do not reuse a key for a changed prompt.
- **`build` is a pure function.** No fetch, no clock, no randomness. Same
  input → same messages, always.
- **All context arrives as `TInput`.** Never read config or globals inside
  `build`.

---

## 3. Rules for the prompt text itself

These are derived from the existing templates. Follow them.

### R-P1 — State the output contract explicitly

Every template that expects structured output says so in the system message,
listing the exact fields.

```
"- JSON 객체 하나만 출력한다 (코드 펜스·해설·머리말 금지)"
"- 필드: name · category · keywords · description · attributes · confidence"
```

Say "one JSON object only, no code fence, no preamble" — models add fences
unless told not to.

### R-P2 — Forbid invention, require a confidence signal

```
"- OCR 텍스트에 없는 정보를 만들어내지 않는다 — 불확실하면 confidence를 낮춘다"
```

This is `PROJECT_PHILOSOPHY.md` P1 applied to the model: **the model must be
able to express "I do not know"**, and the system must be able to read it.
Never remove the confidence field to make downstream code simpler.

### R-P3 — Include the rule-based draft when one exists

`product-analysis` embeds a deterministic draft (built by
`buildDraftProductAnalysis`) in the prompt. The real model validates and
enriches it; **the mock returns the draft unchanged**, which is what makes
offline verification possible at all.

If you add a template for something that has a rule-based fallback, do the
same. If you remove the draft, you remove the ability to test without a
provider.

### R-P4 — Company Brain goes in the prompt, not the code

Brand tone, decisions, and banned words are **data** injected as context —
never hardcoded phrasing inside a template.

### R-P5 — Korean for model-facing instruction text

The existing templates instruct in Korean because the product's output is
Korean. Keep it consistent within a template; do not mix.

### R-P6 — Do not put markdown emphasis in strings that reach a screen

`AI_RULES.md` R9. Prompt text sent to a model is fine; anything rendered to a
user is not, and `no-markdown.spec.ts` enforces it in `ops` and `reliability`.

---

## 4. Changing an existing prompt

**A prompt change is a behavior change.** Treat it like one.

```
1. Find every caller:      grep -rn "<TEMPLATE>_KEY" packages/core/src apps/api/src
2. Check the output contract still matches the parser that consumes it.
   Changing a field name in the prompt but not the parser produces
   plausible-looking garbage — and NO test will fail if the mock
   short-circuits the path.
3. Run the mock path AND, if you can, a real call. You almost certainly
   cannot (LLM_PROVIDER=mock, no credentials) — so say so in your report.
4. Never change key + content at once. Either fix wording (same key) or
   introduce a new key.
```

---

## 5. Adding a new template

```
1. Define TInput in the domain module that owns the concept
   (analysis, content, vision …), not in prompt/.
2. Create packages/core/src/prompt/templates/<name>.template.ts
   exporting <NAME>_TEMPLATE_KEY and <NAME>_TEMPLATE.
3. Register it in default-engine.ts.
4. Write a spec that asserts the rendered messages contain the output
   contract lines. Prompts are text; text rots silently.
```

**Do not** call a provider directly from a service with an inline prompt
string. If you find such code, that is a defect, not a pattern to copy.

---

## 6. Cost awareness

Every prompt costs money at real providers.

- Long context is billed. `content-generation` already has the longest prompt
  and output in the system — be careful adding to it.
- Batches are capped at **50 items**; do not raise the cap to make a prompt
  change "work at scale".
- Token accounting normalizes cache and reasoning tokens per vendor
  (`AI_RULES.md` R7). If a prompt change alters caching behavior, the cost
  numbers change meaning — mention it.

---

## 7. What you cannot verify (say this in your report)

With `LLM_PROVIDER=mock`:

- You cannot verify the model obeys the output contract.
- You cannot verify token/cost behavior.
- You cannot verify latency or failure modes.

The mock returns the rule-based draft. **A green test run after a prompt
change tells you the code path works, not that the prompt works.** Write that
sentence in your summary rather than implying verification.
