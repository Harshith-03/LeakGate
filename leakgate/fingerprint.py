"""The vault: keyed fingerprints of the private data an agent has read, never the data itself.

    v = Vault(key)
    v.add_record("crm", "C-1042", record, public_fields={"state"})   -> number of fingerprints added
    v.add_terms(["Project Bluefin"], source="policy")
    v.scan(text) -> list[VaultHit]          # hits on token sequences, digit runs (spaced/reversed) and passages
    v.match_digits_exact(digits) -> Ref | None     # for the split-across-calls check
    v.summary() -> dict

Why fingerprints: pattern DLP can't know that "Okonkwo-Reyes" or "NWM-HO-448812" is private. The
vault knows, because it saw the record the agent loaded. It stores HMAC-SHA256(install key, form)
truncated to 16 bytes for each normalised form, so the vault itself is not a second copy of the
customer file, and a short value like an SSN can't be brute-forced from it without the key.

Forms per value:
  tokens   alphanumeric runs, casefolded, joined by one space ("okonkwo reyes", "nwm ho 448812").
           Punctuation and spacing differences therefore don't matter.
  digits   digits only, for values with >= 6 digits (SSN, phone, card, policy/claim numbers, dates).
           Matched inside any digit run in the text, also reversed and also when spaced out.
  passage  every 5-token shingle of long free text (adjuster notes), so a copied sentence is caught.
Name parts are registered on their own only when they are not common names, so "Maria" alone is
not a hit but "Okonkwo" is. City and ZIP are kept as low-severity hits: not identifying alone, but
the rewriter generalises them when it is already cleaning a query.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

TOKEN = re.compile(r"[^\W_]+", re.UNICODE)
DIGIT_RUN = re.compile(r"\d(?:[ \t\-./()]{0,3}\d)*")
SPACED = re.compile(r"\d[ \t.\-]\d[ \t.\-]\d")
SEVERITY_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}
MIN_DIGITS = 6
SHINGLE = 5
MAX_TOKENS = 8

COMMON_NAMES = set("""
james john robert michael william david richard joseph thomas charles christopher daniel matthew anthony mark
donald steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary
nicholas eric jonathan stephen larry justin scott brandon benjamin samuel gregory alexander frank patrick
raymond jack dennis jerry tyler aaron jose adam nathan henry douglas zachary peter kyle noah ethan jeremy walter
christian keith roger terry austin sean gerald carl harold dylan arthur lawrence jordan jesse bryan billy bruce
gabriel joe logan alan juan albert willie elijah wayne randy vincent mason roy ralph bobby russell bradley
philip eugene mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty sandra
margaret ashley kimberly emily donna michelle carol amanda melissa deborah stephanie dorothy rebecca sharon laura
cynthia amy kathleen angela shirley brenda emma anna pamela nicole samantha katherine christine helen debra
rachel carolyn janet maria catherine heather diane olivia julie joyce victoria ruth virginia lauren kelly
christina joan evelyn judith andrea hannah megan cheryl jacqueline martha madison teresa gloria sara janice ann
kathryn abigail sophia frances jean alice judy isabella julia grace amber denise danielle marilyn beverly
charlotte natalie theresa diana brittany doris kayla alexis lori marie priya rafael ingrid tobias desmond
smith johnson williams brown jones garcia miller davis rodriguez martinez hernandez lopez gonzalez wilson
anderson taylor moore jackson martin lee perez thompson white harris sanchez clark ramirez lewis robinson
walker young allen king wright scott torres nguyen hill flores green adams nelson baker hall rivera campbell
mitchell carter roberts gomez phillips evans turner diaz parker cruz edwards collins reyes stewart morris
morales murphy cook rogers gutierrez ortiz morgan cooper peterson bailey reed kelly howard ramos kim cox ward
richardson watson brooks chavez wood james bennett gray mendoza ruiz hughes price alvarez castillo sanders
patel myers long ross foster jimenez holt moreau
""".split())
STOP = set("""
the and for with from that this into over under about after before ocean lane drive court street avenue road
ave apt unit suite project model reserve florida exit plan claim policy insurance flood home homeowners
""".split())
# Fields that describe a record but don't identify anyone; used when the caller passes no public_fields.
DEFAULT_PUBLIC = {"state", "country", "product", "loss_type", "status", "type", "category", "line_of_business"}
ADDRESS_SUFFIX = {"ln", "lane", "st", "street", "ave", "avenue", "dr", "drive", "ct", "court", "rd", "road",
                  "way", "blvd", "boulevard", "pl", "place", "ter", "terrace", "cir", "circle", "pkwy", "hwy"}

FIELD_LABELS = {
    "name": "name", "ssn": "SSN", "dob": "date of birth", "email": "email", "phone": "phone",
    "address": "street address", "city": "city", "zip": "ZIP code", "policy_number": "policy number",
    "claim_id": "claim ID", "claim_amount": "claim amount", "card_on_file": "card on file",
    "adjuster_notes": "adjuster notes", "notes": "notes",
}


@dataclass(frozen=True)
class Ref:
    source_ref: str        # "crm:C-1042.ssn" / "policy:confidential_terms[0]"
    kind: str              # private_record | confidential_term | private_passage
    severity: str
    label: str             # "SSN", "name (part)", "adjuster notes (passage)"


@dataclass
class VaultHit:
    ref: Ref
    start: int
    end: int
    form: str              # tokens | digits | passage
    spaced: bool = False
    reversed: bool = False


@dataclass
class _Source:
    fields: set[str] = field(default_factory=set)
    fingerprints: int = 0


def _tokens(s: str) -> list[str]:
    return [m.group(0).casefold() for m in TOKEN.finditer(s)]


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def _date_forms(value: str) -> list[str]:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            d = datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
        return [d.strftime(f) for f in ("%Y%m%d", "%m%d%Y", "%d%m%Y", "%m%d%y")]
    return []


class Vault:
    def __init__(self, key: bytes):
        self._key = key
        self._tok: dict[bytes, Ref] = {}
        self._dig: dict[bytes, Ref] = {}
        self._tok_lens: set[int] = set()
        self._dig_lens: set[int] = set()
        self._sources: dict[str, _Source] = {}
        self._terms = 0

    # ------------------------------------------------------------ hashing
    def _h(self, form: str) -> bytes:
        return hmac.new(self._key, form.encode("utf-8"), hashlib.sha256).digest()[:16]

    def _put_tokens(self, toks: list[str], ref: Ref) -> int:
        if not toks or len(toks) > MAX_TOKENS:
            return 0
        k = self._h("t:" + " ".join(toks))
        old = self._tok.get(k)
        if old is None or SEVERITY_ORDER[ref.severity] > SEVERITY_ORDER[old.severity]:
            self._tok[k] = ref
        self._tok_lens.add(len(toks))
        return 1

    def _put_digits(self, d: str, ref: Ref) -> int:
        if len(d) < MIN_DIGITS:
            return 0
        k = self._h("d:" + d)
        old = self._dig.get(k)
        if old is None or SEVERITY_ORDER[ref.severity] > SEVERITY_ORDER[old.severity]:
            self._dig[k] = ref
        self._dig_lens.add(len(d))
        return 1

    # ------------------------------------------------------------ registration
    def add_record(self, source: str, record_id: str, record: dict, public_fields: Optional[set[str]] = None) -> int:
        public = set(DEFAULT_PUBLIC if public_fields is None else public_fields)
        src = self._sources.setdefault(source, _Source())
        n = 0
        for fname, value in record.items():
            if fname in public or value is None or fname.startswith("_"):
                continue
            if isinstance(value, (int, float)):
                value = str(value)
            if not isinstance(value, str) or not value.strip():
                continue
            ref_base = f"{source}:{record_id}.{fname}"
            label = FIELD_LABELS.get(fname, fname.replace("_", " "))
            added = self._add_value(fname, value, ref_base, label)
            if added:
                src.fields.add(fname)
                n += added
        src.fingerprints += n
        return n

    def _add_value(self, fname: str, value: str, ref: str, label: str) -> int:
        toks = _tokens(value)
        digits = _digits(value)
        n = 0
        R = lambda sev, lab=label, kind="private_record": Ref(ref, kind, sev, lab)    # noqa: E731
        f = fname.lower()
        if f in ("city", "zip", "state_region"):
            n += self._put_tokens(toks, R("low"))
            return n
        if f == "name" or f.endswith("_name"):
            n += self._put_tokens(toks, R("high"))
            for i, t in enumerate(toks):                       # rare parts and ordered pairs
                if len(t) >= 4 and t not in COMMON_NAMES and not t.isdigit():
                    n += self._put_tokens([t], R("medium", f"{label} (part)"))
                for u in toks[i + 1:]:
                    n += self._put_tokens([t, u], R("high", f"{label} (part)"))
            return n
        if f in ("dob", "date_of_birth", "birth_date"):
            for d in _date_forms(value):
                n += self._put_digits(d, R("medium"))
            n += self._put_tokens(toks, R("medium"))
            return n
        if f == "email":
            n += self._put_tokens(toks, R("high"))
            local = _tokens(value.split("@")[0])
            if len(local) == 1 and (len(local[0]) >= 6 or any(c.isdigit() for c in local[0])):
                n += self._put_tokens(local, R("medium", "email (username)"))
            return n
        if f == "phone":
            if len(digits) == 10:
                n += self._put_digits(digits, R("high"))
                n += self._put_digits("1" + digits, R("high"))
                n += self._put_digits(digits[3:], R("medium", "phone (local part)"))
            else:
                n += self._put_digits(digits, R("high"))
            return n
        if f == "address":
            n += self._put_tokens(toks, R("high"))
            if toks and toks[-1] in ADDRESS_SUFFIX:
                n += self._put_tokens(toks[:-1], R("high"))
            return n
        if f in ("ssn", "card_on_file", "card", "account_number", "routing_number", "tax_id"):
            n += self._put_digits(digits, R("critical" if "card" in f else "high"))
            return n
        if f == "claim_amount" or f.endswith("_amount"):
            n += self._put_digits(digits, R("medium"))      # >= 6 digits only; smaller amounts aren't identifying
            return n
        # identifiers and free text
        if len(toks) > MAX_TOKENS:                             # passage
            pr = Ref(ref, "private_passage", "high", f"{label} (passage)")
            for i in range(len(toks) - SHINGLE + 1):
                sh = toks[i:i + SHINGLE]
                if sum(t not in STOP for t in sh) >= 3:
                    n += self._put_tokens(sh, pr)
            return n
        n += self._put_tokens(toks, R("high"))
        if len(digits) >= MIN_DIGITS:
            n += self._put_digits(digits, R("high"))
        for run in re.findall(r"\d+", value):                 # "CLM-2026-118734": also the 6-digit serial alone
            if len(run) >= MIN_DIGITS and run != digits:
                n += self._put_digits(run, R("high"))
        return n

    def add_records(self, source: str, records: list[dict], public_fields: Optional[set[str]] = None,
                    id_field: str = "customer_id") -> int:
        return sum(self.add_record(source, str(r.get(id_field, i)), r, public_fields) for i, r in enumerate(records))

    def add_terms(self, terms: list[str], source: str = "policy") -> int:
        src = self._sources.setdefault(source, _Source())
        n = 0
        for i, term in enumerate(terms):
            toks = _tokens(term)
            ref = Ref(f"{source}:confidential_terms[{i}]", "confidential_term", "high", "confidential term")
            n += self._put_tokens(toks, ref)
            for t in toks:
                if len(t) >= 5 and t not in STOP and t not in COMMON_NAMES:
                    n += self._put_tokens([t], Ref(ref.source_ref, "confidential_term", "medium",
                                                   "confidential term (part)"))
        src.fields.add("confidential_terms")
        src.fingerprints += n
        self._terms += len(terms)
        return n

    # ------------------------------------------------------------ matching
    def scan(self, text: str) -> list[VaultHit]:
        """Never raises. Hits are in `text` coordinates; contained hits of lower severity are dropped."""
        hits: list[VaultHit] = []
        if not text or (not self._tok and not self._dig):
            return hits
        try:
            toks = [(m.group(0).casefold(), m.start(), m.end()) for m in TOKEN.finditer(text)]
            for n in sorted(self._tok_lens):
                for i in range(len(toks) - n + 1):
                    ref = self._tok.get(self._h("t:" + " ".join(t for t, _, _ in toks[i:i + n])))
                    if ref:
                        hits.append(VaultHit(ref, toks[i][1], toks[i + n - 1][2],
                                             "passage" if ref.kind == "private_passage" else "tokens"))
            if self._dig:
                for m in DIGIT_RUN.finditer(text):
                    run = m.group(0)
                    pos = [m.start() + i for i, c in enumerate(run) if c.isdigit()]
                    d = "".join(c for c in run if c.isdigit())
                    spaced = bool(SPACED.search(run)) and len(re.findall(r"\d{2,}", run)) <= 1
                    for L in self._dig_lens:
                        for i in range(len(d) - L + 1):
                            sub = d[i:i + L]
                            for rev, form in ((False, sub), (True, sub[::-1])):
                                ref = self._dig.get(self._h("d:" + form))
                                if ref:
                                    hits.append(VaultHit(ref, pos[i], pos[i + L - 1] + 1, "digits", spaced, rev))
        except Exception:
            return hits
        return _prune(hits)

    def match_digits_exact(self, digits: str) -> Optional[Ref]:
        if len(digits) < MIN_DIGITS:
            return None
        return self._dig.get(self._h("d:" + digits)) or self._dig.get(self._h("d:" + digits[::-1]))

    def digit_lengths(self) -> set[int]:
        return set(self._dig_lens)

    # ------------------------------------------------------------ introspection (no values)
    @property
    def fingerprints(self) -> int:
        return len(self._tok) + len(self._dig)

    def summary(self) -> dict:
        return {
            "sources": [{"source": s, "fields": sorted(v.fields), "fingerprints": v.fingerprints}
                        for s, v in sorted(self._sources.items())],
            "confidential_terms": self._terms,
            "fingerprints": self.fingerprints,
            "key_id": hashlib.sha256(self._key).hexdigest()[:8],
        }


def _prune(hits: list[VaultHit]) -> list[VaultHit]:
    """Drop a hit that sits inside another hit of at least the same severity (keeps the most specific)."""
    hits.sort(key=lambda h: (h.start, -(h.end - h.start)))
    out: list[VaultHit] = []
    for h in hits:
        if any(o.start <= h.start and h.end <= o.end and (o.start, o.end) != (h.start, h.end)
               and SEVERITY_ORDER[o.ref.severity] >= SEVERITY_ORDER[h.ref.severity] for o in out):
            continue
        if any((o.start, o.end) == (h.start, h.end) and o.ref == h.ref for o in out):
            continue
        out.append(h)
    return out
