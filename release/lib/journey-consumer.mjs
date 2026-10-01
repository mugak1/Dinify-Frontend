/**
 * CONSUMER EVIDENCE BINDER (D16 / D08 B4, consumer slice).
 *
 * `bindConsumerEvidence({ descriptor, descriptorDigest, admission, admissionDigest, reconstruction, custody, expected })`
 *
 * A PURE function. It takes the B1 bytes-level peer descriptor
 * (journey-peers.selectPeerCandidate), a Stage-1 consumer ADMISSION document (the peer's
 * admission adapter), an optional Backend contained-reconstruction report, the supervisor
 * CUSTODY record, and — supplied SEPARATELY, never read back out of the evidence — the
 * EXPECTED selection and consumer plan. It establishes that those documents describe ONE
 * candidate CONSISTENTLY, and nothing more.
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
 * IT CONSUMES ALREADY-DECODED OBJECTS. Duplicate JSON members are collapsed by the decoder
 * before this function sees them (JSON.parse keeps the last), so this module cannot and does
 * not claim to detect them; rejecting a document with duplicate members is the job of the
 * named JSON-decoding boundary that produced these objects, not of the binder.
 *
 * Pure: no network, filesystem, subprocess, credential, environment read or clock. It
 * imports only release/lib/journey-peers.mjs (and, transitively, canonical.mjs).
 */
import { DESCRIPTOR_SCHEMA, PEER_FORMATS, peerDescriptorDigest } from './journey-peers.mjs';

export const BINDING_SCHEMA = 'dinify.journey.consumer-binding/1';
const B2_RESULT_SCHEMA = 'dinify.journey.peer-observation-result/1';
const CUSTODY_SCHEMA = 'dinify.journey.custody/1';
const ADMISSION_SCHEMA = Object.freeze({ backend: 'dinify.journey.backend-admission/2', admin: 'dinify.journey.admin-admission/1' });
const RECONSTRUCTION_SCHEMA = 'dinify.journey.backend-reconstruction/1';
const BACKEND_REPOSITORY = 'mugak1/Dinify-Backend';

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

/** The reviewed check ids for a peer, in PEER_FORMATS order, and the one deferred past Stage 1. */
function formatChecks(peer) {
  const text = Object.fromEntries(PEER_FORMATS[peer].deferred.map((d) => [idOf(d), String(d)]));
  const ids = PEER_FORMATS[peer].deferred.map(idOf);
  const deferredAfterConsumer = peer === 'backend' ? ['environment-reconstruction'] : [];
  return { ids, deferredAfterConsumer, text };
}

export function bindConsumerEvidence({ descriptor, descriptorDigest, admission, admissionDigest, reconstruction, custody, expected } = {}) {
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
  for (const k of VERDICT_KEYS) {
    if (Object.hasOwn(admission, k)) { refuse('admission_asserts_verdict', `the admission carries a ${k} key; a Stage-1 admission reaches no verdict`); return fail(); }
  }
  if (admission.inputs?.descriptorDigest !== descriptorDigest) { refuse('admission_foreign', 'the admission was produced for another descriptor'); return fail(); }
  // The caller's independently measured digest of THIS admission document. The binder holds the
  // admission as a decoded object and never recomputes its digest (only the canonical descriptor
  // digest is recomputed here), so this is a required caller measurement — like descriptorDigest,
  // but unverifiable here. It is format-checked now and cross-checked against the custody record's
  // own admission sha in step 10, so custody is bound to the admission actually evaluated rather
  // than merely to a shared descriptor.
  if (!DIGEST.test(String(admissionDigest))) { refuse('admission_digest_invalid', 'no well-formed independently measured admission digest was supplied'); return fail(); }

  // ── 3. The independent expectation is COMPLETE, or the binding refuses (never vacuous). ──
  if (!isObject(expected)) { refuse('expected_missing', 'no independent expectation was supplied'); return fail(); }
  const sel = expected.selection;
  if (!isObject(sel) || !isObject(sel.source) || !isObject(sel.receipt) || !isObject(sel.producer) || !isObject(sel.run) || !Array.isArray(sel.requiredJobs) || sel.requiredJobs.length === 0) {
    refuse('expected_incomplete', 'expected.selection must carry peer, repository, source, receipt, producer, run and a non-empty requiredJobs');
    return fail();
  }
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
  if (peer === 'admin' && !nonEmptyObject(expected.unpacker)) { refuse('expected_incomplete', 'an admin expectation must pin the Backend unpacker it depends on'); return fail(); }

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
  bindId('artifact_id_mismatch', cand.id, art.id, 'the candidate artifact id');
  bind('artifact_name_mismatch', cand.name, art.name, 'the candidate artifact name');
  bind('artifact_listed_mismatch', cand.listedDigest, art.listedDigest, 'the candidate listed digest');
  bind('artifact_size_mismatch', cand.size, art.size, 'the candidate size');
  bind('archive_digest_mismatch', cand.measuredDigest, bytes.archive?.measuredDigest, 'the admitted and descriptor archive digests');
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
  // An Admin candidate is extracted by the pinned Backend unpacker; that dependency is bound.
  if (peer === 'admin') {
    bind('unpacker_repository_mismatch', expected.unpacker.repository, BACKEND_REPOSITORY, 'the pinned unpacker repository and Dinify-Backend');
    if (!SHA.test(String(expected.unpacker.commit))) refuse('unpacker_commit_invalid', 'the pinned unpacker commit is not a full sha');
    if (!Object.hasOwn(expected.adapters, expected.unpacker.adapter)) refuse('unpacker_unbound', 'the pinned unpacker adapter is not among the bound adapter hashes');
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

  // ── 9. The reconstruction report: corroboration only, and only when it truly corroborates. ──
  if (reconstruction !== undefined && reconstruction !== null) {
    if (peer !== 'backend') {
      refuse('reconstruction_peer_inappropriate', 'only a backend binding has a reconstruction report');
    } else if (!isObject(reconstruction) || reconstruction.schema !== RECONSTRUCTION_SCHEMA) {
      refuse('reconstruction_invalid', `not a ${RECONSTRUCTION_SCHEMA} document`);
    } else if (reconstruction.startup?.kind !== 'pinned-consumer-startup') {
      // A stub (synthetic-stub, or any other startup) is offered as production evidence.
      refuse('reconstruction_stub', 'the reconstruction did not use the pinned consumer startup');
    } else if (reconstruction.inputs?.admissionDescriptorDigest !== descriptorDigest) {
      refuse('reconstruction_foreign', 'the reconstruction is bound to another descriptor');
    } else if (reconstruction.admitted?.manifestDigest !== admission.admitted?.manifestDigest
        || reconstruction.consumer?.commit !== con.commit) {
      // Bound to this descriptor yet contradicting the admitted manifest or the consumer.
      refuse('reconstruction_contradictory', 'the reconstruction contradicts the admitted manifest or the consumer closure');
    } else if (reconstruction.outcome === 'success' && Array.isArray(reconstruction.problems) && reconstruction.problems.length === 0) {
      // Successful, agreeing, bound — corroboration. The check STAYS deferred: corroboration
      // is not a discharge, and it is produced beside candidate code, not independently.
      checks['environment-reconstruction'] = { text: text['environment-reconstruction'], status: 'corroborated', by: 'contained reconstruction, not independent evidence' };
    } else {
      // Present, pinned, bound, but not successful: no corroboration, and no refusal — the
      // check simply stays deferred.
      checks['environment-reconstruction'] = { text: text['environment-reconstruction'], status: 'deferred', by: 'contained reconstruction present but not successful; corroboration withheld' };
    }
  }

  // ── 10. The custody record: mandatory, bound to this descriptor, the admission and the plan. ──
  if (!isObject(custody)) {
    refuse('custody_missing', 'no supervisor custody record was supplied');
  } else {
    if (custody.schema !== CUSTODY_SCHEMA) refuse('custody_invalid', `the custody record is not a ${CUSTODY_SCHEMA} document`);
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
