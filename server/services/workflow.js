export const TRANSITIONS = {
  SUBMITTED: ['UNDER_REVIEW', 'CANCELLED', 'REJECTED'],
  UNDER_REVIEW: ['IN_PROGRESS', 'AWAITING_INFORMATION', 'REJECTED'],
  AWAITING_INFORMATION: ['UNDER_REVIEW'],
  IN_PROGRESS: ['AWAITING_INFORMATION', 'RESOLVED', 'REJECTED'],
  RESOLVED: [], REJECTED: [], CANCELLED: []
};
export const NEEDS_COMMENT = new Set(['AWAITING_INFORMATION', 'REJECTED', 'RESOLVED']);
export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

// Simple three-step view of the detailed workflow, shown to citizens and on the public tracker.
export const PUBLIC_STATUS = {
  SUBMITTED: 'Pending', UNDER_REVIEW: 'Pending', AWAITING_INFORMATION: 'Pending',
  IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved', REJECTED: 'Closed', CANCELLED: 'Closed'
};
