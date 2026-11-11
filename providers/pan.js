// PAN card status. Applications go through UTIITSL or NSDL (Protean), which have their
// own numbers, receipts and tracking pages. Manual service: the tracking pages need a
// captcha, so the CRM opens them and the staff member picks the stage.
async function lookup() {
  throw new Error('PAN status is updated by hand on the customer list');
}

module.exports = {
  id: 'pan',
  name: 'PAN card',
  shortName: 'PAN',
  numberLabel: 'Application or coupon number',
  placeholder: 'From the UTIITSL receipt',
  pattern: '^[A-Z0-9/-]{5,30}$',
  ready: false,
  manual: true,
  officialUrl: 'https://www.trackpan.utiitsl.com/PANONLINE/forms/TrackPan/trackApp',
  openLabel: 'Open UTIITSL',
  stages: ['Submitted', 'In Process', 'Approved', 'Delivered', 'Rejected'],
  agencies: {
    UTI: {
      numberLabel: 'Application or coupon number',
      placeholder: 'From the UTIITSL receipt',
      pattern: '^[A-Z][0-9]{6,12}$',
      officialUrl: 'https://www.trackpan.utiitsl.com/PANONLINE/forms/TrackPan/trackApp',
      openLabel: 'Open UTIITSL',
    },
    NSDL: {
      numberLabel: 'Acknowledgement number',
      placeholder: '15-digit number from the receipt',
      pattern: '^[0-9]{15}$',
      officialUrl: 'https://tinpan.proteantech.in/',
      openLabel: 'Open Protean',
    },
  },
  lookup,
};
