"""Validate candidate-bound local reviews. Not reviewer authentication."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import struct
import zlib

SCHEMA = 1
AREAS = {"correctness", "security", "maintainability", "performance", "product", "tests", "accessibility"}
DOC_SUFFIXES = {".md", ".rst", ".adoc"}


class GateError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def git(repo, *args):
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, timeout=20)
    if result.returncode:
        raise GateError("Cannot establish Git candidate: " + result.stderr.decode(errors="replace").strip())
    return result.stdout.decode("utf-8", errors="surrogateescape").strip()


def root_of(repo):
    return Path(git(repo, "rev-parse", "--show-toplevel")).resolve()


def state_dir(repo):
    path = Path(git(repo, "rev-parse", "--git-path", "pre-flight"))
    return (path if path.is_absolute() else repo / path).resolve()


def read_json(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise GateError(f"Missing or invalid JSON: {path}") from error
    require(isinstance(value, dict), f"Expected a JSON object: {path}")
    return value


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def policy_digest():
    skill = Path(__file__).resolve().parents[1]
    paths = [skill / "SKILL.md", *sorted((skill / "scripts").glob("*.py")), *sorted((skill / "references").glob("*.md"))]
    value = hashlib.sha256()
    for path in paths:
        if path.name.startswith("test_"):
            continue
        value.update(path.relative_to(skill).as_posix().encode())
        value.update(b"\0")
        value.update(path.read_bytes().replace(b"\r\n", b"\n"))
    return value.hexdigest()


def snapshot(repo, base_ref, head_ref="HEAD"):
    repo = root_of(repo)
    require(not git(repo, "status", "--porcelain=v1", "--untracked-files=all"), "Commit or isolate the candidate first; the working tree has changes.")
    head = git(repo, "rev-parse", "--verify", f"{head_ref}^{{commit}}")
    base = git(repo, "rev-parse", "--verify", f"{base_ref}^{{commit}}")
    return {"head_sha": head, "tree_sha": git(repo, "rev-parse", f"{head}^{{tree}}"),
            "base_sha": base, "base_ref": base_ref, "config_sha256": digest(state_dir(repo) / "config.json"),
            "policy_sha256": policy_digest()}


def evidence(repo, item):
    require(isinstance(item, dict), "Evidence must identify a file and its SHA-256.")
    relative = item.get("path", "")
    require(isinstance(relative, str) and bool(relative), "Evidence path is missing.")
    base = state_dir(repo)
    path = (base / relative).resolve()
    require(path.is_relative_to(base) and path.is_file(), "Evidence must exist inside this worktree's private pre-flight directory.")
    require(digest(path) == item.get("sha256"), "Evidence changed after review: " + relative)
    return path


def test_outcome(log):
    """Read supported runner summaries, not exit-code/message claims."""
    unit = re.search(r"Ran (\d+) tests? in ", log)
    if unit:
        summary = re.search(r"^(OK|FAILED)(?: \(([^\n]*)\))?\s*$", log, re.M)
        require(summary is not None, "Unittest result summary is missing.")
        counts = {key: int(value) for key, value in re.findall(r"(failures|errors|skipped)=(\d+)", summary.group(2) or "")}
        total, failed, errors, skipped = int(unit[1]), counts.get("failures", 0), counts.get("errors", 0), counts.get("skipped", 0)
        return {"total": total, "passed": total - failed - errors - skipped, "failed": failed, "errors": errors, "skipped": skipped}
    totals = {}
    for count, status in re.findall(r"\b(\d+) (passed|failed|skipped|errors?|timed out|interrupted|flaky)\b", log):
        totals[status] = int(count)
    require(bool(totals), "No supported test summary. Use verbose unittest, Playwright line, or pytest output.")
    errors = sum(totals.get(key, 0) for key in ["error", "errors", "timed out", "interrupted", "flaky"])
    passed, failed, skipped = (totals.get(key, 0) for key in ["passed", "failed", "skipped"])
    return {"total": passed + failed + errors + skipped, "passed": passed, "failed": failed, "errors": errors, "skipped": skipped}


def validate_capture(data, width):
    """Check complete PNG chunks, checksums and viewport width."""
    require(data.startswith(b"\x89PNG\r\n\x1a\n"), "UI evidence must be a complete PNG capture.")
    offset, kinds, header = 8, [], None
    while offset + 12 <= len(data):
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        end = offset + 12 + size
        require(end <= len(data), "UI capture is truncated.")
        kind, content = data[offset + 4:offset + 8], data[offset + 8:offset + 8 + size]
        crc = struct.unpack(">I", data[offset + 8 + size:end])[0]
        require(zlib.crc32(kind + content) & 0xFFFFFFFF == crc, "UI capture has an invalid chunk checksum.")
        kinds.append(kind)
        if kind == b"IHDR":
            require(len(kinds) == 1 and size == 13, "Invalid capture header.")
            header = struct.unpack(">IIBBBBB", content)
        offset = end
        if kind == b"IEND":
            require(size == 0 and offset == len(data), "Invalid capture end.")
            break
    require(header is not None and b"IDAT" in kinds and kinds[-1:] == [b"IEND"], "Incomplete PNG capture.")
    require(header[0] == width and header[1] > 0, "Capture dimensions do not match the reviewed viewport.")


def load_check(repo, reference, candidate, kind):
    record = read_json(evidence(repo, reference))
    require(record.get("schema_version") == SCHEMA and record.get("candidate") == candidate, "Check belongs to another candidate/policy.")
    require(record.get("kind") == kind, "Wrong check kind: " + kind)
    log = evidence(repo, record.get("log", {})).read_text(encoding="utf-8", errors="replace")
    require(record.get("test_id") and record["test_id"] in log, "Check log must identify the selected test.")
    require(not re.search(r"(?:\b0 tests?\b|No tests (?:found|collected)|collected 0 items)", log, re.I), "Empty selections are not verification.")
    outcome = test_outcome(log)
    require(outcome["total"] > 0 and outcome["errors"] == 0, "A test error is not a passing assertion or sensitivity result.")
    if kind == "mutant":
        require(record.get("exit_code") == 1 and record.get("expected_assertion") and record["expected_assertion"] in log, "Mutant did not fail its intended assertion.")
        require(outcome == {"total": 1, "passed": 0, "failed": 1, "errors": 0, "skipped": 0}, "Mutant must select one real failing assertion, without errors or skips.")
        require(re.search(r"(?:AssertionError|\bexpect\(|\bassertion\b.*failed|\bAssert\.)", log, re.I), "Mutant result is not an assertion failure.")
        require(not re.search(r"(?:browserType\.launch:|Executable doesn't exist|TimeoutError:|Error: Timed out|ECONNREFUSED|MODULE_NOT_FOUND)", log), "Infrastructure failure is not regression sensitivity.")
    else:
        require(record.get("exit_code") == 0, "Required check did not pass: " + kind)
        require(outcome["passed"] > 0 and outcome["failed"] == 0, "Required checks must execute passing assertions.")
        if kind in {"control", "restored"}:
            require(outcome == {"total": 1, "passed": 1, "failed": 0, "errors": 0, "skipped": 0}, "Control/restored run must select one passing test, not a skipped case.")
    return record


def verify(repo: Path, author_id: str | None = None, head_ref: str | None = None) -> dict:
    repo = root_of(repo)
    config = read_json(state_dir(repo) / "config.json")
    require(config.get("schema_version") == SCHEMA, "Unsupported project config.")
    candidate = snapshot(repo, config["base_ref"], head_ref or "HEAD")
    report = read_json(state_dir(repo) / "approvals" / (candidate["head_sha"] + ".json"))
    require(report.get("schema_version") == SCHEMA and report.get("candidate") == candidate, "Flight Bot approval is missing or stale for candidate/base/policy.")
    reviewer = report.get("reviewer", {})
    require(reviewer.get("fresh_context") is True and isinstance(reviewer.get("id"), str) and reviewer["id"].strip(), "Fresh independent reviewer is required.")
    require(isinstance(reviewer.get("implementer_id"), str) and reviewer["implementer_id"].strip(), "Implementer identity is missing.")
    require(reviewer["id"] != reviewer["implementer_id"] and reviewer["id"] != author_id, "Implementer/current agent cannot approve its own candidate.")
    require(report.get("verdict") == "approve", "Flight Bot has not approved this candidate.")
    evidence(repo, report.get("review_notes", {}))
    require(isinstance(report.get("limitations"), list) and bool(report["limitations"]), "State actual review/test limits.")
    areas = report.get("areas", {})
    require(isinstance(areas, dict) and AREAS <= areas.keys(), "Full review coverage is incomplete.")
    for area in AREAS:
        item = areas[area]
        require(isinstance(item, dict) and item.get("status") in {"reviewed", "not_applicable"} and bool(str(item.get("reason", "")).strip()), "Area needs result and rationale: " + area)
    findings = report.get("findings")
    require(isinstance(findings, list), "Findings must be an explicit list.")
    ids = set()
    for item in findings:
        require(isinstance(item, dict) and item.get("id") and item["id"] not in ids, "Finding IDs must be unique.")
        ids.add(item["id"])
        severity, status = item.get("severity"), item.get("status")
        require(severity in {"need_to_fix", "should_fix", "nit"}, "Unknown severity.")
        if severity != "nit":
            require(status in {"fixed", "technically_disproven"} and item.get("reviewer_confirmed") is True, "Unresolved blocking finding: " + item["id"])
            evidence(repo, item.get("evidence", {}))
        else:
            require(status in {"fixed", "skipped"}, "Resolve or explicitly skip the nit: " + item["id"])
        require(bool(str(item.get("reason", "")).strip()), "Finding disposition needs a reason.")
    paths = git(repo, "diff", "--name-only", "--diff-filter=ACDMRTUXB", candidate["base_sha"], candidate["head_sha"]).splitlines()
    software = any(Path(path).suffix.lower() not in DOC_SUFFIXES for path in paths)
    checks = report.get("checks", [])
    require(isinstance(checks, list), "Checks must be a list.")
    for check in checks:
        load_check(repo, check, candidate, "test")
    require(bool(checks) or not software, "Changed software requires passing relevant tests.")
    probes = report.get("sensitivity", [])
    require(isinstance(probes, list), "Sensitivity must be a list.")
    for probe in probes:
        require(isinstance(probe, dict) and probe.get("risk"), "Name the regression risk.")
        control = load_check(repo, probe.get("control", {}), candidate, "control")
        mutant = load_check(repo, probe.get("mutant", {}), candidate, "mutant")
        restored = load_check(repo, probe.get("restored", {}), candidate, "restored")
        require(control["test_id"] == mutant["test_id"] == restored["test_id"], "Sensitivity must select the same test.")
        require(control["finished_at"] <= mutant["started_at"] <= mutant["finished_at"] <= restored["started_at"], "Require pristine pass, intended failure, restored pass in order.")
    require(bool(probes) or not software, "Changed software requires a demonstrated representative regression.")
    ui = report.get("ui", {})
    if config.get("ui"):
        require(ui.get("applicable") is True, "Desktop/mobile review is required for this interface candidate.")
        native = config.get("ui_mode", "web") == "native"
        devices = [("desktop", lambda w: w > 0)] if native else [("desktop", lambda w: w >= 1024), ("mobile", lambda w: 0 < w <= 480)]
        for device, valid in devices:
            item = ui.get(device, {})
            require(type(item.get("width")) is int and valid(item["width"]), "Missing " + device + " viewport.")
            capture = evidence(repo, item.get("capture", {})).read_bytes()
            validate_capture(capture, item["width"])
            require(isinstance(item.get("journey"), str) and bool(item["journey"].strip()), "Name the actual reviewed journey.")
        required_inputs = {"pointer", "keyboard"} if native else {"pointer", "keyboard", "touch"}
        require(set(ui.get("inputs", [])) >= required_inputs, "Review the required pointer, keyboard and touch behavior.")
        if native:
            mobile = ui.get("mobile", {})
            require(mobile.get("not_applicable") is True and isinstance(mobile.get("reason"), str) and mobile["reason"].strip(), "Native mobile non-applicability needs reviewer rationale.")
        require(ui.get("motion_reviewed") is True, "Review actual motion and reduced-motion behavior, not only still images.")
    else:
        require(ui.get("applicable") is False and bool(str(ui.get("reason", "")).strip()), "Explain why rendered UI review is not applicable.")
    return report


def run_check(args):
    repo = root_of(args.repo)
    config = read_json(state_dir(repo) / "config.json")
    candidate = snapshot(repo, config["base_ref"])
    require(re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", args.name), "Use a simple unique check name.")
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    require(bool(command), "Provide command arguments after --.")
    started = datetime.now(timezone.utc).isoformat()
    try:
        result = subprocess.run(command, cwd=repo, capture_output=True, timeout=args.timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise GateError("Check infrastructure failed; no passing record created.") from error
    require(snapshot(repo, config["base_ref"]) == candidate, "Check changed the candidate or left a dirty tree.")
    directory = state_dir(repo) / "checks"
    directory.mkdir(parents=True, exist_ok=True)
    record_path, log_path = directory / (args.name + ".json"), directory / (args.name + ".log")
    require(not record_path.exists() and not log_path.exists(), "Check names are immutable; choose a new name.")
    log_path.write_bytes(result.stdout + b"\n" + result.stderr)
    record = {"schema_version": SCHEMA, "candidate": candidate, "kind": args.kind, "command": command,
              "test_id": args.test_id, "exit_code": result.returncode, "expected_assertion": args.expected_assertion,
              "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(),
              "log": {"path": log_path.relative_to(state_dir(repo)).as_posix(), "sha256": digest(log_path)}}
    write_json(record_path, record)
    return {"path": record_path.relative_to(state_dir(repo)).as_posix(), "sha256": digest(record_path), "exit_code": result.returncode}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    init = sub.add_parser("init")
    init.add_argument("--repo", type=Path, required=True)
    init.add_argument("--base-ref", required=True)
    flags = init.add_mutually_exclusive_group(required=True)
    flags.add_argument("--ui", action="store_true")
    flags.add_argument("--native-ui", action="store_true")
    flags.add_argument("--no-ui", action="store_true")
    init.add_argument("--reason")
    for name in ["snapshot", "verify"]:
        child = sub.add_parser(name)
        child.add_argument("--repo", type=Path, required=True)
        child.add_argument("--head-ref", default="HEAD")
        child.add_argument("--author-id")
    run = sub.add_parser("run-check")
    run.add_argument("--repo", type=Path, required=True)
    run.add_argument("--kind", choices=["test", "control", "mutant", "restored"], required=True)
    run.add_argument("--name", required=True)
    run.add_argument("--test-id", required=True)
    run.add_argument("--expected-assertion", default="")
    run.add_argument("--timeout", type=int, default=600)
    run.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if args.action == "init":
            repo = root_of(args.repo)
            git(repo, "rev-parse", "--verify", f"{args.base_ref}^{{commit}}")
            path = state_dir(repo) / "config.json"
            require(not path.exists(), "Already configured; review existing config before changing the gate.")
            require(not (args.no_ui or args.native_ui) or bool(args.reason and args.reason.strip()), "Non-web UI applicability requires an explicit --reason.")
            write_json(path, {"schema_version": SCHEMA, "base_ref": args.base_ref, "ui": args.ui or args.native_ui,
                             "ui_mode": "native" if args.native_ui else "web" if args.ui else "none",
                             "reason": args.reason or "Responsive web interface"})
            print(json.dumps({"config": str(path)}))
        elif args.action == "snapshot":
            config = read_json(state_dir(root_of(args.repo)) / "config.json")
            print(json.dumps(snapshot(args.repo, config["base_ref"], args.head_ref)))
        elif args.action == "run-check":
            print(json.dumps(run_check(args)))
        else:
            report = verify(args.repo, args.author_id, args.head_ref)
            print(json.dumps({"verdict": "approve", "candidate": report["candidate"], "reviewer": report["reviewer"]["id"], "trust": "local convention, not authenticated GitHub approval"}))
        return 0
    except (GateError, KeyError, TypeError, ValueError, OSError) as error:
        print("Pre-flight blocked: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
