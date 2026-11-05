// Voter application status from the ECI Citizen Service Portal.
// Manual service: tracking only works after signing in on voters.eci.gov.in, so the
// CRM opens the official page and the staff member picks the stage from `stages`.
async function lookup() {
  throw new Error('Voter status is updated by hand on the customer list');
}

module.exports = {
  id: 'voter',
  name: 'Voter Status (ECI)',
  shortName: 'Voter',
  numberLabel: 'Reference number',
  placeholder: 'Reference number from ECI',
  pattern: '^[A-Z0-9/-]{5,30}$',
  ready: false,
  manual: true,
  officialUrl: 'https://voters.eci.gov.in/home/track',
  openLabel: 'Open ECI',
  stages: ['Submitted', 'BLO Appointed', 'Field Verified', 'FVR Submitted', 'Approved', 'Eroll Updated', 'Rejected'],
  lookup,
};
