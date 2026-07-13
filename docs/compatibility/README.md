# Compatibility Contract Registry

This directory is the compatibility firewall for the `core-refactor-2026-07` run. It records the externally observable contracts that the refactor must preserve or migrate explicitly before production structure changes.

## Registry Map

| Surface | Registry | Follow-up executable freeze |
|:--|:--|:--|
| Prompt bytes, tool XML, inline agent, runtime messages, MAIN/content bridge, sandbox | [Prompt and Runtime](./prompt-and-runtime.md) and [Runtime Command Inventory](./runtime-command-inventory.md) | T1.2 / [#312](https://github.com/zhu1090093659/deepseek-pp/issues/312), T1.3 / [#313](https://github.com/zhu1090093659/deepseek-pp/issues/313) |
| Storage keys, IndexedDB identity, schemas, sync, export | [Persistence and Sync](./persistence-and-sync.md) | T1.4 / [#314](https://github.com/zhu1090093659/deepseek-pp/issues/314) |
| Chrome, Edge, Firefox, DeepSeek, MCP, Native Host, Shell Host, Android minimum | [Platform and Integrations](./platform-and-integrations.md) | T1.5 / [#315](https://github.com/zhu1090093659/deepseek-pp/issues/315) |

## How to Read a Contract

Every registry row has a stable ID and the following fields:

- **Historical input**: data or messages already produced by released versions that must remain readable.
- **Current output**: the observable shape, ordering, identifier, or behavior emitted by v1.10.0 at baseline commit `165ec46`.
- **Unknown/future**: current handling and the invariant required before a changed schema or protocol can ship.
- **Failure visibility**: how callers or users can distinguish failure from success today; silent behavior is recorded as a gap, not promoted to the target contract.
- **Recovery/rollback**: the current recovery boundary and the minimum compatibility rule for future changes.
- **Evidence**: the current source or verification surface that owns the contract.

`Preserve` means the current behavior is a refactor invariant. `Gap` means an unsafe, lossy, ambiguous, or untested current behavior that follow-up work must repair without treating it as successful compatibility. `Current-only` means the item is an inventory statement and still needs an executable fixture.

## Change Protocol

1. Keep stable IDs. Rename a contract only by leaving an alias or migration note here.
2. Never change a persisted key, database/table identity, message name, prompt byte sequence, manifest identity, or native protocol implicitly.
3. For versioned data, decode historical versions, migrate deterministically and idempotently, and write the current version only after validation succeeds.
4. Unknown future versions and corrupt records must fail visibly without overwriting the original bytes or records.
5. Any operation spanning multiple durable records needs either an atomic commit point or a recovery journal. Partial success is not a compatible success result.
6. Browser/runtime differences must be represented as capabilities and explicit unsupported results. Android remains a security/shared-contract target, not a browser feature-parity target.
7. Update the relevant registry row and its executable fixture in the same behavior-changing pull request.

## Baseline and Validation

T1.1 is documentation-only and does not change production behavior. The baseline has already passed 63 test files / 359 tests, TypeScript compilation, the current 10-case prompt source freeze, Chrome/Edge/Firefox builds, manifest policy, UTF-8 policy, and production audit. Android runtime checks were unavailable on the baseline machine because JDK/Gradle were not installed.

The current repository commands referenced by this registry are:

```bash
npm test -- --reporter=dot
npm run compile
npm run prompt:freeze
npm run build:all
npm run verify:manifest-policy
npm run verify:extension-utf8
npm run audit:prod
npm run smoke:mcp
npm run smoke:shell
```

T1.2 supplies executable prompt/tool/inline-agent byte evidence. T1.3-T1.5 add exhaustive message fixtures, historical persistence fixtures, cross-browser manifest assertions, and protocol/native smoke evidence. Until the owning task closes, rows marked `Current-only` are inventory, not proof of compatibility.
