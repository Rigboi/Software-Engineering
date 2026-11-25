/* Shared validation for the browser demo and the server return endpoint. */
(function (root) {
  'use strict';
  const conditions = ['New', 'Good', 'Fair', 'Poor'];
  const assetStatuses = ['Available', 'Sent for Repair'];
  function validateReturn(input) {
    if (!conditions.includes(input.condition)) throw new Error('Select a valid condition on return.');
    if (!assetStatuses.includes(input.assetStatus)) throw new Error('Select a valid next asset status.');
    if (input.received !== true) throw new Error('Confirm that the asset has been received and inspected.');
    if (typeof input.notes !== 'string' || input.notes.length > 1000) throw new Error('Inspection notes must be at most 1,000 characters.');
  }
  function today() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function loanState(loan, date = today()) {
    if (loan.status === 'Returned' || loan.checkinDate) return 'Returned';
    if (loan.status === 'Missing') return 'Missing';
    return loan.dueDate < date ? 'Overdue' : 'On Loan';
  }
  function recordDemoReturn(state, transactionID, input, staffName) {
    validateReturn(input);
    if (!staffName || !staffName.trim()) throw new Error('Enter the demo staff name.');
    const next = JSON.parse(JSON.stringify(state));
    const loan = next.loans.find(item => String(item.transactionID) === String(transactionID));
    if (!loan || loan.status === 'Returned' || loan.checkinDate) throw new Error('This loan is no longer outstanding. Refresh the records.');
    const returnedAt = new Date().toISOString();
    next.returns.unshift({ ...loan, previousCondition: loan.condition || 'Not recorded', condition: input.condition,
      assetStatus: input.assetStatus, notes: input.notes.trim(), staffName: staffName.trim(), returnedAt, emailStatus: 'Demo — not sent' });
    loan.status = 'Returned'; loan.checkinDate = today(); loan.condition = input.condition;
    return next;
  }
  const api = { validateReturn, today, loanState, recordDemoReturn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReturnModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
