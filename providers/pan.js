// PAN card status, for applications made through UTIITSL. Manual service: the
// tracking page needs a captcha, so the CRM opens it and the staff member picks the stage.
async function lookup() {
  throw new Error('PAN status is updated by hand on the customer list');
}

module.exports = {
  id: 'pan',
  name: 'PAN card',
  shortName: 'PAN',
  separatePage: true,
  numberLabel: 'Application or coupon number',
  placeholder: 'From the UTIITSL receipt',
  pattern: '^[A-Z0-9/-]{5,30}$',
  ready: false,
  manual: true,
  officialUrl: 'https://www.trackpan.utiitsl.com/PANONLINE/forms/TrackPan/trackApp',
  openLabel: 'Open UTIITSL',
  stages: ['Submitted', 'In Process', 'Approved', 'Delivered', 'Rejected'],
  lookup,
};
