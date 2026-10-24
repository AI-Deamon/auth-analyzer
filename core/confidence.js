// Evidence confidence: how reliable is the DATA behind the analysis?
// This is NOT a measure of how safe the app is.
//   verified      - every capability comes from a known OAuth scope identifier
//   described     - every access line was recognised from Google's own descriptions (normalised interpretation)
//   partial       - some access text was unrecognised/ambiguous, or extraction was incomplete
//   insufficient  - no usable access evidence

export function evaluateConfidence({ capabilities, unrecognised = 0, ambiguous = 0, extractionStatus = 'ok', unknownResources = 0, collapsed = 0, accessEmpty = false }) {
  const gaps = [];
  if (accessEmpty) gaps.push('access_section_empty'); // the page has an access section but it listed nothing: do not read that as "no access"
  if (collapsed > 0) gaps.push('collapsed_access_items'); // the page itself says more access exists than was read
  if (extractionStatus !== 'ok') gaps.push('extraction_' + extractionStatus);
  if (unrecognised) gaps.push('unrecognised_access_text');
  if (ambiguous) gaps.push('ambiguous_wording');
  if (unknownResources) gaps.push('unknown_permission');

  const basis = [...new Set(capabilities.filter((c) => c.resource !== 'unknown').map((c) => (c.source === 'scope_id' ? 'verified_scope_id' : 'page_description')))];
  if (!capabilities.length || extractionStatus === 'failed') return { level: 'insufficient', basis, gaps: gaps.length ? gaps : ['no_access_evidence'] };
  if (gaps.length) return { level: 'partial', basis, gaps };
  return { level: basis.length === 1 && basis[0] === 'verified_scope_id' ? 'verified' : 'described', basis, gaps };
}
