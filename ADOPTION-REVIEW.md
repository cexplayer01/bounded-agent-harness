# Adoption review and comparative rollback guard

Recorded 2026-09-26. This is a reproducible evaluation record, not a marketing benchmark or legal opinion.

## Frozen review surface

The same five alternatives must be used for the post-update review:

1. [LangGraph](https://langchain-ai.github.io/langgraph/)
2. [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)
3. [Google ADK](https://google.github.io/adk-docs/)
4. [Microsoft Agent Framework](https://learn.microsoft.com/agent-framework)
5. [CrewAI](https://docs.crewai.com/)

The fixed weights are token efficiency 15%, boundaries and authority 25%, recovery and resume 20%, real-provider evidence
15%, adoption and ecosystem 15%, and documentation/operator path 10%. Each system receives a 1-to-10 score for each
dimension. The scorecard rounds each system's weighted result to one decimal before calculating the comparator mean.

The independent baseline review found:

| System | Weighted score |
| --- | ---: |
| Bounded Agent Harness | 6.5 |
| LangGraph | 7.8 |
| OpenAI Agents SDK | 6.9 |
| Google ADK | 7.9 |
| Microsoft Agent Framework | 8.0 |
| CrewAI | 7.0 |

Baseline comparator mean: **7.52**. Baseline relative margin: **−1.02**. Baseline repository control point:
`0f0b44ec176cacd5ee3b8b81edf6e268514e1b59`. Baseline live deployment: `6ab744b468ad7d2c44b2ccf5`. The local rollback
tag is `rollback/boundedagentharness-pre-adoption-review-20260926`.

## Work status

| Review item | Status | Honest boundary |
| --- | --- | --- |
| Real-provider MCP compatibility using an actual host client | NOT EXECUTED | The package has an in-process two-provider proof, but this session has no programmatic bridge that lets the harness invoke one of the host's MCP tools. No external-provider pass is claimed. |
| Repeatable representative evaluation | IMPLEMENTED | The matrix covers compile, provider-shape handling, approval wait/resume, bounded retry, process restart, scope/authority bypass, and full regression. |
| Authority, approval, secret, and identity boundaries outside model instructions | PASS WITH LOCAL SCOPE | Capability envelopes, closed contracts, identity pins, token gates, scope reservations, and fail-closed tests enforce this in the local control plane. External cryptographic provider attestation remains unproven. |
| AGPL adoption review | DOCUMENTED / COUNSEL REQUIRED | The repository records the AGPL community path and a commercial alternative. A lawyer must decide whether a proposed proprietary/network deployment complies or needs a commercial license. |
| Crash/fault-injection recovery | HELD BACK | Interrupted writes, stale checkpoints, duplicate messages, and partial external-effect fault injection are intentionally not part of this release gate. |

## Comparative rollback rule

The follow-up reviewer must use the exact comparison set, weights, and dimensions above. `compareAdoptionScorecards`
marks `automaticRollback: true` when the relative margin falls below the baseline margin or when the harness rank worsens.
A host must restore live deployment `6ab744b468ad7d2c44b2ccf5` before accepting the candidate. A raw score that falls for
every system does not by itself trigger rollback; the comparison is against the fixed comparator surface.

This rule is intentionally strict and deterministic. It reduces reviewer drift, but it does not turn subjective scores
into an objective scientific benchmark. The second review must preserve its evidence URLs, scorecard digest, source
commit, and live release receipt.

## Licensing note

The package is licensed `AGPL-3.0-or-later`, with a separately negotiated commercial alternative. The [GNU AGPL text](https://www.gnu.org/licenses/agpl-3.0.html)
and [FSF explanation](https://www.gnu.org/licenses/why-affero-gpl.en.html) should be reviewed with counsel before
embedding modified harness code in a proprietary network service. A sponsorship, private repository, or deployment does
not by itself grant different rights. This record identifies the decision point; it does not provide legal advice.

## Reproduction

```powershell
node --test test/adoption-evaluation.test.mjs
node bin/adoption-scorecard.mjs examples/adoption-baseline-scorecard.v1.json
node --test
node bin/audit-package.mjs
```

The public website may summarize this review, but the repository scorecard and its digest are the authoritative comparison
record. Deployment remains separately gated.
