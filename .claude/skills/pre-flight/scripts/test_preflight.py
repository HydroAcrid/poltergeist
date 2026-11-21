"""Independent integration tests, using only disposable Git repositories.

Receipts here are explicitly synthetic fixtures. No fixture reviewer identity
grants approval to a real candidate. Commands execute actual unittest assertions
and keep their deliberate mutant inside each temporary repository's Git-private
directory. No network, hooks, real project files or external settings are used.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import struct
import sys
import tempfile
import unittest
import zlib


SKILL = Path(__file__).resolve().parents[1]
AREAS = ("correctness", "security", "maintainability", "performance", "product", "tests", "accessibility")
TEST_ID = "test_primary_route"


def fixture_png(width, height):
    """Complete synthetic images; dimensions match each viewport fixture."""
    def chunk(kind, value):
        return struct.pack(">I", len(value)) + kind + value + struct.pack(">I", zlib.crc32(kind + value))
    raw = (b"\0" + b"\xff\xff\xff" * width) * height
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


class PreflightIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template_temp = tempfile.TemporaryDirectory(prefix="preflight-template-")
        cls.template = Path(cls.template_temp.name) / "repo"
        cls.template.mkdir()
        cls._git_at(cls.template, "init", "--quiet", "-b", "candidate")
        for key, value in (("user.name", "Isolated Preflight Test"),
                           ("user.email", "isolated@example.invalid"),
                           ("commit.gpgsign", "false"),
                           ("core.autocrlf", "false"),
                           ("core.hooksPath", str(Path(cls.template_temp.name) / "no-hooks"))):
            cls._git_at(cls.template, "config", key, value)
        (cls.template / "README.md").write_text("# Isolated fixture\n", encoding="utf-8")
        cls._git_at(cls.template, "add", "README.md")
        cls._git_at(cls.template, "commit", "--quiet", "-m", "Fixture base")
        cls._git_at(cls.template, "branch", "review-base")
        (cls.template / "README.md").write_text("# Isolated fixture\n\nDocumentation update.\n", encoding="utf-8")
        cls._git_at(cls.template, "add", "README.md")
        cls._git_at(cls.template, "commit", "--quiet", "-m", "Documentation candidate")

    @classmethod
    def tearDownClass(cls):
        cls.template_temp.cleanup()

    @staticmethod
    def _git_at(repo, *args):
        result = subprocess.run(["git", "-C", str(repo), *args], check=True,
                                capture_output=True, text=True, encoding="utf-8")
        return result.stdout.strip()

    def git(self, *args):
        return self._git_at(self.repo, *args)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="preflight-integration-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.repo = self.root / "Repository With Spaces"
        shutil.copytree(self.template, self.repo)
        self.skill = self.root / "isolated-skill"
        (self.skill / "scripts").mkdir(parents=True)
        (self.skill / "references").mkdir()
        shutil.copy2(SKILL / "SKILL.md", self.skill / "SKILL.md")
        for path in (SKILL / "scripts").glob("*.py"):
            if not path.name.startswith("test_"):
                shutil.copy2(path, self.skill / "scripts" / path.name)
        for path in (SKILL / "references").glob("*.md"):
            shutil.copy2(path, self.skill / "references" / path.name)
        self.script = self.skill / "scripts" / "preflight.py"
        self.private = self.repo / ".git" / "pre-flight"
        self.cli_ok("init", "--base-ref", "review-base", "--no-ui", "--reason", "CLI/documentation fixture")
        self.candidate = json.loads(self.cli_ok("snapshot").stdout)
        self.report = self.new_report()

    def cli(self, action, *args):
        environment = os.environ.copy()
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        return subprocess.run([sys.executable, "-B", str(self.script), action,
                               "--repo", str(self.repo), *map(str, args)],
                              capture_output=True, text=True, encoding="utf-8",
                              env=environment, timeout=40)

    def cli_ok(self, action, *args):
        result = self.cli(action, *args)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        return result

    def evidence(self, name, value):
        path = self.private / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value if isinstance(value, bytes) else value.encode("utf-8"))
        return self.reference(path)

    def reference(self, path):
        return {"path": path.relative_to(self.private).as_posix(),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}

    def new_report(self):
        return {"schema_version": 1, "candidate": copy.deepcopy(self.candidate),
                "reviewer": {"id": "synthetic-fixture-reviewer", "implementer_id": "synthetic-fixture-author", "fresh_context": True},
                "verdict": "approve", "review_notes": self.evidence("review/final.md", "Synthetic fixture only.\n"),
                "areas": {area: {"status": "reviewed", "reason": "Isolated contract fixture."} for area in AREAS},
                "limitations": ["Synthetic fixture; grants no real approval."],
                "findings": [], "checks": [], "sensitivity": [],
                "ui": {"applicable": False, "reason": "This fixture has no rendered interface."}}

    def save_report(self):
        path = self.private / "approvals" / (self.candidate["head_sha"] + ".json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.report), encoding="utf-8")
        return path

    def verify(self):
        self.save_report()
        return self.cli("verify", "--author-id", "synthetic-fixture-author")

    def assert_blocked(self, result=None, text=None):
        result = self.verify() if result is None else result
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("Pre-flight blocked:", result.stderr)
        if text:
            self.assertIn(text, result.stderr)

    def install_software(self):
        (self.repo / "app.py").write_text(
            "from pathlib import Path\n\n"
            "def primary_route():\n"
            "    mutant = Path(__file__).parent / '.git' / 'pre-flight' / 'mutation.flag'\n"
            "    if (mutant.parent / 'crash.flag').exists():\n"
            "        raise RuntimeError('primary route must reach home')\n"
            "    return '/broken' if mutant.exists() else '/home'\n", encoding="utf-8")
        (self.repo / "test_app.py").write_text(
            "import unittest\nfrom pathlib import Path\nfrom app import primary_route\n\n"
            "class RouteTests(unittest.TestCase):\n"
            "    def test_primary_route(self):\n"
            "        if (Path(__file__).parent / '.git' / 'pre-flight' / 'skip.flag').exists():\n"
            "            self.skipTest('fixture skip')\n"
            "        self.assertEqual(primary_route(), '/home', 'primary route must reach home')\n",
            encoding="utf-8")
        self.git("add", "app.py", "test_app.py")
        self.git("commit", "--quiet", "-m", "Software fixture")
        self.candidate = json.loads(self.cli_ok("snapshot").stdout)
        self.report = self.new_report()

    def run_record(self, kind, name, command=None, assertion=""):
        command = command or [sys.executable, "-B", "-m", "unittest", "-v", "test_app.RouteTests.test_primary_route"]
        return json.loads(self.cli_ok("run-check", "--kind", kind, "--name", name,
                                      "--test-id", TEST_ID, "--expected-assertion", assertion,
                                      "--", *command).stdout)

    def add_real_checks(self):
        self.report["checks"] = [self.run_record("test", "required")]
        control = self.run_record("control", "control")
        mutant_path = self.private / "mutation.flag"
        mutant_path.write_text("isolated deliberate regression", encoding="utf-8")
        try:
            mutant = self.run_record("mutant", "mutant", assertion="primary route must reach home")
        finally:
            mutant_path.unlink()
        restored = self.run_record("restored", "restored")
        self.report["sensitivity"] = [{"risk": "Wrong primary route loses the home journey",
                                       "control": control, "mutant": mutant, "restored": restored}]

    def change_record(self, reference, change):
        path = self.private / reference["path"]
        record = json.loads(path.read_text(encoding="utf-8"))
        change(record)
        path.write_text(json.dumps(record), encoding="utf-8")
        reference.update(self.reference(path))

    def ui_config(self):
        path = self.private / "config.json"
        config = json.loads(path.read_text(encoding="utf-8"))
        config.update(ui=True, ui_mode="web", reason="Rendered content application")
        path.write_text(json.dumps(config), encoding="utf-8")
        self.candidate = json.loads(self.cli_ok("snapshot").stdout)
        self.report = self.new_report()

    def add_ui(self):
        self.report["ui"] = {
            "applicable": True, "inputs": ["pointer", "keyboard", "touch"], "motion_reviewed": True,
            "desktop": {"width": 1440, "capture": self.evidence("ui/desktop.png", fixture_png(1440, 900)), "journey": "Synthetic desktop route fixture"},
            "mobile": {"width": 390, "capture": self.evidence("ui/mobile.png", fixture_png(390, 844)), "journey": "Synthetic mobile route fixture"}}

    def native_config(self):
        (self.private / "config.json").unlink()
        self.cli_ok("init", "--base-ref", "review-base", "--native-ui", "--reason", "Desktop-only native fixture application")
        self.candidate = json.loads(self.cli_ok("snapshot").stdout)
        self.report = self.new_report()

    def native_ui(self):
        self.add_ui()
        self.report["ui"]["inputs"] = ["pointer", "keyboard"]
        self.report["ui"]["mobile"] = {"not_applicable": True, "reason": "Native desktop product has no mobile interface."}

    def test_documentation_approval_is_bound_and_reports_trust_limit(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["candidate"], self.candidate)
        self.assertIn("not authenticated", value["trust"])

    def test_missing_approval_blocks(self):
        self.assert_blocked(self.cli("verify"), "Missing or invalid JSON")

    def test_stale_head_blocks(self):
        self.save_report()
        (self.repo / "README.md").write_text("New candidate\n", encoding="utf-8")
        self.git("add", "README.md")
        self.git("commit", "--quiet", "-m", "Changed head")
        self.assert_blocked(self.cli("verify"))

    def test_stale_base_blocks(self):
        self.save_report()
        self.git("update-ref", "refs/heads/review-base", "HEAD")
        self.assert_blocked(self.cli("verify"), "stale")

    def test_stale_policy_blocks(self):
        self.save_report()
        with (self.skill / "SKILL.md").open("a", encoding="utf-8") as handle:
            handle.write("\nChanged isolated policy.\n")
        self.assert_blocked(self.cli("verify"), "stale")

    def test_stale_config_blocks(self):
        self.save_report()
        with (self.private / "config.json").open("a", encoding="utf-8") as handle:
            handle.write("\n")
        self.assert_blocked(self.cli("verify"), "stale")

    def test_missing_candidate_binding_blocks(self):
        for key in tuple(self.candidate):
            with self.subTest(key=key):
                value = self.report["candidate"].pop(key)
                self.assert_blocked(text="stale")
                self.report["candidate"][key] = value

    def test_changed_and_missing_evidence_block(self):
        self.save_report()
        path = self.private / self.report["review_notes"]["path"]
        path.write_text("Changed after review", encoding="utf-8")
        self.assert_blocked(self.cli("verify"), "Evidence changed")
        path.unlink()
        self.assert_blocked(self.cli("verify"), "Evidence must exist")

    def test_evidence_cannot_escape_private_directory(self):
        path = self.root / "outside.md"
        path.write_text("Outside evidence", encoding="utf-8")
        self.report["review_notes"] = {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        self.assert_blocked(text="Evidence must exist inside")

    def test_dirty_and_untracked_candidates_block(self):
        self.save_report()
        path = self.repo / "untracked.txt"
        path.write_text("unreviewed", encoding="utf-8")
        self.assert_blocked(self.cli("verify"), "working tree has changes")
        path.unlink()
        (self.repo / "README.md").write_text("dirty", encoding="utf-8")
        self.assert_blocked(self.cli("verify"), "working tree has changes")

    def test_self_review_and_missing_fresh_context_block(self):
        for reviewer in (
            {"id": "same", "implementer_id": "same", "fresh_context": True},
            {"id": "synthetic-fixture-author", "implementer_id": "another", "fresh_context": True},
            {"id": "reviewer", "implementer_id": "author", "fresh_context": False},
            {"id": "", "implementer_id": "author", "fresh_context": True},
        ):
            with self.subTest(reviewer=reviewer):
                self.report["reviewer"] = reviewer
                self.assert_blocked()

    def test_reject_verdict_and_incomplete_review_block(self):
        self.report["verdict"] = "reject"
        self.assert_blocked(text="has not approved")
        self.report["verdict"] = "approve"
        del self.report["areas"]["security"]
        self.assert_blocked(text="coverage is incomplete")

    def test_need_to_fix_and_should_fix_block_until_reviewer_confirmed(self):
        for severity in ("need_to_fix", "should_fix"):
            for status, confirmed in (("open", False), ("fixed", False), ("technically_disproven", False)):
                with self.subTest(severity=severity, status=status, confirmed=confirmed):
                    self.report["findings"] = [{"id": "F-1", "severity": severity, "status": status,
                                                 "reason": "Fixture finding", "reviewer_confirmed": confirmed}]
                    self.assert_blocked(text="Unresolved blocking")

    def test_technical_disproof_and_skipped_nit_are_accepted(self):
        self.report["findings"] = [
            {"id": "F-1", "severity": "should_fix", "status": "technically_disproven",
             "reviewer_confirmed": True, "reason": "The suspected path is unreachable; reproduction checked.",
             "evidence": self.evidence("review/disproof.md", "Synthetic technical reproduction.\n")},
            {"id": "N-1", "severity": "nit", "status": "skipped", "reason": "Existing spelling is consistent."}]
        self.assertEqual(self.verify().returncode, 0)
        self.report["findings"][0]["evidence"]["sha256"] = "0" * 64
        self.assert_blocked(text="Evidence changed")

    def test_real_control_mutant_restored_sequence_is_accepted(self):
        self.install_software()
        self.add_real_checks()
        self.assertEqual(self.verify().returncode, 0)
        self.assertEqual(self.git("status", "--porcelain"), "")
        mutant = self.report["sensitivity"][0]["mutant"]
        record = json.loads((self.private / mutant["path"]).read_text(encoding="utf-8"))
        self.assertEqual(record["exit_code"], 1)
        log = (self.private / record["log"]["path"]).read_text(encoding="utf-8")
        self.assertIn("AssertionError", log)
        self.assertIn("'/broken' != '/home'", log)

    def test_software_without_checks_and_without_sensitivity_blocks(self):
        self.install_software()
        self.assert_blocked(text="requires passing relevant tests")
        self.report["checks"] = [self.run_record("test", "required")]
        self.assert_blocked(text="requires a demonstrated representative regression")

    def test_failed_required_check_blocks(self):
        self.install_software()
        (self.private / "mutation.flag").write_text("mutant", encoding="utf-8")
        self.report["checks"] = [self.run_record("test", "failed-required")]
        (self.private / "mutation.flag").unlink()
        self.assert_blocked(text="did not pass")

    def test_empty_selection_cannot_prove_a_pass(self):
        self.install_software()
        self.report["checks"] = [self.run_record("test", "empty", [sys.executable, "-c", "print('test_primary_route: collected 0 items')"])]
        self.assert_blocked(text="Empty selections")

    def test_command_launch_failure_creates_no_check_record(self):
        result = self.cli("run-check", "--kind", "test", "--name", "missing-executable",
                          "--test-id", TEST_ID, "--", str(self.root / "missing-executable"))
        self.assert_blocked(result, "infrastructure failed")
        self.assertFalse((self.private / "checks" / "missing-executable.json").exists())

    def test_timeout_creates_no_check_record(self):
        result = self.cli("run-check", "--kind", "test", "--name", "timeout",
                          "--test-id", TEST_ID, "--timeout", "1", "--", sys.executable,
                          "-c", "import time; time.sleep(3)")
        self.assert_blocked(result, "infrastructure failed")
        self.assertFalse((self.private / "checks" / "timeout.json").exists())

    def test_stale_check_binding_and_changed_raw_log_block(self):
        self.install_software()
        reference = self.run_record("test", "required")
        self.report["checks"] = [reference]
        record_path = self.private / reference["path"]
        record_bytes = record_path.read_bytes()
        self.change_record(reference, lambda record: record["candidate"].update(head_sha="0" * 40))
        self.assert_blocked(text="another candidate")
        record_path.write_bytes(record_bytes)
        reference.update(self.reference(record_path))
        record = json.loads(record_bytes)
        log = self.private / record["log"]["path"]
        log.write_text("changed log after review", encoding="utf-8")
        self.assert_blocked(text="Evidence changed")

    def test_duplicate_check_name_is_rejected(self):
        self.install_software()
        self.run_record("test", "immutable")
        result = self.cli("run-check", "--kind", "test", "--name", "immutable", "--test-id", TEST_ID,
                          "--", sys.executable, "-c", "print('test_primary_route')")
        self.assert_blocked(result, "immutable")

    def test_mutant_must_fail_expected_assertion_with_same_test_in_order(self):
        self.install_software()
        self.add_real_checks()
        probe = self.report["sensitivity"][0]
        original = copy.deepcopy(probe)
        for field, value in (("exit_code", 0), ("expected_assertion", "wrong assertion"), ("test_id", "unselected-test"),
                             ("started_at", "0000-before-control")):
            with self.subTest(field=field):
                path = self.private / probe["mutant"]["path"]
                saved = path.read_bytes()
                self.change_record(probe["mutant"], lambda record: record.update({field: value}))
                self.assert_blocked()
                path.write_bytes(saved)
                probe["mutant"] = copy.deepcopy(original["mutant"])

    def test_common_infrastructure_failure_is_not_sensitivity(self):
        self.install_software()
        self.add_real_checks()
        probe = self.report["sensitivity"][0]
        command = [sys.executable, "-c", "print('test_primary_route: primary route must reach home'); print('ECONNREFUSED'); raise SystemExit(1)"]
        probe["mutant"] = self.run_record("mutant", "infra-mutant", command, "primary route must reach home")
        self.assert_blocked()

    def test_ui_candidate_requires_both_devices_and_interactions(self):
        self.install_software()
        self.ui_config()
        self.add_real_checks()
        self.assert_blocked(text="Desktop/mobile review is required")
        self.add_ui()
        self.assertEqual(self.verify().returncode, 0)
        for device, width in (("desktop", 390), ("mobile", 1440)):
            with self.subTest(device=device):
                saved = self.report["ui"][device]["width"]
                self.report["ui"][device]["width"] = width
                self.assert_blocked(text="viewport")
                self.report["ui"][device]["width"] = saved
        self.report["ui"]["inputs"] = ["pointer", "keyboard"]
        self.assert_blocked(text="touch")
        self.report["ui"]["inputs"].append("touch")
        self.report["ui"]["motion_reviewed"] = False
        self.assert_blocked(text="motion")

    def test_dependency_requirements_txt_is_software_not_prose(self):
        """A dependency change must not bypass testing because of its suffix."""
        (self.repo / "requirements.txt").write_text("example-dependency==2.0\n", encoding="utf-8")
        self.git("add", "requirements.txt")
        self.git("commit", "--quiet", "-m", "Dependency candidate")
        self.candidate = json.loads(self.cli_ok("snapshot").stdout)
        self.report = self.new_report()
        self.assert_blocked(text="requires passing relevant tests")

    def test_rendered_markdown_still_requires_desktop_and_mobile_review(self):
        """A configured interface project can render Markdown as page content."""
        (self.repo / "render_site.py").write_text(
            "from html import escape\nfrom pathlib import Path\n"
            "print('<html><body><main>' + escape(Path('page.md').read_text()) + '</main></body></html>')\n",
            encoding="utf-8")
        (self.repo / "page.md").write_text("# Initial page\n", encoding="utf-8")
        self.git("add", "render_site.py", "page.md")
        self.git("commit", "--quiet", "-m", "Rendered-content fixture base")
        self.git("update-ref", "refs/heads/review-base", "HEAD")
        (self.repo / "page.md").write_text("# Changed call to action\n" + "Long visible content " * 200, encoding="utf-8")
        self.git("add", "page.md")
        self.git("commit", "--quiet", "-m", "Rendered Markdown content candidate")
        rendered = subprocess.run([sys.executable, "-B", "render_site.py"], cwd=self.repo,
                                  check=True, capture_output=True, text=True)
        self.assertIn("<main># Changed call to action", rendered.stdout)
        self.assertEqual(self.git("diff", "--name-only", "review-base", "HEAD"), "page.md")
        self.ui_config()
        self.assert_blocked(text="Desktop/mobile review is required")

    def test_truncated_ui_capture_is_not_a_rendered_screenshot(self):
        self.install_software()
        self.ui_config()
        self.add_real_checks()
        self.add_ui()
        self.report["ui"]["mobile"]["capture"] = self.evidence("ui/corrupt.png", b"\x89PNG\r\n\x1a\n")
        self.assert_blocked()

    def test_capture_dimensions_must_match_the_reviewed_viewport(self):
        self.install_software()
        self.ui_config()
        self.add_real_checks()
        self.add_ui()
        self.report["ui"]["mobile"]["capture"] = self.evidence("ui/wrong-viewport.png", fixture_png(1440, 900))
        self.assert_blocked()

    def test_native_desktop_can_justify_mobile_non_applicability(self):
        self.install_software()
        self.native_config()
        self.add_real_checks()
        self.native_ui()
        self.assertEqual(self.verify().returncode, 0)

    def test_native_mobile_exemption_requires_reviewer_rationale(self):
        self.native_config()
        self.native_ui()
        self.report["ui"]["mobile"]["reason"] = ""
        self.assert_blocked()
        self.report["ui"]["mobile"] = {"reason": "Native desktop application"}
        self.assert_blocked()

    def test_native_profile_requires_an_explicit_scope_reason(self):
        (self.private / "config.json").unlink()
        self.assert_blocked(self.cli("init", "--base-ref", "review-base", "--native-ui"))
        self.assertFalse((self.private / "config.json").exists())

    def test_responsive_web_cannot_take_native_mobile_exemption(self):
        self.ui_config()
        self.native_ui()
        self.assert_blocked()

    def test_all_skipped_control_is_not_a_pristine_assertion_pass(self):
        self.install_software()
        self.report["checks"] = [self.run_record("test", "required")]
        skip = self.private / "skip.flag"
        skip.write_text("skip fixture assertion", encoding="utf-8")
        control = self.run_record("control", "skipped-control")
        skip.unlink()
        mutation = self.private / "mutation.flag"
        mutation.write_text("isolated regression", encoding="utf-8")
        mutant = self.run_record("mutant", "mutant", assertion="primary route must reach home")
        mutation.unlink()
        restored = self.run_record("restored", "restored")
        self.report["sensitivity"] = [{"risk": "Primary route", "control": control, "mutant": mutant, "restored": restored}]
        self.assert_blocked()

    def test_python_runtime_crash_is_not_an_assertion_failure(self):
        self.install_software()
        self.report["checks"] = [self.run_record("test", "required")]
        control = self.run_record("control", "control")
        crash = self.private / "crash.flag"
        crash.write_text("isolated runtime crash", encoding="utf-8")
        mutant = self.run_record("mutant", "runtime-crash", assertion="primary route must reach home")
        crash.unlink()
        restored = self.run_record("restored", "restored")
        self.report["sensitivity"] = [{"risk": "Primary route", "control": control, "mutant": mutant, "restored": restored}]
        self.assert_blocked()


if __name__ == "__main__":
    unittest.main()
