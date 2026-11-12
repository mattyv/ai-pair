/** Identifies one actual browser document within a page. */
export interface DecodeDocument {
  pageId: number;
  documentGeneration: number;
}

/** Identifies one request within its document. */
export interface DecodeRequest extends DecodeDocument {
  requestId: number;
}

/** Identifies one readiness probe so a timed-out acknowledgement cannot satisfy its retry. */
export interface DecodeProbe extends DecodeDocument {
  probeId: number;
}

/** Compares document identities. */
function sameDocument(left: DecodeDocument | undefined, right: DecodeDocument): boolean {
  return left !== undefined && left.pageId === right.pageId && left.documentGeneration === right.documentGeneration;
}

/** Compares request identities. */
function sameRequest(left: DecodeRequest | undefined, right: DecodeRequest): boolean {
  return left !== undefined && sameDocument(left, right) && left.requestId === right.requestId;
}

/** Compares probe identities. */
function sameProbe(left: DecodeProbe | undefined, right: DecodeProbe): boolean {
  return left !== undefined && sameDocument(left, right) && left.probeId === right.probeId;
}

/** Owns decoder readiness and one physical decode slot across document changes. */
export class SpeechDecodeLifecycle {
  private current?: DecodeDocument;
  private pendingProbe?: DecodeProbe;
  private isReady = false;
  private latestProbe = 0;
  private latestRequest = 0;
  private active?: DecodeRequest;
  private slot?: DecodeRequest;

  /** Activates a new document; generations must never be reused for a page. */
  activate(document: DecodeDocument): void {
    // specs/OpenRouterDecode.tla, Replace: logical replacement retains the slot.
    if (sameDocument(this.current, document)) return;
    this.current = { ...document };
    this.pendingProbe = undefined;
    this.isReady = false;
    this.latestRequest = 0;
    this.active = undefined;
  }

  /** Begins a readiness probe for the current document. */
  probe(probe: DecodeProbe): boolean {
    // specs/OpenRouterDecode.tla, Probe: scope readiness to this document.
    if (
      !sameDocument(this.current, probe) ||
      this.pendingProbe !== undefined ||
      this.isReady ||
      !Number.isSafeInteger(probe.probeId) ||
      probe.probeId <= this.latestProbe
    ) {
      return false;
    }
    this.latestProbe = probe.probeId;
    this.pendingProbe = { ...probe };
    return true;
  }

  /** Accepts a readiness response only for the currently pending probe. */
  ready(probe: DecodeProbe): boolean {
    // specs/OpenRouterDecode.tla, ReadinessDelivery: reject stale responses.
    if (!sameDocument(this.current, probe) || !sameProbe(this.pendingProbe, probe)) return false;
    this.pendingProbe = undefined;
    this.isReady = true;
    return true;
  }

  /** Retires one failed probe while retaining identity to reject its possible late response. */
  probeFailed(probe: DecodeProbe): boolean {
    // specs/OpenRouterDecode.tla, ProbeFailure: invalidate the current probe identity.
    if (!sameDocument(this.current, probe) || !sameProbe(this.pendingProbe, probe)) return false;
    this.pendingProbe = undefined;
    return true;
  }

  /** Reports readiness only for the current live document. */
  isReadyFor(document: DecodeDocument): boolean {
    return sameDocument(this.current, document) && this.isReady;
  }

  /** Admits a new request after the caller has established cloud availability. */
  begin(request: DecodeRequest): boolean {
    // specs/OpenRouterDecode.tla, Post: the caller establishes cloud availability.
    if (
      !sameDocument(this.current, request) ||
      !this.isReady ||
      this.active !== undefined ||
      this.slot !== undefined ||
      !Number.isSafeInteger(request.requestId) ||
      request.requestId <= this.latestRequest
    ) {
      return false;
    }
    this.latestRequest = request.requestId;
    this.active = { ...request };
    return true;
  }

  /** Reserves the physical slot for a current request's decode delivery. */
  dispatch(request: DecodeRequest): boolean {
    // specs/OpenRouterDecode.tla, DecodeDelivery: reject stale dispatches.
    if (!sameRequest(this.active, request) || !sameDocument(this.current, request) || !this.isReady || this.slot !== undefined) {
      return false;
    }
    this.slot = { ...request };
    return true;
  }

  /** Invalidates the named logical request without releasing an in-flight decode. */
  cancel(request: DecodeRequest): void {
    // specs/OpenRouterDecode.tla, Cancel: keep the physical decode slot.
    if (sameRequest(this.active, request)) this.active = undefined;
  }

  /** Retires the matching decode and reports whether its result is current. */
  settle(request: DecodeRequest): boolean {
    // specs/OpenRouterDecode.tla, Settle: only current identity may accept.
    if (!sameRequest(this.slot, request)) return false;
    this.slot = undefined;
    const accepted = sameRequest(this.active, request) && sameDocument(this.current, request);
    if (sameRequest(this.active, request)) this.active = undefined;
    return accepted;
  }

  /** Retires resources only when their actual owning document is destroyed. */
  destroy(document: DecodeDocument): void {
    // specs/OpenRouterDecode.tla, Destroy: release only the destroyed owner.
    if (sameDocument(this.slot, document)) this.slot = undefined;
    if (sameDocument(this.current, document)) {
      this.current = undefined;
      this.active = undefined;
      this.pendingProbe = undefined;
      this.isReady = false;
    }
  }
}
