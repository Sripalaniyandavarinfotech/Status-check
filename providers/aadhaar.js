// Aadhaar enrolment and update status from UIDAI.
// Manual service: the official page needs a captcha, so the CRM opens it and the
// staff member picks the stage. A 12-digit Aadhaar number is refused on purpose:
// tracking needs only the request number, and the CRM must not hold Aadhaar numbers.
async function lookup() {
  throw new Error('Aadhaar status is updated by hand on the customer list');
}

module.exports = {
  id: 'aadhaar',
  name: 'Aadhaar',
  shortName: 'Aadhaar',
  numberLabel: 'Enrolment or update request number',
  placeholder: 'Not the 12-digit Aadhaar number',
  pattern: '^(?![0-9]{12}$)[A-Z0-9/:-]{5,40}$',
  ready: false,
  manual: true,
  officialUrl: 'https://myaadhaar.uidai.gov.in/CheckAadhaarStatus',
  openLabel: 'Open UIDAI',
  stages: ['Submitted', 'In Process', 'Approved', 'Rejected'],
  lookup,
};
