"""LeakGate: an egress firewall for AI agents. See CONTRACTS.md.

    from leakgate import Gate
    gate = Gate.default()
    s = gate.session()
    s.load_private("crm:C-1042", record)
    d = s.inspect(channel="search", tool="tavily.search", destination="api.tavily.com", payload={"query": q})
"""
from .gate import Gate, Session, load_policy, mask
from .schema import Decision, Finding, Policy, TaintState

__version__ = "0.1.0"
__all__ = ["Gate", "Session", "Decision", "Finding", "Policy", "TaintState", "load_policy", "mask"]
