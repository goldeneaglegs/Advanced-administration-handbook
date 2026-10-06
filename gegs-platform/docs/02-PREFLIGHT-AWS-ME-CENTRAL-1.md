# Pre-flight verification — AWS Middle East (UAE) `me-central-1`

**Date:** 2026-10-06
**Requested by:** client instruction accompanying Phase 2 approval — "before
treating `me-central-1` as operationally final, perform the required pre-flight
verification of all services needed by the approved architecture and report any
availability or regional constraints."

**Outcome: `me-central-1` is NOT verified as operationally final. Two material
constraints were found. One of them invalidates the fallback region named in the
approved Phase 1 §1.1.**

Nothing in Milestone 0 depends on this, and nothing has been provisioned. The
decision is required before Milestone 10 (deployment), not now.

---

## 1. Method, and the limits of it

|              |                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Attempted    | `api.regional-table.region-services.aws.a2z.com` (the dataset behind the AWS regional services table) |
| Result       | **Blocked** — egress proxy refused the CONNECT (HTTP 403)                                             |
| Attempted    | `aws.amazon.com/about-aws/global-infrastructure/regional-product-services/`                           |
| Result       | **Blocked** by the egress policy of this environment                                                  |
| Attempted    | `docs.aws.amazon.com/general/latest/gr/ses.html`                                                      |
| Result       | **Blocked** by the egress policy of this environment                                                  |
| Used instead | Web search across independent technical press and vendor-adjacent sources                             |

**State this plainly: I could not reach a single AWS primary source from this
environment.** Everything below comes from secondary reporting, corroborated
across multiple independent outlets. It is strong enough to act on — strong
enough that proceeding without telling you would be negligent — but it is not a
first-party confirmation, and my own training data ends before some of these
events.

**Therefore: every finding below must be confirmed with your AWS account team
or from the AWS console before any infrastructure is provisioned.** I am
reporting a risk that must be checked, not a verified fact.

---

## 2. Finding 1 — the Phase 1 fallback region no longer exists

Phase 1 §1.1 offered `me-south-1` (Bahrain) as an alternative Gulf region.

Multiple independent outlets report that on **15 September 2026** AWS told
customers it **could not restore** resources and data held exclusively in
`me-south-1`, after damage spanning multiple Availability Zones exceeded what
its regional and multi-AZ services are designed to withstand. The damage is
attributed to drone strikes beginning 1 March 2026, with further strikes in
April and a claimed attack in July.

**Consequence:** `me-south-1` must be struck from the architecture as an option
of any kind — not primary, not failover, not backup target. Phase 1 §1.1 is
corrected by this document.

---

## 3. Finding 2 — `me-central-1` has permanently lost one Availability Zone

The same reporting states that in `me-central-1` the permanent loss is limited
to **one Availability Zone (`mec1-az2`)**, with recovery continuing in the other
affected zones. More than 109 services in the region were disrupted or degraded
from 1 March 2026.

**Consequence.** The approved topology assumed a three-AZ region. If one AZ is
permanently gone, a multi-AZ RDS deployment still functions across the remaining
two, but:

- The resilience margin is one AZ, not two. A single further AZ failure takes
  the database down, not just the standby.
- AWS's own position, as reported, is that the damage **exceeded what regional
  and multi-AZ services are designed to withstand**. That is a statement about
  the limits of the resilience model we were relying on, not about one incident.
- The cause is an ongoing regional conflict, so the risk is live rather than
  historical.

This matters more for this product than for most. The approved residency
constraint (GCC region) and the approved data model (identity documents,
passports, permits) combine badly with a region under physical threat: we are
legally required to keep the data in a place where we have just been told data
can be permanently lost.

---

## 4. Finding 3 — Amazon SES in `me-central-1` is partial

Reported, and consistent in direction across sources:

| Capability                       | `me-central-1`    |
| -------------------------------- | ----------------- |
| Outbound sending via the SES API | Available         |
| **SMTP endpoint**                | **Not available** |
| **Inbound email receiving**      | **Not available** |

**Consequence, and it is small:** the Phase 1 §12 email adapter must be
implemented against the **SES API**, not SMTP. Inbound email is not in scope for
any approved milestone, so its absence costs nothing. This changes an
implementation detail in Milestone 9 and no architecture.

Noted as a design consequence already consistent with the approved plan:
transactional email inherently transits the provider, so notification templates
carry no document content and no case detail — they say only that something
changed and that the recipient should sign in. That keeps personal data inside
the residency boundary even though the email channel crosses it.

---

## 5. Not verified

I could not produce the service-by-service availability table the pre-flight
calls for, because every AWS source that carries it is unreachable from here.
**Unconfirmed for `me-central-1`:** RDS for PostgreSQL (and whether Multi-AZ is
offered given the AZ loss), S3, ECS/Fargate, ECR, CloudFront, AWS WAF, Secrets
Manager, KMS, SQS, EventBridge, CloudWatch, App Runner, ElastiCache.

Treat all of those as **unknown**, not as available.

---

## 6. Recommendation

I am not resolving the hosting decision here: it is yours, it has legal
consequences, and it now carries a business-continuity dimension that was not
visible when Phase 1 was approved.

**My recommendation, ranked:**

1. **Keep `me-central-1` as the primary region, and add a second, independent
   in-GCC location for encrypted backups** — a different provider's Gulf region
   (Azure UAE North / Qatar Central, or Google Cloud Dammam or Doha). This keeps
   the approved residency promise while removing the single-location failure
   that AWS has just told its customers it cannot always survive. Point-in-time
   recovery inside one region is not sufficient when the threat is physical.
2. **Confirm with your AWS account team** the current AZ count, Multi-AZ RDS
   availability, and the service list, before provisioning. One conversation
   closes most of §5.
3. **Re-examine the residency constraint with your legal advisor** — not to
   weaken it, but to establish whether backups may sit in a _different GCC
   country_ than the primary. If they may, recommendation 1 is straightforward.
   If data must stay inside one country, say so and I will design within that,
   accepting the concentration risk explicitly rather than by omission.

**DECISION REQUIRED #13b (new).** Given the above, confirm one of:
(a) proceed on `me-central-1` with cross-GCC encrypted backups;
(b) proceed on `me-central-1` single-location, accepting the concentration risk
in writing;
(c) evaluate an alternative GCC provider as primary.

**DECISION REQUIRED #9b (new).** Whether personal data may be backed up to a GCC
country other than the primary. This is a legal question and I will not assume
an answer.

Both remain open. Neither blocks Milestones 0–9.

---

## 7. Sources

Secondary reporting, consulted 2026-10-06. AWS primary sources were unreachable
from this environment.

- The Register — [AWS says wartime damage means some Middle East cloud resources are gone for good](https://www.theregister.com/off-prem/2026/09/16/aws_says_wartime_damage_means_some_middle_east_cloud_resources_are_gone_for_good/5296830)
- Help Net Security — [Iranian strikes on AWS facilities left customer data beyond recovery in Bahrain, UAE](https://www.helpnetsecurity.com/2026/09/17/aws-middle-east-outage-permanent-data-loss-bahrain-uae/)
- Data Center Dynamics — [AWS "unable to restore access" to data centers hit by Iran strikes](https://www.datacenterdynamics.com/en/news/aws-unable-to-restore-access-to-data-centers-hit-by-iran-strikes/)
- Cyber Security News — [AWS Middle East (UAE) Region Hit by Drone Strikes, 109 Services Disrupted](https://cybersecuritynews.com/aws-middle-east-services-disrupted/)
- Security.io — [AWS confirms permanent data loss across Bahrain and one UAE zone](https://www.security.io/articles/2026/09/18/aws-middle-east-data-loss)
- AWS Fundamentals — [Amazon SES region availability](https://awsfundamentals.com/regions/service/amazon-simple-email-service-ses)
