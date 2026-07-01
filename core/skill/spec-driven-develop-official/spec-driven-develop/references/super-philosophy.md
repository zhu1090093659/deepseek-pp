# S.U.P.E.R Architecture Philosophy

> Write code like building with LEGO — each brick has a single job, a standard interface, a clear direction, runs anywhere, and can be swapped at will.

This document defines the architectural principles that guide all code written during the development phases of a Spec-Driven Develop workflow. Every agent executing tasks should internalize these principles.

---

## S — Single Purpose

From Unix philosophy.

- Each module, file, and function solves exactly one problem
- Prefer decomposition; power comes from composition
- One skill does one thing, one worker does one thing, one script does one thing

**Litmus test:** if you cannot describe a module's responsibility in a single sentence, it needs to be split.

**Anti-pattern:** a script that fetches data, computes metrics, renders charts, and sends notifications.

**Correct approach:**
```
fetch_data.py  -> data retrieval only, outputs JSON
compute.py     -> computation only, reads JSON writes JSON
render.py      -> rendering only, reads JSON generates HTML
notify.py      -> notification only, reads JSON calls webhook
```

---

## U — Unidirectional Flow

From Clean Architecture.

- Data always flows in one direction: input -> processing -> output
- Dependencies always point inward: outer layers depend on inner layers, inner layers know nothing about outer layers
- No reverse dependencies, no circular calls

**Layered model:**
```
+-------------------------------+
|  Infrastructure (API, DB, UI) |  <- outermost, replaceable at will
+-------------------------------+
|  Adapters (transform, format) |
+-------------------------------+
|  Core business (pure logic)   |  <- innermost, zero external deps
+-------------------------------+
```

**Litmus test:** can the core logic run unit tests with zero external services? If not, the dependency direction is wrong.

---

## P — Ports over Implementation

From Hexagonal Architecture.

- Define interface contracts (data structures, JSON Schema) before writing implementation
- Use intermediate formats (JSON files, standard data structures) to isolate upstream from downstream
- Swapping a data source, a rendering layer, or a notification channel requires zero changes to core logic

**Practices:**
1. Every module's input and output must be a serializable data structure
2. Module boundaries communicate via JSON files or standard data structures; in-process typed objects are fine, but cross-module interfaces must be serializable
3. Define explicit schemas — not "just read the code to figure out the format"

---

## E — Environment-Agnostic

From 12-Factor App.

- Configuration injected via environment variables or config files, never hardcoded
- All dependencies explicitly declared (requirements.txt / package.json), no implicit reliance on global system packages
- Processes are stateless; all persistence delegated to external storage
- Logs go to stdout, not to files
- Same codebase runs on local machine, Cloudflare Workers, VPS, Docker

**Configuration precedence (high to low):**
```
Environment variables > .env file > config.json > in-code defaults
```

**Checklist:**
- All API keys and webhook URLs read from environment variables?
- All dependencies explicitly declared in a dependency file?
- No hardcoded file path assumptions?
- Can a different machine run this code with zero modifications?

---

## R — Replaceable Parts

The natural consequence and ultimate goal of S + U + P + E.

- Any layer can be replaced without affecting others
- Replacement cost is the core metric of architecture quality
- If replacing one component triggers cascading changes in unrelated modules, the architecture is broken

**Replacement matrix:**
| Replacing          | Impact scope       | Correct approach                          |
|:-------------------|:-------------------|:------------------------------------------|
| Data source API    | Adapter layer only | Write new fetcher, output same JSON       |
| Frontend renderer  | Render layer only  | Read same JSON, swap render implementation|
| Notification channel| Notification layer | Swap webhook adapter                      |
| Deployment platform| Deploy config only | Change wrangler.toml or Dockerfile        |
| Programming language| Implementation only| JSON contracts unchanged, rewrite in any language |

---

## Quick Check Card

```
+------------------------------------------+
|         S.U.P.E.R Quick Check            |
|                                          |
|  S  Does this module do only one thing?  |
|  U  Is the data flow unidirectional?     |
|  P  Are inputs/outputs schema-defined?   |
|  E  Can it run in a different env?       |
|  R  Can you replace it without ripple?   |
|                                          |
|  All Yes -> Architecture healthy         |
|  1-2 No  -> Refactoring needed           |
|  3+ No   -> Technical debt alert         |
+------------------------------------------+
```
