"""Isolated behavioral checks for the local PreToolUse adapter.

All Git mutations below are confined to TemporaryDirectory checkouts. Tests
never invoke submitted shell commands, push, contact GitHub, or change user
configuration. The receipt verifier is mocked to test its adapter contract;
preflight.py has its own real receipt validation tests.
"""

from __future__ import annotations

import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import hook


class HookTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="preflight-hook-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.personal = self.root / "Personal"
        self.repo = self.personal / "Project With Spaces"
        self.outside = self.root / "Unrelated"
        self.outside.mkdir()
        self.repo.mkdir(parents=True)
        self.git("init", "--quiet", "-b", "work")
        self.git("config", "user.name", "Isolated Hook Test")
        self.git("config", "user.email", "isolated@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.hooksPath", str(self.root / "no-hooks"))
        self.commit("initial")
        self.git("remote", "add", "origin", "https://github.com/example/project.git")
        self.registry = self.root / "projects.json"
        self.registry.write_text(json.dumps({
            "schema_version": 1, "roots": [str(self.personal)],
            "repositories": [{"name": "example/project", "path": str(self.repo)}],
        }), encoding="utf-8")
        self.report = {"candidate": {"base_ref": "refs/remotes/origin/main"}}
        self.verifier = patch.object(hook, "verify", return_value=self.report).start()
        self.addCleanup(patch.stopall)

    def git(self, *args: str) -> str:
        result = subprocess.run(["git", "-C", str(self.repo), *args], check=True,
                                capture_output=True, text=True)
        return result.stdout.strip()

    def commit(self, content: str) -> str:
        (self.repo / "candidate.txt").write_text(content, encoding="utf-8")
        self.git("add", "candidate.txt")
        self.git("commit", "--quiet", "-m", content)
        return self.git("rev-parse", "HEAD")

    def tracked(self) -> None:
        self.git("update-ref", "refs/remotes/origin/work", "HEAD")

    def shell(self, command: str, *, cwd: Path | None = None,
              workdir: Path | str | None = None, session: str | None = "author-session") -> dict:
        arguments = {"command": command}
        if workdir is not None:
            arguments["workdir"] = str(workdir)
        return {"hook_event_name": "PreToolUse", "tool_name": "Bash",
                "cwd": str(cwd or self.repo), "session_id": session,
                "tool_input": arguments}

    def mcp(self, tool: str = "create_pull_request", *, cwd: Path | None = None, **kwargs) -> dict:
        arguments = {"repository_full_name": "example/project", "head": "work", "base": "main"}
        arguments.update(kwargs)
        return {"tool_name": "mcp__codex_apps__github_" + tool,
                "cwd": str(cwd or self.repo), "session_id": "author-session",
                "tool_input": arguments}

    def evaluate(self, payload: dict) -> str | None:
        return hook.evaluate(payload, self.registry)

    def assert_denied(self, payload: dict, contains: str | None = None) -> str:
        reason = self.evaluate(payload)
        self.assertIsInstance(reason, str)
        self.assertIn("Run $pre-flight", reason)
        if contains:
            self.assertIn(contains, reason)
        return reason

    def test_ordinary_tools_pass_without_reading_registry_or_verifier(self):
        missing = self.root / "missing.json"
        for payload in [self.shell("git status --short"), self.shell("echo hello"),
                        self.shell("git log --grep='git push'"),
                        {"tool_name": "apply_patch", "tool_input": {"command": "git push"}}]:
            self.assertIsNone(hook.evaluate(payload, missing))
        self.verifier.assert_not_called()

    def test_readonly_git_with_release_words_is_not_a_release(self):
        self.assertIsNone(self.evaluate(self.shell("git log --grep='git push'")))
        self.verifier.assert_not_called()

    def test_scoped_push_without_receipt_is_denied(self):
        self.verifier.side_effect = hook.GateError("No independent approval receipt.")
        self.assert_denied(self.shell("git push origin HEAD"), "No independent approval")

    def test_valid_current_head_push_propagates_author_id(self):
        self.assertIsNone(self.evaluate(self.shell("git push origin HEAD:work")))
        self.verifier.assert_called_once_with(self.repo, author_id="author-session")

    def test_missing_author_is_not_invented(self):
        self.assertIsNone(self.evaluate(self.shell("git push origin HEAD", session=None)))
        self.verifier.assert_called_once_with(self.repo, author_id=None)

    def test_verifier_failure_is_an_explicit_denial(self):
        self.verifier.side_effect = RuntimeError("unexpected failure")
        self.assert_denied(self.shell("git push origin HEAD"), "verifier failed")

    def test_default_push_is_current_branch(self):
        self.assertIsNone(self.evaluate(self.shell("git push")))
        self.verifier.assert_called_once()

    def test_another_push_source_is_denied_even_with_valid_receipt(self):
        self.assert_denied(self.shell("git push origin main"), "not the reviewed current HEAD")
        self.verifier.assert_not_called()

    def test_multi_source_and_malformed_refspecs_are_denied(self):
        for command in ["git push --all", "git push --tags", "git push --mirror",
                        "git push origin HEAD other", "git push origin HEAD:"]:
            with self.subTest(command=command):
                self.assert_denied(self.shell(command))
        self.verifier.assert_not_called()

    def test_default_matching_push_configuration_is_denied(self):
        self.git("config", "push.default", "matching")
        self.assert_denied(self.shell("git push"), "explicit literal HEAD")

    def test_dry_run_does_not_need_approval(self):
        self.assertIsNone(self.evaluate(self.shell("git push --dry-run --all")))
        self.assertIsNone(self.evaluate(self.shell("git push -n origin HEAD")))
        self.verifier.assert_not_called()

    def test_dry_run_text_consumed_as_an_option_value_cannot_bypass_guard(self):
        for command in ["git push --receive-pack --dry-run", "git push -o --dry-run",
                        'git push "$flags" --dry-run']:
            with self.subTest(command=command):
                self.assert_denied(self.shell(command))
        self.verifier.assert_not_called()

    def test_workdir_resolves_repo_from_personal_parent(self):
        self.assertIsNone(self.evaluate(self.shell("git push origin HEAD", cwd=self.personal,
                                                 workdir=self.repo)))
        self.verifier.assert_called_once_with(self.repo, author_id="author-session")

    def test_relative_workdir_resolves_from_session_cwd(self):
        self.assertIsNone(self.evaluate(self.shell("git push origin HEAD", cwd=self.personal,
                                                 workdir=self.repo.name)))
        self.verifier.assert_called_once_with(self.repo, author_id="author-session")

    def test_null_workdir_uses_session_cwd(self):
        payload = self.shell("git push origin HEAD")
        payload["tool_input"]["workdir"] = None
        self.assertIsNone(self.evaluate(payload))
        self.verifier.assert_called_once_with(self.repo, author_id="author-session")

    def test_literal_git_C_resolves_repo_with_spaces(self):
        self.assertIsNone(self.evaluate(self.shell(f'git -C "{self.repo}" push origin HEAD',
                                                 cwd=self.outside)))
        self.verifier.assert_called_once_with(self.repo, author_id="author-session")

    def test_quoted_executable_and_concatenated_verb_are_still_guarded(self):
        self.verifier.side_effect = hook.GateError("Missing receipt")
        self.assert_denied(self.shell('g"it" pu"sh" origin HEAD'), "Missing receipt")
        self.verifier.assert_called_once_with(self.repo, author_id="author-session")

    def test_unsupported_shell_line_continuation_fails_closed(self):
        self.assert_denied(self.shell("git `\npush origin HEAD"))
        self.verifier.assert_not_called()

    def test_literal_cd_then_release_resolves_repo(self):
        self.assertIsNone(self.evaluate(self.shell(f'cd "{self.repo}"; git push origin HEAD',
                                                 cwd=self.outside)))

    def test_malformed_or_unsupported_scoped_release_is_denied(self):
        for command in ['git -C "$target" push', "git push 'origin", "git --git-dir=other push",
                        'powershell -Command "git push"', "git commit -am changed; git push"]:
            with self.subTest(command=command):
                self.assert_denied(self.shell(command))
        self.verifier.assert_not_called()

    def test_release_text_printed_by_echo_is_harmless(self):
        self.assertIsNone(self.evaluate(self.shell("echo 'Run git push after review'")))
        self.verifier.assert_not_called()

    def test_out_of_scope_git_release_is_unaffected(self):
        (self.outside / ".git").mkdir()
        self.assertIsNone(self.evaluate(self.shell("git push origin main", cwd=self.outside)))
        self.verifier.assert_not_called()

    def test_future_repo_within_registered_root_is_guarded(self):
        future = self.personal / "Future"
        (future / ".git").mkdir(parents=True)
        self.verifier.side_effect = hook.GateError("No independent approval receipt.")
        # The verifier can be reached without relying on a fixed repo name.
        self.assert_denied(self.shell("gh pr merge 1", cwd=future))

    def test_scoped_release_in_non_repository_directory_is_denied(self):
        self.assert_denied(self.shell("git push", cwd=self.personal), "not a Git checkout")

    def test_gh_create_can_use_matching_reviewed_branch_and_base(self):
        self.tracked()
        self.assertIsNone(self.evaluate(self.shell("gh pr create --head work --base main --title Ready")))
        self.verifier.assert_called_once_with(self.repo, author_id="author-session")

    def test_gh_create_requires_matching_origin_tracking_ref(self):
        self.assert_denied(self.shell("gh pr create --head work --base main"))
        self.verifier.assert_not_called()

    def test_gh_create_rejects_stale_tracking_ref(self):
        self.tracked()
        self.commit("new candidate")
        self.assert_denied(self.shell("gh pr create --head work --base main"), "tracking ref must match HEAD")
        self.verifier.assert_not_called()

    def test_gh_create_rejects_alternate_head_or_base(self):
        self.tracked()
        for command in ["gh pr create --head other --base main", "gh pr create --head work --base develop",
                        "gh pr create --head example:work --base main", "gh pr create --head work"]:
            with self.subTest(command=command):
                self.assert_denied(self.shell(command))

    def test_gh_create_rejects_different_repository(self):
        self.tracked()
        self.assert_denied(self.shell("gh -R other/project pr create --head work --base main"),
                           "does not match")

    def test_gh_short_attached_target_flags_are_checked(self):
        self.tracked()
        self.assert_denied(self.shell("gh pr create -Hother -Bmain"), "literal current local branch")
        self.assertIsNone(self.evaluate(self.shell("gh pr create -Rexample/project -Hwork -Bmain")))

    def test_gh_remote_merge_is_denied_even_with_valid_local_receipt(self):
        self.tracked()
        self.assert_denied(self.shell("gh pr merge 123 --squash"), "trusted GitHub gate")
        self.verifier.assert_not_called()

    def test_github_mcp_create_resolves_registered_repo_from_outside_cwd(self):
        self.tracked()
        self.assertIsNone(self.evaluate(self.mcp(cwd=self.outside)))
        self.verifier.assert_called_once_with(self.repo, author_id="author-session")

    def test_github_mcp_head_aliases_cannot_select_another_candidate(self):
        self.tracked()
        self.assert_denied(self.mcp(head_branch="other"), "ambiguous target aliases")
        self.assert_denied(self.mcp(head=None, head_branch="other"), "literal current local branch")

    def test_github_mcp_base_aliases_are_validated(self):
        self.tracked()
        self.assert_denied(self.mcp(base=None, base_branch="develop"), "reviewed base")
        self.assertIsNone(self.evaluate(self.mcp(base=None, base_branch="main")))

    def test_github_mcp_missing_head_or_cross_repo_is_denied(self):
        self.tracked()
        self.assert_denied(self.mcp(head=None), "explicit and literal")
        self.assert_denied(self.mcp(head_repo="other/project"), "trusted server identity")

    def test_github_remote_merges_and_auto_merge_are_denied(self):
        for tool in ["merge_pull_request", "enable_auto_merge"]:
            self.assert_denied(self.mcp(tool), "trusted GitHub gate")
        self.verifier.assert_not_called()

    def test_unregistered_github_repository_outside_scope_is_unchanged(self):
        self.assertIsNone(self.evaluate(self.mcp("merge_pull_request", cwd=self.outside,
                                                 repository_full_name="unrelated/other")))
        self.verifier.assert_not_called()

    def test_reviewed_clean_fast_forward_uses_source_ref(self):
        self.git("switch", "--quiet", "-c", "candidate")
        self.commit("reviewable fast-forward")
        self.git("switch", "--quiet", "work")
        self.assertIsNone(self.evaluate(self.shell("git merge --ff-only candidate")))
        self.verifier.assert_called_once_with(self.repo, author_id="author-session", head_ref="candidate")

    def test_dirty_fast_forward_is_denied(self):
        (self.repo / "candidate.txt").write_text("dirty", encoding="utf-8")
        self.assert_denied(self.shell("git merge --ff-only HEAD"), "clean working tree")
        self.verifier.assert_not_called()

    def test_non_ancestor_fast_forward_is_denied(self):
        self.git("branch", "candidate")
        self.commit("work has advanced")
        self.assert_denied(self.shell("git merge --ff-only candidate"))
        self.verifier.assert_not_called()

    def test_other_merge_strategies_and_continue_are_denied(self):
        for command in ["git merge candidate", "git merge --squash candidate", "git merge --continue"]:
            self.assert_denied(self.shell(command), "reviewed `git merge --ff-only")
        self.verifier.assert_not_called()

    def test_merge_abort_and_quit_are_available_without_review(self):
        self.assertIsNone(self.evaluate(self.shell("git merge --abort")))
        self.assertIsNone(self.evaluate(self.shell("git merge --quit")))
        self.verifier.assert_not_called()

    def test_missing_registry_fails_closed_for_release(self):
        self.registry.unlink()
        self.assert_denied(self.shell("git push origin HEAD"), "registry is missing or invalid")

    def test_hook_never_executes_submitted_shell_text(self):
        marker = self.root / "should-not-exist"
        self.assert_denied(self.shell(f'git push; New-Item -Path "{marker}"'))
        self.assertFalse(marker.exists())

    def run_main(self, payload: object, *, fail: bool = False) -> tuple[int, str]:
        original = hook.evaluate
        with patch.object(hook.sys, "stdin", io.StringIO(json.dumps(payload))), \
             patch.object(hook.sys, "stdout", io.StringIO()) as output, \
             patch.object(hook, "evaluate", side_effect=RuntimeError("unavailable") if fail
                          else lambda value: original(value, self.registry)):
            code = hook.main()
        return code, output.getvalue()

    def test_main_denies_with_supported_json_and_success_exit(self):
        self.verifier.side_effect = hook.GateError("Missing receipt")
        code, output = self.run_main(self.shell("git push origin HEAD"))
        parsed = json.loads(output)
        self.assertEqual(code, 0)
        self.assertEqual(parsed["hookSpecificOutput"]["hookEventName"], "PreToolUse")
        self.assertEqual(parsed["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertNotIn("continue", parsed)

    def test_main_success_has_no_output(self):
        code, output = self.run_main(self.shell("git push origin HEAD"))
        self.assertEqual((code, output), (0, ""))

    def test_main_unexpected_failure_is_still_explicit_denial(self):
        code, output = self.run_main(self.shell("git push origin HEAD"), fail=True)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output)["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_malformed_stdin_is_still_explicit_denial(self):
        with patch.object(hook.sys, "stdin", io.StringIO("{bad json")), \
             patch.object(hook.sys, "stdout", io.StringIO()) as output:
            self.assertEqual(hook.main(), 0)
        self.assertEqual(json.loads(output.getvalue())["hookSpecificOutput"]["permissionDecision"], "deny")


if __name__ == "__main__":
    unittest.main()
