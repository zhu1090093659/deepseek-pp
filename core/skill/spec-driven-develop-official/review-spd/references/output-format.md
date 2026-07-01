# Review Output Format

Final review responses must be findings-first.

## With Findings

```markdown
## Findings

### Critical
- [C1] `path/to/file:line` Short problem title
  Impact: What breaks and why it matters.
  Evidence: Specific diff/context evidence.
  Trigger: Input, state, or execution path that exposes the bug.
  Suggested fix: Minimal fix direction.
  Test gap: Missing or weak test coverage, if relevant.

### High
- [H1] `path/to/file:line` Short problem title
  Impact: ...
  Evidence: ...
  Trigger: ...
  Suggested fix: ...
  Test gap: ...

### Medium
- [M1] `path/to/file:line` Short problem title
  Impact: ...
  Evidence: ...
  Trigger: ...
  Suggested fix: ...
  Test gap: ...

### Low
- [L1] `path/to/file:line` Short problem title
  Impact: ...
  Evidence: ...
  Trigger: ...
  Suggested fix: ...
  Test gap: ...

## Testing Gaps
- [Only gaps not already attached to individual findings]

## Questions
- [Only unresolved questions needed to complete the review]

## Residual Risks
- [What was not fully reviewable and why]

## Verification
- Context collected: [command]
- Additional checks run: [commands or "not run"]
```

Omit empty severity sections. Keep summaries brief and below findings.

## Without Findings

```markdown
## Findings

No findings.

## Testing Gaps
- [Any meaningful coverage gaps, or "None identified from the reviewed diff."]

## Residual Risks
- [What was not fully reviewable and why]

## Verification
- Context collected: [command]
- Additional checks run: [commands or "not run"]
```

## Quality Bar

- Every finding needs evidence.
- Every finding should describe impact, not just code shape.
- Do not include style-only comments.
- Do not include broad refactor suggestions unless they prevent a concrete defect.
- Prefer `No findings` over weak or speculative findings.
