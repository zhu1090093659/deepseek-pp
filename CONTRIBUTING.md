# Contributing

Thanks for contributing to DeepSeek++.

All pull requests must follow these rules before they can be reviewed or merged.

## Pull Request Requirements

1. Base the work on the latest code.
   - Rebase or merge the latest `main` before opening the PR.
   - Re-check this after force-pushes or when the PR becomes stale.

2. Keep the PR focused.
   - Do not mix unrelated features, release changes, dependency churn, or documentation rewrites.
   - Do not modify public README content with internal API paths, protocol details, or implementation internals.

3. Run local validation.
   - At minimum, run the checks that match the changed behavior.
   - For TypeScript or extension runtime changes, start with:

```bash
npm run compile
```

   - For broader extension changes, also run the relevant build or smoke checks:

```bash
npm run build:chrome
npm run build:all
npm run smoke:mcp
npm run verify:mcp:mock
npm run verify:automation
```

4. Provide evidence for user-facing features.
   - If the PR adds or changes a feature, UI workflow, browser permission path, built-in tool, MCP flow, automation flow, or continuation-loop behavior, attach screenshots or a short screen recording in the PR.
   - The evidence must show:
     - the extension loaded locally from the latest code or this PR head;
     - the feature enabled or configured when applicable;
     - successful use of the feature;
     - the visible result or output;
     - result feedback or continuation behavior when the feature participates in agent loops.

5. Do not hide failures.
   - Report failing commands, browser errors, and limitations in the PR body.
   - Do not add silent fallbacks, mock success paths, or swallowed errors to make a feature appear to work.

PRs that skip these requirements may be blocked until the missing information is provided.
