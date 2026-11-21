"""Best-effort local Codex PreToolUse guard for registered personal projects.

This parser is a convenience guardrail, not a security boundary. It never
executes submitted shell text, starts reviewers, or contacts a server. Shell
aliases, arbitrary scripts, interactive write_stdin input, and other tool paths
can bypass this adapter. Use a trusted GitHub gate for server-side enforcement.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from preflight import GateError, verify
except Exception:  # An unavailable verifier must produce a supported denial.
    class GateError(RuntimeError):
        pass

    def verify(*args: Any, **kwargs: Any) -> dict:
        raise GateError("The local pre-flight verifier could not be loaded.")


REGISTRY_PATH = Path(__file__).resolve().parents[1] / "projects.json"
_REPO_NAME = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_RELEASE_HINT = re.compile(
    r"\b(?:git(?:\.exe)?\b[^\n;|&]*\b(?:push|merge)\b|"
    r"gh(?:\.exe)?\b[^\n;|&]*\bpr\s+(?:create|merge)\b)", re.I
)


class AdapterError(ValueError):
    pass


def _literal_path(value: Any, base: Path | None = None) -> Path:
    if not isinstance(value, str) or not value or any(c in value for c in "$`*?\x00"):
        raise AdapterError("The repository path must be literal and unambiguous.")
    path = Path(value).expanduser()
    if not path.is_absolute():
        if base is None:
            raise AdapterError("An absolute session directory is required.")
        path = base / path
    return path.resolve()


@dataclass
class Registry:
    roots: list[Path]
    repositories: dict[str, Path]

    @classmethod
    def read(cls, path: Path) -> "Registry":
        try:
            raw = json.loads(path.read_text(encoding="utf-8-sig"))
            if (not isinstance(raw, dict) or raw.get("schema_version") != 1
                    or not isinstance(raw.get("roots"), list)
                    or not isinstance(raw.get("repositories"), list)):
                raise AdapterError("Invalid project registry schema.")
            roots = [_literal_path(root) for root in raw["roots"]]
            repositories: dict[str, Path] = {}
            for item in raw["repositories"]:
                name = item["name"]
                if not isinstance(name, str) or not _REPO_NAME.fullmatch(name):
                    raise AdapterError("Invalid registered GitHub repository name.")
                key = name.casefold()
                candidate = _literal_path(item["path"])
                if key in repositories and repositories[key] != candidate:
                    raise AdapterError("A repository has ambiguous local registrations.")
                repositories[key] = candidate
            return cls(roots, repositories)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise AdapterError("The local project registry is missing or invalid.") from exc

    def contains(self, path: Path) -> bool:
        return any(path.is_relative_to(root)
                   for root in [*self.roots, *self.repositories.values()])

    def mapped(self, name: str | None) -> Path | None:
        return self.repositories.get(name.casefold()) if name else None


def _repository(path: Path) -> Path:
    for candidate in (path, *path.parents):
        if (candidate / ".git").exists():
            return candidate
    raise AdapterError("The scoped release directory is not a Git checkout.")


def _git(repo: Path, *args: str, missing_ok: bool = False) -> str:
    # Only fixed read-only Git operations call this helper. Never shell=True.
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=5, check=False,
    )
    if result.returncode and not missing_ok:
        raise AdapterError("A read-only Git identity check failed.")
    return result.stdout.strip() if result.returncode == 0 else ""


def _lex(command: str) -> tuple[list[list[str]], bool]:
    """Tokenize a small literal shell subset; do not evaluate shell grammar."""
    statements: list[list[str]] = []
    words: list[str] = []
    token: list[str] = []
    quote: str | None = None
    started = False
    ambiguous = False
    for char in command:
        if quote:
            if char == quote:
                quote = None
            else:
                token.append(char)
                if quote == '"' and char in "$`":
                    ambiguous = True
            continue
        if char in "'\"":
            quote = char
            started = True
        elif char in " \t\r":
            if started:
                words.append("".join(token))
                token, started = [], False
        elif char in ";&|\n":
            if started:
                words.append("".join(token))
                token, started = [], False
            if words:
                statements.append(words)
                words = []
        else:
            token.append(char)
            started = True
            if char in "$`(){}<>":
                ambiguous = True
    if started:
        words.append("".join(token))
    if words:
        statements.append(words)
    return statements, ambiguous or quote is not None


def _executable(token: str) -> str:
    return token.replace("\\", "/").rsplit("/", 1)[-1].casefold().removesuffix(".exe")


def _shell_release_hint(command: str) -> bool:
    statements, _ = _lex(command)
    unresolved = False
    for words in statements:
        executable = _executable(words[0])
        if executable == "git":
            index = 1
            while index < len(words):
                arg = words[index]
                if arg == "-C":
                    index += 2
                elif arg.startswith("-C") or arg in {"--no-pager", "--no-optional-locks", "--literal-pathspecs"}:
                    index += 1
                elif arg.startswith("-"):
                    unresolved = True
                    break
                else:
                    if arg in {"push", "merge"}:
                        return True
                    break  # A direct ordinary Git verb is not a release.
            continue
        if executable == "gh" and any(words[i:i + 2] in (["pr", "create"], ["pr", "merge"])
                                      for i in range(1, len(words) - 1)):
            return True
        if executable not in {"echo", "printf", "write-output", "write-host", "cd", "chdir", "set-location"}:
            unresolved = True
    # Unsupported line continuations still need a conservative release hint.
    flattened = re.sub(r"(?:\\|`)\r?\n", " ", command)
    return unresolved and bool(_RELEASE_HINT.search(flattened))


def _name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.rstrip("/").removesuffix(".git")
    match = re.search(r"(?:github\.com[/:])([\w.-]+/[\w.-]+)$", value, re.I)
    result = match.group(1) if match else value
    return result if _REPO_NAME.fullmatch(result) else None


def _option(args: list[str], *names: str) -> tuple[str | None, bool]:
    values: list[str] = []
    for index, arg in enumerate(args):
        if arg in names:
            if index + 1 == len(args) or args[index + 1].startswith("-"):
                raise AdapterError("A release option is missing its literal target.")
            values.append(args[index + 1])
        else:
            for name in names:
                if arg.startswith(name + "="):
                    values.append(arg[len(name) + 1:])
                elif name.startswith("-") and not name.startswith("--") and arg.startswith(name) and len(arg) > len(name):
                    values.append(arg[len(name):])
    if len(set(values)) > 1 or any(not value for value in values):
        raise AdapterError("Release target options are ambiguous.")
    return (values[0] if values else None), bool(values)


def _argument(arguments: dict, *names: str) -> str | None:
    values = [arguments[name] for name in names if arguments.get(name) is not None]
    if any(not isinstance(value, str) or not value for value in values) or len(set(values)) > 1:
        raise AdapterError("The remote release arguments contain ambiguous target aliases.")
    return values[0] if values else None


def _git_action(words: list[str], cwd: Path) -> tuple[str | None, Path, list[str], bool]:
    index = 1
    ambiguous = False
    while index < len(words):
        arg = words[index]
        if arg == "-C":
            if index + 1 == len(words):
                raise AdapterError("git -C is missing a literal directory.")
            cwd = _literal_path(words[index + 1], cwd)
            index += 2
        elif arg.startswith("-C") and len(arg) > 2:
            cwd = _literal_path(arg[2:], cwd)
            index += 1
        elif arg in ("--no-pager", "--no-optional-locks", "--literal-pathspecs"):
            index += 1
        elif arg in ("push", "merge"):
            return arg, cwd, words[index + 1:], ambiguous
        elif not arg.startswith("-"):
            return None, cwd, [], ambiguous
        else:
            # Other global options can redirect the checkout or alter semantics.
            ambiguous = True
            for later in range(index + 1, len(words)):
                if words[later] in ("push", "merge"):
                    return words[later], cwd, words[later + 1:], True
            return None, cwd, [], True
    return None, cwd, [], ambiguous


def _push_target(repo: Path, args: list[str]) -> str | None:
    """Require one source that resolves to the current approved local HEAD."""
    allowed = {"-u", "--set-upstream", "-f", "--force", "--force-with-lease",
               "--quiet", "-q", "--verbose", "-v", "--porcelain", "--atomic",
               "--signed", "--no-signed", "--no-verify", "--progress"}
    positionals: list[str] = []
    for arg in args:
        if arg in allowed or arg.startswith("--force-with-lease=") or arg.startswith("--signed="):
            continue
        if arg.startswith("-"):
            raise AdapterError("This push form is unsupported; use one literal current-HEAD refspec.")
        positionals.append(arg)
    if len(positionals) > 2:
        raise AdapterError("Review and push one current-HEAD source at a time.")
    branch = _git(repo, "symbolic-ref", "--quiet", "--short", "HEAD", missing_ok=True)
    remote = positionals[0] if positionals else (
        (_git(repo, "config", "--get", f"branch.{branch}.pushRemote", missing_ok=True) if branch else "")
        or _git(repo, "config", "--get", "remote.pushDefault", missing_ok=True)
        or (_git(repo, "config", "--get", f"branch.{branch}.remote", missing_ok=True) if branch else "")
        or "origin"
    )
    # A named remote may publish multiple refs through repository configuration.
    if ":" not in remote and "/" not in remote and not remote.startswith("."):
        if _git(repo, "config", "--bool", "--get", f"remote.{remote}.mirror", missing_ok=True) == "true":
            raise AdapterError("Mirror pushes require a separate reviewed release path.")
        configured = _git(repo, "config", "--get-all", f"remote.{remote}.push", missing_ok=True)
    else:
        configured = ""
    if _git(repo, "config", "--bool", "--get", "push.followTags", missing_ok=True) == "true":
        raise AdapterError("Automatic tag publishing is outside this candidate approval.")
    if len(positionals) == 2:
        source = positionals[1]
    elif configured:
        if "\n" in configured:
            raise AdapterError("Configured push refspecs publish multiple sources.")
        source = configured
    else:
        mode = _git(repo, "config", "--get", "push.default", missing_ok=True) or "simple"
        if mode not in ("simple", "upstream", "current") or not branch:
            raise AdapterError("Use an explicit literal HEAD refspec for this push configuration.")
        source = branch
    if source.count(":") > 1 or (":" in source and not source.split(":", 1)[1]) or any(c in source for c in "*?["):
        raise AdapterError("The push refspec is malformed or publishes multiple refs.")
    source = source.lstrip("+").split(":", 1)[0]
    head = _git(repo, "rev-parse", "--verify", "HEAD")
    if source not in {"HEAD", branch, f"refs/heads/{branch}", head} or not source:
        raise AdapterError("The push source is not the reviewed current HEAD.")
    return _name(remote) or _name(_git(repo, "remote", "get-url", "--push", remote, missing_ok=True))


def _dry_run_push(args: list[str]) -> bool:
    # An option such as --receive-pack can consume the following --dry-run as
    # its value, so merely finding the text anywhere in argv is insufficient.
    flags = {"--dry-run", "-n", "--all", "--tags", "--mirror", "--delete", "-d",
             "-u", "--set-upstream", "-f", "--force", "--force-with-lease",
             "--quiet", "-q", "--verbose", "-v", "--porcelain", "--atomic",
             "--signed", "--no-signed", "--no-verify", "--progress", "--follow-tags"}
    return (any(arg in {"--dry-run", "-n"} for arg in args)
            and all(not arg.startswith("-") or arg in flags
                    or arg.startswith(("--force-with-lease=", "--signed=")) for arg in args))


def _approve(repo: Path, author_id: str | None, head_ref: str | None = None) -> dict:
    try:
        if head_ref is None:
            return verify(repo, author_id=author_id)
        else:
            return verify(repo, author_id=author_id, head_ref=head_ref)
    except GateError as exc:
        raise AdapterError(str(exc)) from exc
    except Exception as exc:
        raise AdapterError(f"The local verifier failed ({type(exc).__name__}).") from exc


def _reviewed_ff_merge(repo: Path, args: list[str], author_id: str | None) -> None:
    if len(args) != 2 or args[0] != "--ff-only" or args[1].startswith("-"):
        raise AdapterError(
            "Use a reviewed `git merge --ff-only <source-ref>` candidate, or the trusted GitHub gate "
            "for a resulting merge tree. Local HEAD approval cannot approve a new merge result."
        )
    source = args[1]
    if _git(repo, "status", "--porcelain", "--untracked-files=normal"):
        raise AdapterError("The fast-forward merge requires a clean working tree.")
    _git(repo, "merge-base", "--is-ancestor", "HEAD", source)
    _approve(repo, author_id, head_ref=source)


def _pr_create(repo: Path, author_id: str | None, name: str | None = None,
               head: str | None = None, base: str | None = None) -> None:
    """Local convenience only: tracking refs are not live server attestations."""
    branch = _git(repo, "symbolic-ref", "--quiet", "--short", "HEAD")
    if not branch or (head is not None and head != branch):
        raise AdapterError("The PR head must be the literal current local branch; fork or alternate heads require a trusted server check.")
    origin = _name(_git(repo, "remote", "get-url", "origin"))
    if not origin or (name is not None and name.casefold() != origin.casefold()):
        raise AdapterError("The PR repository does not match the registered checkout's GitHub origin.")
    sha = _git(repo, "rev-parse", "--verify", "HEAD")
    tracking = _git(repo, "rev-parse", "--verify", f"refs/remotes/origin/{branch}")
    if tracking != sha:
        raise AdapterError("Push the reviewed branch before creating the PR; its local origin tracking ref must match HEAD.")
    report = _approve(repo, author_id)
    reviewed_base = report.get("candidate", {}).get("base_ref")
    if isinstance(reviewed_base, str):
        for prefix in ("refs/remotes/origin/", "refs/heads/", "origin/"):
            if reviewed_base.startswith(prefix):
                reviewed_base = reviewed_base[len(prefix):]
                break
    if not isinstance(base, str) or not base:
        suggestion = f" --base {reviewed_base}" if isinstance(reviewed_base, str) else " --base <reviewed-base>"
        raise AdapterError(f"Supply an explicit reviewed PR base ({suggestion.strip()}); the server default is not established by local approval.")
    if base != reviewed_base:
        raise AdapterError("The explicit PR base does not match the independently reviewed base.")


def _denial(detail: str, repo: Path | None = None) -> str:
    location = f" in {repo}" if repo else ""
    return (f"Run $pre-flight{location} for a fresh independent approval of the exact release candidate. "
            + " ".join(detail.split())[:700])


def evaluate(payload: Any, registry_path: Path = REGISTRY_PATH) -> str | None:
    """Return a supported denial reason, or None to leave ordinary tools alone."""
    if not isinstance(payload, dict):
        return _denial("The hook input is malformed.")
    tool = payload.get("tool_name", "")
    if not isinstance(tool, str):
        return _denial("The hook tool name is malformed.")
    lowered = tool.casefold()
    is_shell = lowered in {"bash", "exec_command", "functions.exec_command"}
    is_github = "github" in lowered and any(
        lowered.endswith(suffix) for suffix in
        ("create_pull_request", "merge_pull_request", "create_pr", "merge_pr", "enable_auto_merge")
    )
    if not is_shell and not is_github:
        return None
    arguments = payload.get("tool_input")
    if not isinstance(arguments, dict):
        return _denial("The release tool arguments cannot be inspected.")
    command = arguments.get("command", arguments.get("cmd")) if is_shell else None
    if is_shell and isinstance(command, str) and not _shell_release_hint(command):
        return None
    try:
        registry = Registry.read(registry_path)
        cwd = _literal_path(payload.get("cwd"))
        workdir = arguments.get("workdir")
        cwd = _literal_path(str(cwd) if workdir is None else workdir, cwd)
        author_id = payload.get("session_id")
        if not isinstance(author_id, str) or not author_id.strip():
            author_id = None
        if is_github:
            name = _name(_argument(arguments, "repository_full_name", "repo_full_name", "repository")
                         or arguments.get("repo"))
            if not name and arguments.get("owner") and arguments.get("repo"):
                name = _name(f"{arguments['owner']}/{arguments['repo']}")
            mapped = registry.mapped(name)
            if not mapped and name and not registry.contains(cwd):
                return None
            if not mapped and not registry.contains(cwd):
                raise AdapterError("The remote release repository cannot be identified.")
            if lowered.endswith(("merge_pull_request", "merge_pr", "enable_auto_merge")):
                return _denial(
                    "The actual server SHA and trusted GitHub gate must be checked before merging. "
                    "A local receipt alone cannot approve this remote PR operation.", mapped or cwd
                )
            if not name:
                raise AdapterError("The PR repository target must be explicit and literal.")
            if arguments.get("head_repo") is not None:
                raise AdapterError("Cross-repository PR heads require a trusted server identity check.")
            head = _argument(arguments, "head", "head_branch")
            if head is None:
                raise AdapterError("The remote PR head branch must be explicit and literal.")
            _pr_create(_repository(mapped or cwd), author_id, name,
                       head, _argument(arguments, "base", "base_branch"))
            return None
        if not isinstance(command, str):
            return _denial("The shell command cannot be inspected.") if registry.contains(cwd) else None
        statements, ambiguous = _lex(command)
        releases: list[tuple[str, Path, list[str], bool]] = []
        other_statement = False
        safe_release_form = False
        all_resolved = True
        for words in statements:
            executable = _executable(words[0])
            if executable in {"cd", "chdir", "set-location"}:
                path_args = words[1:]
                if path_args[:1] in (["-LiteralPath"], ["-Path"], ["/d"]):
                    path_args = path_args[1:]
                if len(path_args) != 1:
                    raise AdapterError("The command changes directory ambiguously.")
                cwd = _literal_path(path_args[0], cwd)
            elif executable == "git":
                kind, directory, args, unsupported = _git_action(words, cwd)
                if kind:
                    if kind == "push" and _dry_run_push(args) and not ambiguous and not unsupported:
                        safe_release_form = True
                        continue
                    if kind == "merge" and args in (["--abort"], ["--quit"]):
                        safe_release_form = True
                        continue
                    releases.append((kind, directory, args, unsupported))
                else:
                    other_statement = True
                    all_resolved = all_resolved and not unsupported
            elif executable == "gh":
                index = next((i for i in range(1, len(words) - 1)
                              if words[i] == "pr" and words[i + 1] in {"create", "merge"}), None)
                if index is not None:
                    releases.append(("pr_" + words[index + 1], cwd, words[1:], False))
                else:
                    other_statement = True
                    all_resolved = False
            else:
                other_statement = True
                all_resolved = False
        if not releases:
            if all_resolved or (safe_release_form and not other_statement):
                return None
            # Quoted examples printed by an ordinary echo are harmless.
            if statements and all(_executable(words[0]) in {"echo", "printf", "write-output", "write-host"}
                                  for words in statements):
                return None
            if registry.contains(cwd) and _shell_release_hint(command):
                raise AdapterError("This shell release form cannot be resolved safely; use a literal direct command.")
            return None
        for kind, directory, args, unsupported in releases:
            named = None
            if kind.startswith("pr_"):
                option, present = _option(args, "--repo", "-R")
                if present:
                    named = _name(option)
                    if named is None:
                        raise AdapterError("The PR repository target is malformed.")
            mapped = registry.mapped(named)
            in_scope = registry.contains(directory) or mapped is not None
            if not in_scope:
                continue
            if ambiguous or unsupported or other_statement:
                raise AdapterError("This scoped release command has unsupported shell syntax or combined operations; use a direct literal command.")
            repo = _repository(mapped or directory)
            if kind == "push":
                _push_target(repo, args)
                _approve(repo, author_id)
            elif kind == "merge":
                _reviewed_ff_merge(repo, args, author_id)
            elif kind == "pr_merge":
                raise AdapterError("Check the PR's actual server SHA and trusted GitHub gate before merging; local approval does not establish remote merge readiness.")
            else:
                if any(arg in {"--web", "-w", "--recover"} or arg.startswith("--recover=") for arg in args):
                    raise AdapterError("Interactive or recovered PR targets require the trusted GitHub gate.")
                head, _ = _option(args, "--head", "-H")
                base, _ = _option(args, "--base", "-B")
                _pr_create(repo, author_id, named, head, base)
        return None
    except Exception as exc:
        # Explicit, supported denial is essential: a hook crash can fail open.
        detail = str(exc) if isinstance(exc, AdapterError) else f"The release guard failed ({type(exc).__name__})."
        return _denial(detail)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        reason = evaluate(payload)
    except Exception:
        reason = _denial("The hook input or local guard could not be read.")
    if reason:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse", "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
