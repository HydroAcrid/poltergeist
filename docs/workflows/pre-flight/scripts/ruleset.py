"""Emit a ruleset payload; never change repository settings."""
import argparse
import json

def payload(app_id):
    if not isinstance(app_id, int) or isinstance(app_id, bool) or app_id <= 0:
        raise ValueError("Use the actual installed Flight Bot GitHub App integration ID.")
    return {
        "name": "Pre-flight approval for main", "target": "branch", "enforcement": "active", "bypass_actors": [],
        "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
        "rules": [
            {"type": "deletion"}, {"type": "non_fast_forward"},
            {"type": "pull_request", "parameters": {"required_approving_review_count": 0,
              "dismiss_stale_reviews_on_push": True, "require_code_owner_review": False,
              "require_last_push_approval": False, "required_review_thread_resolution": True}},
            {"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": True,
              "required_status_checks": [{"context": "pre-flight/flight-bot", "integration_id": app_id}]}}
        ]
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-id", type=int, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(payload(args.app_id), indent=2))
    except ValueError as error:
        parser.error(str(error))
