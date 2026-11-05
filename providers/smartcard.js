// Ration card (smart card) service requests from TNPDS.
// Manual service: tnpds.gov.in blocks automated requests with bot protection, so the
// CRM opens the official page and the staff member picks the stage from `stages`.
async function lookup() {
  throw new Error('Ration card status is updated by hand on the customer list');
}

module.exports = {
  id: 'smartcard',
  name: 'Ration Card (TNPDS)',
  shortName: 'TNPDS',
  numberLabel: 'Reference number',
  placeholder: 'Reference number from the SMS',
  pattern: '^[A-Z0-9/-]{5,30}$',
  ready: false,
  manual: true,
  officialUrl: 'https://www.tnpds.gov.in/pages/cardrelated-status',
  openLabel: 'Open TNPDS',
  stages: ['Request Submission', 'Document Verification', 'Field Verification', 'Request Approval', 'Approved', 'Rejected'],
  lookup,
};
