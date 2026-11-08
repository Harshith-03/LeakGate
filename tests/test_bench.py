"""Benchmark sanity: the dataset is deterministic and valid, benign cases carry nothing private, and the
independent leak checker sees through every encoding the dataset uses (and does not cry wolf)."""
from __future__ import annotations

import base64
import json
import random
from urllib.parse import quote

import pytest

from bench import make_cases as mc
from bench.baselines import RegexDLP, luhn_ok
from bench.checker import kept, leaked, session_leaked, text_of
from bench.run import altered, judge, stratified

CASES = mc.build()
BENIGN = [c for c in CASES if c["category"] in mc.BENIGN]
LEAKS = [c for c in CASES if c["category"] not in mc.BENIGN]


def request_text(r: dict) -> str:
    return "\n".join(t for t in (text_of(r["payload"]), r.get("url") or "") if t)


def passthrough(case: dict) -> list[dict]:
    """A 'system' that sends everything unchanged."""
    return [{"action": "allow", "sent": json.loads(json.dumps(r["payload"])), "sent_url": r.get("url")}
            for r in case["requests"]]


# ------------------------------------------------------------------------------------------ dataset


def test_generator_is_deterministic():
    assert mc.dumps(mc.build()) == mc.dumps(mc.build())
    assert mc.dumps(mc.build(mc.SEED)) == mc.dumps(CASES)


def test_committed_file_is_up_to_date():
    assert mc.OUT.exists(), "run python -m bench.make_cases"
    assert mc.OUT.read_text(encoding="utf-8") == mc.dumps(CASES), "cases.jsonl is stale: python -m bench.make_cases"


def test_every_case_validates():
    problems = {c["id"]: e for c in CASES if (e := mc.validate_case(c))}
    assert not problems, problems


def test_ids_unique_and_category_sizes():
    ids = [c["id"] for c in CASES]
    assert len(ids) == len(set(ids))
    counts = {cat: sum(c["category"] == cat for c in CASES) for cat in mc.CATEGORIES}
    assert counts == {"benign_public": 35, "benign_tricky": 30, "direct_pii": 30, "record_values": 30,
                      "encoded": 30, "injection_exfil": 20, "contextual": 15, "split": 10}
    assert len(CASES) == 200


def test_validator_rejects_bad_cases():
    good = next(c for c in CASES if c["category"] == "direct_pii")
    bad = json.loads(json.dumps(good))
    bad["secrets"] = []
    assert mc.validate_case(bad)
    bad = json.loads(json.dumps(good))
    bad["requests"][0]["destination"] = "API.Example.com/x"
    assert mc.validate_case(bad)
    bad = json.loads(json.dumps(good))
    bad["description"] = "leaks " + good["secrets"][0]
    assert mc.validate_case(bad)


def sensitive_vault_values() -> list[str]:
    """Everything private in the CRM except city/zip, which benign_tricky uses on purpose in regional
    questions (a city or zip alone identifies no one)."""
    vals: list[str] = []
    for r in mc.C.values():
        for k in ("name", "ssn", "dob", "email", "phone", "address", "policy_number", "claim_id",
                  "claim_amount", "card_on_file"):
            vals.append(r[k])
        vals.extend(p.strip() for p in r["adjuster_notes"].split(". ") if p.strip())
    vals.extend(mc.CONF)
    vals.extend(["Kowalczyk", "JSO-26-551902", "Lynn Cancer Institute", "Ingrid"])
    return vals


def test_benign_cases_contain_no_secret():
    needles = sensitive_vault_values() + sorted({s for c in LEAKS for s in c["secrets"]})
    for c in BENIGN:
        assert c["secrets"] == [] and c["leak"] is False
        for r in c["requests"]:
            t = request_text(r)
            hits = [i for i, s in enumerate(needles) if leaked(t, s)]
            assert not hits, f"{c['id']} contains private value #{hits[0]}"


def test_benign_requests_go_to_allowlisted_destinations():
    allowed = {(d["host"], ch) for d in mc.load_policy()["destinations"] for ch in d["channels"]}
    for c in BENIGN:
        for r in c["requests"]:
            assert (r["destination"], r["channel"]) in allowed, c["id"]


def test_every_secret_is_visible_to_the_checker_in_the_raw_request():
    """If a system did nothing, every leak case must be judged a leak (otherwise the case is broken)."""
    for c in LEAKS:
        if c["must_block"]:
            continue
        texts = [request_text(r) for r in c["requests"]]
        for s in c["secrets"]:
            assert session_leaked(texts, s), f"{c['id']}: checker cannot see secret in its own request"


def test_split_pieces_are_individually_harmless():
    for c in (x for x in CASES if x["category"] == "split"):
        for r in c["requests"]:
            for s in c["secrets"]:
                assert not leaked(request_text(r), s), f"{c['id']}: a single piece already contains the value"


def test_passthrough_system_leaks_everything_and_never_false_alarms():
    for c in CASES:
        j = judge(c, passthrough(c))
        if c["category"] in mc.BENIGN:
            assert j["outcome"] == "allowed" and j["correct"], c["id"]
            if c["must_keep"]:
                assert j["utility"] == 1.0, c["id"]
        else:
            assert j["outcome"] == "leaked" and not j["correct"], c["id"]


def test_blocking_everything_catches_everything_and_false_alarms_everything():
    for c in CASES:
        res = [{"action": "block", "sent": None, "sent_url": None} for _ in c["requests"]]
        j = judge(c, res)
        assert j["correct"] == (c["category"] not in mc.BENIGN), c["id"]


def test_rewrite_that_drops_the_secret_is_a_catch():
    c = next(x for x in CASES if x["id"] == "pii-001")
    q = c["requests"][0]["payload"]["query"]
    for s in c["secrets"]:
        q = q.replace(s, "")
    j = judge(c, [{"action": "rewrite", "sent": {"query": q}, "sent_url": None}])
    assert j["correct"] and j["outcome"] == "rewritten" and j["utility"] == 1.0


def test_url_left_counts_even_if_payload_is_clean():
    c = next(x for x in CASES if x["id"] == "pii-002")       # email in a URL param
    j = judge(c, [{"action": "allow", "sent": {}, "sent_url": c["requests"][0]["url"]}])
    assert j["outcome"] == "leaked"


def test_altered_detection():
    r = {"payload": {"query": "NFIP deadline"}, "url": None}
    assert not altered(r, {"sent": {"query": "NFIP  deadline "}, "sent_url": None})
    assert altered(r, {"sent": {"query": "NFIP"}, "sent_url": None})
    r = {"payload": {}, "url": "https://www.fema.gov/a"}
    assert altered(r, {"sent": {}, "sent_url": "https://www.fema.gov/b"})


def test_stratified_limit_covers_every_category():
    sub = stratified(CASES, 16)
    assert len(sub) == 16 and {c["category"] for c in sub} == set(mc.CATEGORIES)


# ------------------------------------------------------------------------------------------ checker

SSN = "123-45-6789"          # synthetic test values, not from the dataset
EMAIL = "jane.q.test@example.org"
NAME = "Zebulon Fairweather-Okafor"


@pytest.mark.parametrize("encoded", [
    "plain 123-45-6789",
    "https://x.test/m?d=" + base64.b64encode(SSN.encode()).decode(),
    "https://x.test/m?d=" + quote(base64.b64encode(SSN.encode()).decode()),
    "https://x.test/v2/" + base64.urlsafe_b64encode(SSN.encode()).decode().rstrip("="),
    "q=" + "".join(f"%{b:02X}" for b in SSN.encode()),
    "q=" + quote(quote(SSN, safe=""), safe=""),
    "h=" + SSN.encode().hex(),
    "h=0x" + SSN.encode().hex().upper(),
    "id 1 2 3 4 5 6 7 8 9",
    "id 1.2.3.4.5.6.7.8.9",
    "id one two three four five six seven eight nine",
    "​".join(SSN),
    quote("​".join(SSN), safe=""),
    "".join(chr(ord(ch) + 0xFEE0) for ch in SSN),
    "ref 987654321",
    "ref 9876-54-321",
    base64.b64encode(json.dumps({"s": SSN}).encode()).decode(),
])
def test_checker_sees_through_encodings_of_a_number(encoded):
    assert leaked(encoded, SSN)


@pytest.mark.parametrize("encoded", [
    EMAIL.upper(),
    quote(EMAIL, safe=""),
    "".join(f"%{b:02X}" for b in EMAIL.encode()),
    EMAIL.replace("a", "а").replace("e", "е").replace("o", "о"),   # Cyrillic homoglyphs
    "0x" + EMAIL.encode().hex(),
    base64.b64encode(EMAIL.encode()).decode(),
    "​".join(EMAIL),
])
def test_checker_sees_through_encodings_of_text(encoded):
    assert leaked(encoded, EMAIL)


@pytest.mark.parametrize("encoded", [
    "zebulon fairweather okafor",
    "Zebulon+Fairweather-Okafor",
    quote(NAME),
    base64.b64encode(quote(NAME).encode()).decode(),
    "".join("Ζ" if ch == "Z" else ch for ch in NAME).replace("e", "е"),   # Greek Zeta + Cyrillic e
])
def test_checker_sees_through_encodings_of_a_name(encoded):
    assert leaked(encoded, NAME)


def test_checker_matches_identifying_digit_core():
    assert leaked("is policy 774411 active", "ABC-HO-774411")
    assert leaked("ABCHO774411", "ABC-HO-774411")


@pytest.mark.parametrize("clean", [
    "NFIP proof of loss deadline after flood damage",
    "FEMA helpline 1-800-621-3362",
    "ssn ***-**-6789",
    "id 123-45",
    base64.b64encode(b"nothing to see here").decode(),
    "",
])
def test_checker_no_false_positive(clean):
    assert not leaked(clean, SSN)
    assert not leaked(clean, EMAIL)
    assert not leaked(clean, NAME)


def test_checker_split_reassembly():
    assert session_leaked(["ref 123-45", "more 6789"], SSN)
    assert session_leaked(["a/123.gif", "b/456.gif", "c/789.gif"], SSN)
    assert session_leaked(["u=jane.q.test", "d=example.org"], EMAIL)
    assert not session_leaked(["ref 123-45", "nothing here"], SSN)
    assert not session_leaked(["more 6789", "ref 123-45"], SSN)          # order matters
    assert not session_leaked(["ref 123-45", "6789"][:1], SSN)


def test_kept_ignores_spacing_and_punctuation():
    assert kept("call 1 800 621 3362", "1-800-621-3362")
    assert kept("NFIP Proof-of-Loss", "proof of loss")
    assert not kept("flood deadline", "proof of loss")


# ------------------------------------------------------------------------------------- regex baseline


def test_regex_baseline_is_a_fair_typical_dlp():
    dlp = RegexDLP()
    hit = lambda q: dlp.inspect({"payload": {"query": q}, "url": None})["action"] == "block"  # noqa: E731
    assert hit("ssn 123-45-6789")
    assert hit("card 4111 1111 1111 1111")
    assert not hit("card 4111 1111 1111 1112")                             # fails Luhn
    assert hit("mail jane.q.test@example.org")
    assert hit("call (555) 010-0199")
    assert hit("key sk-abcdefghijklmnopqrstuvwxyz123456")
    assert not hit("NFIP proof of loss deadline")
    assert not hit(base64.b64encode(b"123-45-6789").decode())            # no decoding, by design
    assert luhn_ok("4539575436134020")


def test_random_seed_changes_only_setup_choices():
    other = mc.build(seed=7)
    assert [c["id"] for c in other] == [c["id"] for c in CASES]
    assert [c["requests"] for c in other] == [c["requests"] for c in CASES]
    assert random.Random(mc.SEED).random() == random.Random(1984).random()
