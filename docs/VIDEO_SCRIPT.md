# Video script: 5 slides, then the live demo (about 3:00)

## Before you hit record
- API on :8100, dashboard on :4180, Ollama running. Run one prompt first to warm the model.
- Hard-refresh the dashboard (Ctrl+Shift+R). Workspace knob on **Insurance**, poison switch off, press **Clear**.
- Agent runs take 3–15 s. Talk over the wait, or trim it in the edit.

## Script 1: the slides (about 75 s)

| Slide | Time | Say |
|---|---|---|
| 1 · LeakGate | 0:00 | "This is LeakGate, a firewall for AI agents. You can give an agent your private data, and LeakGate decides what is allowed to leave the machine." |
| 2 · Three keys | 0:12 | "Agents now hold three keys at once: your private data, content from the open web, and a way to send things out. Security people call this the lethal trifecta. Put the three together and one poisoned web page can talk the agent into walking your data out the door." |
| 3 · Guard the exit | 0:27 | "Most tools try to spot the attack. We assume the attack works and guard the exit instead. LeakGate sits between the agent and the internet, remembers what the agent has read as fingerprints, never copies, and checks every outgoing call. Clean requests go out. Private details are rewritten out of searches, so the research still works. Anything headed somewhere unapproved, or hidden or split up, is blocked." |
| 4 · Proof | 0:47 | "On our 200-request benchmark, a typical regex DLP catches 23% of leaks and Microsoft Presidio 34%. LeakGate catches 98.5%, with 1.5% false alarms. And every decision is in a hash-chained ledger, so you can prove what left." |
| 5 · Who it's for | 1:02 | "Any team putting an agent near private data. Today an insurer's claims agent and a drug company's safety agent; for a bank or a law firm, it's the same gate with a new data file. Let's see it live." |

## Script 2: the live demo (about 105 s)

**D1 · Rewrite (1:15).** Insurance. Click **Research Maria's claim**, then **Run**.
> "Here's a claims agent at a fictional insurer. I'm asking it to research a customer, and to put her
> name, policy number and SSN in the search."

When the amber **Rewritten** card appears:
> "Left: what the agent tried to send, masked. Right: what Tavily actually received. The question went
> out; she didn't. And the answer still cites real pages."

**D2 · Prompt injection (1:45).** Click **Poisoned search result** (the poison switch turns on), then **Run**.
> "Now one search result is a poisoned page with hidden instructions."

When the red **Blocked** card appears:
> "The model fell for it. It tried to send her SSN and birth date to the attacker's site. Blocked.
> Both lights are on: lockdown. LeakGate never had to recognise the attack."

**D3 · Another industry (2:15).** Turn the **Workspace** knob to **Pharma**. Click **Share with the brand team**, then **Run**.
> "Same gate, different industry: a drug company's safety agent with an adverse-event case. It tries
> to post the reporting doctor's name and phone number to a paste site. Blocked, and the agent goes
> looking for an approved channel instead."

(Alternative: **Poisoned search result** in Pharma. The block reason lists the doctor's name, phone,
MRN and date of birth.)

**D4 · Proof (2:40).** Open **Ledger**, then **Verify chain**.
> "Every decision you just saw is in this hash-chained ledger: what it tried, as keyed hashes; what
> left, as-is. Verify: intact. All of it ran on this laptop. That's LeakGate."

## If something goes wrong on camera
- In D2 the model ignores the planted page: run **Send her SSN somewhere** instead. It always blocks.
- Ollama is down: open **Guided demos** in Scripted mode. The gate's decisions are still made live.
