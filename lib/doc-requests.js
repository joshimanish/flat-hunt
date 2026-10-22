// lib/doc-requests.js — a landlord asked for documents: record which and move the listing to "docs-requested".
// Shared by the owner's route (lib/vault-api.js) and the routine's reply log (lib/replies-api.js). Documents still leave
// only through a share the owner creates.
const { DOC_TYPES } = require("./documents");
const { SUMMARY_ID } = require("./shares");

const REQUEST_TYPES = [...DOC_TYPES, SUMMARY_ID];
const { DECIDED } = require("./outreach");

// Applies the request and returns a function that undoes only this request's own changes (for a failed save): its entry,
// and the status only while it is still the one this request set.
function addDocRequest(l, types, at) {
  const entry = { at, types }, prevStatus = l.status, had = l.docRequests !== undefined;
  l.docRequests = [...(l.docRequests || []), entry].slice(-50);
  if (!DECIDED.includes(l.status)) l.status = "docs-requested";
  const setStatus = l.status;
  return () => {
    const rest = (l.docRequests || []).filter(x => x !== entry);
    if (!rest.length && !had) delete l.docRequests; else l.docRequests = rest;
    if (l.status === setStatus) l.status = prevStatus;
  };
}

module.exports = { REQUEST_TYPES, addDocRequest };
