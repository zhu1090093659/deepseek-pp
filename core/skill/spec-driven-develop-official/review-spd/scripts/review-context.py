#!/usr/bin/env python3
"""
Collect git review context for the Review SPD skill.

The script gathers stable repository context for three review modes:

- default uncommitted changes
- commits in a date range
- branch / PR-style comparison against a base branch

It intentionally does not judge whether code is correct. Review decisions belong
to the agent workflow that consumes this Markdown output.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path


EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
MAX_UNTRACKED_DIFF_BYTES = 200_000


class GitError(RuntimeError):
    pass


def run_git(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "git command failed"
        raise GitError(f"git {' '.join(args)}: {message}")
    return result


def git_stdout(args: list[str], *, check: bool = True) -> str:
    return run_git(args, check=check).stdout.strip()


def require_git_repo() -> Path:
    try:
        root = git_stdout(["rev-parse", "--show-toplevel"])
    except GitError as exc:
        raise GitError("not inside a git repository") from exc
    os.chdir(root)
    return Path(root)


def branch_exists(ref: str) -> bool:
    return run_git(["rev-parse", "--verify", "--quiet", ref], check=False).returncode == 0


def resolve_base(explicit_base: str | None) -> str:
    if explicit_base:
        if not branch_exists(explicit_base):
            raise GitError(f"base ref not found: {explicit_base}")
        return explicit_base

    for candidate in ("origin/main", "origin/master"):
        if branch_exists(candidate):
            return candidate

    origin_head = git_stdout(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], check=False)
    if origin_head:
        resolved = origin_head.replace("refs/remotes/", "", 1)
        if branch_exists(resolved):
            return resolved

    for candidate in ("main", "master"):
        if branch_exists(candidate):
            return candidate

    raise GitError("could not auto-detect base branch; pass --base explicitly")


def current_branch() -> str:
    branch = git_stdout(["branch", "--show-current"], check=False)
    return branch or "DETACHED_HEAD"


def status_porcelain() -> str:
    return git_stdout(["status", "--porcelain=v1", "-uall"], check=False)


def untracked_files(status: str) -> list[str]:
    files: list[str] = []
    for line in status.splitlines():
        if line.startswith("?? "):
            files.append(line[3:])
    return files


def changed_files_for_range(base: str, head: str) -> str:
    return git_stdout(["diff", "--name-status", "--find-renames", base, head], check=False)


def diff_stat_for_range(base: str, head: str) -> str:
    return git_stdout(["diff", "--stat", "--find-renames", base, head], check=False)


def diff_for_range(base: str, head: str) -> str:
    return git_stdout(["diff", "--find-renames", base, head], check=False)


def untracked_diff(path_text: str) -> str:
    path = Path(path_text)
    if not path.is_file():
        return f"# Untracked path omitted (not a regular file): {path_text}\n"

    try:
        data = path.read_bytes()
    except OSError as exc:
        return f"# Untracked file omitted (read failed): {path_text} ({exc})\n"

    if len(data) > MAX_UNTRACKED_DIFF_BYTES:
        return f"# Untracked file omitted (larger than {MAX_UNTRACKED_DIFF_BYTES} bytes): {path_text}\n"
    if b"\0" in data:
        return f"# Untracked file omitted (binary content): {path_text}\n"

    result = run_git(["diff", "--no-index", "--", "/dev/null", path_text], check=False)
    return result.stdout or f"# Untracked file has no text diff: {path_text}\n"


def collect_uncommitted() -> dict[str, str]:
    status = status_porcelain()
    tracked_stat = git_stdout(["diff", "--stat", "--find-renames", "HEAD"], check=False)
    tracked_files = git_stdout(["diff", "--name-status", "--find-renames", "HEAD"], check=False)
    tracked_diff = git_stdout(["diff", "--find-renames", "HEAD"], check=False)
    untracked = untracked_files(status)
    untracked_sections = "\n".join(untracked_diff(path) for path in untracked)
    diff = tracked_diff
    if untracked_sections:
        diff = f"{tracked_diff}\n\n# Untracked file diffs\n\n{untracked_sections}".strip()

    return {
        "mode": "uncommitted",
        "base": "HEAD",
        "head": "working tree",
        "status": status,
        "commits": "",
        "stat": tracked_stat,
        "files": tracked_files,
        "untracked": "\n".join(untracked),
        "diff": diff,
    }


def commit_parent_or_empty(commit: str) -> str:
    line = git_stdout(["rev-list", "--parents", "-n", "1", commit])
    parts = line.split()
    if len(parts) > 1:
        return parts[1]
    return EMPTY_TREE


def collect_commit_range(since: str | None, until: str | None) -> dict[str, str]:
    effective_since = since or "3 days ago"
    args = ["log", "--reverse", f"--since={effective_since}"]
    if until:
        args.append(f"--until={until}")
    args.extend(["--format=%H%x09%h%x09%ad%x09%s", "--date=short"])
    commit_lines = git_stdout(args, check=False)
    commits = [line.split("\t", 1)[0] for line in commit_lines.splitlines() if line.strip()]

    if not commits:
        return {
            "mode": "commit-range",
            "base": "",
            "head": "",
            "status": status_porcelain(),
            "commits": "",
            "stat": "",
            "files": "",
            "untracked": "",
            "diff": "",
            "range": f"since={effective_since}, until={until or 'now'}",
        }

    base = commit_parent_or_empty(commits[0])
    head = commits[-1]
    return {
        "mode": "commit-range",
        "base": base,
        "head": head,
        "status": status_porcelain(),
        "commits": commit_lines,
        "stat": diff_stat_for_range(base, head),
        "files": changed_files_for_range(base, head),
        "untracked": "",
        "diff": diff_for_range(base, head),
        "range": f"since={effective_since}, until={until or 'now'}",
    }


def collect_branch(branch: str, base_arg: str | None) -> dict[str, str]:
    if not branch_exists(branch):
        raise GitError(f"branch/ref not found: {branch}")
    base = resolve_base(base_arg)
    merge_base = git_stdout(["merge-base", base, branch])
    commits = git_stdout(
        ["log", "--reverse", "--format=%H%x09%h%x09%ad%x09%s", "--date=short", f"{merge_base}..{branch}"],
        check=False,
    )
    return {
        "mode": "branch",
        "base": base,
        "head": branch,
        "merge_base": merge_base,
        "status": status_porcelain(),
        "commits": commits,
        "stat": diff_stat_for_range(merge_base, branch),
        "files": changed_files_for_range(merge_base, branch),
        "untracked": "",
        "diff": diff_for_range(merge_base, branch),
    }


def fenced(text: str, language: str = "") -> str:
    body = text.rstrip() if text else ""
    fence = "```"
    while fence in body:
        fence += "`"
    return f"{fence}{language}\n{body}\n{fence}"


def render_markdown(root: Path, context: dict[str, str]) -> str:
    status = context.get("status", "")
    stat = context.get("stat", "")
    files = context.get("files", "")
    untracked = context.get("untracked", "")
    diff = context.get("diff", "")
    commits = context.get("commits", "")
    has_changes = bool(stat.strip() or files.strip() or untracked.strip() or diff.strip())

    lines = [
        "# Review Context",
        "",
        "## Target",
        "",
        f"- Mode: `{context['mode']}`",
        f"- Repository: `{root}`",
        f"- Current branch: `{current_branch()}`",
        f"- Base: `{context.get('base', '') or 'n/a'}`",
        f"- Head: `{context.get('head', '') or 'n/a'}`",
    ]

    if context.get("merge_base"):
        lines.append(f"- Merge base: `{context['merge_base']}`")
    if context.get("range"):
        lines.append(f"- Range: `{context['range']}`")

    lines.extend([
        f"- Has changes: `{'yes' if has_changes else 'no'}`",
        "",
        "## Working Tree Status",
        "",
        fenced(status, "text"),
        "",
        "## Commits",
        "",
        fenced(commits, "text"),
        "",
        "## Diff Stat",
        "",
        fenced(stat, "text"),
        "",
        "## Changed Files",
        "",
        fenced(files, "text"),
    ])

    if untracked:
        lines.extend(["", "## Untracked Files", "", fenced(untracked, "text")])

    lines.extend(["", "## Unified Diff", "", fenced(diff, "diff")])
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect git context for the Review SPD skill.")
    parser.add_argument("--branch", help="Branch/ref to review against the base branch.")
    parser.add_argument("--base", help="Base branch/ref for --branch mode.")
    parser.add_argument("--since", help="Start date for commit-range mode, e.g. '3 days ago'.")
    parser.add_argument("--until", help="End date for commit-range mode.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        root = require_git_repo()
        if args.branch:
            context = collect_branch(args.branch, args.base)
        elif args.since or args.until:
            context = collect_commit_range(args.since, args.until)
        else:
            context = collect_uncommitted()
        print(render_markdown(root, context), end="")
        return 0
    except GitError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
