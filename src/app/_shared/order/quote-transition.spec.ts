import {
  QuotePolicy,
  REPRICE_REASONS,
  REQUIRED_QUOTE_PROTOCOL,
  TERMINAL_REASONS,
  TRANSIENT_REASONS,
  closureAsserted,
  quoteDeadlinePassed,
  readPublishedClosure,
  readPublishedPolicy,
  readQuoteAnswer,
  readQuotePolicy,
  readQuoteRefusal,
  usableClosure,
} from './quote-transition';

/**
 * D06 — the client's reading of a quote refusal and of the published deadline.
 *
 * The distinction every test here defends is TRANSIENT vs TERMINAL, because
 * getting it wrong is a real failure in both directions: treating a pause as
 * terminal throws away a good quote and asks the diner to agree to the same
 * amount again, and treating an expired quote as transient offers a Retry that
 * can never succeed.
 */
describe('D06 quote transition vocabulary', () => {

  const refusal = (reason: string, extra: Record<string, unknown> = {}) =>
    ({ status: 400, message: 'refused', reason, ...extra });

  /** A closure exactly as the backend projects one. */
  const closure = (over: Record<string, unknown> = {}) => ({
    quote_closure: {
      closed_at: '2026-01-01T00:00:00+00:00',
      reason: 'quote_expired',
      quote_ref: 'REF',
      policy_version: 1,
      ...over,
    },
  });

  describe('the disposition of a refusal', () => {
    it('classifies every operational refusal as transient', () => {
      for (const reason of TRANSIENT_REASONS) {
        expect(readQuoteRefusal(refusal(reason))!.disposition)
          .withContext(reason).toBe('transient');
      }
    });

    it('classifies expiry and a changed purchase as terminal — WITH the '
       + 'closure the server records for them', () => {
      // C2 — TERMINAL IS A CLAIM ABOUT A DURABLE RECORD, so the record has to
      // be there. The backend builds every one of these reasons only after
      // `quote_closure.close` returned a row and attaches it beside the word
      // (`_TerminalQuoteOutcome._metadata`), so this is the shape a terminal
      // refusal actually arrives in.
      for (const reason of TERMINAL_REASONS) {
        expect(readQuoteRefusal(refusal(reason, closure({ reason: 'quote_expired' })))!
          .disposition).withContext(reason).toBe('terminal');
      }
    });

    it('classifies a refusal that retired nothing as reprice', () => {
      for (const reason of REPRICE_REASONS) {
        expect(readQuoteRefusal(refusal(reason))!.disposition)
          .withContext(reason).toBe('reprice');
      }
    });

    it('does NOT guess an unrecognised reason into a bucket', () => {
      // A newer server is entitled to add one. Guessing transient loops a dead
      // quote; guessing terminal discards a live one.
      expect(readQuoteRefusal(refusal('something_new'))!.disposition)
        .toBe('unknown');
    });

    it('is null for a failure that carries no reason at all', () => {
      // A timeout, a lost response, an unreachable server. There is nothing to
      // classify and nothing may be settled on the strength of it.
      expect(readQuoteRefusal({ status: 0, message: 'no network' })).toBeNull();
      expect(readQuoteRefusal('no network')).toBeNull();
      expect(readQuoteRefusal(null)).toBeNull();
      expect(readQuoteRefusal(undefined)).toBeNull();
    });

    it('reads a raw HttpErrorResponse as well as a forwarded body', () => {
      // The interceptor forwards an `orders/submit/` 400 carrying a reason as
      // the structured body; a raw error keeps it under `.error`. Reading both
      // is what makes this independent of which one fired.
      const raw = { status: 400, error: refusal('quote_expired') };
      expect(readQuoteRefusal(raw)!.reason).toBe('quote_expired');
    });

    it('C2: a TERMINAL reason with no closure is UNKNOWN, not terminal', () => {
      // `retired` is READ, not inferred — and C2 goes one step further,
      // because "terminal" is not merely a label: it SETTLES the issued
      // command and licenses a replacement key. Every backend that can emit
      // one of these reasons attaches the row it wrote, so the word without
      // the row is a BROKEN PROMISE rather than an older shape, and the safe
      // answer is the one that settles nothing, renews nothing and leaves the
      // record for the authorized read to resolve.
      const withoutClosure = readQuoteRefusal(refusal('quote_expired'))!;
      expect(withoutClosure.disposition).toBe('unknown');
      expect(withoutClosure.retired).toBeFalse();
      expect(withoutClosure.closure).toBeNull();
      expect(withoutClosure.evidence.kind).toBe('absent');
      // and the reason itself is preserved verbatim, so the diner still sees
      // the server's own sentence and a log still says which reason it was.
      expect(withoutClosure.reason).toBe('quote_expired');
    });

    it('C2: and an UNREADABLE closure is distinguished from an absent one', () => {
      const bad = readQuoteRefusal(refusal('quote_expired', closure({
        policy_version: 'one',
      })))!;
      expect(bad.disposition).toBe('unknown');
      expect(bad.evidence.kind).toBe('malformed');
    });

    it('C2: refuses a closure that names a DIFFERENT quote', () => {
      // CONTRADICTS, NOT CONFIRMS. A closure about another reference is a
      // statement about another quote; acting on it would settle this command
      // and mint a successor on evidence about something else.
      const other = readQuoteRefusal(
        refusal('quote_expired', closure({ quote_ref: 'OTHER' })),
        { quoteRef: 'REF' })!;
      expect(other.disposition).toBe('unknown');
      expect(other.evidence.kind).toBe('malformed');

      const mine = readQuoteRefusal(
        refusal('quote_expired', closure()), { quoteRef: 'REF' })!;
      expect(mine.disposition).toBe('terminal');
    });

    it('C2: refuses a reason outside the closure vocabulary', () => {
      // The server guards the same two strings with a database constraint, so
      // a third is not a closure this build has any business acting on.
      const wrong = readQuoteRefusal(refusal('quote_expired', closure({
        reason: 'restaurant_paused',
      })))!;
      expect(wrong.evidence.kind).toBe('malformed');
    });

    it('C2: refuses a closure with no meaningful moment', () => {
      // `closed_at` is NOT NULL on the server and its projection formats it
      // directly, so a missing or unparseable one is a defect.
      expect(readQuoteRefusal(refusal('quote_expired', closure({
        closed_at: null,
      })))!.evidence.kind).toBe('malformed');
      expect(readQuoteRefusal(refusal('quote_expired', closure({
        closed_at: 'whenever',
      })))!.evidence.kind).toBe('malformed');
    });

    it('E1: an UNSUPPORTED policy version is READ and NOT ACTED ON', () => {
      // CHANGED EXPECTATION, DELIBERATELY. This asserted `terminal` +
      // `retired` for any positive version, on the reasoning that retirement
      // is version-independent. That is a forward-compatibility CLAIM — every
      // future rule retires a quote in a way this build may act on — and no
      // protocol guarantee states it: `QUOTE_POLICY_VERSION` is frozen
      // precisely so a new version is a new rule.
      //
      // The evidence is still READ (the closure is carried, so a consumer can
      // say what it knows) and is its own kind, so no consumer settles a
      // command or mints a successor on it. The refusal therefore reports
      // `unknown` — nothing is submitted, nothing is discarded, the record
      // survives, and a later authorized read from a build that knows the
      // version resolves it.
      const future = readQuoteRefusal(refusal('quote_expired', closure({
        policy_version: 99,
      })))!;
      expect(future.disposition).toBe('unknown');
      expect(future.retired).toBeFalse();
      expect(future.closure).toBeNull();
      expect(future.evidence.kind).toBe('unsupported');
      expect(future.evidence.kind === 'unsupported'
        && future.evidence.closure.policyVersion).toBe(99);
    });

    it('reads the closure the server did record', () => {
      const found = readQuoteRefusal(refusal('quote_expired', closure()))!;
      expect(found.retired).toBeTrue();
      expect(found.closure!.quoteRef).toBe('REF');
      expect(found.closure!.policyVersion).toBe(1);
    });

    it('treats a malformed closure as no closure rather than as data', () => {
      const found = readQuoteRefusal(refusal('quote_expired', {
        quote_closure: { reason: 'quote_expired' },   // no ref, no version
      }))!;
      expect(found.retired).toBeFalse();
    });

    it('CONTROL: a REPRICE reason needs no closure and keeps its word', () => {
      // `quote_ref_stale` and `quote_unverifiable` retire nothing by design,
      // so the evidence requirement above must not reach them — they settle
      // the command, keep the key, and re-price the SAME purchase.
      for (const reason of REPRICE_REASONS) {
        expect(readQuoteRefusal(refusal(reason))!.disposition)
          .withContext(reason).toBe('reprice');
      }
    });
  });

  describe('the published deadline', () => {
    const policy = (over: Record<string, unknown> = {}) => ({
      version: 1, status: 'live', expires_at: '2026-01-01T00:30:00+00:00',
      ...over,
    });

    it('is read when the server states the level', () => {
      const read = readPublishedPolicy({
        quote_protocol: REQUIRED_QUOTE_PROTOCOL, quote_policy: policy(),
      })!;
      expect(read.version).toBe(1);
      expect(read.status).toBe('live');
      expect(read.expiresAt).toBe('2026-01-01T00:30:00+00:00');
    });

    it('is NOT read from an older server that never promised one', () => {
      // The level is the promise; a `quote_policy` object beside it is data and
      // does not upgrade it. An absent level is 0, and 0 does NOT mean "quotes
      // never expire here" — it means the server has not said.
      expect(readPublishedPolicy({ quote_policy: policy() })).toBeNull();
      expect(readPublishedPolicy({
        quote_protocol: 0, quote_policy: policy(),
      })).toBeNull();
    });

    it('refuses a policy object it cannot read', () => {
      expect(readQuotePolicy({ quote_policy: { version: 1 } })).toBeNull();
      expect(readQuotePolicy({ quote_policy: { version: 1, status: 'maybe' } }))
        .toBeNull();
      expect(readQuotePolicy({})).toBeNull();
    });

    it('treats the exact deadline instant as passed, mirroring the server', () => {
      const at: QuotePolicy = {
        version: 1, status: 'live', expiresAt: '2026-01-01T00:30:00+00:00',
      };
      const deadline = Date.parse(at.expiresAt!);
      expect(quoteDeadlinePassed(at, deadline - 1)).toBeFalse();
      expect(quoteDeadlinePassed(at, deadline)).toBeTrue();
      expect(quoteDeadlinePassed(at, deadline + 1)).toBeTrue();
    });

    it('says nothing when there is no deadline to read', () => {
      // An unreadable anchor is not a statement that the quote is dead, so the
      // client must not stop offering checkout on the strength of it.
      expect(quoteDeadlinePassed(null, Date.now())).toBeFalse();
      expect(quoteDeadlinePassed(
        { version: 1, status: 'unavailable', expiresAt: null }, Date.now(),
      )).toBeFalse();
      expect(quoteDeadlinePassed(
        { version: 1, status: 'live', expiresAt: 'not-a-date' }, Date.now(),
      )).toBeFalse();
    });
  });

  describe('the vocabulary itself', () => {
    it('keeps the three buckets disjoint', () => {
      const all = [...TRANSIENT_REASONS, ...TERMINAL_REASONS, ...REPRICE_REASONS];
      expect(new Set(all).size).toBe(all.length);
    });

    it('matches the backend codes it is a reading of', () => {
      // Pinned as literals rather than re-derived, so a rename on either side
      // fails a gate instead of silently becoming `unknown` — which the client
      // handles safely but uselessly.
      expect([...TRANSIENT_REASONS].sort()).toEqual([
        'restaurant_paused',
        'restaurant_unavailable',
        'table_ordering_unavailable',
        'table_unavailable',
      ]);
      expect([...TERMINAL_REASONS].sort()).toEqual([
        'purchase_needs_review', 'quote_closed', 'quote_expired',
      ]);
      expect([...REPRICE_REASONS].sort()).toEqual([
        'legacy_pricing_version', 'quote_ref_stale', 'quote_unverifiable',
      ]);
    });
  });
});

/**
 * E1 — THE PUBLISHED CLOSURE, AND THE LEVEL IT IS READ UNDER.
 *
 * Two separate promises move independently here, and conflating them is the
 * defect: `checkout_protocol` says whether an uncertain checkout can be
 * recovered (D04), `quote_protocol` whether a quote may still be accepted
 * (D06). Neither is inferable from the other, and neither from
 * `pricing_version`, which describes how the MONEY was calculated.
 */
describe('E1 — reading a published closure', () => {
  const details = (over: Record<string, unknown> = {}) => ({
    id: 'o1', quote_ref: 'q1', ...over,
  });

  const wire = (over: Record<string, unknown> = {}) => ({
    closed_at: '2026-01-01T00:00:00+00:00',
    reason: 'quote_expired',
    quote_ref: 'q1',
    policy_version: 1,
    ...over,
  });

  it('a level-2 payload carrying a closure is READ', () => {
    const found = readPublishedClosure(
      details({ quote_protocol: 2, quote_closure: wire() }));
    expect(found.kind).toBe('closure');
  });

  it('a level-2 payload carrying NO closure is ABSENT — not retired', () => {
    const found = readPublishedClosure(details({ quote_protocol: 2 }));
    expect(found.kind).toBe('absent');
  });

  it('a payload that states NO level is silence, whatever is beside it', () => {
    // An older server. Its silence about closures is the only shape it has
    // ever had, so a closure-looking object beside it does not upgrade the
    // promise — the level is the promise, the object is data.
    const found = readPublishedClosure(details({ quote_closure: wire() }));
    expect(found.kind).toBe('absent');
  });

  it('THE REGRESSION: silence from a server that ALREADY demonstrated 2 is '
     + 'MALFORMED, not absent', () => {
    // A capability does not un-demonstrate itself. Reading this as "no
    // closure" is the convenient half of a response that has stopped keeping
    // a promise it made for this same attempt.
    const found = readPublishedClosure(details({}), undefined, 2);
    expect(found.kind).toBe('malformed');
    expect(found.kind === 'malformed' && found.defect).toBe('level');
  });

  it('CONTROL: a demonstrated level of 0 leaves silence as silence', () => {
    const found = readPublishedClosure(details({}), undefined, 0);
    expect(found.kind).toBe('absent');
  });

  it('CONTROL: `checkout_protocol` never stands in for `quote_protocol`', () => {
    const found = readPublishedClosure(
      details({ checkout_protocol: 3, quote_closure: wire() }));
    expect(found.kind).toBe('absent');
  });

  it('CONTROL: `pricing_version` never stands in for either', () => {
    const found = readPublishedClosure(
      details({ pricing_version: 'CORRECTED', quote_closure: wire() }));
    expect(found.kind).toBe('absent');
  });

  it('an UNSUPPORTED policy version is its own answer, carrying the row', () => {
    const found = readPublishedClosure(
      details({ quote_protocol: 2, quote_closure: wire({ policy_version: 7 }) }));
    expect(found.kind).toBe('unsupported');
    expect(found.kind === 'unsupported' && found.closure.policyVersion).toBe(7);
    // AND IT IS NOT USABLE, which is the whole point of the distinction.
    expect(usableClosure(found)).toBeNull();
    // while still being an ASSERTION, which is what stops a consumer reading
    // it as "no closure".
    expect(closureAsserted(found)).toBeTrue();
  });

  it('a malformed row is asserted and unusable too', () => {
    const found = readPublishedClosure(details({
      quote_protocol: 2,
      quote_closure: { reason: 'quote_expired' },
    }));
    expect(found.kind).toBe('malformed');
    expect(usableClosure(found)).toBeNull();
    expect(closureAsserted(found)).toBeTrue();
  });

  it('absence is the ONE answer that asserts nothing', () => {
    expect(closureAsserted({ kind: 'absent' })).toBeFalse();
  });

  it('a closure naming ANOTHER quote is refused, not honoured', () => {
    const found = readPublishedClosure(
      details({ quote_protocol: 2, quote_closure: wire() }),
      { quoteRef: 'q-other' });
    expect(found.kind).toBe('malformed');
    expect(found.kind === 'malformed' && found.defect).toBe('other_quote');
  });
});

describe('E1 — the enquiry answer under the supported-policy rule', () => {
  const answer = (over: Record<string, unknown> = {}) => ({
    status: 200, outcome: 'quote_closed', order: 'o1', quote_ref: 'q1',
    quote_closure: {
      closed_at: '2026-01-01T00:00:00+00:00', reason: 'quote_expired',
      quote_ref: 'q1', policy_version: 1,
    },
    ...over,
  });

  const asked = { order: 'o1', quoteRef: 'q1' };

  it('a supported closure retires the quote', () => {
    const read = readQuoteAnswer(answer(), asked, 2);
    expect(read.kind).toBe('retired');
  });

  it('THE REGRESSION: an UNSUPPORTED one is UNREADABLE, so nothing renews',
     () => {
    // The answer that mints a successor may only be produced from evidence
    // this build may act on. Nothing is submitted, nothing is settled,
    // nothing is minted, and the record survives for a later read.
    const read = readQuoteAnswer(answer({
      quote_closure: {
        closed_at: '2026-01-01T00:00:00+00:00', reason: 'quote_expired',
        quote_ref: 'q1', policy_version: 42,
      },
    }), asked, 2);
    expect(read.kind).toBe('unreadable');
    expect(read.kind === 'unreadable' && read.defect)
      .toBe('closure_unsupported_policy');
  });

  it('CONTROL: a still-valid answer is unaffected', () => {
    const read = readQuoteAnswer(
      { status: 200, outcome: 'quote_still_valid', order: 'o1',
        quote_ref: 'q1' }, asked, 2);
    expect(read.kind).toBe('still-valid');
  });
});
