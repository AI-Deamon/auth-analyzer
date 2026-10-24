// Recommended next step. Sensitivity alone never leads to a revoke suggestion.
//
// Actions (in precedence order):
//  consider_revoking     - the user says they no longer need the app
//  investigate_mismatch  - access looks broader than (or conflicts with) the purpose the user stated
//  verify_needed         - the user has not used the app for 6+ months and the access is not minor
//  review_access         - sensitive or not fully understood access; worth a look
//  no_action_indicated   - low sensitivity, evidence understood, nothing else flagged

export const STALE_MONTHS = 6;

export function recommend({ sensitivity, purpose, confidence, context = {} }) {
  const months = Number(context.monthsUnused);
  const stale = Number.isFinite(months) && months >= STALE_MONTHS;
  const stillNeeded = context.stillNeeded === 'no' ? 'no' : context.stillNeeded === 'yes' ? 'yes' : null;
  const reasons = [];
  const notMinor = sensitivity.level !== 'low';
  const incomplete = confidence.level === 'partial' || confidence.level === 'insufficient';

  if (stale) reasons.push('unused_6_months');
  if (stillNeeded === 'no') reasons.push('user_no_longer_needs');
  if (purpose.state === 'broader') reasons.push('purpose_broader');
  if (purpose.state === 'conflicting') reasons.push('purpose_conflicting');
  if (incomplete) reasons.push('evidence_incomplete');
  if (sensitivity.level === 'high') reasons.push('high_sensitivity');

  let action;
  if (stillNeeded === 'no') action = 'consider_revoking';
  else if (purpose.state === 'broader' || purpose.state === 'conflicting') action = 'investigate_mismatch';
  else if (stale && stillNeeded !== 'yes' && (notMinor || incomplete)) action = 'verify_needed';
  else if (notMinor || incomplete) action = 'review_access';
  else action = 'no_action_indicated';

  return { action, reasons };
}
