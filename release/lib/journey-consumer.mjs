/**
 * CONSUMER EVIDENCE BINDER (D16 / D08 B4, consumer slice).
 *
 * `bindConsumerEvidence({ descriptor, descriptorDigest, admission, admissionDigest, reconstruction, reconstructionDigest, custody, expected })`
 *
 * A PURE function. It takes the B1 bytes-level peer descriptor
 * (journey-peers.selectPeerCandidate), a Stage-1 consumer ADMISSION document (the peer's
 * admission adapter), an optional Backend contained-reconstruction report, the supervisor
 * CUSTODY record, and — supplied SEPARATELY, never read back out of the evidence — the
 * EXPECTED selection and consumer plan. It establishes that those documents describe ONE
 * candidate CONSISTENTLY, and nothing more.
 *
 * THE PINNED STAGE-1 INVOCATION CONTRACT IS COMPLETE, NOT MERELY NON-EMPTY. Each peer's
 * Stage-1 admission adapter accepts a consumer closure of EXACTLY its mandatory subtrees, from
 * EXACTLY the peer's own repository, and executes a fixed set of helper files (STAGE1, below).
 * The plan must pin all of them before anything is compared, so a COORDINATED omission — the
 * same subtree or helper dropped from the plan and every observation together — refuses
 * instead of agreeing with itself. A Stage-2 helper is required only when Stage 2 is in play;
 * a Stage-1-only binding is never made to pin code that did not run.
 *
 * AN ADMIN CANDIDATE IS UNPACKED BY THE PINNED BACKEND UNPACKER, AND THAT DEPENDENCY IS
 * OBSERVED, NOT ONLY PLANNED. The plan pins the unpacker's repository, revision (commit and
 * root tree) and required closure (the Backend Stage-1 subtrees). The custody record states
 * what its boundary MATERIALISED for that dependency (repository, commit, root tree, subtrees,
 * closure manifest — from hash-verified git objects), and the admission states what the
 * adapter's unpack step MEASURED when it loaded that closure (its subtrees and manifest,
 * recomputed from the bytes it imported). Plan, custody and measurement must agree; neither
 * observation is ever filled in from the plan.
 *
 * STAGE 2 IS CUSTODY-BOUND CORROBORATION, NEVER A DISCHARGE. A contained reconstruction can
 * corroborate `environment-reconstruction` only when the custody record truthfully captured
 * that stage (requested, completed, its report's digest recorded, the trusted closure and the
 * admitted directory both re-verified unchanged afterwards), the report states success, and it
 * names this descriptor, this admission document, this admitted manifest and this consumer's
 * complete identity. A failed but otherwise consistent stage leaves the check deferred; a
 * missing, uncustodied, stub or contradictory stage refuses. Even corroborated, the check
 * stays in the deferred list: corroboration produced beside candidate code is not
 * independent evidence.
 *
 * IT REACHES NO VERDICT. On every path, success or refusal:
 *   accepted    is ALWAYS false
 *   provenance  is ALWAYS 'unestablished'
 * A binder proves CONSISTENCY, never EXECUTION PROVENANCE: the admission and the
 * reconstruction are self-reports of processes that ran beside (Stage 2) or without
 * independent attestation of where, or by whom, they ran. "consistent: true" means these
 * documents agree about one candidate; it is not acceptance, not a fresh dependency
 * assessment, and not a release admission.
 *
 * INDEPENDENCE IS THE POINT, SO IT IS NOT MANUFACTURED. The descriptor is bound to the
 * SEPARATELY supplied `expected` plan; the admission and custody are bound to the
 * descriptor and to that same independent plan. The binder never copies a value out of the
 * evidence into the expectation to make them agree, and an incomplete or empty expectation
 * (no selection, no consumer subtrees, no adapters, and — per peer — no companion or no
 * pinned unpacker) REFUSES rather than passing vacuously.
 *
 * ONE DIGEST IS RECOMPUTED, AND EXACTLY ONE. `peerDescriptorDigest(descriptor)` is the
 * CANONICAL digest of the descriptor value (release/lib/canonical.digestOfValue). Every
 * `descriptorDigest` CLAIM — the argument, the admission's, and the custody's — is compared
 * against it. Every OTHER digest here (manifest, record sha, archive measured digest,
 * closure manifest, adapter hashes) is a self-report produced elsewhere over bytes this
 * pure function never sees; it is cross-checked field-to-field between the documents that
 * carry it, and is NEVER recomputed here. Raw-byte vs canonical-JSON digests are therefore
 * never compared across representations: the one representation this module hashes is the
 * canonical descriptor, and it compares that only with other canonical descriptor digests.
 *
 * THE STAGE-DOCUMENT DIGESTS HAVE ONE DEFINED REPRESENTATION: THE EMITTED BYTES. Two
 * caller-supplied measurements are compared, never recomputed: `admissionDigest` and
 * `reconstructionDigest`. Each — and the custody record's `admission.sha256` /
 * `reconstruction.sha256`, and the reconstruction's `inputs.admissionSha256` — is DEFINED as
 * SHA-256 over the EXACT bytes that stage's adapter wrote to stdout and the custody boundary
 * captured: never a re-serialisation of a decoded object, never a canonical form computed here,
 * and never a digest a document states about ITSELF. For the reviewed Backend Stage-1 adapter
 * those bytes are UTF-8 JSON with keys sorted, two-space indentation and one final LF — the
 * representation the committed fixture's recorded admission digest is over (its replay test
 * asserts it). The binder holds decoded objects, so it CANNOT tell which bytes a claimant hashed;
 * it requires the claims to AGREE. A claimant that hashed another serialisation disagrees with
 * one that hashed the emitted bytes, and the binding refuses; claims that all hashed the same
 * other serialisation would agree, which is why every producer must hash the captured bytes.
 * What the binder can see without hashing, it does refuse: the descriptor, the admission and the
 * reconstruction are different documents, so their digests must be pairwise distinct.
 *
 * IT CONSUMES ALREADY-DECODED OBJECTS. Duplicate JSON members are collapsed by the decoder
 * before this function sees them (JSON.parse keeps the last), so this module cannot and does
 * not claim to detect them; rejecting a document with duplicate members is the job of the
 * named JSON-decoding boundary that produced these objects, not of the binder. For the same
 * reason a digest equality here binds the custody record to the BYTES the caller measured; it
 * proves those bytes decode to the object supplied only if that boundary rejected duplicates.
 *
 * Pure: no network, filesystem, subprocess, credential, environment read or clock. It
 * imports only release/lib/journey-peers.mjs (and, through it, that module's own imports).
 */
import { DESCRIPTOR_SCHEMA, PEER_FORMATS, peerDescriptorDigest } from './journey-peers.mjs';

export const BINDING_SCHEMA = 'dinify.journey.consumer-binding/1';
const B2_RESULT_SCHEMA = 'dinify.journey.peer-observation-result/1';
const CUSTODY_SCHEMA = 'dinify.journey.custody/1';
const ADMISSION_SCHEMA = Object.freeze({ backend: 'dinify.journey.backend-admission/2', admin: 'dinify.journey.admin-admission/1' });
const RECONSTRUCTION_SCHEMA = 'dinify.journey.backend-reconstruction/1';
const BACKEND_REPOSITORY = 'mugak1/Dinify-Backend';
const PINNED_STARTUP = 'pinned-consumer-startup';
const UNPACK_FUNCTION = 'release/preflight.py unpack';
const UNPACK_HELPER = 'peer_unpack.py';

// THE PINNED STAGE-1 INVOCATION CONTRACT, per peer. `subtrees` is the exact consumer closure the
// peer's admission adapter accepts (backend_admit.py PATHS; admin_admit.mjs PATHS — each refuses
// any other set) and `helpers` the files Stage 1 actually executes:
//   backend  backend_admit.py, which loads trusted_closure.py (verify and import the consumer
//            closure) and peer_unpack.py (the pinned preflight.unpack + member accounting);
//   admin    admin_admit.mjs, which runs peer_unpack.py, which loads trusted_closure.py to verify
//            and import the BACKEND closure that supplies the unpacker — so the Admin unpacker's
//            required closure is the Backend subtree set, not the Admin one.
// STAGE2_HELPERS are what the contained reconstruction executes (Backend only); they are pinned
// only when Stage 2 is in play and never forced on a Stage-1-only binding.
const STAGE1 = Object.freeze({
  backend: Object.freeze({ subtrees: Object.freeze(['release', 'dependency_audit']), helpers: Object.freeze(['backend_admit.py', 'trusted_closure.py', 'peer_unpack.py']) }),
  admin: Object.freeze({ subtrees: Object.freeze(['release', 'dependency-audit']), helpers: Object.freeze(['admin_admit.mjs', 'peer_unpack.py', 'trusted_closure.py']) }),
});
const STAGE2_HELPERS = Object.freeze({ backend: Object.freeze(['backend_reconstruct.py']), admin: Object.freeze([]) });

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const ID = /^[1-9][0-9]{0,19}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()/+-]{0,199}$/;
// A value from the evidence is only echoed into a diagnostic when it is a short, safe
// token: a digest, a git sha, a decimal id, or a bounded name. Never a path or a secret.
const PEER = Object.freeze(['backend', 'admin']);
// Keys that would assert a verdict a Stage-1 admission has no business reaching.
const VERDICT_KEYS = Object.freeze(['accepted', 'consumerPassed', 'provenance', 'released', 'verified', 'admittedForRelease', 'productionReady']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyObject = (v) => isObject(v) && Object.keys(v).length > 0;
const idOf = (deferred) => String(deferred).split(':')[0];
const safe = (v) => {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
  if (typeof v !== 'string' || v.length === 0 || v.length > 80) return '<omitted>';
  return DIGEST.test(v) || SHA.test(v) || ID.test(v) || NAME.test(v) ? v : '<omitted>';
};

/** Every value of a subtree map is a full git sha (its key set is compared separately). */
const shaMap = (m) => isObject(m) && Object.values(m).every((v) => SHA.test(String(v)));
/** A subtree map's own keys against a required list: [missing, unexpected]. */
function keySetDiff(m, want) {
  const have = isObject(m) ? Object.keys(m) : [];
  return [want.filter((k) => !have.includes(k)), have.filter((k) => !want.includes(k))];
}

/**
 * The custody boundary's own record of the contained Stage 2, read in its actual shape
 * (supervise.py). A stage that was NOT requested records `{ran: false}` (an explanatory
 * `deferred` sentence is optional) and captured no report. A REQUESTED stage records the digest of
 * the report it captured (`sha256`), whether the stage completed (`ran`: exit 0), the two unchanged
 * assertions it re-verified afterwards, and the startup kind it read from that report (null when the
 * report was unreadable) — and states no deferral. Anything else is malformed: a record claiming a
 * completed stage without a captured report, or a deferral beside a captured one, is a
 * contradiction, not a deferral.
 */
function stage2Of(custody) {
  if (!isObject(custody) || custody.reconstruction === undefined) return { state: 'absent', detail: 'the custody record has no reconstruction stage record' };
  const r = custody.reconstruction;
  const malformed = (detail) => ({ state: 'malformed', detail });
  if (!isObject(r) || typeof r.ran !== 'boolean') return malformed('the custody reconstruction record does not state ran as a boolean');
  if (r.sha256 === undefined) {
    if (r.ran !== false) return malformed('the custody record claims a completed contained reconstruction but captured no report');
    for (const k of ['closureUnchanged', 'admittedUnchanged', 'startupKind']) {
      if (Object.hasOwn(r, k)) return malformed(`the custody record states ${k} for a contained reconstruction it never requested`);
    }
    if (r.deferred !== undefined && typeof r.deferred !== 'string') return malformed('the custody reconstruction deferral is not a statement');
    return { state: 'not-requested' };
  }
  if (!DIGEST.test(String(r.sha256))) return malformed('the custody reconstruction report digest is not a sha256 digest');
  if (Object.hasOwn(r, 'deferred')) return malformed('the custody record states a deferral beside a contained reconstruction it captured');
  if (typeof r.closureUnchanged !== 'boolean' || typeof r.admittedUnchanged !== 'boolean') return malformed('the custody record does not state both unchanged assertions as booleans');
  if (r.startupKind !== null && typeof r.startupKind !== 'string') return malformed('the custody record does not state the startup kind of the report it captured');
  return { state: 'requested', ran: r.ran, sha256: r.sha256, closureUnchanged: r.closureUnchanged, admittedUnchanged: r.admittedUnchanged, startupKind: r.startupKind };
}

/**
 * The fields a Backend contained-reconstruction report must carry before anything in it is
 * compared — so a malformed report is refused as malformed, never as a coincidental mismatch.
 * Returns a problem sentence, or null.
 */
function reconstructionShapeProblem(r) {
  if (!isObject(r) || r.schema !== RECONSTRUCTION_SCHEMA) return `not a ${RECONSTRUCTION_SCHEMA} document`;
  if (!isObject(r.startup) || typeof r.startup.kind !== 'string') return 'the reconstruction states no startup kind';
  if (typeof r.outcome !== 'string' || r.outcome.length === 0) return 'the reconstruction states no outcome';
  if (!Array.isArray(r.problems)) return 'the reconstruction carries no problems list';
  if (!isObject(r.inputs) || !DIGEST.test(String(r.inputs.admissionDescriptorDigest)) || !DIGEST.test(String(r.inputs.admissionSha256))) {
    return 'the reconstruction does not name the admission it reconstructed (its descriptor digest and admission document digest)';
  }
  if (!isObject(r.admitted) || !DIGEST.test(String(r.admitted.manifestDigest))) return 'the reconstruction does not name the admitted manifest it re-verified';
  const c = r.consumer;
  if (!isObject(c) || typeof c.repository !== 'string' || !SHA.test(String(c.commit)) || !SHA.test(String(c.tree))
      || !shaMap(c.subtrees) || !DIGEST.test(String(c.closureManifestDigest))) {
    return 'the reconstruction does not state the complete consumer identity (repository, commit, root tree, subtrees, closure manifest)';
  }
  return null;
}

/** The Admin admission's measurement of the unpacker closure it loaded; a problem sentence or null. */
function unpackerObservationProblem(o) {
  if (o.function !== UNPACK_FUNCTION) return `the observation names ${safe(o.function)}, not the pinned ${UNPACK_FUNCTION}`;
  const c = o.closure;
  if (!isObject(c) || !shaMap(c.subtrees) || Object.keys(c.subtrees).length === 0 || !DIGEST.test(String(c.manifestDigest))) {
    return 'the observation does not state the measured closure (its subtree shas and manifest digest)';
  }
  return null;
}

/** The custody record of the unpacker closure it materialised; a problem sentence or null. */
function custodyUnpackerProblem(u) {
  if (typeof u.repository !== 'string' || !SHA.test(String(u.commit)) || !SHA.test(String(u.tree))
      || !shaMap(u.subtrees) || Object.keys(u.subtrees).length === 0 || !DIGEST.test(String(u.manifestDigest))) {
    return 'the custody unpacker record must state its repository, commit, root tree, subtree shas and closure manifest';
  }
  return null;
}

/** The reviewed check ids for a peer, in PEER_FORMATS order, and the one deferred past Stage 1. */
function formatChecks(peer) {
  const text = Object.fromEntries(PEER_FORMATS[peer].deferred.map((d) => [idOf(d), String(d)]));
  const ids = PEER_FORMATS[peer].deferred.map(idOf);
  const deferredAfterConsumer = peer === 'backend' ? ['environment-reconstruction'] : [];
  return { ids, deferredAfterConsumer, text };
}

export function bindConsumerEvidence({ descriptor, descriptorDigest, admission, admissionDigest, reconstruction, reconstructionDigest, custody, expected } = {}) {
  const problems = [];
  const refuse = (code, detail) => { problems.push({ code: `journey.consumer.${code}`, detail: String(detail) }); };
  // A refusal is UNAMBIGUOUS: it exposes no apparently-successful comparisons as a usable
  // decision. consistent is false, and checks/deferred/residuals are withheld.
  const fail = () => ({ schema: BINDING_SCHEMA, consistent: false, accepted: false, provenance: 'unestablished', checks: {}, deferred: [], residuals: [], problems });

  // ── 1. The descriptor is a BYTES-level B1 descriptor, not a B2 summary or metadata. ──
  if (isObject(descriptor) && descriptor.schema === B2_RESULT_SCHEMA) {
    refuse('descriptor_is_observation_summary', 'a B2 observation result is a metadata summary, not a bytes-level descriptor');
    return fail();
  }
  if (!isObject(descriptor) || descriptor.schema !== DESCRIPTOR_SCHEMA) { refuse('descriptor_invalid', 'not a peer descriptor'); return fail(); }
  const peer = descriptor.peer;
  if (!PEER.includes(peer)) { refuse('descriptor_invalid', `unknown peer ${safe(peer)}`); return fail(); }
  const selfDigest = peerDescriptorDigest(descriptor);
  if (selfDigest === null) { refuse('descriptor_not_bytes_level', 'the descriptor does not establish byte correspondence (metadata only)'); return fail(); }
  if (!DIGEST.test(String(descriptorDigest)) || selfDigest !== descriptorDigest) { refuse('descriptor_digest_mismatch', 'descriptorDigest is not the canonical digest of this descriptor'); return fail(); }

  // ── 2. The admission: right peer, right shape, no verdict key, bound to THIS descriptor. ──
  if (!isObject(admission) || admission.schema !== ADMISSION_SCHEMA[peer]) { refuse('admission_invalid', `not a ${ADMISSION_SCHEMA[peer]} document`); return fail(); }
  if (admission.peer !== peer) { refuse('admission_invalid', 'the admission names another peer than the descriptor'); return fail(); }
  if (admission.decision !== 'admitted') { refuse('admission_not_admitted', `the admission decision is ${safe(admission.decision)}`); return fail(); }
  // An ADMITTED Stage-1 result reports no problems — residual qualifications have their own field.
  // A document that says `admitted` while also carrying a non-empty `problems` array (an archive or
  // audit verification failure, say) is internally contradictory and must not be trusted as admitted,
  // however consistent the rest of its identities are. An absent/empty problems list is fine.
  const aProblems = admission.problems;
  if (aProblems !== undefined && aProblems !== null && (!Array.isArray(aProblems) || aProblems.length > 0)) {
    refuse('admission_reports_problems', 'an admitted admission carries problems; an admitted Stage-1 result reports none'); return fail();
  }
  for (const k of VERDICT_KEYS) {
    if (Object.hasOwn(admission, k)) { refuse('admission_asserts_verdict', `the admission carries a ${k} key; a Stage-1 admission reaches no verdict`); return fail(); }
  }
  if (admission.inputs?.descriptorDigest !== descriptorDigest) { refuse('admission_foreign', 'the admission was produced for another descriptor'); return fail(); }
  // The caller's independently measured digest of THIS admission document — SHA-256 over the exact
  // bytes the Stage-1 adapter emitted (the one representation defined in the header). The binder
  // holds the admission as a decoded object and never recomputes its digest (only the canonical
  // descriptor digest is recomputed here), so this is a required caller measurement — like
  // descriptorDigest, but unverifiable here. It is format-checked now and cross-checked against the
  // custody record's own admission sha in step 10 (and, when Stage 2 ran, against the admission the
  // reconstruction names in step 9), so custody is bound to the admission bytes actually measured
  // rather than merely to a shared descriptor.
  if (!DIGEST.test(String(admissionDigest))) { refuse('admission_digest_invalid', 'no well-formed independently measured admission digest was supplied'); return fail(); }
  // The admission and the descriptor are different documents: their digests cannot be one value.
  if (admissionDigest === descriptorDigest) { refuse('admission_digest_invalid', 'the measured admission digest is the descriptor digest; two different documents cannot share bytes'); return fail(); }

  // ── 3. The independent expectation is COMPLETE, or the binding refuses (never vacuous). ──
  if (!isObject(expected)) { refuse('expected_missing', 'no independent expectation was supplied'); return fail(); }
  const sel = expected.selection;
  if (!isObject(sel) || !isObject(sel.source) || !isObject(sel.receipt) || !isObject(sel.producer) || !isObject(sel.run) || !Array.isArray(sel.requiredJobs) || sel.requiredJobs.length === 0) {
    refuse('expected_incomplete', 'expected.selection must carry peer, repository, source, receipt, producer, run and a non-empty requiredJobs');
    return fail();
  }
  // A plan may REQUIRE more than the peer format's minimum, but never less. Dropping below the
  // mandatory set — e.g. requiredJobs: ['test'] on a backend plan, omitting the suite and reconstruct
  // jobs — is a NARROWED selection that journey-peers.checkSelection explicitly rejects. The step-5
  // loop below proves only expected ⊆ descriptor, so it cannot see the narrowing (every listed job
  // is in the descriptor); the plan is incomplete until it pins at least the peer's mandatory jobs.
  for (const job of PEER_FORMATS[peer].requiredJobs) {
    if (!sel.requiredJobs.includes(job)) { refuse('expected_jobs_narrowed', `the expected plan omits the ${peer}-mandatory job ${safe(job)}`); return fail(); }
  }
  // The selection must be ANCHORED to the reviewed peer format, not merely internally consistent with
  // the other documents. The step-5/6 binds cross-check selection ↔ descriptor ↔ admission ↔ custody
  // field to field, so a whole set that names `evil/Other` (with the unkeyed descriptor digest
  // recomputed to match) would agree and bind. The repository a candidate is permitted on, and its CI
  // anchors, are FIXED by PEER_FORMATS — exactly what journey-peers.checkSelection enforces — and the
  // independent plan is NOT validated by selectPeerCandidate, so a well-formed-but-wrong-peer plan, or
  // a malformed sha/digest/id, must be caught here rather than relied on to diverge from a genuine
  // descriptor (the descriptor is attacker-controlled in the same breath).
  const fmt = PEER_FORMATS[peer];
  if (sel.repository !== fmt.repository) { refuse('selection_repository_unanchored', `the expected repository ${safe(sel.repository)} is not the ${peer} format repository`); return fail(); }
  if (sel.producer.workflowPath !== fmt.workflowPath || sel.producer.event !== fmt.event || sel.producer.ref !== fmt.ref) {
    refuse('selection_producer_unanchored', `the expected producer is not the ${peer} format (${fmt.workflowPath} on ${fmt.event} to ${fmt.ref})`); return fail();
  }
  if (!SHA.test(String(sel.source.commit)) || !SHA.test(String(sel.source.tree))) { refuse('selection_unpinned', 'expected.selection.source must be {commit, tree} as full git shas'); return fail(); }
  if (!DIGEST.test(String(sel.receipt.digest)) || sel.receipt.commit !== sel.source.commit) { refuse('selection_unpinned', 'expected.selection.receipt must carry a sha256 digest and name the same commit as source'); return fail(); }
  if (!ID.test(String(sel.run.id)) || !ID.test(String(sel.run.attempt))) { refuse('selection_unpinned', 'expected.selection.run must be {id, attempt} as decimal ids'); return fail(); }
  const econ = expected.consumer;
  if (!isObject(econ) || !nonEmptyObject(econ.subtrees)) {
    refuse('expected_incomplete', 'expected.consumer must carry repository, commit, tree and a non-empty subtree set');
    return fail();
  }
  if (!nonEmptyObject(expected.adapters)) { refuse('expected_incomplete', 'expected.adapters must pin at least one adapter hash'); return fail(); }
  // The expectation is documented as PINNING git shas and adapter digests. Non-emptiness above is
  // necessary but not sufficient: all three documents could carry the SAME malformed value (e.g.
  // "bad") and bind field-to-field. A present-but-malformed pin pins nothing, so a plan whose
  // consumer identities and adapter hashes are not well formed is not a complete plan.
  if (!SHA.test(String(econ.commit)) || !SHA.test(String(econ.tree))) { refuse('expected_unpinned', 'expected.consumer.commit and .tree must be full git shas'); return fail(); }
  for (const [name, v] of Object.entries(econ.subtrees)) {
    if (!SHA.test(String(v))) { refuse('expected_unpinned', `expected.consumer subtree ${safe(name)} is not a full git sha`); return fail(); }
  }
  for (const [name, v] of Object.entries(expected.adapters)) {
    if (!DIGEST.test(String(v))) { refuse('expected_unpinned', `expected.adapters ${safe(name)} is not a sha256 digest`); return fail(); }
  }
  if (peer === 'backend' && !nonEmptyObject(expected.companion)) { refuse('expected_incomplete', 'a backend expectation must pin the reconstruction companion'); return fail(); }
  // A present companion object is not a complete PIN unless its identity fields are well formed — the
  // same precedent as expected_unpinned for the consumer subtrees and adapter hashes. A companion
  // whose listedDigest is 'bad' (or a non-positive id, or a negative/non-integer size) pins nothing,
  // yet the field-to-field binds in step 8 would still agree if the descriptor and admission carried
  // the same malformed value. (The admin unpacker's own fields are format-checked in step 7, and
  // bound to the custody materialisation and the adapter's measurement in steps 7 and 10.)
  if (peer === 'backend') {
    const wc = expected.companion;
    if (!NAME.test(String(wc.name))) { refuse('expected_unpinned', 'the companion name is not well formed'); return fail(); }
    if (!ID.test(String(wc.id))) { refuse('expected_unpinned', 'the companion id is not a positive id'); return fail(); }
    if (!DIGEST.test(String(wc.listedDigest))) { refuse('expected_unpinned', 'the companion listed digest is not a sha256 digest'); return fail(); }
    if (!Number.isInteger(wc.size) || wc.size < 0) { refuse('expected_unpinned', 'the companion size is not a non-negative integer'); return fail(); }
  }
  if (peer === 'admin' && !nonEmptyObject(expected.unpacker)) { refuse('expected_incomplete', 'an admin expectation must pin the Backend unpacker it depends on'); return fail(); }
  // The plan must pin the COMPLETE pinned Stage-1 invocation contract (STAGE1), not merely a
  // non-empty one. The field-to-field binds below prove only that the plan and the observations
  // AGREE, so a subtree or helper dropped from the plan and from every observation together agrees
  // with itself and binds. The consumer is the peer's OWN repository (each admission adapter refuses
  // any other), its closure is EXACTLY the peer's mandatory subtree set (each adapter refuses a
  // different one), and every helper Stage 1 executes is pinned — the trusted-closure helper
  // included. A helper no stage of this peer executes is not pinned "extra"; it is a foreign plan.
  const stage1 = STAGE1[peer];
  if (econ.repository !== fmt.repository) { refuse('expected_consumer_unanchored', `the expected consumer repository ${safe(econ.repository)} is not the ${peer} repository`); return fail(); }
  const [subtreeMissing, subtreeUnexpected] = keySetDiff(econ.subtrees, stage1.subtrees);
  if (subtreeMissing.length > 0) { refuse('expected_subtree_missing', `the expected consumer plan omits the ${peer} Stage-1 subtree ${safe(subtreeMissing[0])}`); return fail(); }
  if (subtreeUnexpected.length > 0) { refuse('expected_subtree_unexpected', `the expected consumer plan names ${safe(subtreeUnexpected[0])}, which the ${peer} Stage-1 adapter does not load`); return fail(); }
  for (const helper of stage1.helpers) {
    if (!Object.hasOwn(expected.adapters, helper)) { refuse('expected_helper_missing', `the expected plan does not pin the ${peer} Stage-1 helper ${safe(helper)}`); return fail(); }
  }
  const knownHelpers = [...stage1.helpers, ...STAGE2_HELPERS[peer]];
  for (const helper of Object.keys(expected.adapters)) {
    if (!knownHelpers.includes(helper)) { refuse('expected_helper_unknown', `the expected plan pins ${safe(helper)}, which no ${peer} stage executes`); return fail(); }
  }
  // Stage 2 is IN PLAY when the custody boundary recorded it as requested; only then must the plan
  // pin the Stage-2 helper. A report or digest offered WITHOUT a custody record of the stage is
  // refused in step 9 as uncustodied, whatever the plan pins. A Stage-1-only binding is never made
  // to pin code that did not run (the plan MAY still pin it: the boundary hashes it).
  const s2 = stage2Of(custody);
  const reconstructionOffered = reconstruction !== undefined && reconstruction !== null;
  const reconstructionDigestOffered = reconstructionDigest !== undefined && reconstructionDigest !== null;
  if (s2.state === 'requested') {
    for (const helper of STAGE2_HELPERS[peer]) {
      if (!Object.hasOwn(expected.adapters, helper)) { refuse('expected_helper_missing', `the contained reconstruction is in play, but the expected plan does not pin its helper ${safe(helper)}`); return fail(); }
    }
  }

  // ── 4. The deferred-check id set is exactly the peer's; each known, none foreign. ──
  const { ids, deferredAfterConsumer, text } = formatChecks(peer);
  const admissionChecks = isObject(admission.checks) ? admission.checks : {};
  for (const id of Object.keys(admissionChecks)) {
    if (!ids.includes(id)) { refuse('check_unknown', `${safe(id)} is not a ${peer} reviewed check`); return fail(); }
  }
  for (const id of ids) {
    if (!Object.hasOwn(admissionChecks, id)) { refuse('check_missing', `the admission does not account for ${id}`); return fail(); }
  }

  // Everything past here ACCUMULATES: a single injected fault yields exactly its own
  // refusal, and any refusal still collapses to the withheld fail() shape at the end.
  const checks = {};
  const deferred = [];
  for (const id of ids) {
    const status = isObject(admissionChecks[id]) ? admissionChecks[id].status : null;
    if (deferredAfterConsumer.includes(id)) {
      // Only the contained reconstruction may speak to this, and only as corroboration.
      if (status !== 'deferred') refuse('check_overcleared', `${id} may not be discharged by a Stage-1 admission`);
      checks[id] = { text: text[id], status: 'deferred', by: 'contained reconstruction, corroboration only' };
      deferred.push(text[id]);
    } else {
      if (status !== 'checked') refuse('check_not_discharged', `${id} is not marked checked`);
      checks[id] = { text: text[id], status: 'consumer-checked', by: typeof admissionChecks[id]?.by === 'string' ? admissionChecks[id].by : null };
    }
  }

  const bind = (code, a, b, what) => { if (a === undefined || a === null || a !== b) refuse(code, `${what} disagree (${safe(a)} vs ${safe(b)})`); };
  // An id may arrive as a number on one side and a decimal string on the other, so ids are
  // compared as strings. But an id ABSENT ON BOTH SIDES must still refuse: String(undefined) is
  // 'undefined', and 'undefined' === 'undefined' would otherwise pass vacuously — the exact
  // "never vacuous" failure this binder exists to avoid. So presence is checked before stringifying.
  const bindId = (code, a, b, what) => { if (a === undefined || a === null || b === undefined || b === null || String(a) !== String(b)) refuse(code, `${what} disagree (${safe(a)} vs ${safe(b)})`); };

  // ── 5. The descriptor against the SEPARATELY supplied selection plan. ──
  bind('selection_peer_mismatch', peer, sel.peer, 'the descriptor peer and the expected peer');
  bind('selection_repository_mismatch', descriptor.repository, sel.repository, 'the descriptor repository and the expected one');
  bind('source_commit_mismatch', descriptor.source?.commit, sel.source.commit, 'the source commit');
  bind('source_tree_mismatch', descriptor.source?.tree, sel.source.tree, 'the source tree');
  bind('receipt_commit_mismatch', descriptor.receipt?.commit, sel.receipt.commit, 'the receipt commit');
  bind('receipt_digest_mismatch', descriptor.receipt?.digest, sel.receipt.digest, 'the receipt digest');
  if (descriptor.receipt?.validated !== true) refuse('receipt_unvalidated', 'the descriptor does not record a validated receipt');
  bind('producer_workflow_mismatch', descriptor.producer?.workflowPath, sel.producer.workflowPath, 'the producer workflow path');
  bind('producer_event_mismatch', descriptor.producer?.event, sel.producer.event, 'the producer event');
  bind('producer_ref_mismatch', descriptor.producer?.ref, sel.producer.ref, 'the producer ref');
  bindId('run_mismatch', descriptor.run?.id, sel.run.id, 'the run id');
  bindId('attempt_mismatch', descriptor.run?.attempt, sel.run.attempt, 'the run attempt');
  // Every job the independent selection REQUIRED must appear in the descriptor's run jobs —
  // selectPeerCandidate supports a required-job list, and a descriptor that omits a caller-required
  // security or validation job must not bind as the same candidate.
  const descriptorJobNames = new Set((Array.isArray(descriptor.jobs) ? descriptor.jobs : []).map((j) => (isObject(j) ? j.name : undefined)));
  for (const jobName of sel.requiredJobs) {
    if (!descriptorJobNames.has(jobName)) refuse('required_job_missing', `the descriptor run does not include the required job ${safe(jobName)}`);
  }

  // ── 6. The admission's self-reported identities against the descriptor. ──
  const bytes = descriptor.bytes ?? {};
  const cand = admission.candidate ?? {};
  const art = descriptor.artifacts?.candidate ?? {};
  // The candidate artifact identity must be WELL FORMED, not merely agree between the admission and the
  // descriptor — the same precedent as the companion pin (step 3). Coordinated malformed values (id
  // 'bad', an arbitrary name, a non-digest listed/measured value, a negative size), with the descriptor
  // digest recomputed to match, would otherwise masquerade as a selected artifact. The name is the
  // DETERMINISTIC one selectPeerCandidate requires for the selected run/attempt
  // (`<candidatePrefix>-<run>-<attempt>`, filtered `a.name === name` there); run id/attempt are the
  // selection's, already format-checked in step 3 and bound to the descriptor just above.
  const wantCandidateName = `${fmt.candidatePrefix}-${sel.run.id}-${sel.run.attempt}`;
  if (!ID.test(String(art.id))) refuse('artifact_unpinned', 'the candidate artifact id is not a positive id');
  if (art.name !== wantCandidateName) refuse('artifact_unpinned', `the candidate artifact name is not the deterministic ${safe(wantCandidateName)}`);
  if (!DIGEST.test(String(art.listedDigest))) refuse('artifact_unpinned', 'the candidate listed digest is not a sha256 digest');
  if (!DIGEST.test(String(bytes.archive?.measuredDigest))) refuse('artifact_unpinned', 'the candidate measured digest is not a sha256 digest');
  if (!Number.isInteger(art.size) || art.size < 0) refuse('artifact_unpinned', 'the candidate size is not a non-negative integer');
  bindId('artifact_id_mismatch', cand.id, art.id, 'the candidate artifact id');
  bind('artifact_name_mismatch', cand.name, art.name, 'the candidate artifact name');
  bind('artifact_listed_mismatch', cand.listedDigest, art.listedDigest, 'the candidate listed digest');
  bind('artifact_size_mismatch', cand.size, art.size, 'the candidate size');
  bind('archive_digest_mismatch', cand.measuredDigest, bytes.archive?.measuredDigest, 'the admitted and descriptor archive digests');
  // The candidate's MEASURED digest (the downloaded archive bytes) must equal its LISTED digest
  // (what the provider's artifact listing claimed) — exactly as the companion path binds
  // ac.measuredDigest to its listed digest. Binding listed-to-listed and measured-to-measured across
  // the admission and the descriptor is not enough on its own: changing BOTH listed digests together
  // while BOTH measured digests keep the original value leaves an archive whose downloaded bytes do
  // not match the provider-listed artifact, yet every cross-document pair still agrees.
  bind('candidate_measured_mismatch', cand.measuredDigest, cand.listedDigest, 'the candidate measured digest and its listed digest');
  bind('record_file_mismatch', cand.record?.file, bytes.record?.file, 'the embedded record filename');
  bind('record_digest_mismatch', cand.record?.sha256, bytes.record?.measuredDigest, 'the admitted record sha and the descriptor record digest');
  const ae = admission.inputs?.expect ?? {};
  bind('admission_commit_mismatch', ae.commit, descriptor.source?.commit, "the admission's processed commit and the descriptor commit");
  bind('admission_tree_mismatch', ae.tree, descriptor.source?.tree, "the admission's processed tree and the descriptor tree");
  bindId('admission_run_mismatch', ae.runId, descriptor.run?.id, "the admission's processed run id");
  bindId('admission_attempt_mismatch', ae.runAttempt, descriptor.run?.attempt, "the admission's processed attempt");
  bind('admission_repository_mismatch', ae.repository, descriptor.repository, "the admission's processed repository and the descriptor repository");

  // ── 6b. The candidate's OWN recorded facts (Backend) against the producer's descriptor claims:
  //        the consumer's reading of what was built must agree with what the producer claimed. Both
  //        documents carry these, so leaving them uncompared would let a contradictory wheelhouse,
  //        environment, source, audit or target bind as "one candidate" — the cross-check is exactly
  //        what "describe ONE candidate consistently" means. (Admin carries no such candidate facts.)
  if (peer === 'backend') {
    const facts = isObject(cand.facts) ? cand.facts : {};
    const claims = isObject(descriptor.claims) ? descriptor.claims : {};
    bind('facts_tree_mismatch', facts.tree, descriptor.source?.tree, 'the candidate record tree and the descriptor tree');
    bind('facts_source_archive_mismatch', facts.sourceArchiveSha256, claims.sourceArchiveSha256, 'the candidate source-archive digest and the producer claim');
    bind('facts_wheelhouse_mismatch', facts.wheelhouseDigest, claims.wheelhouseDigest, 'the candidate wheelhouse digest and the producer claim');
    bind('facts_environment_mismatch', facts.environmentDigest, claims.environmentDigest, 'the candidate environment digest and the producer claim');
    bind('facts_audit_mismatch', facts.auditOutcome, claims.auditOutcome, 'the candidate audit outcome and the producer claim');
    const ft = isObject(facts.target) ? facts.target : {};
    const ct = isObject(claims.target) ? claims.target : {};
    for (const k of ['python', 'implementation', 'platform', 'machine', 'libc']) bind('facts_target_mismatch', ft[k], ct[k], `the candidate target ${safe(k)} and the producer claim`);
  }

  // ── 6c. The consumer VERIFIER's echoed expectation (verifyExpect) — its own account of what it
  //        processed — bound to the descriptor and selection, not only to inputs.expect. A
  //        contradiction between the wrapper request and the verifier invocation must not bind as
  //        one candidate. Backend only: the backend consumer verifier emits this echo; admin does not.
  if (peer === 'backend') {
    const ve = admission.verifyExpect;
    if (!isObject(ve)) {
      refuse('verify_expect_missing', 'the backend admission carries no verifyExpect echo');
    } else {
      bind('verify_expect_repository_mismatch', ve.repository, descriptor.repository, "the verifier's repository and the descriptor repository");
      bind('verify_expect_commit_mismatch', ve.commit, descriptor.source?.commit, "the verifier's commit and the descriptor commit");
      bind('verify_expect_tree_mismatch', ve.tree, descriptor.source?.tree, "the verifier's tree and the descriptor tree");
      bind('verify_expect_workflow_mismatch', ve.workflowPath, descriptor.producer?.workflowPath, "the verifier's workflow path and the descriptor producer");
      bind('verify_expect_event_mismatch', ve.event, descriptor.producer?.event, "the verifier's event and the descriptor producer");
      bind('verify_expect_ref_mismatch', ve.ref, descriptor.producer?.ref, "the verifier's ref and the descriptor producer");
      bindId('verify_expect_run_mismatch', ve.runId, descriptor.run?.id, "the verifier's run id");
      bindId('verify_expect_attempt_mismatch', ve.runAttempt, descriptor.run?.attempt, "the verifier's run attempt");
      bind('verify_expect_artifact_mismatch', ve.artifact, descriptor.artifacts?.candidate?.name, "the verifier's artifact and the candidate artifact name");
    }
  }

  // ── 7. The admission's consumer closure against the independent consumer plan. ──
  const con = admission.consumer ?? {};
  bind('consumer_repository_mismatch', con.repository, econ.repository, 'the consumer repository');
  bind('consumer_commit_mismatch', con.commit, econ.commit, 'the consumer commit');
  bind('consumer_tree_mismatch', con.tree, econ.tree, 'the consumer root tree');
  const wantSub = econ.subtrees;
  const gotSub = isObject(con.subtrees) ? con.subtrees : {};
  for (const name of Object.keys(wantSub)) bind('consumer_subtree_mismatch', gotSub[name], wantSub[name], `the consumer ${safe(name)} subtree`);
  if (Object.keys(gotSub).length !== Object.keys(wantSub).length) refuse('consumer_subtree_mismatch', 'the consumer subtree set is not the expected one');
  // ── 7b. (Admin) the pinned Backend unpacker: the plan's pin, then the adapter's MEASUREMENT. ──
  // An Admin candidate is extracted by the pinned Backend unpacker. The plan pins that dependency —
  // its repository, revision and required closure (exactly the Backend Stage-1 subtrees) and the
  // Stage-1 helper that runs it. The admission must carry what that unpack step MEASURED when it
  // loaded the closure (its subtree shas and manifest, recomputed from the bytes it imported) —
  // a measurement, never the plan echoed back. Each structure is validated before it is compared;
  // the plan's revision is bound to the custody materialisation in step 10, since only the custody
  // boundary verified the commit and root tree objects themselves.
  let unpackerPlanRevision = false;
  let unpackerPlanClosure = false;
  let unpackerMeasured = null;
  if (peer === 'admin') {
    const eu = expected.unpacker;
    bind('unpacker_repository_mismatch', eu.repository, BACKEND_REPOSITORY, 'the pinned unpacker repository and Dinify-Backend');
    if (!SHA.test(String(eu.commit)) || !SHA.test(String(eu.tree))) refuse('unpacker_commit_invalid', 'the pinned unpacker commit and root tree must be full shas');
    else unpackerPlanRevision = true;
    const [closureMissing, closureUnexpected] = keySetDiff(eu.subtrees, STAGE1.backend.subtrees);
    if (closureMissing.length > 0 || closureUnexpected.length > 0 || !shaMap(eu.subtrees)) {
      refuse('unpacker_closure_incomplete', 'the pinned unpacker closure must be exactly the Backend Stage-1 subtrees, each a full sha');
    } else {
      unpackerPlanClosure = true;
    }
    if (eu.adapter !== UNPACK_HELPER || !Object.hasOwn(expected.adapters, eu.adapter)) refuse('unpacker_unbound', `the pinned unpacker adapter is not the bound Stage-1 unpack helper ${UNPACK_HELPER}`);
    const measured = admission.unpacker;
    if (!isObject(measured)) {
      refuse('unpacker_observation_missing', 'the admin admission carries no measurement of the unpacker closure it loaded');
    } else {
      const bad = unpackerObservationProblem(measured);
      if (bad) {
        refuse('unpacker_observation_invalid', bad);
      } else {
        unpackerMeasured = measured.closure;
        if (unpackerPlanClosure) {
          for (const name of STAGE1.backend.subtrees) bind('unpacker_closure_mismatch', unpackerMeasured.subtrees[name], eu.subtrees[name], `the measured and pinned unpacker ${safe(name)} subtrees`);
          if (Object.keys(unpackerMeasured.subtrees).length !== STAGE1.backend.subtrees.length) refuse('unpacker_closure_mismatch', 'the measured unpacker closure is not the pinned subtree set');
        }
      }
    }
  }

  // ── 8. The companion (Backend): its full identity against the descriptor and the plan. ──
  if (peer === 'backend') {
    const wantComp = expected.companion;
    const dc = descriptor.artifacts?.reconstruction ?? {};
    const ac = admission.reconstructionCompanion ?? {};
    bind('companion_name_mismatch', dc.name, wantComp.name, 'the reconstruction companion name (descriptor)');
    bindId('companion_id_mismatch', dc.id, wantComp.id, 'the reconstruction companion id');
    bind('companion_listed_mismatch', dc.listedDigest, wantComp.listedDigest, 'the reconstruction companion listed digest');
    bind('companion_size_mismatch', dc.size, wantComp.size, 'the reconstruction companion size');
    // The ADMISSION carries the companion's full identity too (id, listed digest, size), not just
    // its name — so a companion that described another artifact would otherwise bind. Each admission
    // field is bound to the plan the descriptor's companion is already bound to.
    bind('companion_admission_name_mismatch', ac.name, wantComp.name, 'the reconstruction companion name (admission)');
    bindId('companion_admission_id_mismatch', ac.id, wantComp.id, 'the reconstruction companion id (admission)');
    bind('companion_admission_listed_mismatch', ac.listedDigest, wantComp.listedDigest, 'the reconstruction companion listed digest (admission)');
    bind('companion_admission_size_mismatch', ac.size, wantComp.size, 'the reconstruction companion size (admission)');
    // The companion's MEASURED digest (the downloaded reconstruction bytes) must agree with the
    // bound listed digest, exactly as the candidate archive path checks cand.measuredDigest — a
    // companion whose measured bytes differ from the selected artifact must not bind.
    bind('companion_measured_mismatch', ac.measuredDigest, wantComp.listedDigest, 'the reconstruction companion measured digest and the bound listed digest (admission)');
    if (ac.boundToRecord !== true) refuse('companion_unbound', 'the admission does not record the reconstruction companion bound to this record');
  }

  // ── 9. Stage 2: CUSTODY-BOUND corroboration, and only when it truly corroborates. ──
  // The result contract (see the header):
  //   custody: not requested, nothing offered     → Stage-1-only; the check stays deferred
  //   custody: not requested, report/digest offered → refused (uncustodied)
  //   custody: requested, report or digest absent   → refused (missing)
  //   requested, malformed / stub / any identity disagreement / outcome contradicting custody → refused
  //   requested, everything agrees, not successful  → no refusal; deferred, corroboration withheld
  //   requested, everything agrees, successful      → corroborated — still in the deferred list
  //   Admin: any report, digest or REQUESTED custody record → refused (peer-inappropriate)
  // A malformed custody stage record (either peer) and an absent Backend one are refused in
  // step 10, and nothing here corroborates without a requested one.
  if (peer !== 'backend') {
    if (reconstructionOffered || reconstructionDigestOffered || s2.state === 'requested') {
      refuse('reconstruction_peer_inappropriate', 'only a backend binding has a contained reconstruction');
    }
  } else if (s2.state === 'not-requested') {
    if (reconstructionOffered || reconstructionDigestOffered) {
      refuse('reconstruction_uncustodied', 'a contained reconstruction is offered that the custody record never captured (the stage was not requested)');
    }
  } else if (s2.state === 'requested') {
    if (!reconstructionOffered || !reconstructionDigestOffered) {
      refuse('reconstruction_missing', 'the custody record captured a contained reconstruction; the handoff must supply its report and the measured digest of that report');
    } else {
      const shape = reconstructionShapeProblem(reconstruction);
      if (shape) {
        refuse('reconstruction_invalid', shape);
      } else {
        const before = problems.length;
        // A stub (synthetic-stub, or any startup but the pinned consumer's) is never production
        // evidence — whether the report says so or the custody boundary's reading of it does.
        if (reconstruction.startup.kind !== PINNED_STARTUP || s2.startupKind !== PINNED_STARTUP) refuse('reconstruction_stub', 'the pinned consumer startup is not established (as the report states it, or as the custody boundary read it)');
        // The report supplied IS the report the custody boundary captured: both digests are over
        // the stage adapter's emitted bytes (header). A document never states its own digest.
        if (!DIGEST.test(String(reconstructionDigest))) refuse('reconstruction_digest_invalid', 'no well-formed independently measured reconstruction digest was supplied');
        else if (reconstructionDigest === admissionDigest || reconstructionDigest === descriptorDigest) refuse('reconstruction_digest_invalid', 'the measured reconstruction digest is the admission or descriptor digest; different documents cannot share bytes');
        else bind('reconstruction_digest_mismatch', s2.sha256, reconstructionDigest, 'the custody and the independently measured reconstruction digests');
        // The admission it reconstructed: this descriptor, this admission document, this manifest.
        if (reconstruction.inputs.admissionDescriptorDigest !== descriptorDigest) refuse('reconstruction_foreign', 'the reconstruction is bound to another descriptor');
        if (reconstruction.inputs.admissionSha256 !== admissionDigest) refuse('reconstruction_admission_mismatch', 'the reconstruction names another admission document than the one measured');
        if (reconstruction.admitted.manifestDigest !== admission.admitted?.manifestDigest) refuse('reconstruction_contradictory', 'the reconstruction contradicts the admitted manifest');
        // The consumer it ran: the admission's COMPLETE identity, never a shared commit alone.
        const rc = reconstruction.consumer;
        for (const k of ['repository', 'commit', 'tree', 'closureManifestDigest']) bind('reconstruction_consumer_mismatch', rc[k], con[k], `the reconstruction and admission consumer ${k}`);
        const [rcMissing, rcUnexpected] = keySetDiff(rc.subtrees, Object.keys(isObject(con.subtrees) ? con.subtrees : {}));
        if (rcMissing.length > 0 || rcUnexpected.length > 0) refuse('reconstruction_consumer_mismatch', 'the reconstruction consumer subtree set is not the admission one');
        else for (const name of Object.keys(rc.subtrees)) bind('reconstruction_consumer_mismatch', rc.subtrees[name], con.subtrees[name], `the reconstruction and admission consumer ${safe(name)} subtrees`);
        // Its own outcome — internally, and against the custody boundary's record of the stage.
        const succeeded = reconstruction.outcome === 'success';
        if (succeeded !== (reconstruction.problems.length === 0)) {
          refuse('reconstruction_outcome_contradictory', 'the reconstruction outcome contradicts its own problems list');
        } else if (s2.ran !== succeeded) {
          refuse('reconstruction_outcome_contradictory', `the custody record says the stage ${s2.ran ? 'completed' : 'did not complete'}, the report says ${succeeded ? 'success' : 'not success'}`);
        }
        if (problems.length === before) {
          // Successful, agreeing, custody-bound: corroboration. Failed but otherwise consistent:
          // no refusal, corroboration withheld. Either way the check STAYS deferred — corroboration
          // is not a discharge, and it is produced beside candidate code, not independently.
          checks['environment-reconstruction'] = succeeded
            ? { text: text['environment-reconstruction'], status: 'corroborated', by: 'contained reconstruction, not independent evidence' }
            : { text: text['environment-reconstruction'], status: 'deferred', by: 'contained reconstruction present but not successful; corroboration withheld' };
        }
      }
    }
  }

  // ── 10. The custody record: mandatory, bound to this descriptor, the admission and the plan. ──
  if (!isObject(custody)) {
    refuse('custody_missing', 'no supervisor custody record was supplied');
  } else {
    if (custody.schema !== CUSTODY_SCHEMA) refuse('custody_invalid', `the custody record is not a ${CUSTODY_SCHEMA} document`);
    // A custody boundary that STOPPED records why in `problems`; whatever else that record says, it
    // is not the record of a completed handoff and must not bind. The list itself is required.
    if (!Array.isArray(custody.problems)) refuse('custody_invalid', 'the custody record carries no problems list');
    else if (custody.problems.length > 0) refuse('custody_reports_problems', 'the custody record reports problems; a custody boundary that stopped does not bind');
    // Stage 2 as the boundary recorded it (step 9 binds it to the report). The Backend record is
    // required; the Admin path has no Stage 2, so it may omit the record or state that none ran.
    // A requested stage must carry BOTH unchanged assertions as true: a trusted closure or admitted
    // directory that changed while candidate code ran is no longer what the admission vouched for.
    if (s2.state === 'malformed' || (peer === 'backend' && s2.state === 'absent')) refuse('custody_reconstruction_invalid', s2.detail);
    if (peer === 'backend' && s2.state === 'requested' && (s2.closureUnchanged !== true || s2.admittedUnchanged !== true)) {
      refuse('custody_reconstruction_changed', 'the custody boundary did not re-verify both the trusted closure and the admitted directory unchanged after the contained reconstruction');
    }
    // The custody descriptor identity is REQUIRED (an omitted one does not pass vacuously).
    bind('custody_foreign', custody.descriptorDigest, descriptorDigest, 'the custody and binding descriptor digests');
    const ca = isObject(custody.admission) ? custody.admission : {};
    bind('custody_admission_foreign', ca.descriptorDigest, descriptorDigest, 'the custody admission descriptor digest');
    bind('custody_admission_sha_mismatch', ca.sha256, admissionDigest, 'the custody and the independently measured admission digests');
    if (ca.decision !== 'admitted') refuse('custody_admission_not_admitted', 'the custody record does not record an admitted admission');
    const cad = isObject(custody.admitted) ? custody.admitted : {};
    bind('custody_manifest_mismatch', cad.manifestDigest, admission.admitted?.manifestDigest, 'the custody and admission admitted-manifest digests');
    bind('custody_record_mismatch', cad.recordSha256, admission.candidate?.record?.sha256, 'the custody and admission record digests');
    const cc = isObject(custody.closure) ? custody.closure : {};
    bind('custody_closure_commit_mismatch', cc.commit, con.commit, 'the custody and admission consumer commits');
    bind('custody_closure_tree_mismatch', cc.tree, con.tree, 'the custody and admission consumer trees');
    // The custody closure's full identity — its subtrees, and (Backend) its closure-manifest
    // digest — against the admission's consumer closure. The root tree does not subsume these: a
    // custody record naming different subtree shas or a different trusted-consumer closure manifest
    // identifies other code than the admission admitted, and must not bind as one candidate.
    const ccSub = isObject(cc.subtrees) ? cc.subtrees : {};
    const conSub = isObject(con.subtrees) ? con.subtrees : {};
    for (const name of Object.keys(conSub)) bind('custody_closure_subtree_mismatch', ccSub[name], conSub[name], `the custody and admission consumer ${safe(name)} subtree`);
    if (Object.keys(ccSub).length !== Object.keys(conSub).length) refuse('custody_closure_subtree_mismatch', 'the custody closure subtree set is not the admission consumer one');
    if (peer === 'backend') bind('custody_closure_manifest_mismatch', cc.manifestDigest, con.closureManifestDigest, 'the custody and admission consumer closure-manifest digests');
    // The adapters: exactly the expected set, each hash equal. An empty expected set was
    // already refused at step 3, so this is never a vacuous match.
    const wantAd = expected.adapters;
    const gotAd = isObject(custody.adapters) ? custody.adapters : {};
    for (const name of Object.keys(wantAd)) bind('adapter_hash_mismatch', gotAd[name], wantAd[name], `the ${safe(name)} adapter hash`);
    if (Object.keys(gotAd).length !== Object.keys(wantAd).length) refuse('adapter_set_mismatch', 'the custody adapter set is not the expected one');
    // (Admin) what the custody boundary MATERIALISED for the Backend unpacker dependency, from
    // hash-verified git objects: its repository and revision bound to the plan's pin, its closure to
    // the plan and to what the admission's unpack step measured when it loaded it.
    if (peer === 'admin') {
      const cu = custody.unpacker;
      if (!isObject(cu)) {
        refuse('custody_unpacker_missing', 'the custody record does not state the Backend unpacker closure it materialised');
      } else {
        const bad = custodyUnpackerProblem(cu);
        if (bad) {
          refuse('custody_unpacker_invalid', bad);
        } else {
          const eu = expected.unpacker;
          bind('unpacker_repository_mismatch', cu.repository, eu.repository, 'the materialised and pinned unpacker repositories');
          // A malformed pin was already refused in step 7; comparing against it adds no reason.
          if (unpackerPlanRevision) {
            bind('unpacker_revision_mismatch', cu.commit, eu.commit, 'the materialised and pinned unpacker commits');
            bind('unpacker_revision_mismatch', cu.tree, eu.tree, 'the materialised and pinned unpacker root trees');
          }
          if (unpackerPlanClosure) {
            for (const name of STAGE1.backend.subtrees) bind('unpacker_closure_mismatch', cu.subtrees[name], eu.subtrees[name], `the materialised and pinned unpacker ${safe(name)} subtrees`);
            if (Object.keys(cu.subtrees).length !== STAGE1.backend.subtrees.length) refuse('unpacker_closure_mismatch', 'the materialised unpacker closure is not the pinned subtree set');
          }
          if (unpackerMeasured) bind('unpacker_manifest_mismatch', unpackerMeasured.manifestDigest, cu.manifestDigest, 'the measured and materialised unpacker closure manifests');
        }
      }
    }
  }

  if (problems.length > 0) return fail();

  const residuals = [
    'consistent means these documents describe one candidate; it is not acceptance and not provenance',
    'historical audit verified; fresh assessment not performed; no release admission',
    'one digest is recomputed here — the canonical descriptor digest; every other digest is a self-report cross-checked field-to-field, never recomputed over bytes this pure function never sees',
    peer === 'backend'
      ? 'environment-reconstruction stays deferred; a present reconstruction is corroboration produced beside candidate code, not independent evidence'
      : 'the Admin candidate was extracted by the pinned Backend unpacker; its closure is pinned by the Backend approval, not re-established here',
  ];
  return {
    schema: BINDING_SCHEMA,
    peer,
    consistent: true,
    accepted: false,
    provenance: 'unestablished',
    descriptorDigest,
    checks,
    deferred,
    residuals,
    problems,
  };
}
